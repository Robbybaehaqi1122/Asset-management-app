import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import Button from "@/components/ui/button/Button";
import { CloseIcon, PrinterIcon } from "@/icons";
import type { Asset } from "@/modules/assets/services/assetService";
import {
  LABEL_HEIGHT_MM,
  LABEL_WIDTH_MM,
  buildLabelContent,
} from "@/modules/assets/document/labelSpec";
import { renderQrDataUrl } from "@/modules/assets/document/qrImage";

/**
 * The printable asset label: one 36 × 15 mm label for one asset, on Brother PT-P900W
 * stock.
 *
 * **The print path is the handover document's, deliberately.** Same three decisions,
 * each for the reason its handover counterpart records: a portal onto `document.body`
 * (not `Modal`, which renders no `role="dialog"` for the stylesheet to hook), a body
 * class that the print rules key on, and `window.print()` with no PDF library. A label
 * is 36 mm wide; adding 300 kB of PDF writer to produce it would be absurd.
 *
 * The one genuinely new thing is the **page size**, and it is handled by a named
 * `@page` rather than a second `@page` rule — see `index.css` for why a plain second
 * rule would make every A4 page in the app 36 mm wide.
 */
export default function AssetLabelModal({
  asset,
  isOpen,
  onClose,
}: {
  asset: Asset;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("common", { keyPrefix: "assets.label" });
  /**
   * The generated symbol, **stamped with the asset code it was generated for.**
   *
   * The stamp is what lets the placeholder appear without a synchronous `setState`.
   * The obvious shape — `useEffect` that sets `setQr(null)` and then generates — is
   * a `set-state-in-effect` error and would be one here: clearing the old symbol is a
   * synchronous write in the effect body, so switching rows renders the previous
   * asset's barcode for a frame before the clear lands. Comparing a stamp against the
   * current code derives the same "not ready" state during render instead, so a new
   * asset shows a placeholder on the very first frame and there is no extra pass.
   */
  const [qr, setQr] = useState<{ code: string; url: string } | null>(null);
  const [qrFailure, setQrFailure] = useState<{ code: string } | null>(null);

  const content = buildLabelContent(asset);

  /**
   * The QR is generated on mount rather than during render.
   *
   * `qrcode` is asynchronous because it walks the payload through encoding tables and
   * Reed-Solomon blocks, and doing that in the render body would mean either a
   * synchronous encoder call per render or a partially built symbol on screen. The
   * `cancelled` flag is the standard cleanup guard: without it a slow generation for
   * one asset resolves after the admin has already opened another and overwrites its
   * symbol with the previous asset's code — which is the worst possible failure for a
   * label, since it would put the wrong identifier on the physical asset. The `code`
   * stamp on the result is the second half of the same guard: it is checked during
   * render, so a stale resolution is discarded rather than displayed.
   */
  useEffect(() => {
    let cancelled = false;

    renderQrDataUrl(content.assetCode)
      .then((url) => {
        if (!cancelled) setQr({ code: content.assetCode, url });
      })
      .catch(() => {
        if (!cancelled) setQrFailure({ code: content.assetCode });
      });

    return () => {
      cancelled = true;
    };
  }, [content.assetCode]);

  const qrDataUrl = qr?.code === content.assetCode ? qr.url : null;
  const qrError = qrFailure?.code === content.assetCode;

  /**
   * The class is added on mount, not on the Print button's click, for the same reason
   * the handover document does it: it only takes effect inside `@media print`, so the
   * preview is unaffected, and having it already in place means the browser's own
   * Ctrl+P prints the label rather than the page behind it.
   *
   * It is removed on unmount and never left behind — a class stranded on `<body>`
   * would make the *next* print anywhere in the app produce a 36 mm page.
   */
  useEffect(() => {
    document.body.classList.add("asset-label-printing");
    return () => document.body.classList.remove("asset-label-printing");
  }, []);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
      className="asset-label-print-root fixed inset-0 z-99999 flex items-center justify-center bg-gray-400/50 p-4"
    >
      <div className="asset-label-print-panel w-full max-w-lg rounded-xl bg-white shadow-theme-lg dark:bg-gray-dark">
        <div className="flex items-center justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-gray-800 print:hidden">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              {t("title")}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {t("subtitle", {
                width: LABEL_WIDTH_MM,
                height: LABEL_HEIGHT_MM,
              })}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              onClick={handlePrint}
              disabled={!qrDataUrl}
              startIcon={<PrinterIcon className="size-4" />}
            >
              {t("print")}
            </Button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("close")}
              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5"
            >
              <CloseIcon className="size-5" />
            </button>
          </div>
        </div>

        <div className="asset-label-print-sheet flex max-h-[70vh] flex-col items-center justify-center gap-4 overflow-auto bg-gray-100 p-6 dark:bg-gray-900">
          {/* The magnified preview.

              The label itself is exactly 36 × 15 mm and that box must survive into
              print, so the magnification is a `transform` on a wrapper rather than a
              size on the label — `transform` paints larger without changing the box,
              and the print rules set it back to `none`. The wrapper reserves the
              magnified size so the sheet scrolls correctly on screen. */}
          <div
            className="asset-label-scale h-[37.5mm] w-[90mm] shrink-0 overflow-hidden rounded-sm outline-2 outline-gray-400 outline-dashed dark:outline-gray-600"
            style={{ transform: "scale(2.5)", transformOrigin: "top left" }}
          >
            <Label asset={asset} qrDataUrl={qrDataUrl} qrError={qrError} />
          </div>

          <p className="max-w-md text-center text-xs text-gray-500 dark:text-gray-400 print:hidden">
            {qrError ? t("qrFailed") : t("hint")}
          </p>

          {/* The print dialog is outside the app's control, and the one setting that
              silently ruins a label is "Headers and footers" — Chrome's own default
              margins are taller than a 15 mm label, so it scales the whole thing down
              to fit and the label prints a fraction of its size. This panel is the
              only place the admin is told about it. */}
          <div className="w-full max-w-md rounded-lg border border-warning-300 bg-warning-50 p-3 text-start text-xs text-gray-700 dark:border-warning-700 dark:bg-warning-950 dark:text-gray-300 print:hidden">
            <p className="font-semibold">{t("dialogTitle")}</p>
            <ul className="mt-1.5 flex list-disc flex-col gap-1 ps-4">
              <li>{t("hintHeaders")}</li>
              <li>{t("hintMargins")}</li>
              <li>{t("hintScale")}</li>
              <li>{t("hintPaper")}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The label itself, at true size.
 *
 * **Every dimension here is millimetres and every one of them is load-bearing.** The
 * stock is 36 × 15 mm; the QR takes 11.5 mm of the height, the padding 1.2 mm each
 * edge, and the 1 mm gap leaves the text column 20.9 mm. Changing the font size without
 * re-checking `DESCRIPTION_MAX_CHARS` in `labelSpec.ts` is how the third line stops
 * fitting — the two numbers are stated in the same place for that reason.
 */
function Label({
  asset,
  qrDataUrl,
  qrError,
}: {
  asset: Asset;
  qrDataUrl: string | null;
  qrError: boolean;
}) {
  const { t } = useTranslation("common", { keyPrefix: "assets.label" });
  const content = buildLabelContent(asset);

  return (
    <div className="asset-label flex h-[15mm] w-[36mm] items-center gap-[1mm] bg-white p-[1.2mm] text-black">
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[0.5mm]">
        <span className="truncate text-[7pt] leading-none font-bold">
          {content.assetCode}
        </span>
        <span className="truncate text-[5pt] leading-none">
          {content.companyAndUnit}
        </span>
        <span className="truncate text-[5pt] leading-none">
          {content.description}
        </span>
      </div>

      {/* An `<img>` holding an SVG data URL, never a `<canvas>` and never inlined
          markup — see `qrImage.ts` for both, and for why the symbol is resolution
          independent.

          The dimensions are explicit rather than left to the image's intrinsic size
          because a QR whose box the layout engine derives from its bitmap will not
          land on the label's 11.5 mm grid, and a label printed half a millimetre out
          is a label that has to be trimmed by hand. */}
      <div className="flex h-[11.5mm] w-[11.5mm] shrink-0 items-center justify-center">
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt={t("qrAlt", { code: content.assetCode })}
            className="h-[11.5mm] w-[11.5mm]"
          />
        ) : (
          <span className="text-center text-[4pt] leading-tight text-gray-400">
            {qrError ? "!" : "…"}
          </span>
        )}
      </div>
    </div>
  );
}
