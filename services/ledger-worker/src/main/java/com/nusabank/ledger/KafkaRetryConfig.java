package com.nusabank.ledger;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.ExponentialBackOff;

/**
 * Money events are never skipped. Spring's default gives up after 10 attempts and moves
 * on, silently dropping a posting; here a failing record blocks its partition and retries
 * with backoff (capped at 30s) until it succeeds or someone intervenes.
 */
@Configuration
public class KafkaRetryConfig {
    @Bean
    DefaultErrorHandler kafkaErrorHandler() {
        var backOff = new ExponentialBackOff(500, 2.0);
        backOff.setMaxInterval(30_000);
        backOff.setMaxElapsedTime(Long.MAX_VALUE);
        return new DefaultErrorHandler(backOff);
    }
}
