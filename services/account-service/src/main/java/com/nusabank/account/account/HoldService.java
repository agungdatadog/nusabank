package com.nusabank.account.account;

import com.nusabank.account.NusaProperties;
import com.nusabank.account.web.ApiException;
import com.nusabank.account.web.Money;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Funds reservation before a rail or biller is called, so a customer can't spend the
 * same money twice while the ledger catches up. Holds expire if never consumed.
 */
@Service
public class HoldService {
    private static final Logger log = LoggerFactory.getLogger(HoldService.class);
    private static final Set<String> HOLDABLE = Set.of("SAVINGS", "CURRENT");

    public record HoldView(String id, String accountNumber, Money amount, String reference, OffsetDateTime expiresAt) {}

    private final JdbcClient jdbc;
    private final AccountRepository accounts;
    private final NusaProperties props;

    public HoldService(JdbcClient jdbc, AccountRepository accounts, NusaProperties props) {
        this.jdbc = jdbc;
        this.accounts = accounts;
        this.props = props;
    }

    private record HoldRow(UUID id, String accountNumber, BigDecimal amount, String currency, String reference,
                           String status, OffsetDateTime expiresAt) {}

    private Optional<HoldRow> byKey(UUID key) {
        return jdbc.sql("SELECT id, account_number, amount, currency, reference, status, expires_at FROM holds WHERE idempotency_key = :k")
                .param("k", key).query(HoldRow.class).optional();
    }

    private static HoldView view(HoldRow h) {
        return new HoldView(h.id().toString(), h.accountNumber(), Money.of(h.amount(), h.currency()), h.reference(), h.expiresAt());
    }

    @Transactional
    public HoldView create(String accountNumber, Money amount, String reference, String purpose, UUID idempotencyKey) {
        Optional<HoldRow> replay = byKey(idempotencyKey);
        if (replay.isPresent()) return view(replay.get());

        var account = accounts.findForUpdate(accountNumber)
                .orElseThrow(() -> ApiException.notFound("Rekening tidak ditemukan"));
        if (!"ACTIVE".equals(account.status()) || !HOLDABLE.contains(account.productType())) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_CONTENT, "ACCOUNT_NOT_ELIGIBLE", "Rekening tidak dapat digunakan untuk transaksi ini");
        }
        if (!account.currency().equals(amount.currency())) {
            throw ApiException.badRequest("amount currency must match the account currency " + account.currency());
        }
        BigDecimal value = amount.value();
        if (account.balance().subtract(account.held()).compareTo(value) < 0) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_CONTENT, "INSUFFICIENT_BALANCE", "Saldo tidak mencukupi");
        }
        accounts.addHeld(accountNumber, value);
        HoldRow h = jdbc.sql("""
                INSERT INTO holds (account_number, amount, currency, reference, purpose, idempotency_key, expires_at)
                VALUES (:n, :a, :c, :r, :p, :k, now() + make_interval(mins => :ttl))
                RETURNING id, account_number, amount, currency, reference, status, expires_at""")
                .param("n", accountNumber).param("a", value).param("c", amount.currency()).param("r", reference)
                .param("p", purpose).param("k", idempotencyKey).param("ttl", props.holdTtlMinutes())
                .query(HoldRow.class).single();
        return view(h);
    }

    /**
     * Settles an ACTIVE hold and gives the reserved amount back in one statement, so it's
     * atomic even when called outside a transaction. Returns false if it was already settled.
     */
    public boolean release(UUID holdId, String newStatus) {
        return jdbc.sql("""
                WITH h AS (
                  UPDATE holds SET status = :s WHERE id = :id AND status = 'ACTIVE'
                  RETURNING account_number, amount)
                UPDATE accounts a SET held = a.held - h.amount, updated_at = now()
                FROM h WHERE a.account_number = h.account_number""")
                .param("s", newStatus).param("id", holdId).update() > 0;
    }

    /** A hold nobody consumed (rail never answered, ledger never posted) must not lock funds forever. */
    @Scheduled(fixedDelayString = "PT60S", initialDelayString = "PT30S")
    public void expireStale() {
        var ids = jdbc.sql("SELECT id FROM holds WHERE status = 'ACTIVE' AND expires_at < now() LIMIT 500")
                .query(UUID.class).list();
        int expired = 0;
        for (UUID id : ids) {
            if (release(id, "EXPIRED")) expired++;
        }
        if (expired > 0) log.info("expired stale holds count={}", expired);
    }
}
