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

// Name the http.request span after the matched route, e.g. "POST /api/auth/login",
// so APM groups endpoints instead of raw URLs.
app.use("*", async (c, next) => {
  await next();
  const span = tracer.scope().active();
  if (span && c.req.routePath && c.req.routePath !== "/*") {
    span.setTag("resource.name", `${c.req.method} ${c.req.routePath}`);
    span.setTag("http.route", c.req.routePath);
  }
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
