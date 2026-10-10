package com.nusabank.ledger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class PostingRulesTest {
    private final JsonMapper mapper = JsonMapper.builder().build();

    private JsonNode transfer(String rail, String status) {
        return mapper.readTree("""
                {"event_id":"7c0e7f5e-6f1e-4b5a-9b1d-0d0e0f0a0b0c","transfer_id":"t-1","rail":"%s","status":"%s",
                 "source_account_number":"5021114721865049","destination_bank_code":"014",
                 "destination_bank_name":"Bank Central Asia (BCA)","destination_account_number":"0812345678",
                 "source_account_name":"FAJAR HIDAYAT","destination_account_name":"SARI SIMANJUNTAK",
                 "amount":{"amount":"1500000","currency":"IDR"},"fee":{"amount":"2500","currency":"IDR"},
                 "hold_id":"8d6f6a1e-2b3c-4d5e-8f90-a1b2c3d4e5f6"}""".formatted(rail, status));
    }

    @Test
    void biFastTransferBalancesAndDescribesTheBeneficiary() {
        List<PostingRules.Line> lines = PostingRules.transfer(transfer("BIFAST", "SUCCESS"));
        assertTrue(PostingRules.balanced(lines));
        assertEquals(4, lines.size());
        var principal = lines.get(0);
        assertEquals("5021114721865049", principal.accountNumber());
        assertEquals("BI FAST ke BCA 0812345678 SARI SIMANJUNTAK", principal.description());
        assertEquals("8d6f6a1e-2b3c-4d5e-8f90-a1b2c3d4e5f6", principal.holdId());
        assertEquals("NOSTRO-BIFAST", lines.get(1).glAccount());
        assertEquals(new BigDecimal("2500"), lines.get(2).amount());
    }

    @Test
    void intrabankCreditsTheBeneficiaryCustomer() {
        var lines = PostingRules.transfer(transfer("INTRABANK", "SUCCESS"));
        assertTrue(PostingRules.balanced(lines));
        assertEquals("0812345678", lines.get(1).accountNumber());
        assertEquals("TRANSFER DARI FAJAR HIDAYAT", lines.get(1).description());
    }

    @Test
    void failedTransferBooksNothing() {
        assertTrue(PostingRules.transfer(transfer("SKN", "FAILED")).isEmpty());
    }

    @Test
    void loanDisbursementBalances() {
        var e = mapper.readTree("""
                {"event_id":"1f0e7f5e-6f1e-4b5a-9b1d-0d0e0f0a0b0c","application_id":"a-1","product_code":"KPR",
                 "disbursement_account_number":"5021114721865049","principal":{"amount":"750000000","currency":"IDR"}}""");
        var lines = PostingRules.loanDisbursement(e);
        assertTrue(PostingRules.balanced(lines));
        assertEquals("PENCAIRAN KPR", lines.get(1).description());
    }

    @Test
    void inboundCreditsTheCustomerFromNostro() {
        var e = mapper.readTree("""
                {"event_id":"2f0e7f5e-6f1e-4b5a-9b1d-0d0e0f0a0b0c","event_type":"transfer.received","transfer_id":"i-1",
                 "rail":"BIFAST","account_number":"5021114721865049","sender_bank_name":"Bank Mandiri",
                 "sender_name":"BUDI SANTOSO","amount":{"amount":"2500000","currency":"IDR"}}""");
        var lines = PostingRules.inbound(e);
        assertTrue(PostingRules.balanced(lines));
        assertEquals("NOSTRO-BIFAST", lines.get(0).glAccount());
        assertEquals("5021114721865049", lines.get(1).accountNumber());
        assertEquals("BI FAST DARI BANK MANDIRI BUDI SANTOSO", lines.get(1).description());
    }

    @Test
    void derivedIdsAreStable() {
        assertEquals(LedgerService.derived("journal", "abc"), LedgerService.derived("journal", "abc"));
    }
}
