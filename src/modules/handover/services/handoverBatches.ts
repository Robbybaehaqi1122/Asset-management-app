import type { Handover } from "./handoverService";

/**
 * One issued batch: every row written by a single multi-row insert.
 *
 * ## The key, and why it is three columns and not an id
 *
 * `(user_id, assigned_by, assigned_at)`. All three are identical across a batch
 * because a batch is **one statement**: `assigned_at` defaults to `now()`, which is
 * the *transaction* timestamp, so every row of one insert carries the identical value.
 * The original reason for one statement was all-or-nothing writes; this grouping is a
 * second property that arrived with it.
 *
 * **That is also the reason not to change `issueHandover` to N inserts.** It would
 * still be correct — each row would still be a handover — but every row would then be
 * its own batch, so one issue of eight assets would print as eight one-device
 * documents. Nothing would error; the documents would quietly stop matching the paper
 * the template describes.
 *
 * `assigned_at` is compared as a string because it comes back as an ISO timestamp and
 * Postgres renders it identically for every row in the transaction, so there is no
 * timezone or precision difference to normalise.
 *
 * ## Why a group and not a synthetic parent row
 *
 * A batch is **not a row**. It is a set of rows that happen to share a recipient, an
 * issuer and a timestamp, and it has no row of its own — there is no `batches` table,
 * and inventing one would be a second source of truth for a grouping the database
 * already determines. So this is computed from the rows on every render, and the
 * first row is a **representative**: it carries the id the print modal is opened with,
 * which is safe precisely because `getHandoverDocument` ignores which row it was
 * given and reads the whole group.
 */
export type HandoverBatch = {
  /**
   * The identity of the group: `(user_id, assigned_by, assigned_at)`.
   *
   * Exposed rather than recomputed by the caller, because the page needs it to hold
   * "which batch's detail list is open" and to key the row menu — and a second place
   * that builds this string is a second place it can be built differently.
   *
   * `assigned_by` is nullable, so the null case carries an explicit `" none"`
   * marker. `String(null)` would render `"null"`, which is one typo away from being
   * indistinguishable from a value.
   */
  key: string;
  /** Any row of the batch. The id here opens the document for **all** of them. */
  seed: Handover;
  /** Every row in the batch, in `assignments.id` order — the order they were ticked. */
  items: Handover[];
  /** How many of `items` are still out. `items.length - openCount` have come back. */
  openCount: number;
  /** The holder, taken from the seed: identical across the batch by the key. */
  holder: Handover["holder"];
  /** The issuer, likewise. Null on every row together, via `on delete set null`. */
  issuedBy: Handover["issuedBy"];
  /** `assigned_at`, likewise. */
  assignedAt: string;
  dueDate: string | null;
  /**
   * The distinct `handover_doc_no` values in this batch, blanks dropped.
   *
   * More than one is legitimate: `handover_doc_no` lives on the **asset**, not on the
   * handover, so a batch can span assets that were documented separately. Listing them
   * all is honest where picking one would not be.
   */
  docNumbers: string[];
};

/**
 * `(user_id, assigned_by, assigned_at)` as one string.
 *
 * A `Map` needs a primitive, and joining three columns is the smallest thing that
 * cannot collide: a `|` separator keeps a uuid from ever being read across the
 * boundary, and `assigned_at` is ISO with no `|` in it.
 */
function batchKeyOf(row: Handover): string {
  // `assigned_by` is nullable (`on delete set null`). The marker is explicit rather
  // than relying on `String(null)`, so the key cannot read as a uuid.
  return `${row.userId}|${row.assignedBy ?? " none"}|${row.assignedAt}`;
}

/**
 * Groups rows into batches, keeping the order `getHandovers` returned them in.
 *
 * A `Map` keyed on the three columns, and iteration order is insertion order — so the
 * result already reflects the service's `assigned_at desc` without a second sort.
 * That is deliberate: re-sorting a derived array would be a second place for the
 * order to be decided.
 *
 * Within a batch, items are sorted by `id` for the same reason the print document
 * sorts its own rows: the form lists what was handed over in the order it was ticked,
 * and the table should not print in a different order from the screen.
 */
export function groupIntoBatches(rows: Handover[]): HandoverBatch[] {
  const groups = new Map<string, HandoverBatch>();

  for (const row of rows) {
    const key = batchKeyOf(row);

    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        key,
        seed: row,
        items: [row],
        openCount: row.returnedAt === null ? 1 : 0,
        holder: row.holder,
        issuedBy: row.issuedBy,
        assignedAt: row.assignedAt,
        dueDate: row.dueDate,
        docNumbers:
          row.asset?.handoverDocNo != null && row.asset.handoverDocNo !== ""
            ? [row.asset.handoverDocNo]
            : [],
      });
      continue;
    }

    existing.items.push(row);
    if (row.returnedAt === null) existing.openCount += 1;
    if (row.asset?.handoverDocNo != null && row.asset.handoverDocNo !== "") {
      existing.docNumbers.push(row.asset.handoverDocNo);
    }
  }

  const batches = [...groups.values()];

  for (const batch of batches) {
    batch.items.sort((a, b) => a.id.localeCompare(b.id));
    // Deduped rather than sorted: the order assets were ticked is the useful order to
    // read them in, and `Set` preserves first-seen order while removing the repeats a
    // batch of same-doc assets produces.
    batch.docNumbers = [...new Set(batch.docNumbers)];
  }

  return batches;
}
