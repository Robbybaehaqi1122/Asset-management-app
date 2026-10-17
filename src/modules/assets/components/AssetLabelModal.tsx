import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import AssetLabel from "@/modules/assets/components/AssetLabel";
import {
  LABEL_BOX_HEIGHT_MM,
  LABEL_BOX_WIDTH_MM,
  LABEL_HEIGHT_MM,
  LABEL_WIDTH_MM,
} from "@/modules/assets/document/labelSpec";
import type { Asset } from "@/modules/assets/services/assetService";
import {
  BPAC_EXTENSION_LINKS,
  BpacPrinterNotFoundError,
  BpacPrinterOfflineError,
  BpacTemplateNotChosenError,
  BpacUnavailableError,
  checkBpacExtension,
  printAssetLabelSilent,
  renderAssetLabelPreview,
} from "@/modules/assets/services/bpacService";

/**
 * How wide the fallback is drawn on screen: 90 mm, about 340 px.
 *
 * It is a **slot, not a zoom setting** — the label inside is at true size with the scale
 * derived from it, so the two cannot drift apart. Any width here works; legibility is the
 * only thing it decides, which is why it is the only arbitrary number in the file.
 */
const SLOT_MM = 90;

/** The outcome of the last print attempt, and nothing else. */
type PrintOutcome =
  | { kind: "idle" | "printing" | "sent" }
  | {
      kind: "unavailable" | "noPrinter" | "offline" | "noTemplate" | "failed";
      detail: string | null;
    };

/**
 * Why there is no b-PAC picture — which decides what the operator is told to do.
 *
 * Both branches carry the same keys as `undefined` so the read sites below narrow with
 * `in` rather than needing a cast, and so a variant cannot gain a field the other lacks.
 */
type RenderState =
  | { assetId: string; image: string; reason?: undefined; remedy?: undefined }
  | {
      assetId: string;
      image?: undefined;
      reason: string;
      remedy?: "extension";
    };

/**
 * One label action: preview it, then print it.
 *
 * ## Why preview and print share a dialog
 *
 * The row menu used to carry **Preview label** and **Silent print label** as two separate
 * items, which asked the same question twice and made it possible to print a label whose
 * preview nobody had looked at. A label is four fields on 36 × 16 mm, so showing it costs
 * almost nothing — and **showing it before the button is the point**: what is being
 * printed is on screen, not behind a decision.
 *
 * ## The image is drawn by Brother's engine, and that is the whole difference
 *
 * It comes from `Doc.GetImageData`, which asks b-PAC to render **the template the printer
 * will actually use**. `AssetLabel` draws the same geometry from `labelSpec.ts`, and it is
 * only ever a fallback: it is the app's *interpretation* of the template, so if someone
 * edits the `.lbx` in P-touch Editor it keeps showing the old layout while the printer
 * renders the new one. **A preview that can disagree with the output is worse than none,
 * because it looks authoritative** — so when the fallback is on screen it says so.
 *
 * The physical size is stated beside it because that is the question this screen answers,
 * and an image at any zoom cannot.
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
  const { t } = useTranslation("common", { keyPrefix: "assets.labelModal" });

  /**
   * The rendered image, **stamped with the asset it was rendered for.**
   *
   * The stamp is what lets a new asset show its fallback on the very first frame without a
   * synchronous `setState` in the effect. Clearing it in the effect is a
   * `set-state-in-effect` error, and it would flash the **previous asset's label** for a
   * frame — on a screen whose entire job is "is this the right label?" that is the one
   * thing that must never happen.
   */
  const [rendered, setRendered] = useState<RenderState | null>(null);

  const [print, setPrint] = useState<PrintOutcome>({ kind: "idle" });
  const [recheck, setRecheck] = useState<
    "idle" | "checking" | "missing" | "ready"
  >("idle");

  /**
   * Render the label once per open.
   *
   * **Nothing is reset here on purpose.** The parent mounts this only while an asset id
   * exists, so every open is a fresh mount and `print` and `recheck` are already at their
   * initial values — writing them again would be a synchronous `setState` in the effect
   * body for nothing.
   */
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    renderAssetLabelPreview(asset)
      .then((image) => {
        if (!cancelled) setRendered({ assetId: asset.id, image });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setRendered({
          assetId: asset.id,
          reason: error instanceof Error ? error.message : String(error),
          // Only b-PAC being unreachable has an install to offer. A template error is
          // Brother's own wording and nothing in a browser can fix it, so pointing at a
          // store listing there would send the operator somewhere useless.
          remedy:
            error instanceof BpacUnavailableError
              ? ("extension" as const)
              : undefined,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [asset, isOpen]);

  if (!isOpen) return null;

  const current: RenderState | null =
    rendered?.assetId === asset.id ? rendered : null;
  const image = current && "image" in current ? current.image : null;
  const reason = current && "reason" in current ? current.reason : null;
  const needsExtension = current?.remedy === "extension";

  /**
   * Print, and classify every failure.
   *
   * **The four kinds are separate because the operator's next action differs in every
   * one** — install the extension, plug the printer in, check the media — and a single
   * "could not print" sends them looking in the wrong place. Brother's own `ErrorString`
   * rides along verbatim, because it names the real condition where a sentence written
   * here could only guess.
   */
  const handlePrint = async () => {
    setPrint({ kind: "printing" });
    try {
      await printAssetLabelSilent(asset);
      setPrint({ kind: "sent" });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);

      if (error instanceof BpacTemplateNotChosenError) {
        // Its own kind, because the fix is not a printer, not an extension and not the
        // media: an administrator has to choose a template under System. Folding
        // it into "could not print" would send the operator after the wrong thing.
        setPrint({ kind: "noTemplate", detail });
      } else if (error instanceof BpacUnavailableError) {
        setPrint({ kind: "unavailable", detail });
      } else if (error instanceof BpacPrinterNotFoundError) {
        setPrint({ kind: "noPrinter", detail });
      } else if (error instanceof BpacPrinterOfflineError) {
        setPrint({ kind: "offline", detail });
      } else {
        setPrint({ kind: "failed", detail });
      }
    }
  };

  const handleRecheckExtension = async () => {
    setRecheck("checking");
    setRecheck((await checkBpacExtension()) ? "ready" : "missing");
  };

  const busy = print.kind === "printing";

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-lg">
      <div className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {t("title")}
        </h3>

        {/* The size stated beside the title, because it is the question this screen
            exists to answer and an image at any zoom cannot. */}
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t("size", {
            width: LABEL_WIDTH_MM,
            height: LABEL_HEIGHT_MM,
            inches: (LABEL_WIDTH_MM / 25.4).toFixed(2),
            inchesH: (LABEL_HEIGHT_MM / 25.4).toFixed(2),
          })}
        </p>

        <div className="mt-4 flex items-center justify-center rounded-lg bg-gray-100 p-5 dark:bg-gray-800">
          {image ? (
            <img
              src={image}
              alt={t("alt", { code: asset.asset_code })}
              className="max-w-full"
              style={{ aspectRatio: `${LABEL_WIDTH_MM} / ${LABEL_HEIGHT_MM}` }}
            />
          ) : (
            <FallbackLabel asset={asset} />
          )}
        </div>

        {/* Why the picture above is not the printer's, and what would make it so. */}
        {reason && (
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-start text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
            <p className="font-medium">
              {needsExtension ? t("fallbackTitle") : t("templateErrorTitle")}
            </p>
            <p className="mt-1 break-words">{reason}</p>
            {needsExtension ? (
              <>
                <p className="mt-1">{t("fallbackBody")}</p>
                <ul className="mt-2 flex list-disc flex-col gap-1 ps-4">
                  <li>
                    <StoreLink href={BPAC_EXTENSION_LINKS.chrome}>
                      {t("chromeStore")}
                    </StoreLink>
                  </li>
                  <li>
                    <StoreLink href={BPAC_EXTENSION_LINKS.edge}>
                      {t("edgeStore")}
                    </StoreLink>
                  </li>
                </ul>
              </>
            ) : (
              <p className="mt-1">{t("templateErrorBody")}</p>
            )}
          </div>
        )}

        {/* The print result sits under the image, where the eye already is. */}
        {print.kind !== "idle" && print.kind !== "printing" && (
          <div className="mt-3 text-start text-xs">
            <p
              className={
                print.kind === "sent"
                  ? "font-medium text-success-600 dark:text-success-400"
                  : "font-medium text-error-600 dark:text-error-500"
              }
            >
              {t(`print.${print.kind}`)}
            </p>
            {"detail" in print && print.detail && (
              <p className="mt-1 rounded-lg bg-gray-50 p-2 break-words text-gray-600 dark:bg-gray-900 dark:text-gray-400">
                {print.detail}
              </p>
            )}
          </div>
        )}

        {/* The extension's absence is the one failure the operator has to go and fix
            somewhere else, so the re-check belongs here rather than in a manual. */}
        {print.kind === "unavailable" && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-start text-xs text-gray-500 dark:text-gray-400">
            <span>{t("extensionHint")}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRecheckExtension}
              disabled={recheck === "checking"}
            >
              {recheck === "checking" ? t("checking") : t("checkAgain")}
            </Button>
            {recheck === "missing" && <span>{t("stillMissing")}</span>}
            {recheck === "ready" && (
              <span className="font-medium text-success-600 dark:text-success-400">
                {t("nowReady")}
              </span>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("close")}
          </Button>
          <Button onClick={handlePrint} disabled={busy}>
            {busy ? t("printing") : t("printLabel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** An external link to a store listing, with the rel the house style requires. */
function StoreLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-brand-600 underline dark:text-brand-400"
    >
      {children}
    </a>
  );
}

/**
 * The app's own drawing, magnified to a readable size.
 *
 * **The scale is on the inner box, not on this one.** The outer box is the slot in the
 * layout — 90 × 40.5 mm, which is the label at 2.53× — and the inner box is the label at
 * true size with the transform on it. Applying the scale to the outer box was the first
 * version, and it overflowed the dialog by 520 px: the outer box is *already* the magnified
 * size, so scaling it magnified the slot as well as the label.
 *
 * The two numbers are `LABEL_WIDTH_MM` and this box's width, so they have to move together
 * if the label geometry ever does — which is why the box is written in millimetres rather
 * than in pixels.
 */
function FallbackLabel({ asset }: { asset: Asset }) {
  return (
    <div
      className="shrink-0 overflow-hidden bg-white"
      style={{
        // 90 mm is the slot; 40.5 mm is 90 mm at the label's own 35.56:16 ratio.
        width: `${SLOT_MM}mm`,
        height: `${(SLOT_MM * LABEL_BOX_HEIGHT_MM) / LABEL_BOX_WIDTH_MM}mm`,
      }}
    >
      <div
        style={{
          width: `${LABEL_BOX_WIDTH_MM}mm`,
          height: `${LABEL_BOX_HEIGHT_MM}mm`,
          transform: `scale(${SLOT_MM / LABEL_BOX_WIDTH_MM})`,
          transformOrigin: "top left",
        }}
      >
        <AssetLabel asset={asset} />
      </div>
    </div>
  );
}
