/**
 * Ambient types for Brother's `bpac.js`, the browser module from the b-PAC SDK.
 *
 * ## These are written by hand against the real file, not guessed
 *
 * `public/vendor/bpac.js` is Brother's, is gitignored, and is **absent on a fresh
 * clone**, so `tsc` has to pass without it. But the shapes here were read out of the
 * installed SDK rather than from a blog post — the file at
 * `C:\Program Files (x86)\Brother bPAC3 SDK\Samples\JavaScript\bpac.js`, cross-checked
 * against `JS_NamePlate.html`, which is Brother's own working example.
 *
 * Two things that reading the file settled, and that a wrapper library had got subtly
 * wrong or had left out:
 *
 * - **The file is named `bpac.js`.** A third-party wrapper refers to a
 *   `bpac-v3.4.js`, which does not exist in this SDK — and a version-pinned name is
 *   exactly the kind of detail that fails silently as a 404 on a cashier's machine.
 * - **`IsExtensionInstalled` is part of the module** and is the supported pre-flight
 *   check. The wrapper's README never mentions it, and without it the only way to learn
 *   the extension is missing is to sit through a rejected promise.
 *
 * ## `IDocument` is a class of static methods, and it is a singleton
 *
 * `export class IDocument` with `static Open`, `static PrintOut` and so on, reached as
 * `bpac.IDocument.Open(…)`. **There is one instance of the document for the whole
 * page**, so two concurrent calls interleave on the same object — which is why
 * `bpacService` serialises every call rather than letting a second click through.
 *
 * ## Every call can reject with a *string*, and one of them rejects with `undefined`
 *
 * The module dispatches a `bpac_send` CustomEvent and listens for the extension's
 * reply. If the extension is not answering, the promise **rejects with the literal
 * string `"Can't connect to b-PAC"`** — not an `Error`, and not a network failure. That
 * is the single most important thing to know when handling these calls, because a
 * `catch` that assumes `error instanceof Error` produces the message `"undefined"` on
 * exactly the machine that needs the clearest possible explanation.
 *
 * `GetObject` is worse: **it rejects with `undefined` when the name is not found**,
 * because the source calls the promise's reject with no argument. So a renamed object
 * in P-touch Editor surfaces as a rejection whose payload is nothing at all.
 */

/**
 * **Note on `BPAC_NOT_CONNECTED`.** The module rejects with the bare string
 * `"Can't connect to b-PAC"`, and that string is declared as a real `const` in
 * `bpacService.ts` rather than here.
 *
 * It was in this file first and that was wrong: a `.d.ts` can *declare* a value binding
 * and `tsc` accepts importing it, but nothing emits a module for rolldown to resolve, so
 * the production build failed with `UNLOADABLE_DEPENDENCY` while `tsc -b` sat there
 * green. **The type gate passing is not the build passing.**
 */

/** One text, image, barcode or clipart object on the open template. */
export interface BpacObject {
  /**
   * Settable — this is how a value reaches a text field.
   *
   * **`obj.Text = value`, not `SetText`.** `IDocument` also has a static `SetText`, and
   * using the wrong one fails silently rather than loudly: a `SetText` on the wrong
   * index writes to a different object and leaves the field you meant blank on the
   * printed label.
   */
  Text: string;
  readonly Name: Promise<string>;
  /** Object type constant. Not branched on — the object names are known up front. */
  readonly Type: Promise<number>;
  readonly X: Promise<number>;
  readonly Y: Promise<number>;
  readonly Width: Promise<number>;
  readonly Height: Promise<number>;
}

/** The printer behind the open template. */
export interface BpacPrinter {
  readonly Name: Promise<string>;
  readonly PortName: Promise<string>;
  readonly ErrorCode: Promise<number>;
  readonly ErrorString: Promise<string>;
  /** `false` when off, out of paper, or not reachable. */
  IsPrinterOnline(name: string): Promise<boolean>;
  /** `false` when b-PAC does not know the model. */
  IsPrinterSupported(name: string): Promise<boolean>;
  GetMediaName(): Promise<string>;
  GetSupportedMediaNames(): Promise<string[]>;
  GetInstalledPrinters(): Promise<string[]>;
}

/**
 * The document, reached as `bpac.IDocument`.
 *
 * **`Open` takes a file path *or* a URL.** Brother's own sample passes
 * `C:\Program Files\...\Templates\namebadge.lbx` and comments out `http://localhost/`
 * as the alternative. That second form is the one this application uses, and it is what
 * removes the "copy the template onto every cashier's machine" step — **it has to be
 * same-origin**, because the extension performs the fetch.
 *
 * Every method returns a Promise resolving to a boolean, or rejecting with
 * `BPAC_NOT_CONNECTED`.
 */
export interface BpacDocument {
  Open(filePathOrUrl: string): Promise<boolean>;
  Close(): Promise<boolean>;

  SetPrinter(name: string, fitPage: number): Promise<boolean>;
  GetPrinterName(): Promise<string>;
  GetPrinter(): Promise<BpacPrinter | null>;

  /**
   * The sheet names this document declares, in file order.
   *
   * **Verified against `asset-36x15.lbx`**, which carries three: `Sheet 2`
   * (18.06 x 17.92 mm), `36x13` (36.12 x 13.19 mm) and `36x15` (36.12 x 16.02 mm).
   * A template may hold sheets with nothing this application can write to, which is why
   * the service checks the name is present before selecting it rather than assuming.
   */
  GetSheetNames(): Promise<string[]>;
  /** Which sheet is active now. The file picks one, and it is not always the wanted one. */
  GetCurrentSheet(): Promise<string>;
  SetCurrentSheet(name: string): Promise<boolean>;

  /**
   * **Rejects with `undefined` when the name is not in the template.** Not a falsy
   * resolve — a rejection with no payload. Callers have to treat "threw" as "missing"
   * and cannot read anything from the error.
   */
  GetObject(name: string): Promise<BpacObject | undefined>;
  /** Resolves to `undefined` (not `false`) when the name is not a barcode. */
  GetBarcodeIndex(name: string): Promise<number | undefined>;
  SetBarcodeData(index: number, text: string): Promise<boolean>;

  /**
   * The silent-printing trio.
   *
   * **All three genuinely return Promises**, which is worth stating because Brother's
   * own sample calls them without `await` — and an un-awaited rejection is a silent
   * failure. They resolve to a boolean, so the `if (!…)` checks in the service are the
   * only way a refused job is ever reported.
   */
  /**
   * Render the open template as an image data URL. **Prints nothing.**
   *
   * `type` is Brother's image format constant — `4` in their own sample — and `width` is
   * `0` there too, which means "whatever the document is". `height` in pixels drives the
   * scale, so the number is a sharpness choice and not a physical size.
   *
   * **Rejects rather than resolving `false`** when it fails, which is the opposite of
   * every other call here: the source rejects unless both `ret` and `connect` are true.
   * That asymmetry is why the preview path catches rather than tests a return value.
   */
  GetImageData(type: number, width: number, height: number): Promise<string>;

  StartPrint(jobName: string, option: number): Promise<boolean>;
  PrintOut(copyCount: number, option: number): Promise<boolean>;
  EndPrint(): Promise<boolean>;
}

/** The module's exports. It is a set of named exports, not a default. */
export interface BpacModule {
  IDocument: BpacDocument;
  /**
   * `() => document.body.classList.contains("bpac-extension-installed")`.
   *
   * **The extension adds a class to `<body>` when it loads**, which is the only signal
   * that the bridge exists at all. Brother's sample checks it before anything else and
   * opens the store listing when it is false; that check belongs in this service too,
   * because a click that goes straight to `Open()` produces a rejected promise with a
   * string instead of a sentence telling the operator to install an extension.
   */
  IsExtensionInstalled(): boolean;
}
