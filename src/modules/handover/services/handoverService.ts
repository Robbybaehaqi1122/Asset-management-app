import { supabase } from "@/lib/supabase";
import type {
  AssetCondition,
  AssetUnit,
} from "@/modules/assets/services/assetService";

/**
 * Asset handover: the screen `assignments` has needed since migration `001`.
 *
 * The table was already there with RLS, a status trigger and two guards. Nothing
 * about this module invents a data model — it gives the existing one a UI, and
 * adds the two facts a handover record needs that a loan did not
 * (`20260927001900`).
 *
 * ## Who can do what is already decided by the database, not here
 *
 * | Action | Policy | So |
 * |---|---|---|
 * | read | `assignments_select_own_or_admin` | staff see **their own** handovers only |
 * | issue | `assignments_insert_admin` | **admin only** — a staff insert raises |
 * | return | `assignments_update_own_or_admin` | the holder may return their own; admin may return any |
 * | delete | `assignments_delete_admin` | admin only |
 *
 * That split is the reason this page can render a Return button for a staff
 * member and an Issue button only for an admin without either being a guess: the
 * policies already say so, and the UI gate exists so nobody is shown a control
 * that cannot work. `RLS` is the enforcement point in both cases.
 *
 * ## Every write here uses `.select()` and throws on zero rows
 *
 * Same reason as `departmentService` and `assetService`. For UPDATE and DELETE a
 * caller's statement can match nothing under RLS and PostgREST still reports
 * success, so a resolved promise is not proof that anything happened.
 */

/** Thrown when RLS matched no row, so the write silently did nothing. */
export class NoRowsWrittenError extends Error {
  constructor(operation: string) {
    super(`No assignment row was ${operation}`);
    this.name = "NoRowsWrittenError";
  }
}

/**
 * Raised when deleting a handover that is still open.
 *
 * `assignments_sync_asset_status` is `after delete` as well as `after insert`, so
 * removing an open row puts the asset straight back to `available` while the
 * person is still physically holding it. That is a silent return: the asset looks
 * like stock, the handover history is gone, and nothing errors. Requiring a
 * return first keeps the delete to what it is for — taking back a record that was
 * entered wrongly.
 */
export class HandoverOpenError extends Error {
  constructor() {
    super("This handover is still open: return the asset before deleting it");
    this.name = "HandoverOpenError";
  }
}

/**
 * Raised when a batch is issued with nothing in it.
 *
 * A separate class rather than reusing `NoRowsWrittenError`, because the two mean
 * different things to the caller: that one says the database filtered the write,
 * this one says the form was submitted empty. Folding them together would make
 * the empty case look like an RLS refusal.
 */
export class NoAssetsSelectedError extends Error {
  constructor() {
    super("No asset was selected, so there was nothing to hand over");
    this.name = "NoAssetsSelectedError";
  }
}

/** The asset, trimmed to what the handover list shows. */
export type HandoverAsset = {
  id: string;
  assetCode: string;
  name: string;
  /**
   * The device's own serial, which is what an admin checks against the physical
   * unit in their hand. Read here for the Detail modal's list, so the list can answer
   * "is this the device I think it is" without a second lookup per row.
   */
  serialNumber: string | null;
  status: string;
  condition: AssetCondition;
  department: string;
  /**
   * The asset's own registration document number, from `assets.handover_doc_no`.
   * Shown as read-only reference on a handover. This module never writes it — see
   * the note at the top of migration `01900`.
   */
  handoverDocNo: string | null;
};

/**
 * The **recipient** — a `handover_users` row, not an account.
 *
 * Read-only as far as this module is concerned: the roster is administered in
 * `/asset-settings`, and this is just enough to label the holder in a list and
 * disambiguate two people who share a name.
 *
 * `position` and `departmentName` are both `null`-tolerant because the database
 * does not force either to be present on an existing row and both are nullable in
 * the embed. `id` is the roster row's id, which is what `assignments.user_id`
 * holds — **not** an auth id.
 */
export type HandoverHolder = {
  name: string;
  position: string | null;
  departmentName: string | null;
  /**
   * The company that employs them, printed as the document's `Company` line.
   *
   * Null for a contractor or visitor — `handover_users.company_id` is nullable
   * precisely so the roster can record somebody with no employer on this list, and
   * the print modal **omits** the line rather than printing an empty one. An empty
   * label where a company belongs reads as a document nobody finished.
   */
  companyName: string | null;
  /**
   * Their staff number, printed as `NIK/EID`.
   *
   * Free text rather than a reference, and not unique: these come from a human
   * resources system this application has no model of. Null means they have none,
   * and the line is omitted the same way.
   */
  nikEid: string | null;
};

/**
 * The **issuer** — an authenticated account from `profiles`.
 *
 * This is the asymmetry the `02000` migration introduced and the reason it could
 * be done without breaking anything: who received the asset is a fact about the
 * asset, and who recorded it is a fact about this application's audit trail. Only
 * the first one decouples.
 *
 * `issuedBy` is null once the issuing account is deleted, because
 * `assignments.assigned_by` is `on delete set null`. That is deliberate: losing
 * the name of an admin who has left is better than deleting every handover they
 * recorded.
 */
export type HandoverIssuer = {
  id: string;
  fullName: string | null;
  email: string | null;
};

export type Handover = {
  id: string;
  assetId: string;
  /** A `handover_users` id — the recipient's roster entry, not an account. */
  userId: string;
  /** The authenticated account that recorded the handover, or null if deleted. */
  assignedBy: string | null;
  assignedAt: string;
  dueDate: string | null;
  returnedAt: string | null;
  notes: string | null;
  conditionAtHandover: AssetCondition | null;
  asset: HandoverAsset | null;
  /** Who received it, from the roster. */
  holder: HandoverHolder | null;
  /** Who handed it over, from the login list. */
  issuedBy: HandoverIssuer | null;
  /**
   * The bag, the charger — whatever went out with **this** device.
   *
   * Read as an embedded one-to-many rather than a second query per row, because the
   * document and the Detail modal both need them per row and a list of ten devices
   * would otherwise be eleven requests to display eleven things already related to
   * each other.
   *
   * Always an array, never null: PostgREST returns an empty array for a row with no
   * accessories, and a `null` here would mean two different things — "no
   * accessories" and "the embed is wrong" — which is the same distinction
   * `asset: assets(…)` without `!inner` fails to make.
   */
  accessories: HandoverAccessory[];
};

/** An asset that can be handed over right now. */
export type HandoverTarget = {
  id: string;
  assetCode: string;
  name: string;
  /**
   * The device's own serial, on the target list rather than only on `Handover`.
   *
   * It is here because the picker's rows are where an admin decides **which** of
   * several similar codes is the device in front of them, and the serial is the fact
   * that settles it. Reading it from the list it arrives with costs no extra request —
   * the picker gets these rows from the one query this already made.
   */
  serialNumber: string | null;
  condition: AssetCondition;
  /** The asset's own document number, shown read-only on the issue form. */
  handoverDocNo: string | null;
};

/**
 * **No newline may appear inside the literal**, or reflowed into a multi-line
 * template literal, however it reads. A newline within the select string is
 * rejected by PostgREST's parser:
 *
 * ```
 * unexpected "\n" expecting "...", field name (* or [a..z0..9_$])
 * ```
 *
 * which comes back as `PGRST100` naming a *field*, not whitespace — so it reads
 * like a misspelled column rather than a line break, and the page goes blank with
 * no hint anywhere near the cause. Both shapes were tried against the local
 * stack and only the single-line one returns rows.
 *
 * Prettier puts the opening backtick on the line below `=`, which looks like a
 * two-line literal and is not one: that newline is outside the string. The test
 * that matters is whether the text *between* the backticks holds a newline, and
 * it must not.
 *
 * Concatenating one-line fragments to keep the source readable does not work
 * either: `as const` is rejected on a parenthesised binary expression with
 * `TS1355`, and without `as const` the type-level parser yields
 * `GenericStringError` and every cast below has to go through `unknown`. One long
 * line is the price of both working at once.
 *
 * `as const` is required for a different reason: without the literal type,
 * supabase-js hands back `GenericStringError` and the casts below have to go
 * through `unknown`, throwing away the check that would catch a column renamed
 * out from under this string. `ASSET_COLUMNS` in `assetService.ts` is the same
 * pattern and the reason it is written that way.
 *
 * `!inner` on the asset embed is what makes `.eq("asset.department", …)` a
 * server-side filter rather than a client-side one. PostgREST only filters on an
 * embedded resource through an inner join; on the default left join the filter is
 * silently ignored and the page would show both units' handovers on both pages —
 * the same "an HSSE row in the IT list" problem that made the assets two pages.
 *
 * **Both the hint and `!inner` are needed, and the order is `!hint!inner`.** All
 * three variants were tried against the local stack and `tsc`, and each failure
 * looks like nothing to do with the other:
 *
 * | Form | Runtime | `tsc` |
 * |---|---|---|
 * | `assets!assignments_asset_id_fkey!inner` | works | works |
 * | `assets!inner!assignments_asset_id_fkey` | works | **`GenericStringError`** |
 * | `assets!inner` (no hint) | **`PGRST108`** | works |
 *
 * So dropping the hint to please the type layer returns a 400 from PostgREST, and
 * reordering the two modifiers to please the runtime returns a type error that
 * names neither modifier. Do not "tidy" the order.
 *
 * The hint is needed because PostgREST resolves an alias to a relationship and,
 * asked to pick between the two foreign keys `assignments` has out, does not
 * guess — `PGRST108` says the alias is not an embedded resource at all, which
 * reads like a typo in the alias rather than a missing disambiguator.
 *
 * **`holder` and `issuedBy` now come from different tables, and that is the whole
 * point of `02000`.** `holder` is `handover_users` via
 * `assignments_user_id_fkey`, because the recipient is a roster entry rather than
 * an account; `issuedBy` is still `profiles` via `assignments_assigned_by_fkey`,
 * because the issuer is the authenticated account that recorded the row. Both
 * hints are still required — and neither is a self-relationship, which is the case
 * where a hint resolves to the inbound direction and returns an empty array
 * instead; see `getCategories` in `settingService.ts`.
 *
 * **Neither embed is `!inner`.** Both columns are nullable from the reader's
 * point of view — a handover whose roster entry has since been deleted (the FK
 * is `restrict`, so only an unreferenced row can vanish, but a `service_role`
 * write could) or whose issuing account was deleted (`assigned_by` is `on delete
 * set null`) — and `!inner` would drop those rows from the list entirely rather
 * than showing a blank cell. The asset embed is the only one that must be inner,
 * and that is for the unit filter rather than for existence.
 *
 * A whole-statement failure is the cost of naming columns explicitly: PostgREST
 * refuses with `42703` when one of them has gone, so a renamed column takes the
 * page down rather than leaving one blank cell. That trade is worth it, and it is
 * why the list below has to be read when a column changes.
 */
const HANDOVER_COLUMNS =
  `id, asset_id, user_id, assigned_by, assigned_at, due_date, returned_at, notes, condition_at_handover, asset:assets!assignments_asset_id_fkey!inner(id, asset_code, name, status, condition, department, handover_doc_no), accessories:assignments_accessories(id, name), holder:handover_users!assignments_user_id_fkey(name, position:positions(name), department:departments(name)), issuedBy:profiles!assignments_assigned_by_fkey(full_name, email)` as const;

/**
 * The accessories embed, read through a shape check.
 *
 * Same reason as `mapHolder` and the `position` embed: an aliased embed arrives as
 * an **object**, not a string, so `String(row.accessories)` would put
 * `[object Object]` in the list. And `Array.isArray` rather than a truthiness
 * test, because PostgREST returns `[]` for a row with none and the caller then gets
 * an empty list rather than having to guard every read.
 */
function mapAccessories(value: unknown): HandoverAccessory[] {
  if (!Array.isArray(value)) return [];
  return (value as Record<string, unknown>[])
    .filter(
      (row): row is Record<string, unknown> =>
        typeof row === "object" && row !== null,
    )
    .map((row) => ({ id: String(row.id), name: String(row.name ?? "") }));
}

/** What PostgREST hands back before it is flattened. */
type RawHandover = Record<string, unknown>;

function str(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/**
 * The recipient, from the `handover_users` embed.
 *
 * **There is no `id` on this type on purpose.** The embed asks PostgREST for
 * `name, position` and the department, not the primary key, because `Handover`
 * already carries `userId` straight off the row and a second copy of the same
 * uuid is a second thing that can be wrong. Anything needing the roster id reads
 * `Handover.userId`.
 */
function mapHolder(value: unknown): HandoverHolder | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const department = row.department as
    Record<string, unknown> | null | undefined;
  const company = row.company as Record<string, unknown> | null | undefined;
  return {
    name: String(row.name ?? ""),
    // `position:positions(name)` arrives as an **object**, so `str()` on it would
    // hand back "[object Object]" — which is exactly what the list showed. The
    // department and company embeds are read through the same shape check.
    position:
      row.position && typeof row.position === "object"
        ? str((row.position as Record<string, unknown>).name)
        : null,
    departmentName:
      department && typeof department === "object"
        ? str(department.name)
        : null,
    companyName:
      company && typeof company === "object" ? str(company.name) : null,
    nikEid: str(row.nik_eid),
  };
}

/** The issuer, from the `profiles` embed. Null once the account is deleted. */
function mapIssuer(value: unknown): HandoverIssuer | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  return {
    id: String(row.id),
    fullName: str(row.full_name),
    email: str(row.email),
  };
}

function mapHandover(row: RawHandover): Handover {
  const asset = row.asset as Record<string, unknown> | null | undefined;
  return {
    id: String(row.id),
    assetId: String(row.asset_id),
    userId: String(row.user_id),
    assignedBy: str(row.assigned_by),
    assignedAt: String(row.assigned_at),
    dueDate: str(row.due_date),
    returnedAt: str(row.returned_at),
    notes: str(row.notes),
    conditionAtHandover:
      (str(row.condition_at_handover) as AssetCondition) ?? null,
    asset:
      asset && typeof asset === "object"
        ? {
            id: String(asset.id),
            assetCode: String(asset.asset_code ?? ""),
            serialNumber: str(asset.serial_number),
            handoverDocNo: str(asset.handover_doc_no),
            name: String(asset.name ?? ""),
            status: String(asset.status ?? ""),
            condition: String(asset.condition ?? "") as AssetCondition,
            department: String(asset.department ?? ""),
          }
        : null,
    holder: mapHolder(row.holder),
    issuedBy: mapIssuer(row.issuedBy),
    accessories: mapAccessories(row.accessories),
  };
}

/**
 * One non-device item that travelled with a device: the bag, the charger, the case.
 *
 * **These are not `assets`, and cannot be.** A bag shares its laptop's
 * `asset_code`, and `assets_asset_code_ci_key` is unique over
 * `upper(btrim(asset_code))` — which is the whole point of the code being a usable
 * identifier. So a kit is one `assets` row and everything that came with it hangs
 * off the handover row instead. See `20260927002400` for why that is per-handover
 * rather than a property of the asset.
 *
 * Free text, and that is the design: the item is not in the inventory, so there is
 * no reference list to validate it against.
 */
export type HandoverAccessory = {
  id: string;
  name: string;
};

/**
 * Every handover for one unit, newest first.
 *
 * Not gated on `isAdmin`, and deliberately so — same reasoning as `getAssets`.
 * `assignments_select_own_or_admin` already decides the row set per caller, so
 * gating the read would only delay the screen: a staff member's list is the same
 * query and comes back with their own rows instead of an admin's.
 *
 * The unit is the **page**, so the filter is in SQL rather than in the browser.
 */
export async function getHandovers(unit: AssetUnit): Promise<Handover[]> {
  const { data, error } = await supabase
    .from("assignments")
    .select(HANDOVER_COLUMNS)
    .eq("asset.department", unit)
    .order("assigned_at", { ascending: false });

  if (error) throw error;
  return ((data ?? []) as RawHandover[]).map(mapHandover);
}

/**
 * The assets in one unit that can be handed over right now.
 *
 * `status = 'available'` is doing the work of "not already out", and it is not a
 * guess: `assignments_guard_asset_available` (`01900`) refuses an insert unless
 * the asset is `available`, and `assignments_sync_asset_status` flips it to
 * `assigned` on the way out and back on the way home. So `available` and "has no
 * open handover" are the same state, kept in step by two triggers — asking the
 * question a second way here would be a second answer to maintain.
 *
 * It is still the database that refuses, so a race between two admins handing the
 * same asset out ends in `23514` on one of them rather than in a duplicate.
 */
export async function getHandoverTargets(
  unit: AssetUnit,
): Promise<HandoverTarget[]> {
  const { data, error } = await supabase
    .from("assets")
    .select("id, asset_code, name, serial_number, condition, handover_doc_no")
    .eq("department", unit)
    .eq("status", "available")
    .order("asset_code", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as RawHandover[]).map((row) => ({
    id: String(row.id),
    assetCode: String(row.asset_code ?? ""),
    name: String(row.name ?? ""),
    serialNumber: str(row.serial_number),
    condition: String(row.condition ?? "") as AssetCondition,
    handoverDocNo: str(row.handover_doc_no),
  }));
}

export type HandoverInput = {
  /**
   * The assets going out together — a **`handover_users` id** is `userId` below,
   * and these are `assets` ids.
   *
   * A **list**, not a single id, because handing a laptop to somebody without its
   * charger is not the thing anyone does, and the database already allowed it:
   * `assignments_one_open_per_asset` is unique *per asset*, so N assets pointed at
   * one `user_id` were always legal. Only the form was single-asset. Verified on
   * the local stack before this change: three assets to one person, three rows,
   * all three assets `assigned`, and returning two of three leaves the third out
   * while the first two go back to `available`.
   */
  assetIds: string[];
  /**
   * The person receiving them — a **`handover_users` id**, not an account id.
   *
   * That is the whole change in `02000`, and getting it wrong fails loudly rather
   * than silently: a profile id here matches no roster row and the insert is
   * refused by `assignments_user_id_fkey` with `23503`.
   */
  userId: string;
  /**
   * The authenticated account handing them over; recorded as `assigned_by`.
   *
   * Still a profile id, deliberately. The issuer is who used this application,
   * which is not something a roster row can answer.
   */
  issuedBy: string;
  dueDate?: string | null;
  notes?: string | null;
  /**
   * One value recorded on every row of the batch, or null for none of them.
   *
   * **Not per asset, and the form says so.** `assets.condition` is a free column
   * per asset, so a set of five will usually not agree — a charger may be `new`
   * while the laptop is `fair` — and recording one value across all of them is a
   * deliberate simplification rather than a claim that they match. The form only
   * prefills when the selected assets already agree, and leaves the field blank
   * otherwise so each row keeps its own condition in `assets`.
   *
   * A per-asset editor inside a multi-select form is the alternative, and it is a
   * second form nested in the first. Not built; the honest cost is named here
   * rather than hidden behind a field that pretends to be per-row.
   */
  conditionAtHandover?: AssetCondition | null;
};

/**
 * One roster entry, as the issue form's picker needs it.
 *
 * Read from `handover_users`, which every signed-in user may read
 * (`handover_users_select_authenticated` is `using (true)`) — so unlike the
 * `getAllUsers` call this replaces, **it does not need an admin**. The form shows
 * it on a staff screen as well, which is why the read policy is not `is_admin()`.
 *
 * The label is assembled here rather than in the page, because the whole reason
 * this table exists is that a bare name is ambiguous: `name — position` plus the
 * department in a second field is what lets an admin tell two people called
 * "Budi" apart without opening each record.
 */
export type HandoverUserOption = {
  id: string;
  name: string;
  position: string;
  departmentName: string | null;
  /** What the picker shows. Never empty, because `name` is `not null`. */
  label: string;
};

/**
 * Everyone a handover can be issued to.
 *
 * Deliberately **not** filtered by unit. A roster entry is not an asset: the same
 * contractor receives a laptop and a fire extinguisher, and narrowing the list to
 * one department would be a second classification of the same person.
 *
 * Not gated on `isAdmin` either, and that is the change from `getAllUsers` —
 * `profiles` is readable only by an admin and by the caller themselves, so the old
 * picker returned one row for a staff member and the Issue button was never
 * reachable for them anyway. `handover_users` is plain reference data.
 */
export async function getHandoverUserOptions(): Promise<HandoverUserOption[]> {
  const { data, error } = await supabase
    .from("handover_users")
    .select("id, name, position:positions(name), department:departments(name)")
    // `position(name)` — **parentheses, not a dot or a colon.** `position` became an
    // aliased embed in `02200`, and PostgREST's ordering syntax for an embedded
    // resource is `alias(column)`. Both other spellings are hard errors rather than
    // silent no-ops, which is the better failure:
    //
    //   position:name  -> PGRST100 unexpected ':'
    //   position.name  -> PGRST100 expecting "asc", "desc", …
    //   position       -> 200, and sorts nothing at all
    //
    // That third one is the trap: leaving the old `.order("position")` in place
    // would have compiled, returned rows, and quietly stopped sorting.
    .order("name", { ascending: true })
    .order("position(name)", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as RawHandover[]).map((row) => {
    const department = row.department as
      Record<string, unknown> | null | undefined;
    const name = String(row.name ?? "");
    // Both are aliased embeds — objects, not strings. See `mapHolder`.
    const positionRow = row.position as
      Record<string, unknown> | null | undefined;
    const position =
      positionRow && typeof positionRow === "object"
        ? String(positionRow.name ?? "")
        : "";
    const departmentName =
      department && typeof department === "object"
        ? str(department.name)
        : null;
    return {
      id: String(row.id),
      name,
      position,
      departmentName,
      label: position ? `${name} — ${position}` : name,
    };
  });
}

/**
 * Everything the printed document needs about one handover.
 *
 * **A separate read rather than a wider `HANDOVER_COLUMNS`.** The list needs a code,
 * a name and a condition; the document needs the serial number, the category and
 * the location as well. Widening the list constant would ship those three columns on
 * every list load and every row, to serve a screen opened once per printing.
 *
 * ## How one handover row is turned back into a whole batch
 *
 * A printed document is **per recipient, not per row** — the template has one device
 * table and one signature block, and a batch of eight assets to one person is one
 * document with eight rows in it. So this takes one `assignments` row and returns
 * its siblings.
 *
 * The grouping key is `(user_id, assigned_by, assigned_at)`, and that works because
 * of how the batch was written: `issueHandover` sends **one** multi-row insert,
 * `assigned_at` is left to its `now()` default, and `now()` is the *transaction*
 * timestamp — identical for every row of a single statement. So the three columns
 * match exactly for one batch, and differ between any two separate handovers even
 * one issued a second apart.
 *
 * That is a second property of the batch being one statement, and it arrived by
 * accident: the original reason was all-or-nothing writes. Worth knowing, because
 * changing it to N inserts would break the document grouping silently — every row
 * would become its own one-device document.
 */
export type HandoverDocumentAsset = {
  id: string;
  /**
   * The `assignments` row this device went out on.
   *
   * Carried on the document asset because the accessories are keyed by it, and the
   * device's own `id` is its `assets.id` — two different ids for two different
   * things, which is exactly the confusion that makes an accessory list appear
   * empty when it was looked up with the wrong one.
   */
  assignmentId: string;
  assetCode: string;
  serialNumber: string | null;
  name: string;
  /** The category, which is the template's "Type / Brand / Model". */
  categoryName: string | null;
  condition: AssetCondition;
  handoverDocNo: string | null;
  /** The bag, the charger — what travelled with this device on this handover. */
  accessories: HandoverAccessory[];
};

export type HandoverDocument = {
  /** The whole batch, in the order the rows were inserted. */
  assets: HandoverDocumentAsset[];
  /** Recipient: name, position and department from the roster. */
  holderName: string;
  holderPosition: string | null;
  holderDepartment: string | null;
  /**
   * The recipient's employer and staff number, printed as the `Company` and `NIK/EID`
   * lines in the parties block.
   *
   * Both nullable because `handover_users.company_id` and `.nik_eid` are: a
   * contractor has neither, and the roster has to be able to record them. The print
   * modal **omits** the line rather than printing an empty label, which is the rule
   * the per-device Notes cell already follows.
   */
  holderCompany: string | null;
  holderNikEid: string | null;
  /** Issuer: the account that recorded it. */
  issuerName: string;
  issuerEmail: string | null;
  /**
   * The issuer's own department, for the signature block's Department line.
   *
   * Separate from `issuerName` because the two are different facts and the print form
   * needs both. It is read here rather than left to the form to guess: the form seeds
   * that dropdown from this value, and a `<select>` seeded with a person's **name**
   * matches no option and silently falls through to the first department in the list,
   * which signs the form for a department the issuer is not in.
   */
  issuerDepartment: string | null;
  issuedAt: string;
  dueDate: string | null;
  /**
   * The note the admin typed when issuing the handover — the template's "Notes".
   *
   * **Batch-level, not per device.** `assignments.notes` lives on each loan row, and
   * a batch is written as one statement from one form, so every row in the batch
   * carries the same string. It is the handover's note, not each asset's, which is
   * why the column prints it once rather than once per row.
   */
  notes: string | null;
};

/**
 * One column list for the document's asset read, with the one embed it needs.
 *
 * `category` is an alias so it arrives as a single object rather than an array,
 * matching `getHandoverUserOptions`. It is not `!inner`: an asset whose category has
 * been deleted should print as an unclassified device rather than vanish from the
 * middle of the document — a blank cell is bad, but a device that is genuinely part
 * of what is being signed for silently missing is worse.
 *
 * **There is no `location` embed.** The template's Notes column used to be filled
 * with the asset's registered location, which was a second thing wearing that
 * column's name: `assignments.notes` — the note the admin typed when issuing the
 * handover — is the fact that column is for, and it lives on the handover rather
 * than on the asset. Reading location here was a way of having something to print
 * while the real notes went unused, so the embed is gone rather than left in the
 * query for a column nobody renders.
 */
const DOCUMENT_ASSET_COLUMNS =
  "id, asset_code, serial_number, name, condition, handover_doc_no, category:categories(name)";

/**
 * The document for one handover row, covering its whole batch.
 *
 * Three steps, and the order is forced: read the row to learn the batch key, read
 * the batch, then read the assets those rows point at. One query cannot do it — the
 * batch is the row's *neighbours*, which is the direction PostgREST has no embed
 * for.
 */
export async function getHandoverDocument(
  handoverId: string,
): Promise<HandoverDocument> {
  const { data: seed, error: seedError } = await supabase
    .from("assignments")
    .select(
      "id, user_id, assigned_by, assigned_at, due_date, notes, accessories:assignments_accessories(id, name), holder:handover_users!assignments_user_id_fkey(name, nik_eid, position:positions(name), department:departments(name), company:companies(name)), issuedBy:profiles!assignments_assigned_by_fkey(full_name, email, department:departments(name))",
    )
    .eq("id", handoverId)
    .maybeSingle();

  if (seedError) throw seedError;
  if (!seed) throw new HandoverNotFoundError();

  const row = seed as Record<string, unknown>;

  // The batch: same recipient, same issuer, same transaction timestamp.
  const { data: batch, error: batchError } = await supabase
    .from("assignments")
    .select("id, asset_id")
    .eq("user_id", String(row.user_id))
    .eq("assigned_by", String(row.assigned_by))
    .eq("assigned_at", String(row.assigned_at))
    .order("id", { ascending: true });

  if (batchError) throw batchError;

  const rows = (batch ?? []) as { id: string; asset_id: string }[];

  const assetIds = rows.map((r) => r.asset_id);
  const { data: assetRows, error: assetError } = await supabase
    .from("assets")
    .select(DOCUMENT_ASSET_COLUMNS)
    .in(
      "id",
      // The placeholder uuid keeps the query well-formed when the batch is empty,
      // which cannot happen for a real `handoverId` but stops `.in()` producing
      // `in ()` — a syntax error rather than an empty result.
      assetIds.length > 0 ? assetIds : ["00000000-0000-0000-0000-000000000000"],
    );

  if (assetError) throw assetError;

  const byId = new Map(
    ((assetRows ?? []) as Record<string, unknown>[]).map((a) => [
      String(a.id),
      a,
    ]),
  );

  // One query for the whole batch's accessories rather than one per row: ten
  // devices would otherwise be ten requests to display ten things the database
  // already relates to each other. `.in()` needs the same empty-guard treatment as
  // the asset read above for the same reason — `in ()` is a syntax error, not an
  // empty result.
  const { data: accessoryRows, error: accessoryError } = await supabase
    .from("assignments_accessories")
    .select("id, assignment_id, name")
    .in(
      "assignment_id",
      rows.length > 0
        ? rows.map((r) => r.id)
        : ["00000000-0000-0000-0000-000000000000"],
    )
    .order("id", { ascending: true });

  if (accessoryError) throw accessoryError;

  // Grouped by the assignment they belong to, so each device below reads its own
  // list. `assignment_id` is the grouping column rather than `asset_id` because
  // that is what the foreign key is — and it means a device handed over twice has
  // each handover's own accessories rather than the union of both.
  const accessoriesByAssignment = new Map<string, HandoverAccessory[]>();
  for (const row of (accessoryRows ?? []) as Record<string, unknown>[]) {
    const assignmentId = String(row.assignment_id);
    const list = accessoriesByAssignment.get(assignmentId) ?? [];
    list.push({ id: String(row.id), name: String(row.name ?? "") });
    accessoriesByAssignment.set(assignmentId, list);
  }

  /**
   * Assets in **batch order**, not asset order.
   *
   * The rows come back in `assignments.id` order and the document lists what was
   * handed over in the order it was ticked. Sorting by `asset_code` instead would
   * print a valid document in a different order from the one on screen.
   *
   * The row is carried alongside each asset rather than only its `asset_id`, because
   * the accessories hang off the **assignment**, not off the device — two handovers
   * of one laptop have different bags and the document must print each one's own.
   */
  const assets: HandoverDocumentAsset[] = rows
    .map((r) => ({ assignmentId: r.id, asset: byId.get(r.asset_id) }))
    .filter(
      (
        pair,
      ): pair is { assignmentId: string; asset: Record<string, unknown> } =>
        pair.asset !== undefined,
    )
    .map(({ assignmentId, asset: a }) => {
      const category = a.category as Record<string, unknown> | null | undefined;
      return {
        id: String(a.id),
        assignmentId,
        assetCode: String(a.asset_code ?? ""),
        serialNumber: str(a.serial_number),
        name: String(a.name ?? ""),
        categoryName: category ? str(category.name) : null,
        condition: String(a.condition ?? "") as AssetCondition,
        handoverDocNo: str(a.handover_doc_no),
        accessories: accessoriesByAssignment.get(assignmentId) ?? [],
      };
    });

  const holder = (row.holder ?? {}) as Record<string, unknown>;
  const holderPosition = holder.position as
    Record<string, unknown> | null | undefined;
  const holderDepartment = holder.department as
    Record<string, unknown> | null | undefined;
  const holderCompany = holder.company as
    Record<string, unknown> | null | undefined;
  const issuer = (row.issuedBy ?? {}) as Record<string, unknown>;
  const issuerDepartment = issuer.department as
    Record<string, unknown> | null | undefined;

  return {
    assets,
    holderName: String(holder.name ?? ""),
    holderPosition: holderPosition ? str(holderPosition.name) : null,
    holderDepartment: holderDepartment ? str(holderDepartment.name) : null,
    holderCompany: holderCompany ? str(holderCompany.name) : null,
    holderNikEid: str(holder.nik_eid),
    issuerName: str(issuer.full_name) ?? str(issuer.email) ?? "",
    issuerEmail: str(issuer.email),
    issuerDepartment: issuerDepartment ? str(issuerDepartment.name) : null,
    issuedAt: String(row.assigned_at ?? ""),
    dueDate: str(row.due_date),
    notes: str(row.notes),
  };
}

/** Raised when a handover id no longer resolves to a row. */
export class HandoverNotFoundError extends Error {
  constructor() {
    super("That handover record could not be read");
    this.name = "HandoverNotFoundError";
  }
}

/**
 * Which roster entries belong to the signed-in account.
 *
 * **This exists because of one line of UI.** The Return button used to be gated on
 * `row.userId === user?.id`, which was correct while `user_id` *was* an auth id —
 * both were the same uuid. Since `02000` moved `user_id` onto `handover_users`,
 * that comparison is a reference id against a JWT subject and is false for every
 * row, for every staff member: the button would silently vanish for exactly the
 * people the module was built for, and the page would look coherent doing it.
 *
 * So the client asks the database which roster rows are theirs rather than
 * guessing, and the RLS join in `assignments_select_own_or_admin` decides the
 * rows. **Both sides read the same column**, which is the point — a client-side
 * guess and a policy that disagree is how a staff member ends up with a button
 * that errors, or no button at all.
 *
 * Read rather than derived: it is one small request, `handover_users` is readable
 * by everyone, and an empty result is a normal state (an admin who is not on the
 * roster) rather than a failure.
 */
export async function getOwnHandoverUserIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from("handover_users")
    .select("id")
    .eq("profile_id", await currentUserId());

  if (error) throw error;
  return ((data ?? []) as RawHandover[]).map((row) => String(row.id));
}

/**
 * The caller's own auth id, read from the token rather than from a prop.
 *
 * A private helper rather than a parameter so a caller cannot pass somebody else's
 * id and get a list of their roster entries back — the filter is a *self* read,
 * and making the id an argument would quietly turn it into an arbitrary one.
 * PostgREST needs the id as a value, so it has to be fetched rather than derived
 * from the JWT the client does not hold.
 */
async function currentUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user?.id ?? null;
}

/**
 * Hand one or more assets over to one person, as **one batch or none**.
 *
 * **All-or-nothing, and the reason it is one statement.** PostgREST inserts an
 * array of rows in a single transaction, so if the third of five assets is no
 * longer `available` the whole batch rolls back and nothing is created. The
 * alternative — five separate inserts — leaves two records behind that the admin
 * did not expect and has to unpick by hand, which for a register whose job is to
 * say who is holding what is worse than a refusal.
 *
 * The trigger still runs per row, so `assignments_guard_asset_available` fires
 * once per asset and `assignments_sync_asset_status` flips each one to `assigned`.
 * The batch is only ever one row per *asset*, so the per-asset guards and
 * `assignments_one_open_per_asset` keep exactly the meaning they had.
 *
 * `assigned_at` is left to its `now()` default rather than sent from the browser:
 * it is the server's clock, and a client clock is a second source of truth for
 * when a handover happened. `assigned_by` **is** sent, because it is the caller
 * and the database has no way to know who asked.
 *
 * `status` is not sent and cannot be. `assignments_sync_asset_status` is an
 * `after insert` trigger and owns that transition — the same reason `createAsset`
 * does not send one.
 *
 * Refusals the client should be able to say something useful about:
 * - `23514` — one of the assets is not `available`: retired, damaged, already out,
 *   or in maintenance. One code for all four, because the message names the status.
 * - `23505` — two handovers of the same asset raced; the index caught it. With a
 *   batch this fires for the whole statement, not one row.
 * - `23503` — `userId` is not a `handover_users` row. A client bug, not user error,
 *   so this is left unmapped rather than dressed up as a user-facing message.
 */
export async function issueHandover(input: HandoverInput): Promise<Handover[]> {
  // An empty batch would write zero rows and report success — so `issueHandover`
  // would announce a handover that never happened. The form checks this too;
  // checking here as well is because a service that can report success for doing
  // nothing is the exact failure this codebase keeps documenting.
  if (input.assetIds.length === 0) {
    throw new NoAssetsSelectedError();
  }

  // `assigned_at` is not sent and cannot be: it is the server's `now()`, and the
  // batch grouping depends on every row of one call carrying that same value.
  //
  // **A plain multi-row insert again, not a function call.** `02400` introduced
  // `issue_handover_batch` so that the assignments and their accessories landed in
  // one transaction. Accessories are now added from the detail modal rather than at
  // issue time, so there is no second statement here to make atomic with this one,
  // and `02500` drops the function. All-or-nothing across the batch is unaffected:
  // PostgREST inserts an array in a single transaction, which is where that property
  // comes from, and it never came from the function.
  const rows = input.assetIds.map((assetId) => ({
    asset_id: assetId,
    user_id: input.userId,
    assigned_by: input.issuedBy,
    due_date: input.dueDate || null,
    notes: input.notes?.trim() || null,
    condition_at_handover: input.conditionAtHandover ?? null,
  }));

  const { data, error } = await supabase
    .from("assignments")
    .insert(rows)
    .select(HANDOVER_COLUMNS);

  if (error) throw error;

  // An insert that returns no rows means the write was filtered, which for an
  // INSERT against a row filter is the `assignments_insert_admin` policy refusing
  // a non-admin — reported as `42501`, but checked here too because "the service
  // returned an empty array" must never reach the screen as "handed over".
  if (!data || data.length === 0) throw new NoRowsWrittenError("inserted");

  return (data as RawHandover[]).map(mapHandover);
}

/**
 * Record one accessory travelling with a device.
 *
 * **Added from the handover's detail modal, not from the issue form.** That is the
 * shape the feature ended up with, and it is the better one: an admin who forgets
 * the bag at issue time can still record it afterwards, which the issue-time model
 * could not express at all. It is also the honest reading of the table — the
 * accessories are a fact about the handover, and a handover that exists can be
 * corrected.
 *
 * The trade this accepts is that a handover already printed and signed can gain an
 * accessory, which rewrites what the signed paper says. That is deliberate: the
 * alternative is a forgotten bag that can never be recorded, and this register's
 * job is to say what is actually held. `assignments_accessories_insert_admin` keeps
 * the boundary at admins, which is the same person who issues handovers.
 *
 * **A returned handover still accepts accessories**, following from the same
 * reasoning: the device came back, and if the bag did not, saying so is the useful
 * thing to be able to do. There is no "not yet printed" guard, because a handover
 * does not record whether it has been printed — that is true of every other field
 * here, and one column for it would be a second source of truth about an event this
 * application cannot observe.
 *
 * The name is trimmed and refused when blank **here**, rather than letting
 * `assignments_accessories_name_not_blank` raise. That check answers with `23514`
 * naming a constraint, which is not something an admin holding an empty text box can
 * act on.
 */
export async function addHandoverAccessory(
  assignmentId: string,
  name: string,
): Promise<HandoverAccessory> {
  const trimmed = name.trim();
  if (trimmed === "") throw new AccessoryNameRequiredError();

  const { data, error } = await supabase
    .from("assignments_accessories")
    .insert({ assignment_id: assignmentId, name: trimmed })
    .select("id, name")
    .single();

  if (error) throw error;

  const row = (data ?? {}) as Record<string, unknown>;
  return { id: String(row.id), name: String(row.name ?? trimmed) };
}

/**
 * Raised when the accessory field was left empty.
 *
 * A separate class rather than reusing the database's `23514`, because that one
 * means "RLS refused the write" to every other caller in this file, and an empty
 * text box is not that. Folding them together would show an admin an
 * access-control message for typing nothing.
 */
export class AccessoryNameRequiredError extends Error {
  constructor() {
    super("An accessory needs a name");
    this.name = "AccessoryNameRequiredError";
  }
}

/**
 * Remove one accessory.
 *
 * `.select()` and a zero-row check for the reason every write here has one: the
 * delete policy is `is_admin()`, so a non-admin's statement matches nothing and
 * PostgREST reports success. The page hides the control with `useIsAdmin()`, which
 * is a convenience rather than the boundary — this is the boundary.
 *
 * Removal rather than an "is this right" flag, because an accessory is only a claim
 * about what travelled with the device, and the way to say "that was not in the bag"
 * is to delete the line. A tombstone would add a state nothing reads.
 */
export async function deleteHandoverAccessory(
  accessoryId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("assignments_accessories")
    .delete()
    .eq("id", accessoryId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoRowsWrittenError("deleted");
}

/**
 * Which of these assets are no longer `available`.
 *
 * Called **only after a `23514`**, never before the insert, and that ordering is
 * the point. A pre-check would be a second source of truth that a second admin
 * can invalidate between the read and the write; the trigger is the boundary. So
 * this exists purely to turn the trigger's message — which names a bare uuid —
 * into something an admin can act on.
 *
 * It reuses the same read as the issue form's picker, filtered to the ids that
 * were attempted, so the answer is "these of the ones you picked are gone" rather
 * than a second interpretation of availability.
 */
export async function findUnavailableAssets(
  assetIds: string[],
  unit: AssetUnit,
): Promise<HandoverTarget[]> {
  if (assetIds.length === 0) return [];

  const { data, error } = await supabase
    .from("assets")
    .select("id, asset_code, name, serial_number, condition, handover_doc_no")
    .eq("department", unit)
    .eq("status", "available")
    .in("id", assetIds);

  if (error) throw error;

  const stillAvailable = new Set(
    ((data ?? []) as RawHandover[]).map((row) => String(row.id)),
  );

  // Returned as the *missing* ones, so the caller's message can name them
  // directly rather than subtract two lists itself.
  return await Promise.all(
    assetIds
      .filter((id) => !stillAvailable.has(id))
      .map(async (id) => {
        const { data: row } = await supabase
          .from("assets")
          .select(
            "id, asset_code, name, serial_number, condition, handover_doc_no",
          )
          .eq("id", id)
          .maybeSingle();
        const r = (row ?? {}) as RawHandover;
        return {
          id,
          assetCode: String(r.asset_code ?? id),
          name: String(r.name ?? ""),
          serialNumber: str(r.serial_number),
          condition: String(r.condition ?? "") as AssetCondition,
          handoverDocNo: str(r.handover_doc_no),
        };
      }),
  );
}

/**
 * Record that the asset came back.
 *
 * `returned_at` is sent as an ISO string rather than a SQL `now()` through a
 * function call, because PostgREST cannot call a database function in an UPDATE
 * — `rpc` is the only route to one, and an `rpc` cannot be filtered to the row.
 * The cost is that this is the browser's clock; `assignments_dates_ordered` at
 * least refuses a return dated before the handover, which is the error that would
 * actually be worth catching.
 */
export async function returnHandover(
  handoverId: string,
  notes?: string | null,
): Promise<void> {
  const { data, error } = await supabase
    .from("assignments")
    .update({
      returned_at: new Date().toISOString(),
      ...(notes?.trim() ? { notes: notes.trim() } : {}),
    })
    .eq("id", handoverId)
    .select("id")
    .maybeSingle();

  if (error) throw error;

  // Only reachable for a caller who may not touch this row — RLS answers a
  // non-permitted UPDATE with zero rows and no error.
  if (!data) throw new NoRowsWrittenError("updated");
}

/**
 * Delete a handover record, refusing while it is still open.
 *
 * The refusal is in the application and not on the foreign key, because
 * `assignments_sync_asset_status` runs `after delete` too: deleting an open row
 * returns the asset to `available` while the person still has it, with no error
 * anywhere. A constraint cannot express "no row with `returned_at is null` may be
 * deleted" without a trigger, and the read it needs is one the client can do.
 */
export async function deleteHandover(handoverId: string): Promise<void> {
  const { data: existing, error: readError } = await supabase
    .from("assignments")
    .select("returned_at")
    .eq("id", handoverId)
    .maybeSingle();

  if (readError) throw readError;

  // `null` here means RLS hid the row rather than that the row is missing, so the
  // delete below is the thing that reports it rather than this check inventing a
  // second answer.
  if (existing && existing.returned_at === null) {
    throw new HandoverOpenError();
  }

  const { data, error } = await supabase
    .from("assignments")
    .delete()
    .eq("id", handoverId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoRowsWrittenError("deleted");
}

/**
 * `23514` is `check_violation`, and for this module it means one thing to say:
 * the asset is not `available`. Both `assignments_guard_asset_available` and
 * `block_assignment_while_in_maintenance` raise it, and so does
 * `assets_guard_status`.
 */
export function isUnavailableAssetError(error: unknown): boolean {
  return codeOf(error) === "23514";
}

/** `23505`, the race the partial index caught. */
export function isAlreadyHandedOverError(error: unknown): boolean {
  return codeOf(error) === "23505";
}

function codeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const { code } = error as { code?: unknown };
  return typeof code === "string" ? code : null;
}
