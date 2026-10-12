import { Hono } from "hono";
import { config } from "../config";
import { badRequest, unauthorized } from "../errors";
import { verify } from "../jwt";
import { logger } from "../logger";
import { balanceOf, entryView, history, redeem } from "../points";
import { CATALOG, tierFor } from "../rules";
import tracer, { tag } from "../tracer";
import { UUID, jsonBody, str } from "../validate";

type Env = { Variables: { cif: string } };
export const rewards = new Hono<Env>();

rewards.use("*", async (c, next) => {
  const header = c.req.header("Authorization");
  const claims = header?.startsWith("Bearer ") ? verify(header.slice(7), config.jwtSecret) : null;
  if (!claims || claims.role !== "customer") throw unauthorized();
  c.set("cif", claims.sub);
  tracer.setUser({ id: claims.sub, segment: claims.segment });
  await next();
});

rewards.get("/", async (c) => {
  const { points, points90d } = await balanceOf(c.get("cif"));
  const t = tierFor(points90d);
  tag({ "rewards.tier": t.tier });
  return c.json({
    points, tier: t.tier, tier_points_90d: points90d,
    ...(t.next ? { next_tier: t.next, points_to_next_tier: t.toNext } : {}),
  });
});

rewards.get("/history", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
  const size = Math.min(100, Math.max(1, Number(c.req.query("page_size") ?? 20) || 20));
  return c.json((await history(c.get("cif"), page, size)).map(entryView));
});

rewards.get("/catalog", (c) => c.json(CATALOG));

rewards.post("/redemptions", async (c) => {
  const key = c.req.header("Idempotency-Key");
  if (!key || !UUID.test(key)) throw badRequest("Idempotency-Key header must be a UUID");
  const itemCode = str(await jsonBody(c), "item_code", { pattern: /^[A-Z0-9-]{3,32}$/ });
  tag({ "rewards.item": itemCode });
  const entry = await redeem(c.get("cif"), itemCode, key);
  tracer.dogstatsd.increment("nusabank.rewards.redemption.count", 1, { item: itemCode });
  tracer.dogstatsd.increment("nusabank.rewards.points.redeemed", -entry.points, { item: itemCode });
  logger.info({ item: itemCode, points: entry.points }, "reward redeemed");
  return c.json(entryView(entry), 201);
});
