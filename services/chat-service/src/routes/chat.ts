import { Hono } from "hono";
import { config } from "../config";
import { ApiError, notFound, unauthorized } from "../errors";
import { answer, GREETING } from "../faq";
import { verify } from "../jwt";
import { logger } from "../logger";
import { append, createSession, findSession, message, messageView, sessionView, type Message, type Responder, type Session } from "../store";
import tracer, { tag } from "../tracer";
import { jsonBody, str, UUID } from "../validate";

type Env = { Variables: { cif: string; token: string } };
export const chat = new Hono<Env>();

const AGENT = "ai-agent";

chat.use("*", async (c, next) => {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const claims = token ? verify(token, config.jwtSecret) : null;
  if (!claims || claims.role !== "customer") throw unauthorized();
  c.set("cif", claims.sub);
  c.set("token", token);
  tracer.setUser({ id: claims.sub, segment: claims.segment });
  await next();
});

// The responder is fixed per session, so one conversation never switches voices midway.
function pickResponder(userAgent: string | undefined): Responder {
  if (config.responder !== "agent") return "faq";
  const synthetic = /k6\//i.test(userAgent ?? "");
  return !synthetic || Math.random() < config.loadgenAgentShare ? "agent" : "faq";
}

chat.post("/sessions", async (c) => {
  const responder = pickResponder(c.req.header("User-Agent"));
  const s = await createSession(c.get("cif"), GREETING, responder);
  tracer.dogstatsd.increment("nusabank.chat.session.count", 1, { responder });
  tag({ "chat.session_id": s._id, "chat.responder": responder });
  return c.json(sessionView(s), 201);
});

async function load(id: string, cif: string): Promise<Session> {
  const s = UUID.test(id) ? await findSession(id, cif) : null;
  if (!s) throw notFound("Sesi chat tidak ditemukan");
  return s;
}

chat.get("/sessions/:sessionId", async (c) => c.json(sessionView(await load(c.req.param("sessionId"), c.get("cif")))));

interface Reply {
  content: string;
  handoff: boolean;
  meta: Record<string, unknown>;
}

// ai-agent calls public APIs with the customer's own JWT; it never reads databases.
async function fromAgent(s: Session, content: string, token: string): Promise<Reply> {
  let res: Response;
  try {
    res = await fetch(`${config.aiAgentUrl}/internal/agent/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: s._id, message: content, customer_token: token, history: s.messages.slice(-10).map(messageView) }),
      signal: AbortSignal.timeout(config.agentTimeoutMs),
    });
  } catch {
    throw new ApiError(502, "PARTNER_TIMEOUT", "Asisten virtual tidak merespons, silakan coba lagi", AGENT);
  }
  if (!res.ok) throw new ApiError(502, "PARTNER_UNAVAILABLE", "Asisten virtual sedang gangguan, silakan coba lagi", AGENT);
  const body = (await res.json()) as { reply: string; handoff_to_human?: boolean; tool_calls?: { tool: string; status: string }[] };
  return { content: body.reply, handoff: body.handoff_to_human ?? false, meta: { responder: "agent", tool_calls: body.tool_calls ?? [] } };
}

chat.post("/sessions/:sessionId/messages", async (c) => {
  const cif = c.get("cif");
  const s = await load(c.req.param("sessionId"), cif);
  const content = str(await jsonBody(c), "content");
  if (content.length > 2000) throw new ApiError(400, "VALIDATION_ERROR", "content must be at most 2000 characters");
  if (s.status !== "OPEN") throw new ApiError(409, "SESSION_NOT_OPEN", "Sesi ini sudah diteruskan ke petugas, silakan mulai sesi baru");
  const responder = s.responder ?? "faq";
  tag({ "chat.session_id": s._id, "chat.responder": responder });

  // The customer's turn is stored first, so it survives even if the responder fails.
  const turn = message("customer", content);
  await append(s._id, cif, [turn]);

  let reply: Reply;
  if (responder === "agent") {
    reply = await fromAgent({ ...s, messages: [...s.messages, turn] }, content, c.get("token"));
  } else {
    const faq = answer(content);
    reply = { content: faq.reply, handoff: faq.handoff, meta: { responder: "faq", intent: faq.intent } };
  }
  const out: Message = message(reply.handoff ? "agent_handoff" : "assistant", reply.content, reply.meta);
  await append(s._id, cif, [out], reply.handoff ? "HANDED_OFF" : undefined);

  const tags = { responder: String(reply.meta.responder), intent: String(reply.meta.intent ?? "agent"), handoff: String(reply.handoff) };
  tracer.dogstatsd.increment("nusabank.chat.message.count", 1, tags);
  if (reply.handoff) tracer.dogstatsd.increment("nusabank.chat.handoff.count", 1, { responder: tags.responder });
  tag({ "chat.intent": tags.intent, "chat.handoff": reply.handoff });
  logger.info({ session_id: s._id, ...tags }, "chat turn answered");
  return c.json(messageView(out));
});
