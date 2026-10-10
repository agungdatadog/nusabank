package com.nusabank.account.account;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Plain SQL on purpose: these are the statements DBM shows, so they should read like real queries. */
@Repository
public class AccountRepository {

    public record AccountRow(String accountNumber, String cif, String productType, String productName,
                             String currency, BigDecimal balance, BigDecimal held, String status,
                             LocalDate openedAt, BigDecimal interestRate, BigDecimal creditLimit,
                             LocalDate maturityDate) {}

    public record TransactionRow(UUID id, OffsetDateTime postedAt, String type, BigDecimal amount,
                                 String currency, String description, String channel, String reference,
                                 BigDecimal balanceAfter) {}

    public record StatementRow(String period, BigDecimal opening, BigDecimal closing, long count) {}

    private static final String ACCOUNT_COLUMNS = """
            account_number, cif, product_type, product_name, currency, balance, held, status,
            opened_at, interest_rate, credit_limit, maturity_date""";

    private final JdbcClient jdbc;

    public AccountRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public List<AccountRow> findByCif(String cif) {
        return jdbc.sql("SELECT " + ACCOUNT_COLUMNS + " FROM accounts WHERE cif = :cif ORDER BY opened_at")
                .param("cif", cif).query(AccountRow.class).list();
    }

    public Optional<AccountRow> find(String accountNumber) {
        return jdbc.sql("SELECT " + ACCOUNT_COLUMNS + " FROM accounts WHERE account_number = :n")
                .param("n", accountNumber).query(AccountRow.class).optional();
    }

    public Optional<AccountRow> findForUpdate(String accountNumber) {
        return jdbc.sql("SELECT " + ACCOUNT_COLUMNS + " FROM accounts WHERE account_number = :n FOR UPDATE")
                .param("n", accountNumber).query(AccountRow.class).optional();
    }

    public long countTransactions(String accountNumber, Instant from, Instant to, String type) {
        return jdbc.sql("""
                SELECT count(*) FROM transactions
                WHERE account_number = :n AND posted_at >= :from AND posted_at < :to
                  AND (CAST(:type AS text) IS NULL OR type = :type)""")
                .param("n", accountNumber).param("from", OffsetDateTime.ofInstant(from, java.time.ZoneOffset.UTC))
                .param("to", OffsetDateTime.ofInstant(to, java.time.ZoneOffset.UTC)).param("type", type)
                .query(Long.class).single();
    }

    public List<TransactionRow> transactions(String accountNumber, Instant from, Instant to, String type,
                                             int limit, int offset) {
        return jdbc.sql("""
                SELECT id, posted_at, type, amount, currency, description, channel, reference, balance_after
                FROM transactions
                WHERE account_number = :n AND posted_at >= :from AND posted_at < :to
                  AND (CAST(:type AS text) IS NULL OR type = :type)
                ORDER BY posted_at DESC
                LIMIT :limit OFFSET :offset""")
                .param("n", accountNumber).param("from", OffsetDateTime.ofInstant(from, java.time.ZoneOffset.UTC))
                .param("to", OffsetDateTime.ofInstant(to, java.time.ZoneOffset.UTC)).param("type", type)
                .param("limit", limit).param("offset", offset)
                .query(TransactionRow.class).list();
    }

    /** Monthly summaries in WIB, newest first. Opening = closing of the previous month. */
    public List<StatementRow> statements(String accountNumber) {
        return jdbc.sql("""
                WITH monthly AS (
                  SELECT to_char(posted_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS period,
                         count(*) AS cnt,
                         (array_agg(balance_after ORDER BY posted_at DESC))[1] AS closing,
                         (array_agg(balance_after - CASE WHEN type = 'CREDIT' THEN amount ELSE -amount END
                                    ORDER BY posted_at ASC))[1] AS opening
                  FROM transactions WHERE account_number = :n GROUP BY 1)
                SELECT period, opening, closing, cnt AS count FROM monthly ORDER BY period DESC""")
                .param("n", accountNumber).query(StatementRow.class).list();
    }

    public int addHeld(String accountNumber, BigDecimal delta) {
        return jdbc.sql("UPDATE accounts SET held = held + :d, updated_at = now() WHERE account_number = :n")
                .param("d", delta).param("n", accountNumber).update();
    }

    public void applyPosting(String accountNumber, BigDecimal signedAmount) {
        jdbc.sql("UPDATE accounts SET balance = balance + :a, updated_at = now() WHERE account_number = :n")
                .param("a", signedAmount).param("n", accountNumber).update();
    }
}
