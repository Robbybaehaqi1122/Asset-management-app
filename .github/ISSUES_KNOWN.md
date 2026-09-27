# Isu yang diketahui setelah wiring Supabase auth + database

Supabase auth sudah terhubung dan schema database sudah ter-apply ke
`dnyszknpinqvcfkmoauz`. Tidak ada yang rusak di sini — alur auth maupun
penegakan RLS keduanya berfungsi. Ini daftar hal yang salah, belum lengkap, atau
belum bisa diverifikasi, supaya kelihatan sekarang dan tidak baru ditemukan
nanti.

Severity itu soal risiko, bukan soal usaha. **Tinggi** berarti celah keamanan,
atau sesuatu yang akan merusak data begitu dipakai sungguhan.

Tiap isu punya issue sendiri di tab Issues. Referensi ada di dalam paragraf
pembuka masing-masing issue.

---

## Tinggi

### 1. Tidak ada cara menjalankan migration di mesin lain tanpa langkah manual

`supabase link` wajib dijalankan sebelum `supabase db push`, tapi project ref
disimpan di `supabase/.temp/project-ref` yang memang sudah di-gitignore dengan
benar. Clone baru karena itu tidak bisa langsung push, dan pesan errornya
(`Cannot find project ref. Have you run supabase link?`) tidak menyebut folder
mana yang sedang dipakai, dan tidak menyebut bahwa `link` dilewati. Inilah yang
terjadi saat setup.

Tidak ada apa pun di repo ini yang mencatat urutan yang diperlukan. **Issue #35.**

### 2. ~~Docker tidak terpasang~~ — **sudah selesai**

Docker Desktop 4.92.0 dengan backend WSL2 sudah terpasang dan `supabase start`
menjalan. `db lint --local`, `db reset --local`, `db diff --linked`, dan
`db dump --linked` semuanya berfungsi.

Dampaknya ke jaring pengaman schema:

- `db diff --linked` melaporkan `No schema changes found`, jadi file migration
  yang ada di git benar-benar identik dengan database remote. Perubahan yang
  dibuat lewat Supabase Studio tidak lagi tak terlihat.
- `db reset --local` menjadi gerbang pra-push. Migration yang rusak gagal dengan
  exit 1 di lokal, sebelum menyentuh remote — dan ini menutup risiko yang
  disebut di issue #36, yaitu remote ter-apply sebagian.

**Issue #36.**

### 3. ~~Migration hanya bisa di-apply sekali~~ — **sudah terdokumentasi**

Perilakunya sudah diuji satu per satu, dan satu asumsi ternyata salah:

- **`db push` tidak "menolak"** — ia melaporkan `Remote database is up to date.`
  dan keluar dengan status 0, bahkan kalau schema remote sudah berbeda dari file.
  Jadi `db push --dry-run` bukan gerbang; ia akan terlihat berhasil sambil tidak
  memperbaiki apa pun.
- Menjalankan ulang file secara manual gagal di statement pertama dengan
  `relation "profiles" already exists`.
- Yang menentukan apa yang sudah ter-apply adalah tabel
  `supabase_migrations.schema_migrations`, bukan isi schema itu sendiri.
- Pemulihan hanya lewat `supabase db reset`, dan **tidak ada padanannya untuk
  remote**.

Rapia utamanya adalah trigger `on_auth_user_created` yang menempel di
`auth.users`, tabel yang dikelola platform. Kalau hilang, signup tetap berhasil
dan baris tetap masuk ke `auth.users`, tapi tidak ada profil yang pernah dibuat —
tanpa error apa pun. Perbaikannya lewat migration **baru**, bukan dengan
mengedit `002`, karena versi `002` sudah tercatat di ledger sehingga editnya
tidak akan pernah dijalankan.

Deteksi sekarang sudah tersedia. `db diff --linked` terbukti mencakup schema
`auth` di kedua arah, jadi `No schema changes found` menjamin trigger itu masih
terpasang — bukan hanya bahwa schema `public` cocok. **Issue #37.**

---

## Sedang

### 4. `profiles` masih read-only untuk non-admin

Tercakup sebagian. Admin bisa mengubah `full_name` dan `department` siapa saja dari
`/users`, dan `updateUserDetails` sudah terbukti aman terhadap ketiga trigger yang
ada di `profiles` — dua di antaranya `UPDATE OF` pada kolom yang tidak dikirim, dan
ketiganya hanya melempar kalau `role` benar-benar berubah. Nol migration.

Yang masih belum ada: **staff tidak punya UI untuk mengubah namanya sendiri.**
RLS dan ketiga trigger sama-sama mengizinkan itu — sudah diuji lokal, dan berhasil —
tapi `/profile` sengaja read-only, jadi satu-satunya jalan masuk adalah `/users`
yang hanya untuk admin. Artinya seorang staff bisa mengubah namanya di level
database, dan tidak bisa sama sekali di level aplikasi.

Ffaktor yang memperparah: `UserDropdown` sudah membaca `profile.full_name` lebih
dulu, jadi begitu nama diedit di `/users` header ikut berubah — sementara
`user_metadata.full_name`, yang dulu jadi sumber nama di situ, kini tidak dibaca
siapa pun. `profiles.full_name` sekarang satu-satunya sumber nama di shell.

Halaman `/profile` sengaja read-only, jadi "Edit profile" di dropdown masih
menjanjikan sesuatu yang belum ada. **Issue #38.**

### 5. Signup pertama otomatis mendapat `admin`

`handle_new_user` memberi `admin` ke user pertama, lalu `staff` ke semua yang
setelahnya. Tanpa itu, project terkunci read-only selamanya: `role` default
`staff`, staff tidak bisa mengubah `role`, dan tidak ada admin yang bisa
memberikannya.

Perlindungannya ada — `pg_advisory_xact_lock` membuat dua signup bersamaan tidak
menang dua-duanya, sudah diuji — tapi jendelanya terbuka dari project dibuat
sampai signup pertama, dan signup email Supabase masih aktif. Siapa pun yang
signup duluan memiliki seluruh database. **Issue #39.**

### 6. `assets.status` dan `assignments` tidak sinkron

Tidak ada yang memperbarui `assets.status` saat assignment dibuat atau
dikembalikan. Tiga kondisi bertentangan semua bisa terjadi dan semua diterima
database: `available` padahal ada loan terbuka, `assigned` padahal tidak ada,
dan `retired` padahal masih dipinjam orang.

Yang **sudah** ditegakkan adalah dua guard trigger yang menjaga maintenance vs
checkout, keduanya terverifikasi dengan pesan error sungguhan. Yang belum ada
adalah pengikat `status` dengan fakta ada/tidaknya loan. **Issue #40.**

### 7. `UserDropdown` masih mengarah ke route yang tidak ada

Tiga `DropdownItem` menuju `/profile`, yang tidak terdaftar di `src/App.tsx`, jadi
mendarat di 404. Perilaku bawaan template, tapi `/profile` adalah tempat yang
wajar untuk menampilkan `profiles` dan `role`, jadi ini akan tersentuh oleh #38
juga. **Issue #41.**

### 8. ~~Inline SVG di form auth~~ — **sudah selesai**

`SignInForm` dan `SignUpForm` masing-masing memuat logo Google dan X yang
di-inline langsung, melanggar aturan "never inline SVG" milik project sendiri.
Datang dari template dan convertnya di luar lingkup pekerjaan auth.
**Issue #42.**

Kedua logo sekarang tinggal di `src/icons/google.svg` dan `src/icons/x.svg`
dan dipakai lewat `<GoogleIcon />` dan `<XIcon />` dari barrel, jadi blok SVG
yang terduplikasi di dua form itu tidak ada lagi. Label tombolnya ikut
disederhanakan: `auth.withGoogle` / `auth.withX` yang semula top-level sudah
pindah ke `auth.signIn.*` dan `auth.signUp.*`, supaya "Sign in" / "Sign up"
pun ikut diterjemahkan dan bukan lagi string Inggris yang ditulis mati.

Satu hal sengaja **tidak** dibersihkan: `google.svg` masih memakai hex merek
(`#4285F4`, `#34A853`, `#FBBC05`, `#EB4335`) di dalam file, bukan di
`className`. Logo Google memang multi-warna dan itulah yang membuatnya logo
Google — mewarnakannya dengan theme token akan membuatnya berhenti menjadi logo
itu sendiri, jadi pengecualiannya didokumentasikan di tabel "Decisions to
preserve" di `AGENTS.md`. `x.svg` monokrom memakai `currentColor`, jadi
ikut warna teks tombol di kedua tema tanpa tambahan apa pun.

Inline SVG masih ada di `Alert.tsx`, `Modal`, `PageBreadCrumb`, `Select`, dan
`MultiSelect`. Itu di luar lingkup issue #42 dan belum punya nomornya sendiri.

---

### 13. User management tidak bisa membuat atau menghapus akun

Layar `/users` hanya membaca dan mengubah `role`. Membuat akun butuh
`supabase.auth.admin`, yang butuh `service_role`, dan meletakkannya di browser
melanggar aturan repo. Menghapus lebih buruk daripada tidak ada: `assignments`
adalah `on delete cascade` dari `profiles`, jadi menghapus profil menghapus
riwayat peminjaman orang itu **dan** mengembalikan asetnya ke `available` tanpa
jejak, karena `assignments_sync_asset_status` ikut menyala.

Jalur yang benar adalah Supabase Edge Function; `supabase/functions/` belum ada.
Tombol "Add user" sengaja `disabled` dengan alasannya di `title`.

### 14. `profiles.email` bisa basi

Salinan dari `auth.users.email` yang ditulis trigger. Alamat yang diganti manual
di Auth tidak muncul di daftar admin sampai backfill dijalankan ulang — dan
backfill itu sendiri diblokir `profiles_protect_email` kecuali pemanggilnya
admin. Admin bisa memperbaikinya lewat aplikasi. **Issue #48.**

## Rendah

### 9. `npx prettier --check` tidak bisa dipakai apa adanya

Tidak ada `.gitattributes` dan `core.autocrlf=true` di Windows, jadi semua file
checkout sebagai CRLF sementara Prettier default ke `endOfLine: "lf"`. Setiap
file gagal, termasuk yang baru saja `prettier --write`. Pakai
`npx prettier --check --end-of-line crlf` untuk melihat drift yang sebenarnya.
**Issue #44.**

### 10. Lint punya 5 warning, bukan 4 seperti tertulis di `AGENTS.md`

Semuanya `react-refresh/only-export-components`. Yang baru adalah
`AuthContext.tsx` yang mengexport hook bersama provider. 0 error. **Issue #44.**

### 11. Bundle 962 kB dan akan tetap sebesar itu

`@supabase/supabase-js` menarik realtime, PostgREST, dan storage client yang
belum dipakai — sekitar 760 kB dari total. Tidak ada subpackage auth-only untuk
v2, dan `@supabase/auth-js` hanya dependency transitif, jadi memakainya langsung
berarti menambahkannya secara eksplisit. Tinjau ulang hanya kalau ukuran bundle
benar-benar jadi keluhan. **Issue #44.**

### 12. `package.json` tidak punya field `engines`

Vite 8 butuh Node `^20.19.0 || >=22.12.0` dan tidak ada yang menegakkan, jadi
kontributor di Node 18 mendapat kegagalan yang membingungkan. **Issue #44.**

---

## Belum terverifikasi

Tiga butir yang tadinya terbuka sudah dijalankan terhadap **stack lokal**,
bukan project remote — jadi blokir rate limit email hilang tanpa perlu
menyentuh data produksi. Semua yang bisa diuji tanpa browser sudah diuji.
**Issue #43.**

Yang **masih** belum terverifikasi, dan hanya bisa ditutup dengan browser
manusia sungguhan:

- **Klik lewat di UI.** Yang terbukti adalah HTTP-nya: `signUp` →
  `confirm-email`, email konfirmasi sampai ke mail catcher, link-nya `303` ke
  app dengan token di hash, `setSession` dari hash itu berhasil,
  `updatePassword` berhasil, lalu login dengan password baru berhasil dan
  password lama ditolak `invalid_credentials`. Yang belum ada seseorang yang
  benar-benar mengetik di `/signin` dan `/signup` dan melihat hasilnya di
  layar, termasuk `Profile.tsx` membaca baris `profiles` yang sama.

**Dua hal yang berubah sifatnya, bukan cuma statusnya:**

- **`redirectTo` bisa diabaikan diam-diam.** Ditemukan, diperbaiki di repo, dan
  sekarang terdokumentasi di `AGENTS.md` → "`redirectTo` is silently ignored when
  the exact URL is not allow-listed". Aturannya asimetrik, dan itu bagian yang
  bikin satu jam hilang: **`site_url` dicocokkan sebagai prefix** sehingga path
  bebas, tapi entri `additional_redirect_urls` harus **persis** termasuk path.
  Dulu hanya origin `localhost:5173` yang thinking allows — yang justru address
  dari `npm run dev` — tetap ditolak, dan API mengembalikan `error: null`.
  `supabase/config.toml` sekarang memuat kedua URL dev secara penuh.
  **Sudah dikonfirmasi di produksi:** link untuk
  `https://pgt-asset.vercel.app/reset-password` mendarat tepat di origin itu,
  bukan fallback. `alg` JWT `ES256`, dan sesi hasil pemulihan hanya membaca baris
  `profiles` sendiri.
  **Yang masih terbuka:** allow-list project remote harus memuat
  `http://localhost:5173/reset-password` juga, karena `.env.local` mengarahkan
  dev server ke project **remote**. Tanpa itu, reset password di dev lokal rusak
  diam-diam — dan stack lokal justru menutupinya, sehingga sulit terlihat.
- **Stack lokal auto-confirm email.** `supabase/config.toml` punya
  `enable_confirmations = false`, jadi signup di lokal selalu mengembalikan
  session dan cabang `confirm-email` di `SignUpForm` tidak pernah tersentuh.
  Cabang itu diverifikasi dengan mematikan flag itu sementara, lalu
  `config.toml` dikembalikan persis (hash blob tidak berubah). Di project
  remote, email confirmation aktif, jadi **`sessionCreated === false` adalah
  cabang yang paling sering dipakai di produksi** dan sekarang barulah
  terbukti.

---

## Yang sudah terbukti berfungsi

Dicatat supaya tidak diinvestigasi ulang. **Issue #45.**

- **Signup end-to-end lewat HTTP** (`SignUpForm` → `auth.signUp` → DB), dengan
  bentuk `options.data` yang sama persis dengan yang dikirim form. Yang jadi
  kunci: `full_name` = "Verify One" (first + last digabung), `department`
  = "Operations" tersimpan, `id` profil = `auth.users.id`. Kekhawatiran utama
  issue #43 justru "kalau bentuknya salah, trigger akan menyimpan NULL dan
  tidak akan ada yang protes" — sekarang terbukti bentuknya benar.
- **Kedua cabang signup.** `sessionCreated === true` (auto-confirm) dan
  `sessionCreated === false` (email confirmation) keduanya dijalankan. Yang
  kedua: login ditolak `email_not_confirmed` sebelum konfirmasi, email sampai,
  link `303` dengan `type=signup`, lalu login berhasil.
- **Putaran reset password penuh.** Request → email sampai di mail catcher
  `http://127.0.0.1:54324` → link `verify` → `303` ke
  `/reset-password#access_token=…&type=recovery` → `setSession` → ganti
  password → login dengan yang baru berhasil, yang lama ditolak.
- **Hash, bukan query parameter, dan tanpa `code`.** Link pemulihan membawa
  `access_token` + `type=recovery` di **fragment**. Tidak ada `code`, jadi
  `flowType: "implicit"` + `detectSessionInUrl: true` memang satu-satunya
  konfigurasi yang cocok, dan `BrowserRouter` tidak melewati fragment itu.
- **`fetchProfile` gagal tertutup, bukan terbuka.** Meminta id milik user lain
  mengembalikan `null`, **bukan error** — RLS menyaring baris, bukan menolak
  pernyataan. `AuthContext` bisa menganggapnya "belum tahu" dan aman.
- **Role tidak ada di JWT.** `user.app_metadata.role` kosong pada user sungguhan,
  yang memang alasan seluruh desain `AuthContext` + `useIsAdmin` ada.
- **Eskalasi lewat metadata diabaikan.** `options.data: { …, role: "admin" }`
  pada signup kedua tetap menghasilkan `staff`.
- **Dev server terhadap stack lokal.** `vite --mode` dengan file env terpisah
  menyajikan `/`, `/src/main.tsx`, `/src/App.tsx`, `/src/index.css` (semua
  200). Modul `src/lib/supabase.ts` yang ditransformasi memuat
  `"VITE_SUPABASE_URL": "http://127.0.0.1:54321"` dan **nol** kemunculan
  domain remote. `anon` ke PostgREST lokal tetap ditolak `42501`.
- **Rantai migration masih bisa di-apply dari nol.** `db reset --local`
  menerapkan kelima file berurutan tanpa error, dan trigger `on_auth_user_created`
  masih menempel setelah reset.
- Rantai tiga migration ter-apply bersih; `supabase db lint --linked` melaporkan
  `No schema errors found`; Postgres 17.6.1 cocok dengan `major_version = 17`.
- `anon` tidak bisa membaca satu pun dari 6 tabel (`42501`).
- User `staff` melihat hanya profil sendiri, tidak bisa membaca profil lain,
  tidak bisa mengubah `role` sendiri, tidak bisa insert ke tabel referensi, dan
  tidak bisa memalsukan profil — semuanya ditolak dengan pesan yang diharapkan.
- User `admin` melihat semua profil, bisa menulis tabel referensi, dan bisa
  mengubah `role` user lain.
- Metadata signup `{"role":"admin"}` diabaikan; user kedua tetap dapat `staff`.
- Asset tidak bisa masuk `maintenance` saat dipinjam, tidak bisa checkout saat
  di `maintenance`, dan `maintenance` tetap bisa dicapai sebagai status.
- `npm run build` lolos (962.08 kB). `npm run lint` 0 error.
- Database dikosongkan setelah pengujian: 0 user, 0 profile, 0 asset.
