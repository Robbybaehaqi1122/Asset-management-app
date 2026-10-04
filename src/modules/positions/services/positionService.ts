import { supabase } from "@/lib/supabase";

/**
 * Positions: the job titles a person on the handover roster can hold.
 *
 * **A shape-preserving copy of `departmentService`, on purpose.** Positions and
 * departments are the same kind of thing — a short, admin-managed list that every
 * signed-in user reads and only an admin changes — and the roster already links
 * to departments beside positions. Writing a second implementation would be two
 * places to fix the next RLS surprise, so this deliberately mirrors the other file
 * line for line: same error classes, same `.select()`-on-every-write rule, same
 * app-layer delete guard. If one changes, both should.
 *
 * **Why the table exists at all.** `handover_users.position` was free text, and
 * free text means the list of positions is only the ones somebody remembered to
 * type — `Technician`, `technician` and `Technician ` are three spellings of one
 * job and nothing can tell them apart. That is the same argument `00900` made for
 * `profiles.department`, applied to the column that was left free text.
 *
 * **Admin-only, and the screen is gated rather than the route.** Matches
 * `/users` and `/departments`: the page checks `useIsAdmin()` and renders a
 * refusal, and RLS is the actual enforcement.
 *
 * **Every write uses `.select()` and throws on zero rows.** `positions_write_admin`
 * is one `for all` policy, so for UPDATE and DELETE a non-admin's statement matches
 * nothing and PostgREST still reports success. A resolved promise is not proof the
 * row changed.
 */

/** Thrown when RLS matched no row, so the write silently did nothing. */
export class NoRowsWrittenError extends Error {
  constructor(operation: string) {
    super(`No position row was ${operation}`);
    this.name = "NoRowsWrittenError";
  }
}

/** Raised by `deletePosition` when roster entries still hold it. */
export class PositionInUseError extends Error {
  readonly holderCount: number;

  constructor(holderCount: number) {
    super(`Position still held by ${holderCount} handover user(s)`);
    this.name = "PositionInUseError";
    this.holderCount = holderCount;
  }
}

/** The id/name pair a picker needs. Shared shape with `DepartmentRef`. */
export interface PositionRef {
  id: string;
  name: string;
}

export type Position = PositionRef & {
  description: string | null;
  created_at: string;
  /**
   * How many roster entries hold this position. Present because it is what makes
   * a delete decision honest, and because the delete is refused when it is not
   * zero.
   */
  holderCount: number;
};

/**
 * `positions` with its one to-many count.
 *
 * The embedded count arrives as an array of nulls for a one-to-many, whose length
 * is the number of children. Null rather than an object because the relationship
 * is many-to-one from `positions`, so PostgREST cannot inline it as a scalar.
 */
const POSITION_COLUMNS =
  "id, name, description, created_at, handover_users!handover_users_position_id_fkey(count)";

/** Every position, alphabetical, each with the number of people holding it. */
export async function getPositions(): Promise<Position[]> {
  const { data, error } = await supabase
    .from("positions")
    .select(POSITION_COLUMNS)
    .order("name", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const embedded = (row as { handover_users?: { count: number }[] | null })
      .handover_users;
    return {
      id: String(row.id),
      name: String(row.name),
      description: (row.description as string | null) ?? null,
      created_at: String(row.created_at),
      holderCount: Array.isArray(embedded) ? (embedded[0]?.count ?? 0) : 0,
    };
  });
}

/**
 * The id/name pairs a picker needs, without the counts.
 *
 * Read by the handover-roster form for its position dropdown, so this is the one
 * read in the module that is **not** admin-only — `positions_select_authenticated`
 * is `using (true)`, which is why the roster form on `/asset-settings` can
 * populate it at all.
 */
export async function getPositionOptions(): Promise<PositionRef[]> {
  const { data, error } = await supabase
    .from("positions")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as PositionRef[]).map((row) => ({
    id: row.id,
    name: row.name,
  }));
}

/**
 * Create one position.
 *
 * The name is trimmed here rather than in the database because `name` is
 * case-**sensitive** unique: "Technician" and "technician" are two different
 * positions, and only a careless double-entry is prevented. Trimming is what
 * removes the commonest way to get two rows that look identical.
 *
 * Returns the row that was written, so the caller does not have to reload the
 * list to show what it just added.
 */
export async function createPosition(input: {
  name: string;
  description?: string | null;
}): Promise<PositionRef> {
  const name = input.name.trim();
  const description = input.description?.trim() || null;

  const { data, error } = await supabase
    .from("positions")
    .insert({ name, description })
    .select("id, name")
    .maybeSingle();

  if (error) throw error;

  // Only reachable for a non-admin: the INSERT policy has a `with check`, so a
  // violation is a raised error rather than a silent zero-row result. Kept
  // anyway so the invariant "we always throw" is true of every write here.
  if (!data) throw new NoRowsWrittenError("inserted");

  return { id: data.id, name: data.name };
}

/** Update one position's name and description. */
export async function updatePosition(
  positionId: string,
  input: { name: string; description?: string | null },
): Promise<PositionRef> {
  const name = input.name.trim();
  const description = input.description?.trim() || null;

  const { data, error } = await supabase
    .from("positions")
    .update({ name, description })
    .eq("id", positionId)
    .select("id, name")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoRowsWrittenError("updated");

  return { id: data.id, name: data.name };
}

/**
 * Delete one position, refusing while anybody still holds it.
 *
 * The foreign key is `on delete restrict`, so the database refuses on its own and
 * `positions_guard_delete` (`02200`) refuses with a message naming the count. The
 * check is repeated here for the reason `deleteDepartment` repeats its own: the
 * trigger holds for any caller including a service-role delete, and this is what
 * lets the screen tell the admin how many people are in the way.
 */
export async function deletePosition(positionId: string): Promise<void> {
  const { count, error: countError } = await supabase
    .from("handover_users")
    .select("id", { count: "exact", head: true })
    .eq("position_id", positionId);

  if (countError) throw countError;

  if ((count ?? 0) > 0) {
    throw new PositionInUseError(count ?? 0);
  }

  const { data, error } = await supabase
    .from("positions")
    .delete()
    .eq("id", positionId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoRowsWrittenError("deleted");
}
