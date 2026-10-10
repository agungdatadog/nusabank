package com.nusabank.account.account;

import com.nusabank.account.web.Money;
import java.math.BigDecimal;
import java.time.LocalDate;

/** catalog/openapi.yaml#/components/schemas/Account. */
public record AccountView(String accountNumber, String productType, String productName, String currency,
                          Money balance, Money availableBalance, String status, LocalDate openedAt,
                          Money creditLimit, LocalDate maturityDate, String interestRate) {

    static AccountView of(AccountRepository.AccountRow a) {
        BigDecimal available = "CREDIT_CARD".equals(a.productType()) && a.creditLimit() != null
                ? a.creditLimit().subtract(a.balance())
                : a.balance().subtract(a.held());
        return new AccountView(a.accountNumber(), a.productType(), a.productName(), a.currency(),
                Money.of(a.balance(), a.currency()), Money.of(available, a.currency()), a.status(), a.openedAt(),
                a.creditLimit() == null ? null : Money.of(a.creditLimit(), a.currency()), a.maturityDate(),
                a.interestRate() == null ? null : a.interestRate().toPlainString());
    }
}
