import PublicOnlyRoute from "@/components/auth/PublicOnlyRoute";
import RequireAuth from "@/components/auth/RequireAuth";
import { Navigate, Route, BrowserRouter as Router, Routes } from "react-router";
import { ScrollToTop } from "./components/common/ScrollToTop";
import AppLayout from "./layout/AppLayout";
import AssetSettingsPage from "./modules/asset-settings/pages/AssetSettingsPage";
import AssetListPage from "./modules/assets/pages/AssetListPage";
import HandoverListPage from "./modules/handover/pages/HandoverListPage";
import OrganisationPage from "./modules/organisation/pages/OrganisationPage";
import PermissionListPage from "./modules/permissions/pages/PermissionListPage";
import SystemSettingPage from "./modules/system-settings/pages/SystemSettingPage";
import UserListPage from "./modules/users/pages/UserListPage";
import SignIn from "./pages/AuthPages/SignIn";
import Calendar from "./pages/Calendar";
import Dashboard from "./pages/Dashboard/Dashboard";
import Blank from "./pages/OtherPage/Blank";
import NotFound from "./pages/OtherPage/NotFound";
import Profile from "./pages/Profile/Profile";
import ResetPassword from "./pages/AuthPages/ResetPassword";

export default function App() {
  return (
    <>
      <Router>
        <ScrollToTop />
        <Routes>
          {/* Terlindungi login */}
          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route index path="/" element={<Dashboard />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/profile" element={<Profile />} />
              {/* Hanya `RequireAuth`, bukan admin guard: halaman mereka sendiri
                  yang menolak non-admin. RLS sudah membatasi baris mana yang
                  terlihat, dan menambah route guard kedua hanya akan jadi lapisan
                  UI yang tidak menambah keamanan. */}
              <Route path="/users" element={<UserListPage />} />
              {/* Departments, job titles and employers on one screen, three tabs.
                  One entry in the menu instead of three, and inside User Management
                  rather than in a group of its own.

                  Reads are `using (true)` on all three tables, so they are not gated
                  here the way `/users` is — the page refuses to render for a
                  non-admin and the three write policies are the boundary. */}
              <Route path="/organisation" element={<OrganisationPage />} />
              {/* The three pages these were before they became tabs.
                  `<Navigate replace>` rather than deletion: a bookmark, a shared
                  link or a habit typed into the address bar still lands somewhere
                  real, and the browser history entry is replaced instead of stacked
                  — which is what keeps the back button from trapping the reader on a
                  redirect that redirects. */}
              <Route
                path="/departments"
                element={<Navigate to="/organisation" replace />}
              />
              <Route
                path="/positions"
                element={<Navigate to="/organisation" replace />}
              />
              {/* Companies: the employer of a person on the handover roster. **Referenced,
                  and a comment here once said otherwise** — it claimed "nothing
                  references it yet — no asset, department or roster row carries
                  a `company_id`", true when written and false from `02700`. That
                  stale sentence is what made the feature look like dead weight
                  worth deleting, so the trap is named: `companies` has no
                  reference from the **asset** register, which is easy to read as
                  no reference at all.

                  It is referenced twice. `handover_users.company_id` fills a
                  picker on the roster form, and `HandoverPrintModal` prints the
                  name in the issuer's signature block and the recipient's parties
                  block — a field on a document somebody signs. What `02600`
                  records as the stopping point is that no asset carries a company,
                  not that nothing does. */}
              <Route
                path="/companies"
                element={<Navigate to="/organisation" replace />}
              />
              {/* Per-person menu access, `user_menu_permissions` from migration `03500`.

                  Modul sendiri, bukan tab di `/users`: yang ini menjawab "layar mana
                  yang boleh dibuka oleh orang ini", sementara `users` menjawab "siapa
                  orang ini dan apa akunnya". Keduanya berubah sendiri, dan digabung jadi
                  satu form yang isinya checkbox dan reset password.

                  Tanpa route-level admin guard, sama seperti `/users` di atas: policy
                  `user_menu_permissions_*_admin` yang menolak, dan halamannya sendiri
                  yang menolak render lewat `useIsAdmin()`.

                  Catatan penting soal route ini: ia **menyempitkan** menu staff, tidak
                  pernah memperluas. Admin tetap melewati semua penyaringan, dan batas
                  unit pada dua baris aset masih di-AND dengan izin ini. */}
              <Route path="/permissions" element={<PermissionListPage />} />
              {/* `assets_select_authenticated` adalah `using (true)` dan stok
                  bukan milik satu departemen, jadi kedua halaman ini juga untuk
                  staff. Yang admin-only di dalamnya adalah kredensial: RLS
                  menyembunyikan barisnya, sehingga staff tidak pernah
                  menerimanya di respons.

                  Satu route per unit, bukan satu halaman dengan filter unit.
                 dipilih unit di dalam form berarti aset HSSE bisa dibuat dari
                  halaman IT lalu langsung hilang dari sana — persis masalah yang
                  pemisahan ini menutup. Sekarang unit datang dari route, jadi
                  `assets.department` tidak pernah diisi client: trigger
                  `assets_sync_department` yang menimpanya dari kategori. */}
              <Route path="/assets" element={<AssetListPage unit="IT" />} />
              <Route
                path="/assets-hsse"
                element={<AssetListPage unit="HSSE" />}
              />
              {/* Handover: tabel `assignments` sudah ada sejak `001`, lengkap
                  dengan RLS dan trigger status, tapi belum ada layar yang
                  memakainya.

                  Satu route, bukan satu per unit — kebalikan dari `/assets` di
                  atas, dan itu pilihan yang disengaja. Handover tidak membuat
                  data: satu daftar berisi catatan siapa sedang memegang apa,
                  jadi pemisahan tidak menambah informasi apa pun, hanya cara
                  mencari. Unit-nya jadi tombol filter di dalam halaman, persis
                  seperti unit filter di `/asset-settings`, dan filter tetap di
                  SQL lewat `.eq("asset.department", unit)` — mengganti unit
                  reload, bukan memfilter ulang hasil yang sudah terunduh.

                  Yang tetap per unit adalah `/assets` dan `/assets-hsse`: page
                  itu menulis baris, dan form-nya memilih fieldset berbeda
                  seluruhnya menurut unit, jadi filter di dalam form akan
                  memungkinkan HSSE dibuat dari halaman IT lalu hilang dari sana. */}
              <Route path="/handover" element={<HandoverListPage />} />
              {/* Master data yang jadi sumber dropdown form aset. Dasarnya bukan
                  tabel baru: `categories` (dua level lewat `parent_id`) dan
                  `locations` sudah jadi referensi, dan `assets.category_id` /
                  `assets.location_id` sudah menunjuk ke sana. */}
              <Route path="/asset-settings" element={<AssetSettingsPage />} />
              {/* Konfigurasi untuk instalasi ini, bukan data inventaris. Berdiri
                  sendiri dari `/asset-settings` yang sudah memiliki referensi
                  untuk picker form aset — keduanya soal dua hal berbeda, jadi
                  tidak digabung. */}
              <Route path="/system-setting" element={<SystemSettingPage />} />
              <Route path="/blank" element={<Blank />} />
            </Route>
          </Route>

          {/* Hanya untuk yang belum login. Tidak ada `/signup`: user dibuat
              oleh admin, bukan mendaftar sendiri. */}
          <Route element={<PublicOnlyRoute />}>
            <Route path="/signin" element={<SignIn />} />
          </Route>

          {/* Sengaja di luar kedua guard: link recovery Supabase membuat session
              saat dibuka, jadi PublicOnlyRoute akan memantulkan user balik. */}
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Fallback Route */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Router>
    </>
  );
}
