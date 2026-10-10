// partner-mock simulates every party outside Nusa Bank — the BI FAST and SKN rails,
// the PPOB biller aggregator, the credit bureau and the FX feed — plus the
// failure-injection control plane used in EP2–EP3. Healthy by default.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	chitrace "github.com/DataDog/dd-trace-go/contrib/go-chi/chi.v5/v2"
	slogtrace "github.com/DataDog/dd-trace-go/contrib/log/slog/v2"
	"github.com/DataDog/dd-trace-go/v2/ddtrace/tracer"
	"github.com/DataDog/dd-trace-go/v2/profiler"
	"github.com/go-chi/chi/v5"
)

type config struct {
	port              string
	sknWindowMinutes  int
	sknCutoffMinutes  int
	paymentServiceURL string
}

func loadConfig() config {
	return config{
		port:              envOr("PORT", "8080"),
		sknWindowMinutes:  envInt("SKN_WINDOW_MINUTES", 15),
		sknCutoffMinutes:  envInt("SKN_CUTOFF_MINUTES", 2),
		paymentServiceURL: envOr("PAYMENT_SERVICE_URL", "http://payment-service.nusabank.svc.cluster.local:8080"),
	}
}

func main() {
	slog.SetDefault(slog.New(slogtrace.WrapHandler(slog.NewJSONHandler(os.Stdout, nil))))

	tracer.Start()
	defer tracer.Stop()

	if os.Getenv("DD_PROFILING_ENABLED") == "true" {
		if err := profiler.Start(profiler.WithProfileTypes(
			profiler.CPUProfile, profiler.HeapProfile, profiler.GoroutineProfile,
		)); err != nil {
			slog.Warn("profiler failed to start", "error", err)
		}
		defer profiler.Stop()
	}

	cfg := loadConfig()
	scenarios := newScenarioStore()
	skn := newSKNRail(cfg, scenarios)
	fx := newFXFeed()

	r := chi.NewRouter()
	// Probe traffic would drown business spans in APM; don't trace it.
	r.Use(chitrace.Middleware(chitrace.WithIgnoreRequest(func(r *http.Request) bool {
		return r.URL.Path == "/healthz" || r.URL.Path == "/readyz"
	})))
	r.Get("/healthz", ok)
	r.Get("/readyz", ok)

	r.Post("/bifast/v1/account-inquiry", bifastAccountInquiry(scenarios))
	r.Post("/bifast/v1/credit-transfer", bifastCreditTransfer(scenarios))
	r.Post("/skn/v1/transfers", skn.submit)
	r.Post("/ppob/v1/inquiry", ppobInquiry(scenarios))
	r.Post("/ppob/v1/payment", ppobPayment(scenarios))
	r.Post("/credit-bureau/v1/checks", creditBureauCheck(scenarios))
	r.Get("/fx/v1/rates", fx.rates(scenarios))

	r.Get("/__scenarios", scenarios.list)
	r.Delete("/__scenarios", scenarios.reset)
	r.Put("/__scenarios/{scenarioId}", scenarios.put)

	srv := &http.Server{
		Addr:              ":" + cfg.port,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go skn.run(ctx)

	go func() {
		slog.Info("partner-mock listening", "port", cfg.port, "skn_window_minutes", cfg.sknWindowMinutes)
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

func ok(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil && v > 0 {
		return v
	}
	return fallback
}
