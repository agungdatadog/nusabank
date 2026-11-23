package com.nusabank.admin.ops;

import com.nusabank.admin.security.AuthInterceptor;
import com.nusabank.admin.security.JwtIssuer;
import com.nusabank.admin.security.JwtVerifier;
import com.nusabank.admin.tracing.Spans;
import com.nusabank.admin.web.ApiException;
import com.timgroup.statsd.StatsDClient;
import jakarta.servlet.http.HttpServletRequest;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;

/** Back-office console API (catalog/openapi.yaml, tag admin-service). Every action is audited. */
@RestController
@RequestMapping("/api/admin")
public class AdminController {
    private static final Logger log = LoggerFactory.getLogger(AdminController.class);
    private static final Pattern UUID_RE = Pattern.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");
    private static final Pattern ACCOUNT_RE = Pattern.compile("^\\d{16}$");
    private static final List<String> STATUSES = List.of("PROCESSING", "SUCCESS", "FAILED");
    private static final List<String> RAILS = List.of("INTRABANK", "BIFAST", "SKN");
    private static final Pattern BILLER_RE = Pattern.compile("^[a-z0-9-]{2,32}$");

    private final OperatorService operators;
    private final JwtIssuer issuer;
    private final AuditLog audit;
    private final Downstreams downstreams;
    private final StatsDClient statsd;

    public AdminController(OperatorService operators, JwtIssuer issuer, AuditLog audit, Downstreams downstreams, StatsDClient statsd) {
        this.operators = operators;
        this.issuer = issuer;
        this.audit = audit;
        this.downstreams = downstreams;
        this.statsd = statsd;
    }

    public record LoginRequest(String username, String password) {}

    @PostMapping("/login")
    Map<String, Object> login(@RequestBody LoginRequest req) {
        if (req == null || req.username() == null || req.password() == null) throw ApiException.badRequest("username and password are required");
        OperatorService.Operator op;
        try {
            op = operators.authenticate(req.username(), req.password());
        } catch (ApiException e) {
            statsd.incrementCounter("nusabank.admin.login.count", "result:failed");
            throw e;
        }
        Spans.setOperator(op.username());
        audit.record(op.username(), "LOGIN", op.username());
        statsd.incrementCounter("nusabank.admin.login.count", "result:success");
        return Map.of("access_token", issuer.issue(op.username(), op.fullName()), "expires_in", JwtIssuer.TTL_SECONDS,
                "operator", Map.of("username", op.username(), "full_name", op.fullName()));
    }

    private static String operator(HttpServletRequest req) {
        return ((JwtVerifier.Claims) req.getAttribute(AuthInterceptor.CLAIMS)).sub();
    }

    /** Name, email or CIF go to auth-service; a 16-digit account number is resolved to its owner first. */
    @GetMapping("/customers")
    JsonNode customers(@RequestParam String q, HttpServletRequest req) {
        String query = q.trim();
        if (query.length() < 3) throw ApiException.badRequest("q must be at least 3 characters");
        audit.record(operator(req), "CUSTOMER_SEARCH", query);
        if (ACCOUNT_RE.matcher(query).matches()) {
            String cif = downstreams.accountOwner(query);
            if (cif == null) return new ArrayNode(tools.jackson.databind.node.JsonNodeFactory.instance);
            query = cif;
        }
        return downstreams.searchCustomers(query);
    }

    @GetMapping("/transfers")
    JsonNode transfers(@RequestParam(required = false) String status, @RequestParam(required = false) String rail,
                       @RequestParam(required = false) OffsetDateTime since, HttpServletRequest req) {
        if (status != null && !STATUSES.contains(status)) throw ApiException.badRequest("status must be one of " + STATUSES);
        if (rail != null && !RAILS.contains(rail)) throw ApiException.badRequest("rail must be one of " + RAILS);
        audit.record(operator(req), "TRANSFER_LIST", "status=" + (status == null ? "*" : status) + " rail=" + (rail == null ? "*" : rail));
        return downstreams.transfers(status, rail, since == null ? null : since.toString());
    }

    @PostMapping("/transfers/{transferId}/retry")
    ResponseEntity<JsonNode> retry(@PathVariable String transferId, HttpServletRequest req) {
        if (!UUID_RE.matcher(transferId).matches()) throw ApiException.notFound("Transfer tidak ditemukan");
        String op = operator(req);
        Spans.tagRoot("transfer.id", transferId);
        // Audited before the attempt: an attempt that fails downstream was still an action.
        audit.record(op, "TRANSFER_RETRY", transferId);
        try {
            JsonNode t = downstreams.retry(transferId);
            String outcome = t.path("status").asString("UNKNOWN").toLowerCase();
            statsd.incrementCounter("nusabank.admin.transfer_retry.count", "outcome:" + outcome, "rail:" + t.path("rail").asString("").toLowerCase());
            log.info("transfer retried operator={} transfer_id={} outcome={}", op, transferId, outcome);
            return ResponseEntity.status(HttpStatus.ACCEPTED).body(t);
        } catch (ApiException e) {
            statsd.incrementCounter("nusabank.admin.transfer_retry.count", "outcome:" + e.code().toLowerCase(), "rail:unknown");
            throw e;
        }
    }

    @GetMapping("/rails")
    JsonNode rails() {
        return downstreams.rails();
    }

    public record RailAvailabilityRequest(Boolean available, String reason, Integer autoEnableAfterMinutes) {}

    /**
     * Takes BI FAST or SKN out of service, or puts it back. EP2's Workflow Automation calls this
     * as ops.otomasi when the rail's error monitor alerts; re-enabling is left to a person.
     */
    @PutMapping("/rails/{rail}/availability")
    JsonNode setRailAvailability(@PathVariable String rail, @RequestBody RailAvailabilityRequest body, HttpServletRequest req) {
        if (!"BIFAST".equals(rail) && !"SKN".equals(rail)) throw ApiException.notFound("Rail tidak dapat dinonaktifkan");
        if (body == null || body.available() == null) throw ApiException.badRequest("available is required");
        String reason = body.reason() == null ? "" : body.reason().trim();
        if (reason.length() > 200) throw ApiException.badRequest("reason must be at most 200 characters");
        String op = operator(req);
        Spans.tagRoot("rail.code", rail);
        Spans.tagRoot("rail.available", body.available().toString());
        audit.record(op, body.available() ? "RAIL_ENABLE" : "RAIL_DISABLE", reason.isEmpty() ? rail : rail + ": " + reason);
        Map<String, Object> change = new java.util.LinkedHashMap<>();
        change.put("available", body.available());
        change.put("changed_by", op);
        if (!reason.isEmpty()) change.put("reason", reason);
        if (body.autoEnableAfterMinutes() != null) change.put("auto_enable_after_minutes", body.autoEnableAfterMinutes());
        JsonNode result = downstreams.setRailAvailability(rail, change);
        statsd.incrementCounter("nusabank.admin.rail_change.count", "rail:" + rail.toLowerCase(), "available:" + body.available(), "operator:" + op);
        log.info("rail availability changed operator={} rail={} available={} reason={}", op, rail, body.available(), reason);
        return result;
    }

    @GetMapping("/billers")
    JsonNode billers() {
        return downstreams.billers();
    }

    /**
     * Takes a biller (e.g. GoPay) out of Top Up & Tagihan, or puts it back. Digital Channels runs
     * this through Datadog Workflow Automation during a partner outage; it acts as ops.otomasi.
     */
    @PutMapping("/billers/{billerCode}/availability")
    JsonNode setBillerAvailability(@PathVariable String billerCode, @RequestBody RailAvailabilityRequest body, HttpServletRequest req) {
        if (!BILLER_RE.matcher(billerCode).matches()) throw ApiException.notFound("Biller tidak ditemukan");
        if (body == null || body.available() == null) throw ApiException.badRequest("available is required");
        String reason = body.reason() == null ? "" : body.reason().trim();
        if (reason.length() > 200) throw ApiException.badRequest("reason must be at most 200 characters");
        String op = operator(req);
        Spans.tagRoot("biller.code", billerCode);
        Spans.tagRoot("biller.available", body.available().toString());
        audit.record(op, body.available() ? "BILLER_ENABLE" : "BILLER_DISABLE", reason.isEmpty() ? billerCode : billerCode + ": " + reason);
        Map<String, Object> change = new java.util.LinkedHashMap<>();
        change.put("available", body.available());
        change.put("changed_by", op);
        if (!reason.isEmpty()) change.put("reason", reason);
        if (body.autoEnableAfterMinutes() != null) change.put("auto_enable_after_minutes", body.autoEnableAfterMinutes());
        JsonNode result = downstreams.setBillerAvailability(billerCode, change);
        statsd.incrementCounter("nusabank.admin.biller_change.count", "biller:" + billerCode, "available:" + body.available(), "operator:" + op);
        log.info("biller availability changed operator={} biller={} available={} reason={}", op, billerCode, body.available(), reason);
        return result;
    }

    @GetMapping("/audit-log")
    List<AuditLog.Entry> auditLog(@RequestParam(defaultValue = "1") int page, @RequestParam(name = "page_size", defaultValue = "50") int pageSize) {
        return audit.page(Math.max(page, 1), Math.min(Math.max(pageSize, 1), 200));
    }
}
