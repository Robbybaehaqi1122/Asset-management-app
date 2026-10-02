import PublicOnlyRoute from "@/components/auth/PublicOnlyRoute";
import RequireAuth from "@/components/auth/RequireAuth";
import { Route, BrowserRouter as Router, Routes } from "react-router";
import { ScrollToTop } from "./components/common/ScrollToTop";
import AppLayout from "./layout/AppLayout";
import AssetSettingsPage from "./modules/asset-settings/pages/AssetSettingsPage";
import AssetListPage from "./modules/assets/pages/AssetListPage";
import HandoverListPage from "./modules/handover/pages/HandoverListPage";
import DepartmentListPage from "./modules/departments/pages/DepartmentListPage";
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
              <Route path="/departments" element={<DepartmentListPage />} />
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
