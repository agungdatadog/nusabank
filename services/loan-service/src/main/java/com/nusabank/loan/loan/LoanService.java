package com.nusabank.loan.loan;

import com.nusabank.loan.tracing.Spans;
import com.nusabank.loan.web.ApiException;
import com.nusabank.loan.web.Money;
import com.timgroup.statsd.StatsDClient;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class LoanService {
    private static final Logger log = LoggerFactory.getLogger(LoanService.class);
    static final String TOPIC_DISBURSEMENT = "loan.disbursement.v1";
    private static final Set<String> DOC_TYPES = Set.of("KTP", "NPWP", "SLIP_GAJI", "REKENING_KORAN", "SERTIFIKAT", "SPK_DEALER");

    private final LoanRepository repo;
    private final Downstreams downstreams;
    private final KafkaTemplate<String, String> kafka;
    private final ObjectMapper mapper;
    private final StatsDClient statsd;

    public LoanService(LoanRepository repo, Downstreams downstreams, KafkaTemplate<String, String> kafka,
                       ObjectMapper mapper, StatsDClient statsd) {
        this.repo = repo;
        this.downstreams = downstreams;
        this.kafka = kafka;
        this.mapper = mapper;
        this.statsd = statsd;
    }

    /** Validated loan terms: principal after down payment, within product limits. */
    public record Terms(LoanRepository.ProductRow product, BigDecimal assetPrice, BigDecimal downPayment,
                        BigDecimal principal, int tenor) {}

    public Terms terms(String productCode, Money assetPrice, Money downPayment, Integer tenor) {
        var p = repo.product(productCode == null ? "" : productCode)
                .orElseThrow(() -> ApiException.badRequest("product_code must be KPR, KKB or KTA"));
        if (assetPrice == null || !assetPrice.valid() || !"IDR".equals(assetPrice.currency())) {
            throw ApiException.badRequest("asset_price must be an IDR amount");
        }
        if (tenor == null) throw ApiException.badRequest("tenor_months is required");
        BigDecimal price = assetPrice.value();
        BigDecimal dp = downPayment == null ? BigDecimal.ZERO : downPayment.value();
        if (downPayment != null && (!downPayment.valid() || !"IDR".equals(downPayment.currency()))) {
            throw ApiException.badRequest("down_payment must be an IDR amount");
        }
        if (p.minDownPaymentPercent() != null) {
            BigDecimal minDp = price.multiply(BigDecimal.valueOf(p.minDownPaymentPercent())).divide(BigDecimal.valueOf(100), 0, RoundingMode.UP);
            if (dp.compareTo(minDp) < 0) {
                throw new ApiException(HttpStatus.UNPROCESSABLE_CONTENT, "DOWN_PAYMENT_TOO_LOW",
                        "Uang muka minimal " + p.minDownPaymentPercent() + "% dari harga");
            }
        }
        BigDecimal principal = price.subtract(dp);
        if (principal.compareTo(p.minPrincipal()) < 0 || principal.compareTo(p.maxPrincipal()) > 0) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_CONTENT, "PRINCIPAL_OUT_OF_RANGE", "Plafon di luar batas produk " + p.name());
        }
        if (tenor < p.minTenorMonths() || tenor > p.maxTenorMonths()) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_CONTENT, "TENOR_OUT_OF_RANGE",
                    "Tenor " + p.name() + " antara " + p.minTenorMonths() + " dan " + p.maxTenorMonths() + " bulan");
        }
        return new Terms(p, price, dp, principal, tenor);
    }

    public Simulator.Result simulate(Terms t) {
        statsd.incrementCounter("nusabank.loan.simulation.count", "product:" + t.product().code().toLowerCase());
        return Simulator.simulate(t.product().terms(), t.principal(), t.tenor());
    }

    @Transactional
    public LoanRepository.ApplicationRow create(String cif, Terms t, String nik, Money income, String employment,
                                                String collateral, String disbursementAccount) {
        if (nik == null || !nik.matches("\\d{16}")) throw ApiException.badRequest("nik must be 16 digits");
        if (income == null || !income.valid() || !"IDR".equals(income.currency()) || income.value().signum() <= 0) {
            throw ApiException.badRequest("monthly_income must be a positive IDR amount");
        }
        var acct = downstreams.account(disbursementAccount);
        if (acct == null || !cif.equals(acct.cif()) || !"IDR".equals(acct.currency()) || !"ACTIVE".equals(acct.status())) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_CONTENT, "ACCOUNT_NOT_ELIGIBLE", "Rekening pencairan harus rekening IDR aktif milik Anda");
        }
        var installment = Simulator.simulate(t.product().terms(), t.principal(), t.tenor()).firstInstallment();
        var app = repo.insert(cif, t.product().code(), nik, t.assetPrice(), t.downPayment(), t.principal(), t.tenor(),
                installment, income.value(), employment, collateral, disbursementAccount);
        countStage(app, "draft");
        return app;
    }

    public LoanRepository.ApplicationRow owned(String cif, UUID id) {
        return repo.find(id).filter(a -> a.cif().equals(cif)).orElseThrow(() -> ApiException.notFound("Pengajuan tidak ditemukan"));
    }

    public LoanRepository.DocumentRow upload(String cif, UUID id, String type, String fileName, String contentType, byte[] content) {
        var app = owned(cif, id);
        if (!"DRAFT".equals(app.status())) throw new ApiException(HttpStatus.CONFLICT, "ALREADY_SUBMITTED", "Pengajuan sudah dikirim");
        if (!DOC_TYPES.contains(type)) throw ApiException.badRequest("document_type is not a known document");
        if (content.length == 0) throw ApiException.badRequest("file is empty");
        try {
            String sha = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
            return repo.addDocument(id, type, fileName == null ? type : fileName, contentType == null ? "application/octet-stream" : contentType, content, sha);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /**
     * Credit check -> decision -> (approved) disbursement. The disbursement event is published
     * before commit; if Kafka is down the request fails and the application stays UNDER_REVIEW,
     * safe to re-submit. Event id is derived from the application id, so a retry can't double-pay.
     */
    @Transactional(noRollbackFor = ApiException.class)
    public LoanRepository.ApplicationRow submit(String cif, UUID id) throws Exception {
        var app = repo.findForUpdate(id).filter(a -> a.cif().equals(cif)).orElseThrow(() -> ApiException.notFound("Pengajuan tidak ditemukan"));
        if (!"DRAFT".equals(app.status()) && !"UNDER_REVIEW".equals(app.status())) {
            throw new ApiException(HttpStatus.CONFLICT, "ALREADY_SUBMITTED", "Pengajuan sudah diproses");
        }
        var product = repo.product(app.productCode()).orElseThrow();
        var uploaded = repo.documents(id).stream().map(LoanRepository.DocumentRow::documentType).toList();
        var missing = product.documents().stream().filter(d -> !uploaded.contains(d)).toList();
        if (!missing.isEmpty()) {
            throw new ApiException(HttpStatus.CONFLICT, "DOCUMENTS_MISSING", "Dokumen belum lengkap: " + String.join(", ", missing));
        }
        if ("DRAFT".equals(app.status())) {
            repo.setStatus(id, "SUBMITTED", null);
            countStage(app, "submitted");
        }
        Spans.tagRoot("loan.product", app.productCode());
        Spans.tagRoot("loan.application_id", id.toString());

        var check = downstreams.creditCheck(app.nik(), app.principal());
        BigDecimal obligations = check.existingMonthlyObligations() == null ? BigDecimal.ZERO : check.existingMonthlyObligations().value();
        repo.recordCreditCheck(id, check.score(), check.grade(), obligations);
        BigDecimal dsr = Simulator.dsr(app.monthlyInstallment(), obligations, app.monthlyIncome());
        String reason = Simulator.decide(check.grade(), dsr);
        Spans.tagRoot("loan.credit_grade", check.grade());

        if (reason != null) {
            repo.setStatus(id, "REJECTED", reason);
            countStage(app, "rejected");
            log.info("loan rejected application={} product={} grade={} dsr={}", id, app.productCode(), check.grade(), dsr);
            return repo.find(id).orElseThrow();
        }
        repo.setStatus(id, "APPROVED", "Disetujui: skor " + check.score() + " (" + check.grade() + "), DSR " + dsr.movePointRight(2).setScale(0, RoundingMode.HALF_UP) + "%");
        countStage(app, "approved");

        Map<String, Object> event = new LinkedHashMap<>();
        event.put("event_id", UUID.nameUUIDFromBytes(("disbursement:" + id).getBytes(StandardCharsets.UTF_8)).toString());
        event.put("event_type", "loan.disbursed");
        event.put("occurred_at", Instant.now().toString());
        event.put("producer", "nusabank-loan");
        event.put("application_id", id.toString());
        event.put("cif", cif);
        event.put("product_code", app.productCode());
        event.put("disbursement_account_number", app.disbursementAccountNumber());
        event.put("principal", Money.of(app.principal(), "IDR"));
        kafka.send(TOPIC_DISBURSEMENT, id.toString(), mapper.writeValueAsString(event)).get(10, TimeUnit.SECONDS);
        repo.setStatus(id, "DISBURSED", repo.find(id).orElseThrow().decisionReason());
        countStage(app, "disbursed");
        log.info("loan disbursed application={} product={} principal={}", id, app.productCode(), app.principal());
        return repo.find(id).orElseThrow();
    }

    private void countStage(LoanRepository.ApplicationRow app, String stage) {
        String[] tags = {"product:" + app.productCode().toLowerCase(), "stage:" + stage};
        statsd.incrementCounter("nusabank.loan.application.count", tags);
        statsd.distribution("nusabank.loan.application.amount", app.principal().doubleValue(), tags);
    }
}
