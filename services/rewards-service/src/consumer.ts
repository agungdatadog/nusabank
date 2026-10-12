import { Kafka, logLevel, type Consumer } from "kafkajs";
import { config } from "./config";
import { logger } from "./logger";
import { earn, segments } from "./points";
import { fromBill, fromTransfer } from "./rules";
import tracer, { tag } from "./tracer";

const TOPICS = ["payments.transfer.v1", "biller.payment.v1"];

// kafkajs is traced by the injected tracer: each message gets a consume span that
// continues the producer's trace, plus a Data Streams checkpoint (DD_DATA_STREAMS_ENABLED).
const kafka = new Kafka({ clientId: "nusabank-rewards", brokers: config.kafkaBrokers, logLevel: logLevel.WARN });
export const consumer: Consumer = kafka.consumer({ groupId: "rewards-service" });

export async function startConsumer(): Promise<void> {
  await consumer.connect();
  // From the beginning on first start: past transactions earn their points too, dated
  // when they happened. Afterwards the group's committed offsets take over.
  await consumer.subscribe({ topics: TOPICS, fromBeginning: true });
  await consumer.run({
    // A throw here (e.g. the database is down) retries the message instead of skipping it;
    // points are eventually consistent, never lost.
    eachMessage: async ({ topic, partition, message }) => {
      let e: Record<string, unknown>;
      try {
        e = JSON.parse(message.value?.toString() ?? "");
      } catch {
        // Retrying can't fix a malformed event, and it would block the partition: log and skip.
        logger.error({ topic, partition, offset: message.offset }, "malformed event skipped");
        return;
      }
      if (typeof e.event_id !== "string") {
        logger.error({ topic, partition, offset: message.offset }, "event without event_id skipped");
        return;
      }
      const cif = typeof e.cif === "string" ? e.cif : "";
      const segment = segments.get(cif) ?? "REGULAR";
      const earned = topic === "biller.payment.v1" ? fromBill(e, segment) : fromTransfer(e, segment);
      if (!earned) return;
      tag({ "usr.id": cif, "rewards.points": earned.points, "rewards.source": earned.source });
      const occurred = new Date(String(e.occurred_at));
      const fresh = await earn(earned, e.event_id, Number.isNaN(occurred.getTime()) ? new Date() : occurred);
      if (!fresh) return;
      tracer.dogstatsd.increment("nusabank.rewards.points.earned", earned.points, { source: earned.source, segment: segment.toLowerCase() });
      logger.info({ cif, points: earned.points, source: earned.source, reference: earned.reference, topic }, "points earned");
    },
  });
}
