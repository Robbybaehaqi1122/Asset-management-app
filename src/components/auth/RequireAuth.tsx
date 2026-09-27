import AuthLoading from "@/components/auth/AuthLoading";
import MustChangePassword from "@/components/auth/MustChangePassword";
import { useAuth } from "@/context/AuthContext";
import type React from "react";
import { Navigate, Outlet, useLocation } from "react-router";

/**
 * Membungkus route yang hanya boleh dibuka setelah login. `location` disimpan
 * di state supaya halaman tujuan bisa dikembalikan setelah sign in berhasil.
 */
const RequireAuth: React.FC = () => {
  const { session, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <AuthLoading />;

  if (!session) {
    return (
      <Navigate to="/signin" replace state={{ from: location.pathname }} />
    );
  }

  // The advisory password gate wraps the outlet rather than being a route, so
  // it covers every protected screen at once and cannot be navigated around by
  // typing a path. See `MustChangePassword` for why it fails open.
  return (
    <MustChangePassword>
      <Outlet />
    </MustChangePassword>
  );
};

export default RequireAuth;
