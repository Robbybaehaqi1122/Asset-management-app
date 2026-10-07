import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useClickOutside } from "@/hooks/useClickOutside";

/**
 * One row in the picker's list.
 *
 * **More than a single string, which is why the `MultiSelect` primitive does not
 * fit here.** That primitive renders one `text` per option, so an asset would have
 * to arrive as `"2609110103 — HP ProDesk 4 — New"` in one line: the three facts
 * squashed together, and the parts an admin scans for — the code, mostly — no
 * longer aligned in a column. This shape keeps them in columns.
 */
export type AssetPickerOption = {
  value: string;
  /** The asset code. The primary fact and the one the search matches first. */
  code: string;
  /** The asset's name. The longest text, so it gets the flexible column. */
  name: string;
  /** The asset's own condition, pre-translated by the caller. */
  conditionLabel: string;
  /**
   * Anything else worth showing but not worth a column of its own — a serial
   * number, say.
   *
   * Rendered as a muted line under the name rather than as a fourth column,
   * because the list is already three columns wide and this is the fact an admin
   * reads only when the code is not enough.
   */
  secondary?: string;
};

export type AssetPickerProps = {
  options: AssetPickerOption[];
  /** Selected values, in the order they were picked. */
  value: string[];
  onChange: (next: string[]) => void;
  /** Renders the caller's `Label`, already linked to this control's id. */
  label: ReactNode;
  placeholder?: string;
  searchPlaceholder?: string;
  /** Text under the control: what is selected, and what selecting means. */
  hint?: string;
  disabled?: boolean;
  /** Omitted entirely when false, so the row never shows a dead control. */
  onClear?: () => void;
  onSelectAll?: () => void;
  className?: string;
  /**
   * Keys the **search text** so it resets when the caller remounts this.
   *
   * The reason `Select` and `Switch` need a `key` in this codebase is that they
   * read their value once and never see a change from outside. This component is
   * controlled, so the selected list follows `value` — but the search box is local
   * state, and a search left over from a previous asset would show a list filtered
   * by a term nobody typed. Keying it on whatever the caller bumps per open (the
   * handover form already has `formToken`) resets it with everything else.
   */
  resetKey?: string | number;
};

/**
 * A searchable multi-select that renders its options as rows rather than one line
 * each, with the dropdown panel as wide as the control.
 *
 * ## Why not `MultiSelect`
 *
 * It is one of the 13 retained primitives and it is not deleted for want of a
 * consumer — but it does not fit this field, for two reasons that are both about
 * shape rather than quality:
 *
 * 1. **It has no search.** This list is every available asset in the unit, which
 *    is the case that prompted the change: a few dozen rows scrolling inside a
 *    modal is a long way to find one code.
 * 2. **One `text` per option.** See `AssetPickerOption` for what that costs.
 *
 * It also renders its own `<label>` from a string prop, which cannot be tied to the
 * form's own `Label` the way every other field in these forms is — which is what
 * produced the `for`-matches-nothing warning this replaced.
 *
 * ## The label, and the warning it removes
 *
 * The label is **not** rendered here. The caller passes a `Label` with
 * `htmlFor={inputId}`, where `inputId` is this control's generated id, and this
 * control puts that id on a real `<input>` that receives focus when the panel opens.
 * A previous version used `<Label htmlFor="handover-assets-label">` against a
 * `role="group"` div — which is not a labelable element, so the `for` matched
 * nothing and Chrome reported it. Pointing `for` at a real input fixes it rather
 * than silencing it.
 *
 * ## Keyboard
 *
 * Arrow keys move an active row, Enter toggles it, Escape closes, and the active row
 * is scrolled into view. `aria-activedescendant` points at it rather than moving
 * focus, so focus stays in the search box and typing keeps working — moving real
 * focus into the listbox would mean a blur handler to recover from, which is how
 * the panel ends up closing on the keystroke that was meant to filter it.
 */
export default function AssetPicker({
  options,
  value,
  onChange,
  label,
  placeholder,
  searchPlaceholder,
  hint,
  disabled = false,
  onClear,
  onSelectAll,
  className = "",
  resetKey,
}: AssetPickerProps) {
  const { t } = useTranslation("common", { keyPrefix: "handover" });

  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // One id per instance from `useId`, so two pickers on one screen cannot collide
  // on a hardcoded string — which is the other half of why the old label broke.
  const generatedId = useId();
  const inputId = `asset-picker-${generatedId}`;
  const listboxId = `${inputId}-listbox`;

  useClickOutside(containerRef, () => setIsOpen(false), isOpen);

  // The search text is keyed by `resetKey` so a new open starts from empty.
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    setSearch("");
    setActiveIndex(-1);
  }

  /**
   * The filter, on **code and name**.
   *
   * Both, case-insensitively, and both matched as substrings rather than prefixes so
   * an admin can paste the middle of a code. The condition is deliberately **not**
   * searched: it is a closed set of five words and matching it would surface every
   * `new` laptop when somebody typed "new" into a search box looking for a name.
   */
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return options;
    return options.filter(
      (option) =>
        option.code.toLowerCase().includes(needle) ||
        option.name.toLowerCase().includes(needle),
    );
  }, [options, search]);

  const selected = useMemo(
    () =>
      value
        .map((id) => options.find((option) => option.value === id))
        .filter((option): option is AssetPickerOption => option !== undefined),
    [value, options],
  );

  // Both of these are in their own `useCallback` rather than inline, because
  // `toggle` below is memoised and an inline `isSelected` would make its dependency
  // list change on every render — which is the warning eslint raises here and, more
  // to the point, makes the memoisation pointless.
  const isSelected = useCallback((id: string) => value.includes(id), [value]);

  const toggle = useCallback(
    (id: string) => {
      onChange(
        value.includes(id) ? value.filter((v) => v !== id) : [...value, id],
      );
    },
    [onChange, value],
  );

  // Keeps the highlighted row in view as the arrow keys move through a long list.
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const node = listRef.current.children[activeIndex] as
      HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const open = () => {
    if (disabled) return;
    setIsOpen((prev) => {
      const next = !prev;
      // The input receives focus on open, so the admin can type a code straight
      // away rather than clicking a field first.
      if (next) {
        window.setTimeout(() => inputRef.current?.focus(), 0);
      } else {
        setSearch("");
        setActiveIndex(-1);
      }
      return next;
    });
  };

  /**
   * Enter toggles the highlighted row **without closing** the panel.
   *
   * That is the whole reason a multi-select needs this: picking three assets should
   * be three Enters, not three Enters and three reopens. Closing on each would make
   * the dropdown strictly worse than the checkbox list it replaces.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((prev) =>
          filtered.length === 0
            ? -1
            : prev < filtered.length - 1
              ? prev + 1
              : 0,
        );
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((prev) =>
          filtered.length === 0
            ? -1
            : prev > 0
              ? prev - 1
              : filtered.length - 1,
        );
        break;
      case "Enter":
        event.preventDefault();
        if (activeIndex >= 0 && activeIndex < filtered.length) {
          toggle(filtered[activeIndex].value);
          setActiveIndex(-1);
        }
        break;
      case "Escape":
        event.preventDefault();
        setIsOpen(false);
        setSearch("");
        setActiveIndex(-1);
        break;
      case "Home":
        if (isOpen) {
          event.preventDefault();
          setActiveIndex(0);
        }
        break;
      case "End":
        if (isOpen) {
          event.preventDefault();
          setActiveIndex(filtered.length - 1);
        }
        break;
    }
  };

  const everythingSelected =
    options.length > 0 && options.every((option) => isSelected(option.value));

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        {label}
        {/* Both buttons are absent rather than disabled when there is nothing to
            act on, and "Select all" only appears once something is ticked — with
            nothing ticked it and "Clear" are the same action. */}
        {onSelectAll &&
          (everythingSelected ? (
            <button
              type="button"
              onClick={onClear}
              className="shrink-0 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              {t("fields.assetsClearAll")}
            </button>
          ) : selected.length > 0 ? (
            <button
              type="button"
              onClick={onSelectAll}
              className="shrink-0 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
            >
              {t("fields.assetsSelectAll")}
            </button>
          ) : null)}
      </div>

      <div ref={containerRef} className="relative mt-1">
        <button
          type="button"
          id={inputId}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          disabled={disabled}
          onClick={open}
          className={`flex min-h-11 w-full items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-start text-sm shadow-theme-xs transition focus:border-brand-300 focus:shadow-focus-ring disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:focus:border-brand-300 ${
            selected.length === 0
              ? "text-gray-400"
              : "text-gray-800 dark:text-white/90"
          }`}
        >
          <span className="min-w-0 flex-1 truncate">
            {selected.length === 0
              ? (placeholder ?? t("fields.assetsPlaceholder"))
              : selected.map((option) => option.code).join(", ")}
          </span>
          {selected.length > 0 && (
            <span className="shrink-0 rounded-full bg-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200">
              {selected.length}
            </span>
          )}
          <svg
            className={`pointer-events-none size-5 shrink-0 text-gray-700 transition-transform dark:text-gray-400 ${
              isOpen ? "rotate-180" : ""
            }`}
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M4.79175 7.39551L10.0001 12.6038L15.2084 7.39551"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {isOpen && (
          <div
            className="absolute inset-x-0 top-full z-40 mt-1 rounded-lg border border-gray-200 bg-white shadow-theme-lg dark:border-gray-800 dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            {/* The search box. It is inside the panel rather than in the trigger so
                the trigger can stay one line tall, and it autofocuses on open. */}
            <div className="border-b border-gray-200 p-2 dark:border-gray-800">
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setActiveIndex(-1);
                }}
                onKeyDown={onKeyDown}
                placeholder={
                  searchPlaceholder ?? t("fields.assetsSearchPlaceholder")
                }
                aria-label={t("fields.assetsSearchLabel")}
                aria-controls={listboxId}
                aria-activedescendant={
                  activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined
                }
                autoComplete="off"
                className="h-9 w-full rounded-md border border-gray-300 px-2.5 text-sm text-gray-800 outline-hidden focus:border-brand-300 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:focus:border-brand-300"
              />
            </div>

            {/* Column headings, because the three facts are scanned by position and
                an unlabelled column is a column nobody can read quickly. Hidden from
                assistive tech: the row itself carries the same three facts as its
                accessible name, so announcing them twice is noise. */}
            <div
              aria-hidden="true"
              className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] gap-3 border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-500 dark:border-gray-800 dark:bg-white/5 dark:text-gray-400"
            >
              <span>{t("fields.assetsColCode")}</span>
              <span>{t("fields.assetsColName")}</span>
              <span>{t("fields.assetsColCondition")}</span>
            </div>

            <ul
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-multiselectable="true"
              className="max-h-64 overflow-y-auto py-1"
            >
              {filtered.length === 0 ? (
                <li className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                  {t("fields.assetsNoMatch", { search })}
                </li>
              ) : (
                filtered.map((option, index) => {
                  const active = index === activeIndex;
                  const picked = isSelected(option.value);
                  return (
                    <li
                      key={option.value}
                      id={`${listboxId}-${index}`}
                      role="option"
                      aria-selected={picked}
                      onClick={() => toggle(option.value)}
                      className={`grid cursor-pointer grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-start gap-3 px-3 py-2 ${
                        active ? "bg-gray-50 dark:bg-white/5" : ""
                      } ${picked ? "bg-brand-50/60 dark:bg-brand-900/20" : ""}`}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800 dark:text-white/90">
                        {/* A check glyph rather than a checkbox input, because a
                            real `<input type=checkbox>` inside a `role="option"`
                            row is two interactive controls per row — the screen
                            reader announces both, and the space key toggles one
                            while Enter toggles the other. */}
                        <span
                          aria-hidden="true"
                          className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                            picked
                              ? "border-brand-500 bg-brand-500 text-white"
                              : "border-gray-300 dark:border-gray-600"
                          }`}
                        >
                          {picked && (
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 12 12"
                              fill="none"
                            >
                              <path
                                d="M2.5 6.2L4.8 8.5L9.5 3.5"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </span>
                        <span className="truncate">{option.code}</span>
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-gray-800 dark:text-white/90">
                          {option.name}
                        </span>
                        {option.secondary && (
                          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                            {option.secondary}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                        {option.conditionLabel}
                      </span>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        )}
      </div>

      {hint && (
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          {hint}
        </p>
      )}
    </div>
  );
}
