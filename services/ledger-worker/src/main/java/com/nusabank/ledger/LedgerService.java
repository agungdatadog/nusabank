package com.nusabank.ledger;

import io.opentracing.Span;
import io.opentracing.util.GlobalTracer;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Consumes business events, writes balanced journals, and publishes one ledger.posted.v1
 * per customer line. Journal and event ids are derived from the source event id, so a
 * redelivery (or a crash between publish and commit) produces identical, deduplicated output.
 */
@Service
public class LedgerService {
    private static final Logger log = LoggerFactory.getLogger(LedgerService.class);
    static final String TOPIC_POSTED = "ledger.posted.v1";

    private final JdbcClient jdbc;
    private final ObjectMapper mapper;
    private final KafkaTemplate<String, String> kafka;

    public LedgerService(JdbcClient jdbc, ObjectMapper mapper, KafkaTemplate<String, String> kafka) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.kafka = kafka;
    }

    static UUID derived(String... parts) {
        return UUID.nameUUIDFromBytes(String.join(":", parts).getBytes(StandardCharsets.UTF_8));
    }

    @KafkaListener(topics = "payments.transfer.v1")
    @Transactional
    public void onTransfer(String payload) throws Exception {
        JsonNode e = mapper.readTree(payload);
        var lines = "transfer.received".equals(text(e, "event_type")) ? PostingRules.inbound(e) : PostingRules.transfer(e);
        post("payments.transfer.v1", e, text(e, "transfer_id"), lines);
    }

    @KafkaListener(topics = "biller.payment.v1")
    @Transactional
    public void onBillPayment(String payload) throws Exception {
        JsonNode e = mapper.readTree(payload);
        post("biller.payment.v1", e, text(e, "payment_id"), PostingRules.billPayment(e));
    }

    @KafkaListener(topics = "loan.disbursement.v1")
    @Transactional
    public void onLoanDisbursement(String payload) throws Exception {
        JsonNode e = mapper.readTree(payload);
        post("loan.disbursement.v1", e, text(e, "application_id"), PostingRules.loanDisbursement(e));
    }

    private static String text(JsonNode n, String f) {
        return PostingRules.text(n, f);
    }

    private void post(String topic, JsonNode event, String reference, List<PostingRules.Line> lines) throws Exception {
        String sourceId = text(event, "event_id");
        tag("ledger.reference", reference);
        if (lines.isEmpty()) return; // e.g. a FAILED transfer: nothing to book
        if (!PostingRules.balanced(lines)) {
            // A malformed event must not corrupt the books; it's logged loudly and skipped.
            log.error("unbalanced journal rejected topic={} reference={} event_id={}", topic, reference, sourceId);
            return;
        }
        UUID journalId = derived("journal", sourceId);
        int inserted = jdbc.sql("""
                INSERT INTO journals (id, source_event_id, source_topic, reference) VALUES (:id, :src, :topic, :ref)
                ON CONFLICT (source_event_id) DO NOTHING""")
                .param("id", journalId).param("src", UUID.fromString(sourceId)).param("topic", topic).param("ref", reference)
                .update();
        if (inserted == 0) {
            log.info("duplicate event ignored topic={} event_id={}", topic, sourceId);
            return;
        }
        for (int i = 0; i < lines.size(); i++) {
            var l = lines.get(i);
            jdbc.sql("""
                    INSERT INTO entries (journal_id, line, gl_account, direction, amount, currency, channel, description, hold_id)
                    VALUES (:j, :line, :gl, :dir, :amt, :ccy, :ch, :desc, :hold)""")
                    .param("j", journalId).param("line", i).param("gl", l.glAccount()).param("dir", l.direction())
                    .param("amt", l.amount()).param("ccy", l.currency()).param("ch", l.channel())
                    .param("desc", l.description()).param("hold", l.holdId() == null ? null : UUID.fromString(l.holdId()))
                    .update();
        }
        // Publish before commit: if Kafka is down the listener throws, the transaction rolls
        // back and the source event is redelivered. Consumers dedupe on the derived event_id.
        for (int i = 0; i < lines.size(); i++) {
            var l = lines.get(i);
            if (l.accountNumber() == null) continue;
            Map<String, Object> posted = new LinkedHashMap<>();
            posted.put("event_id", derived("posted", journalId.toString(), Integer.toString(i)).toString());
            posted.put("event_type", "ledger.posted");
            posted.put("occurred_at", Instant.now().toString());
            posted.put("producer", "nusabank-ledger");
            posted.put("journal_id", journalId.toString());
            posted.put("reference", reference);
            posted.put("account_number", l.accountNumber());
            posted.put("direction", l.direction());
            posted.put("amount", Map.of("amount", l.amount().toPlainString(), "currency", l.currency()));
            posted.put("channel", l.channel());
            posted.put("description", l.description());
            if (l.holdId() != null) posted.put("hold_id", l.holdId());
            kafka.send(TOPIC_POSTED, l.accountNumber(), mapper.writeValueAsString(posted)).get(10, TimeUnit.SECONDS);
        }
        log.info("journal posted topic={} reference={} lines={}", topic, reference, lines.size());
    }

    private static void tag(String key, String value) {
        Span span = GlobalTracer.get().activeSpan();
        if (span != null && value != null) span.setTag(key, value);
    }
}
