package com.nusabank.loan.security;

import com.nusabank.loan.LoanProperties;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/** Verifies HS256 tokens issued by auth-service with the shared JWT_SECRET. */
@Component
public class JwtVerifier {
    public record Claims(String sub, String name, String segment, String role) {}

    private final byte[] secret;
    private final ObjectMapper mapper;

    @Autowired
    public JwtVerifier(LoanProperties props, ObjectMapper mapper) {
        this(props.jwtSecret(), mapper);
    }

    JwtVerifier(String secret, ObjectMapper mapper) {
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
        this.mapper = mapper;
    }

    @SuppressWarnings("unchecked")
    public Claims verify(String token) {
        if (token == null) return null;
        String[] parts = token.split("\\.");
        if (parts.length != 3) return null;
        try {
            Base64.Decoder dec = Base64.getUrlDecoder();
            Map<String, Object> header = mapper.readValue(dec.decode(parts[0]), Map.class);
            if (!"HS256".equals(header.get("alg"))) return null;

            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            byte[] expected = mac.doFinal((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
            if (!MessageDigest.isEqual(expected, dec.decode(parts[2]))) return null;

            Map<String, Object> c = mapper.readValue(dec.decode(parts[1]), Map.class);
            long exp = ((Number) c.getOrDefault("exp", 0)).longValue();
            if (!"nusabank".equals(c.get("aud")) || exp <= System.currentTimeMillis() / 1000) return null;
            return new Claims((String) c.get("sub"), (String) c.get("name"), (String) c.get("segment"), (String) c.get("role"));
        } catch (Exception e) {
            return null;
        }
    }
}
