import { buildLabelContent, type LabelSource } from "../document/labelSpec";
import type { BpacDocument, BpacModule } from "@/vendor/bpac";

/**
 * Silent label printing through the Brother b-PAC SDK.
 *
 * ## What "silent" means here, and why it is the right mechanism
 *
 * Six attempts to print this label through `window.print()` all died on the same thing:
 * the page size belongs to the Windows printer driver, the driver exposes only a
 * *width* in Chrome's print dialog, and the physical cut of the roll comes from a media
 * setting no web page can read. Every workaround moved the problem rather than fixing
 * it, and the admin's roll was feeding six labels' worth of tape per print.
 *
 * b-PAC takes the whole negotiation out of the browser. The chain is
 *
 * ```
 * this page  ->  b-PAC browser extension  ->  b-PAC Client (local agent)  ->  printer
 * ```
 *
 * and the label is rendered from **a template b-PAC fetches**, not from this page's
 * layout. Nothing about the page, the dialog or the driver's paper list takes part, so
 * there is no pop-up: `StartPrint` → `PrintOut` → `EndPrint` is the programmatic path.
 */

/* ------------------------------------------------------------------ prerequisites */

/**
 * The string the SDK rejects with when the browser extension is not answering.
 *
 * **Read out of `bpac.js` rather than assumed** — every call in the module ends with the
 * same handler, `f.detail.connect == !1 ? i(t) : …`, where `t` is this literal. It is a
 * **bare string, not an `Error`**, which is why `describe()` exists and why a usual
 * `error instanceof Error` handler would render it as `"undefined"`.
 *
 * It lives here rather than in `bpac.d.ts` because a `.d.ts` can declare a value binding
 * but emits no module for the bundler to resolve — see the note in that file.
 */
const BPAC_NOT_CONNECTED = "Can't connect to b-PAC";

/**
 * Brother's browser module, expected at `public/vendor/bpac.js`.
 *
 * **It is not committed** — see `.gitignore`. It is copied out of the installed SDK at
 * `C:\Program Files (x86)\Brother bPAC3 SDK\Samples\JavaScript\bpac.js`, which is the
 * only place it exists; it is not on npm, and Brother's licence does not permit
 * redistribution.
 *
 * **The filename is `bpac.js` and not a version-pinned name**, which is what a
 * third-party wrapper calls it. The installed SDK has no `bpac-v3.4.js`, so a
 * version-pinned URL is a 404 on every machine — and a 404 inside a `catch` is exactly
 * the kind of failure that gets reported as "printing is broken" rather than "copy this
 * file from the SDK".
 *
 * `@vite-ignore` is required rather than defensive: without it Vite resolves the URL at
 * **build** time and fails the whole build on a fresh clone, where the file legitimately
 * does not exist. With it the import is left alone until someone clicks Print.
 */
const VENDOR_MODULE_URL = "/vendor/bpac.js";

/**
 * The `.lbx`, served from this application's own origin.
 *
 * **`Open` takes a file path or a URL, and the URL is the whole reason this feature is
 * maintainable.** Brother's sample passes
 * `C:\Program Files\…\Templates\namebadge.lbx` and comments out `http://localhost/` as
 * the alternative. Serving the template from `public/label/` removes the "copy this file
 * onto every cashier's PC" step, and it must be **same-origin** because the extension
 * performs the fetch.
 */
const TEMPLATE_URL = "/label/asset-36x15.lbx";

/** Where the admin's chosen printer is remembered between sessions. */
const PRINTER_STORAGE_KEY = "bpac.printerName";

/**
 * The four named objects in sheet `36x15` of `public/label/asset-36x15.lbx`.
 *
 * **Read out of the template, not guessed at runtime.** b-PAC addresses template
 * objects by name, so these strings are a contract with a binary file: renaming an
 * object in P-touch Editor silently breaks the binding and the failure is a blank field
 * on a printed label rather than an error.
 *
 * `asset-code` is the **QR barcode object**; `Text7`, `Text8` and `Text9` are the three
 * text lines in the order they appear in the XML. `Shape10` is the rule and is
 * deliberately absent — it has no data.
 *
 * **The barcode is addressed through `GetBarcodeIndex` and the split is hard-coded
 * rather than dispatched on `object.Type`,** because `GetBarcodeIndex` resolves to
 * `undefined` for a key that is not a barcode, and the type constants are numbers this
 * code cannot verify. Dispatching on a wrong constant would be silent; this cannot be.
 */
const TEMPLATE_OBJECTS = {
  barcode: "asset-code",
  assetCode: "Text7",
  companyAndUnit: "Text8",
  description: "Text9",
} as const;

/* ---------------------------------------------------------------------- errors */

/** Raised when the SDK, the extension or the local agent cannot be reached at all. */
export class BpacUnavailableError extends Error {
  constructor(detail?: string) {
    super(detail ?? "b-PAC is not available");
    this.name = "BpacUnavailableError";
  }
}

/** No printer found, or none that b-PAC recognises. Carries the names it did see. */
export class BpacPrinterNotFoundError extends Error {
  readonly installed: string[];

  constructor(installed: string[]) {
    super(
      installed.length === 0
        ? "b-PAC reported no printers"
        : `No Brother printer found. b-PAC saw: ${installed.join(", ")}`,
    );
    this.name = "BpacPrinterNotFoundError";
    this.installed = installed;
  }
}

/**
 * The printer exists but is not ready — off, out of paper, or not connected.
 *
 * `detail` is **Brother's own `ErrorString`**, not a sentence written here: it is the
 * only thing that distinguishes "no paper" from "not powered", and those need different
 * things done about them.
 *
 * The field is declared rather than a constructor parameter property because this
 * project compiles with `erasableSyntaxOnly` — see `tsconfig.app.json`.
 */
export class BpacPrinterOfflineError extends Error {
  readonly printerName: string;
  readonly detail: string;

  constructor(printerName: string, detail: string) {
    super(`${printerName}: ${detail}`);
    this.name = "BpacPrinterOfflineError";
    this.printerName = printerName;
    this.detail = detail;
  }
}

/** Anything the SDK refused: a `false` result, carried verbatim. */
export class BpacPrintError extends Error {
  constructor(stage: string, detail: string) {
    super(`${stage}: ${detail}`);
    this.name = "BpacPrintError";
  }
}

/**
 * Turn whatever b-PAC threw into a sentence.
 *
 * **This exists because the SDK does not throw `Error`s.** The module rejects with the
 * bare string `"Can't connect to b-PAC"` when the extension is not answering, and
 * `GetObject` rejects with **literally nothing** when a name is not in the template. A
 * handler written the usual way — `error instanceof Error ? error.message : …` — turns
 * both of those into the string `"undefined"`, on exactly the machines whose problem
 * needs the clearest wording.
 */
function describe(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;
  return "b-PAC returned no detail";
}

/**
 * Turn the SDK's bare-string rejection into a typed error, **wherever it happens.**
 *
 * The first version mapped it only around `Open()`, which left every later call able to
 * leak the raw string — and `GetImageData` is exactly where a b-PAC Client that has just
 * died shows up. The symptom was a preview dialog rendering `undefined.message`, which is
 * the precise failure `describe()` exists to prevent and the precise thing this closes.
 */
function asTyped(error: unknown): unknown {
  return describe(error) === BPAC_NOT_CONNECTED
    ? new BpacUnavailableError(
        "The b-PAC Client is not running on this machine.",
      )
    : error;
}

/* ----------------------------------------------------------------- module load */

let modulePromise: Promise<BpacModule> | null = null;

/**
 * Load the vendor module once and keep it.
 *
 * **The promise is cached rather than the module, so two clicks cannot both start the
 * import** — and `IDocument` is a singleton, so two concurrent imports would hand the
 * same caller two views of one open document.
 *
 * A rejection is **not** cached, unlike the first version of this. The two failures are
 * different: a missing file will not fix itself mid-session, but a missing *extension*
 * very often does — the operator installs it and reloads, or it loads slightly after the
 * page. Caching the rejection would mean the button stays broken until a reload, which is
 * the wrong shape for the one failure that is cheap to retry.
 */
function loadModule(): Promise<BpacModule> {
  modulePromise ??= loadViaBlob().catch((err: unknown) => {
    // Not cached: a missing file will not fix itself, but a missing *extension* often
    // does, and the operator may install it and retry without reloading. Caching the
    // rejection would leave the button broken until a reload.
    modulePromise = null;
    throw err instanceof BpacUnavailableError
      ? err
      : new BpacUnavailableError(describe(err));
  });

  return modulePromise;
}

/**
 * `fetch` the file, then `import` it as a blob.
 *
 * **A plain `import("/vendor/bpac.js")` works in the production build and fails in
 * dev**, which is the worst shape a difference can take. The file lives in `public/`,
 * and Vite's dev server intercepts the runtime import, refuses it, and answers
 * `500` with:
 *
 * ```
 * Failed to load url /vendor/bpac.js … This file is in /public and will be copied
 * as-is during build without going through the plugin transforms, and therefore
 * should not be imported from source code. It can only be referenced via HTML tags.
 * ```
 *
 * The `@vite-ignore` comment on the import does **not** help here, and the reason is
 * **it stops Vite resolving the URL at build time, and it says nothing about the dev
 * server**, which sees the bare path and transforms it anyway. The production bundle
 * was correct and green while the only machine that ever ran the feature could not
 * load it — and `tsc`, `eslint` and `vite build` were all silent about it.
 *
 * So the path never reaches Vite at all. `fetch` of a `public/` file works identically
 * in dev and prod, and a blob URL is opaque to every bundler. The cost is one extra
 * request for 28 KB, once, lazily — on a click that has already failed several times
 * before it can be printed at all.
 */
async function loadViaBlob(): Promise<BpacModule> {
  const response = await fetch(VENDOR_MODULE_URL);

  // A content-type check **before** the status check, because the failure this catches is
  // a 200. `public/vendor/bpac.js` is proprietary and gitignored, so a deployment built
  // from the repository does not contain it — and `vercel.json`'s SPA rewrite answers any
  // path it cannot find on disk with `index.html`, *successfully*. Measured against the
  // deployed site:
  //
  //   GET /vendor/bpac.js  ->  200, text/html, 495 bytes, body "<!DOCTYPE html>…"
  //
  // So `response.ok` is true, the HTML is wrapped in a blob, and `import()` hands the
  // module parser a document — which is where `Unexpected token '<'` came from. That
  // message names neither the cause nor the fix, and it reaches the operator.
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("text/html")) {
    throw new BpacUnavailableError(
      `${VENDOR_MODULE_URL} answered ${type} — that is the app's index.html, not the SDK. ` +
        `bpac.js is gitignored, so it is not in this deployment. Commit it into ` +
        `public/vendor/, or point VENDOR_MODULE_URL at a copy the build can reach.`,
    );
  }

  if (!response.ok) {
    throw new BpacUnavailableError(
      `${VENDOR_MODULE_URL} returned HTTP ${response.status}. Copy bpac.js from the b-PAC SDK into public/vendor/.`,
    );
  }

  const source = await response.text();

  // Belt and braces: a server can serve JavaScript as octet-stream, but nothing should
  // ever serve this path as markup. Catching it here names the file rather than letting
  // the module parser report a punctuation error.
  if (/^\s*<!doctype/i.test(source) || /^\s*<html/i.test(source)) {
    throw new BpacUnavailableError(
      `${VENDOR_MODULE_URL} served markup instead of the SDK. It is not in this deployment — ` +
        `commit it into public/vendor/.`,
    );
  }

  const blobUrl = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );

  try {
    const mod = (await import(/* @vite-ignore */ blobUrl)) as BpacModule;
    if (!mod?.IDocument) {
      throw new BpacUnavailableError("bpac.js loaded but exposes no IDocument");
    }
    return mod;
  } catch (err) {
    // A parse failure here means the source was not JavaScript after all, and the
    // SyntaxError names a punctuation character rather than the file. Say which file.
    throw err instanceof BpacUnavailableError
      ? err
      : new BpacUnavailableError(
          `bpac.js at ${VENDOR_MODULE_URL} could not be parsed: ${describe(err)}`,
        );
  } finally {
    // Safe once the import has settled: the module source is already fetched and
    // evaluated, and keeping the blob alive would pin 28 KB for the session.
    URL.revokeObjectURL(blobUrl);
  }
}

/**
/**
 * Where the browser extension is installed from.
 *
 * **These are facts about Brother's distribution, not interface copy**, which is why
 * they live here rather than in `common.json` — the same reason `COMPANY_MARK` lives in
 * `labelSpec.ts`. They are verified live: the Chrome Web Store listing shows version
 * **3.4.3.2, updated 9 December 2024**, published by Brother Industries, Ltd.
 *
 * **The extension has not been withdrawn.** That is worth stating because the request to
 * replace this route arrived on the premise that it had, and acting on it would have
 * swapped a working integration for a broken one. What is easily confused with
 * "withdrawn" is the *store* being unavailable in a managed environment — a corporate
 * policy blocks the install, not the listing.
 */
export const BPAC_EXTENSION_LINKS = {
  chrome:
    "https://chromewebstore.google.com/detail/brother-b-pac-extension/ilpghlfadkjifilabejhhijpfphfcfhb",
  edge: "https://microsoftedge.microsoft.com/addons/detail/brother-bpac-extension/kmopihekhjobijiipnloimfdgjddbnhg",
} as const;

/**
 * Re-check the extension without reloading the page.
 *
 * **Deliberately does not reset the cached module.** `IsExtensionInstalled` is a pure
 * read of a class on `document.body` — it costs nothing, and reloading the vendor module
 * would be work with no effect. That matters because "Check again" sits on the failure
 * path where the module has *already* loaded; if it loaded, the extension's absence is
 * the only thing that can have changed.
 *
 * It cannot return `true` for an extension installed a moment ago: Chrome injects
 * content scripts at page load, so a freshly installed extension needs a reload before
 * its class appears. **The UI has to say so**, or the button looks broken on the one
 * path where the operator's action genuinely needed a reload.
 */
export async function checkBpacExtension(): Promise<boolean> {
  try {
    const mod = await loadModule();
    return mod.IsExtensionInstalled();
  } catch {
    return false;
  }
}

/**
 * Is the browser extension actually present?
 *
 * Is the browser extension actually present?
 *
 * **The extension adds a class to `<body>` when it loads**, and this is Brother's own
 * check — their sample calls it before doing anything else and opens the store listing
 * when it is false.
 *
 * It is a pre-flight rather than an optimisation because of what it replaces: without
 * it, the first sign of a missing extension is a rejected promise carrying the bare
 * string `"Can't connect to b-PAC"`, which reads like a network problem. Checking first
 * turns the most common setup failure into the sentence that fixes it.
 */
async function requireExtension(): Promise<BpacModule> {
  const mod = await loadModule();

  if (!mod.IsExtensionInstalled()) {
    throw new BpacUnavailableError(
      "The Brother b-PAC browser extension is not installed or not running.",
    );
  }

  return mod;
}

/* --------------------------------------------------------------------- printer */

function readStoredPrinter(): string | null {
  try {
    return localStorage.getItem(PRINTER_STORAGE_KEY);
  } catch {
    // Private mode denies localStorage. A forgotten preference is survivable; a crash
    // on a print click is not.
    return null;
  }
}

function storePrinter(name: string): void {
  try {
    localStorage.setItem(PRINTER_STORAGE_KEY, name);
  } catch {
    /* see readStoredPrinter */
  }
}

/**
 * Choose which printer to print on.
 *
 * **Remembered first, then matched, then a single-printer fallback — in that order.**
 * The remembered choice matters because a machine may have several Brother devices on
 * it, and silently switching the label printer would print 36 mm labels on a 102 mm
 * roll.
 *
 * The match is deliberately loose (`P-touch` or `PT-P9`) because the driver appends
 * the port and the trailing `W`/`Wc`, and an exact `PT-P900W` test would stop matching on
 * a machine where it installed as `PT-P900Wc`.
 */
async function resolvePrinter(doc: BpacDocument) {
  const printer = await doc.GetPrinter();
  if (!printer) {
    throw new BpacPrinterNotFoundError([]);
  }

  const installed = (await printer.GetInstalledPrinters()) ?? [];
  if (installed.length === 0) {
    throw new BpacPrinterNotFoundError([]);
  }

  const remembered = readStoredPrinter();
  let chosen: string | undefined;

  if (remembered && installed.includes(remembered)) {
    chosen = remembered;
  } else {
    chosen =
      installed.find((name) => /p-?touch|pt-?p9/i.test(name)) ??
      (installed.length === 1 ? installed[0] : undefined);
  }

  if (!chosen) {
    // More than one printer and none recognisable: refusing is the only safe answer,
    // because guessing here means labels on the wrong stock.
    throw new BpacPrinterNotFoundError(installed);
  }

  if (remembered !== chosen) {
    storePrinter(chosen);
  }

  if (!(await printer.IsPrinterSupported(chosen))) {
    throw new BpacPrintError(
      "printer",
      `b-PAC does not support "${chosen}". The PT-P900W has been on b-PAC's supported-model list since version 3.2, so this usually means the SDK is older than the driver.`,
    );
  }

  if (!(await printer.IsPrinterOnline(chosen))) {
    throw new BpacPrinterOfflineError(
      chosen,
      (await printer.ErrorString) || "printer is not online",
    );
  }

  return printer;
}

/**
 * Fill an open template with one asset's values.
 *
 * **Shared by the print and the preview path on purpose.** They write the same four
 * objects, and a preview that populated them differently from the printer would be a
 * preview of something the printer never produces — which is worse than no preview,
 * because it looks authoritative.
 *
 * Returns nothing and throws on failure; the caller's `finally` closes the document.
 */
async function populateTemplate(
  doc: BpacDocument,
  asset: LabelSource,
): Promise<void> {
  const content = buildLabelContent(asset);

  // The QR. `GetBarcodeIndex` resolves to `undefined` — not `false` — for a key that is
  // not a barcode, which is why this one key is called by name.
  const barcodeIndex = await doc.GetBarcodeIndex(TEMPLATE_OBJECTS.barcode);
  if (barcodeIndex === undefined) {
    throw new BpacPrintError(
      "barcode",
      `"${TEMPLATE_OBJECTS.barcode}" is not a barcode in the template`,
    );
  }

  if (!(await doc.SetBarcodeData(barcodeIndex, content.assetCode))) {
    throw new BpacPrintError(
      "barcode",
      `b-PAC rejected the data for "${TEMPLATE_OBJECTS.barcode}"`,
    );
  }

  // The three text lines. `string` and not `keyof typeof TEMPLATE_OBJECTS`: these are
  // the *values* of that map — the names inside the .lbx — not its keys.
  const text: Array<[string, string]> = [
    [TEMPLATE_OBJECTS.assetCode, content.assetCode],
    [TEMPLATE_OBJECTS.companyAndUnit, content.companyAndUnit],
    [TEMPLATE_OBJECTS.description, content.description],
  ];

  for (const [key, value] of text) {
    // **`GetObject` rejects with `undefined` when the name is missing**, so this is a
    // try/catch and not a null check. The name is a contract with the .lbx and a rename
    // in P-touch Editor is the failure it exists to explain.
    let obj;
    try {
      obj = await doc.GetObject(key);
    } catch {
      throw new BpacPrintError(
        "template",
        `the template has no object named "${key}". Names are set in P-touch Editor and must match the .lbx exactly.`,
      );
    }

    if (!obj) {
      throw new BpacPrintError(
        "template",
        `the template has no object named "${key}"`,
      );
    }

    obj.Text = value;
  }
}

/**
 * Render the template as an image, without printing anything.
 *
 * ## Why this and not the app's own drawing of the label
 *
 * `AssetLabel.tsx` draws the same geometry from `labelSpec.ts`, and it has to: it is
 * this modal's own fallback for a machine with no b-PAC.
 *
 * **But it is the app's *interpretation* of the template.** If someone edits the `.lbx`
 * in P-touch Editor — moves a field, resizes the barcode, changes a font — that drawing
 * carries on showing the old layout while the printer renders the new one. A preview that
 * can disagree with the output is worse than none, because it looks authoritative.
 *
 * `Doc.GetImageData` is **b-PAC rendering its own template**, so what comes back is what
 * comes out of the printer. That is the whole difference, and it is why this is the
 * preview offered for silent printing.
 *
 * **No printer is selected and no status is checked**, deliberately. A preview has to
 * work while the printer is off and out of paper — that is when someone is most likely
 * to be checking a layout — and Brother's own sample renders the image without naming a
 * printer at all.
 *
 * `type` is `4` and `width` is `0`, both taken from `JS_NamePlate.html`. The type
 * constant could not be read out of the minified module, so it is Brother's own working
 * value rather than a decoded one. **Height is in pixels and drives the scale**, so the
 * number is a preview sharpness choice and not a physical size.
 */
export async function renderAssetLabelPreview(
  asset: LabelSource,
): Promise<string> {
  return enqueue(async () => {
    try {
      const { IDocument: doc } = await requireExtension();
      return await previewThrough(doc, asset);
    } catch (error) {
      throw asTyped(error);
    }
  });
}

async function previewThrough(
  doc: BpacDocument,
  asset: LabelSource,
): Promise<string> {
  const opened = await doc.Open(new URL(TEMPLATE_URL, location.origin).href);

  if (!opened) {
    throw new BpacPrintError(
      "template",
      `b-PAC could not open ${TEMPLATE_URL}. The file is served by this app, so a failure here usually means the b-PAC Client or its browser extension is not running.`,
    );
  }

  try {
    await populateTemplate(doc, asset);
    return await doc.GetImageData(PREVIEW_IMAGE_TYPE, 0, PREVIEW_HEIGHT_PX);
  } finally {
    // Same reason as the print path: b-PAC keeps the document open, and the next
    // `Open` on an already-open document is what turns one failure into a printer
    // that stops responding for the rest of the session.
    await doc.Close().catch(() => undefined);
  }
}

/** Brother's image format for `GetImageData`, from their own sample. */
const PREVIEW_IMAGE_TYPE = 4;

/**
 * Preview height in pixels.
 *
 * **300 for roughly a 675 px wide render of a 36:16 label**, which is sharper than any
 * screen shows it and costs the same single round trip that a smaller one would. The
 * `<img>` is constrained by CSS to the label's real proportions, so this is about
 * sharpness and nothing else.
 */
const PREVIEW_HEIGHT_PX = 300;

/* ------------------------------------------------------------------ serialising */

/**
 * Only one print may be in flight.
 *
 * **`IDocument` is a class of statics over a single document object** — one open
 * document for the whole page — so two clicks would interleave `Open`/`SetPrinter`/
 * `StartPrint` on it and the second job would print the first asset's data. The chain
 * serialises them; the second caller waits rather than failing.
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/* ----------------------------------------------------------------------- print */

/**
 * Print one asset's label, with no dialog and no preview.
 *
 * Resolves once b-PAC has accepted the job — **not** once the label has physically left
 * the printer, which b-PAC does not report and the module gives no completion event.
 */
export function printAssetLabelSilent(asset: LabelSource): Promise<void> {
  return enqueue(async () => {
    // Wrapped whole rather than per-call: `asTyped` is pure, and the point is that no
    // call inside can leak the SDK's bare-string rejection.
    try {
      const { IDocument: doc } = await requireExtension();
      await printThrough(doc, asset);
    } catch (error) {
      throw asTyped(error);
    }
  });
}

async function printThrough(
  doc: BpacDocument,
  asset: LabelSource,
): Promise<void> {
  const opened = await doc.Open(new URL(TEMPLATE_URL, location.origin).href);

  if (!opened) {
    throw new BpacPrintError(
      "template",
      `b-PAC could not open ${TEMPLATE_URL}. The file is served by this app, so a failure here usually means the b-PAC Client or its browser extension is not running.`,
    );
  }

  try {
    const printer = await resolvePrinter(doc);

    // `fitPage` is a VARIANT_BOOL: -1 is true, 0 is false. **False, deliberately** —
    // fit-to-page is what would rescale the label inside its own template, and the
    // whole point of b-PAC is that the printer places it at 1:1.
    if (!(await doc.SetPrinter(await printer.Name, 0))) {
      throw new BpacPrintError(
        "printer",
        "b-PAC refused the printer selection",
      );
    }

    const content = buildLabelContent(asset);
    await populateTemplate(doc, asset);

    // These three **do** return promises even though Brother's own sample leaves them
    // un-awaited — and an un-awaited rejection is a silent failure, which is the one
    // thing this service exists to avoid.
    if (!(await doc.StartPrint(`Asset ${content.assetCode}`, 0))) {
      throw new BpacPrintError("print", "b-PAC refused to start the job");
    }

    if (!(await doc.PrintOut(1, 0))) {
      throw new BpacPrintError(
        "print",
        'b-PAC refused the job. Check the media is 1.4" continuous and loaded.',
      );
    }

    if (!(await doc.EndPrint())) {
      throw new BpacPrintError(
        "print",
        "b-PAC could not close the job cleanly",
      );
    }
  } finally {
    // **Always close.** b-PAC keeps the document open after a failed job, and the next
    // `Open` on an already-open document is what turns one failure into a printer that
    // stops responding for the rest of the session.
    await doc.Close().catch(() => undefined);
  }
}

/**
 * The printers b-PAC can see, for a settings screen.
 *
 * Returns an empty list rather than throwing when the SDK is absent — this is a
 * diagnostic, and a page that cannot render because a printer is unplugged is worse than
 * one that shows an empty list.
 */
export async function listBpacPrinters(): Promise<string[]> {
  try {
    const { IDocument: doc } = await requireExtension();
    const printer = await doc.GetPrinter();
    return printer ? ((await printer.GetInstalledPrinters()) ?? []) : [];
  } catch {
    return [];
  }
}
