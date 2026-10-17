import { useCallback, useEffect, useState } from "react";

/**
 * Open/close state for the command palette, plus the global shortcut.
 *
 * **The listener lives here rather than inside `CommandPalette`** because the palette
 * returns `null` while closed, so a listener mounted on it would be unmounted exactly
 * when it needs to be listening. It has to exist on every screen at all times.
 *
 * ## The badge and the handler read the same source
 *
 * `shortcutLabel` and `isOpenShortcut` are both derived from the same platform test, so
 * the key the header prints and the chord it accepts cannot drift apart. A hardcoded
 * `⌘K` badge shown to a Windows user is the same small lie as a search box with no
 * handler behind it: the shortcut it advertises is not on their keyboard.
 */
export function useCommandPalette(): {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
} {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((current) => !current), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isOpenShortcut(event)) return;

      // `preventDefault` so the browser's own "focus the address bar" chord does not
      // also fire — the reader asked to search the app, not the page.
      event.preventDefault();
      setIsOpen((current) => !current);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return { isOpen, open, close, toggle };
}

/** `true` on Apple platforms, where the modifier is ⌘ rather than Ctrl. */
function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * The `⌘ K` / `Ctrl K` badge for the search box.
 *
 * Read lazily once at mount rather than in an effect, so the very first render already
 * shows the right key instead of flashing `⌘` and correcting itself.
 */
export function useShortcutLabel(): string {
  const [label] = useState(() => (isApplePlatform() ? "⌘ K" : "Ctrl K"));
  return label;
}

/**
 * `true` for the chord that toggles the palette.
 *
 * Accepts either modifier deliberately: a machine with both keys down, or a keyboard
 * where ⌘ is remapped, still gets a working palette rather than a dead badge.
 */
export function isOpenShortcut(event: KeyboardEvent): boolean {
  return event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
}
