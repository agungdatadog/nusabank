import { Hono } from "hono";
import { billerStates, setAvailability } from "../availability";
import { BILLERS } from "../catalog";
import { badRequest, notFound } from "../errors";
import { tag } from "../tracer";
import { jsonBody } from "../validate";

// Cluster-only (the ingress routes /api/billers, not /internal): admin-service's operations view.
export const internal = new Hono();

internal.get("/billers", async (c) => c.json(Object.values(await billerStates())));

internal.put("/billers/:billerCode/availability", async (c) => {
  const code = c.req.param("billerCode");
  if (!BILLERS[code]) throw notFound("Biller tidak ditemukan");
  const body = await jsonBody(c);
  const available = body.available;
  const changedBy = body.changed_by;
  const reason = body.reason ?? "";
  const minutes = body.auto_enable_after_minutes ?? 120;
  if (typeof available !== "boolean" || typeof changedBy !== "string" || !changedBy || typeof reason !== "string" || reason.length > 200
    || !Number.isInteger(minutes) || (minutes as number) < 5 || (minutes as number) > 480) {
    throw badRequest("available and changed_by are required; reason at most 200 characters; auto_enable_after_minutes 5-480");
  }
  tag({ "biller.code": code, "biller.available": available, "partner.name": `ppob:${code}` });
  return c.json(await setAvailability(code, available, changedBy, reason, minutes as number));
});
