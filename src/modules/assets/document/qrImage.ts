import QRCode from "qrcode";

/**
 * Render a value as a QR symbol, as an SVG data URL.
 *
 * ## Why SVG, and not a raster image
 *
 * A QR symbol is a grid of equal-sized squares, and a scanner reads it by sampling
 * square centres and testing black or white. So **anything that resamples the grid
 * softens the edges between modules, and softened edges are what a scanner fails on**
 * — a symbol that looks perfect on screen can fail on paper.
 *
 * This is measurable rather than theoretical. `asset_code` is ten characters, which is
 * QR version 1: a 21 × 21 module grid, and with the quiet zone below, 23 × 23. Asking
 * the raster renderer for the 384 px this was originally written with gives:
 *
 * ```
 * 384 / 23 = 16.696 px per module   <- fractional
 * ```
 *
 * so the renderer distributes that remainder across 23 rows and every module is drawn
 * at a slightly different size, some of them a fraction of a pixel wide. Choosing a
 * width that happens to divide evenly does not fix it either — 368, 460 and 552 are all
 * exact multiples of 23, but the multiple depends on the **QR version**, which depends
 * on the payload length. An `asset_code` one character longer crosses into version 2, the
 * grid becomes 25 × 25, and the width that was exact is now fractional. A hard-coded
 * width can be exact for exactly one range of payloads.
 *
 * The SVG renderer has no such problem. It emits a `viewBox` in whole modules —
 * `viewBox="0 0 23 23"` for the same symbol — so every module edge lands on an integer
 * boundary and the browser scales the vector rather than the pixels. It also sets
 * `shape-rendering="crispEdges"`, which switches off anti-aliasing on those edges
 * outright, so the modules stay hard at any print size and at any device pixel ratio.
 * The symbol is resolution-independent, so the one number the caller would otherwise
 * have to get right simply does not exist.
 *
 * ## Why an `<img>` holding that SVG, and not the SVG inlined
 *
 * The symbol is carried as a **data URL in an `<img>`**, not pasted into the document.
 * Two reasons, and neither is about taste:
 *
 * - **The print path is already proven to work with an image element.** The handover
 *   document's signature taught this the hard way: what a browser prints from a
 *   `<canvas>` is a bitmap rasterised at the canvas's own resolution rather than the
 *   page's, so the printed signature is the PNG the canvas emits. Going through an
 *   image keeps the label on that same, known-good path.
 * - **This project's "never inline SVG" rule is about icons.** It exists so icons come
 *   from `src/icons/` and are not hand-drawn in a component — `google.svg` exists
 *   because of it. A QR symbol is not an icon and is not hand-drawn; it is machine
 *   output whose geometry is the whole point of the feature, and it changes per asset.
 *   Carrying it as a URL keeps it out of the JSX without putting it anywhere it could
 *   be mistaken for a hand-written glyph.
 *
 * ## The encode options, and each one is a decision rather than a default
 *
 * - **`margin: 1`** — one module of quiet zone. The specification requires one and the
 *   library's own default of `4` is a screen-sized margin that would eat a third of an
 *   11.5 mm square. Below one, symbols look fine on screen and fail on a label that has
 *   been handled.
 * - **`errorCorrectionLevel: "M"`** — 15% recovery. The payload is ten characters, so
 *   `Q` would cost density for nothing. The realistic damage to an asset tag is a
 *   scratch across part of the symbol, and `M` survives that.
 * - **Colour is left at the default, black on white.** Thermal printers are monochrome,
 *   and an inverted symbol prints correct-but-wrong on some firmware and invisible on
 *   others. The preview is the only place colour would have mattered, and leaving it
 *   honest is better than tinting it to match the theme.
 */
const QR_ENCODE_OPTIONS = {
  margin: 1,
  errorCorrectionLevel: "M" as const,
};

/**
 * Base64-encode a string as bytes, rather than `btoa` on the string.
 *
 * `btoa` throws on any code point above U+00FF, and the SVG's fill colour is
 * developer-supplied text that would eventually hold one. Going through `TextEncoder`
 * makes the function total instead of correct for today's ASCII-only output.
 */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Build the data URL for one symbol.
 *
 * **Base64 rather than a percent-encoded URL.** The SVG contains `#ffffff` and
 * `#000000`, and a `#` in a `data:` URL starts the fragment — the browser would show a
 * blank image with no error. Base64 has no such character.
 */
export async function renderQrDataUrl(text: string): Promise<string> {
  const svg = await QRCode.toString(text, {
    ...QR_ENCODE_OPTIONS,
    type: "svg",
  });

  return `data:image/svg+xml;base64,${toBase64(svg)}`;
}
