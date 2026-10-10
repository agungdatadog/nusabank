package com.nusabank.loan.loan;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class LoanRepository {
    public record ProductRow(String code, String name, String interestMethod, BigDecimal fixedRate,
                             Integer fixedPeriodMonths, BigDecimal floatingRate, BigDecimal minPrincipal,
                             BigDecimal maxPrincipal, int minTenorMonths, int maxTenorMonths,
                             Integer minDownPaymentPercent, String requiredDocuments) {
        /** Comma-joined in SQL: JdbcClient's record mapping can't convert a Postgres text[]. */
        public List<String> documents() {
            return List.of(requiredDocuments.split(","));
        }

        Simulator.Product terms() {
            return new Simulator.Product(code, interestMethod, fixedRate, fixedPeriodMonths, floatingRate);
        }
    }

    public record ApplicationRow(UUID id, String cif, String productCode, String status, String nik,
                                 BigDecimal assetPrice, BigDecimal downPayment, BigDecimal principal, int tenorMonths,
                                 BigDecimal monthlyInstallment, BigDecimal monthlyIncome, String disbursementAccountNumber,
                                 Integer creditScore, String creditGrade, BigDecimal existingObligations,
                                 OffsetDateTime creditCheckedAt, String decisionReason, OffsetDateTime createdAt,
                                 OffsetDateTime decidedAt, OffsetDateTime disbursedAt) {}

    public record DocumentRow(UUID id, UUID applicationId, String documentType, OffsetDateTime uploadedAt) {}

    private static final String PRODUCT_COLUMNS = """
            code, name, interest_method, fixed_rate, fixed_period_months, floating_rate, min_principal, max_principal,
            min_tenor_months, max_tenor_months, min_down_payment_percent,
            array_to_string(required_documents, ',') AS required_documents""";

    private static final String APP_COLUMNS = """
            id, cif, product_code, status, nik, asset_price, down_payment, principal, tenor_months,
            monthly_installment, monthly_income, disbursement_account_number, credit_score, credit_grade,
            existing_obligations, credit_checked_at, decision_reason, created_at, decided_at, disbursed_at""";

    private final JdbcClient jdbc;

    public LoanRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public List<ProductRow> products() {
        return jdbc.sql("SELECT " + PRODUCT_COLUMNS + " FROM loan_products ORDER BY code").query(ProductRow.class).list();
    }

    public Optional<ProductRow> product(String code) {
        return jdbc.sql("SELECT " + PRODUCT_COLUMNS + " FROM loan_products WHERE code = :c").param("c", code).query(ProductRow.class).optional();
    }

    public ApplicationRow insert(String cif, String product, String nik, BigDecimal assetPrice, BigDecimal downPayment,
                                 BigDecimal principal, int tenor, BigDecimal installment, BigDecimal income,
                                 String employment, String collateral, String disbursementAccount) {
        return jdbc.sql("""
                INSERT INTO loan_applications (cif, product_code, nik, asset_price, down_payment, principal, tenor_months,
                  monthly_installment, monthly_income, employment_type, collateral_description, disbursement_account_number)
                VALUES (:cif, :p, :nik, :ap, :dp, :pr, :t, :i, :inc, :emp, :col, :acct)
                RETURNING""" + " " + APP_COLUMNS) // text blocks strip trailing spaces
                .param("cif", cif).param("p", product).param("nik", nik).param("ap", assetPrice).param("dp", downPayment)
                .param("pr", principal).param("t", tenor).param("i", installment).param("inc", income)
                .param("emp", employment).param("col", collateral).param("acct", disbursementAccount)
                .query(ApplicationRow.class).single();
    }

    public Optional<ApplicationRow> find(UUID id) {
        return jdbc.sql("SELECT " + APP_COLUMNS + " FROM loan_applications WHERE id = :id").param("id", id)
                .query(ApplicationRow.class).optional();
    }

    public Optional<ApplicationRow> findForUpdate(UUID id) {
        return jdbc.sql("SELECT " + APP_COLUMNS + " FROM loan_applications WHERE id = :id FOR UPDATE").param("id", id)
                .query(ApplicationRow.class).optional();
    }

    public List<ApplicationRow> byCif(String cif) {
        return jdbc.sql("SELECT " + APP_COLUMNS + " FROM loan_applications WHERE cif = :cif ORDER BY created_at DESC LIMIT 50")
                .param("cif", cif).query(ApplicationRow.class).list();
    }

    public List<DocumentRow> documents(UUID applicationId) {
        return jdbc.sql("SELECT id, application_id, document_type, uploaded_at FROM loan_documents WHERE application_id = :a ORDER BY uploaded_at")
                .param("a", applicationId).query(DocumentRow.class).list();
    }

    public DocumentRow addDocument(UUID applicationId, String type, String fileName, String contentType, byte[] content, String sha256) {
        return jdbc.sql("""
                INSERT INTO loan_documents (application_id, document_type, file_name, content_type, size_bytes, sha256, content)
                VALUES (:a, :t, :f, :ct, :sz, :sha, :c) RETURNING id, application_id, document_type, uploaded_at""")
                .param("a", applicationId).param("t", type).param("f", fileName).param("ct", contentType)
                .param("sz", content.length).param("sha", sha256).param("c", content)
                .query(DocumentRow.class).single();
    }

    public void recordCreditCheck(UUID id, int score, String grade, BigDecimal obligations) {
        jdbc.sql("""
                UPDATE loan_applications SET status = 'UNDER_REVIEW', credit_score = :s, credit_grade = :g,
                  existing_obligations = :o, credit_checked_at = now() WHERE id = :id""")
                .param("s", score).param("g", grade).param("o", obligations).param("id", id).update();
    }

    public void setStatus(UUID id, String status, String reason) {
        jdbc.sql("""
                UPDATE loan_applications SET status = :s, decision_reason = :r,
                  decided_at = CASE WHEN :s IN ('APPROVED', 'REJECTED') THEN now() ELSE decided_at END,
                  disbursed_at = CASE WHEN :s = 'DISBURSED' THEN now() ELSE disbursed_at END
                WHERE id = :id""")
                .param("s", status).param("r", reason).param("id", id).update();
    }
}
