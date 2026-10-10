import type { Context } from "hono";
import { badRequest } from "./errors";

// Parses the JSON body; malformed JSON or a non-object is a 400, never a 500.
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

type StrOpts = { pattern?: RegExp; optional?: boolean };
export function str(body: Record<string, unknown>, key: string, opts: StrOpts & { optional: true }): string | undefined;
export function str(body: Record<string, unknown>, key: string, opts?: StrOpts & { optional?: false }): string;
export function str(body: Record<string, unknown>, key: string, opts: StrOpts = {}): string | undefined {
  const v = body[key];
  if (v === undefined || v === null || v === "") {
    if (opts.optional) return undefined;
    throw badRequest(`${key} is required`);
  }
  if (typeof v !== "string") throw badRequest(`${key} must be a string`);
  if (opts.pattern && !opts.pattern.test(v)) throw badRequest(`${key} has an invalid format`);
  return v;
}

// Money in, as rupiah. Biller products are IDR-only and carry no fraction.
export function idrAmount(body: Record<string, unknown>, key: string): number | undefined {
  const v = body[key];
  if (v === undefined || v === null) return undefined;
  const m = v as { amount?: unknown; currency?: unknown };
  if (typeof m !== "object" || typeof m.amount !== "string" || !/^\d{1,13}$/.test(m.amount) || m.currency !== "IDR") {
    throw badRequest(`${key} must be an IDR amount without decimals`);
  }
  return Number(m.amount);
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ACCOUNT_NUMBER = /^\d{16}$/;
