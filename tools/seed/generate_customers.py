"""Generate catalog/seed/customers.json — the synthetic customer base shared by
auth-service (identities) and account-service (products). Deterministic: re-running
produces the same file, so CIFs and account numbers stay stable across rebuilds.

    python3 tools/seed/generate_customers.py > catalog/seed/customers.json
"""

import json
import random
from datetime import date, timedelta

SEED = 20261029  # EP1 air date
N_CUSTOMERS = 250
rng = random.Random(SEED)

FIRST_F = ["Dewi", "Siti", "Rina", "Putri", "Ayu", "Wulan", "Indah", "Ratna", "Maya", "Fitri",
           "Sari", "Melati", "Anisa", "Lestari", "Nadia", "Citra", "Intan", "Kartika", "Laras", "Tiara"]
FIRST_M = ["Budi", "Agus", "Ahmad", "Hendra", "Rizky", "Fajar", "Dimas", "Yusuf", "Bayu", "Eko",
           "Andi", "Gilang", "Teguh", "Rudi", "Joko", "Arief", "Irfan", "Reza", "Hafiz", "Galih"]
LAST = ["Santoso", "Wijaya", "Pratama", "Hidayat", "Saputra", "Kusuma", "Nugroho", "Setiawan",
        "Siregar", "Lubis", "Nasution", "Harahap", "Wibowo", "Susanto", "Gunawan", "Halim",
        "Purnomo", "Utami", "Hakim", "Simanjuntak", "Tanjung", "Permana", "Firmansyah", "Rahmawati",
        "Sitompul", "Wardhana", "Hasibuan", "Prasetyo", "Kurniawan", "Maharani"]

# (street, kelurahan, kecamatan, kota, kode pos)
JAKARTA = [
    ("Jl. Kemang Raya", "Bangka", "Mampang Prapatan", "Jakarta Selatan", "12730"),
    ("Jl. Tebet Barat Dalam", "Tebet Barat", "Tebet", "Jakarta Selatan", "12810"),
    ("Jl. Fatmawati", "Cilandak Barat", "Cilandak", "Jakarta Selatan", "12430"),
    ("Jl. Sudirman", "Karet Tengsin", "Tanah Abang", "Jakarta Pusat", "10220"),
    ("Jl. Cikini Raya", "Cikini", "Menteng", "Jakarta Pusat", "10330"),
    ("Jl. Kelapa Gading Boulevard", "Kelapa Gading Barat", "Kelapa Gading", "Jakarta Utara", "14240"),
    ("Jl. Pluit Raya", "Pluit", "Penjaringan", "Jakarta Utara", "14450"),
    ("Jl. Daan Mogot", "Kedaung Kali Angke", "Cengkareng", "Jakarta Barat", "11710"),
    ("Jl. Puri Indah Raya", "Kembangan Selatan", "Kembangan", "Jakarta Barat", "11610"),
    ("Jl. Rawamangun Muka", "Rawamangun", "Pulo Gadung", "Jakarta Timur", "13220"),
    ("Jl. Kalimalang", "Pondok Kelapa", "Duren Sawit", "Jakarta Timur", "13450"),
    ("Jl. Margonda Raya", "Kemiri Muka", "Beji", "Depok", "16423"),
    ("Jl. BSD Raya Utama", "Lengkong Kulon", "Pagedangan", "Tangerang", "15331"),
    ("Jl. Ahmad Yani", "Marga Jaya", "Bekasi Selatan", "Bekasi", "17141"),
]
# NIK prefixes (province+regency+district) consistent with the city above.
NIK_PREFIX = {"Jakarta Selatan": "317404", "Jakarta Pusat": "317101", "Jakarta Utara": "317201",
              "Jakarta Barat": "317301", "Jakarta Timur": "317501", "Depok": "327601",
              "Tangerang": "360306", "Bekasi": "327502"}

SEGMENTS = [("REGULAR", 0.80), ("PRIORITY", 0.17), ("PRIVATE", 0.03)]
NUSA_PREFIX = "5021"


def weighted(choices):
    r, acc = rng.random(), 0.0
    for value, w in choices:
        acc += w
        if r < acc:
            return value
    return choices[-1][0]


def luhn_digit(body: str) -> str:
    total = 0
    for i, ch in enumerate(reversed(body)):
        d = int(ch)
        if i % 2 == 0:
            d *= 2
            d -= 9 if d > 9 else 0
        total += d
    return str((10 - total % 10) % 10)


used_accounts = set()


def account_number(prefix: str = NUSA_PREFIX) -> str:
    # 4-digit product prefix + 3-digit branch + 8-digit serial + Luhn check digit = 16
    while True:
        body = prefix + f"{rng.randint(1, 120):03d}" + f"{rng.randint(0, 99_999_999):08d}"
        num = body + luhn_digit(body)
        # Avoid the ...0000 suffix: partner-mock treats it as a closed account.
        if num not in used_accounts and not num.endswith("0000"):
            used_accounts.add(num)
            return num


def idr(lo_median: float, sigma: float, floor: int = 50_000) -> str:
    v = max(floor, int(rng.lognormvariate(0, sigma) * lo_median))
    return str(v // 1000 * 1000)


def opened(min_years: float = 0.3, max_years: float = 12) -> str:
    d = date(2026, 10, 1) - timedelta(days=int(rng.uniform(min_years, max_years) * 365))
    return d.isoformat()


def products(segment: str) -> list:
    median = {"REGULAR": 12_000_000, "PRIORITY": 650_000_000, "PRIVATE": 4_500_000_000}[segment]
    out = [{
        "account_number": account_number(),
        "product_type": "SAVINGS",
        "product_name": "Tabungan Nusa Prima" if segment != "REGULAR" else "Tabungan Nusa Harian",
        "currency": "IDR",
        "balance": idr(median, 1.0),
        "opened_at": opened(),
        "interest_rate": "1.50" if segment == "REGULAR" else "2.25",
    }]
    if segment != "REGULAR" or rng.random() < 0.15:
        out.append({"account_number": account_number(), "product_type": "CURRENT",
                    "product_name": "Giro Nusa Bisnis", "currency": "IDR",
                    "balance": idr(median * 0.8, 1.1), "opened_at": opened(), "interest_rate": "0.50"})
    if rng.random() < (0.55 if segment != "REGULAR" else 0.12):
        usd = rng.lognormvariate(0, 0.9) * (2_500 if segment == "REGULAR" else 40_000)
        out.append({"account_number": account_number(), "product_type": "SAVINGS",
                    "product_name": "Tabungan Valas USD", "currency": "USD",
                    "balance": f"{usd:.2f}", "opened_at": opened(0.3, 6), "interest_rate": "0.75"})
    if rng.random() < (0.25 if segment != "REGULAR" else 0.05):
        jpy = int(rng.lognormvariate(0, 0.9) * (300_000 if segment == "REGULAR" else 4_000_000))
        out.append({"account_number": account_number(), "product_type": "SAVINGS",
                    "product_name": "Tabungan Valas JPY", "currency": "JPY",
                    "balance": str(jpy // 100 * 100), "opened_at": opened(0.3, 6), "interest_rate": "0.05"})
    if rng.random() < (0.85 if segment != "REGULAR" else 0.45):
        limit = {"REGULAR": rng.choice([8, 12, 15, 25]), "PRIORITY": rng.choice([50, 75, 100]),
                 "PRIVATE": rng.choice([250, 500])}[segment] * 1_000_000
        out.append({"account_number": account_number("5413"), "product_type": "CREDIT_CARD",
                    "product_name": "Kartu Kredit Nusa Platinum" if segment != "REGULAR" else "Kartu Kredit Nusa Gold",
                    "currency": "IDR", "balance": str(int(limit * rng.uniform(0.02, 0.45)) // 1000 * 1000),
                    "credit_limit": str(limit), "opened_at": opened(0.5, 8)})
    if rng.random() < (0.6 if segment != "REGULAR" else 0.1):
        tenor = rng.choice([1, 3, 6, 12])
        start = date(2026, 10, 1) - timedelta(days=rng.randint(5, 25 * tenor))
        out.append({"account_number": account_number("5031"), "product_type": "TIME_DEPOSIT",
                    "product_name": f"Deposito Nusa Berjangka {tenor} Bulan", "currency": "IDR",
                    "balance": str(rng.choice([25, 50, 100, 250, 500, 1000]) * 1_000_000 * (5 if segment == "PRIVATE" else 1)),
                    "opened_at": start.isoformat(),
                    "maturity_date": (start + timedelta(days=30 * tenor)).isoformat(),
                    "interest_rate": {1: "3.75", 3: "4.00", 6: "4.25", 12: "4.50"}[tenor]})
    return out


def main():
    customers, usernames, ciks = [], set(), set()
    for i in range(N_CUSTOMERS):
        female = rng.random() < 0.5
        first = rng.choice(FIRST_F if female else FIRST_M)
        last = rng.choice(LAST)
        username = f"{first}.{last}".lower()
        n = 2
        while username in usernames:
            username, n = f"{first}.{last}{n}".lower(), n + 1
        usernames.add(username)

        street, kel, kec, kota, kodepos = rng.choice(JAKARTA)
        birth = date(1960, 1, 1) + timedelta(days=rng.randint(0, 365 * 43))
        # NIK: 6-digit region + DDMMYY (women add 40 to the day) + 4-digit serial
        day = birth.day + (40 if female else 0)
        nik = f"{NIK_PREFIX[kota]}{day:02d}{birth.month:02d}{birth.year % 100:02d}{rng.randint(1, 9999):04d}"
        cif = f"10{rng.randint(0, 99_999_999):08d}"
        while cif in ciks:
            cif = f"10{rng.randint(0, 99_999_999):08d}"
        ciks.add(cif)
        segment = weighted(SEGMENTS)

        customers.append({
            "cif": cif,
            "username": username,
            "full_name": f"{first} {last}",
            "email": f"{username}@mail.example",
            "phone": f"+628{rng.choice(['11', '12', '13', '21', '22', '52', '56', '57', '77', '78', '95', '96'])}{rng.randint(10_000_000, 99_999_999)}",
            "segment": segment,
            "address": f"{street} No. {rng.randint(1, 180)}, {kel}, {kec}, {kota} {kodepos}",
            "nik": nik,
            "birth_date": birth.isoformat(),
            "mfa_enabled": rng.random() < 0.3,
            "accounts": products(segment),
        })
    json.dump({"generated_with_seed": SEED, "customers": customers}, sys_stdout(), ensure_ascii=False, indent=1)


def sys_stdout():
    import sys
    return sys.stdout


if __name__ == "__main__":
    main()
