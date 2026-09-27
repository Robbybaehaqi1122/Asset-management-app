import { supabase } from "@/lib/supabase";
import type { DepartmentRef } from "@/lib/profiles";

/**
 * Departments, as reference data.
 *
 * Reads are open to every signed-in user and writes are admin-only, the same
 * split `categories` and `locations` already have. There is no client-side
 * filtering on the read and there should not be: `departments_select_authenticated`
 * is `using (true)`, so the row set is the same for everyone.
 *
 * **Every write here uses `.select()` and throws on zero rows.** That is not
 * defensiveness, it is the only way to tell a write that happened from one that
 * did not. `departments_write_admin` is a single `for all` policy, so for UPDATE
 * and DELETE a non-admin's statement matches nothing and PostgREST still reports
 * success — verified on the local stack: a staff DELETE and UPDATE of a real
 * department raised no error and changed no row. An INSERT is the one exception
 * and it does raise, because a row-level violation on the check is an error.
 */

/** Thrown when RLS matched no row, so the write silently did nothing. */
export class NoRowsWrittenError extends Error {
  constructor(operation: string) {
    super(`No department row was ${operation}`);
    this.name = "NoRowsWrittenError";
  }
}

export type Department = DepartmentRef & {
  description: string | null;
  created_at: string;
  /**
   * How many profiles point here. Present because it is what makes a delete
   * decision honest, and because the delete is refused when it is not zero.
   */
  memberCount: number;
};

const DEPARTMENT_COLUMNS =
  "id, name, description, created_at, profiles!profiles_department_id_fkey(count)";

/** Every department, alphabetical, each with the number of people in it. */
export async function getDepartments(): Promise<Department[]> {
  const { data, error } = await supabase
    .from("departments")
    .select(DEPARTMENT_COLUMNS)
    .order("name", { ascending: true });

  if (error) throw error;

  // The embedded count arrives as an array of nulls for a one-to-many, whose
  // length is the number of children. Null rather than an object because the
  // relationship is many-to-one from `departments`, so PostgREST cannot inline
  // the count as a scalar.
  return (data ?? []).map((row) => {
    const embedded = (row as { profiles?: { count: number }[] | null })
      .profiles;
    return {
      id: String(row.id),
      name: String(row.name),
      description: (row.description as string | null) ?? null,
      created_at: String(row.created_at),
      memberCount: Array.isArray(embedded) ? (embedded[0]?.count ?? 0) : 0,
    };
  });
}

/** The id/name pairs a picker needs, without the counts. */
export async function getDepartmentOptions(): Promise<DepartmentRef[]> {
  const { data, error } = await supabase
    .from("departments")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as DepartmentRef[]).map((row) => ({
    id: row.id,
    name: row.name,
  }));
}

/**
 * Create one department.
 *
 * The name is trimmed here rather than in the database because `name` is
 * case-**sensitive** unique: "IT" and "it" are two different departments, and
 * only a careless double-entry is prevented. Trimming is what removes the
 * commonest way to get two rows that look identical, and the database is what
 * stops it happening if this is ever bypassed.
 *
 * Returns the row that was written, so the caller does not have to reload the
 * list to show what it just added.
 */
export async function createDepartment(input: {
  name: string;
  description?: string | null;
}): Promise<DepartmentRef> {
  const name = input.name.trim();
  const description = input.description?.trim() || null;

  const { data, error } = await supabase
    .from("departments")
    .insert({ name, description })
    .select("id, name")
    .maybeSingle();

  if (error) throw error;

  // Only reachable for a non-admin: the INSERT policy has a `with check`, so a
  // violation is a raised error rather than a silent zero-row result. Kept
  // anyway so the invariant "we always throw" is true of every write here
  // instead of "true of most of them".
  if (!data) throw new NoRowsWrittenError("inserted");

  return { id: data.id, name: data.name };
}

/**
 * Delete one department, refusing while anybody is still in it.
 *
 * The refusal is here and not on the foreign key, which is `on delete set null`
 * precisely so that a department removed by some other path degrades into "not
 * set" rather than breaking an unrelated write. That same choice is why this
 * function has to ask the question itself: `set null` would succeed, and would
 * quietly un-assign every person in the department without saying so.
 */
export async function deleteDepartment(departmentId: string): Promise<void> {
  // Checked in the application rather than with a database constraint, because
  // the RLS policies mean "how many people are in this department" is a read the
  // client can do but a constraint cannot express across tables.
  const { count, error: countError } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("department_id", departmentId);

  if (countError) throw countError;

  if ((count ?? 0) > 0) {
    throw new DepartmentInUseError(count ?? 0);
  }

  const { data, error } = await supabase
    .from("departments")
    .delete()
    .eq("id", departmentId)
    .select("id")
    .maybeSingle();

  if (error) throw error;

  if (!data) throw new NoRowsWrittenError("deleted");
}

/** Raised by `deleteDepartment` when the department still has members. */
export class DepartmentInUseError extends Error {
  readonly memberCount: number;

  constructor(memberCount: number) {
    super(`Department still has ${memberCount} member(s)`);
    this.name = "DepartmentInUseError";
    this.memberCount = memberCount;
  }
}
