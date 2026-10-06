import { useEffect, type RefObject } from "react";

/**
 * Calls `handler` when a click lands outside the passed ref.
 *
 * @param ref Element to monitor
 * @param handler Function to call on outside click
 * @param enabled Only listen while this is true.
 *
 * ## Why `enabled` exists — it is a bug fix, not an optimisation
 *
 * The listener is registered on `document`, so **every mounted instance runs it on
 * every click**, and an instance whose own menu is closed must not react at all.
 * Without `enabled`, a component rendered once per table row produces one listener
 * per row, and clicking an item in row 1 fires row 2's listener too: row 2's ref
 * does not contain the target, so row 2 calls the shared "close the menu" setter.
 * React re-renders, the open panel unmounts, and the `click` that was still on its
 * way lands on whatever is now at those coordinates — so the item's own handler
 * never runs and the button appears dead.
 *
 * That failure is **count-dependent**, which is what makes it survive review and a
 * test with a single row: one row means one listener, which correctly ignores its
 * own menu, and everything works. Two rows is enough to break it.
 *
 * The other two callers pass `true` unconditionally because there is exactly one
 * instance of each.
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  handler: () => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;

    const listener = (event: MouseEvent | TouchEvent) => {
      // Do nothing if clicking ref's element or descendent elements
      if (!ref.current || ref.current.contains(event.target as Node)) {
        return;
      }
      handler();
    };

    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);

    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [ref, handler, enabled]);
}
