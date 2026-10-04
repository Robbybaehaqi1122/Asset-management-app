import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/utils";

/**
 * A drawable signature box.
 *
 * **Hand-rolled rather than a library.** `signature_pad` would do this in about the
 * same amount of code, and `AGENTS.md` forbids adding a dependency without asking;
 * the whole thing is one canvas plus pointer handling, which the browser has had
 * for years.
 *
 * It renders a `<canvas>` and hands the result back as a **PNG data URL**, which is
 * what the print document embeds. A data URL rather than a blob because the print
 * stylesheet needs it as a plain `<img src>`, and because a blob URL dies with the
 * document that created it — a signed form that prints blank on the second attempt
 * is the exact bug this avoids.
 *
 * ## Why the canvas is scaled by devicePixelRatio
 *
 * A canvas has a backing store in device pixels and a CSS size in layout pixels. Set
 * only the CSS size and the drawing is stored at, say, 300×120 and then stretched
 * across a 600×240 box, which makes every stroke visibly soft on any modern screen —
 * and a signature is the one thing on the page where softness is noticed. The
 * backing store is therefore sized to `cssSize × dpr` and the context scaled by the
 * same factor, so one CSS pixel is one device pixel.
 */
export type SignaturePadProps = {
  /** The signature as a PNG data URL, or null when nothing has been drawn. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Accessible name for the canvas, which has no text of its own. */
  label: string;
  /** Shown centred in the empty box. Separate from `label` so it can say what to do. */
  placeholder: string;
  /** The clear button's own text — **not** `label`, which names the box. */
  clearLabel: string;
  /** Extra classes for the frame around the canvas. */
  className?: string;
  disabled?: boolean;
};

export function SignaturePad({
  value,
  onChange,
  label,
  placeholder,
  clearLabel,
  className,
  disabled = false,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  /**
   * The last point in **CSS pixels**, not device pixels.
   *
   * Keeping it in CSS pixels means the multiply by the device pixel ratio happens in
   * one place — `toDevice` below — rather than at every call site, which is where a
   * coordinate bug would otherwise hide.
   */
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  /** `hasInk` is separate from `value` so the frame can show a filled baseline. */
  const [hasInk, setHasInk] = useState(value !== null);

  /**
   * Reads the canvas's real pixel size.
   *
   * `getBoundingClientRect` rather than the `width`/`height` attributes, because the
   * attributes are in device pixels while the rectangle is in CSS pixels, and the
   * whole point is to convert between them.
   */
  const sizeOf = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const dpr =
      typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    return {
      dpr,
      cssWidth: Math.max(1, Math.round(rect.width)),
      cssHeight: Math.max(1, Math.round(rect.height)),
    };
  }, []);

  /**
   * Paints an already-captured signature back onto the canvas.
   *
   * Needed because `onChange` only hands out a data URL — it does not keep the canvas
   * contents. Without this, a re-render caused by an unrelated prop would wipe the
   * signature and the admin would have to draw it again. That is not hypothetical:
   * the print form's date and department state live in the same parent.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { dpr, cssWidth, cssHeight } = sizeOf() ?? {
      dpr: 1,
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
    };

    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 1.75;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";

    // Cleared before the image is drawn, so a new `value` replaces the old ink
    // rather than compositing on top of it.
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    if (value === null) return;

    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, cssWidth, cssHeight);
    // The stored data URL was captured at this same CSS size, so drawing it at the
    // current CSS size is a 1:1 map rather than a rescale.
    img.src = value;
  }, [value, sizeOf]);

  /**
   * Pointer position in CSS pixels relative to the canvas.
   *
   * `pointer` events rather than `mouse`+`touch` pairs: one code path for a mouse, a
   * finger and a stylus, which is the only way this works on a phone — and a phone is
   * a realistic device for an admin signing a handover on site.
   */
  const pointOf = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const point = pointOf(event);
    if (!canvas || !ctx || !point) return;

    // Capture so a stroke that leaves the box still finishes and still emits.
    canvas.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastRef.current = point;

    // A single tap must leave a dot rather than nothing, so the stroke is seeded
    // with a zero-length line here instead of waiting for the first move.
    //
    // **Coordinates are plain CSS pixels, unscaled.** The effect above already called
    // `ctx.scale(dpr, dpr)`, which puts the context into CSS-pixel space, so applying
    // `* dpr` here as well scales by `dpr` **twice** — on a 2× display a stroke
    // aimed at the middle of the box is drawn four times too far out and lands
    // outside it. `lastRef` holds CSS pixels for exactly this reason.
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x + 0.1, point.y + 0.1);
    ctx.stroke();
    event.preventDefault();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || !drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const point = pointOf(event);
    const last = lastRef.current;
    if (!ctx || !point || !last) return;

    // See the note in `handlePointerDown`: the context is already scaled into CSS
    // pixel space, so these are unscaled too.
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();

    lastRef.current = point;
    event.preventDefault();
  };

  /** Ends the stroke and emits. `lostpointercapture` also lands here. */
  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastRef.current = null;

    const canvas = canvasRef.current;
    if (canvas) {
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        // Already released, e.g. because the pointer was cancelled. The stroke is
        // already finished and the emit below still happens, so there is nothing to
        // do here.
      }
    }

    const dataUrl = canvas?.toDataURL("image/png") ?? null;
    // `toDataURL` on an untouched canvas still returns a PNG, so an "is it empty"
    // check has to look at what was drawn rather than at the result.
    setHasInk(true);
    onChange(dataUrl);
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      const { cssWidth, cssHeight } = sizeOf() ?? {
        cssWidth: canvas.width,
        cssHeight: canvas.height,
      };
      // In CSS-pixel space, which is where `ctx.scale(dpr, dpr)` left the context, so
      // this covers the whole backing store. Multiplying by `dpr` again would clear
      // past the canvas edges — harmless, but it hides which space is being used.
      ctx.clearRect(0, 0, cssWidth, cssHeight);
    }
    drawingRef.current = false;
    lastRef.current = null;
    setHasInk(false);
    onChange(null);
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        className={cn(
          "relative rounded-lg border bg-white transition",
          disabled
            ? "border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-800"
            : "border-gray-300 hover:border-gray-400 dark:border-gray-700 dark:hover:border-gray-600",
        )}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={label}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onLostPointerCapture={handlePointerUp}
          className={cn(
            "block h-28 w-full touch-none rounded-lg",
            disabled ? "cursor-not-allowed" : "cursor-crosshair",
          )}
          style={{ touchAction: "none" }}
        />

        {/*
          The ruled baseline the template prints under each signature.

          Drawn as a sibling rather than inside the canvas so it is **not** part of
          the exported PNG — the printed document draws its own line, and a second one
          baked into the image would show up twice wherever the image is placed.
        */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-6 bottom-4 border-b border-dashed border-gray-300 dark:border-gray-600"
        />

        {!hasInk && (
          <p
            // Hidden from assistive tech: the canvas above already carries the
            // accessible name, and reading the hint twice would be noise.
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500"
          >
            {placeholder}
          </p>
        )}
      </div>

      {hasInk && !disabled && (
        <button
          type="button"
          onClick={handleClear}
          className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          {clearLabel}
        </button>
      )}
    </div>
  );
}
