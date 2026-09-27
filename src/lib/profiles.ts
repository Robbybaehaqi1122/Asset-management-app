import { supabase } from "./supabase";

/**
 * Dua nilai yang mungkin dimiliki `profiles.role`. Yang mana yang sah
 * ditentukan Postgres lewat check constraint, bukan enum dan bukan tipe
 * database — lihat `supabase/migrations/20260927000100_schema.sql`.
 */
export type ProfileRole = "admin" | "staff";

/**
 * Satu baris `public.profiles`.
 *
 * Ditulis tangan, bukan hasil generate, karena tidak ada `Database` generic
 * yang dioper ke `createClient`. Konsekuensinya `role` di sini percaya
 * string yang PostgREST kirim tanpa memeriksa isinya — jaminan bahwa
 * nilainya `admin` atau `staff` datang dari check constraint di database,
 * bukan dari tipe ini.
 *
 * `full_name` dan `department` nullable: trigger menyalinnya dari metadata
 * signup, dan metadata itu bisa tidak punya kedua key tersebut.
 *
 * `email` nullable karena baris lama bisa saja tidak punya salinannya —
 * lihat `supabase/migrations/20260927000600_profiles_email.sql`. Ia adalah
 * **denormalisasi** dari `auth.users.email`, bukan sumber kebenaran: sign-in
 * dan reset password tetap membaca `auth.users`. Kolom ini hanya supaya daftar
 * user bisa menampilkan dan menanyakan email tanpa `service_role`.
 */
export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: ProfileRole;
  department: string | null;
  created_at: string;
};

/**
 * Ambil profil milik `userId`.
 *
 * User non-admin hanya boleh melihat barisnya sendiri, jadi pemanggil tidak
 * perlu memfilter atau menerapkan aturan RLS-nya sendiri — `maybeSingle`
 * mengembalikan `null` kalau barisnya memang tidak ada atau tidak terlihat.
 *
 * Melempar kalau request-nya gagal, mengikuti konvensi `AuthContext`: context
 * menyimpan state React, sedangkan kegagalan datastore diekspos sebagai
 * exception supaya call site memakai `try` / `catch`.
 */
export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, department, created_at")
    .eq("id", userId)
    .maybeSingle<Profile>();

  if (error) throw error;
  return data;
}
