package com.nusabank.account.fx;

import com.nusabank.account.NusaProperties;
import com.nusabank.account.web.ApiException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import tools.jackson.databind.ObjectMapper;

/**
 * Counter rates from the FX feed (partner-mock), cached in Redis. A cache miss is a
 * visible downstream call in APM; an FX outage is a 502 that names the partner.
 */
@Service
public class FxService {
    private static final Logger log = LoggerFactory.getLogger(FxService.class);
    private static final String CACHE_KEY = "account:fx:rates";
    private static final String PARTNER = "fx";

    public record Rate(String currency, String buy, String sell) {}

    public record FxRates(String base, OffsetDateTime asOf, List<Rate> rates) {}

    private final RestClient client;
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;
    private final Duration ttl;

    public FxService(RestClient.Builder builder, NusaProperties props, StringRedisTemplate redis, ObjectMapper mapper) {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(2));
        factory.setReadTimeout(Duration.ofSeconds(3));
        this.client = builder.baseUrl(props.partnerMockUrl()).requestFactory(factory).build();
        this.redis = redis;
        this.mapper = mapper;
        this.ttl = Duration.ofSeconds(props.fxCacheSeconds());
    }

    public FxRates rates() {
        String cached = readCache();
        if (cached != null) return mapper.readValue(cached, FxRates.class);
        FxRates fresh;
        try {
            fresh = client.get().uri("/fx/v1/rates").retrieve().body(FxRates.class);
        } catch (RestClientException e) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "PARTNER_UNAVAILABLE", "Kurs valas sedang tidak tersedia", PARTNER);
        }
        writeCache(mapper.writeValueAsString(fresh));
        return fresh;
    }

    /** Mid rates for portfolio totals; an FX outage degrades the total rather than failing the page. */
    public Map<String, BigDecimal> midRatesOrEmpty() {
        try {
            Map<String, BigDecimal> mid = new HashMap<>();
            for (Rate r : rates().rates()) {
                mid.put(r.currency(), new BigDecimal(r.buy()).add(new BigDecimal(r.sell())).divide(BigDecimal.TWO, 4, RoundingMode.HALF_EVEN));
            }
            return mid;
        } catch (ApiException e) {
            log.warn("FX unavailable, total balance shown without foreign-currency products partner={}", PARTNER);
            return Map.of();
        }
    }

    // Redis is a cache: if it's down we still serve from the partner.
    private String readCache() {
        try {
            return redis.opsForValue().get(CACHE_KEY);
        } catch (RuntimeException e) {
            log.warn("redis read failed, bypassing FX cache: {}", e.getMessage());
            return null;
        }
    }

    private void writeCache(String value) {
        try {
            redis.opsForValue().set(CACHE_KEY, value, ttl);
        } catch (RuntimeException e) {
            log.warn("redis write failed: {}", e.getMessage());
        }
    }
}
