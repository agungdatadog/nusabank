import tracer from "./tracer";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config";
import { migrate, pool } from "./db";
import { ApiError, errorBody } from "./errors";
import { logger } from "./logger";
import { connectProducer, shutdown, startSweeper } from "./outbox";
import { startReconciler } from "./payments";
import { billers } from "./routes/billers";

const app = new Hono();

// One log line per request, written inside the request's span so the injected
// tracer stamps dd.trace_id / dd.span_id on it (log <-> trace correlation).
app.use("*", async (c, next) => {
  if (c.req.path === "/healthz" || c.req.path === "/readyz") return next();
  const start = performance.now();
  await next();
  const status = c.res.status;
  // The last non-middleware match is the endpoint, e.g. /api/billers/payments.
  const route = c.req.matchedRoutes.filter((r) => r.method !== "ALL").at(-1)?.path ?? c.req.path;
  logger[status >= 500 ? "error" : "info"](
    { http: { method: c.req.method, route, status_code: status }, duration_ms: Math.round(performance.now() - start) },
    "request completed",
  );
});

app.get("/healthz", (c) => c.json({ status: "ok" }));
app.get("/readyz", async (c) => {
  try {
    await pool.query("SELECT 1");
    return c.json({ status: "ok" });
  } catch {
    return c.json({ status: "db_unavailable" }, 503);
  }
});

app.route("/api/billers", billers);

app.notFound((c) => c.json({ code: "NOT_FOUND", message: "Endpoint tidak ditemukan" }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) {
    if (err.status >= 500) logger.error({ code: err.code, partner: err.partner }, err.message);
    return errorBody(c, err);
  }
  // Anything unexpected here is a database or programming failure: 500, logged with the trace.
  logger.error({ err }, "unhandled error");
  tracer.scope().active()?.setTag("error", err);
  return errorBody(c, new ApiError(500, "INTERNAL_ERROR", "Terjadi kesalahan, silakan coba lagi"));
});

async function main() {
  await migrate();
  // Payments still work while Kafka is down: events wait in the outbox.
  connectProducer().then(() => logger.info("kafka producer connected"), (err) => logger.error({ err }, "kafka producer connect failed"));
  const timers = [startSweeper(), startReconciler()];
  const server = serve({ fetch: app.fetch, port: config.port }, () => logger.info({ port: config.port }, "biller-service listening"));
  process.on("SIGTERM", () => {
    timers.forEach(clearInterval);
    server.close(() => shutdown().finally(() => process.exit(0)));
  });
}

main().catch((err) => {
  logger.fatal({ err }, "startup failed");
  process.exit(1);
});

export { app };
