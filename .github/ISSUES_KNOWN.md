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

### 4. `profiles` tidak terhubung ke UI sama sekali

Tabelnya ada, RLS-nya benar, trigger signup-nya mengisi. Tapi tidak ada apa pun
di `src/` yang membacanya. `AuthContext` menyimpan session dan tidak lebih, jadi
frontend tidak punya cara tahu apakah user ini `admin` atau `staff`.

Konsekuensi paling nyata: staff akan **melihat** tombol "Hapus asset", mengklik
nya, dan mendapat `42501` tanpa penjelasan apa pun, karena UI tidak bisa
menyembunyikan aksi tulis yang tidak berhak dia jalankan. `department` juga
dikumpulkan lalu dibuang, dan `UserDropdown` menampilkan
`user_metadata.full_name` yang dikirim client, bukan `profiles.full_name` yang
dipiliki database. **Issue #38.**

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

### 8. Inline SVG di form auth

`SignInForm` dan `SignUpForm` masing-masing memuat logo Google dan X yang
di-inline langsung, melanggar aturan "never inline SVG" milik project sendiri.
Datang dari template dan convertnya di luar lingkup pekerjaan auth.
**Issue #42.**

---

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

Ini tidak bisa dicek di environment ini. Dinyatakan terbuka, bukan diasumsikan
berjalan. **Issue #43.**

- **Signup end-to-end lewat browser.** Jalur `auth.users` → trigger sudah
  diverifikasi dengan menyisipkan langsung ke `auth.users`. Tapi putaran
  sebenarnya `SignUpForm` → `signUp` → HTTP → database tidak pernah dijalankan,
  karena rate limit email Supabase sedang habis. Field `department` yang baru
  ditambahkan ke form belum pernah benar-benar diuji.
- **Pengiriman email reset password.** Jalur request memanggil API dan
  mengembalikan bentuk yang benar, tapi tidak ada email yang dikonfirmasi benar
  terkirim, dan putaran link pemulihan → session → update password belum pernah
  diuji. Stack lokal sekarang punya mail catcher di
  `http://127.0.0.1:54324`, jadi ini bisa diuji tanpa mengirim email sungguhan.
- **Development lokal dengan stack lokal.** Stack lokal sudah jalan dan keenam
  perintah verifikasi sudah dicoba, tapi tidak ada frontend yang pernah
  diarahkan ke `.env.local` versi lokal. `supabase/.env` berisi key lokal yang
  otomatis dipakai CLI, sedangkan `VITE_*` di `.env.local` masih menunjuk ke
  project remote.

---

## Yang sudah terbukti berfungsi

Dicatat supaya tidak diinvestigasi ulang. **Issue #45.**

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
