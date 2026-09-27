import { supabase } from "@/lib/supabase";

export type ProfileRole = "admin" | "staff";

/**
 * A `departments` row, as embedded by PostgREST.
 *
 * Returned as an object rather than flattened into a name because the read has
 * to carry the id too: the department pickers write `department_id`, and a
 * select that only carried the name could not put a value back.
 */
export interface DepartmentRef {
  id: string;
  name: string;
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: ProfileRole;
  /**
   * The department, or `null` for "not set".
   *
   * A foreign key since migration 00900, embedded under the alias `department`
   * so that `p.department?.name` reads the way the old text column did. Keeping
   * the alias rather than the default PostgREST shape (`departments`) is what
   * lets every existing `{row.department || t("notSet")}` in the UI keep
   * working.
   */
  department: DepartmentRef | null;
  /** Flattened from the embed, because that is what the table shows. */
  departmentName: string | null;
  created_at: string;
  /**
   * True while the account still has the password an admin set when creating
   * it. Advisory, and the app treats it as a prompt rather than a gate — see
   * migration 00800 for why nothing on the server can enforce it.
   */
  must_change_password: boolean;
}

/**
 * Kolom profil yang dibaca browser, plus embed departemen.
 *
 * Dipakai oleh `fetchProfile` dan oleh daftar admin, supaya keduanya tidak
 * bisa memilih kolom berbeda dan mengembalikan bentuk yang berbeda.
 */
export const PROFILE_COLUMNS =
  "id, email, full_name, role, created_at, must_change_password, " +
  "department:departments(id, name)";

/**
 * Ratakan hasil embed PostgREST menjadi bentuk `Profile`.
 *
 * PostgREST mengembalikan relasi foreign key sebagai objek, atau `null`. Jadi
 * bentuk yang sampai ke kita adalah `{ department: {id, name} | null }`, dan
 * `departmentName` tidak ada di dalamnya sama sekali — harus diturunkan di sini
 * supaya tidak ada pemanggil yang unknowingly membandingkan `undefined`.
 */
export function toProfile(row: unknown): Profile {
  const r = row as Omit<Profile, "departmentName"> & {
    department: DepartmentRef | null;
  };
  return { ...r, departmentName: r.department?.name ?? null };
}

/** The single read of one's own row, keyed on the session's user id. */
export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;

  // RLS answers with zero rows rather than an error for a row the caller may not
  // read, so `null` here is a normal outcome and not a failure.
  if (!data) return null;
  return toProfile(data);
}

/**
 * Ubah nama dan departemen milik sendiri.
 *
 * Send two columns for the same reason the admin screen does: the two
 * `UPDATE OF` triggers on `profiles` do not fire when their column is absent
 * from the statement, and the third returns early because `role` did not move.
 * The same shape as `updateUserDetails` in the users module, kept here because
 * this is a person editing themselves rather than an admin editing a list.
 */
export async function updateOwnProfile(details: {
  full_name: string;
  department_id: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: details.full_name,
      department_id: details.department_id,
    })
    .eq("id", (await currentUserId()) ?? "");

  if (error) throw error;
}

async function currentUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user?.id ?? null;
}

/**
 * Ganti password sendiri, lalu lepaskan flag "wajib ganti".
 *
 * Two separate writes in two different systems, and the order is the point.
 * `auth.updateUser` is the one that actually changes the credential, and it can
 * fail on its own terms — GoTrue rejects a password it considers too similar to
 * the old one, and refuses to confirm an account whose email is unverified. If
 * it fails, the flag stays set and the user simply tries again, which is the
 * recoverable direction. Clearing the flag first would mean a user who failed
 * to change their password was quietly let off the hook.
 */
export async function completePasswordChange(
  newPassword: string,
): Promise<void> {
  const { error: authError } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (authError) throw authError;

  const userId = await currentUserId();
  if (userId === null) return;

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", userId);

  // The password has already changed, so this is a cosmetic failure rather than
  // a security one. Surfaced so the UI can explain why it is still asking,
  // instead of looping the user forever with no reason given.
  if (profileError) throw profileError;
}
