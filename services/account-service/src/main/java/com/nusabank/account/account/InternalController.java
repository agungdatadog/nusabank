package com.nusabank.account.account;

import com.nusabank.account.web.ApiException;
import com.nusabank.account.web.Money;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Cluster-only endpoints used by payment-service and biller-service. */
@RestController
@RequestMapping("/internal")
public class InternalController {
    private final AccountRepository repo;
    private final HoldService holds;
    private final OwnerNames owners;

    public InternalController(AccountRepository repo, HoldService holds, OwnerNames owners) {
        this.repo = repo;
        this.holds = holds;
        this.owners = owners;
    }

    public record AccountRef(String accountNumber, String cif, String ownerName, String currency, String status) {}

    public record HoldRequest(Money amount, String reference, String purpose) {}

    @GetMapping("/accounts/{accountNumber}")
    AccountRef account(@PathVariable String accountNumber) {
        var a = repo.find(accountNumber).orElseThrow(() -> ApiException.notFound("Rekening tidak ditemukan"));
        return new AccountRef(a.accountNumber(), a.cif(), owners.nameFor(a.cif()), a.currency(), a.status());
    }

    @PostMapping("/accounts/{accountNumber}/holds")
    ResponseEntity<HoldService.HoldView> createHold(@PathVariable String accountNumber,
                                                    @RequestHeader("Idempotency-Key") UUID idempotencyKey,
                                                    @RequestBody HoldRequest req) {
        if (req.amount() == null || !req.amount().valid() || req.amount().value().signum() <= 0) {
            throw ApiException.badRequest("amount must be a positive decimal string with currency IDR, USD or JPY");
        }
        if (req.reference() == null || req.reference().isBlank()) throw ApiException.badRequest("reference is required");
        if (!"TRANSFER".equals(req.purpose()) && !"BILL_PAYMENT".equals(req.purpose())) {
            throw ApiException.badRequest("purpose must be TRANSFER or BILL_PAYMENT");
        }
        var hold = holds.create(accountNumber, req.amount(), req.reference(), req.purpose(), idempotencyKey);
        return ResponseEntity.status(HttpStatus.CREATED).body(hold);
    }

    @DeleteMapping("/holds/{holdId}")
    ResponseEntity<Void> releaseHold(@PathVariable UUID holdId) {
        if (!holds.release(holdId, "RELEASED")) throw ApiException.notFound("Hold tidak ditemukan atau sudah selesai");
        return ResponseEntity.noContent().build();
    }
}
