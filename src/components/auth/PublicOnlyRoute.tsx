import AuthLoading from "@/components/auth/AuthLoading";
import { useAuth } from "@/context/AuthContext";
import type React from "react";
import { Navigate, Outlet } from "react-router";

/**
 * Kebalikan dari `RequireAuth` — untuk `/signin`. Sudah login tidak ada
 * gunanya menampilkan form lagi, langsung lempar ke dashboard.
 */
const PublicOnlyRoute: React.FC = () => {
  const { session, isLoading } = useAuth();

  if (isLoading) return <AuthLoading />;

  if (session) return <Navigate to="/" replace />;

  return <Outlet />;
};

export default PublicOnlyRoute;
