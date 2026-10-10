package com.nusabank.loan;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("nusabank")
public record LoanProperties(String jwtSecret, String partnerMockUrl, String accountServiceUrl) {
}
