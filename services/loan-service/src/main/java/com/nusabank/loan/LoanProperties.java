package com.nusabank.loan;

import com.nusabank.loan.loan.Simulator;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("nusabank")
/** scheduleMode: STANDARD, or AUDIT (each row recomputed from the principal; EP2 Profiler drill, off by default). */
public record LoanProperties(String jwtSecret, String partnerMockUrl, String accountServiceUrl, Simulator.Mode scheduleMode) {
}
