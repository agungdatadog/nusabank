import type { Context } from "hono";
import tracer from "./tracer";

// Body shape matches catalog/openapi.yaml#/components/schemas/Error.
export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 404 | 409 | 422 | 500 | 502 | 503,
    public code: string,
    message: string,
    public partner?: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new ApiError(400, "VALIDATION_ERROR", msg);
export const unauthorized = (msg = "Sesi tidak valid, silakan login kembali") =>
  new ApiError(401, "UNAUTHORIZED", msg);
export const notFound = (msg: string) => new ApiError(404, "NOT_FOUND", msg);

export function errorBody(c: Context, err: ApiError) {
  const span = tracer.scope().active();
  if (err.partner) {
    // Downstream failures name the partner on the span too, for EP2's root-cause story.
    span?.setTag("partner.name", err.partner);
    span?.setTag("error.type", err.code);
  }
  return c.json(
    { code: err.code, message: err.message, ...(err.partner ? { partner: err.partner } : {}), trace_id: span?.context().toTraceId() },
    err.status,
  );
}
