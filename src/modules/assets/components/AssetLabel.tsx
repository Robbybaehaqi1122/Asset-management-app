import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Asset } from "@/modules/assets/services/assetService";
import {
  LABEL_FONT_FAMILY,
  LABEL_BOX_HEIGHT_MM,
  LABEL_BOX_WIDTH_MM,
  LINE_ASSET_CODE,
  LINE_COMPANY_UNIT,
  LINE_DESCRIPTION,
  QR_SIZE_MM,
  QR_X_MM,
  QR_Y_MM,
  RULE,
  buildLabelContent,
  type LabelLine,
} from "@/modules/assets/document/labelSpec";
import { renderQrDataUrl } from "@/modules/assets/document/qrImage";

/**
 * The label drawn by this application, at true size.
 *
 * ## It is the *fallback*, and that is the whole of its job now
 *
 * The authoritative preview is `renderAssetLabelPreview()` — b-PAC rendering its own
 * template — and this is what stands in when b-PAC is not installed. **Which is exactly
 * why it must not be mistaken for the real thing:** it is drawn from `labelSpec.ts`,
 * which is the app's *reading* of the `.lbx`. Move a field in P-touch Editor and the
 * printer changes while this keeps showing the old layout. The preview modal labels it
 * as its own drawing for that reason.
 *
 * ## Absolute millimetres, because the template positions objects absolutely
 *
 * P-touch Editor gives every object an `x`/`y` on the sheet, so reproducing that model
 * directly is both shorter and more accurate than deriving a flex arrangement. The
 * container is exactly the paper, so `left: 20.88mm` means that many millimetres on the
 * label and nowhere else.
 */
export default function AssetLabel({ asset }: { asset: Asset }) {
  const { t } = useTranslation("common", { keyPrefix: "assets.label" });
  const content = buildLabelContent(asset);

  /**
   * The generated symbol, **stamped with the code it was generated for** — see
   * `AssetLabelModal` for why it is derived rather than cleared in the effect.
   */
  const [qr, setQr] = useState<{ code: string; url: string } | null>(null);
  const [qrFailed, setQrFailed] = useState<{ code: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    renderQrDataUrl(content.assetCode)
      .then((url) => {
        if (!cancelled) setQr({ code: content.assetCode, url });
      })
      .catch(() => {
        if (!cancelled) setQrFailed({ code: content.assetCode });
      });

    return () => {
      cancelled = true;
    };
  }, [content.assetCode]);

  const qrDataUrl = qr?.code === content.assetCode ? qr.url : null;
  const qrError = qrFailed?.code === content.assetCode;

  const box = (line: LabelLine, extra?: string) =>
    [
      "absolute",
      `left-[${line.x}mm]`,
      `top-[${line.y}mm]`,
      `w-[${line.width}mm]`,
      `text-[${line.fontPt}pt]`,
      line.bold ? "font-bold" : "font-normal",
      "leading-[1.15]",
      extra ?? "",
    ]
      .filter(Boolean)
      .join(" ");

  return (
    <div
      className="relative overflow-hidden bg-white text-black"
      style={{
        width: `${LABEL_BOX_WIDTH_MM}mm`,
        height: `${LABEL_BOX_HEIGHT_MM}mm`,
        fontFamily: LABEL_FONT_FAMILY,
      }}
    >
      <span className={box(LINE_ASSET_CODE)}>{content.assetCode}</span>

      {/* The rule under the code. A border rather than a filled box because the template
          draws it as a line object, and a solid background that thin renders unevenly at
          the edge on a thermal head. */}
      <span
        className="absolute border-t border-black"
        style={{
          left: `${RULE.x}mm`,
          top: `${RULE.y}mm`,
          width: `${RULE.width}mm`,
          borderTopWidth: `${RULE.thicknessMm}mm`,
        }}
      />

      <span className={box(LINE_COMPANY_UNIT)}>{content.companyAndUnit}</span>

      {/* The description wraps rather than truncating. The template gives this object a
          4.97 mm box with `autoLF="true"`, which at 6 pt is two lines, so the name is
          allowed to use both — see `buildLabelContent`. */}
      <span
        className={box(LINE_DESCRIPTION, "break-words")}
        style={{ height: "4.97mm" }}
      >
        {content.description}
      </span>

      {/* An `<img>` holding an SVG data URL, never a `<canvas>` and never inlined
          markup — see `qrImage.ts` for both, and for why the symbol is resolution
          independent. Its box is the template's 14.11 mm, positioned absolutely, so it
          lands on the coordinates Brother's editor wrote. */}
      {qrDataUrl ? (
        <img
          src={qrDataUrl}
          alt={t("qrAlt", { code: content.assetCode })}
          className="absolute"
          style={{
            left: `${QR_X_MM}mm`,
            top: `${QR_Y_MM}mm`,
            width: `${QR_SIZE_MM}mm`,
            height: `${QR_SIZE_MM}mm`,
          }}
        />
      ) : (
        <span
          className="absolute flex items-center justify-center text-[6pt] text-gray-400"
          style={{
            left: `${QR_X_MM}mm`,
            top: `${QR_Y_MM}mm`,
            width: `${QR_SIZE_MM}mm`,
            height: `${QR_SIZE_MM}mm`,
          }}
        >
          {qrError ? "!" : "…"}
        </span>
      )}
    </div>
  );
}
