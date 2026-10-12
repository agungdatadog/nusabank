package com.nusabank.admin.ops;

import com.nusabank.admin.AdminProperties;
import com.nusabank.admin.web.ApiException;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

/** The seeded operator roster and password checks. */
@Service
public class OperatorService {
    private static final Logger log = LoggerFactory.getLogger(OperatorService.class);

    public record Operator(String username, String fullName) {}

    /** Fictional back-office staff: operations, payments desk and customer care. */
    static final List<Operator> ROSTER = List.of(
            new Operator("ops.rina", "Rina Kartika"),
            new Operator("ops.bayu", "Bayu Prasetyo"),
            new Operator("ops.dewi", "Dewi Anggraini"));

    private final JdbcClient jdbc;
    private final AdminProperties props;
    private final BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder(10);

    public OperatorService(JdbcClient jdbc, AdminProperties props) {
        this.jdbc = jdbc;
        this.props = props;
    }

    // Idempotent: existing operators keep their hash, so a restart never resets anything.
    @EventListener(ApplicationReadyEvent.class)
    public void seed() {
        String hash = bcrypt.encode(props.operatorPassword());
        int inserted = 0;
        for (Operator o : ROSTER) {
            inserted += jdbc.sql("INSERT INTO operators (username, full_name, password_hash) VALUES (:u, :n, :h) ON CONFLICT (username) DO NOTHING")
                    .param("u", o.username()).param("n", o.fullName()).param("h", hash).update();
        }
        log.info("operator roster seeded inserted={}", inserted);
    }

    public Operator authenticate(String username, String password) {
        record Row(String username, String fullName, String passwordHash) {}
        Optional<Row> row = jdbc.sql("SELECT username, full_name, password_hash FROM operators WHERE username = :u")
                .param("u", username).query(Row.class).optional();
        // Same answer for unknown user and wrong password: no username probing.
        if (row.isEmpty() || !bcrypt.matches(password, row.get().passwordHash())) throw ApiException.unauthorized();
        return new Operator(row.get().username(), row.get().fullName());
    }
}
