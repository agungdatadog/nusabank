import tracer from "./tracer";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config";
import { migrate, pool, seedCustomers } from "./db";
import { ApiError, errorBody } from "./errors";
import { logger } from "./logger";
import { auth } from "./routes/auth";
import { onboarding, promotions } from "./routes/onboarding";

const app = new Hono();

// One log line per request, written inside the request's span so the injected
// tracer stamps dd.trace_id / dd.span_id on it (log <-> trace correlation).
app.use("*", async (c, next) => {
  if (c.req.path === "/healthz" || c.req.path === "/readyz") return next();
  const start = performance.now();
  await next();
  const status = c.res.status;
  // The last non-middleware match is the endpoint, e.g. /api/auth/login.
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

app.route("/api/auth", auth);
app.route("/api/onboarding/applications", onboarding);
app.route("/api/promotions", promotions);

app.notFound((c) => c.json({ code: "NOT_FOUND", message: "Endpoint tidak ditemukan" }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) return errorBody(c, err);
  // Anything unexpected here is a database or programming failure: 500, logged with the trace.
  logger.error({ err }, "unhandled error");
  tracer.scope().active()?.setTag("error", err);
  return errorBody(c, new ApiError(500, "INTERNAL_ERROR", "Terjadi kesalahan, silakan coba lagi"));
});

async function main() {
  await migrate();
  const inserted = await seedCustomers();
  logger.info({ inserted }, "customer seed loaded");
  serve({ fetch: app.fetch, port: config.port }, () => logger.info({ port: config.port }, "auth-service listening"));
}

main().catch((err) => {
  logger.fatal({ err }, "startup failed");
  process.exit(1);
});

export { app };
