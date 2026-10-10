package com.nusabank.loan;

import com.timgroup.statsd.NonBlockingStatsDClientBuilder;
import com.timgroup.statsd.StatsDClient;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
@ConfigurationPropertiesScan
public class LoanServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(LoanServiceApplication.class, args);
    }

    /** DogStatsD over UDP to the node agent (hostip admission mode sets DD_AGENT_HOST). */
    @Bean(destroyMethod = "close")
    StatsDClient statsd() {
        String host = System.getenv().getOrDefault("DD_AGENT_HOST", "localhost");
        return new NonBlockingStatsDClientBuilder()
                .hostname(host)
                .port(8125)
                .constantTags(
                        "env:" + System.getenv().getOrDefault("DD_ENV", "demo"),
                        "service:" + System.getenv().getOrDefault("DD_SERVICE", "nusabank-loan"),
                        "version:" + System.getenv().getOrDefault("DD_VERSION", "unknown"))
                .build();
    }
}
