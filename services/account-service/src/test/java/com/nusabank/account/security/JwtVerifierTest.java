package com.nusabank.account.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class JwtVerifierTest {
    private static final String SECRET = "test-secret-not-used-anywhere";
    private final JwtVerifier verifier = new JwtVerifier(SECRET, JsonMapper.builder().build());

    /** Mirrors services/auth-service/src/jwt.ts, the issuer of every customer token. */
    private static String token(String alg, String payloadJson, String secret) throws Exception {
        var enc = Base64.getUrlEncoder().withoutPadding();
        String header = enc.encodeToString(("{\"alg\":\"" + alg + "\",\"typ\":\"JWT\"}").getBytes(StandardCharsets.UTF_8));
        String payload = enc.encodeToString(payloadJson.getBytes(StandardCharsets.UTF_8));
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String sig = enc.encodeToString(mac.doFinal((header + "." + payload).getBytes(StandardCharsets.US_ASCII)));
        return header + "." + payload + "." + sig;
    }

    private static String claims(long exp) {
        return "{\"sub\":\"1024307295\",\"name\":\"Yusuf Tanjung\",\"segment\":\"REGULAR\",\"role\":\"customer\","
                + "\"iss\":\"nusabank-auth\",\"aud\":\"nusabank\",\"exp\":" + exp + "}";
    }

    @Test
    void acceptsValidToken() throws Exception {
        var c = verifier.verify(token("HS256", claims(System.currentTimeMillis() / 1000 + 60), SECRET));
        assertEquals("1024307295", c.sub());
        assertEquals("REGULAR", c.segment());
    }

    @Test
    void rejectsWrongSecretExpiryAndAlg() throws Exception {
        long future = System.currentTimeMillis() / 1000 + 60;
        assertNull(verifier.verify(token("HS256", claims(future), "other-secret")));
        assertNull(verifier.verify(token("HS256", claims(1), SECRET)));
        assertNull(verifier.verify(token("none", claims(future), SECRET)));
        assertNull(verifier.verify("not.a.jwt"));
        assertNull(verifier.verify(null));
    }
}
