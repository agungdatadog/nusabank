import { randomUUID } from "node:crypto";
import { MongoClient, type Collection } from "mongodb";
import { config } from "./config";

// The mongodb driver is traced by the injected tracer, which also tags each command
// with the trace context (DD_DBM_PROPAGATION_MODE=full) for DBM <-> APM.
const uri = `mongodb://${encodeURIComponent(config.mongo.user)}:${encodeURIComponent(config.mongo.password)}@${config.mongo.host}/${config.mongo.database}?authSource=admin`;
export const client = new MongoClient(uri, { maxPoolSize: 20, serverSelectionTimeoutMS: 5000, appName: "nusabank-chat" });

export type Role = "customer" | "assistant" | "agent_handoff";
export type Status = "OPEN" | "HANDED_OFF" | "CLOSED";

export interface Message {
  id: string;
  role: Role;
  content: string;
  created_at: Date;
  // Not part of the API: which responder produced an assistant turn, and its intent/tools.
  meta?: Record<string, unknown>;
}

export type Responder = "faq" | "agent";

export interface Session {
  _id: string;
  cif: string;
  status: Status;
  responder?: Responder; // absent on sessions created before 0.2.0 (they were FAQ)
  messages: Message[];
  created_at: Date;
  updated_at: Date;
}

let sessions: Collection<Session>;

export async function connect(): Promise<void> {
  await client.connect();
  sessions = client.db(config.mongo.database).collection<Session>("sessions");
  await sessions.createIndex({ cif: 1, created_at: -1 });
}

export const ping = () => client.db(config.mongo.database).command({ ping: 1 });

export const message = (role: Role, content: string, meta?: Record<string, unknown>): Message =>
  ({ id: randomUUID(), role, content, created_at: new Date(), ...(meta ? { meta } : {}) });

export async function createSession(cif: string, greeting: string, responder: Responder): Promise<Session> {
  const now = new Date();
  const s: Session = { _id: randomUUID(), cif, status: "OPEN", responder, messages: [message("assistant", greeting)], created_at: now, updated_at: now };
  await sessions.insertOne(s);
  return s;
}

export function findSession(id: string, cif: string): Promise<Session | null> {
  return sessions.findOne({ _id: id, cif });
}

// Appends turns, keeping only the most recent messages so a document stays small.
export async function append(id: string, cif: string, msgs: Message[], status?: Status): Promise<void> {
  await sessions.updateOne(
    { _id: id, cif },
    {
      $push: { messages: { $each: msgs, $slice: -config.maxMessagesPerSession } },
      $set: { updated_at: new Date(), ...(status ? { status } : {}) },
    },
  );
}

export async function setResponder(id: string, cif: string, responder: Responder): Promise<void> {
  await sessions.updateOne({ _id: id, cif, responder: { $exists: false } }, { $set: { responder } });
}

// Matches catalog/openapi.yaml#/components/schemas/ChatMessage and ChatSession.
export const messageView = (m: Message) => ({ id: m.id, role: m.role, content: m.content, created_at: m.created_at.toISOString() });
export const sessionView = (s: Session) => ({
  id: s._id, status: s.status, messages: s.messages.map(messageView), created_at: s.created_at.toISOString(),
});
