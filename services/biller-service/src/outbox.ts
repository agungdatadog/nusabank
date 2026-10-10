import { Kafka, logLevel, Partitioners, type Producer } from "kafkajs";
import type { PoolConnection } from "mysql2/promise";
import { config } from "./config";
import { exec, pool, rows } from "./db";
import { logger } from "./logger";
import tracer from "./tracer";

export const TOPIC_BILL_PAYMENT = "biller.payment.v1";

// kafkajs is traced by the injected tracer: it adds trace context and Data Streams
// checkpoints to message headers (DD_DATA_STREAMS_ENABLED=true).
const kafka = new Kafka({ clientId: "nusabank-biller", brokers: config.kafkaBrokers, logLevel: logLevel.WARN });
const producer: Producer = kafka.producer({ allowAutoTopicCreation: false, createPartitioner: Partitioners.DefaultPartitioner });
let connected = false;

export async function connectProducer(): Promise<void> {
  await producer.connect();
  connected = true;
}

// Written in the caller's transaction, with the trace context saved alongside so a
// later sweeper publish still joins the original request's trace.
export async function enqueue(conn: PoolConnection, topic: string, key: string, payload: unknown): Promise<number> {
  const carrier: Record<string, string> = {};
  const span = tracer.scope().active();
  if (span) tracer.inject(span, "text_map", carrier);
  const [r] = await conn.query("INSERT INTO outbox (topic, msg_key, payload, carrier) VALUES (?, ?, ?, ?)",
    [topic, key, JSON.stringify(payload), JSON.stringify(carrier)]);
  return (r as { insertId: number }).insertId;
}

interface OutboxRow {
  id: number;
  topic: string;
  msg_key: string;
  payload: string;
  carrier: string;
}

async function send(row: OutboxRow): Promise<boolean> {
  try {
    if (!connected) await connectProducer(); // Kafka was down at startup

    await producer.send({ topic: row.topic, acks: -1, messages: [{ key: row.msg_key, value: row.payload }] });
    await exec("UPDATE outbox SET sent_at = UTC_TIMESTAMP(3) WHERE id = ?", [row.id]);
    return true;
  } catch (err) {
    logger.warn({ err, topic: row.topic, outbox_id: row.id }, "outbox publish failed, sweeper will retry");
    return false;
  }
}

// Publishes specific rows inside the request's trace; failures are left for the sweeper.
export async function publishNow(id: number): Promise<void> {
  const [row] = await rows<OutboxRow>("SELECT id, topic, msg_key, payload, carrier FROM outbox WHERE id = ? AND sent_at IS NULL", [id]);
  if (row) await send(row);
}

// Retries anything left unsent (Kafka was down, or the pod died mid-request). Replicas
// may both send a row; consumers dedupe on event_id.
export function startSweeper(intervalMs = 5000): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const pending = await rows<OutboxRow>(
        "SELECT id, topic, msg_key, payload, carrier FROM outbox WHERE sent_at IS NULL AND created_at < UTC_TIMESTAMP(3) - INTERVAL 5 SECOND ORDER BY id LIMIT 50");
      for (const row of pending) {
        const parent = tracer.extract("text_map", JSON.parse(row.carrier));
        const ok = await tracer.trace("outbox.publish", { resource: row.topic, childOf: parent }, () => send(row));
        if (ok) logger.info({ topic: row.topic, outbox_id: row.id }, "outbox row published by sweeper");
      }
    } catch (err) {
      logger.warn({ err }, "outbox sweep failed");
    }
  }, intervalMs);
}

export async function shutdown(): Promise<void> {
  await producer.disconnect().catch(() => undefined);
  await pool.end().catch(() => undefined);
}
