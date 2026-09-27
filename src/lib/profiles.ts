import { supabase } from "@/lib/supabase";

export type ProfileRole = "admin" | "staff";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: ProfileRole;
  department: string | null;
  created_at: string;
  /**
   * True while the account still has the password an admin set when creating
   * it. Advisory, and the app treats it as a prompt rather than a gate — see
   * migration 00800 for why nothing on the server can enforce it.
   */
  must_change_password: boolean;
}

/** The single read of one's own row, keyed on the session's user id. */
export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, email, full_name, role, department, created_at, must_change_password",
    )
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;

  // RLS answers with zero rows rather than an error for a row the caller may not
  // read, so `null` here is a normal outcome and not a failure.
  return (data as Profile | null) ?? null;
}

/**
 * Ubah nama dan departemen milik sendiri.
 *
 * Send two columns for the same reason the admin screen does: the two
 * `UPDATE OF` triggers on `profiles` do not fire when their column is absent
 * from the statement, and the third returns early because `role` did not move.
 * This is the same shape as `updateUserDetails` in the users module, kept here
 * because this is a person editing themselves rather than an admin editing a
 * list.
 */
export async function updateOwnProfile(details: {
  full_name: string;
  department: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: details.full_name, department: details.department })
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
