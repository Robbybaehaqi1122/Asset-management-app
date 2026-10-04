/**
 * The static text of the printed handover document.
 *
 * **This is not i18n content, and deliberately so.** The `Terms of Use` below are a
 * bilingual legal disclaimer the company signs. A translation system is for text
 * that is *shown in an interface* and that a translator is expected to keep current;
 * a legal clause is a fixed artefact that must print byte-identical every time, and
 * a missing key must not be able to quietly remove a clause from a document
 * somebody is about to sign.
 *
 * So the text lives here as data, in the same shape as the Word template it came
 * from (`260911-MULTI-SOEHARDONO.docx`), and the component renders it. The
 * **labels** around it — column headers, button text — are ordinary UI and *are* in
 * `common.json`; the two are separated deliberately.
 *
 * The English/Indonesian pairing is preserved because the paper document is
 * bilingual by design. Every clause is `{en, id}` rather than a parallel array, so a
 * half-translated document is a type error rather than a shifted row.
 */

/** One bilingual clause. Both languages are always present. */
export type BilingualClause = { en: string; id: string };

/**
 * The terms, in the order the template prints them.
 *
 * Extracted from the template rather than retyped, because a legal clause is not
 * something to paraphrase: a wording change here is a change to what the employee
 * signs, and it would be invisible in review among 30 near-identical lines.
 *
 * Clause 3c's Indonesian text carries a translation quirk in the source — its
 * second half still names "Pengelolaan penyimpanan" where the English has already
 * moved on to capacity maintenance. It is reproduced **as printed** rather than
 * corrected, for the same reason: this is the text the document was signed with.
 * Flagged here so nobody later "fixes" it and changes a signed document.
 */
export const TERMS: readonly BilingualClause[] = [
  {
    en: "By receiving the Facility, the Employee acknowledges and agrees to the following terms:",
    id: "Dengan menerima Fasilitas, Karyawan menyatakan memahami dan menyetujui ketentuan berikut:",
  },
  {
    en: "These terms apply to all company devices, accessories, and related equipment provided by the Company.",
    id: "Ketentuan ini berlaku untuk seluruh perangkat perusahaan, aksesori, dan perlengkapan terkait yang diberikan oleh Perusahaan.",
  },
  {
    en: "1. The Facility shall remain the sole property of PT. Patimban Global Gateway Terminal and shall be used solely for work-related purposes.",
    id: "1. Fasilitas tetap menjadi milik sepenuhnya PT. Patimban Global Gateway Terminal dan hanya boleh digunakan untuk keperluan pekerjaan.",
  },
  {
    en: "2. The Employee shall properly use, safeguard, and maintain the Facility, and shall return it in good, complete, and working condition upon request by the IT department or HR department.",
    id: "2. Karyawan wajib menggunakan, menjaga, dan merawat Fasilitas dengan baik, serta mengembalikannya dalam kondisi baik, lengkap, dan berfungsi apabila diminta oleh departemen IT atau departemen HR.",
  },
  {
    en: "3. The Employee shall comply with the following usage, security, maintenance, and reporting obligations in relation to the Facility:",
    id: "3. Karyawan wajib mematuhi kewajiban penggunaan, keamanan, pemeliharaan, dan pelaporan berikut sehubungan dengan Fasilitas:",
  },
  {
    en: "a) Configuration and applications: The Employee shall not alter the Facility's original installation settings or install third-party applications without prior approval from the IT department.",
    id: "a) Konfigurasi dan aplikasi: Karyawan dilarang mengubah pengaturan instalasi awal Fasilitas atau menginstal aplikasi pihak ketiga tanpa persetujuan terlebih dahulu dari departemen IT.",
  },
  {
    en: "b) IT support: The Employee shall contact the IT department for assistance if any difficulty, malfunction, or uncertainty arises in using the Facility or related tools.",
    id: "b) Dukungan IT: Karyawan wajib menghubungi departemen IT untuk memperoleh bantuan apabila terdapat kesulitan, gangguan, atau ketidakpastian dalam menggunakan Fasilitas atau perangkat terkait.",
  },
  {
    en: "c) Storage management: The Employee shall store company data using the cloud storage provided by the Company to ensure secure and safe data storage. The Employee shall make reasonable efforts to maintain storage capacity by periodically deleting unnecessary or unused emails, attachments, photos, videos, and files.",
    id: "c) Karyawan wajib menyimpan data perusahaan menggunakan layanan cloud storage yang disediakan oleh Perusahaan demi penyimpanan data yang lebih aman. Pengelolaan penyimpanan: Karyawan wajib berupaya secara wajar menjaga kapasitas penyimpanan dengan secara berkala menghapus email, lampiran, foto, video, dan berkas yang tidak diperlukan atau tidak digunakan.",
  },
  {
    en: "d) Email and cybersecurity: To prevent viruses, phishing, and other malicious attacks, the Employee shall exercise caution with emails or attachments from unknown or suspicious sources and shall delete such emails without opening attachments or contact the IT department when in doubt.",
    id: "d) Email dan keamanan siber: Untuk mencegah virus, phishing, dan serangan berbahaya lainnya, Karyawan wajib berhati-hati terhadap email atau lampiran dari sumber yang tidak dikenal atau mencurigakan, serta menghapus email tersebut tanpa membuka lampirannya atau menghubungi departemen IT apabila ragu.",
  },
  {
    en: "e) Unattended access: The Employee shall not leave the computer powered on, unlocked, or logged in while unattended.",
    id: "e) Akses tanpa pengawasan: Karyawan dilarang meninggalkan komputer dalam keadaan menyala, tidak terkunci, atau masih login tanpa pengawasan.",
  },
  {
    en: "f) Power management: The Employee shall turn off the monitor when leaving the desk and shut down the computer at the end of the workday.",
    id: "f) Pengelolaan daya: Karyawan wajib mematikan monitor saat meninggalkan meja kerja dan mematikan komputer pada akhir hari kerja.",
  },
  {
    en: "g) Physical protection: The Employee shall protect the Facility from damage caused by water, food, beverages, impact, heat, or other hazardous substances or conditions.",
    id: "g) Perlindungan fisik: Karyawan wajib melindungi Fasilitas dari kerusakan akibat air, makanan, minuman, benturan, panas, atau zat maupun kondisi berbahaya lainnya.",
  },
  {
    en: "h) Maintenance and compliance: The Employee acknowledges that the IT department may conduct periodic maintenance, inspection, and compliance checks with or without prior notice.",
    id: "h) Pemeliharaan dan kepatuhan: Karyawan memahami bahwa departemen IT dapat melakukan pemeliharaan berkala, inspeksi, dan pemeriksaan kepatuhan dengan atau tanpa pemberitahuan sebelumnya.",
  },
  {
    en: "i) Return obligation: Upon resignation, termination of employment, or request by the Company, the Employee shall return the Facility in good, complete, and working condition.",
    id: "i) Kewajiban pengembalian: Dalam hal pengunduran diri, berakhirnya hubungan kerja, atau permintaan dari Perusahaan, Karyawan wajib mengembalikan Fasilitas dalam kondisi baik, lengkap, dan berfungsi.",
  },
  {
    en: "4. In the event that the Facility is lost, damaged, broken, incomplete, or rendered unusable due to the Employee's negligence, misuse, failure to exercise reasonable care, unauthorized act, or other human error attributable to the Employee, the Employee shall be liable for the cost of repair or replacement of the Facility, as assessed and determined by the IT department. This clause shall not apply to reasonable wear and tear, aging, or performance degradation resulting from the Facility's normal, proper, and reasonable use.",
    id: "4. Dalam hal Fasilitas hilang, rusak, pecah, tidak lengkap, atau menjadi tidak dapat digunakan akibat kelalaian, penyalahgunaan, kegagalan untuk menerapkan kehati-hatian yang wajar, tindakan tanpa izin, atau kesalahan manusia lainnya yang dapat diatribusikan kepada Karyawan, Karyawan bertanggung jawab atas biaya perbaikan atau penggantian Fasilitas sebagaimana dinilai dan ditentukan oleh departemen IT. Klausul ini tidak berlaku atas pemakaian wajar, usia pakai, atau penurunan kinerja yang timbul dari penggunaan Fasilitas secara normal, semestinya, dan wajar.",
  },
];

/** The company named in the document. Fixed, not configurable. */
export const COMPANY_NAME = "PT. Patimban Global Gateway Terminal";

/** The issuer's line, as printed in the header. */
export const HEADER_ISSUER = "IT Department";

/** The footer block, split into the three lines the template prints. */
export const FOOTER_LINES = {
  company: "PT PATIMBAN GLOBAL GATEWAY TERMINAL",
  address:
    "Sentral Senayan III 15th Fl, Jl. Asia Afrika No. 8 Gelora Bung Karno – Senayan, Jakarta 10270 – INDONESIA",
  contact: "Mobile : +62 859 5987 5939|   T. +62 21 2567 6976 ext. 81974",
} as const;

/**
 * The document's own opening sentences, which name the two parties.
 *
 * Both are `{en, id}` for the same reason as `TERMS`. The blanks matter: the
 * template prints `Mr/Ms. ____________________` and the company name is *not* a blank
 * — the employee slot is, and the app fills it from the roster.
 */
export const PARTIES = {
  en: 'This Company Device Handover and Disclaimer (the "Disclaimer"), is entered into by and between:',
  id: 'Surat Serah Terima dan Pernyataan Perangkat Perusahaan ini ("Pernyataan"), dibuat oleh dan antara:',
} as const;

/** The sentence introducing the device table, on both sides. */
export const ACKNOWLEDGEMENT = {
  en: 'Employee acknowledges receipt of the following office devices or technology equipment (the "Facility") from PT. Patimban Global Gateway Terminal.',
  id: 'Karyawan menyatakan telah menerima perangkat kantor atau peralatan teknologi berikut (selanjutnya disebut "Fasilitas") dari PT. Patimban Global Gateway Terminal.',
} as const;

/**
 * The two signatures the document asks for.
 *
 * `company` is the issuer — the signed-in account, since that is who recorded the
 * handover and whose name the audit trail already holds. `employee` is the recipient
 * from the roster. Neither is hard-coded: the template's own sample values
 * (`Robby Baehaqi` / `Soehardono`) were placeholders for one printing.
 */
export const SIGNATURE_ROLES = {
  company: { en: "Given by", id: "Diberikan oleh" },
  employee: { en: "Received by", id: "Diterima oleh" },
} as const;
