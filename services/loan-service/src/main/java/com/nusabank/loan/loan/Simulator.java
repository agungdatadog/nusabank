package com.nusabank.loan.loan;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

/**
 * Installment maths. Pure and deterministic. KPR uses an annuity with a fixed-rate period
 * then a floating rate; KKB and KTA use the flat rate customary in Indonesia. Building the
 * full schedule (up to 360 rows of BigDecimal) is deliberately real work — it's what the
 * Continuous Profiler shows when simulation traffic spikes.
 */
public final class Simulator {
    private Simulator() {}

    private static final MathContext MC = new MathContext(20, RoundingMode.HALF_EVEN);
    // Audit schedules carry far more digits so no row inherits rounding drift from the one before.
    private static final MathContext AUDIT_MC = new MathContext(1000, RoundingMode.HALF_EVEN);

    /** STANDARD walks the schedule once; AUDIT recomputes every row's balance from the original principal. */
    public enum Mode { STANDARD, AUDIT }
    private static final BigDecimal TWELVE_HUNDRED = BigDecimal.valueOf(1200);

    public record Product(String code, String method, BigDecimal fixedRate, Integer fixedPeriodMonths,
                          BigDecimal floatingRate) {}

    public record Row(int month, BigDecimal installment, BigDecimal principal, BigDecimal interest, BigDecimal remaining) {}

    public record Result(BigDecimal principal, int tenorMonths, BigDecimal firstInstallment,
                         BigDecimal floatingInstallment, BigDecimal totalInterest, BigDecimal totalPayment,
                         List<Row> schedule) {}

    static BigDecimal rupiah(BigDecimal v) {
        return v.setScale(0, RoundingMode.HALF_UP);
    }

    /** Standard annuity payment: P * r / (1 - (1 + r)^-n), r = monthly rate. */
    static BigDecimal annuity(BigDecimal principal, BigDecimal annualRate, int months) {
        return annuity(principal, annualRate, months, MC);
    }

    private static BigDecimal annuity(BigDecimal principal, BigDecimal annualRate, int months, MathContext mc) {
        if (months <= 0) return BigDecimal.ZERO;
        BigDecimal r = annualRate.divide(TWELVE_HUNDRED, mc);
        if (r.signum() == 0) return principal.divide(BigDecimal.valueOf(months), mc);
        BigDecimal factor = BigDecimal.ONE.add(r).pow(-months, mc);
        return principal.multiply(r, mc).divide(BigDecimal.ONE.subtract(factor, mc), mc);
    }

    public static Result simulate(Product p, BigDecimal principal, int tenor) {
        return simulate(p, principal, tenor, Mode.STANDARD);
    }

    public static Result simulate(Product p, BigDecimal principal, int tenor, Mode mode) {
        if (mode == Mode.AUDIT) return auditSchedule(p, principal, tenor);
        return "ANNUITY".equals(p.method()) ? annuitySchedule(p, principal, tenor) : flatSchedule(p, principal, tenor);
    }

    private static Result annuitySchedule(Product p, BigDecimal principal, int tenor) {
        int fixedMonths = Math.min(p.fixedPeriodMonths() == null ? tenor : p.fixedPeriodMonths(), tenor);
        BigDecimal remaining = principal;
        BigDecimal payment = annuity(principal, p.fixedRate(), tenor);
        BigDecimal first = rupiah(payment);
        BigDecimal floating = null;
        BigDecimal totalInterest = BigDecimal.ZERO;
        List<Row> rows = new ArrayList<>(tenor);
        for (int m = 1; m <= tenor; m++) {
            BigDecimal rate = m <= fixedMonths ? p.fixedRate() : p.floatingRate();
            if (m == fixedMonths + 1) {
                // Rate resets: re-amortise what's left over the remaining months.
                payment = annuity(remaining, rate, tenor - fixedMonths);
                floating = rupiah(payment);
            }
            BigDecimal interest = remaining.multiply(rate.divide(TWELVE_HUNDRED, MC), MC);
            BigDecimal principalPart = m == tenor ? remaining : payment.subtract(interest, MC);
            remaining = remaining.subtract(principalPart, MC).max(BigDecimal.ZERO);
            totalInterest = totalInterest.add(interest, MC);
            rows.add(new Row(m, rupiah(principalPart.add(interest, MC)), rupiah(principalPart), rupiah(interest), rupiah(remaining)));
        }
        return new Result(principal, tenor, first, floating, rupiah(totalInterest), rupiah(principal.add(totalInterest)), rows);
    }

    private static Result flatSchedule(Product p, BigDecimal principal, int tenor) {
        BigDecimal monthlyInterest = principal.multiply(p.fixedRate().divide(TWELVE_HUNDRED, MC), MC);
        BigDecimal monthlyPrincipal = principal.divide(BigDecimal.valueOf(tenor), MC);
        BigDecimal installment = rupiah(monthlyInterest.add(monthlyPrincipal));
        BigDecimal remaining = principal;
        List<Row> rows = new ArrayList<>(tenor);
        for (int m = 1; m <= tenor; m++) {
            remaining = m == tenor ? BigDecimal.ZERO : remaining.subtract(monthlyPrincipal, MC);
            rows.add(new Row(m, installment, rupiah(monthlyPrincipal), rupiah(monthlyInterest), rupiah(remaining)));
        }
        BigDecimal totalInterest = rupiah(monthlyInterest.multiply(BigDecimal.valueOf(tenor)));
        return new Result(principal, tenor, installment, null, totalInterest, rupiah(principal.add(totalInterest)), rows);
    }

    /**
     * Same schedule, but each row is derived independently: the balance after month m is replayed
     * from the original principal at audit precision, so any single row can be checked on its own.
     * Quadratic in the tenor — a 20-year KPR replays ~29,000 months at 1,000 digits.
     */
    private static Result auditSchedule(Product p, BigDecimal principal, int tenor) {
        Result standard = "ANNUITY".equals(p.method()) ? annuitySchedule(p, principal, tenor) : flatSchedule(p, principal, tenor);
        List<Row> rows = new ArrayList<>(tenor);
        BigDecimal before = principal;
        for (Row row : standard.schedule()) {
            BigDecimal after = row.month() == tenor ? BigDecimal.ZERO : balanceAfter(p, principal, tenor, row.month());
            BigDecimal principalPart = before.subtract(after, AUDIT_MC);
            rows.add(new Row(row.month(), row.installment(), rupiah(principalPart), row.interest(), rupiah(after)));
            before = after;
        }
        return new Result(principal, tenor, standard.firstInstallment(), standard.floatingInstallment(),
                standard.totalInterest(), standard.totalPayment(), rows);
    }

    /** Outstanding balance after `month` installments, replayed from month 1. */
    static BigDecimal balanceAfter(Product p, BigDecimal principal, int tenor, int month) {
        if (!"ANNUITY".equals(p.method())) {
            BigDecimal monthlyPrincipal = principal.divide(BigDecimal.valueOf(tenor), AUDIT_MC);
            BigDecimal remaining = principal;
            for (int m = 1; m <= month; m++) remaining = remaining.subtract(monthlyPrincipal, AUDIT_MC);
            return remaining;
        }
        int fixedMonths = Math.min(p.fixedPeriodMonths() == null ? tenor : p.fixedPeriodMonths(), tenor);
        BigDecimal remaining = principal;
        BigDecimal payment = annuity(principal, p.fixedRate(), tenor, AUDIT_MC);
        for (int m = 1; m <= month; m++) {
            BigDecimal rate = m <= fixedMonths ? p.fixedRate() : p.floatingRate();
            if (m == fixedMonths + 1) payment = annuity(remaining, rate, tenor - fixedMonths, AUDIT_MC);
            BigDecimal interest = remaining.multiply(rate.divide(TWELVE_HUNDRED, AUDIT_MC), AUDIT_MC);
            remaining = remaining.subtract(payment.subtract(interest, AUDIT_MC), AUDIT_MC).max(BigDecimal.ZERO);
        }
        return remaining;
    }

    /** Debt service ratio: (new installment + existing obligations) / monthly income. */
    public static BigDecimal dsr(BigDecimal installment, BigDecimal obligations, BigDecimal income) {
        if (income.signum() <= 0) return BigDecimal.valueOf(999);
        return installment.add(obligations).divide(income, 4, RoundingMode.HALF_UP);
    }

    /** Returns null when approved, otherwise the rejection reason. */
    public static String decide(String grade, BigDecimal dsr) {
        return switch (grade) {
            case "A", "B" -> dsr.compareTo(new BigDecimal("0.50")) <= 0 ? null : "DSR melebihi 50% dari penghasilan";
            case "C" -> dsr.compareTo(new BigDecimal("0.40")) <= 0 ? null : "DSR melebihi 40% untuk skor kredit kategori C";
            default -> "Skor kredit tidak memenuhi kebijakan";
        };
    }
}
