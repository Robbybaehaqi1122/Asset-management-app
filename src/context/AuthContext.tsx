import type { AuthSession, AuthUser } from "@supabase/supabase-js";
import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";
import type { Profile } from "@/lib/profiles";
import { fetchProfile } from "@/lib/profiles";
import { setSessionPersistence, supabase } from "@/lib/supabase";

/**
 * Baris profil beserta user id yang memintanya. `userId` disimpan bersama
 * row-nya supaya baris milik user sebelumnya tidak pernah terekspos:
 * `profile` di bawah hanya mengembalikan row yang `userId`-nya cocok dengan
 * session yang sedang aktif.
 */
type ProfileState = {
  userId: string | null;
  row: Profile | null;
};

type AuthContextType = {
  session: AuthSession | null;
  user: AuthUser | null;
  /**
   * Baris `public.profiles` milik user yang sedang login, atau `null` kalau
   * belum ketemu. `null` berarti "belum tahu", bukan "bukan admin" — pakai
   * `useIsAdmin()` untuk bercabang, bukan membandingkan `role` manual.
   */
  profile: Profile | null;
  /** `true` selama Supabase masih memulihkan session dari storage. */
  isLoading: boolean;
  /**
   * `true` selama belum ada hasil fetch profil untuk user yang sedang login.
   * Terpisah dari `isLoading` karena keduanya menjawab pertanyaan berbeda:
   * `isLoading` soal session, yang ini soal role. `false` setelah fetch selesai
   * — termasuk ketika barisnya memang tidak ada, jadi ini tidak pernah
   * bergantung pada `profile` yang bisa saja `null` secara sah.
   */
  isProfileLoading: boolean;
  signIn: (
    email: string,
    password: string,
    keepSignedIn: boolean,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [profileState, setProfileState] = useState<ProfileState>({
    userId: null,
    row: null,
  });

  const userId = session?.user.id ?? null;

  // Diturunkan, bukan state tersendiri: begitu session berubah, row lama
  // langsung tidak lagi cocok dan otomatis tersembunyikan, tanpa perlu
  // `setState` sinkron di dalam efek.
  const profile =
    profileState.userId === userId && userId !== null ? profileState.row : null;

  const isProfileLoading = userId !== null && profileState.userId !== userId;

  useEffect(() => {
    // `onAuthStateChange` selalu menembakkan INITIAL_SESSION sekali di awal,
    // dengan session hasil pemulihan dari storage atau `null` kalau memang
    // belum login. Jadi satu langganan ini cukup untuk initial load dan untuk
    // pembaruan session berikutnya, tanpa `getSession()` terpisah.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) return;

    // `cancelled` menutup race saat sign out atau ganti akun terjadi di
    // tengah request: response-nya bisa tiba belakangan dan menimpa state
    // milik user yang baru.
    let cancelled = false;

    void fetchProfile(userId).then(
      (row) => {
        if (!cancelled) setProfileState({ userId, row });
      },
      () => {
        // Gagal dibaca tidak boleh menjatuhkan seluruh app — `profile` tetap
        // `null` dan `useIsAdmin()` mengembalikan `false`, yaitu arah yang
        // aman: aksi tulis tersembunyi, bukan terlihat lalu ditolak database.
        if (!cancelled) setProfileState({ userId, row: null });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const signIn = async (
    email: string,
    password: string,
    keepSignedIn: boolean,
  ) => {
    setSessionPersistence(keepSignedIn);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const requestPasswordReset = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
  };

  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        isLoading,
        isProfileLoading,
        signIn,
        signOut,
        requestPasswordReset,
        updatePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
