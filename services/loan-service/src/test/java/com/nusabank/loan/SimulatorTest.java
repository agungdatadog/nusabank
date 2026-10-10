package com.nusabank.loan;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.nusabank.loan.loan.Simulator;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class SimulatorTest {
    private static final Simulator.Product KPR = new Simulator.Product("KPR", "ANNUITY", new BigDecimal("3.75"), 36, new BigDecimal("11.50"));
    private static final Simulator.Product KTA = new Simulator.Product("KTA", "FLAT", new BigDecimal("11.88"), null, null);

    @Test
    void kprAnnuityFullyAmortisesAndStepsUpAfterFixedPeriod() {
        var r = Simulator.simulate(KPR, new BigDecimal("675000000"), 180);
        assertEquals(180, r.schedule().size());
        assertEquals(BigDecimal.ZERO, r.schedule().get(179).remaining());
        // Rp675 juta over 15 years at 3.75%: ~Rp4.9 juta/month, rising once the floating rate applies.
        assertTrue(r.firstInstallment().compareTo(new BigDecimal("4800000")) > 0 && r.firstInstallment().compareTo(new BigDecimal("5000000")) < 0,
                "first installment " + r.firstInstallment());
        assertTrue(r.floatingInstallment().compareTo(r.firstInstallment()) > 0);
    }

    @Test
    void flatKtaHasConstantInstallment() {
        var r = Simulator.simulate(KTA, new BigDecimal("60000000"), 24);
        // 60jt / 24 = 2.5jt principal + 60jt * 0.99% = 594rb interest per month
        assertEquals(new BigDecimal("3094000"), r.firstInstallment());
        assertNull(r.floatingInstallment());
        assertEquals(new BigDecimal("14256000"), r.totalInterest());
    }

    @Test
    void decisionPolicy() {
        assertNull(Simulator.decide("A", new BigDecimal("0.45")));
        assertEquals("DSR melebihi 50% dari penghasilan", Simulator.decide("B", new BigDecimal("0.55")));
        assertNull(Simulator.decide("C", new BigDecimal("0.35")));
        assertTrue(Simulator.decide("C", new BigDecimal("0.45")).contains("40%"));
        assertTrue(Simulator.decide("E", new BigDecimal("0.10")).contains("Skor kredit"));
        assertEquals(new BigDecimal("0.4000"), Simulator.dsr(new BigDecimal("3000000"), new BigDecimal("1000000"), new BigDecimal("10000000")));
    }
}
