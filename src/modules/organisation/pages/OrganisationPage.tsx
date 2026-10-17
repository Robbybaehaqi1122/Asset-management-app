import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import PageMeta from "@/components/common/PageMeta";
import { useAuth } from "@/context/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { cn } from "@/utils";

import ReferenceListPanel from "../components/ReferenceListPanel";
import { ORGANISATION_LISTS } from "../organisationSpecs";

/**
 * Departments, positions and companies on one screen.
 *
 * ## Why these three are together
 *
 * They were three separate pages under a "User Management" group that did not contain
 * them: **nothing that is about an account reads any of the three.** `profiles` reads
 * `department_id` and nothing else, while positions and companies are read only by the
 * handover roster form under Reference Data — and a company's name is printed on the
 * handover document itself, in the issuer's signature block and the recipient's parties
 * block. So the two lists that had nothing to do with logins sat beside the one screen
 * whose whole subject is logins, and the screen where you *use* a list was a different
 * screen from the one that *held* it.
 *
 * One entry fixes that, and it costs one row in the menu instead of three.
 *
 * ## The tab counts are the point
 *
 * All three lists are small — a handful of departments, a dozen positions, two
 * companies — and the question an admin actually arrives with is "is this filled in
 * yet?". A count on the tab label answers that without switching tabs, which is the
 * difference between a grouped screen and three separate pages.
 *
 * **Which means all three are read up front**, not lazily per tab. Three small reads on a
 * screen nobody visits often is the right trade for never showing an empty list without
 * saying whether it is empty or unread.
 *
 * ## The panel is mounted for the active tab only
 *
 * Each tab's panel owns a load and two modals, so keeping the other two mounted would
 * mean three loads on the page and three sets of state alive behind a hidden tab. The
 * count comes from the parent, which is why the parent reads rather than the panels.
 *
 * ## Not a route guard
 *
 * Admin-only, gated on `useIsAdmin()` inside the page, exactly like `/users` was — RLS
 * is the boundary and this only keeps a control a staff member cannot use off their
 * screen. The old `/departments`, `/positions` and `/companies` routes redirect here
 * rather than 404, so a bookmark or a shared link still lands somewhere real.
 */
export default function OrganisationPage() {
  const { t } = useTranslation("common", { keyPrefix: "organisation" });
  /**
   * A second handle for the sidebar's own labels.
   *
   * **`t` above cannot read them.** `keyPrefix: "organisation"` prefixes *every* lookup
   * this handle makes, so `t("sidebar.items.department")` resolves to
   * `organisation.sidebar.items.department`, finds nothing, and i18next prints the raw key
   * path — which is exactly what it did: three tabs reading
   * `organisation.sidebar.items.position`. It compiles, it throws nothing, and it is the
   * same trap this codebase documents for passing a key path as the namespace argument,
   * one level up.
   *
   * The panel got this right by having no `keyPrefix` at all and building
   * `${spec.keyPrefix}.…`; the shell did it wrong. Two spellings of the same mistake in
   * one feature is the argument for not reading keys from a shared string field.
   */
  const { t: tGlobal } = useTranslation();
  const { isProfileLoading } = useAuth();
  const isAdmin = useIsAdmin();

  /**
   * The active tab, by the spec's `keyPrefix` rather than by index.
   *
   * By key and not by index so the count lookup, the panel id and the tab id all use one
   * value; an index would drift the moment the draw order changes.
   */
  const [activeKey, setActiveKey] = useState<string>(
    ORGANISATION_LISTS[0].keyPrefix,
  );
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const active = useMemo(
    () =>
      ORGANISATION_LISTS.find((spec) => spec.keyPrefix === activeKey) ??
      ORGANISATION_LISTS[0],
    [activeKey],
  );

  /**
   * Load all three counts.
   *
   * `allSettled` rather than `Promise.all`, so one failed list leaves the other two
   * answering instead of blanking the whole screen — and a list that failed shows no
   * count rather than a `0`, because "0 departments" and "we could not read
   * departments" are opposite statements.
   */
  const loadCounts = useCallback(() => {
    void Promise.allSettled(ORGANISATION_LISTS.map((spec) => spec.list())).then(
      (results) => {
        const next: Record<string, number> = {};
        results.forEach((result, index) => {
          const spec = ORGANISATION_LISTS[index];
          if (result.status === "fulfilled")
            next[spec.keyPrefix] = result.value.length;
        });
        setCounts(next);
      },
    );
  }, []);

  useEffect(() => {
    if (isProfileLoading || !isAdmin) return;
    loadCounts();
  }, [isProfileLoading, isAdmin, loadCounts]);

  /**
   * After any write, bump the token: the active panel reloads and the counts follow.
   *
   * One counter rather than two because "the row I just added" and "the count that just
   * went up by one" are the same event, and two `setState` calls here would let the tab
   * label and the list disagree for a frame.
   */
  const handleChanged = useCallback(() => {
    setReloadToken((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (reloadToken === 0) return;
    loadCounts();
  }, [reloadToken, loadCounts]);

  if (isProfileLoading) {
    return (
      <Frame>
        <Panel>{t("checkingAccess")}</Panel>
      </Frame>
    );
  }

  if (!isAdmin) {
    return (
      <Frame>
        <Panel>{t("noAccess")}</Panel>
      </Frame>
    );
  }

  return (
    <div>
      <PageMeta
        title={`${t("pageTitle")} | Asset Management App`}
        description={t("pageDescription")}
      />
      <PageBreadcrumb pageTitle={t("pageTitle")} />

      <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500 dark:border-gray-800 dark:bg-white/3 dark:text-gray-400">
        {t("intro")}
      </div>

      <div
        role="tablist"
        aria-label={t("tabsLabel")}
        className="mt-6 flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-800"
      >
        {ORGANISATION_LISTS.map((spec) => {
          const selected = spec.keyPrefix === active.keyPrefix;
          const count = counts?.[spec.keyPrefix];

          return (
            <button
              key={spec.keyPrefix}
              type="button"
              role="tab"
              id={`organisation-tab-${spec.keyPrefix}`}
              aria-selected={selected}
              aria-controls={`organisation-panel-${spec.keyPrefix}`}
              // Roving arrow keys, so the strip is one tab stop rather than three —
              // which is what makes it usable rather than merely correct.
              tabIndex={selected ? 0 : -1}
              onKeyDown={(event) => {
                const index = ORGANISATION_LISTS.findIndex(
                  (entry) => entry.keyPrefix === spec.keyPrefix,
                );
                const step =
                  event.key === "ArrowRight"
                    ? 1
                    : event.key === "ArrowLeft"
                      ? -1
                      : 0;
                if (step === 0) return;
                event.preventDefault();
                const next =
                  ORGANISATION_LISTS[
                    (index + step + ORGANISATION_LISTS.length) %
                      ORGANISATION_LISTS.length
                  ];
                setActiveKey(next.keyPrefix);
                document
                  .getElementById(`organisation-tab-${next.keyPrefix}`)
                  ?.focus();
              }}
              onClick={() => setActiveKey(spec.keyPrefix)}
              className={cn(
                "-mb-px flex min-w-0 items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                // Equal thirds below `sm`, natural width above it.
                //
                // **`flex-wrap` was the bug.** Three tabs at ~120px each do not fit a
                // 375px screen, so they wrapped onto two lines and the strip stopped
                // looking like a tab strip. `flex-1 sm:flex-none` shares the row evenly
                // on a phone and restores natural widths on a desktop, where stretching
                // three short words across 1200px would look worse than the wrap did.
                "flex-1 sm:flex-none",
                selected
                  ? "border-brand-500 text-brand-600 dark:text-brand-400"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200",
              )}
            >
              {/*
                `truncate` on the label, so the count is what gives way on a narrow
                screen rather than the word the reader is looking for.
              */}
              <span className="truncate">{tGlobal(spec.tabLabelKey)}</span>

              {/*
                The count, or nothing at all while it is unread.

                **Never a `0` for a failed read.** `0` is a claim about the data and a
                failed read is a claim about the connection; showing the first for the
                second is exactly the "empty state that lies" shape this codebase keeps
                recording. A blank here reads as "not counted yet" and is true.

                `text-xs` was too quiet to be information — the whole reason this count
                exists is to be readable without switching tabs, and at 12px in
                `gray-400` it was not.
              */}
              {count !== undefined && (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                    selected
                      ? "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"
                      : "bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`organisation-panel-${active.keyPrefix}`}
        aria-labelledby={`organisation-tab-${active.keyPrefix}`}
        className="mt-6"
      >
        {/*
          Keyed on the spec so switching tabs unmounts the previous panel. Without it the
          panel component would keep the previous list's rows, modals and pending delete
          on screen while claiming to show a different list.
        */}
        <ReferenceListPanel
          key={active.keyPrefix}
          spec={active}
          reloadToken={reloadToken}
          onChanged={handleChanged}
        />
      </div>
    </div>
  );
}

/** Page chrome, so the loading and refusal states are not three copies of it. */
function Frame({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation("common", { keyPrefix: "organisation" });
  return (
    <div>
      <PageMeta
        title={`${t("pageTitle")} | Asset Management App`}
        description={t("pageDescription")}
      />
      <PageBreadcrumb pageTitle={t("pageTitle")} />
      {children}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500 dark:border-gray-800 dark:bg-white/3 dark:text-gray-400">
      {children}
    </div>
  );
}
