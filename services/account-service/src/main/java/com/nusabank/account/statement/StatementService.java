package com.nusabank.account.statement;

import com.nusabank.account.account.AccountRepository;
import com.nusabank.account.web.ApiException;
import com.nusabank.account.web.Money;
import java.io.ByteArrayOutputStream;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import org.openpdf.text.Document;
import org.openpdf.text.Element;
import org.openpdf.text.Font;
import org.openpdf.text.PageSize;
import org.openpdf.text.Paragraph;
import org.openpdf.text.Phrase;
import org.openpdf.text.pdf.PdfPCell;
import org.openpdf.text.pdf.PdfPTable;
import org.openpdf.text.pdf.PdfWriter;
import org.springframework.stereotype.Service;

/** Renders a monthly e-Statement. Deliberately heavy: one of EP2's slow-endpoint stories. */
@Service
public class StatementService {
    private static final ZoneId WIB = ZoneId.of("Asia/Jakarta");
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("dd MMM yyyy HH:mm", Locale.forLanguageTag("id-ID"));
    private static final Font TITLE = new Font(Font.HELVETICA, 14, Font.BOLD);
    private static final Font BODY = new Font(Font.HELVETICA, 8);
    private static final Font HEAD = new Font(Font.HELVETICA, 8, Font.BOLD);

    private final AccountRepository repo;

    public StatementService(AccountRepository repo) {
        this.repo = repo;
    }

    public byte[] render(AccountRepository.AccountRow account, String holderName, String period) {
        YearMonth ym = YearMonth.parse(period);
        if (ym.isAfter(YearMonth.now(WIB))) throw ApiException.notFound("e-Statement belum tersedia");
        var from = ym.atDay(1).atStartOfDay(WIB).toInstant();
        var to = ym.plusMonths(1).atDay(1).atStartOfDay(WIB).toInstant();
        var txns = repo.transactions(account.accountNumber(), from, to, null, 5000, 0).reversed();
        if (txns.isEmpty()) throw ApiException.notFound("Tidak ada transaksi pada periode ini");

        var out = new ByteArrayOutputStream();
        var doc = new Document(PageSize.A4, 36, 36, 36, 36);
        PdfWriter.getInstance(doc, out);
        doc.open();
        doc.add(new Paragraph("NUSA BANK — e-Statement", TITLE));
        doc.add(new Paragraph("Periode: " + ym.getMonth().getDisplayName(java.time.format.TextStyle.FULL, Locale.forLanguageTag("id-ID"))
                + " " + ym.getYear(), BODY));
        doc.add(new Paragraph("Nama: " + (holderName == null ? "-" : holderName.toUpperCase()), BODY));
        doc.add(new Paragraph("Rekening: " + account.accountNumber() + " · " + account.productName() + " · " + account.currency(), BODY));
        doc.add(new Paragraph("Dicetak: " + LocalDate.now(WIB), BODY));
        doc.add(new Paragraph(" "));

        var table = new PdfPTable(new float[] {2.2f, 5f, 1.2f, 2.2f, 2.4f});
        table.setWidthPercentage(100);
        for (String h : new String[] {"Tanggal", "Keterangan", "D/K", "Jumlah", "Saldo"}) {
            table.addCell(new PdfPCell(new Phrase(h, HEAD)));
        }
        for (var t : txns) {
            table.addCell(new Phrase(t.postedAt().atZoneSameInstant(WIB).format(DAY), BODY));
            table.addCell(new Phrase(t.description(), BODY));
            table.addCell(new Phrase("CREDIT".equals(t.type()) ? "K" : "D", BODY));
            table.addCell(right(Money.of(t.amount(), t.currency()).amount()));
            table.addCell(right(Money.of(t.balanceAfter(), t.currency()).amount()));
        }
        doc.add(table);
        doc.close();
        return out.toByteArray();
    }

    private static PdfPCell right(String text) {
        var cell = new PdfPCell(new Phrase(text, BODY));
        cell.setHorizontalAlignment(Element.ALIGN_RIGHT);
        return cell;
    }
}
