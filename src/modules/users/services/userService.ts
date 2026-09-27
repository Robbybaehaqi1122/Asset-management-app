import type { Profile, ProfileRole } from "@/lib/profiles";
import { supabase } from "@/lib/supabase";

/**
 * Kolom yang dibaca modul ini. `auth.users` tidak bisa dijangkau dari browser,
 * jadi email diambil dari salinannya di `profiles`; lihat
 * `supabase/migrations/20260927000600_profiles_email.sql`.
 *
 * `must_change_password` wajib ikut, bukan opsional. `Profile` mendeklarasikannya
 * `boolean` dan kolomnya `not null default false`, jadi setiap baris yang
 * dikembalikan `SELECT` di sini punya nilainya. Melewatkan kolom ini bukan
 * sekadar tidak menampilkan badge — `data as Profile[]` akan tetap compiles,
 * sementara field-nya `undefined` saat runtime.
 *
 * Daftar ini adalah daftar *select*. Jaminan "hanya dua kolom" milik `updateUserDetails`
 * ada di payload `.update()`-nya, bukan di sini.
 */
const USER_COLUMNS =
  "id, email, full_name, role, department, created_at, must_change_password";

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

/** Dua kolom yang boleh diubah layar ini. */
export type ProfileDetails = {
  full_name: string;
  department: string | null;
};

/**
 * RLS menjawab dengan **nol baris, bukan error**, kalau pemanggil tidak berhak
 * menyentuh baris itu. Jadi request yang sudah `resolved` belum tentu mengubah
 * apa pun. `updateUserDetails` memverifikasi lewat `.select()` dan melempar ini
 * kalau tidak ada baris yang tersentuh, supaya pemanggil bisa membedakan
 * "tidak berubah" dari "selesai".
 */
export class NoRowsUpdatedError extends Error {
  constructor() {
    super("No profile row was updated");
    this.name = "NoRowsUpdatedError";
  }
}

/**
 * Ubah nama dan departemen satu user.
 *
 * Hanya dua kolom ini yang dikirim, dan itu yang membuat fungsi ini aman tanpa
 * satu migration pun. `profiles` punya tiga trigger, dan tidak satu pun menyala
 * untuk tulisan ini:
 *
 * - `protect_profile_email` adalah `before update **of email**`, jadi trigger
 *   `UPDATE OF` hanya berjalan kalau `email` ada di daftar kolom. Tidak ada.
 * - `guard_last_admin` juga `update of role`, jadi tidak ikut jalan.
 * - `protect_profile_role` memang `before update` tanpa `OF`, jadi ia tetap
 *   menyala — tapi ia melempar hanya kalau `new.role is distinct from
 *   old.role`, dan fungsi ini tidak pernah menyentuhnya. early return.
 *
 * `role` sengaja tidak ikut. Mengubahnya punya aturannya sendiri, dengan
 * konsekuensi yang berbeda: lihat `updateUserRole`.
 *
 * Mengembalikan baris yang sudah tertulis, jadi layar tidak perlu hope lalu
 * reload. Melempar kalau gagal, atau kalau RLS diam-diam menolak.
 */
export async function updateUserDetails(
  userId: string,
  details: ProfileDetails,
): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .update({
      full_name: details.full_name,
      department: details.department,
    })
    .eq("id", userId)
    .select(USER_COLUMNS)
    .maybeSingle();

  if (error) throw error;

  // RLS memfilter baris, bukan menolak statement-nya, jadi `error` di sini
  // tetap null meski tidak ada baris yang cocok. Tanpa pengecekan ini layar
  // akan menampilkan "tersimpan" untuk tulisan yang tidak pernah terjadi.
  if (!data) throw new NoRowsUpdatedError();

  return data as Profile;
}

/** Yang dikirim ke `create-user`. Satu-satunya tempat password masuk repo. */
export type NewUser = {
  email: string;
  password: string;
  full_name: string;
};

/**
 * Kode error dari Edge Function, bukan pesan GoTrue mentah.
 *
 * Function ini mengembalikan JSON sendiri dengan kode di dalamnya, jadi tidak
 * ada pesan dari Supabase yang pernah sampai ke layar — yang sampai ke sini
 * hanya string yang kita tentukan di `index.ts` atau, kalau function tidak
 * bisa dibaca, `unknown`.
 *
 * Daftar ini sengaja lengkap terhadap kode yang bisa dikembalikan function.
 * Layar memakainya lewat `t(\`errors.create.${error.code}\`)`, jadi satu kode
 * yang tidak punya terjemahan akan tampil sebagai jalur kunci mentah, bukan
 * pesan.
 */
export type CreateUserErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "invalid_email"
  | "name_required"
  | "weak_password"
  | "already_exists"
  | "not_configured"
  | "network"
  | "unknown";

export class CreateUserError extends Error {
  readonly code: CreateUserErrorCode;

  constructor(code: CreateUserErrorCode) {
    super(`create-user failed: ${code}`);
    this.name = "CreateUserError";
    this.code = code;
  }
}

/**
 * Hasil pemanggilan `create-user`.
 *
 * `mustChangeFlagSet` diteruskan dan tidak ditelan, karena `false` di sini
 * berarti akun ada dengan password milik admin sementara akun itu tidak akan
 * pernah diminta menggantinya. Itu bukan kegagalan yang bisa di-rollback dari
 * layar ini, jadi UI harus mengatakannya alih-alih diam.
 */
export type CreatedUser = {
  id: string;
  email: string;
  mustChangeFlagSet: boolean;
};

/**
 * Buat satu akun lewat Edge Function `create-user`.
 *
 * Function ini satu-satunya tempat di project yang memakai Admin API. Lekukan
 * karena `auth.admin.createUser` butuh `service_role`, dan key itu tidak boleh
 * masuk browser.
 *
 * Yang dikembalikan cuma `id`, `email`, dan apakah flag "wajib ganti" berhasil
 * dipasang. Role dan departemen sengaja tidak, dan itu bukan kelupaan: kolom
 * `role` dilindungi `protect_profile_role`, yang menolak tulisan yang tidak
 * dilakukan admin, dan penulisan lewat service role akan ditolak trigger itu
 * karena `auth.uid()` kosong untuk permintaan tanpa JWT. Keduanya ditulis
 * browser sesudahnya, lewat `updateUserDetails` dan `updateUserRole`.
 */
export async function createUser(input: NewUser): Promise<CreatedUser> {
  const { data, error } = await supabase.functions.invoke("create-user", {
    body: input,
  });

  if (error) {
    // `error.context` adalah Response-nya, jadi kode ada di dalam body. Kalau
    // function tidak sempat menjawab — belum ter-deploy, atau tidak ada
    // internet — yang tersisa hanya `unknown`.
    let code: CreateUserErrorCode = "unknown";
    const context = error.context;
    if (context instanceof Response) {
      try {
        const body = (await context.json()) as { error?: string };
        if (body?.error === "method_not_allowed") code = "network";
        else if (typeof body?.error === "string") {
          code = body.error as CreateUserErrorCode;
        }
      } catch {
        code = "unknown";
      }
    }
    throw new CreateUserError(code);
  }

  const created = data as {
    id?: string;
    email?: string;
    mustChangeFlagSet?: boolean;
  } | null;
  if (typeof created?.id !== "string") {
    throw new CreateUserError("unknown");
  }

  return {
    id: created.id,
    email: created.email ?? input.email,
    // An older deployment of the function returns neither field, and defaults
    // the flag to false. That is the right default on purpose: the alternative
    // would have the screen claim the user will be asked to change a password
    // that nothing is going to ask them for.
    mustChangeFlagSet: created.mustChangeFlagSet === true,
  };
}
