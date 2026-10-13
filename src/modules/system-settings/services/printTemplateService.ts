import { supabase } from "@/lib/supabase";
import {
  LbxFormatError,
  missingObjects,
  readLbx,
  type LbxContents,
  type LbxSheet,
} from "@/modules/assets/document/lbxReader";

/**
 * Print templates: the Brother `.lbx` files this installation prints labels with.
 *
 * ## The file is authoritative, and this service never becomes a second copy of it
 *
 * Paper sizes are **not** stored. `print_templates` holds a pointer, a sheet choice and
 * an `is_active` flag; every size the screen shows is read back out of the file by
 * `lbxReader`. That is one 2.7 KB download, which is the same fetch b-PAC makes when it
 * opens the template — and it means a re-exported template's sizes cannot disagree with
 * what the printer would do.
 *
 * ## Three steps in order, and the order is the design
 *
 * 1. **Read and validate in the browser**, before anything is uploaded. A `.lbx` is a ZIP
 *    whose `label.xml` is DEFLATE-compressed, so the object names are invisible to a
 *    substring search; the reader inflates it with `DecompressionStream`.
 * 2. **Upload to Storage.** The bucket is public-read because `Doc.Open` is fetched by
 *    the b-PAC extension without an `Authorization` header.
 * 3. **Insert the row.** If that fails the object is removed again — see
 *    {@link uploadPrintTemplate}, where an orphaned `.lbx` would otherwise accumulate
 *    invisibly.
 */

/** The one bucket, named once so the path and the policy cannot drift apart. */
const BUCKET = "print-templates";

/** Thrown when RLS matched no row, so the write silently did nothing. */
export class NoRowsWrittenError extends Error {
  constructor(operation: string) {
    super(`No print template was ${operation}`);
    this.name = "NoRowsWrittenError";
  }
}

/** A `.lbx` that parsed, but cannot be filled by the print path. */
export class TemplateNotFillableError extends Error {
  // Declared rather than attached in the constructor: `erasableSyntaxOnly` is on, so a
  // parameter property is a compile error and this is the shape the other services use.
  readonly sheetName: string;
  readonly missing: string[];

  constructor(sheetName: string, missing: string[]) {
    super(
      `Sheet "${sheetName}" has no ${missing.join(", ")}. Labels would print with those fields blank.`,
    );
    this.name = "TemplateNotFillableError";
    this.sheetName = sheetName;
    this.missing = missing;
  }
}

export type PrintTemplate = {
  id: string;
  name: string;
  filePath: string;
  /** Which sheet of the `.lbx` to print on; null means "the file's own default". */
  sheet: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * Every column, named explicitly.
 *
 * A `select *` would break the whole screen the moment a column is added or dropped —
 * PostgREST refuses the *statement*, not one field — which is the `locations.name`
 * failure recorded throughout this codebase.
 */
const COLUMNS = "id, name, file_path, sheet, is_active, created_at, updated_at";

/** What an upload produced: the row, plus what the file turned out to contain. */
export type UploadResult = {
  row: PrintTemplate;
  contents: LbxContents;
  /** Objects the chosen sheet lacks — empty when the template can be printed against. */
  missing: string[];
};

/**
 * The public URL of a stored template.
 *
 * **Built from the project URL, never stored.** `file_path` is a bucket path precisely so
 * this works unchanged on another project; a stored URL would name this host and no
 * other. The `public` bucket means no signed URL is needed or wanted — a signed one would
 * expire, and the extension's fetch carries no credentials to refresh it with.
 */
export function templateUrl(filePath: string): string {
  const base = import.meta.env.VITE_SUPABASE_URL.replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${BUCKET}/${filePath}`;
}

/**
 * Every template, newest name first.
 *
 * `print_templates_select_authenticated` is `using (true)`, so this is the same list for
 * an admin and a staff member — the print path needs to know the active one, and gating
 * the read would make the Print button fail for staff for no reason.
 */
export async function listPrintTemplates(): Promise<PrintTemplate[]> {
  const { data, error } = await supabase
    .from("print_templates")
    .select(COLUMNS)
    .order("name");

  if (error) throw error;
  return (data ?? []).map(mapTemplate);
}

/** The template printing uses, or null when none has been activated yet. */
export async function getActivePrintTemplate(): Promise<PrintTemplate | null> {
  const { data, error } = await supabase
    .from("print_templates")
    .select(COLUMNS)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  return data ? mapTemplate(data) : null;
}

/**
 * Read a stored template's sheets.
 *
 * **This is what populates the label-size dropdown, and it is why no size is stored.**
 * The file is the only thing that knows its own sheets, and a stale cached size would be
 * worse than a 2.7 KB fetch.
 */
export async function readStoredTemplate(
  filePath: string,
): Promise<LbxContents> {
  const response = await fetch(templateUrl(filePath));
  if (!response.ok) {
    throw new LbxFormatError(
      `The stored template could not be read (HTTP ${response.status}). Re-upload it.`,
    );
  }
  return readLbx(await response.arrayBuffer());
}

/**
 * Validate, store, and record an uploaded `.lbx`.
 *
 * **Validation happens before the upload, not after.** A rejected file that was already
 * uploaded would leave an object in the bucket that no row points at, and the bucket is
 * world-readable — so a bad file would sit there until somebody noticed. The reader is
 * also the only place that knows whether the *chosen* sheet can be filled, and it can
 * only answer that by opening the file.
 *
 * **A row failure removes the object again.** Storage and Postgres cannot share a
 * transaction, so the two writes are made in the only order that cannot leak: the object
 * first, the row second, and an undo if the second fails.
 */
export async function uploadPrintTemplate(
  file: File,
  name: string,
  sheetName: string | null,
): Promise<UploadResult> {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new LbxFormatError("Give the template a name before saving it.");
  }

  const contents = await readLbx(await file.arrayBuffer());
  const sheet = pickSheet(contents, sheetName);
  const missing = missingObjects(sheet);

  // A file whose chosen sheet has nothing to write is refused **only when a sheet was
  // named**. Left unnamed, the operator may be uploading a template to look at, and the
  // listing shows which sheets are fillable.
  if (sheetName !== null && missing.length > 0) {
    throw new TemplateNotFillableError(sheet.name, missing);
  }

  // The object's name is a fresh UUID, never the operator's file name: it keeps a
  // predictable path from becoming an injection surface, and a re-upload cannot
  // silently overwrite the template that is currently printing.
  const filePath = `${crypto.randomUUID()}.lbx`;

  const upload = await supabase.storage
    .from(BUCKET)
    .upload(filePath, file, { contentType: "application/octet-stream" });

  if (upload.error) throw upload.error;

  const { data, error } = await supabase
    .from("print_templates")
    .insert({ name: trimmed, file_path: filePath, sheet: sheet.name })
    .select(COLUMNS)
    .single();

  if (error || !data) {
    await supabase.storage.from(BUCKET).remove([filePath]);
    throw error ?? new Error("The template was stored but not recorded.");
  }

  return { row: mapTemplate(data), contents, missing };
}

/**
 * Make one template the one printing uses.
 *
 * **Two writes, and the order is deliberate.** The index allows exactly one active row,
 * so the previous one has to be cleared *first* or the new one is refused by
 * `print_templates_one_active` — and the message would name a constraint rather than the
 * button the operator pressed.
 *
 * Both writes use `.select()`. `print_templates_update_admin` is a row filter, so a
 * caller who may not touch the row matches nothing and PostgREST reports success with
 * zero rows — which is the fourth time in this codebase that a resolved promise has
 * meant nothing happened.
 */
export async function activatePrintTemplate(id: string): Promise<void> {
  const cleared = await supabase
    .from("print_templates")
    .update({ is_active: false })
    .eq("is_active", true)
    .select("id");

  if (cleared.error) throw cleared.error;

  const activated = await supabase
    .from("print_templates")
    .update({ is_active: true })
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();

  if (activated.error) throw activated.error;
  if (!activated.data) {
    // Put the previous one back, so a refused activation does not silently leave the
    // installation with no template at all.
    await supabase
      .from("print_templates")
      .update({ is_active: true })
      .eq("id", cleared.data?.[0]?.id ?? "");
    throw new NoRowsWrittenError("activated");
  }
}

/**
 * Choose which sheet of a stored template to print on.
 *
 * Separate from {@link activatePrintTemplate} because the two answer different questions:
 * *which template* and *which roll is loaded in it*. The row is not re-uploaded, and the
 * file on disk is untouched.
 */
export async function setTemplateSheet(
  id: string,
  sheet: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("print_templates")
    .update({ sheet })
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoRowsWrittenError("updated");
}

/**
 * Remove a template, and its file with it.
 *
 * **The object goes first.** The reverse order leaves an unreadable object behind if the
 * row delete is refused, and this bucket is public — an orphaned `.lbx` would stay
 * fetchable by anyone holding its URL forever. Removing the row first would risk a
 * template printing against a file that no longer exists.
 *
 * A missing object is not an error: it means someone cleaned up Storage by hand, and the
 * row is what the database knows about.
 */
export async function deletePrintTemplate(id: string): Promise<void> {
  const { data: row, error: readError } = await supabase
    .from("print_templates")
    .select("id, file_path")
    .eq("id", id)
    .maybeSingle();

  if (readError) throw readError;
  if (!row) throw new NoRowsWrittenError("found");

  await supabase.storage.from(BUCKET).remove([row.file_path]);

  const { data, error } = await supabase
    .from("print_templates")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoRowsWrittenError("deleted");
}

/* ------------------------------------------------------------------ internals */

function mapTemplate(row: Record<string, unknown>): PrintTemplate {
  return {
    id: String(row.id),
    name: String(row.name),
    filePath: String(row.file_path),
    sheet:
      row.sheet === null || row.sheet === undefined ? null : String(row.sheet),
    isActive: row.is_active === true,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * The named sheet, or the file's own default when none was named.
 *
 * **The file's default is not assumed to be printable.** `asset-36x15.lbx` declares
 * `currentSheet="36x13"`, so "no sheet chosen" would mean the 13 mm roll — a real
 * surprise on a machine loaded with 15 mm stock. When the file names a current sheet that
 * one is used; otherwise the first sheet is, which is the only thing left to mean.
 */
function pickSheet(contents: LbxContents, sheetName: string | null): LbxSheet {
  if (sheetName === null) {
    const named = contents.sheets.find((s) => s.name === contents.currentSheet);
    return named ?? contents.sheets[0];
  }

  const found = contents.sheets.find((s) => s.name === sheetName);
  if (!found) {
    throw new LbxFormatError(
      `That template has no sheet named "${sheetName}". It has: ${contents.sheets
        .map((s) => s.name)
        .join(", ")}.`,
    );
  }
  return found;
}
