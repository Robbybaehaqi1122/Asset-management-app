import PublicOnlyRoute from "@/components/auth/PublicOnlyRoute";
import RequireAuth from "@/components/auth/RequireAuth";
import { Route, BrowserRouter as Router, Routes } from "react-router";
import { ScrollToTop } from "./components/common/ScrollToTop";
import AppLayout from "./layout/AppLayout";
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
              {/* Hanya `RequireAuth`, bukan admin guard: halamannya sendiri yang
                  menolak non-admin. RLS sudah membatasi baris mana yang terlihat,
                  dan menambah route guard kedua hanya akan jadi lapisan UI yang
                  tidak menambah keamanan. */}
              <Route path="/users" element={<UserListPage />} />
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
