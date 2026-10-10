package com.nusabank.account.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class MoneyTest {
    @Test
    void formatsPerCurrencyScale() {
        assertEquals("1500000", Money.of(new BigDecimal("1500000.00"), "IDR").amount());
        assertEquals("1250.50", Money.of(new BigDecimal("1250.5"), "USD").amount());
        assertEquals("98000", Money.of(new BigDecimal("98000"), "JPY").amount());
    }

    @Test
    void validatesContractShape() {
        assertTrue(new Money("250000", "IDR").valid());
        assertTrue(new Money("12.34", "USD").valid());
        assertFalse(new Money("-5", "IDR").valid());
        assertFalse(new Money("1.234", "USD").valid());
        assertFalse(new Money("100", "EUR").valid());
        assertFalse(new Money(null, "IDR").valid());
    }
}
