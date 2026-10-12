/**
 * What an asset label says, and the paper it is printed on.
 *
 * **This is data, not a component, and the split is the handover document's.** The
 * legal text on the berita acara lives in `documentContent.ts` rather than in the
 * component because a signed artefact must print identically every time and a missing
 * translation key must not be able to remove a clause from it. A label is smaller but
 * the same reasoning applies to the parts that are fixed: the company mark and the
 * paper size are properties of the label stock, not of the current user's language, so
 * neither belongs in i18n.
 *
 * The three text lines and the barcode payload are decided here rather than in the
 * component so that "what does this label say" is one readable function instead of a
 * scattering of JSX conditionals.
 */

/**
 * The stock: **Brother PT-P900W continuous roll, 36 × 15 mm.**
 *
 * These two numbers are load-bearing in three separate places — the `@page` rule in
 * `index.css`, the label element's own box, and the preview that shows the admin what
 * they are about to print. They are repeated rather than shared because one of the
 * three is a CSS declaration and the others are Tailwind arbitrary values; a constant
 * cannot reach all three, and a single source of truth that silently diverges in one
 * of them would print misaligned labels.
 *
 * **Why millimetres rather than inches.** The Brother driver is configured in inches
 * (`0.63 in` length, `1.4 in` media) because that is the driver's unit, but the page
 * box CSS is millimetres. There is no conversion to get wrong as long as nothing
 * converts between them, so the label is authored in mm and the *printer* is set up in
 * inches on the driver side.
 */
export const LABEL_WIDTH_MM = 36;
export const LABEL_HEIGHT_MM = 15;

/**
 * The company mark printed on line 2, before the unit.
 *
 * The line reads `PGT - IT`: the mark, a separator, then `assets.department`. `PGT` is
 * the abbreviation of "PT. Patimban Global Gateway Terminal", which is the full legal
 * name the handover document prints as `COMPANY_NAME`. **The abbreviation is a separate
 * literal rather than something derived from that name** — the two differ, the label
 * has room for one and not the other, and deriving an abbreviation by taking initials
 * would be an invention rather than a fact.
 */
export const COMPANY_MARK = "PGT";

/** The separator between the company mark and the unit. */
export const COMPANY_UNIT_SEPARATOR = " - ";

/**
 * The description is trimmed to fit line 3 rather than wrapped.
 *
 * A label is a fixed box, and a third line that wrapped onto a fourth would either be
 * clipped or push the text block out of the vertical centre. Truncation is the honest
 * version: what is on the label is visibly abbreviated, and the full name is still in
 * the list the label came from.
 *
 * **22 characters, and it is measured rather than guessed** — at 5 pt a proportional
 * face averages roughly half the point size per glyph, which is 0.88 mm, and line 3 has
 * about 20 mm to spend. The budget is stated here so that changing the font size has to
 * be a decision about this number too.
 */
export const DESCRIPTION_MAX_CHARS = 22;

/**
 * What goes inside the barcode.
 *
 * **The asset code alone, and that is the whole payload.** Three things were available
 * and only one is honest:
 *
 * - It is the one field the register already guarantees is unique — `02300` made it
 *   unique over `upper(btrim(asset_code))` precisely so a code identifies exactly one
 *   asset. A barcode carrying a value the database lets two rows share is a barcode
 *   that can be wrong.
 * - **This application has no asset detail page**, so a URL payload has nowhere to
 *   point. The list is the only place an asset exists in the UI, and a deep link to a
 *   list filtered by code is a worse thing to engrave on a label than the code itself.
 * - A name and a unit in the payload would make the symbol dense enough to stop
 *   scanning at this size. The text is printed beside it; putting it in the symbol too
 *   means the two can disagree, which is the failure the label format exists to avoid.
 */
export const BARCODE_PAYLOAD = "asset_code";

/** The lines a label prints, in order, top to bottom. */
export interface LabelContent {
  /** Line 1 — bold, the largest. Also the barcode payload. */
  assetCode: string;
  /** Line 2 — the company mark and the owning unit. */
  companyAndUnit: string;
  /** Line 3 — the asset description, truncated to `DESCRIPTION_MAX_CHARS`. */
  description: string;
}

/** The shape this module needs, so it does not import the whole asset type. */
export interface LabelSource {
  asset_code: string;
  name: string;
  short_name: string | null;
  department: string;
}

/**
 * Truncate to a character budget, marking that something was cut.
 *
 * A bare `slice` would produce a line that looks complete and is not — `HP Pro Mini 40`
 * is a plausible model name, so the reader has no way to know it was cut. The ellipsis
 * is the difference between an abbreviation and a wrong fact.
 */
function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Build the three lines from an asset.
 *
 * **`short_name` is preferred over `name` because `name` does not fit.** The register's
 * `name` column holds values like "HP Pro Mini 400G9 Desktop PC", which at line 3's
 * width is an ellipsis and little else; `short_name` is the field that exists to be the
 * short form. It is nullable, so `name` is the fallback rather than the other way round
 * — an asset with no short name should still get its real name printed, truncated,
 * rather than an empty line.
 */
export function buildLabelContent(asset: LabelSource): LabelContent {
  const assetCode = asset.asset_code.trim();
  const unit = asset.department.trim();

  return {
    assetCode,
    companyAndUnit: `${COMPANY_MARK}${COMPANY_UNIT_SEPARATOR}${unit}`,
    description: truncate(
      asset.short_name ?? asset.name,
      DESCRIPTION_MAX_CHARS,
    ),
  };
}
