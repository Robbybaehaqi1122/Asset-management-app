import { useTranslation } from "react-i18next";

import Select from "@/components/form/Select";
import Input from "@/components/form/input/InputField";
import Button from "@/components/ui/button/Button";
import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { getDepartmentOptions } from "@/modules/departments/services/departmentService";
import type { DepartmentRef } from "@/lib/profiles";

import { SignaturePad } from "./SignaturePad";
import {
  ACKNOWLEDGEMENT,
  COMPANY_NAME,
  FOOTER_LINES,
  HEADER_ISSUER,
  PARTIES,
  SIGNATURE_ROLES,
  TERMS,
} from "../document/documentContent";
/**
 * The document's own palette, read out of `260911-MULTI-SOEHARDONO.docx`.
 *
 * ## Why these are literals rather than theme tokens
 *
 * This is a **legal document the company signs**, and the template's colours are
 * part of what is being reproduced: the navy `#1B3B6F` on the title and on the table
 * header, the grey `#595959` on every Indonesian line, the pale blue `#D8E0EE` on the
 * Indonesian sub-labels inside that navy header. A theme token would follow the app's
 * light/dark switch and print a different document in a different mode.
 *
 * They were extracted by reading `w:color` and `w:shd w:fill` out of the file rather
 * than by eye, because "it looks navy" is not a value: the header row is
 * `<w:shd w:fill="1B3B6F">` with `FFFFFF` English labels and `D8E0EE` Indonesian
 * ones, and the body rows are plain `FFFFFF` with no banding.
 *
 * The one thing that is **not** blue is the table grid: every border in the file is
 * `w:val="single" w:color="auto"`, and the letterhead rule in `header2.xml` is
 * `auto` too. `auto` means "the default text colour", which is why the rule under the
 * logo is black here — an earlier version used the navy, which was an invention.
 */
const DOC = {
  /** Title, section headings, table header fill, and the row-number column. */
  navy: "#1B3B6F",
  /** Every Indonesian line, and the sub-labels' surroundings. */
  grey: "#595959",
  /** The Indonesian sub-label inside the navy header row. */
  paleBlue: "#D8E0EE",
  /** English labels inside the navy header row. */
  white: "#FFFFFF",
  /** The `Name / Dept / Date` labels under each signature. */
  field: "#444444",
  /**
   * The vertical rule between the English and Indonesian columns of the terms.
   *
   * `<w:tcBorders><w:right w:val="single" w:color="B9C2D0" w:sz="4"/></w:tcBorders>`
   * on the **English** cell only — a pale blue-grey, and the one border in the whole
   * document that is not `auto`. It is not a table grid: the terms table declares no
   * `tblBorders` at all, so this single divider is the only line it draws.
   */
  divider: "#B9C2D0",
} as const;

import {
  getHandoverDocument,
  HandoverNotFoundError,
  type HandoverDocument,
} from "../services/handoverService";

/**
 * The printable handover document, shown in a modal and printed with
 * `window.print()`.
 *
 * ## Why a modal and not a route
 *
 * The document is a **view of a handover that already exists**, not a page of its
 * own. Opening it in a route would need a URL, and the natural one
 * (`/handover/:id/print`) would then be linkable — which would mean a printable
 * document anyone could reach by typing a path, and a browser Back that leaves the
 * user somewhere unhelpful. A modal keeps it attached to the row it came from.
 *
 * ## Why `window.print()` and not a PDF library
 *
 * The browser's own print pipeline is the one that can produce a PDF at A4 with the
 * fonts and margins right, and it does it with **nothing added to the bundle** —
 * `AGENTS.md` forbids a new dependency without asking, and `html2pdf`/`jsPDF` would
 * be 200–400 kB for a worse result.
 *
 * "Save as PDF" is one click away in that dialog, and it is where the file actually
 * goes: **a browser cannot write to a folder silently.** That is a security boundary,
 * not an omission — the print dialog is the only place the user gets to see and
 * choose where a copy of a signed document lands.
 *
 * ## Why this does not use the shared `Modal`
 *
 * It used to, and the print stylesheet tried to neutralise it through
 * `[role="dialog"]`. **That attribute is not in `Modal`'s markup** — it renders
 * `<div class="modal …">`, a backdrop div, then the panel — so every rule meant to
 * strip the panel's chrome matched nothing, and the document printed underneath a
 * full-height, vertically-centred, `max-w-5xl` panel: a blank block above the
 * letterhead, and the paper scaled to fit what was left.
 *
 * The overlay is therefore rendered here, through a **portal onto `document.body`**,
 * so the paper is a direct child of the body. `index.css` then removes the whole
 * application with one `display: none` and leaves no ancestor whose height, width
 * or positioning could still push the page around. The same fix means the three
 * print hooks — `handover-print-root`, `-panel`, `-sheet` — are the complete list of
 * classes between `<body>` and the paper, so there is nothing left to guess at.
 *
 * Escape and backdrop-click closing are reimplemented here, which is the only
 * behaviour that came from `Modal` and had to be kept.
 *
 * ## The print stylesheet is what makes it work
 *
 * `window.print()` prints the whole document, app chrome included. `index.css` has a
 * `@media print` block keyed on `body.handover-printing` that hides everything and
 * reveals only the paper. That class is added on mount and removed on unmount, and
 * it has to be a **body class** — the portal puts the overlay on the body, and no
 * other ancestor exists that a stylesheet could hook without depending on the whole
 * component hierarchy.
 */
export default function HandoverPrintModal({
  handoverId,
  isOpen,
  onClose,
}: {
  handoverId: string | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("common", { keyPrefix: "handoverPrint" });

  const [doc, setDoc] = useState<HandoverDocument | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * `qty` and `unit` are **print-form state, not database state**.
   *
   * A handover is one asset per row and always 1 — that is what the row *is*. But
   * the paper template has a Qty column, and an admin handing over "3 mice" to one
   * person has a real use for it. So these live here and nowhere else: they are
   * entered once, printed, and deliberately **not saved**, because there is no column
   * for them and inventing one would be a second source of truth for a number that
   * only exists on the paper.
   */
  const [qty, setQty] = useState<Record<string, string>>({});
  const [unit, setUnit] = useState<Record<string, string>>({});

  /**
   * Per-device notes, keyed by asset id — the template's Notes cell.
   *
   * Seeded from `assignments.notes`, the note the admin typed when issuing the
   * handover. That column is on **every row of the batch**, so seeding from the seed
   * row's value puts the same sentence in every cell by default — which is honest
   * (it is what was recorded) and editable per device, because an admin printing
   * today may well want "Kondisi baik" on the laptop and "Perlu penggantian mouse"
   * on the mouse. Editing one cell does not touch the others.
   *
   * **Print-form state, deliberately not saved**, for the same reason as `qty` and
   * `unit`: the note belongs to the loan row, and this is one printing of one
   * document. Writing back would mean a column the form invented, which is the
   * second-source-of-truth problem this repo refuses elsewhere.
   */
  const [rowNotes, setRowNotes] = useState<Record<string, string>>({});

  /** Departments for the two signature blocks, both editable. */
  const [departments, setDepartments] = useState<DepartmentRef[]>([]);
  const [issuerDept, setIssuerDept] = useState("");
  const [employeeDept, setEmployeeDept] = useState("");

  /**
   * The two signature blocks' staff numbers and companies.
   *
   * **The recipient's two are seeded from the roster** — `handover_users.nik_eid` and
   * `.company_id`, read into `HandoverDocument` — because those are facts about a
   * person and belong to them rather than to this printing.
   *
   * **The issuer's two start empty and there is no source for them anywhere in this
   * application.** The issuer is a `profiles` row, and `profiles` has no staff number
   * and no employer: the roster is for the people *receiving* assets, and the account
   * recording the handover is not on it. So these are **plain text inputs**, which is
   * also what makes them correct for both blocks — a staff number comes from a human
   * resources system this application has no model of, and an admin typing one from a
   * letter is the real entry path.
   *
   * Print-form state, like the department and the date beside them: which is a fact
   * about this printing, not about the handover.
   */
  const [issuerNikEid, setIssuerNikEid] = useState("");
  const [issuerCompany, setIssuerCompany] = useState("");
  const [employeeNikEid, setEmployeeNikEid] = useState("");
  const [employeeCompany, setEmployeeCompany] = useState("");

  /** Signed today by default; the form's own date field, not the handover's. */
  const [signDate, setSignDate] = useState(() => todayInputValue());

  const [issuerSignature, setIssuerSignature] = useState<string | null>(null);
  const [employeeSignature, setEmployeeSignature] = useState<string | null>(
    null,
  );

  /**
   * Loads the document whenever the modal opens or the id changes.
   *
   * **`.then()` with a `cancelled` flag rather than `void load()`**, and that is the
   * shape `HandoverListPage` already uses for the same job. Two reasons, one of them a
   * lint rule and one of them real:
   *
   * - `react-hooks/set-state-in-effect` rejects calling anything that sets state
   *   synchronously from an effect body, and a `useCallback` that ends in five
   *   `setState` calls is exactly that. Setting state inside a promise callback is
   *   the accepted form, because by then the effect has returned.
   * - `cancelled` closes a real race. Closing the modal while the read is in flight
   *   would otherwise land a response on an unmounted component — and here the
   *   payload is a signature form, so the state it would have set is worth not
   *   setting after the admin has moved on.
   */
  useEffect(() => {
    if (!isOpen || handoverId === null) return;
    let cancelled = false;

    void Promise.all([
      getHandoverDocument(handoverId),
      getDepartmentOptions(),
    ]).then(
      ([loaded, deptRows]) => {
        if (cancelled) return;
        setDoc(loaded);
        setDepartments(deptRows);

        // Default both departments from the data, and fall back to the first
        // available one. A `<select>` whose value matches no option renders blank,
        // which would read as "no department" rather than "the department this
        // person has since been moved out of".
        //
        // **Both are department names, never people.** The issuer's used to be seeded
        // with `loaded.issuerName`, which is a person's name, so it matched no option
        // on every document and silently fell through to the first department in the
        // list — a signed form naming the wrong department for the issuer, with
        // nothing on screen to suggest it.
        setIssuerDept((current) =>
          pickAvailable(loaded.issuerDepartment, deptRows, current),
        );
        setEmployeeDept((current) =>
          pickAvailable(loaded.holderDepartment, deptRows, current),
        );

        // The recipient's staff number and employer, from the roster. Seeded rather
        // than derived at render time so they are editable here: a roster entry can
        // be missing one, and a document printed with the wrong one is worse than one
        // an admin had a chance to correct.
        setEmployeeNikEid(loaded.holderNikEid ?? "");
        setEmployeeCompany(loaded.holderCompany ?? "");

        // Every row defaults to 1 — the one quantity that is always true.
        //
        // **Accessory rows are seeded here too**, keyed by the **accessory's** id
        // rather than the device's. Sharing the device's key would be a quiet and
        // total collision: typing a quantity for the bag would overwrite the laptop's,
        // because both rows would read and write `qty[asset.id]`. Seeding them
        // together is also why the reset-on-reopen is correct for them — the parent
        // unmounts the modal, which resets all three maps for free.
        const defaultQty: Record<string, string> = {};
        const defaultUnit: Record<string, string> = {};
        for (const asset of loaded.assets) {
          defaultQty[asset.id] = "1";
          defaultUnit[asset.id] = t("defaultUnit");
          for (const accessory of asset.accessories) {
            defaultQty[accessory.id] = "1";
            defaultUnit[accessory.id] = t("defaultUnit");
          }
        }
        setQty(defaultQty);
        setUnit(defaultUnit);

        // Every row of a batch carries the same recorded note, so that is what each
        // device cell opens showing. The admin can then change any single cell.
        //
        // **Accessory notes start empty**, deliberately, where the device row seeds
        // `loaded.notes`. Copying the handover's note onto every accessory line would
        // repeat one sentence once per item and push the table across a page
        // boundary — the batch-wide-note mistake this file already documents once.
        const defaultNotes: Record<string, string> = {};
        for (const asset of loaded.assets) {
          defaultNotes[asset.id] = loaded.notes ?? "";
          for (const accessory of asset.accessories) {
            defaultNotes[accessory.id] = "";
          }
        }
        setRowNotes(defaultNotes);
        setIsLoading(false);
      },
      (error: unknown) => {
        if (cancelled) return;
        setDoc(null);
        // Two different failures, two different sentences: a row that has been
        // deleted is something the admin can act on by reloading, while a network
        // or RLS failure is not, and telling them the same thing wastes their time.
        setLoadError(
          error instanceof HandoverNotFoundError
            ? t("notFound")
            : t("loadError"),
        );
        setIsLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [isOpen, handoverId, t]);

  /**
   * There is deliberately **no reset-on-close effect**, and the absence is the
   * mechanism rather than an oversight.
   *
   * `HandoverListPage` renders this component only while a handover id is set —
   * `{printHandoverId !== null && <HandoverPrintModal … />}` — so closing destroys
   * the component and every piece of state goes with it: signatures, quantities,
   * units. Reopening builds a fresh document from the initial values.
   *
   * That matters because a signature is a **one-printing** thing. Carrying the last
   * drawing over would be actively wrong: the previous ink belonged to the previous
   * printing, and quietly reusing it would put one person's signature under another
   * person's name with nothing to notice it. A reset effect would also have been a
   * synchronous `setState` in an effect, which is the cascading-render pattern
   * `react-hooks/set-state-in-effect` exists to catch — and it would have been doing
   * work the unmount already does.
   */

  /**
   * Adds `handover-printing` to `<body>` for as long as the document is open.
   *
   * The cleanup removes it unconditionally, which matters when a print is cancelled
   * or the user navigates away mid-dialog: without the removal, the next
   * `window.print()` anywhere in the app — including the browser's own Ctrl+P — would
   * print a blank page.
   */
  useEffect(() => {
    if (!isOpen) return;
    document.body.classList.add("handover-printing");
    return () => document.body.classList.remove("handover-printing");
  }, [isOpen]);

  /**
   * Escape to close, and the page behind locked.
   *
   * Both were `Modal`'s job and are reimplemented here because the overlay no longer
   * is one. `body { overflow: hidden }` matters for the same reason it did in
   * `Modal`: without it, scrolling the wheel over a full-height overlay scrolls the
   * page underneath and the header slides out from under it.
   */
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose]);

  const departmentOptions = useMemo(
    () => departments.map((row) => ({ value: row.name, label: row.name })),
    [departments],
  );

  /**
   * The document's own number, taken from the assets.
   *
   * `assets.handover_doc_no` is where the admin typed it on the asset form, and it
   * is deliberately **not** written here. A batch can span assets with different or
   * no numbers, so the distinct ones are listed rather than one being picked — and
   * an asset with none contributes an em dash rather than being dropped, so a
   * document cannot silently omit one of the things being signed for.
   */
  const docNumbers = useMemo(() => {
    if (!doc) return [];
    const distinct = new Set<string>();
    for (const asset of doc.assets) {
      distinct.add(asset.handoverDocNo ?? "");
    }
    return [...distinct];
  }, [doc]);

  /**
   * The printed number: the first real one, or a blank rule.
   *
   * A batch is usually handed over from one place and therefore shares a number, so
   * the first is normally the only one. When they genuinely differ there is no honest
   * single answer, which is why the table's Notes column is left to carry the detail.
   */
  const printNumber = useMemo(() => {
    if (!doc) return null;
    const real = docNumbers.find((n) => n !== "");
    return real ?? null;
  }, [doc, docNumbers]);

  const handlePrint = () => {
    // `window.print()` is synchronous and blocking by spec — the dialog is modal and
    // the page is frozen until it closes. No `await`, no state change, nothing that
    // could re-render the document between the click and the snapshot.
    window.print();
  };

  if (!isOpen) return null;

  // Portal, not `Modal` — see the file header. The `handover-print-*` classes are the
  // print stylesheet's only hooks and the only classes between `<body>` and the paper.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        // Backdrop click closes. Comparing against `currentTarget` is what stops a
        // click that started on the paper from closing it underneath the admin.
        if (event.target === event.currentTarget) onClose();
      }}
      className="handover-print-root fixed inset-0 z-99999 flex items-center justify-center bg-gray-400/50 p-4"
    >
      <div className="handover-print-panel flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-gray-900">
        {/* The toolbar is hidden in print, so it lives outside the printed root's
            stylesheet scope but inside the modal — see the `body` class above. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-4 dark:border-gray-800 print:hidden">
          <div>
            <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
              {t("title")}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("toolbarHint")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("close")}
            </Button>
            <Button onClick={handlePrint} disabled={isLoading || doc === null}>
              {t("print")}
            </Button>
          </div>
        </div>

        <div className="handover-print-sheet overflow-y-auto bg-gray-100 p-4 dark:bg-gray-900">
          {isLoading ? (
            <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
              {t("loading")}
            </p>
          ) : loadError !== null ? (
            <p className="py-10 text-center text-sm text-error-600 dark:text-error-500">
              {loadError}
            </p>
          ) : doc === null ? null : (
            <article
              // The paper. Fixed A4 width so what is reviewed on screen is what
              // prints, rather than a fluid layout that reflows at the printer's
              // width and silently moves the signature block off the page.
              className="mx-auto min-h-[297mm] w-[210mm] bg-white p-[19mm] text-[9.5pt] leading-[1.45] text-gray-900 shadow-lg"
            >
              <Header issuer={HEADER_ISSUER} />

              <h1
                className="text-center text-[13pt] font-bold tracking-wide uppercase"
                style={{ color: DOC.navy }}
              >
                {t("documentTitle")}
              </h1>
              <p
                className="text-center text-[11pt] font-semibold"
                style={{ color: DOC.grey }}
              >
                {t("documentTitleId")}
              </p>

              {/* `No.:` is **left aligned** and set inline with the number, which is
                  what the template prints — paragraph 2 is `<w:t>No.:</w:t>` followed by
                  the document number in the same paragraph, with no `w:jc` and no
                  underline. It was right-aligned with a ruled blank, which is a form
                  field someone is meant to fill by hand, and it is not: the number comes
                  from `assets.handover_doc_no`. */}
              <p className="mt-3 text-[9pt]">
                <span className="font-semibold">No.: </span>
                {printNumber !== null ? (
                  printNumber
                ) : (
                  <span style={{ color: DOC.grey }}>{t("noNumber")}</span>
                )}
              </p>

              <Bilingual className="mt-4" en={PARTIES.en} id={PARTIES.id} />

              <ol className="mt-2 space-y-1 pl-4">
                <li>
                  <span className="font-semibold">{COMPANY_NAME}</span> ("
                  {t("companyLabel")}")
                </li>
                {/* The recipient's name goes **into the blank**, on both language lines.

                    The template prints `Mr/Ms. ______________________________, ("Employee").`
                    with the name on a separate line above it, but a printed document
                    went out with that blank sitting empty and the name below it — an
                    unsigned-looking form on paper somebody was about to sign. The name
                    is not a blank to be filled by hand here; it is a fact the roster
                    already holds, so it is set inline in both lines and there is no
                    rule left to leave empty.

                    `partyLineEnPrefix` / `partyLineEnSuffix` exist because a single key
                    cannot carry a value in the middle of it: the name has to land
                    *between* "Mr/Ms." and the role, so the sentence is split at the
                    point where the blank was rather than matched and rewritten at
                    render time. */}
                <li>
                  <span className="block">
                    {t("partyLineEnPrefix")}{" "}
                    <span className="font-semibold">{doc.holderName}</span>
                    {t("partyLineEnSuffix")}
                  </span>
                  <span className="block">
                    <span className="italic">{t("partyLineId")}</span>{" "}
                    <span className="font-semibold">{doc.holderName}</span>{" "}
                    {t("partyTitleId")}
                  </span>
                </li>
              </ol>

              {/* The recipient's staff number and employer, as two labelled fields.

                  The geometry here is **measured out of
                  `261006-NOTEBOOK-OP-PRANOTO.pdf`** rather than eyeballed, because
                  eyeballing got it wrong twice. A4 at 96dpi is 595.28 x 841.89 CSS px
                  and a PDF point is therefore one CSS px, so the page's own coordinates
                  can be read as layout values directly. From page 1's content stream:

                  | element        |    y |    x |
                  |----------------|------|------|
                  | parties `2. Mr/Ms` | 587.71 |  58.56 |
                  | `Bapak/Ibu`        | 573.91 |  58.56 |
                  | `NIK/EID`          | 551.11 |  75.86 |
                  | value `SHI-OPS-086`| 536.11 |  78.38 |
                  | rule (32 `_`)      | 532.63 |  77.66 |
                  | `Company`          | 507.91 |  75.86 |
                  | value             | 492.07 |  77.78 |
                  | rule (32 `_`)      | 489.43 |  77.66 |

                  Three things follow from that table, none of which were obvious from
                  the rendered page:

                  1. **The label sits above the value, not beside it.** A first reading
                     of the page said label and value were on one line; the content
                     stream puts them 15pt apart, which is a separate line.
                  2. **The value has a ruled line under it** — the template prints 32
                     underscore glyphs, which is how a filled-in form field looks on
                     paper. A `border-b` reproduces that visually and is far more
                     robust than counting characters.
                  3. **The block is indented only ~17pt from the parties list**, not the
                     ~33pt a first attempt used. It reads as *less* inset than the
                     `2. Mr/Ms` line because the `<ol>` marker hangs outside it.

                  **`ps-8`, not `ps-10`.** The `<ol>` carries `pl-4`, so its text sits
                  16px right of the article's content edge; the fields then need another
                  ~17px to land at the PDF's x. That is 33px total, and `ps-8` is the
                  Tailwind step nearest it — 1.3px, about a third of a millimetre.

                  **Both fields render only when there is a value.** `nik_eid` and
                  `company_id` are nullable on the roster — a contractor has neither,
                  and the roster has to be able to record them — so printing the label
                  over an empty cell would put `NIK/EID` and `Company` on the paper
                  with nothing under them. That reads as a form nobody completed, on a
                  document being signed. */}
              {(doc.holderNikEid || doc.holderCompany) && (
                <div className="mt-3 space-y-3 ps-8 text-[9pt]">
                  {doc.holderNikEid && (
                    <PartyField
                      label={t("nikLabel")}
                      value={doc.holderNikEid}
                    />
                  )}
                  {doc.holderCompany && (
                    <PartyField
                      label={t("companyLabelRecipient")}
                      value={doc.holderCompany}
                    />
                  )}
                </div>
              )}

              <Bilingual
                className="mt-4"
                en={ACKNOWLEDGEMENT.en}
                id={ACKNOWLEDGEMENT.id}
              />

              <h2
                className="mt-4 text-center text-[10.5pt] font-bold"
                style={{ color: DOC.navy }}
              >
                {t("devicesHeading")}
              </h2>
              <h3
                className="text-center text-[9.5pt] font-semibold"
                style={{ color: DOC.grey }}
              >
                {t("devicesHeadingId")}
              </h3>

              <DeviceTable
                assets={doc.assets}
                rowNotes={rowNotes}
                qty={qty}
                unit={unit}
                onQtyChange={(id, value) =>
                  setQty((p) => ({ ...p, [id]: value }))
                }
                onUnitChange={(id, value) =>
                  setUnit((p) => ({ ...p, [id]: value }))
                }
                onNoteChange={(id, value) =>
                  setRowNotes((p) => ({ ...p, [id]: value }))
                }
                t={t}
              />

              <h2
                className="mt-5 text-center text-[10.5pt] font-bold"
                style={{ color: DOC.navy }}
              >
                {SIGNATURE_ROLES.company.en} · {t("termsHeadingId")}
              </h2>

              <TermsTable />

              <h2
                className="mt-5 text-center text-[10.5pt] font-bold"
                style={{ color: DOC.navy }}
              >
                {t("signatureHeading")}
              </h2>
              <h3
                className="text-center text-[9.5pt] font-semibold"
                style={{ color: DOC.grey }}
              >
                {t("signatureHeadingId")}
              </h3>

              <div className="mt-5 grid grid-cols-2 gap-10 text-[9pt]">
                <SignatureBlock
                  roleEn={SIGNATURE_ROLES.company.en}
                  roleId={SIGNATURE_ROLES.company.id}
                  name={doc.issuerName}
                  department={issuerDept}
                  departmentOptions={departmentOptions}
                  onDepartmentChange={setIssuerDept}
                  nikEid={issuerNikEid}
                  onNikEidChange={setIssuerNikEid}
                  company={issuerCompany}
                  onCompanyChange={setIssuerCompany}
                  date={signDate}
                  onDateChange={setSignDate}
                  signature={issuerSignature}
                  onSignatureChange={setIssuerSignature}
                  t={t}
                />
                <SignatureBlock
                  roleEn={SIGNATURE_ROLES.employee.en}
                  roleId={SIGNATURE_ROLES.employee.id}
                  name={doc.holderName}
                  department={employeeDept}
                  departmentOptions={departmentOptions}
                  onDepartmentChange={setEmployeeDept}
                  nikEid={employeeNikEid}
                  onNikEidChange={setEmployeeNikEid}
                  company={employeeCompany}
                  onCompanyChange={setEmployeeCompany}
                  date={signDate}
                  onDateChange={setSignDate}
                  signature={employeeSignature}
                  onSignatureChange={setEmployeeSignature}
                  t={t}
                />
              </div>

              <Footer />
            </article>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The document's letterhead. Logo left, issuer right, as the template prints it. */
function Header({ issuer }: { issuer: string }) {
  return (
    <header className="mb-3 flex items-start justify-between border-b border-black pb-2">
      {/* The template embeds the company logo as an image. This uses the app's own
          logo file rather than shipping a second copy of the artwork: two copies of
          one logo is two things that can drift, and the app's `logo-pgt.png` is the
          current one. */}
      <img
        src="/images/logo/logo-pgt.png"
        alt=""
        className="h-12 w-auto object-contain"
      />
      <p className="text-[8pt] font-semibold" style={{ color: DOC.navy }}>
        {issuer}
      </p>
    </header>
  );
}

/**
 * The Terms of Use block, which in the template is a **two-column table**.
 *
 * It was rendered here as a `grid` with two `<div>`s and no lines at all, and that is
 * the difference the browser found: the printout had the clauses but neither of the two
 * things that make the block read as a document — the navy `ENGLISH` / `INDONESIA`
 * header bar, and the pale vertical rule between the columns.
 *
 * ## Why a table and not a grid
 *
 * Reading the `.docx` settles it: the block is `<w:tbl>` with `gridCol 4520` twice, a
 * header row, and **one row per clause** — which is why the rule runs unbroken down
 * the whole block rather than stopping at each clause. The vertical line is
 * `<w:tcBorders><w:right w:val="single" w:color="B9C2D0" w:sz="4"/></w:tcBorders>` on
 * the **English** cell only.
 *
 * ## Why there is no grid around it
 *
 * This table declares **no `tblBorders`** — the device table declares all six and every
 * one of them is `w:color="auto"`. So the single divider is the only line it draws, and
 * adding an outline would invent borders the template does not have. The cells below
 * therefore set their own borders rather than reusing `Th`/`Td`, which draw a grid for
 * the device table.
 *
 * `avoid-break` keeps a clause and its Indonesian half on the same sheet: they are one
 * fact in two languages, and a break between them makes the reader match lines.
 */
function TermsTable() {
  return (
    <table className="mt-2 w-full border-collapse align-top text-[8.5pt]">
      <thead>
        <tr>
          {/* The navy bar. `sz=15` in the template — half-points, so 7.5pt, a size
              smaller than the body text. */}
          <th
            className="px-3 py-1.5 text-start text-[7.5pt] font-semibold"
            style={{ backgroundColor: DOC.navy, color: DOC.white }}
          >
            ENGLISH
          </th>
          <th
            className="px-3 py-1.5 text-start text-[7.5pt] font-semibold"
            style={{ backgroundColor: DOC.navy, color: DOC.white }}
          >
            INDONESIA
          </th>
        </tr>
      </thead>
      <tbody>
        {TERMS.map((clause, i) => (
          <tr key={`clause-${i}`}>
            {/* The divider is on the English cell, exactly as in the file. Cell margins
                are `left: 0 / right: 160 dxa` in the template, which is the gap the
                `pe-4` reproduces. */}
            <td
              className="avoid-break py-1 pe-4 align-top"
              style={{ borderRight: `1px solid ${DOC.divider}` }}
            >
              {clause.en}
            </td>
            {/* Every Indonesian line on this document is `#595959`, which is what tells
                a reader which half is which. */}
            <td
              className="avoid-break py-1 ps-4 align-top"
              style={{ color: DOC.grey }}
            >
              {clause.id}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * One labelled value with a ruled line beneath it, as the parties block prints
 * `NIK/EID` and `Company`.
 *
 * **The rule is the point.** The template draws 32 underscore glyphs under each value,
 * which is what a filled-in form field looks like on paper: the value is written above
 * a line rather than beside it. The first version of this block printed the value with
 * no rule at all, which on a signed document reads as an unexplained floating value
 * instead of a completed field.
 *
 * `w-[53mm]` is the measured width of those 32 glyphs at the template's 9.48pt body
 * size (`32 x 0.5em`). A `border-b` rather than the literal underscores, for the same
 * reason the parties block's dotted rule is not reproduced character-for-character:
 * a rule that depends on how many `_` were typed is a rule that silently changes width
 * when someone edits the text.
 *
 * The gap between label and value is `mt-2.5`, chosen to land near the PDF's 15pt.
 */
function PartyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-semibold">{label}</p>
      <p className="mt-2.5">
        <span className="inline-block w-[53mm] border-b border-gray-500 pb-px">
          {value}
        </span>
      </p>
    </div>
  );
}

/** One bilingual pair, printed one above the other as the template does. */
function Bilingual({
  en,
  id,
  className = "",
}: {
  en: string;
  id: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p>{en}</p>
      <p className="text-gray-600 italic">{id}</p>
    </div>
  );
}

/**
 * The device table, with Qty and Unit editable.
 *
 * The inputs are `print:hidden` and their **text** is printed instead, because a
 * form control does not print: a `<input>` renders as an empty box on paper, which
 * would put the quantity the admin typed nowhere on the document. Each cell prints
 * the value and shows the box only on screen.
 */
function DeviceTable({
  assets,
  rowNotes,
  qty,
  unit,
  onQtyChange,
  onUnitChange,
  onNoteChange,
  t,
}: {
  assets: HandoverDocument["assets"];
  rowNotes: Record<string, string>;
  qty: Record<string, string>;
  unit: Record<string, string>;
  onQtyChange: (id: string, value: string) => void;
  onUnitChange: (id: string, value: string) => void;
  onNoteChange: (id: string, value: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <>
      <table className="mt-2 w-full border-collapse text-[8.5pt]">
        <thead>
          <tr>
            <Th className="w-[4%]">{t("colNo")}</Th>
            <Th className="w-[34%]">
              {t("colDevice")}
              <br />
              <span
                className="font-normal italic"
                style={{ color: DOC.paleBlue }}
              >
                {t("colDeviceId")}
              </span>
            </Th>
            <Th className="w-[22%]">
              {t("colAssetTag")}
              <br />
              <span
                className="font-normal italic"
                style={{ color: DOC.paleBlue }}
              >
                {t("colAssetTagId")}
              </span>
            </Th>
            <Th className="w-[7%]">{t("colQty")}</Th>
            <Th className="w-[10%]">{t("colUnit")}</Th>
            <Th className="w-[23%]">
              {t("colNotes")}
              <br />
              <span
                className="font-normal italic"
                style={{ color: DOC.paleBlue }}
              >
                {t("colNotesId")}
              </span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {assets.map((asset, index) => (
            // A fragment, because each device is now **two or more** rows: the
            // device itself and one sub-row per accessory. The key is on the
            // fragment rather than the `<tr>` so React reconciles the whole group
            // per device — keying each accessory row by its own id would leave the
            // device row needing a key of its own, and `index` would then be reused
            // across two different lists.
            <Fragment key={asset.id}>
              <tr>
                {/* The row number is navy in the template too, matching its header. */}
                <Td>
                  <span style={{ color: DOC.navy }}>{index + 1}</span>
                </Td>
                <Td>
                  <span className="block">{asset.name}</span>
                  {asset.categoryName && (
                    <span className="block text-gray-600">
                      {asset.categoryName}
                    </span>
                  )}
                </Td>
                <Td>
                  {/* **Serial first, then the asset code** — `J9BLPB4 / 2601101047`.

                    The column is headed "Serial Number / Asset Tag", so the value
                    follows the heading's own order. It was the other way round in the
                    earlier template, whose heading read "Asset Tag / Serial Number",
                    and both were flipped together — a value whose order contradicts
                    its own column heading reads as a transposition on a document
                    somebody signs.

                    An asset with no serial prints the code alone rather than a
                    leading separator, for the same reason the accessory rows do. */}
                  <span className="block">
                    {asset.serialNumber
                      ? `${asset.serialNumber} / ${asset.assetCode}`
                      : asset.assetCode}
                  </span>
                </Td>
                <Td>
                  {/* The printed value and the input are siblings rather than one inside
                  the other, so `print:hidden` on the input leaves the text alone. */}
                  <span className="print:hidden">
                    <input
                      type="number"
                      min={1}
                      value={qty[asset.id] ?? "1"}
                      onChange={(e) => onQtyChange(asset.id, e.target.value)}
                      aria-label={t("qtyLabel", { code: asset.assetCode })}
                      className="w-10 [appearance:textfield] border border-gray-300 px-1 text-center [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </span>
                  <span className="hidden print:inline">
                    {qty[asset.id] ?? "1"}
                  </span>
                </Td>
                <Td>
                  <span className="print:hidden">
                    <input
                      type="text"
                      value={unit[asset.id] ?? ""}
                      onChange={(e) => onUnitChange(asset.id, e.target.value)}
                      aria-label={t("unitLabel", { code: asset.assetCode })}
                      className="w-16 border border-gray-300 px-1 text-center"
                    />
                  </span>
                  <span className="hidden print:inline">
                    {unit[asset.id] ?? ""}
                  </span>
                </Td>
                {/* The per-device note, which is **editable per row** here — unlike Qty
                and Unit it is not a single batch-wide value, and it lands inside the
                cell it belongs to rather than under the table.

                It was empty in an earlier version, and the handover's own
                `assignments.notes` was printed under the table instead. That is the
                wrong column twice over: the template's Notes cell sits next to one
                device, so a batch-wide sentence repeated once per device says the
                same thing N times and pushes the table across a page boundary. An
                empty cell also reads as a form nobody filled in.

                The printed value and the input are siblings rather than one inside
                the other, because a form control does not print. */}
                <Td>
                  <span className="print:hidden">
                    <textarea
                      rows={2}
                      value={rowNotes[asset.id] ?? ""}
                      onChange={(e) => onNoteChange(asset.id, e.target.value)}
                      aria-label={t("noteLabel", { code: asset.assetCode })}
                      className="w-full resize-none border border-gray-300 px-1 text-[8.5pt]"
                    />
                  </span>
                  <span className="hidden print:inline">
                    {rowNotes[asset.id] ?? ""}
                  </span>
                </Td>
              </tr>

              {/* The bag, the charger — printed as **full rows of their own**, each
                  immediately after the device it went out with.

                  The first version printed them as indented sub-rows with the number,
                  tag and notes cells left blank, on the reasoning that a bag sharing
                  a laptop's code should not read as a separately tagged item. That was
                  right about the tag and wrong about the shape: a document somebody
                  signs should list every item that went out as a line of its own,
                  because that is what they are attesting to, and an empty cell reads
                  as a form nobody filled in.

                  So each accessory gets the same six columns as a device, and the
                  three cells that were blank are now filled from the device row:

                  - **Name** — the accessory, which is what it is.
                  - **Asset Tag** — the device's code, deliberately repeated. This is
                    the case where repetition is the *correct* answer rather than a
                    duplicate: the tag column answers "which registered asset does this
                    line belong to", and a bag belongs to the laptop it travelled with.
                    A bag cannot have its own code — `assets_asset_code_ci_key` is
                    unique over `upper(btrim(asset_code))` — so the device's code is
                    the only true answer available, and the name beside it is what
                    distinguishes the two lines.
                  - **Qty and Unit** — editable per row, like a device's. "2 tas" is
                    a real thing an admin types when handing over two bags, and the
                    Qty column is print-form state by the same argument as everywhere
                    else in this file: a handover row is one asset, an accessory line
                    is one item, and both quantities are what the paper says rather
                    than a column in the database.
                  - **Notes** — the accessory's own, blank by default rather than
                    seeded with the handover's note. Copying the device's note down
                    would repeat one sentence across every line, which is the batch-
                    wide-note mistake this file already documents once.

                  **The row number is still omitted**, and that part did not change: it
                  is the template's device index, and a charger is not the second
                  device in the kit. */}
              {asset.accessories.map((accessory, accessoryIndex) => (
                <tr key={accessory.id}>
                  {/* **Numbered**, continuing the device's sequence: accessories in
                      the reference document are rows 2 and 3, not unnumbered lines
                      under row 1.

                      This reverses the earlier decision to leave this cell blank. The
                      argument for the blank was that the No column is a device index,
                      so a charger is not the second device — and that is still true of
                      what the column *means*. But the reference document is the
                      specification here, it numbers them, and a document where the
                      count of what was physically handed over cannot be read off the
                      numbering is worse on paper than one where the numbering does not
                      perfectly match the column's name. */}
                  <Td>
                    <span style={{ color: DOC.navy }}>
                      {index + 2 + accessoryIndex}
                    </span>
                  </Td>
                  <Td>
                    <span className="block">{accessory.name}</span>
                  </Td>
                  <Td>
                    {/* The device's own code, repeated, in the same "serial / code"
                        shape the device row above uses. An accessory has no serial of
                        its own, so the code alone is printed rather than a dangling
                        separator — ` / 2601101022` on its own reads as a missing value
                        rather than an absent one. */}
                    <span className="block">{asset.assetCode}</span>
                  </Td>
                  <Td>
                    {/* Print-form state, keyed by the **accessory's** id rather than
                        the device's: sharing the key would make typing a quantity for
                        the bag overwrite the laptop's. */}
                    <span className="print:hidden">
                      <input
                        type="number"
                        min={1}
                        value={qty[accessory.id] ?? "1"}
                        onChange={(e) =>
                          onQtyChange(accessory.id, e.target.value)
                        }
                        aria-label={t("qtyLabel", { code: accessory.name })}
                        className="w-10 [appearance:textfield] border border-gray-300 px-1 text-center [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </span>
                    <span className="hidden print:inline">
                      {qty[accessory.id] ?? "1"}
                    </span>
                  </Td>
                  <Td>
                    <span className="print:hidden">
                      <input
                        type="text"
                        value={unit[accessory.id] ?? ""}
                        onChange={(e) =>
                          onUnitChange(accessory.id, e.target.value)
                        }
                        aria-label={t("unitLabel", { code: accessory.name })}
                        className="w-16 border border-gray-300 px-1 text-center"
                      />
                    </span>
                    <span className="hidden print:inline">
                      {unit[accessory.id] ?? ""}
                    </span>
                  </Td>
                  <Td>
                    {/* Blank by default, unlike the device row which seeds
                        `loaded.notes`. See the note above. */}
                    <span className="print:hidden">
                      <textarea
                        rows={2}
                        value={rowNotes[accessory.id] ?? ""}
                        onChange={(e) =>
                          onNoteChange(accessory.id, e.target.value)
                        }
                        aria-label={t("noteLabel", { code: accessory.name })}
                        className="w-full resize-none border border-gray-300 px-1 text-[8.5pt]"
                      />
                    </span>
                    <span className="hidden print:inline">
                      {rowNotes[accessory.id] ?? ""}
                    </span>
                  </Td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </>
  );
}

/**
 * A header cell: **navy fill, white text.**
 *
 * The template's header row is `<w:shd w:fill="1B3B6F">` on every one of its six
 * cells, with the English label in `FFFFFF` and the Indonesian sub-label in `D8E0EE`.
 * It was a `bg-gray-100` row with default text here, which is neither colour from the
 * file and is the most visible difference between the printout and the template.
 */
function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`border border-gray-500 px-1.5 py-1 text-start font-semibold ${className}`}
      style={{ backgroundColor: DOC.navy, color: DOC.white }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  /** Optional because an empty cell is legitimate — the Notes column, when the
      handover has no note, prints as an empty box rather than an em dash. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`border border-gray-500 px-1.5 py-1 align-top ${className}`}>
      {children}
    </td>
  );
}

/**
 * One signature block: role, drawable box, and the three printed fields.
 *
 * The `Name` line is **not** an input. The name is a fact about the handover — the
 * roster entry for the recipient, the account for the issuer — and making it
 * editable would mean a document signed for somebody other than the person recorded
 * as holding the assets. The department and the date *are* editable, because both
 * genuinely vary per printing and neither is a fact about the handover.
 */
function SignatureBlock({
  roleEn,
  roleId,
  name,
  department,
  departmentOptions,
  onDepartmentChange,
  nikEid,
  onNikEidChange,
  company,
  onCompanyChange,
  date,
  onDateChange,
  signature,
  onSignatureChange,
  t,
}: {
  roleEn: string;
  roleId: string;
  name: string;
  department: string;
  departmentOptions: { value: string; label: string }[];
  onDepartmentChange: (value: string) => void;
  /** The signer's staff number, or "" when there is none to print. */
  nikEid: string;
  onNikEidChange: (value: string) => void;
  /** The signer's employer, or "" when there is none to print. */
  company: string;
  onCompanyChange: (value: string) => void;
  date: string;
  onDateChange: (value: string) => void;
  signature: string | null;
  onSignatureChange: (value: string | null) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    // `avoid-break` is read by the print stylesheet: a signature block split
    // across a page boundary would print the name on one sheet and its department
    // on the next, which is a worse outcome than a little extra whitespace.
    <div className="avoid-break">
      <p className="font-semibold">
        {roleEn}, <span className="font-normal italic">{roleId}</span>
      </p>

      <div className="print:hidden">
        <SignaturePad
          value={signature}
          onChange={onSignatureChange}
          label={t("signatureLabel", { role: roleEn })}
          placeholder={t("signaturePlaceholder")}
          clearLabel={t("signatureClear")}
          className="mt-2"
        />
      </div>

      {/* Printed signature: the PNG, or an empty ruled line. Never the canvas —
          a canvas does not print. */}
      <div className="hidden min-h-12 items-end justify-center print:flex">
        {signature !== null ? (
          <img src={signature} alt="" className="max-h-12 object-contain" />
        ) : (
          <div className="mb-1 h-px w-full bg-gray-400" />
        )}
      </div>

      <p className="mt-1 border-t border-gray-500 pt-1 text-center font-semibold">
        {name}
      </p>

      <div className="mt-1 space-y-1 print:hidden">
        <LabelledRow label={t("fieldName")}>
          <span className="font-semibold">{name}</span>
        </LabelledRow>

        <LabelledRow label={t("fieldNik")}>
          <Input
            id={`print-nik-${roleEn}`}
            name="nik_eid"
            value={nikEid}
            onChange={(e) => onNikEidChange(e.target.value)}
            placeholder={t("fieldNikPlaceholder")}
          />
        </LabelledRow>

        <LabelledRow label={t("fieldDeptPosition")}>
          <Select
            // Keyed on the value because `Select` reads `defaultValue` once; without
            // it, changing department elsewhere would leave this showing the old one.
            key={`dept-${roleEn}-${department}`}
            id={`print-dept-${roleEn}`}
            options={departmentOptions}
            defaultValue={department}
            onChange={onDepartmentChange}
          />
        </LabelledRow>

        <LabelledRow label={t("fieldCompany")}>
          <Input
            id={`print-company-${roleEn}`}
            name="company"
            value={company}
            onChange={(e) => onCompanyChange(e.target.value)}
            placeholder={t("fieldCompanyPlaceholder")}
          />
        </LabelledRow>

        <LabelledRow label={t("fieldDate")}>
          <Input
            id={`print-date-${roleEn}`}
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
          />
        </LabelledRow>
      </div>

      {/* Printed values, so the paper carries every line whatever the screen shows. */}
      <div className="mt-1 hidden space-y-0.5 print:block">
        <p>
          <span style={{ color: DOC.field }}>{t("fieldName")} : </span>
          {name}
        </p>
        {/* The NIK/EID and Company lines print **only when there is a value.**

            The issuer has no roster row, so there is nothing to seed either of them
            from, and the whole point of the field is that an admin may leave it
            empty for a signer without a staff number. Printing `NIK/EID : ` with
            nothing after it puts an unfilled label on a document being signed, which
            reads as an incomplete form rather than an absent fact. */}
        {nikEid.trim() !== "" && (
          <p>
            <span style={{ color: DOC.field }}>{t("fieldNik")} : </span>
            {nikEid}
          </p>
        )}
        <p>
          <span style={{ color: DOC.field }}>{t("fieldDeptPosition")}: </span>
          {department}
        </p>
        {company.trim() !== "" && (
          <p>
            <span style={{ color: DOC.field }}>{t("fieldCompany")} : </span>
            {company}
          </p>
        )}
        <p>
          <span style={{ color: DOC.field }}>{t("fieldDate")} : </span>
          {formatLongDate(date)}
        </p>
      </div>
    </div>
  );
}

function LabelledRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[8pt] font-semibold">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** The address block, as the template's footer prints it. */
function Footer() {
  return (
    <footer className="mt-6 border-t border-gray-300 pt-1.5 text-center text-[7pt] leading-[1.35] text-gray-600">
      <p className="font-bold text-gray-800">{FOOTER_LINES.company}</p>
      <p>{FOOTER_LINES.address}</p>
      <p>{FOOTER_LINES.contact}</p>
    </footer>
  );
}

/** Today as `YYYY-MM-DD`, which is what `input[type=date]` needs. */
function todayInputValue(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * `YYYY-MM-DD` as the template writes it: `14 September 2026`.
 *
 * **Not `new Date(value)` and not `toLocaleDateString`.** A `date` column parsed as
 * a date rolls a day backwards for anyone west of UTC, and the template's format is
 * a long English month name rather than the browser's locale short form. The parts
 * are already in the string, so they are put back together directly — the same
 * reasoning as `formatDateOnly` in the handover list.
 */
function formatLongDate(value: string): string {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const name = months[Number(month) - 1] ?? month;
  return `${Number(day)} ${name} ${year}`;
}

/**
 * Keeps a department value that is still in the list, else falls back to the first.
 *
 * The recorded department is preferred so the document opens showing what the
 * handover says; the fallback exists because a `<select>` whose value matches no
 * option renders blank, and "blank" would read as "no department" rather than "the
 * department this person has since been moved out of".
 */
function pickAvailable(
  recorded: string | null | undefined,
  rows: DepartmentRef[],
  current: string,
): string {
  if (current !== "" && rows.some((r) => r.name === current)) return current;
  if (recorded && rows.some((r) => r.name === recorded)) return recorded;
  return rows[0]?.name ?? "";
}
