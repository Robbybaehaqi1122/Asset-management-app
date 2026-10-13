import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@/components/ui/button/Button";
import Select from "@/components/form/Select";
import {
  LbxFormatError,
  missingObjects,
  type LbxContents,
  type LbxSheet,
} from "@/modules/assets/document/lbxReader";
import {
  NoRowsWrittenError,
  TemplateNotFillableError,
  activatePrintTemplate,
  deletePrintTemplate,
  listPrintTemplates,
  readStoredTemplate,
  setTemplateSheet,
  uploadPrintTemplate,
  type PrintTemplate,
} from "../services/printTemplateService";

/** The outcome of the last upload, shown until the next one replaces it. */
type UploadNote = { kind: "ok"; text: string } | { kind: "bad"; text: string };

/**
 * Print Setting: which Brother template this installation prints against, and which
 * sheet of it.
 *
 * ## The two choices are separate on purpose
 *
 * **Which template** and **which roll is loaded in it** are different questions. A
 * machine can be reloaded with 13 mm stock while still printing the 36 × 15 template, and
 * the file cannot know that — which is why `print_templates.sheet` exists and why the
 * template's own `currentSheet` is only a fallback.
 *
 * ## Sizes are read from the file, never from the database
 *
 * The dropdown is populated by `readStoredTemplate()`, which downloads the `.lbx` and
 * inflates its `label.xml`. **The alternative — storing `width_mm`/`height_mm` — is a
 * second source of truth for a fact the file already owns**, and it can disagree with the
 * file the moment somebody re-exports a template without re-uploading it. One 2.7 KB
 * download is cheaper than a column that can lie.
 *
 * ## `Select` is keyed on its value
 *
 * It reads `defaultValue` once and keeps it internally, so a dropdown driven by state
 * that changes underneath it — the template list swaps when one is activated — has to be
 * keyed on that state or it silently shows what it mounted with.
 */
export default function PrintSettingPanel({
  onChanged,
}: {
  onChanged?: () => void;
}) {
  const { t } = useTranslation("common", {
    keyPrefix: "systemSetting.printSetting",
  });

  const [templates, setTemplates] = useState<PrintTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [note, setNote] = useState<UploadNote | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PrintTemplate | null>(
    null,
  );

  const active = templates.find((row) => row.isActive) ?? null;

  /**
   * A counter, not a function, to ask for the list again.
   *
   * **This is the house pattern** — `/companies` and `/positions` do the same — and it is
   * better than calling an async `reload()` from the effect, for two reasons. The lint
   * rule is right: a function that `setState`s, called in an effect body, is a cascading
   * render by another name. And a token keeps **one** read path: an event handler that
   * mutates and then reloads bumps the counter, rather than being a second implementation
   * of the fetch that can drift from the first.
   */
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    // `cancelled` covers a sign-out landing while the read is in flight, which would
    // otherwise set state for a panel that is no longer shown.
    let cancelled = false;

    void listPrintTemplates()
      .then(
        (rows) => {
          if (cancelled) return;
          setTemplates(rows);
          // Cleared on **success**, not before the await: there is no synchronous setState
          // to get wrong, and a retry visibly recovers rather than flashing the error off
          // and back on.
          setLoadFailed(false);
        },
        () => {
          if (!cancelled) setLoadFailed(true);
        },
      )
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  /**
   * The parsed file, **stamped with the `file_path` it came from.**
   *
   * Re-uploading produces a new row for the same bytes, so `file_path` is what actually
   * identifies the file — keying on the row id would re-read a template that has not
   * changed. The stamp is also what lets the read be *derived* rather than reset: a slow
   * read for a previous template cannot land on the current one, and the effect has no
   * synchronous `setState` to clear when there is no active template.
   */
  const [parsedFile, setParsedFile] = useState<{
    filePath: string;
    contents: LbxContents;
  } | null>(null);

  const contents =
    active && parsedFile?.filePath === active.filePath
      ? parsedFile.contents
      : null;

  useEffect(() => {
    if (!active || contents) return;

    let cancelled = false;
    readStoredTemplate(active.filePath)
      .then((parsed) => {
        if (!cancelled)
          setParsedFile({ filePath: active.filePath, contents: parsed });
      })
      .catch(() => {
        // Deliberately silent: the panel already says the size cannot be read, and a
        // failed fetch of a 2.7 KB file is not an operator error to report.
        if (!cancelled) setParsedFile(null);
      });

    return () => {
      cancelled = true;
    };
  }, [active, contents]);

  /** Every failure reaches the operator in their own words, never as a raw SDK string. */
  const describe = (error: unknown): string => {
    if (error instanceof TemplateNotFillableError) {
      return t("notFillable", {
        sheet: error.sheetName,
        missing: error.missing.join(", "),
      });
    }
    if (error instanceof LbxFormatError) return error.message;
    if (error instanceof NoRowsWrittenError) return t("nothingWritten");
    return t("unexpected");
  };

  const run = async (work: () => Promise<unknown>, ok?: string) => {
    setNote(null);
    try {
      await work();
      if (ok) setNote({ kind: "ok", text: ok });
      setReloadToken((n) => n + 1);
      onChanged?.();
    } catch (error) {
      setNote({ kind: "bad", text: describe(error) });
    }
  };

  const handleUpload = async (
    file: File,
    name: string,
    sheet: string | null,
  ) => {
    setIsUploading(true);
    await run(
      () => uploadPrintTemplate(file, name, sheet),
      t("uploaded", { name }),
    );
    setIsUploading(false);
  };

  if (isLoading) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">{t("loading")}</p>
    );
  }

  if (loadFailed) {
    return (
      <p className="text-sm text-error-600 dark:text-error-500">
        {t("loadFailed")}
        <span className="ms-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReloadToken((n) => n + 1)}
          >
            {t("retry")}
          </Button>
        </span>
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------- the active template */}
      <section>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">
          {t("activeHeading")}
        </h3>

        {!active ? (
          <p className="mt-2 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/5 dark:text-gray-400">
            {t("noneActive")}
          </p>
        ) : (
          <div className="mt-3 rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {active.name}
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {active.filePath}
            </p>

            {/* The size dropdown. Only shown once the file has been read, because the
                file is the only thing that knows which sheets exist. */}
            <div className="mt-4 max-w-xs">
              <label
                htmlFor="print-template-sheet"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t("sheetLabel")}
              </label>
              <Select
                // Keyed on the current value: `Select` reads `defaultValue` once, so a
                // dropdown whose options arrive after mount would otherwise show nothing.
                key={`${active.id}:${active.sheet}`}
                id="print-template-sheet"
                defaultValue={active.sheet ?? contents?.currentSheet ?? ""}
                options={(contents?.sheets ?? []).map((sheet) => ({
                  value: sheet.name,
                  label: sheetLabel(sheet, t("sizeLabel")),
                }))}
                onChange={(value) =>
                  run(() => setTemplateSheet(active.id, value), t("sheetSaved"))
                }
              />
            </div>

            {/* A sheet that cannot be filled is the whole reason this panel exists, so it
                is stated where the choice is made rather than in a dialog after the
                fact. */}
            {contents &&
              (() => {
                const chosen =
                  contents.sheets.find((s) => s.name === active.sheet) ??
                  contents.sheets.find(
                    (s) => s.name === contents.currentSheet,
                  ) ??
                  contents.sheets[0];
                const missing = missingObjects(chosen);
                return missing.length > 0 ? (
                  <p className="mt-3 rounded-xl border border-error-200 bg-error-50 p-3 text-xs text-error-700 dark:border-error-900 dark:bg-error-950 dark:text-error-300">
                    {t("sheetNotFillable", {
                      sheet: chosen.name,
                      missing: missing.join(", "),
                    })}
                  </p>
                ) : null;
              })()}

            {!contents && (
              <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                {t("readingFile")}
              </p>
            )}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------- upload */}
      <UploadForm
        isUploading={isUploading}
        onUpload={handleUpload}
        disabled={isUploading}
      />

      {/* --------------------------------------------------------------- list */}
      {templates.length > 0 && (
        <section>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            {t("listHeading")}
          </h3>
          <ul className="mt-3 divide-y divide-gray-200 dark:divide-gray-800">
            {templates.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {row.name}
                    {row.isActive && (
                      <span className="ms-2 text-xs text-success-600 dark:text-success-400">
                        {t("inUse")}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {row.sheet ?? t("fileDefault")}
                  </p>
                </div>

                <div className="flex shrink-0 gap-2">
                  {!row.isActive && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        run(
                          () => activatePrintTemplate(row.id),
                          t("activated", { name: row.name }),
                        )
                      }
                    >
                      {t("activate")}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPendingDelete(row)}
                  >
                    {t("delete")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {note && (
        <p
          role="status"
          className={
            note.kind === "ok"
              ? "rounded-xl bg-success-50 p-3 text-sm text-success-700 dark:bg-success-950 dark:text-success-300"
              : "rounded-xl bg-error-50 p-3 text-sm text-error-700 dark:bg-error-950 dark:text-error-300"
          }
        >
          {note.text}
        </p>
      )}

      {pendingDelete && (
        <div className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {t("confirmDelete", { name: pendingDelete.name })}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t("confirmDeleteBody")}
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                const row = pendingDelete;
                setPendingDelete(null);
                void run(
                  () => deletePrintTemplate(row.id),
                  t("deleted", { name: row.name }),
                );
              }}
            >
              {t("confirmDeleteButton")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPendingDelete(null)}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "36x15 — 36.12 × 16.02 mm", or the warning when the sheet has nothing to write to. */
function sheetLabel(sheet: LbxSheet, sizeWord: string): string {
  const missing = missingObjects(sheet);
  return missing.length > 0
    ? `${sheet.name} — ${sheet.widthMm} × ${sheet.heightMm} mm (${sizeWord})`
    : `${sheet.name} — ${sheet.widthMm} × ${sheet.heightMm} mm (${sizeWord})`;
}

/**
 * Upload a `.lbx` the operator authored in P-touch Editor.
 *
 * **The file is chosen locally and validated in the browser before anything leaves the
 * machine.** A `.lbx` is a ZIP whose `label.xml` is DEFLATE-compressed, so the object
 * names are invisible to a substring search — the read has to inflate it, which is what
 * `lbxReader` does. Refusing here rather than at print time is the difference between an
 * operator correcting a name and a printed label with a blank description.
 */
function UploadForm({
  onUpload,
  isUploading,
  disabled,
}: {
  onUpload: (file: File, name: string, sheet: string | null) => Promise<void>;
  isUploading: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation("common", {
    keyPrefix: "systemSetting.printSetting",
  });
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");

  return (
    <section>
      <h3 className="text-base font-semibold text-gray-900 dark:text-white">
        {t("uploadHeading")}
      </h3>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {t("uploadBody")}
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="print-template-file"
            className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {t("fileLabel")}
          </label>
          <input
            id="print-template-file"
            type="file"
            accept=".lbx"
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null;
              setFile(picked);
              // The file's own name is a starting point, not a decision: an operator
              // uploading three templates for three rolls needs to tell them apart.
              if (picked && name === "") {
                setName(picked.name.replace(/\.lbx$/i, ""));
              }
            }}
            className="text-sm text-gray-700 file:me-3 file:rounded-full file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium dark:text-gray-300 dark:file:bg-gray-800"
          />
        </div>

        <div>
          <label
            htmlFor="print-template-name"
            className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {t("nameLabel")}
          </label>
          <input
            id="print-template-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-white/5 dark:text-white"
          />
        </div>

        <Button
          disabled={disabled || !file || name.trim() === ""}
          onClick={() => file && void onUpload(file, name, null)}
        >
          {isUploading ? t("uploading") : t("upload")}
        </Button>
      </div>
    </section>
  );
}
