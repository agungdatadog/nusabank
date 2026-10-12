package com.nusabank.admin.security;

import com.nusabank.admin.AdminProperties;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/**
 * Issues operator tokens: the same HS256 contract as auth-service (shared JWT_SECRET,
 * aud=nusabank) with role=operator and sub=username, so only admin endpoints accept them.
 */
@Component
public class JwtIssuer {
    public static final long TTL_SECONDS = 3600;

    private final byte[] secret;
    private final ObjectMapper mapper;

    @Autowired
    public JwtIssuer(AdminProperties props, ObjectMapper mapper) {
        this(props.jwtSecret(), mapper);
    }

    JwtIssuer(String secret, ObjectMapper mapper) {
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
        this.mapper = mapper;
    }

    public String issue(String username, String fullName) {
        long now = System.currentTimeMillis() / 1000;
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("sub", username);
        claims.put("name", fullName);
        claims.put("role", "operator");
        claims.put("iss", "nusabank-admin");
        claims.put("aud", "nusabank");
        claims.put("iat", now);
        claims.put("exp", now + TTL_SECONDS);
        try {
            Base64.Encoder enc = Base64.getUrlEncoder().withoutPadding();
            String header = enc.encodeToString(mapper.writeValueAsBytes(Map.of("alg", "HS256", "typ", "JWT")));
            String payload = enc.encodeToString(mapper.writeValueAsBytes(claims));
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            String sig = enc.encodeToString(mac.doFinal((header + "." + payload).getBytes(StandardCharsets.US_ASCII)));
            return header + "." + payload + "." + sig;
        } catch (Exception e) {
            throw new IllegalStateException("cannot sign operator token", e);
        }
    }
}
