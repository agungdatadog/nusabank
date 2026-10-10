package com.nusabank.account.account;

import com.nusabank.account.fx.FxService;
import com.nusabank.account.security.AuthInterceptor;
import com.nusabank.account.security.JwtVerifier;
import com.nusabank.account.statement.StatementService;
import com.nusabank.account.web.ApiException;
import com.nusabank.account.web.Money;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class AccountController {
    private static final ZoneId WIB = ZoneId.of("Asia/Jakarta");
    private static final String ACCOUNT_PATTERN = "\\d{16}";

    private final AccountRepository repo;
    private final FxService fx;
    private final StatementService statements;

    public AccountController(AccountRepository repo, FxService fx, StatementService statements) {
        this.repo = repo;
        this.fx = fx;
        this.statements = statements;
    }

    public record AccountList(List<AccountView> accounts, Money totalBalanceIdr) {}

    public record TransactionView(String id, java.time.OffsetDateTime postedAt, String type, Money amount,
                                  String description, String channel, String reference, Money balanceAfter) {}

    public record TransactionPage(List<TransactionView> items, int page, int pageSize, long total) {}

    public record StatementSummary(String period, Money openingBalance, Money closingBalance, long transactionCount) {}

    @GetMapping("/accounts")
    AccountList list(@RequestAttribute(AuthInterceptor.CLAIMS) JwtVerifier.Claims claims) {
        List<AccountRepository.AccountRow> rows = repo.findByCif(claims.sub());
        Map<String, BigDecimal> rates = fx.midRatesOrEmpty();
        BigDecimal total = BigDecimal.ZERO;
        for (var a : rows) {
            boolean deposit = !"CREDIT_CARD".equals(a.productType()) && !"LOAN".equals(a.productType());
            if (!deposit) continue;
            if ("IDR".equals(a.currency())) total = total.add(a.balance());
            else if (rates.containsKey(a.currency())) total = total.add(a.balance().multiply(rates.get(a.currency())));
        }
        return new AccountList(rows.stream().map(AccountView::of).toList(), Money.of(total, "IDR"));
    }

    @GetMapping("/accounts/{accountNumber}")
    AccountView get(@RequestAttribute(AuthInterceptor.CLAIMS) JwtVerifier.Claims claims,
                    @PathVariable String accountNumber) {
        return AccountView.of(owned(claims, accountNumber));
    }

    @GetMapping("/accounts/{accountNumber}/transactions")
    TransactionPage transactions(@RequestAttribute(AuthInterceptor.CLAIMS) JwtVerifier.Claims claims,
                                 @PathVariable String accountNumber,
                                 @RequestParam(required = false) LocalDate from,
                                 @RequestParam(required = false) LocalDate to,
                                 @RequestParam(required = false) String type,
                                 @RequestParam(defaultValue = "1") int page,
                                 @RequestParam(name = "page_size", defaultValue = "20") int pageSize) {
        owned(claims, accountNumber);
        if (page < 1 || pageSize < 1 || pageSize > 100) throw ApiException.badRequest("page >= 1 and 1 <= page_size <= 100");
        if (type != null && !type.equals("CREDIT") && !type.equals("DEBIT")) throw ApiException.badRequest("type must be CREDIT or DEBIT");
        Instant start = (from != null ? from : LocalDate.now(WIB).minusMonths(3)).atStartOfDay(WIB).toInstant();
        Instant end = (to != null ? to.plusDays(1) : LocalDate.now(WIB).plusDays(1)).atStartOfDay(WIB).toInstant();
        long total = repo.countTransactions(accountNumber, start, end, type);
        var items = repo.transactions(accountNumber, start, end, type, pageSize, (page - 1) * pageSize).stream()
                .map(t -> new TransactionView(t.id().toString(), t.postedAt(), t.type(), Money.of(t.amount(), t.currency()),
                        t.description(), t.channel(), t.reference(), Money.of(t.balanceAfter(), t.currency())))
                .toList();
        return new TransactionPage(items, page, pageSize, total);
    }

    @GetMapping("/accounts/{accountNumber}/statements")
    List<StatementSummary> statements(@RequestAttribute(AuthInterceptor.CLAIMS) JwtVerifier.Claims claims,
                                      @PathVariable String accountNumber) {
        var account = owned(claims, accountNumber);
        return repo.statements(accountNumber).stream()
                .map(s -> new StatementSummary(s.period(), Money.of(s.opening(), account.currency()),
                        Money.of(s.closing(), account.currency()), s.count()))
                .toList();
    }

    @GetMapping("/accounts/{accountNumber}/statements/{period}")
    ResponseEntity<byte[]> statementPdf(@RequestAttribute(AuthInterceptor.CLAIMS) JwtVerifier.Claims claims,
                                        @PathVariable String accountNumber, @PathVariable String period) {
        var account = owned(claims, accountNumber);
        if (!period.matches("\\d{4}-\\d{2}")) throw ApiException.badRequest("period must be YYYY-MM");
        byte[] pdf = statements.render(account, claims.name(), period);
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"eStatement-" + accountNumber + "-" + period + ".pdf\"")
                .body(pdf);
    }

    @GetMapping("/fx/rates")
    FxService.FxRates rates() {
        return fx.rates();
    }

    /** Customers only ever see their own products; anything else is indistinguishable from "not found". */
    private AccountRepository.AccountRow owned(JwtVerifier.Claims claims, String accountNumber) {
        if (!accountNumber.matches(ACCOUNT_PATTERN)) throw ApiException.notFound("Rekening tidak ditemukan");
        return repo.find(accountNumber)
                .filter(a -> a.cif().equals(claims.sub()))
                .orElseThrow(() -> ApiException.notFound("Rekening tidak ditemukan"));
    }

}
