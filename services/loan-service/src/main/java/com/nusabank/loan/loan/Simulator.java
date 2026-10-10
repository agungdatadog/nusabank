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
        if (months <= 0) return BigDecimal.ZERO;
        BigDecimal r = annualRate.divide(TWELVE_HUNDRED, MC);
        if (r.signum() == 0) return principal.divide(BigDecimal.valueOf(months), MC);
        BigDecimal factor = BigDecimal.ONE.add(r).pow(-months, MC);
        return principal.multiply(r, MC).divide(BigDecimal.ONE.subtract(factor, MC), MC);
    }

    public static Result simulate(Product p, BigDecimal principal, int tenor) {
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
