package com.nusabank.account.account;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * Account holder names as printed on statements and beneficiary screens. The customer
 * record belongs to auth-service; account-service keeps only this display copy, loaded
 * from the shared seed, rather than reading another service's database.
 */
@Component
public class OwnerNames {
    private final Map<String, String> byCif = new ConcurrentHashMap<>();

    void put(String cif, String fullName) {
        byCif.put(cif, fullName.toUpperCase());
    }

    public String nameFor(String cif) {
        return byCif.getOrDefault(cif, "NASABAH NUSA BANK");
    }
}
