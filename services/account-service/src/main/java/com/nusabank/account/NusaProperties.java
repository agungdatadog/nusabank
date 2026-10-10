package com.nusabank.account;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("nusabank")
public record NusaProperties(
        String jwtSecret,
        String partnerMockUrl,
        String seedFile,
        int fxCacheSeconds,
        int holdTtlMinutes) {
}
