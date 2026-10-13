/**
 * Reads a Brother P-touch template (`.lbx`) well enough to describe it and to refuse a
 * file this application cannot fill.
 *
 * ## Why the file has to be opened at all
 *
 * **A `.lbx` is a ZIP whose `label.xml` is DEFLATE-compressed**, so the object names are
 * not visible in the raw bytes. Measured against `asset-36x15.lbx`:
 *
 * ```
 * label.xml   method=8 (DEFLATE)  raw=19998B  compressed=2091B
 * "Text7" in raw bytes : not found
 * "Text8" in raw bytes : not found
 * "asset-code" in raw  : not found
 * "label.xml" in raw   : found      <- the central directory is not compressed
 * ```
 *
 * So validating an upload cannot be a substring search, and the alternative — trusting the
 * file and discovering the problem when a **printed label comes out with a blank field** —
 * is the failure this module exists to prevent. The four object names are a contract with
 * a binary file, and a rename in P-touch Editor breaks it silently.
 *
 * ## No dependency, and that was a deliberate choice
 *
 * `DecompressionStream("deflate-raw")` is native in Chromium, which is guaranteed here
 * anyway: b-PAC's transport **is** a browser extension, so a browser without it cannot
 * print at all. Adding a zip library for ~60 lines of well-defined parsing would be a new
 * dependency and a new licence in the bundle for no benefit.
 *
 * ## Only reading, never writing
 *
 * The ZIP is parsed far enough to locate one entry and inflate it. **The archive is not
 * re-packed**, so nothing here can produce a `.lbx` — the operator still authors those in
 * P-touch Editor, which is the point.
 */

/** Fixed-size fields of a ZIP local file header, per the PKWARE spec. */
const LOCAL_HEADER = 30;
/** Fixed-size fields of a ZIP central directory record. */
const CENTRAL_RECORD = 46;
/** Every ZIP local header starts with this four-byte signature. */
const LOCAL_SIGNATURE = 0x04034b50;
/** Every ZIP central directory record starts with this one. */
const CENTRAL_SIGNATURE = 0x02014b50;
/** Compression method 0 — stored, no inflation needed. */
const STORED = 0;
/** Compression method 8 — deflate, which is what Brother writes. */
const DEFLATE = 8;

/** One sheet inside a `.lbx`: a named piece of paper with its own size and objects. */
export type LbxSheet = {
  /** The sheet's own name, which is what `SetCurrentSheet` takes. */
  name: string;
  /** Paper width in millimetres, converted from the file's points. */
  widthMm: number;
  heightMm: number;
  /**
   * The objects **on this sheet**, which is not the same as the objects in the file.
   *
   * `Sheet 2` carries `Frame17` and `Symbol21`; `36x13` and `36x15` carry
   * `asset-code`, `Text7`, `Text8`, `Text9` and `Shape10`. **A template can therefore be
   * perfectly valid and still have nothing this application can write to**, which is why
   * the check is per sheet and never per file.
   */
  objects: string[];
  /** The printer the sheet was laid out for, when the file names one. */
  printerName: string | null;
};

/** Everything worth knowing about an uploaded template. */
export type LbxContents = {
  /**
   * The sheet the template opens on, from `<pt:body currentSheet="…">`.
   *
   * **This is not the sheet the label is measured against.** `asset-36x15.lbx` declares
   * `currentSheet="36x13"`, so b-PAC opens it on the 13 mm roll unless something selects
   * the other one — which is the whole reason the size is a setting and not a constant.
   */
  currentSheet: string | null;
  sheets: LbxSheet[];
};

/** Why a file cannot be used, in a form an admin can act on. */
export class LbxFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LbxFormatError";
  }
}

/** The four objects the print path writes. Kept beside the reader that checks for them. */
export const REQUIRED_OBJECTS = [
  "asset-code",
  "Text7",
  "Text8",
  "Text9",
] as const;

/**
 * Parse a `.lbx` and describe it.
 *
 * @throws {LbxFormatError} for anything that is not a readable P-touch template.
 */
export async function readLbx(file: ArrayBuffer): Promise<LbxContents> {
  const bytes = new Uint8Array(file);

  if (bytes.length < LOCAL_HEADER) {
    throw new LbxFormatError("The file is too small to be a P-touch template.");
  }

  // A ZIP always starts here. `PK\x03\x04` — the check that rejects a renamed `.png`
  // before anything tries to parse it.
  if (readU32(bytes, 0) !== LOCAL_SIGNATURE) {
    throw new LbxFormatError(
      "That file is not a P-touch template (.lbx). A template starts with the bytes PK\\x03\\x04 — " +
        "export it from P-touch Editor with File ▸ Export ▸ Template (.lbx).",
    );
  }

  const entry = await readEntry(bytes, "label.xml");
  const xml = new TextDecoder("utf-8").decode(
    await inflate(entry.method, entry.data),
  );

  const sheets = readSheets(xml);
  if (sheets.length === 0) {
    throw new LbxFormatError(
      "The template contains no sheet, so there is no paper size to print on.",
    );
  }

  return {
    currentSheet:
      /<pt:body\b[^>]*\bcurrentSheet="([^"]*)"/.exec(xml)?.[1] ?? null,
    sheets,
  };
}

/**
 * The objects the print path writes that a given sheet does not define.
 *
 * **Per sheet, and it returns names rather than throwing.** A sheet that is missing
 * `Text9` still prints — with the description blank — and the operator needs to be told
 * *which* name is missing on *which* sheet. Refusing the file would be worse than the
 * disease: it would throw away a template that is fine for everything except one field.
 *
 * `Shape10` is deliberately absent from {@link REQUIRED_OBJECTS}: it is the rule under the
 * code, it carries no data, and b-PAC never writes to it.
 */
export function missingObjects(sheet: LbxSheet): string[] {
  return REQUIRED_OBJECTS.filter((name) => !sheet.objects.includes(name));
}

/* ------------------------------------------------------------------ the ZIP */

/**
 * One ZIP entry: where its bytes are and how they are compressed.
 *
 * **The central directory, not the local header**, because the central directory is the
 * only place the compressed size is recorded reliably — a local header may carry zero when
 * the entry was streamed, which would silently truncate the inflate.
 */
type ZipEntry = { method: number; data: Uint8Array };

async function readEntry(bytes: Uint8Array, wanted: string): Promise<ZipEntry> {
  const end = findEndOfCentralDirectory(bytes);

  for (let i = end.count; i > 0; i -= 1) {
    const offset = end.offset + (i - 1) * CENTRAL_RECORD;
    if (readU32(bytes, offset) !== CENTRAL_SIGNATURE) continue;

    const method = readU16(bytes, offset + 10);
    const compressedSize = readU32(bytes, offset + 20);
    // The extra field and the comment follow the name; both are skipped by reading
    // the name length alone, so neither is read here.
    const nameLength = readU16(bytes, offset + 28);
    const localOffset = readU32(bytes, offset + 42);
    const name = decodeName(bytes, offset + CENTRAL_RECORD, nameLength);

    if (name !== wanted) continue;

    // Skip this entry's local header — 30 bytes plus its variable-length name and
    // extra fields — to reach the data. The sizes in the *local* header are ignored on
    // purpose; see the type comment.
    const dataStart =
      localOffset +
      LOCAL_HEADER +
      readU16(bytes, localOffset + 26) +
      readU16(bytes, localOffset + 28);

    return {
      method,
      data: bytes.subarray(dataStart, dataStart + compressedSize),
    };
  }

  throw new LbxFormatError(
    `This archive has no ${wanted}, so it is not a P-touch label template.`,
  );
}

/** The end-of-central-directory record: where the directory starts and how long it is. */
function findEndOfCentralDirectory(bytes: Uint8Array): {
  offset: number;
  count: number;
} {
  // The record is at the very end unless there is a trailing comment, so scan backwards
  // over the maximum comment length rather than assuming the last 22 bytes.
  const floor = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= floor; i -= 1) {
    if (readU32(bytes, i) !== 0x06054b50) continue;
    const count = readU16(bytes, i + 10);
    const offset = readU32(bytes, i + 16);
    if (offset >= bytes.length) continue;
    return { offset, count };
  }

  throw new LbxFormatError(
    "The archive's directory could not be read — the file looks truncated. " +
      "Export it again from P-touch Editor.",
  );
}

function decodeName(bytes: Uint8Array, offset: number, length: number): string {
  return new TextDecoder("utf-8").decode(
    bytes.subarray(offset, offset + length),
  );
}

/* -------------------------------------------------------------- the deflate */

/**
 * Inflate one entry, or pass it through when it is stored.
 *
 * **Both branches are needed.** Brother writes DEFLATE, but a template saved by a
 * different tool — or by a newer P-touch Editor — can be STORED, and treating method 0
 * as an error would refuse a perfectly good file.
 */
async function inflate(method: number, data: Uint8Array): Promise<Uint8Array> {
  if (method === STORED) return data;

  if (method !== DEFLATE) {
    throw new LbxFormatError(
      `The template is compressed with method ${method}, which this browser cannot read.`,
    );
  }

  if (typeof DecompressionStream === "undefined") {
    throw new LbxFormatError(
      "This browser cannot decompress the template. Printing needs a Chromium browser " +
        "with the Brother b-PAC extension.",
    );
  }

  // `deflate-raw` and not `deflate`: a ZIP entry is a raw DEFLATE stream with no zlib
  // header, and `DecompressionStream("deflate")` expects one and fails.
  // `data` is a `subarray`, whose `.buffer` the type checker widens to `ArrayBufferLike`;
  // `Blob` wants a plain one. Copying 2 KB is cheaper than casting a lie.
  const stream = new Blob([new Uint8Array(data)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));

  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ------------------------------------------------------------- the label.xml */

/**
 * Every sheet, with its paper size and its objects.
 *
 * **The shape of this file was read, not guessed.** Two earlier assumptions were wrong and
 * both produced an empty result rather than an error:
 *
 * | | guessed | actual |
 * |---|---|---|
 * | a sheet is | `<style:page-layout>` | `<style:sheet name="36x15">` — there is no `page-layout` in the file at all |
 * | an object is named by | `draw:name="Text7"` | `objectName="Text7"` — no `draw:name` appears anywhere |
 *
 * A regex that matches nothing is the dangerous kind of failure here, because the shape
 * it was written for is plausible. `readLbx` refuses a template with **no sheet**, which is
 * what caught it.
 *
 * **The file states points; this converts.** `pt → mm` is `× 25.4 / 72`, the same
 * conversion every dimension in `labelSpec.ts` came from — 102.4 × 45.4 pt is the
 * 36.12 × 16.02 mm sheet the label is measured against.
 */
function readSheets(xml: string): LbxSheet[] {
  const sheets: LbxSheet[] = [];

  const sheet = /<style:sheet\b([^>]*)>([\s\S]*?)<\/style:sheet>/g;
  for (const match of xml.matchAll(sheet)) {
    const [, attributes, body] = match;

    const name = /name="([^"]+)"/.exec(attributes)?.[1];
    if (!name) continue;

    // The paper element is a self-closing tag with every dimension as an attribute, so it
    // is read on its own rather than from the enclosing block.
    const paper = /<style:paper\b[^>]*\/?>/.exec(body)?.[0] ?? "";
    const widthPt = /\bwidth="([\d.]+)pt"/.exec(paper)?.[1];
    const heightPt = /\bheight="([\d.]+)pt"/.exec(paper)?.[1];
    if (!widthPt || !heightPt) continue;

    sheets.push({
      name,
      widthMm: roundMm(toMm(Number(widthPt))),
      heightMm: roundMm(toMm(Number(heightPt))),
      objects: readObjects(body),
      printerName: /\bprinterName="([^"]*)"/.exec(paper)?.[1] ?? null,
    });
  }

  return sheets;
}

/** The names of the objects **on one sheet**. */
function readObjects(sheetBody: string): string[] {
  // `objectName` is the attribute Brother writes. The earlier `draw:name` spelling is not
  // in this file, and accepting it costs nothing in case a future editor emits it.
  const names = [
    ...sheetBody.matchAll(/\bobjectName="([^"]+)"/g),
    ...sheetBody.matchAll(/\bdraw:name="([^"]+)"/g),
  ];

  return [...new Set(names.map((m) => m[1]))].sort();
}

const toMm = (points: number) => (points * 25.4) / 72;
/** Two decimals is a hundredth of a millimetre — finer than the printer can place. */
const roundMm = (mm: number) => Math.round(mm * 100) / 100;

/* ------------------------------------------------------------- little-endian */

/** A ZIP field is always little-endian, whatever the machine is. */
function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}
