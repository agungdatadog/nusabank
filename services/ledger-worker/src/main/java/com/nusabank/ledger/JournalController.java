package com.nusabank.ledger;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Read-only journal lookup for admin-service, plus probes. Cluster-only. */
@RestController
public class JournalController {
    private final JdbcClient jdbc;

    public JournalController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    record EntryRow(UUID journalId, String sourceTopic, OffsetDateTime postedAt, String glAccount, String direction,
                    BigDecimal amount, String currency) {}

    @GetMapping("/internal/ledger/journals")
    List<Map<String, Object>> journals(@RequestParam String reference) {
        var rows = jdbc.sql("""
                SELECT j.id AS journal_id, j.source_topic, j.posted_at, e.gl_account, e.direction, e.amount, e.currency
                FROM journals j JOIN entries e ON e.journal_id = j.id
                WHERE j.reference = :ref ORDER BY j.posted_at, e.line""")
                .param("ref", reference).query(EntryRow.class).list();
        Map<UUID, Map<String, Object>> byJournal = new LinkedHashMap<>();
        for (var r : rows) {
            var j = byJournal.computeIfAbsent(r.journalId(), id -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", id.toString());
                m.put("reference", reference);
                m.put("source_topic", r.sourceTopic());
                m.put("posted_at", r.postedAt());
                m.put("entries", new ArrayList<Map<String, Object>>());
                return m;
            });
            @SuppressWarnings("unchecked")
            var entries = (List<Map<String, Object>>) j.get("entries");
            entries.add(Map.of("gl_account", r.glAccount(), "direction", r.direction(),
                    "amount", Map.of("amount", r.amount().toPlainString(), "currency", r.currency())));
        }
        return new ArrayList<>(byJournal.values());
    }

    @GetMapping("/healthz")
    Map<String, String> healthz() {
        return Map.of("status", "ok");
    }

    @GetMapping("/readyz")
    ResponseEntity<Map<String, String>> readyz() {
        try {
            jdbc.sql("SELECT 1").query(Integer.class).single();
            return ResponseEntity.ok(Map.of("status", "ok"));
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("status", "db_unavailable"));
        }
    }
}
