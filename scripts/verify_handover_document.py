"""Bandingkan setiap literal panjang di documentContent.ts dengan isi .docx.

Kenapa skrip ini ada
---------------------
Teks legal di `documentContent.ts` diambil dari template Word secara manual, dan
salah ketik di dalam klausa itu akan tercetak ke dokumen yang ditandatangani
tanpa error apa pun — `tsc` tetap hijau, `prettier` tetap bersih, dan tidak ada
test yang gagal. Skrip ini gagal keras kalau ada literal yang tidak cocok verbatim.

Python, bukan Node, karena `zipfile` ada di standard library sedangkan Node perlu
dependency untuk membuka .docx — dan `AGENTS.md` melarang menambah dependency
tanpa diminta.

Jalankan dari repo root:

    python scripts/verify_handover_document.py
"""

import html
import pathlib
import re
import sys
import zipfile

DOCX = pathlib.Path("260911-MULTI-SOEHARDONO.docx")
TS = pathlib.Path("src/modules/handover/document/documentContent.ts")

# Bagian .docx yang boleh jadi sumber teks. `header1/3` dan `footer1/3` kosong di
# template ini; header2/footer2 yang dipakai. Menambah atau mengurangi daftar ini
# adalah perubahan yang disengaja, bukan sekadar penyesuaian.
PARTS = (
    "word/document.xml",
    "word/header2.xml",
    "word/footer2.xml",
)


def docx_paragraphs(z, part):
    """Satu string per paragraf, whitespace diratakan."""
    xml = z.read(part).decode("utf-8")
    out = []
    for p in re.findall(r"<w:p[ >].*?</w:p>", xml, re.S):
        # `w:tab`/`w:br` adalah elemen kosong; tanpa ini, XML-nya bocor ke dalam teks
        q = re.sub(r"<w:(tab|br)\s*/>", " ", p)
        t = "".join(re.findall(r"<w:t(?![a-z])[^>]*>(.*?)</w:t>", q, re.S))
        t = html.unescape(t).strip()
        # Paragraf yang isinya XML mentah bukan teks — sudah tertangkap di atas,
        # tapi dijaga supaya satu paragraf aneh tidak membocorkan bahasa markup.
        if t and not t.startswith("<w:p"):
            out.append(re.sub(r"\s+", " ", t))
    return out


def norm(s):
    """Samakan yang berbeda hanya karena font Word vs file teks."""
    s = s.replace("|", "-").replace("\u2013", "-").replace("\u2014", "-")
    s = s.replace("\ufffd", "-")
    return re.sub(r"\s+", " ", s).strip()


def unescape(s):
    """Batalkan escape yang mungkin ditulis di string TypeScript."""
    return (
        s.replace('\\"', '"')
        .replace("\\'", "'")
        .replace("\\n", " ")
        .replace("\\u2013", "\u2013")
    )


def collect_literals(src):
    lits = set()
    # bentuk `en:` / `id:` di dalam TERMS
    lits.update(re.findall(r'(?:en|id):\s*"((?:[^"\\]|\\.)*)"', src))
    # bentuk `NAMA_CONST = "..."`
    lits.update(re.findall(r'\b[A-Z_]{3,}\s*=\s*"((?:[^"\\]|\\.)+)"', src))
    # bentuk `key: "..."` pada baris sendiri di dalam objek
    lits.update(re.findall(r'\n\s+[a-zA-Z_]+\s*:\s*"((?:[^"\\]|\\.)*)"', src))
    # hanya literal panjang: label pendek seperti "Unit" tidak ada artinya di sini
    return {x for x in lits if len(x) > 20}


def main():
    if not DOCX.exists():
        print(f"GAGAL: {DOCX} tidak ditemukan. Jalankan dari repo root.")
        return 1
    if not TS.exists():
        print(f"GAGAL: {TS} tidak ditemukan.")
        return 1

    z = zipfile.ZipFile(DOCX)
    chunks = []
    for part in PARTS:
        chunks += docx_paragraphs(z, part)
    haystack = norm(" \u241f ".join(chunks))

    lits = collect_literals(TS.read_text(encoding="utf-8"))
    bad = []
    for lit in sorted(lits):
        s = norm(unescape(lit))
        if s not in haystack:
            bad.append(s)

    print(f"literal panjang diperiksa : {len(lits)}")
    if bad:
        print(f"\nTIDAK COCOK VERBATIM ({len(bad)}):")
        for b in bad:
            print("  -", b[:180])
        print(
            "\nTeks di atas tidak ada di .docx. Kalau itu klausa legal, berarti"
            "\nfilenya sudah berubah dari template dan klausanya harus ditulis ulang."
        )
        return 1

    print("\nSEMUA literal cocok verbatim dengan .docx")
    return 0


if __name__ == "__main__":
    sys.exit(main())
