package com.nusabank.admin.ops;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/** Append-only record of operator actions (catalog/openapi.yaml#/components/schemas/AuditEntry). */
@Component
public class AuditLog {
    public record Entry(UUID id, String operator, String action, String target, OffsetDateTime createdAt) {}

    private final JdbcClient jdbc;

    public AuditLog(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public void record(String operator, String action, String target) {
        jdbc.sql("INSERT INTO audit_log (id, operator, action, target) VALUES (:id, :o, :a, :t)")
                .param("id", UUID.randomUUID()).param("o", operator).param("a", action).param("t", target).update();
    }

    public List<Entry> page(int page, int size) {
        return jdbc.sql("SELECT id, operator, action, target, created_at FROM audit_log ORDER BY created_at DESC LIMIT :l OFFSET :o")
                .param("l", size).param("o", (page - 1) * size).query(Entry.class).list();
    }
}
