package com.nusabank.account.web;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** catalog/openapi.yaml#/components/schemas/Money — a decimal string, never a float. */
public record Money(String amount, String currency) {

    public static Money of(BigDecimal value, String currency) {
        int scale = "USD".equals(currency) ? 2 : 0;
        return new Money(value.setScale(scale, RoundingMode.HALF_EVEN).toPlainString(), currency);
    }

    public BigDecimal value() {
        return new BigDecimal(amount);
    }

    public boolean valid() {
        return amount != null && amount.matches("^\\d+(\\.\\d{1,2})?$")
                && ("IDR".equals(currency) || "USD".equals(currency) || "JPY".equals(currency));
    }
}
