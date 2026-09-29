import type { Profile, ProfileRole } from "@/lib/profiles";
import { toProfile } from "@/lib/profiles";
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
 *
 * `department:departments(id, name)` adalah embed, bukan kolom. Yang menjadi
 * foreign key adalah `department_id`, dan hasilnya diletakkan di alias
 * `department` supaya `Profile.department` tetap berupa `DepartmentRef | null`
 * dan penampilannya tetap `row.department?.name`.
 */
const USER_COLUMNS =
  "id, email, full_name, role, created_at, must_change_password, " +
  "department:departments(id, name)";

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

  // Mapped rather than cast, because the department arrives as an embedded
  // object and `departmentName` does not exist in the response at all. Casting
  // here would hand the caller a `Profile` whose `departmentName` is
  // `undefined` while the type promises `string | null` — the same type lie
  // that made `must_change_password` a problem before it was added to the
  // select list.
  return (data ?? []).map(toProfile);
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
  /**
   * A `departments` id, or `null` for "not set".
   *
   * An id and not a name, so the write cannot introduce a department that does
   * not exist — the foreign key refuses it, and the picker is only ever
   * populated from rows that do.
   */
  department_id: string | null;
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
      department_id: details.department_id,
    })
    .eq("id", userId)
    .select(USER_COLUMNS)
    .maybeSingle();

  if (error) throw error;

  // RLS memfilter baris, bukan menolak statement-nya, jadi `error` di sini
  // tetap null meski tidak ada baris yang cocok. Tanpa pengecekan ini layar
  // akan menampilkan "tersimpan" untuk tulisan yang tidak pernah terjadi.
  if (!data) throw new NoRowsUpdatedError();

  return toProfile(data);
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

/** Mirrors the union above. Used to reject a code we have no message for. */
const KNOWN_CODES: ReadonlySet<string> = new Set<CreateUserErrorCode>([
  "unauthenticated",
  "forbidden",
  "invalid_email",
  "name_required",
  "weak_password",
  "already_exists",
  "not_configured",
  "network",
  "unknown",
]);

/**
 * Hasil pemanggilan `reset-password`.
 *
 * `mustChangeFlagSet` means here what it means on `CreatedUser`, for the same
 * reason, and its `false` default is deliberate in the same direction: a
 * response that omits it must never be read as "this person will be asked to
 * change the password".
 */
export type ResetPasswordResult = {
  id: string;
  email: string | null;
  mustChangeFlagSet: boolean;
};

/**
 * Kode error dari Edge Function `reset-password`.
 *
 * `unauthenticated`, `forbidden`, `not_configured` and `network` are the same
 * four every other call in this module can produce and mean the same thing.
 * `not_found` is the account having gone away; `invalid_id` and `weak_password`
 * are the two the function validates before it touches anything.
 *
 * There is deliberately no `self_delete` and no `last_admin`, unlike
 * `DeleteUserErrorCode`. Neither would protect anything: replacing a password
 * does not remove an administrator, and a session survives its own credential
 * changing. The second absence is the sharper one — a rule keyed on how many
 * admins the *project* has would refuse every staff account in a fresh project,
 * which is the shape a new install is in, and the opposite of the intent.
 */
export type ResetPasswordErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_id"
  | "weak_password"
  | "not_configured"
  | "network"
  | "unknown";

const RESET_KNOWN_CODES: ReadonlySet<string> = new Set<ResetPasswordErrorCode>([
  "unauthenticated",
  "forbidden",
  "not_found",
  "invalid_id",
  "weak_password",
  "not_configured",
  "network",
  "unknown",
]);

export class ResetPasswordError extends Error {
  readonly code: ResetPasswordErrorCode;

  constructor(code: ResetPasswordErrorCode) {
    super(`reset-password failed: ${code}`);
    this.name = "ResetPasswordError";
    this.code = code;
  }
}

/**
 * Ganti password satu akun lewat Edge Function `reset-password`.
 *
 * Function, bukan request biasa, karena `auth.admin.updateUserById` butuh
 * `service_role`. Tidak ada kolom `profiles` yang bisa menggantikannya: GoTrue
 * menyimpan password di `auth.users`, dan PostgREST tidak bisa menjangkau tabel
 * itu dari browser.
 *
 * Melempar, mengikuti konvensi modul ini. Tidak ada kode di sini yang berarti
 * "password berubah sebagian" — kalau errornya sampai, password yang lama masih
 * berlaku dan tidak ada yang perlu dibersihkan.
 */
export async function resetUserPassword(
  userId: string,
  password: string,
): Promise<ResetPasswordResult> {
  const { data, error } = await supabase.functions.invoke("reset-password", {
    body: { user_id: userId, password },
  });

  if (error) {
    // Same two shapes as `deleteUser`: a `context` that is not a `Response`
    // means the request never got an answer, and a body carrying `code` rather
    // than `error` came from the gateway instead of from our function.
    const context = error.context;
    if (!(context instanceof Response)) {
      throw new ResetPasswordError("network");
    }

    let code: ResetPasswordErrorCode = "unknown";
    try {
      const body = (await context.json()) as { error?: string; code?: string };
      if (
        typeof body?.code === "string" &&
        body.code.startsWith("UNAUTHORIZED")
      ) {
        code = "unauthenticated";
      } else if (
        typeof body?.error === "string" &&
        RESET_KNOWN_CODES.has(body.error)
      ) {
        code = body.error as ResetPasswordErrorCode;
      }
    } catch {
      code = context.status === 404 ? "not_configured" : "unknown";
    }
    throw new ResetPasswordError(code);
  }

  const reset = data as {
    id?: string;
    email?: string | null;
    mustChangeFlagSet?: boolean;
  } | null;

  if (typeof reset?.id !== "string") {
    throw new ResetPasswordError("unknown");
  }

  return {
    id: reset.id,
    email: reset.email ?? null,
    // Defaulted to `false` on purpose, exactly as in `createUser`: an older
    // deployment of the function returns neither field, and telling the admin
    // that the person will be asked to change a password nothing is going to ask
    // them for is the worse lie.
    mustChangeFlagSet: reset.mustChangeFlagSet === true,
  };
}

/** Hasil pemanggilan `delete-user`. */
export type DeletedUser = {
  id: string;
  /** Berapa riwayat peminjaman yang ikut terhapus, untuk dilaporkan jujur. */
  erasedLoans: number;
};

/**
 * Kode error dari Edge Function `delete-user`.
 *
 * `last_admin` dan `self_delete` bukan kode dari Supabase — keduanya milik kita,
 * dan keduanya menolak sebelum ada yang dihapus. `last_admin` khususnya ada
 * karena `guard_last_admin` hanya memicu pada `update of role`: cascade delete
 * melewatinya, jadi satu-satunya penjaga adalah pengecekan di function.
 */
export type DeleteUserErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_id"
  | "self_delete"
  | "last_admin"
  | "not_configured"
  | "network"
  | "unknown";

const DELETE_KNOWN_CODES: ReadonlySet<string> = new Set<DeleteUserErrorCode>([
  "unauthenticated",
  "forbidden",
  "not_found",
  "invalid_id",
  "self_delete",
  "last_admin",
  "not_configured",
  "network",
  "unknown",
]);

export class DeleteUserError extends Error {
  readonly code: DeleteUserErrorCode;

  constructor(code: DeleteUserErrorCode) {
    super(`delete-user failed: ${code}`);
    this.name = "DeleteUserError";
    this.code = code;
  }
}

/**
 * Hapus satu akun lewat Edge Function `delete-user`.
 *
 * Function, bukan request biasa, karena `auth.admin.deleteUser` butuh
 * `service_role`.
 *
 * Melempar, mengikuti konvensi modul ini. Dua kode di sini berarti operasi
 * **tidak** terjadi, dan pemanggil tidak perlu menebak: `self_delete` dan
 * `last_admin` ditolak sebelum ada satu baris pun yang hilang.
 */
export async function deleteUser(userId: string): Promise<DeletedUser> {
  const { data, error } = await supabase.functions.invoke("delete-user", {
    body: { user_id: userId },
  });

  if (error) {
    // Bentuk yang sama seperti `createUser`: bukan Response berarti preflight
    // diblokir atau jaringan mati, dan itu `network`, bukan `unknown`.
    const context = error.context;
    if (!(context instanceof Response)) {
      throw new DeleteUserError("network");
    }

    let code: DeleteUserErrorCode = "unknown";
    try {
      const body = (await context.json()) as { error?: string; code?: string };
      if (
        typeof body?.code === "string" &&
        body.code.startsWith("UNAUTHORIZED")
      ) {
        code = "unauthenticated";
      } else if (
        typeof body?.error === "string" &&
        DELETE_KNOWN_CODES.has(body.error)
      ) {
        code = body.error as DeleteUserErrorCode;
      }
    } catch {
      code = context.status === 404 ? "not_configured" : "unknown";
    }
    throw new DeleteUserError(code);
  }

  const deleted = data as { id?: string; erasedLoans?: number } | null;
  if (typeof deleted?.id !== "string") {
    throw new DeleteUserError("unknown");
  }

  return { id: deleted.id, erasedLoans: deleted.erasedLoans ?? 0 };
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
    // `error.context` is the Response, so the function's own code is in the
    // body. A `context` that is *not* a Response means the request never got an
    // answer at all — the function is not deployed, the network is down, or the
    // browser refused the response because of CORS.
    //
    // That last one is why this branch is "network" rather than "unknown". A
    // blocked preflight is a transport failure from here: the `POST` is never
    // sent, so no body exists to read, and reporting "unknown" would tell the
    // admin to retry something that cannot succeed by retrying.
    const context = error.context;
    if (!(context instanceof Response)) {
      throw new CreateUserError("network");
    }

    let code: CreateUserErrorCode = "unknown";
    try {
      // Two different error shapes reach this point, and conflating them is how
      // an expired session ends up reported as "something went wrong".
      //
      // The function answers `{ error }`. The Supabase gateway, which verifies
      // the JWT before the function is invoked at all, answers `{ code, message }`
      // with an `UNAUTHORIZED_*` code and answers with `Access-Control-Allow-Origin: *`
      // of its own. An expired session therefore never reaches our JSON, and
      // reading only `error` would report it as an unknown failure.
      const body = (await context.json()) as {
        error?: string;
        code?: string;
      };

      if (
        typeof body?.code === "string" &&
        body.code.startsWith("UNAUTHORIZED")
      ) {
        code = "unauthenticated";
      } else if (
        typeof body?.error === "string" &&
        KNOWN_CODES.has(body.error)
      ) {
        // Validated rather than cast, because the screen renders
        // `t(\`errors.create.${code}\`)`. A code that is not in the union would
        // resolve to nothing and print the raw key path to the user, which is
        // worse than the generic message.
        code = body.error as CreateUserErrorCode;
      }
    } catch {
      // A Response with a body that is not our JSON at all. The status is still
      // evidence: the gateway answers 404 for a function that is not deployed.
      code = context.status === 404 ? "not_configured" : "unknown";
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
