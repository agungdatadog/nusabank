package com.nusabank.admin.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class OperatorTokenTest {
    private final JsonMapper mapper = JsonMapper.builder().build();

    @Test
    void issuedOperatorTokensVerifyWithTheSharedSecret() {
        String token = new JwtIssuer("shared-secret", mapper).issue("ops.rina", "Rina Kartika");
        JwtVerifier.Claims claims = new JwtVerifier("shared-secret", mapper).verify(token);
        assertEquals("ops.rina", claims.sub());
        assertEquals("operator", claims.role());
        assertEquals("Rina Kartika", claims.name());
    }

    @Test
    void aDifferentSecretOrATamperedTokenIsRejected() {
        String token = new JwtIssuer("shared-secret", mapper).issue("ops.rina", "Rina Kartika");
        assertNull(new JwtVerifier("other-secret", mapper).verify(token));
        String[] parts = token.split("\\.");
        assertNull(new JwtVerifier("shared-secret", mapper).verify(parts[0] + "." + parts[1] + "x." + parts[2]));
    }
}
