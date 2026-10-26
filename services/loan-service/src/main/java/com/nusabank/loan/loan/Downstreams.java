package com.nusabank.loan.loan;

import com.nusabank.loan.LoanProperties;
import com.nusabank.loan.web.ApiException;
import com.nusabank.loan.web.Money;
import datadog.trace.api.DDTags;
import io.opentracing.Scope;
import io.opentracing.Span;
import io.opentracing.Tracer;
import io.opentracing.util.GlobalTracer;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/** account-service (ownership of the disbursement account) and the credit bureau (partner-mock). */
@Component
public class Downstreams {
    public static final String PARTNER_BUREAU = "credit-bureau";
    public static final String PARTNER_ACCOUNT = "account-service";

    public record AccountRef(String accountNumber, String cif, String ownerName, String currency, String status) {}

    public record CreditCheck(int score, String grade, Money existingMonthlyObligations, String checkedAt) {}

    private final RestClient accounts;
    private final RestClient bureau;

    public Downstreams(RestClient.Builder builder, LoanProperties props) {
        this.accounts = builder.clone().baseUrl(props.accountServiceUrl()).requestFactory(factory(Duration.ofSeconds(3))).build();
        // The bureau is slow even when healthy (~1s); the timeout leaves room without hanging the request.
        this.bureau = builder.clone().baseUrl(props.partnerMockUrl()).requestFactory(factory(Duration.ofSeconds(8))).build();
    }

    private static SimpleClientHttpRequestFactory factory(Duration read) {
        var f = new SimpleClientHttpRequestFactory();
        f.setConnectTimeout(Duration.ofSeconds(2));
        f.setReadTimeout(read);
        return f;
    }

    public AccountRef account(String number) {
        try {
            return accounts.get().uri("/internal/accounts/{n}", number).retrieve().body(AccountRef.class);
        } catch (HttpClientErrorException.NotFound e) {
            return null;
        } catch (RestClientException e) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "PARTNER_UNAVAILABLE", "Layanan rekening sedang tidak tersedia", PARTNER_ACCOUNT);
        }
    }

    /**
     * The bureau call runs inside a client span tagged peer.service, so the credit bureau shows
     * up as an inferred service of its own (Service Map: loan-service -> credit-bureau).
     */
    public CreditCheck creditCheck(String nik, BigDecimal requested) {
        Tracer tracer = GlobalTracer.get();
        Span span = tracer.buildSpan("partner.request")
                .withTag(DDTags.RESOURCE_NAME, PARTNER_BUREAU + " check")
                .withTag("peer.service", PARTNER_BUREAU)
                .withTag("partner.name", PARTNER_BUREAU)
                .withTag("span.kind", "client")
                .start();
        try (Scope ignored = tracer.activateSpan(span)) {
            return bureau.post().uri("/credit-bureau/v1/checks")
                    .body(Map.of("nik", nik, "requested_amount", Money.of(requested, "IDR")))
                    .retrieve().body(CreditCheck.class);
        } catch (RestClientException e) {
            span.setTag("error", true);
            span.setTag("error.message", e.getMessage());
            boolean timeout = e.getMostSpecificCause() instanceof java.net.SocketTimeoutException;
            throw new ApiException(timeout ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.BAD_GATEWAY,
                    timeout ? "PARTNER_TIMEOUT" : "PARTNER_UNAVAILABLE",
                    "Pemeriksaan kredit sedang tidak tersedia, pengajuan Anda tersimpan dan dapat dikirim ulang", PARTNER_BUREAU);
        } finally {
            span.finish();
        }
    }
}
