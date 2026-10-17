import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { useAuth } from "@/context/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import type { MenuDestination } from "@/layout/navItems";
import { menuDestinations } from "@/layout/navItems";
import { useMenuAccess } from "@/modules/permissions/useMenuAccess";
import { cn } from "@/utils";

/** A destination plus its translated labels, which the menu module cannot resolve. */
type ResolvedDestination = MenuDestination & {
  label: string;
  groupLabel: string;
};

/**
 * Split a query into terms, all of which must appear.
 *
 * **AND, not OR.** OR ranks nothing and turns "asset" into every screen in the app,
 * which is the same unreadable pile the sidebar already is. AND narrows as the reader
 * types, so two words isolate one screen — `asset hsse`, or `pos`.
 *
 * Matching runs over label, group **and** path together, so `departments` finds the row
 * labelled "Department" without the label having to spell out its own URL. That is what
 * lets the labels stay readable without costing findability.
 */
function matches(
  destination: ResolvedDestination,
  terms: readonly string[],
): boolean {
  if (terms.length === 0) return true;

  const haystack =
    `${destination.label} ${destination.groupLabel} ${destination.path}`.toLowerCase();

  return terms.every((term) => haystack.includes(term));
}

/**
 * Navigation by typing, over exactly the screens the sidebar draws.
 *
 * ## Why this rather than a link list
 *
 * The header search box was a `<form>` with no `onSubmit`, an input with no state, and a
 * hardcoded `⌘K` badge — a promise repeated on all twelve screens that nothing honoured.
 * The two honest options were to delete it or make it work. This is the second, because a
 * twelve-screen app with no way to jump between screens is a menu users must memorise,
 * and the structure they must memorise is the one carrying every naming problem this
 * review found.
 *
 * ## It cannot offer a screen the reader may not have
 *
 * `menuDestinations` runs the **same** predicate `AppSidebar` renders from — admin, unit
 * and per-person permission, ANDed. That sharing is the whole design: two independent
 * copies would let the palette offer a row the sidebar refuses to draw, and the reader
 * would type a name, get a result, land on a page that refuses to render, and blame the
 * app.
 *
 * ## What it still cannot do
 *
 * It navigates; it does not read data. Typing an asset code finds the Asset IT screen,
 * not the asset. Searching records is a different feature and a different cost —
 * `AssetListPage` already filters its own list, and this deliberately does not pretend
 * to.
 */
export default function CommandPalette({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = useIsAdmin();
  const { access: menuAccess } = useMenuAccess();

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * Where focus was before the palette took it, so closing can put it back.
   *
   * Read at **open** rather than kept in state updated by an effect: an effect storing
   * `document.activeElement` would be a `setState` in an effect body, which the lint rule
   * rejects, and the value only has to exist for the life of one open.
   */
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const destinations = useMemo<ResolvedDestination[]>(
    () =>
      menuDestinations({
        isAdmin,
        readerUnit: profile?.department?.name.trim() ?? null,
        canViewMenu: (key: string) => menuAccess(key).canView,
      }).map((destination) => ({
        ...destination,
        label: destination.labelKey
          ? t(destination.labelKey, { defaultValue: destination.fallbackLabel })
          : destination.fallbackLabel,
        groupLabel: destination.groupLabelKey
          ? t(destination.groupLabelKey, {
              defaultValue: destination.groupFallbackLabel,
            })
          : destination.groupFallbackLabel,
      })),
    [isAdmin, profile?.department?.name, menuAccess, t],
  );

  const terms = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  );

  const results = useMemo(
    () => destinations.filter((destination) => matches(destination, terms)),
    [destinations, terms],
  );

  /**
   * Reset the highlight on every keystroke rather than clamping it afterwards.
   *
   * Clamping would need a `setState` in an effect to notice the list changed length,
   * which is banned outright. Doing it in the handler means "the results just changed"
   * and "the query just changed" are the same event, so there is no render in between
   * where the index points past the end.
   */
  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    setActiveIndex(0);
  }, []);

  const go = useCallback(
    (destination: ResolvedDestination | undefined) => {
      if (!destination) return;
      onClose();
      setQuery("");
      navigate(destination.path);
    },
    [navigate, onClose],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "ArrowDown") {
        // Modulo a positive length, so the index cannot go negative the way
        // `(current - 1 + 0) % 0` would when the list is empty.
        event.preventDefault();
        setActiveIndex((current) =>
          results.length === 0 ? 0 : (current + 1) % results.length,
        );
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) =>
          results.length === 0
            ? 0
            : (current - 1 + results.length) % results.length,
        );
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        go(results[activeIndex]);
      }
    },
    [activeIndex, go, onClose, results],
  );

  /**
   * Take focus on open, and put it back on close.
   *
   * The listbox itself is never focused: the input keeps it and the list is addressed by
   * `aria-activedescendant`, which is the pattern `AssetPicker` already uses for its
   * panel. Moving real focus into the list would need a blur handler to recover from, and
   * a blur handler is how a panel ends up closing on the keystroke meant to filter it.
   */
  useEffect(() => {
    if (!isOpen) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();

    return () => {
      restoreFocusRef.current?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div
      // `items-start` with padding rather than `items-center`: a centred dialog for a
      // dozen rows puts the first result near the vertical middle of the window, which is
      // where nobody looks.
      className="fixed inset-0 z-100 flex items-start justify-center bg-gray-900/50 p-4 pt-[12vh] backdrop-blur-sm dark:bg-gray-900/70"
      onClick={onClose}
      onKeyDown={onKeyDown}
    >
      {/*
        `stopPropagation` on the panel rather than `useClickOutside`, so a click on the
        backdrop element closes and a click anywhere inside — including on a row — cannot
        bubble into a close that fires before the row's own handler navigates.
      */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("commandPalette.title")}
        // Focusable so that clicking the panel's empty space keeps keyboard events
        // inside it. Without this, a click on a non-focusable descendant blurs to
        // `<body>`, `onKeyDown` on the backdrop stops receiving anything, and Escape
        // silently stops working for the rest of the session.
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-lg outline-hidden dark:border-gray-800 dark:bg-gray-dark"
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          placeholder={t("commandPalette.placeholder")}
          aria-label={t("commandPalette.inputLabel")}
          aria-controls="command-palette-results"
          aria-activedescendant={
            results[activeIndex]
              ? `command-palette-option-${activeIndex}`
              : undefined
          }
          autoComplete="off"
          spellCheck={false}
          className="h-14 w-full border-0 border-b border-gray-200 bg-transparent px-5 text-sm text-gray-800 outline-hidden placeholder:text-gray-400 focus:ring-0 dark:border-gray-800 dark:text-white/90 dark:placeholder:text-gray-500"
        />

        <ul
          id="command-palette-results"
          role="listbox"
          aria-label={t("commandPalette.resultsLabel")}
          className="no-scrollbar max-h-80 overflow-y-auto p-2"
        >
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
              {t("commandPalette.empty")}
            </li>
          )}

          {results.map((destination, index) => (
            <Option
              key={destination.path}
              destination={destination}
              index={index}
              isActive={index === activeIndex}
              onSelect={() => go(destination)}
            />
          ))}
        </ul>

        <div className="flex items-center gap-3 border-t border-gray-200 px-5 py-2.5 text-xs text-gray-400 dark:border-gray-800 dark:text-gray-500">
          <Hint keys={t("commandPalette.hintUp")} />
          <Hint keys={t("commandPalette.hintDown")} />
          <Hint keys={t("commandPalette.hintEnter")} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * One result.
 *
 * `onMouseDown` rather than `onClick`, because the input's own blur would otherwise land
 * between the press and the click and the row would never fire. Preventing the default
 * also keeps focus in the input, so the arrow keys still work across a selection.
 */
function Option({
  destination,
  index,
  isActive,
  onSelect,
}: {
  destination: ResolvedDestination;
  index: number;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <li
      id={`command-palette-option-${index}`}
      role="option"
      aria-selected={isActive}
      onMouseDown={(event) => {
        event.preventDefault();
        onSelect();
      }}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3",
        isActive && "bg-gray-100 dark:bg-white/5",
      )}
    >
      <span
        className={cn(
          "shrink-0",
          isActive
            ? "text-brand-500 dark:text-brand-400"
            : "text-gray-400 dark:text-gray-500",
        )}
      >
        {destination.icon}
      </span>

      <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800 dark:text-white/90">
        {destination.label}
      </span>

      {/*
        The group repeats on every row rather than appearing once as a heading. A heading
        per group would need the list split into sections, and the reader typing "asset"
        wants IT and HSSE side by side to tell them apart — grouping them would hide the
        comparison this exists to make easy.
      */}
      <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
        {destination.groupLabel}
      </span>
    </li>
  );
}

function Hint({ keys }: { keys: string }) {
  return (
    <span className="rounded-md border border-gray-200 px-1.5 py-0.5 dark:border-gray-700">
      {keys}
    </span>
  );
}
