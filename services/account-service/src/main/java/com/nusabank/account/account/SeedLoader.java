package com.nusabank.account.account;

import com.nusabank.account.NusaProperties;
import java.io.File;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Loads products from catalog/seed/customers.json and back-fills six months of realistic,
 * deterministic history so statements, mutasi and DBM have data from day one.
 * Runs once: replicas serialise on an advisory lock and skip when accounts exist.
 */
@Component
public class SeedLoader implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(SeedLoader.class);
    private static final ZoneId WIB = ZoneId.of("Asia/Jakarta");
    private static final int HISTORY_DAYS = 180;

    private static final String[] BANKS = {"BCA", "Mandiri", "BRI", "BNI", "CIMB Niaga", "BSI", "Permata", "Danamon"};
    private static final String[] EMPLOYERS = {"PT Sinar Mas Teknologi", "PT Garuda Logistik Nusantara",
            "PT Mitra Retail Indonesia", "PT Cahaya Energi Persada", "PT Andalan Konsultan", "Universitas Nusantara"};
    private static final String[] MERCHANTS = {"Warung Sate Pak Darto", "Kopi Senja Kemang", "Apotek Sehat Sentosa",
            "Toko Roti Mentari", "Bengkel Jaya Motor", "Laundry Bersih Kilat", "Bakmi Ayam Gondangdia", "Minimarket Berkah"};
    private static final String[] BILLERS = {"PLN", "PDAM Jakarta", "BPJS Kesehatan", "IndiHome", "Telkomsel"};
    private static final String[] WALLETS = {"GoPay", "OVO", "ShopeePay", "DANA"};

    private final NusaProperties props;
    private final ObjectMapper mapper;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final OwnerNames owners;

    public SeedLoader(NusaProperties props, ObjectMapper mapper, JdbcTemplate jdbc, TransactionTemplate tx, OwnerNames owners) {
        this.props = props;
        this.mapper = mapper;
        this.jdbc = jdbc;
        this.tx = tx;
        this.owners = owners;
    }

    private record Txn(Instant at, String type, BigDecimal amount, String description, String channel) {}

    @Override
    public void run(ApplicationArguments args) {
        JsonNode customers = mapper.readTree(new File(props.seedFile())).get("customers");
        for (JsonNode c : customers) owners.put(c.get("cif").asString(), c.get("full_name").asString());

        tx.executeWithoutResult(status -> {
            jdbc.execute("SELECT pg_advisory_xact_lock(hashtext('account-service-seed'))");
            Long existing = jdbc.queryForObject("SELECT count(*) FROM accounts", Long.class);
            if (existing != null && existing > 0) return;
            int accounts = 0, txns = 0;
            for (JsonNode c : customers) {
                for (JsonNode a : c.get("accounts")) {
                    insertAccount(c.get("cif").asString(), a);
                    txns += insertHistory(a, c.get("full_name").asString());
                    accounts++;
                }
            }
            log.info("seed loaded accounts={} transactions={}", accounts, txns);
        });
    }

    private void insertAccount(String cif, JsonNode a) {
        jdbc.update("""
                INSERT INTO accounts (account_number, cif, product_type, product_name, currency, balance, opened_at,
                                      interest_rate, credit_limit, maturity_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                a.get("account_number").asString(), cif, a.get("product_type").asString(), a.get("product_name").asString(),
                a.get("currency").asString(), new BigDecimal(a.get("balance").asString()),
                LocalDate.parse(a.get("opened_at").asString()), decimal(a, "interest_rate"), decimal(a, "credit_limit"),
                a.hasNonNull("maturity_date") ? LocalDate.parse(a.get("maturity_date").asString()) : null);
    }

    private static BigDecimal decimal(JsonNode a, String field) {
        return a.hasNonNull(field) ? new BigDecimal(a.get(field).asString()) : null;
    }

    /** Generates history newest-first, walking the balance backwards from the seeded closing balance. */
    private int insertHistory(JsonNode a, String fullName) {
        String number = a.get("account_number").asString();
        String type = a.get("product_type").asString();
        String ccy = a.get("currency").asString();
        Random rnd = new Random(number.hashCode());
        List<Txn> txns = switch (type) {
            case "SAVINGS", "CURRENT" -> "IDR".equals(ccy) ? idrDeposit(rnd, number, fullName) : valas(rnd, ccy);
            case "CREDIT_CARD" -> card(rnd);
            case "TIME_DEPOSIT" -> List.of(new Txn(LocalDate.parse(a.get("opened_at").asString()).atTime(9, 0).atZone(WIB).toInstant(),
                    "CREDIT", new BigDecimal(a.get("balance").asString()), "PENEMPATAN DEPOSITO", "INTRABANK"));
            default -> List.of();
        };
        txns = new ArrayList<>(txns);
        txns.sort((x, y) -> y.at().compareTo(x.at()));

        boolean card = "CREDIT_CARD".equals(type);
        BigDecimal running = new BigDecimal(a.get("balance").asString());
        List<Object[]> rows = new ArrayList<>();
        for (Txn t : txns) {
            // Deposits: a credit raises the balance; on a card a debit (purchase) raises what's owed.
            BigDecimal signed = ("CREDIT".equals(t.type()) ^ card) ? t.amount() : t.amount().negate();
            BigDecimal before = running.subtract(signed);
            if (before.signum() < 0) continue; // would imply an overdraft earlier — skip that line
            rows.add(new Object[] {number, Timestamp.from(t.at()), t.type(), t.amount(), ccy, t.description(), t.channel(), running});
            running = before;
        }
        jdbc.batchUpdate("""
                INSERT INTO transactions (account_number, posted_at, type, amount, currency, description, channel, balance_after)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""", rows);
        return rows.size();
    }

    private static Instant daysAgo(Random rnd, int maxDays) {
        LocalDate day = LocalDate.now(WIB).minusDays(1 + rnd.nextInt(maxDays));
        return day.atTime(7 + rnd.nextInt(15), rnd.nextInt(60)).atZone(WIB).toInstant();
    }

    private static BigDecimal idr(Random rnd, long min, long max, long step) {
        long v = min + (long) (rnd.nextDouble() * (max - min));
        return BigDecimal.valueOf(v / step * step);
    }

    private static String phone(Random rnd) {
        return "08" + (11 + rnd.nextInt(88)) + String.format("%08d", rnd.nextInt(100_000_000));
    }

    private List<Txn> idrDeposit(Random rnd, String number, String fullName) {
        List<Txn> out = new ArrayList<>();
        String employer = EMPLOYERS[Math.abs(number.hashCode()) % EMPLOYERS.length];
        BigDecimal salary = idr(rnd, 6_500_000, 38_000_000, 50_000);
        LocalDate today = LocalDate.now(WIB);
        for (int m = 0; m < 6; m++) {
            LocalDate payday = today.minusMonths(m).withDayOfMonth(25);
            if (payday.isAfter(today)) continue;
            out.add(new Txn(payday.atTime(8, 5).atZone(WIB).toInstant(), "CREDIT", salary, "GAJI " + employer.toUpperCase(), "SKN"));
            out.add(new Txn(payday.withDayOfMonth(1).atTime(0, 5).atZone(WIB).toInstant(), "CREDIT",
                    idr(rnd, 2_000, 85_000, 100), "BUNGA TABUNGAN", "INTEREST"));
            out.add(new Txn(payday.withDayOfMonth(2).atTime(0, 10).atZone(WIB).toInstant(), "DEBIT",
                    BigDecimal.valueOf(12_500), "BIAYA ADMINISTRASI BULANAN", "FEE"));
        }
        int n = 45 + rnd.nextInt(40);
        for (int i = 0; i < n; i++) {
            Instant at = daysAgo(rnd, HISTORY_DAYS);
            switch (rnd.nextInt(10)) {
                case 0, 1 -> out.add(new Txn(at, "DEBIT", idr(rnd, 50_000, 3_500_000, 1_000),
                        "BI FAST ke " + BANKS[rnd.nextInt(BANKS.length)] + " " + personName(rnd), "BIFAST"));
                case 2 -> out.add(new Txn(at, "DEBIT", idr(rnd, 100_000, 2_000_000, 1_000),
                        "TRANSFER KE " + personName(rnd), "INTRABANK"));
                case 3 -> out.add(new Txn(at, "CREDIT", idr(rnd, 100_000, 2_500_000, 1_000),
                        "BI FAST DARI " + personName(rnd), "BIFAST"));
                case 4, 5 -> out.add(new Txn(at, "DEBIT", idr(rnd, 20_000, 500_000, 1_000),
                        "TOP UP " + WALLETS[rnd.nextInt(WALLETS.length)].toUpperCase() + " " + phone(rnd), "BILLER"));
                case 6 -> out.add(new Txn(at, "DEBIT", idr(rnd, 85_000, 1_200_000, 500),
                        "PEMBAYARAN " + BILLERS[rnd.nextInt(BILLERS.length)].toUpperCase(), "BILLER"));
                default -> out.add(new Txn(at, "DEBIT", idr(rnd, 15_000, 450_000, 500),
                        "QRIS " + MERCHANTS[rnd.nextInt(MERCHANTS.length)].toUpperCase(), "INTRABANK"));
            }
        }
        if (rnd.nextInt(4) == 0) {
            out.add(new Txn(daysAgo(rnd, HISTORY_DAYS), "DEBIT", idr(rnd, 25_000_000, 150_000_000, 1_000_000),
                    "SKN ke " + BANKS[rnd.nextInt(BANKS.length)] + " " + personName(rnd), "SKN"));
        }
        return out;
    }

    private List<Txn> valas(Random rnd, String ccy) {
        List<Txn> out = new ArrayList<>();
        int n = 4 + rnd.nextInt(6);
        for (int i = 0; i < n; i++) {
            BigDecimal amt = "USD".equals(ccy)
                    ? BigDecimal.valueOf(50 + rnd.nextInt(2_500)).add(BigDecimal.valueOf(rnd.nextInt(100), 2))
                    : BigDecimal.valueOf((5_000 + rnd.nextInt(300_000)) / 100 * 100L);
            out.add(rnd.nextBoolean()
                    ? new Txn(daysAgo(rnd, HISTORY_DAYS), "CREDIT", amt, "PEMBELIAN VALAS " + ccy, "INTRABANK")
                    : new Txn(daysAgo(rnd, HISTORY_DAYS), "DEBIT", amt, "PENJUALAN VALAS " + ccy, "INTRABANK"));
        }
        return out;
    }

    private List<Txn> card(Random rnd) {
        List<Txn> out = new ArrayList<>();
        int n = 15 + rnd.nextInt(25);
        for (int i = 0; i < n; i++) {
            out.add(new Txn(daysAgo(rnd, HISTORY_DAYS), "DEBIT", idr(rnd, 35_000, 2_750_000, 500),
                    "BELANJA " + MERCHANTS[rnd.nextInt(MERCHANTS.length)].toUpperCase(), "INTRABANK"));
        }
        for (int m = 1; m < 6; m++) {
            out.add(new Txn(LocalDate.now(WIB).minusMonths(m).withDayOfMonth(15).atTime(10, 0).atZone(WIB).toInstant(),
                    "CREDIT", idr(rnd, 500_000, 6_000_000, 1_000), "PEMBAYARAN TAGIHAN KARTU KREDIT", "INTRABANK"));
        }
        return out;
    }

    private static final String[] FIRST = {"SITI", "BUDI", "DEWI", "AGUS", "RINA", "AHMAD", "PUTRI", "HENDRA", "AYU", "RIZKY"};
    private static final String[] LAST = {"RAHMAWATI", "SANTOSO", "WIJAYA", "PRATAMA", "HIDAYAT", "SAPUTRA", "KUSUMA", "NASUTION"};

    private static String personName(Random rnd) {
        return FIRST[rnd.nextInt(FIRST.length)] + " " + LAST[rnd.nextInt(LAST.length)];
    }

}
