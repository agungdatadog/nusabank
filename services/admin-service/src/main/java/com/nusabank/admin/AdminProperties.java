package com.nusabank.admin;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("nusabank")
public record AdminProperties(String jwtSecret, String operatorPassword, String authServiceUrl,
                              String accountServiceUrl, String paymentServiceUrl) {
}
