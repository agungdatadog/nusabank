package com.nusabank.loan.loan;

import com.nusabank.loan.security.AuthInterceptor;
import com.nusabank.loan.security.JwtVerifier;
import com.nusabank.loan.web.ApiException;
import com.nusabank.loan.web.Money;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** catalog/openapi.yaml — loan-service paths. */
@RestController
@RequestMapping("/api/loans")
public class LoanController {
    private final LoanRepository repo;
    private final LoanService loans;

    public LoanController(LoanRepository repo, LoanService loans) {
        this.repo = repo;
        this.loans = loans;
    }

    public record ProductView(String code, String name, String interestMethod, String fixedRate, Integer fixedPeriodMonths,
                              String floatingRate, Money minPrincipal, Money maxPrincipal, int minTenorMonths,
                              int maxTenorMonths, Integer minDownPaymentPercent, List<String> requiredDocuments) {}

    public record SimulationRequest(String productCode, Money assetPrice, Money downPayment, Integer tenorMonths, Boolean includeSchedule) {}

    public record ScheduleRow(int month, String installment, String principal, String interest, String remaining) {}

    public record SimulationView(String productCode, Money principal, int tenorMonths, Money firstInstallment,
                                 Money floatingInstallment, Money totalInterest, Money totalPayment, List<ScheduleRow> schedule) {}

    public record ApplicationRequest(String productCode, Money assetPrice, Money downPayment, Integer tenorMonths,
                                     String disbursementAccountNumber, Money monthlyIncome, String employmentType,
                                     String collateralDescription, String nik) {}

    public record DocumentView(String id, String documentType, OffsetDateTime uploadedAt) {}

    public record CreditCheckView(int score, String grade, Money existingMonthlyObligations, OffsetDateTime checkedAt) {}

    public record ApplicationView(String id, String productCode, String status, Money principal, int tenorMonths,
                                  Money monthlyInstallment, String disbursementAccountNumber, List<DocumentView> documents,
                                  CreditCheckView creditCheck, String decisionReason, OffsetDateTime createdAt,
                                  OffsetDateTime decidedAt, OffsetDateTime disbursedAt) {}

    private ApplicationView view(LoanRepository.ApplicationRow a) {
        var docs = repo.documents(a.id()).stream().map(d -> new DocumentView(d.id().toString(), d.documentType(), d.uploadedAt())).toList();
        var check = a.creditScore() == null ? null : new CreditCheckView(a.creditScore(), a.creditGrade(),
                Money.of(a.existingObligations(), "IDR"), a.creditCheckedAt());
        return new ApplicationView(a.id().toString(), a.productCode(), a.status(), Money.of(a.principal(), "IDR"), a.tenorMonths(),
                Money.of(a.monthlyInstallment(), "IDR"), a.disbursementAccountNumber(), docs, check, a.decisionReason(),
                a.createdAt(), a.decidedAt(), a.disbursedAt());
    }

    private static UUID uuid(String id) {
        try {
            return UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            throw ApiException.notFound("Pengajuan tidak ditemukan");
        }
    }

    @GetMapping("/products")
    List<ProductView> products() {
        return repo.products().stream().map(p -> new ProductView(p.code(), p.name(), p.interestMethod(),
                p.fixedRate().toPlainString(), p.fixedPeriodMonths(), p.floatingRate() == null ? null : p.floatingRate().toPlainString(),
                Money.of(p.minPrincipal(), "IDR"), Money.of(p.maxPrincipal(), "IDR"), p.minTenorMonths(), p.maxTenorMonths(),
                p.minDownPaymentPercent(), p.documents())).toList();
    }

    @PostMapping("/simulations")
    SimulationView simulate(@RequestBody SimulationRequest req) {
        var terms = loans.terms(req.productCode(), req.assetPrice(), req.downPayment(), req.tenorMonths());
        var r = loans.simulate(terms);
        boolean schedule = req.includeSchedule() == null || req.includeSchedule();
        return new SimulationView(terms.product().code(), Money.of(r.principal(), "IDR"), r.tenorMonths(),
                Money.of(r.firstInstallment(), "IDR"), r.floatingInstallment() == null ? null : Money.of(r.floatingInstallment(), "IDR"),
                Money.of(r.totalInterest(), "IDR"), Money.of(r.totalPayment(), "IDR"),
                schedule ? r.schedule().stream().map(s -> new ScheduleRow(s.month(), s.installment().toPlainString(),
                        s.principal().toPlainString(), s.interest().toPlainString(), s.remaining().toPlainString())).toList() : null);
    }

    @GetMapping("/applications")
    List<ApplicationView> list(@RequestAttribute(AuthInterceptor.CLAIMS) JwtVerifier.Claims claims) {
        return repo.byCif(claims.sub()).stream().map(this::view).toList();
    }

    @PostMapping("/applications")
    ResponseEntity<ApplicationView> create(@RequestAttribute(AuthInterceptor.CLAIMS) JwtVerifier.Claims claims,
                                           @RequestBody ApplicationRequest req) {
        var terms = loans.terms(req.productCode(), req.assetPrice(), req.downPayment(), req.tenorMonths());
        if (req.disbursementAccountNumber() == null || !req.disbursementAccountNumber().matches("\\d{16}")) {
            throw ApiException.badRequest("disbursement_account_number must be 16 digits");
        }
        var app = loans.create(claims.sub(), terms, req.nik(), req.monthlyIncome(), req.employmentType(),
                req.collateralDescription(), req.disbursementAccountNumber());
        return ResponseEntity.status(HttpStatus.CREATED).body(view(app));
    }

    @GetMapping("/applications/{applicationId}")
    ApplicationView get(@RequestAttribute(AuthInterceptor.CLAIMS) JwtVerifier.Claims claims, @PathVariable String applicationId) {
        return view(loans.owned(claims.sub(), uuid(applicationId)));
    }

    @PostMapping("/applications/{applicationId}/documents")
    ResponseEntity<DocumentView> upload(@RequestAttribute(AuthInterceptor.CLAIMS) JwtVerifier.Claims claims,
                                        @PathVariable String applicationId,
                                        @RequestParam("document_type") String documentType,
                                        @RequestParam("file") MultipartFile file) throws java.io.IOException {
        var d = loans.upload(claims.sub(), uuid(applicationId), documentType, file.getOriginalFilename(), file.getContentType(), file.getBytes());
        return ResponseEntity.status(HttpStatus.CREATED).body(new DocumentView(d.id().toString(), d.documentType(), d.uploadedAt()));
    }

    @PostMapping("/applications/{applicationId}/submit")
    ApplicationView submit(@RequestAttribute(AuthInterceptor.CLAIMS) JwtVerifier.Claims claims, @PathVariable String applicationId)
            throws Exception {
        return view(loans.submit(claims.sub(), uuid(applicationId)));
    }
}
