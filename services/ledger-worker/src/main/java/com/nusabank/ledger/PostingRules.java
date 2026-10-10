package com.nusabank.ledger;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import tools.jackson.databind.JsonNode;

/**
 * Turns business events into balanced double-entry lines. Pure functions: no I/O, so
 * the money rules are unit-testable. Customer lines (CUST-*) become ledger.posted.v1.
 */
public final class PostingRules {
    private PostingRules() {}

    public static final String CUST = "CUST-";

    /** One journal line. accountNumber is set only for customer lines. */
    public record Line(String glAccount, String direction, BigDecimal amount, String currency,
                       String channel, String description, String holdId) {
        public String accountNumber() {
            return glAccount.startsWith(CUST) ? glAccount.substring(CUST.length()) : null;
        }
    }

    static BigDecimal money(JsonNode n, String field) {
        JsonNode m = n.get(field);
        return m == null || m.isNull() ? BigDecimal.ZERO : new BigDecimal(m.get("amount").asString());
    }

    static String text(JsonNode n, String field) {
        JsonNode v = n.get(field);
        return v == null || v.isNull() ? "" : v.asString();
    }

    /** "Bank Central Asia (BCA)" -> "BCA"; names without an abbreviation stay as-is. */
    static String shortBank(String name) {
        int open = name.lastIndexOf('('), close = name.lastIndexOf(')');
        return open >= 0 && close > open ? name.substring(open + 1, close) : name;
    }

    /** payments.transfer.v1 — only SUCCESS moves money; FAILED already released its hold. */
    public static List<Line> transfer(JsonNode e) {
        if (!"SUCCESS".equals(text(e, "status"))) return List.of();
        String rail = text(e, "rail");
        String src = text(e, "source_account_number");
        String dest = text(e, "destination_account_number");
        String destName = text(e, "destination_account_name");
        BigDecimal amount = money(e, "amount");
        BigDecimal fee = money(e, "fee");
        String hold = text(e, "hold_id").isEmpty() ? null : text(e, "hold_id");

        String railName = switch (rail) {
            case "BIFAST" -> "BI FAST";
            case "SKN" -> "SKN";
            default -> "TRANSFER";
        };
        String outgoing = "INTRABANK".equals(rail)
                ? "TRANSFER KE " + destName
                : railName + " ke " + shortBank(text(e, "destination_bank_name")) + " " + dest + " " + destName;
        String note = text(e, "note");
        if (!note.isEmpty()) outgoing += " - " + note;

        List<Line> lines = new ArrayList<>();
        lines.add(new Line(CUST + src, "DEBIT", amount, "IDR", rail, outgoing, hold));
        if ("INTRABANK".equals(rail)) {
            lines.add(new Line(CUST + dest, "CREDIT", amount, "IDR", rail,
                    "TRANSFER DARI " + text(e, "source_account_name"), null));
        } else {
            lines.add(new Line("NOSTRO-" + rail, "CREDIT", amount, "IDR", rail, outgoing, null));
        }
        if (fee.signum() > 0) {
            lines.add(new Line(CUST + src, "DEBIT", fee, "IDR", "FEE", "BIAYA " + railName, null));
            lines.add(new Line("FEE-INCOME", "CREDIT", fee, "IDR", "FEE", "BIAYA " + railName, null));
        }
        return lines;
    }

    /** payments.transfer.v1 / transfer.received — money arriving from another bank. */
    public static List<Line> inbound(JsonNode e) {
        String rail = text(e, "rail");
        String railName = "BIFAST".equals(rail) ? "BI FAST" : rail;
        String remark = text(e, "description");
        String desc = remark.isEmpty()
                ? railName + " DARI " + shortBank(text(e, "sender_bank_name")).toUpperCase(Locale.ROOT) + " " + text(e, "sender_name")
                : remark + " - " + text(e, "sender_name");
        BigDecimal amount = money(e, "amount");
        return List.of(
                new Line("NOSTRO-" + rail, "DEBIT", amount, "IDR", rail, desc, null),
                new Line(CUST + text(e, "account_number"), "CREDIT", amount, "IDR", rail, desc, null));
    }

    /** biller.payment.v1 — the customer pays the aggregator (and the fee to the bank). */
    public static List<Line> billPayment(JsonNode e) {
        if (!"SUCCESS".equals(text(e, "status"))) return List.of();
        String src = text(e, "source_account_number");
        // biller_name / customer_number are display fields; older events only carry the code.
        String name = text(e, "biller_name");
        String biller = (name.isEmpty() ? text(e, "biller_code").replace('-', ' ') : name).toUpperCase(Locale.ROOT);
        String desc = switch (text(e, "category")) {
            case "EWALLET" -> "TOP UP ";
            case "PULSA" -> "PULSA ";
            case "PAKET_DATA" -> "PAKET DATA ";
            case "PLN_PREPAID" -> "TOKEN ";
            default -> "PEMBAYARAN ";
        } + biller;
        String customer = text(e, "customer_number");
        if (!customer.isEmpty()) desc += " " + customer;
        BigDecimal amount = money(e, "amount");
        BigDecimal fee = money(e, "fee");
        String hold = text(e, "hold_id").isEmpty() ? null : text(e, "hold_id");

        List<Line> lines = new ArrayList<>();
        lines.add(new Line(CUST + src, "DEBIT", amount, "IDR", "BILLER", desc, hold));
        lines.add(new Line("PAYABLE-PPOB", "CREDIT", amount, "IDR", "BILLER", desc, null));
        if (fee.signum() > 0) {
            lines.add(new Line(CUST + src, "DEBIT", fee, "IDR", "FEE", "BIAYA ADMIN " + biller, null));
            lines.add(new Line("FEE-INCOME", "CREDIT", fee, "IDR", "FEE", "BIAYA ADMIN " + biller, null));
        }
        return lines;
    }

    /** loan.disbursement.v1 — principal lands in the customer's account. */
    public static List<Line> loanDisbursement(JsonNode e) {
        BigDecimal principal = money(e, "principal");
        String product = text(e, "product_code");
        String desc = "PENCAIRAN " + switch (product) {
            case "KPR" -> "KPR";
            case "KKB" -> "KREDIT KENDARAAN";
            default -> "KREDIT TANPA AGUNAN";
        };
        return List.of(
                new Line("LOAN-RECEIVABLE-" + product, "DEBIT", principal, "IDR", "LOAN", desc, null),
                new Line(CUST + text(e, "disbursement_account_number"), "CREDIT", principal, "IDR", "LOAN", desc, null));
    }

    /** Debits equal credits — checked before anything is written. */
    public static boolean balanced(List<Line> lines) {
        BigDecimal sum = BigDecimal.ZERO;
        for (Line l : lines) sum = "DEBIT".equals(l.direction()) ? sum.add(l.amount()) : sum.subtract(l.amount());
        return sum.signum() == 0;
    }
}
