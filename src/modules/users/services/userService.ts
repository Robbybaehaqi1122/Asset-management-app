import type { Profile, ProfileRole } from "@/lib/profiles";
import { supabase } from "@/lib/supabase";

/**
 * Kolom yang dibaca modul ini. `auth.users` tidak bisa dijangkau dari browser,
 * jadi email diambil dari salinannya di `profiles`; lihat
 * `supabase/migrations/20260927000600_profiles_email.sql`.
 */
const USER_COLUMNS = "id, email, full_name, role, department, created_at";

/**
 * Teks persis yang dilempar `profiles_guard_last_admin`. Dicocokkan
 * bersamaan dengan kodenya supaya `check_violation` yang asli dari
 * `profiles_role_check` tidak salah dilabeli: yang itu muncul kalau pemanggil
 * mengirim role di luar `admin | staff`, dan daftar user ini tidak pernah
 * melakukannya.
 */
const LAST_ADMIN_MESSAGE = "Cannot remove the last admin";

/**
 * `true` kalau database menolak perubahan karena itu akan menghapus admin
 * terakhir.
 *
 * Layar sudah menghitung jumlah admin sebelum menawarkan perubahan, jadi ini
 * lapisan kedua: penutupnya kasus di mana admin lain menurunkan dirinya sendiri
 * di antara dua pembacaan itu. Keduanya menunjuk pesan yang sama, dan keduanya
 * tidak bisa dilewati dengan menyembunyikan tombol.
 */
export function isLastAdminError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: string; message?: string };
  return code === "23514" && message === LAST_ADMIN_MESSAGE;
}

/**
 * Semua profil, untuk admin.
 *
 * Tidak ada filter di sini, dan itu disengaja.
 * `profiles_select_own_or_admin` memberi admin seluruh baris dan staff
 * tepat satu baris, jadi pemanggilan sebagai non-admin mengembalikan profilnya
 * sendiri, bukan error. Pemanggil harus memeriksa dengan `useIsAdmin()`; itu
 * kenyamanan UI, dan policy yang benar-benar membatasi baris.
 *
 * Melempar kalau gagal, mengikuti konvensi `AuthContext` dan `fetchProfile`.
 */
export async function getAllUsers(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select(USER_COLUMNS)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as Profile[];
}

/**
 * Ubah role satu user.
 *
 * Mengirim `role` dan tidak ada kolom lain, jadi kolom sisanya tetap bernilai.
 * Database menerapkan dua pemeriksaan yang tidak bisa dilakukan fungsi ini:
 * `profiles_protect_role` menolak tulisan kecuali pemanggil adalah admin, dan
 * `profiles_guard_last_admin` menolak kalau hasilnya tidak menyisakan admin.
 *
 * Melempar kalau gagal, termasuk penolakan admin-terakhir — itu sebabnya
 * pemanggil memisahkannya dengan `isLastAdminError`.
 */
export async function updateUserRole(
  userId: string,
  role: ProfileRole,
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", userId);

  if (error) throw error;
}
