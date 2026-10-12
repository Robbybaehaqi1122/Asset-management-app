/**
 * What an asset label says, where each piece sits, and the paper it is printed on.
 *
 * ## Every number here was measured out of Brother's own label file
 *
 * The source is `Label Layout 36x15 mm (3).lbx` in the repo root — a P-touch
 * Editor template, which is a ZIP containing `label.xml`. Sheet `36x15` in that
 * file declares:
 *
 * ```
 * <style:paper width="102.4pt" height="45.4pt"
 *             marginLeft="5.8pt" marginTop="2.8pt" .../>
 * <barcode x="59.2pt" y="2.7pt" width="40pt" height="40pt"/>   <!-- QRCODE -->
 * <text x="5.6pt" y="4pt"   width="53.4pt" height="10.9pt" .../> <!-- Helsinki 8.5pt, weight 700 -->
 * <poly  x="5.3pt" y="14.6pt" width="54pt" height="0.6pt"/>
 * <text x="5.8pt" y="15.5pt" width="56.6pt" height="7.7pt" .../>  <!-- Helsinki 6pt -->
 * <text x="5.6pt" y="24.4pt" width="53.4pt" height="14.1pt" .../> <!-- Helsinki 6pt -->
 * ```
 *
 * **This file is the specification, and it corrected five things this module had
 * wrong.** The first version was authored by eye from a screenshot and guessed:
 *
 * | | guessed | measured |
 * |---|---|---|
 * | paper | 36 × 15 mm | **36.12 × 16.02 mm** — the roll is 16 mm, which is the `0.63 in` in the driver |
 * | QR | 11.5 mm | **14.11 mm** — a 2.6 mm mistake, and the QR is the thing that has to scan |
 * | line 1 font | 7 pt | **8.5 pt bold** |
 * | lines 2–3 font | 5 pt | **6 pt** |
 * | the rule between line 1 and line 2 | absent | **present**, 19.05 × 0.21 mm |
 *
 * Converting points to millimetres is `× 25.4 / 72`, and every `MM` value below is
 * the result. They are written out rather than computed so the code has no unit
 * conversion in it at all — which is deliberate, because a conversion is the one
 * thing that can be wrong in a way nobody notices.
 */

/** 102.4 pt. The roll's width, and the driver's `1.4"` media setting. */
export const LABEL_WIDTH_MM = 36.12;

/**
 * 45.4 pt — **16.02 mm, not 15.**
 *
 * This is the single most useful thing the template file settled. The driver's
 * length is `0.63 in`, which is 16 mm, and the first version declared the page
 * 15 mm tall. The 1 mm is not cosmetic on a label: it is a millimetre of stock
 * consumed per label that carries nothing, and over a stock-take of several
 * hundred assets that is the difference between running out and not.
 */
export const LABEL_HEIGHT_MM = 16.02;

/** Left and right text margin: 5.8 pt. */
export const LABEL_MARGIN_X_MM = 2.05;
/** Top and bottom text margin: 2.8 pt. */
export const LABEL_MARGIN_Y_MM = 0.99;

/**
 * The box `AssetLabel` actually draws into: **35.56 × 16 mm.**
 *
 * **These are not `LABEL_WIDTH_MM` / `LABEL_HEIGHT_MM`, and the difference is real.** The
 * two above are what the template *declares* — the sheet, at 1.42". The two here are the
 * media the driver is set to, `1.4" × 0.63"`, which is the area the head actually lays ink
 * on. A drawing at sheet size is 0.56 mm wider than the roll, so its right edge sits in
 * the gap the printer will not print.
 *
 * They live here rather than as literals in the component because two places now need
 * them and one of them multiplies by a scale factor — a number typed twice is a number
 * that can silently disagree with itself.
 */
export const LABEL_BOX_WIDTH_MM = 35.56;
export const LABEL_BOX_HEIGHT_MM = 16;

/**
 * The barcode: `x=59.2pt y=2.7pt width=40pt height=40pt`, protocol `QRCODE`.
 *
 * **14.11 mm square, and it is bigger than the text column.** The first version
 * sized it at 11.5 mm to leave the description room, which was trading the one
 * element that has to be machine-readable for one that has to be read by a person
 * who is standing in front of the shelf. The template has both at full size.
 */
export const QR_X_MM = 20.88;
export const QR_Y_MM = 0.95;
export const QR_SIZE_MM = 14.11;

/**
 * The three text lines, `x`/`y`/`width` from the template's three `text` objects.
 *
 * `height` is not used for layout — the template sets it per object and the
 * description's is 4.97 mm precisely because it is allowed to wrap onto a second
 * line (`autoLF="true"`), not because it is meant to be one line tall.
 */
export interface LabelLine {
  x: number;
  y: number;
  width: number;
  /** CSS font-size, in points. */
  fontPt: number;
  bold: boolean;
}

/** `x=5.6pt y=4pt width=53.4pt`, Helsinki 8.5pt, weight 700. */
export const LINE_ASSET_CODE: LabelLine = {
  x: 1.98,
  y: 1.41,
  width: 18.84,
  fontPt: 8.5,
  bold: true,
};

/** `x=5.8pt y=15.5pt width=56.6pt`, Helsinki 6pt, weight 400. */
export const LINE_COMPANY_UNIT: LabelLine = {
  x: 2.05,
  y: 5.47,
  width: 19.97,
  fontPt: 6,
  bold: false,
};

/** `x=5.6pt y=24.4pt width=53.4pt`, Helsinki 6pt, weight 400. */
export const LINE_DESCRIPTION: LabelLine = {
  x: 1.98,
  y: 8.61,
  width: 18.84,
  fontPt: 6,
  bold: false,
};

/**
 * The rule under the asset code: `x=5.3pt y=14.6pt width=54pt height=0.6pt`.
 *
 * **It was missing entirely from the first version**, and it is not decoration —
 * it is what separates the identifier from the two descriptive lines, and on a
 * label read at arm's length it is doing more work than the second line's text.
 */
export const RULE = {
  x: 1.87,
  y: 5.15,
  width: 19.05,
  /** 0.6 pt is the object's box; a 0.2 mm line is what actually prints. */
  thicknessMm: 0.2,
} as const;

/**
 * The company mark printed on line 2, before the unit.
 *
 * The line reads `PGT - IT`: the mark, a separator, then `assets.department`.
 * `PGT` abbreviates "PT. Patimban Global Gateway Terminal", the full legal name the
 * handover document prints as `COMPANY_NAME`. **The abbreviation is a separate
 * literal rather than derived from that name** — the two differ, the label has
 * room for one and not the other, and taking initials would be an invention
 * rather than a fact.
 */
export const COMPANY_MARK = "PGT";

/** The separator between the company mark and the unit. */
export const COMPANY_UNIT_SEPARATOR = " - ";

/**
 * The font stack, and why it is not Helsinki.
 *
 * The template asks for **Helsinki**, Brother's metric-compatible clone of
 * Helvetica, which is not a web font and will not be on a browser's machine.
 * `Helvetica, Arial, sans-serif` is the closest thing that is: Helsinki is
 * metrically Helvetica, so Arial — which is metrically Helvetica — lands on the
 * same advance widths, and the box widths measured above then hold.
 *
 * **There is no webfont here on purpose.** Loading one would put a download in
 * front of every label print, and the exact typeface is a far smaller thing to get
 * wrong than the barcode's size.
 */
export const LABEL_FONT_FAMILY = "Helvetica, Arial, sans-serif";

/**
 * What goes inside the barcode.
 *
 * **The asset code alone, and that is the whole payload.** Three things were
 * available and only one is honest:
 *
 * - It is the one field the register guarantees unique — `02300` made it unique
 *   over `upper(btrim(asset_code))` precisely so a code identifies exactly one
 *   asset. A barcode carrying a value two rows may share is a barcode that can be
 *   wrong.
 * - **This application has no asset detail page**, so a URL payload has nowhere to
 *   point. The list is the only place an asset exists in the UI.
 * - A name and a unit in the payload would make the symbol dense enough to stop
 *   scanning, while duplicating text printed *beside* it — so the two could
 *   disagree, which is the exact failure the label format exists to prevent.
 */
export const BARCODE_PAYLOAD = "asset_code";

/** The lines a label prints, in order, top to bottom. */
export interface LabelContent {
  /** Line 1 — bold, 8.5 pt. Also the barcode payload. */
  assetCode: string;
  /** Line 2 — the company mark and the owning unit. */
  companyAndUnit: string;
  /** Line 3 — the asset description, at 6 pt. Allowed to wrap onto two lines. */
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
 * Build the three lines from an asset.
 *
 * **The description is not truncated, and that changed.** The first version clipped
 * it to 22 characters because the guessed column was thought to be 20.9 mm at
 * 5 pt. The template's column is 18.84 mm at 6 pt but gives that object a 4.97 mm
 * box with `autoLF="true"` — it is designed to wrap to a second line. So the real
 * limit is how much fits in two lines, which at this size is a long asset name, and
 * silently cutting a name to fit a box that was never a clipping box loses
 * information the template intended to carry.
 */
export function buildLabelContent(asset: LabelSource): LabelContent {
  return {
    assetCode: asset.asset_code.trim(),
    companyAndUnit: `${COMPANY_MARK}${COMPANY_UNIT_SEPARATOR}${asset.department.trim()}`,
    description: (asset.short_name ?? asset.name).trim(),
  };
}
