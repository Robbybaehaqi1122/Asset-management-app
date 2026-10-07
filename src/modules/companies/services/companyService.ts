import { supabase } from "@/lib/supabase";

/**
 * Companies: the list of company names an admin maintains.
 *
 * **The same shape as `positionService` and `departmentService`, deliberately.** All
 * three are short admin-managed lists that every signed-in user reads and only an
 * admin changes, and two implementations would be two places to fix the next RLS
 * surprise.
 *
 * **Nothing references this table yet.** No asset, department or roster row has a
 * `company_id`, and the page does not imply otherwise — it is a list an admin fills.
 * See `20260927002600` for why nothing points at it.
 *
 * **Every write here uses `.select()` and throws on zero rows.** The three write
 * policies are `is_admin()`, so an UPDATE or DELETE by a caller who may not touch the
 * row matches nothing and PostgREST still reports success. A resolved promise is not
 * proof the row changed.
 */

/** Thrown when RLS matched no row, so the write silently did nothing. */
export class NoRowsWrittenError extends Error {
  constructor(operation: string) {
    super(`No company row was ${operation}`);
    this.name = "NoRowsWrittenError";
  }
}

export type CompanyRef = { id: string; name: string };

export type Company = {
  id: string;
  name: string;
  description: string | null;
  /**
   * How many roster entries name this company as their employer.
   *
   * Zero makes a delete safe. Non-zero makes it refused, by `companies_guard_delete`
   * (`02700`) and by the check in `deleteCompany` below — which exists because the
   * FK is `on delete restrict` and a bare `23503` names a constraint rather than the
   * company.
   */
  memberCount: number;
  createdAt: string;
  /**
   * When the row was last renamed.
   *
   * Read but not shown today. It is here because `updated_at` is in the table with
   * its trigger, and reading it costs one column on a query this already makes — a
   * screen that later wants to show it should not need a second round-trip to
   * discover it was always available.
   */
  updatedAt: string;
};

/**
 * `handover_users!handover_users_company_id_fkey(count)` is the in-use count.
 *
 * **The hint is required, and it is a different column name from the FK's table.**
 * PostgREST resolves an alias to a relationship and, asked to choose between two
 * foreign keys a table has out, does not guess — that is `PGRST108`, the same
 * ambiguity `02000` documented for the handover embeds. One relationship here, so
 * this is belt-and-braces rather than a fix, and it is written down so nobody
 * "tidies" the hint away.
 *
 * A one-to-many aggregate arrives as an **array of nulls** whose length is the child
 * count, not as a scalar — `positions` and `categories` both rely on that.
 */
const COMPANY_COLUMNS =
  "id, name, description, created_at, updated_at, handover_users!handover_users_company_id_fkey(count)";

/**
 * Every company, alphabetical.
 *
 * Ordered by name rather than by `created_at` because this is a list somebody
 * *scans*, not a log — and the same reason `getDepartments` and `getPositions` order
 * by name. `upper()` in the ordering rather than the raw column so `acme` and `Acme`
 * would not end up on opposite ends of the list if the case-insensitive index ever
 * stops being enough on its own.
 */
export async function getCompanies(): Promise<Company[]> {
  const { data, error } = await supabase
    .from("companies")
    .select(COMPANY_COLUMNS)
    .order("name", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    description: (row.description as string | null) ?? null,
    memberCount: embeddedCount(row.handover_users),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  }));
}

/**
 * Create one company.
 *
 * **The name is trimmed and the blank is refused here, before the request.** The
 * database has `companies_name_not_blank`, and letting it answer would mean a
 * `23514` naming a constraint to an admin holding an empty text box.
 *
 * Uniqueness is **not** checked by reading the list first: `companies_name_ci_key` is
 * the boundary, the same reasoning `findUnavailableAssets` is built on. A
 * pre-check would be a second source of truth a second admin can invalidate between
 * the read and the write.
 *
 * Returns the row that was written, so the caller does not have to reload the list
 * to show what it just added.
 */
export async function createCompany(input: {
  name: string;
  description?: string | null;
}): Promise<Company> {
  const name = input.name.trim();
  if (name === "") throw new CompanyNameRequiredError();

  const description = input.description?.trim() || null;

  const { data, error } = await supabase
    .from("companies")
    .insert({ name, description })
    .select(COMPANY_COLUMNS)
    .maybeSingle();

  if (error) throw error;

  // Only reachable for a non-admin: the INSERT policy has a `with check`, so a
  // violation is a raised error rather than a silent zero-row result. Kept anyway
  // so the invariant "we always throw" is true of every write here.
  if (!data) throw new NoRowsWrittenError("inserted");

  return {
    id: String(data.id),
    name: String(data.name ?? name),
    description: (data.description as string | null) ?? null,
    // Zero: nothing references the row a moment after it is created.
    memberCount: 0,
    createdAt: String(data.created_at ?? ""),
    updatedAt: String(data.updated_at ?? ""),
  };
}

/**
 * Rename one company, and edit its note.
 *
 * `.select()` and a zero-row throw for the reason every write here has one: a
 * non-admin's UPDATE matches nothing under `companies_update_admin` and PostgREST
 * reports success.
 */
export async function updateCompany(
  companyId: string,
  input: { name: string; description?: string | null },
): Promise<void> {
  const name = input.name.trim();
  if (name === "") throw new CompanyNameRequiredError();

  const { data, error } = await supabase
    .from("companies")
    .update({ name, description: input.description?.trim() || null })
    .eq("id", companyId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoRowsWrittenError("updated");
}

/**
 * Delete one company, refusing while anybody's roster entry names it as their
 * employer.
 *
 * **This guard was owed by `02600` and delivered by `02700`.** That migration shipped
 * this function with no in-use check, because nothing referenced `companies` yet, and
 * its own header said the first FK would have to add it. `handover_users.company_id`
 * is that FK, so `02700` added `companies_guard_delete` and this check.
 *
 * The refusal is here **and** on the foreign key for the same reason every other list
 * in this schema does it that way: the FK is `on delete restrict`, so the database
 * would refuse with a bare `23503` naming a constraint, and the trigger is
 * `security definer` so its count cannot be filtered away by the caller's RLS. What
 * the application adds is the count in the message, so the admin is told *who* to move
 * rather than that a constraint tripped.
 */
export async function deleteCompany(companyId: string): Promise<void> {
  const { count, error: countError } = await supabase
    .from("handover_users")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);

  if (countError) throw countError;

  if ((count ?? 0) > 0) {
    throw new CompanyInUseError(count ?? 0);
  }

  const { data, error } = await supabase
    .from("companies")
    .delete()
    .eq("id", companyId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoRowsWrittenError("deleted");
}

/** Raised by `deleteCompany` when the company still employs somebody. */
export class CompanyInUseError extends Error {
  readonly memberCount: number;

  constructor(memberCount: number) {
    super(`Company is still the employer of ${memberCount} roster entr(ies)`);
    this.name = "CompanyInUseError";
    this.memberCount = memberCount;
  }
}

/**
 * The count out of a one-to-many aggregate embed.
 *
 * PostgREST returns those as an **array**, whose length is the number of children, so
 * `count` is not a property of the array and reading it there would be `undefined` for
 * every row. It is also `null` rather than an object, which is why the shape is
 * checked.
 */
function embeddedCount(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  const first = value[0] as { count?: unknown } | null | undefined;
  return typeof first?.count === "number" ? first.count : 0;
}

/**
 * Raised when the name field was left blank.
 *
 * A separate class rather than letting the check constraint answer, because
 * `23514` is also what `NoRowsWrittenError`'s neighbours and every RLS refusal in
 * this repo surface as, and an empty text box is not that. Folding them together
 * would show an admin an access-control message for typing nothing.
 */
export class CompanyNameRequiredError extends Error {
  constructor() {
    super("A company needs a name");
    this.name = "CompanyNameRequiredError";
  }
}

/**
 * The id/name pairs a picker needs, without the counts.
 *
 * Used by the roster form's Company dropdown, which offers the employers on the list
 * rather than offering a text box. Same reasoning as `getDepartmentOptions`: a picker
 * whose options come from a managed table is a picker that cannot be filled with a
 * typo.
 */
export async function getCompanyOptions(): Promise<CompanyRef[]> {
  const { data, error } = await supabase
    .from("companies")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
  }));
}

/**
 * `23505` is `unique_violation`, and it is what `companies_name_ci_key` raises for
 * a company that already exists under a different spelling.
 *
 * Matched on the code rather than on Postgres's wording, because the wording names
 * whichever index tripped and would not translate.
 */
export function isDuplicateCompanyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}
