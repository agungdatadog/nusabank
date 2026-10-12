// payment-service runs Nusa Bank's transfer rails: intrabank, BI FAST (instant) and
// SKN (batch clearing). Funds are held on account-service before a rail is called;
// terminal states are published to payments.transfer.v1 through a transactional outbox.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/DataDog/datadog-go/v5/statsd"
	chitrace "github.com/DataDog/dd-trace-go/contrib/go-chi/chi.v5/v2"
	slogtrace "github.com/DataDog/dd-trace-go/contrib/log/slog/v2"
	"github.com/DataDog/dd-trace-go/v2/ddtrace/tracer"
	"github.com/DataDog/dd-trace-go/v2/profiler"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
)

type config struct {
	port                                       string
	dbHost, dbPort, dbName, dbUser, dbPassword string
	jwtSecret                                  string
	accountURL, partnerURL                     string
	kafkaBrokers                               []string
}

func loadConfig() config {
	return config{
		port:         envOr("PORT", "8080"),
		dbHost:       os.Getenv("DB_HOST"),
		dbPort:       envOr("DB_PORT", "5432"),
		dbName:       envOr("DB_NAME", "payment"),
		dbUser:       envOr("DB_USER", "payment"),
		dbPassword:   os.Getenv("DB_PASSWORD"),
		jwtSecret:    os.Getenv("JWT_SECRET"),
		accountURL:   envOr("ACCOUNT_SERVICE_URL", "http://account-service.nusabank.svc.cluster.local:8080"),
		partnerURL:   envOr("PARTNER_MOCK_URL", "http://partner-mock.nusabank.svc.cluster.local:8080"),
		kafkaBrokers: strings.Split(envOr("KAFKA_BOOTSTRAP", "nusabank-kafka-kafka-bootstrap.nusabank.svc.cluster.local:9092"), ","),
	}
}

func main() {
	slog.SetDefault(slog.New(slogtrace.WrapHandler(slog.NewJSONHandler(os.Stdout, nil))))
	tracer.Start()
	defer tracer.Stop()
	if os.Getenv("DD_PROFILING_ENABLED") == "true" {
		if err := profiler.Start(profiler.WithProfileTypes(profiler.CPUProfile, profiler.HeapProfile, profiler.GoroutineProfile)); err != nil {
			slog.Warn("profiler failed to start", "error", err)
		}
		defer profiler.Stop()
	}

	cfg := loadConfig()
	if cfg.dbHost == "" || cfg.dbPassword == "" || cfg.jwtSecret == "" {
		slog.Error("DB_HOST, DB_PASSWORD and JWT_SECRET are required")
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	db, err := openDB(cfg)
	if err != nil {
		slog.Error("database open failed", "error", err)
		os.Exit(1)
	}
	if err := migrate(ctx, db); err != nil {
		slog.Error("migration failed", "error", err)
		os.Exit(1)
	}
	// DogStatsD client for business metrics; reads DD_DOGSTATSD_URL / DD_AGENT_HOST.
	var metrics statsd.ClientInterface = &statsd.NoOpClient{}
	if c, err := statsd.New(""); err == nil {
		metrics = c
	} else {
		slog.Warn("dogstatsd unavailable, business metrics disabled", "error", err)
	}
	defer metrics.Close()

	ob := newOutbox(db, cfg.kafkaBrokers)
	go ob.sweep(ctx)

	s := &server{
		db:       db,
		accounts: accountClient{newDownstream(cfg.accountURL, 5*time.Second)},
		rails:    railClient{newDownstream(cfg.partnerURL, 10*time.Second)},
		outbox:   ob,
		metrics:  metrics,
		secret:   []byte(cfg.jwtSecret),
	}

	r := chi.NewRouter()
	r.Use(chitrace.Middleware(chitrace.WithIgnoreRequest(func(r *http.Request) bool {
		return r.URL.Path == "/healthz" || r.URL.Path == "/readyz"
	})))
	r.Use(requestLog)
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, http.StatusOK, map[string]string{"status": "ok"}) })
	r.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := db.PingContext(r.Context()); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "db_unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Route("/api/transfers", func(r chi.Router) {
		r.Use(s.requireCustomer)
		r.Get("/banks", s.listBanks)
		r.Get("/rails", s.listRails)
		r.Get("/beneficiaries", s.listBeneficiaries)
		r.Post("/beneficiaries", s.createBeneficiary)
		r.Post("/inquiry", s.inquiry)
		r.Get("/", s.listTransfers)
		r.Post("/", s.createTransfer)
		r.Get("/{transferId}", s.getTransfer)
	})
	r.Get("/internal/transfers", s.internalListTransfers)
	r.Post("/internal/transfers/{transferId}/retry", s.internalRetryTransfer)
	r.Post("/internal/rails/skn/settlements", s.sknSettlement)
	r.Post("/internal/rails/inbound", s.receiveInbound)

	srv := &http.Server{Addr: ":" + cfg.port, Handler: r, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		slog.Info("payment-service listening", "port", cfg.port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}

// requestLog writes one line per request inside the request span (log <-> trace).
func requestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" || r.URL.Path == "/readyz" {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		level := slog.LevelInfo
		if ww.Status() >= 500 {
			level = slog.LevelError
		}
		slog.Log(r.Context(), level, "request completed", "http.method", r.Method,
			"http.route", chi.RouteContext(r.Context()).RoutePattern(), "http.status_code", ww.Status(),
			"duration_ms", time.Since(start).Milliseconds())
	})
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
