package com.nusabank.admin.ops;

import com.nusabank.admin.AdminProperties;
import com.nusabank.admin.web.ApiException;
import java.time.Duration;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * The services that own the data: auth-service (customers), account-service (accounts),
 * payment-service (transfers), biller-service (biller availability). admin-service never reads their databases. Bodies are
 * passed through as JSON so the shapes stay exactly those of catalog/openapi.yaml.
 */
@Component
public class Downstreams {
    static final String AUTH = "auth-service";
    static final String ACCOUNT = "account-service";
    static final String PAYMENT = "payment-service";
    static final String BILLER = "biller-service";

    private final RestClient auth;
    private final RestClient accounts;
    private final RestClient payments;
    private final RestClient billers;
    private final ObjectMapper mapper;

    public Downstreams(RestClient.Builder builder, AdminProperties props, ObjectMapper mapper) {
        this.auth = builder.clone().baseUrl(props.authServiceUrl()).requestFactory(factory(Duration.ofSeconds(3))).build();
        this.accounts = builder.clone().baseUrl(props.accountServiceUrl()).requestFactory(factory(Duration.ofSeconds(3))).build();
        // A retry waits for the rail like a customer transfer does.
        this.payments = builder.clone().baseUrl(props.paymentServiceUrl()).requestFactory(factory(Duration.ofSeconds(15))).build();
        this.billers = builder.clone().baseUrl(props.billerServiceUrl()).requestFactory(factory(Duration.ofSeconds(3))).build();
        this.mapper = mapper;
    }

    private static SimpleClientHttpRequestFactory factory(Duration read) {
        var f = new SimpleClientHttpRequestFactory();
        f.setConnectTimeout(Duration.ofSeconds(2));
        f.setReadTimeout(read);
        return f;
    }

    private static ApiException down(String partner) {
        return new ApiException(HttpStatus.BAD_GATEWAY, "PARTNER_UNAVAILABLE", partner + " sedang tidak tersedia", partner);
    }

    public JsonNode searchCustomers(String q) {
        try {
            return auth.get().uri(u -> u.path("/internal/customers").queryParam("q", q).build()).retrieve().body(JsonNode.class);
        } catch (RestClientException e) {
            throw down(AUTH);
        }
    }

    /** CIF of an account, or null when the account doesn't exist. */
    public String accountOwner(String accountNumber) {
        try {
            JsonNode ref = accounts.get().uri("/internal/accounts/{n}", accountNumber).retrieve().body(JsonNode.class);
            return ref == null ? null : ref.path("cif").asString();
        } catch (HttpClientErrorException.NotFound e) {
            return null;
        } catch (RestClientException e) {
            throw down(ACCOUNT);
        }
    }

    public JsonNode transfers(String status, String rail, String since) {
        try {
            return payments.get().uri(u -> u.path("/internal/transfers")
                            .queryParamIfPresent("status", java.util.Optional.ofNullable(status))
                            .queryParamIfPresent("rail", java.util.Optional.ofNullable(rail))
                            .queryParamIfPresent("since", java.util.Optional.ofNullable(since))
                            .queryParam("limit", 200).build())
                    .retrieve().body(JsonNode.class);
        } catch (HttpClientErrorException.BadRequest e) {
            throw ApiException.badRequest(message(e));
        } catch (RestClientException e) {
            throw down(PAYMENT);
        }
    }

    /**
     * payment-service's own answers pass through: 404, 409 (not retryable), 422 (new hold
     * rejected), and 502/503 naming the rail that is still down.
     */
    public JsonNode retry(String transferId) {
        try {
            return payments.post().uri("/internal/transfers/{id}/retry", transferId).retrieve().body(JsonNode.class);
        } catch (HttpStatusCodeException e) {
            JsonNode err = parse(e);
            int code = e.getStatusCode().value();
            if (code == 404 || code == 409 || code == 422 || code == 502 || code == 503) {
                throw new ApiException(HttpStatus.valueOf(code), err.path("code").asString("PARTNER_UNAVAILABLE"),
                        err.path("message").asString("Transfer tidak dapat diulang"),
                        err.hasNonNull("partner") ? err.path("partner").asString() : null);
            }
            throw down(PAYMENT);
        } catch (RestClientException e) {
            throw down(PAYMENT);
        }
    }

    public JsonNode rails() {
        try {
            return payments.get().uri("/internal/rails").retrieve().body(JsonNode.class);
        } catch (RestClientException e) {
            throw down(PAYMENT);
        }
    }

    /** Validation answers (400, 404) pass through; anything else means payment-service is down. */
    public JsonNode setRailAvailability(String rail, java.util.Map<String, Object> change) {
        try {
            return payments.put().uri("/internal/rails/{rail}/availability", rail).body(change).retrieve().body(JsonNode.class);
        } catch (HttpClientErrorException.BadRequest e) {
            throw ApiException.badRequest(message(e));
        } catch (HttpClientErrorException.NotFound e) {
            throw ApiException.notFound(parse(e).path("message").asString("Rail tidak ditemukan"));
        } catch (RestClientException e) {
            throw down(PAYMENT);
        }
    }

    public JsonNode billers() {
        try {
            return billers.get().uri("/internal/billers").retrieve().body(JsonNode.class);
        } catch (RestClientException e) {
            throw down(BILLER);
        }
    }

    /** Validation answers (400, 404) pass through; anything else means biller-service is down. */
    public JsonNode setBillerAvailability(String billerCode, java.util.Map<String, Object> change) {
        try {
            return billers.put().uri("/internal/billers/{code}/availability", billerCode).body(change).retrieve().body(JsonNode.class);
        } catch (HttpClientErrorException.BadRequest e) {
            throw ApiException.badRequest(message(e));
        } catch (HttpClientErrorException.NotFound e) {
            throw ApiException.notFound(parse(e).path("message").asString("Biller tidak ditemukan"));
        } catch (RestClientException e) {
            throw down(BILLER);
        }
    }

    private JsonNode parse(HttpStatusCodeException e) {
        try {
            return mapper.readTree(e.getResponseBodyAsString());
        } catch (Exception ignored) {
            return mapper.createObjectNode();
        }
    }

    private String message(HttpStatusCodeException e) {
        return parse(e).path("message").asString("Permintaan tidak valid");
    }
}
