package com.nusabank.account.ledger;

import com.nusabank.account.account.AccountRepository;
import com.nusabank.account.account.HoldService;
import com.nusabank.account.web.Money;
import java.math.BigDecimal;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * Maintains balances as a projection of ledger.posted.v1 (ledger-worker owns journals).
 * Each event applies exactly once: balance, transaction line and hold settlement commit together.
 */
@Component
public class LedgerPostedListener {
    private static final Logger log = LoggerFactory.getLogger(LedgerPostedListener.class);

    /** catalog/openapi.yaml#/components/schemas/LedgerPostedEvent. */
    public record LedgerPosted(UUID eventId, String eventType, UUID journalId, String reference, String accountNumber,
                               String direction, Money amount, String channel, String description, UUID holdId) {}

    private final ObjectMapper mapper;
    private final JdbcClient jdbc;
    private final AccountRepository accounts;
    private final HoldService holds;

    public LedgerPostedListener(ObjectMapper mapper, JdbcClient jdbc, AccountRepository accounts, HoldService holds) {
        this.mapper = mapper;
        this.jdbc = jdbc;
        this.accounts = accounts;
        this.holds = holds;
    }

    @KafkaListener(topics = "ledger.posted.v1")
    @Transactional
    public void onPosted(String payload) {
        LedgerPosted e = mapper.readValue(payload, LedgerPosted.class);
        int fresh = jdbc.sql("INSERT INTO processed_events (event_id) VALUES (:id) ON CONFLICT DO NOTHING")
                .param("id", e.eventId()).update();
        if (fresh == 0) return;

        var account = accounts.findForUpdate(e.accountNumber()).orElse(null);
        if (account == null) {
            log.warn("ledger posting for unknown account={} journal={}", e.accountNumber(), e.journalId());
            return;
        }
        BigDecimal amount = e.amount().value();
        // On a credit card, a purchase (DEBIT) raises the outstanding balance.
        boolean card = "CREDIT_CARD".equals(account.productType());
        BigDecimal signed = ("CREDIT".equals(e.direction()) ^ card) ? amount : amount.negate();
        accounts.applyPosting(e.accountNumber(), signed);
        if (e.holdId() != null) holds.release(e.holdId(), "CONSUMED");

        jdbc.sql("""
                INSERT INTO transactions (account_number, posted_at, type, amount, currency, description, channel,
                                          reference, balance_after, journal_id, event_id)
                VALUES (:n, now(), :t, :a, :c, :d, :ch, :r, :b, :j, :e)""")
                .param("n", e.accountNumber()).param("t", e.direction()).param("a", amount)
                .param("c", account.currency()).param("d", e.description() == null ? e.channel() : e.description())
                .param("ch", e.channel()).param("r", e.reference())
                .param("b", account.balance().add(signed)).param("j", e.journalId()).param("e", e.eventId())
                .update();
    }
}
