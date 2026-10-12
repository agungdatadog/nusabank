// Built-in intent responder: answers common questions until ai-agent takes over.
// Figures match the services (payment-service rails, biller-service, rewards-service).

export interface FaqReply {
  intent: string;
  reply: string;
  handoff: boolean;
}

interface Intent {
  name: string;
  keywords: RegExp;
  reply: string;
  handoff?: boolean;
}

// Order matters: specific and urgent intents first.
const INTENTS: Intent[] = [
  {
    name: "block_card",
    keywords: /\b(blokir|hilang|dicuri|curi|fraud|penipuan|tidak (saya )?kenal|transaksi mencurigakan)\b/,
    reply: "Demi keamanan, permintaan ini saya teruskan ke petugas kami sekarang. Mohon jangan bagikan PIN atau kode OTP kepada siapa pun, termasuk yang mengaku petugas Nusa Bank.",
    handoff: true,
  },
  {
    name: "human",
    keywords: /\b(petugas|cs|customer service|manusia|operator|komplain|keluhan|bicara dengan orang)\b/,
    reply: "Baik, saya hubungkan Anda dengan petugas kami. Mohon tunggu sebentar, riwayat percakapan ini akan diteruskan.",
    handoff: true,
  },
  {
    name: "bifast",
    keywords: /\b(bi ?fast|bifast|transfer (ke )?bank lain|antar ?bank)\b/,
    reply: "Transfer BI FAST ke bank lain diproses real-time, 24 jam, dengan biaya Rp2.500 dan maksimal Rp250 juta per transaksi. Untuk nominal lebih besar, gunakan SKN (maksimal Rp1 miliar).",
  },
  {
    name: "skn",
    keywords: /\b(skn|kliring)\b/,
    reply: "Transfer SKN diproses per jendela kliring setiap 15 menit, dengan biaya Rp2.900 dan maksimal Rp1 miliar per transaksi. Transfer yang masuk kurang dari 2 menit sebelum jendela akan ikut jendela berikutnya.",
  },
  {
    name: "intrabank",
    keywords: /\b(sesama|antar rekening|nusa bank lain)\b/,
    reply: "Transfer ke sesama rekening Nusa Bank gratis, real-time, maksimal Rp500 juta per transaksi.",
  },
  {
    name: "loan",
    keywords: /\b(kpr|kkb|kta|cicilan|pinjaman|kredit|angsuran|tenor)\b/,
    reply: "Anda dapat menghitung cicilan KPR, KKB, maupun KTA di menu Pinjaman → Simulasi. Simulasi menampilkan angsuran bulanan dan total bunga; pengajuan dapat dilanjutkan langsung dari hasil simulasi.",
  },
  {
    name: "topup",
    keywords: /\b(top ?up|gopay|ovo|shopeepay|dana|linkaja|e-?wallet|dompet digital)\b/,
    reply: "Top up GoPay, OVO, ShopeePay, DANA, dan LinkAja tersedia di menu Top Up & Tagihan, mulai Rp10.000 hingga Rp2.000.000 per transaksi, dengan biaya admin Rp1.000–Rp1.500.",
  },
  {
    name: "bill",
    keywords: /\b(pln|token|listrik|pdam|air|bpjs|indihome|biznet|first media|tagihan|pulsa|paket data)\b/,
    reply: "Pembayaran pulsa, paket data, token & tagihan PLN, internet, PDAM, dan BPJS Kesehatan ada di menu Top Up & Tagihan. Jika status pembayaran \"Diproses\", sistem akan mengonfirmasi otomatis dan dana Anda tetap aman.",
  },
  {
    name: "rewards",
    keywords: /\b(poin|point|reward|voucher|tier|gold|platinum)\b/,
    reply: "Anda mendapat Nusa Poin dari transfer antarbank, top up, dan pembayaran tagihan. Nasabah Prioritas mendapat 1,5× poin dan Private 2×. Poin dapat ditukar dengan voucher di menu Poin.",
  },
  {
    name: "statement",
    keywords: /\b(e-?statement|rekening koran|mutasi|laporan bulanan)\b/,
    reply: "Mutasi dan e-Statement bulanan dapat diunduh dari halaman rekening: pilih rekening di Beranda, lalu buka tab e-Statement.",
  },
  {
    name: "password",
    keywords: /\b(lupa (kata sandi|password|pin)|reset (password|kata sandi)|terkunci|tidak bisa login)\b/,
    reply: "Akun terkunci sementara setelah beberapa kali salah memasukkan kata sandi dan terbuka kembali otomatis. Jika Anda lupa kata sandi, ketik \"petugas\" dan kami bantu verifikasi identitas Anda.",
  },
  {
    name: "hours",
    keywords: /\b(jam (operasional|kerja|layanan)|buka|libur|24 jam)\b/,
    reply: "Layanan Nusa Bank digital tersedia 24 jam setiap hari. Petugas chat siap membantu pukul 06.00–22.00 WIB.",
  },
  {
    name: "greeting",
    keywords: /^(halo|hai|hi|selamat (pagi|siang|sore|malam)|assalamualaikum|permisi)\b/,
    reply: "Halo! Saya asisten virtual Nusa Bank. Ada yang bisa saya bantu terkait transfer, top up & tagihan, pinjaman, atau poin?",
  },
  {
    name: "thanks",
    keywords: /\b(terima ?kasih|makasih|thanks|thank you)\b/,
    reply: "Sama-sama! Senang bisa membantu. Ada lagi yang ingin ditanyakan?",
  },
];

export const GREETING = "Halo! Saya asisten virtual Nusa Bank. Silakan tanyakan seputar transfer, top up & tagihan, pinjaman, atau Nusa Poin. Ketik \"petugas\" untuk berbicara dengan petugas kami.";

export function answer(message: string): FaqReply {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  for (const intent of INTENTS) {
    if (intent.keywords.test(text)) return { intent: intent.name, reply: intent.reply, handoff: intent.handoff ?? false };
  }
  return {
    intent: "unknown",
    reply: "Maaf, saya belum memahami pertanyaan Anda. Coba tanyakan tentang transfer, top up & tagihan, pinjaman, atau poin — atau ketik \"petugas\" untuk berbicara dengan petugas kami.",
    handoff: false,
  };
}
