import { supabase } from "@/lib/supabase";

import type { MenuPermissionRow } from "../menuAccess";
import { isPermissionMenuKey } from "../menuAccess";

/**
 * Columns read from `user_menu_permissions`.
 *
 * One line on purpose. A newline inside a PostgREST select literal is `PGRST100`, and
 * `menu_key` is a column a future migration could rename — which is the
 * `HANDOVER_COLUMNS` / `locations.name` shape that takes out a whole screen rather than
 * one column, so the list stays explicit.
 *
 * `profile_id` is included even though the sidebar never reads it, because the admin
 * page addresses a row by it when saving back.
 */
const PERMISSION_COLUMNS =
  "profile_id, menu_key, can_view, can_edit, can_delete";

/** One override being saved, as the admin page holds it. */
export interface MenuPermissionInput {
  menuKey: string;
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

/**
 * RLS answers a refused write with **zero rows and no error**, so a resolved promise is
 * not proof that anything was written.
 *
 * Same reasoning as `NoRowsUpdatedError` in the users module, and the reason every write
 * in this codebase uses `.select()` and counts. Here it guards the upsert: a staff
 * caller matches no rows and would otherwise see "saved" on a screen it cannot use.
 */
export class NoRowsWrittenError extends Error {
  constructor() {
    super("No user_menu_permissions row was written");
    this.name = "NoRowsWrittenError";
  }
}

/**
 * A `menu_key` the database's closed set does not contain.
 *
 * Its own class rather than a bare `Error`, so a caller can tell "you asked for a menu
 * that does not exist" from "the save was refused".
 */
export class UnknownMenuKeyError extends Error {
  readonly keys: string;

  constructor(keys: string) {
    super(`Unknown menu key(s): ${keys}`);
    this.name = "UnknownMenuKeyError";
    this.keys = keys;
  }
}

/**
 * The signed-in reader's own overrides.
 *
 * Returns `[]` for a caller with no configured access — which is also what a failed
 * read returns, deliberately.
 *
 * `user_menu_permissions_select_own_or_admin` is what lets this work for a staff
 * caller, so it needs no `.eq("profile_id", …)` here: the policy already narrows it,
 * and adding one would be a second copy of the same rule free to disagree with the
 * policy. For an admin the policy returns every row, so the caller checks `isAdmin`
 * before asking at all — see `useMenuAccess`.
 *
 * **A failure is swallowed here, and that is the point.** This runs on the shell's
 * render path, and a shell that could not read four rows should still render with the
 * reader's existing access rather than take every menu away. The alternative propagates
 * one failed read into a blank application with no error saying why, which is the
 * silent-total-failure mode this module is otherwise built to avoid.
 */
export async function getOwnPermissions(): Promise<MenuPermissionRow[]> {
  const { data, error } = await supabase
    .from("user_menu_permissions")
    .select(PERMISSION_COLUMNS);

  if (error) return [];
  return (data ?? []) as MenuPermissionRow[];
}

/**
 * Every override in the table, grouped by the account it is about.
 *
 * Returns `null` rather than `[]` on failure, so the page can tell "nobody has been
 * configured yet" from "the read failed" and say which. Those are different sentences
 * and only one of them is worth retrying.
 *
 * No filter on `role` here. A row for an admin is legal — it is simply never consulted,
 * because `useMenuAccess` short-circuits for admins — so filtering would leave an
 * operator wondering whether their save had landed.
 */
export async function getAllPermissions(): Promise<Map<
  string,
  MenuPermissionRow[]
> | null> {
  const { data, error } = await supabase
    .from("user_menu_permissions")
    .select(PERMISSION_COLUMNS);

  if (error) return null;

  const grouped = new Map<string, MenuPermissionRow[]>();
  for (const row of (data ?? []) as MenuPermissionRow[]) {
    const existing = grouped.get(row.profile_id);
    if (existing) existing.push(row);
    else grouped.set(row.profile_id, [row]);
  }
  return grouped;
}

/**
 * Save one person's whole set of overrides, as written.
 *
 * Returns the upserted rows exactly as the database stored them — snake_case, straight
 * off the response — so the admin page re-seeds from the server's answer rather than
 * assuming its optimistic state matched. Nothing here is cast into the wire shape from
 * `MenuPermissionInput`; a cast would be a type lie the moment the two diverge.
 *
 * Revoked keys produce no row to return, which is why this can legitimately return fewer
 * entries than `grantedKeys` had names in it.
 */
async function upsertGranted(
  rows: readonly Record<string, unknown>[],
): Promise<MenuPermissionRow[]> {
  const { data, error } = await supabase
    .from("user_menu_permissions")
    .upsert(rows as Record<string, unknown>[], {
      onConflict: "profile_id,menu_key",
    })
    .select(PERMISSION_COLUMNS);

  if (error) throw error;

  // Zero rows on a non-empty upsert is the RLS row-filter shape: the statement
  // matched nothing and PostgREST reports success. Without this the page reports
  // "saved" for a write that never happened.
  if (rows.length > 0 && (!data || data.length === 0)) {
    throw new NoRowsWrittenError();
  }

  return (data ?? []) as MenuPermissionRow[];
}

/**
 * Save one person's whole set of overrides.
 *
 * ## Two statements, and the order is the point
 *
 * The granted rows go in **first**, as a single multi-row `upsert` on
 * `(profile_id, menu_key)`. PostgREST writes one array in a single transaction, so the
 * person is never left with half their menus, and `upsert` rather than
 * delete-then-insert means the granted set never depends on a second request having
 * succeeded — which is the `reset-password` shape, where losing the second write leaves
 * an account holding a working credential with a flag that was never raised.
 *
 * The revoked keys are deleted **afterwards**. That direction is chosen for the same
 * reason: if the second statement fails, what is left is a menu that should have been
 * withdrawn but is still offered — visible on screen and one click from being fixed —
 * rather than a person who has silently lost access they were entitled to keep.
 *
 * ## Revocation is a delete, not a flag flip
 *
 * A row with all three flags false is an explicit denial. Deleting a row is what
 * *restores* the reader's existing behaviour, because a missing row grants everything
 * (see `ABSENT_ROW_GRANTS_EVERYTHING`). An operator who unticks everything and then
 * unticks it again means "leave this person as they were", so the page sends an empty
 * granted set and this removes every override that person had.
 *
 * ## Why there is no RPC behind this
 *
 * PostgREST cannot express "replace this person's set", and the alternative — a function
 * — would be one more privileged entry point guarding something the browser can already
 * do over ordinary RLS. The write policies are admin-only, so the check this needs is
 * already the one the database is making.
 */
export async function savePermissionsForUser(
  profileId: string,
  granted: readonly MenuPermissionInput[],
): Promise<MenuPermissionRow[]> {
  // Validated before the write rather than letting `menu_key_known` answer with
  // `23514` and a constraint name. The admin page can only produce keys from the closed
  // set, so this fires for a programmatic caller — and a sentence beats a constraint
  // name for whoever has to act on it. `isPermissionMenuKey` is the same list the
  // constraint enforces, so this cannot pass what the database would refuse.
  const unknown = granted
    .map((input) => input.menuKey)
    .filter((key) => !isPermissionMenuKey(key));
  if (unknown.length > 0) {
    throw new UnknownMenuKeyError(unknown.join(", "));
  }

  // `can_edit` / `can_delete` without `can_view` is already impossible in the page,
  // where the boxes cascade. Re-asserted here so a programmatic caller cannot fail the
  // whole upsert with `23514` and take that person's valid menus down with it — the
  // transaction is all-or-nothing, so one bad row loses every good one beside it.
  const rows = granted.map((input) => ({
    profile_id: profileId,
    menu_key: input.menuKey,
    can_view: input.canView,
    can_edit: input.canEdit && input.canView,
    can_delete: input.canDelete && input.canView,
  }));

  const written =
    rows.length > 0 ? await upsertGranted(rows) : ([] as MenuPermissionRow[]);

  const grantedKeys = new Set(rows.map((row) => row.menu_key));
  const toRevoke = await findStaleKeys(profileId, grantedKeys);
  if (toRevoke.length > 0) await revokeKeys(profileId, toRevoke);

  return written;
}

/**
 * Keys this person's overrides currently hold that are **not** in `grantedKeys`.
 *
 * Read from the database rather than derived from the page's own state on purpose: the
 * page holds what it last loaded, and two admins editing the same person would each
 * revoke only what they had personally seen. This reads what is actually there, so a
 * grant made in another tab survives unless this save names it.
 */
async function findStaleKeys(
  profileId: string,
  grantedKeys: ReadonlySet<string>,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("user_menu_permissions")
    .select("menu_key")
    .eq("profile_id", profileId);

  // Failing to read is not a reason to skip the cleanup quietly. Without it a revoked
  // key stays granted, which is the direction that leaves access in place — so this
  // throws and the page reports an unfinished save instead of a clean one.
  if (error) throw error;

  return ((data ?? []) as { menu_key: string }[])
    .map((row) => row.menu_key)
    .filter((key) => !grantedKeys.has(key));
}

/**
 * Delete the named keys for one person.
 *
 * **Deliberately no `.select()` assertion.** Every other write in this codebase counts
 * its rows, because "zero rows written" is the silent shape of a refused write — but here
 * zero rows is the normal, correct answer whenever a key was already absent, which is
 * the common case on a first save. Asserting on it would throw on success.
 */
async function revokeKeys(
  profileId: string,
  keys: readonly string[],
): Promise<void> {
  const { error } = await supabase
    .from("user_menu_permissions")
    .delete()
    .eq("profile_id", profileId)
    .in("menu_key", [...keys]);

  if (error) throw error;
}
