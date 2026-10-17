import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import PageMeta from "@/components/common/PageMeta";
import Label from "@/components/form/Label";
import Select from "@/components/form/Select";
import Checkbox from "@/components/form/input/Checkbox";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { useAuth } from "@/context/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import type { Profile } from "@/lib/profiles";
import { getAllUsers } from "@/modules/users/services/userService";

import type { MenuPermissionRow } from "../menuAccess";
import {
  PERMISSION_MENU_KEYS,
  permissionMenuUnit,
  resolveMenuAccess,
} from "../menuAccess";
import type { MenuPermissionInput } from "../services/permissionService";
import {
  NoRowsWrittenError,
  UnknownMenuKeyError,
  getAllPermissions,
  savePermissionsForUser,
} from "../services/permissionService";

/** The three flags as this page edits them, keyed by menu. */
type DraftAccess = Record<string, MenuPermissionInput>;

const NO_KEYS_SELECTED = "";

/**
 * Admin-only per-person menu access.
 *
 * ## Why this is its own module rather than a tab on the user list
 *
 * `users` is account management: who exists, what their role is, and how their
 * credential is reset. This is a different question — *which screens is this one person
 * allowed in* — and it is the only place in the app where a staff member's reach is a
 * row rather than a role. Folding it into `UserListPage` would put six checkboxes beside
 * a password-reset form and make both harder to read than either is now.
 *
 * ## The one thing an operator must understand before saving
 *
 * **An unticked box is not the default.** Because a person with no rows is granted the
 * menus they can already reach (see `ABSENT_ROW_GRANTS_EVERYTHING`), this table is an
 * *override* list, not a grant list. Ticking a box narrows somebody; clearing every box
 * for a menu **restores** their current access rather than removing it.
 *
 * That is the reason the header carries the `notConfigured` badge and the page says so
 * in a sentence rather than leaving it to be inferred. The alternative — default-deny —
 * would have made this table read the obvious way at the cost of silently stripping
 * every existing staff member of every menu the day the migration landed.
 *
 * ## What this screen cannot do
 *
 * It cannot widen anyone. `assets_write_admin`, `profiles_select_own_or_admin` and the
 * rest are unchanged, the four menu keys are a closed set with no admin-only menu among
 * them, and the two asset rows stay ANDed with the reader's own department. A row here
 * hides; it does not unlock.
 */
export default function PermissionListPage() {
  const { t } = useTranslation("common", { keyPrefix: "permissions" });
  /**
   * A second handle for the sidebar's own labels.
   *
   * `t` above is pinned to the `permissions` prefix, so `t("sidebar.items.assetIt")`
   * would resolve to `permissions.sidebar.items.assetIt` and find nothing. Every
   * `keyPrefix` scopes *all* of its lookups, which is the same trap as passing a key
   * path as the namespace argument.
   */
  const { t: tGlobal } = useTranslation();
  const { isProfileLoading } = useAuth();
  const isAdmin = useIsAdmin();

  const [people, setPeople] = useState<Profile[]>([]);
  const [overrides, setOverrides] = useState<Map<string, MenuPermissionRow[]>>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState(true);
  /**
   * Which read failed, or `null` for none.
   *
   * A string rather than a boolean because the two failures need different sentences:
   * a missing `user_menu_permissions` is an unapplied migration, and a missing
   * `profiles` read is an access or session problem. One flag for both would send the
   * operator to the wrong table.
   */
  const [loadFailed, setLoadFailed] = useState<
    "accounts" | "permissions" | null
  >(null);

  const [selectedId, setSelectedId] = useState(NO_KEYS_SELECTED);
  const [draft, setDraft] = useState<DraftAccess>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(false);

  /**
   * Both reads at once, so the screen has one loading state rather than two resolving
   * at different moments.
   *
   * **`allSettled`, not `all`.** `Promise.all` collapses two independent failures into
   * one undifferentiated message, and this screen is exactly where that hurts: a `404`
   * on `user_menu_permissions` means the migration has not been applied to the database
   * yet, while a failure on `getAllUsers` means something else entirely — and "the
   * accounts or their menu access could not be loaded" names neither, so the operator is
   * left guessing which table to go and look at. The failing one is named instead.
   *
   * Every `setState` is inside a promise callback, never in the body: the effect that
   * calls this cannot reset state synchronously without a cascading render, and the
   * initial `isLoading: true` already covers the only call site.
   */
  const load = useCallback(() => {
    void Promise.allSettled([getAllUsers(), getAllPermissions()]).then(
      ([usersResult, permissionsResult]) => {
        // `null` from the permissions read is the failure case, kept distinct from an
        // empty `Map` so the screen can say "the overrides could not be read" rather
        // than "nobody is configured yet" — opposite instructions, and only one of them
        // is worth retrying.
        if (permissionsResult.status === "rejected") {
          setLoadFailed("permissions");
          setIsLoading(false);
          return;
        }
        if (permissionsResult.value === null) {
          setLoadFailed("permissions");
          setIsLoading(false);
          return;
        }
        if (usersResult.status === "rejected") {
          setLoadFailed("accounts");
          setIsLoading(false);
          return;
        }

        setPeople(usersResult.value);
        setOverrides(permissionsResult.value);
        setIsLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    // Gated on the profile so a non-admin never issues the read `profiles_select_own_or_admin`
    // would answer with a single row. Same reason `/users` checks before it calls
    // `getAllUsers`, and the same reason that call is not a security boundary.
    if (isProfileLoading || !isAdmin) return;
    load();
  }, [isProfileLoading, isAdmin, load]);

  /** Only staff accounts. An admin's rows are never consulted, so offering one is noise. */
  const selectablePeople = useMemo(
    () => people.filter((person) => person.role === "staff"),
    [people],
  );

  const selected = useMemo(
    () => selectablePeople.find((person) => person.id === selectedId) ?? null,
    [selectablePeople, selectedId],
  );

  /**
   * Seed the draft from what is stored, resolving through the shared rule rather than
   * reading the flags directly.
   *
   * Going through `resolveMenuAccess` means the screen shows the same answer the sidebar
   * will show, including the fallback for a menu with no row — so an unconfigured menu
   * shows its real current access, which is what makes the override legible.
   */
  const seedDraft = useCallback(
    (person: Profile) => {
      const stored = overrides.get(person.id) ?? [];
      const access = resolveMenuAccess(stored);

      const seeded: DraftAccess = {};
      for (const key of PERMISSION_MENU_KEYS) {
        const current = access(key);
        seeded[key] = {
          menuKey: key,
          canView: current.canView,
          canEdit: current.canEdit,
          canDelete: current.canDelete,
        };
      }
      setDraft(seeded);
      setSaveError(null);
      setSavedAt(false);
    },
    [overrides],
  );

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      const person = selectablePeople.find((entry) => entry.id === id);
      if (person) seedDraft(person);
    },
    [selectablePeople, seedDraft],
  );

  /**
   * Cascade the three boxes.
   *
   * `can_edit` and `can_delete` both imply `can_view` in the database — the two check
   * constraints added by `03500` — so ticking one here has to tick the other, or the
   * save fails with `23514` on a constraint name and the whole upsert rolls back, taking
   * every valid row in the same statement with it.
   *
   * Unticking view unticks both, because there is nothing to edit on a screen the reader
   * cannot open.
   */
  const toggle = useCallback(
    (
      menuKey: string,
      flag: "canView" | "canEdit" | "canDelete",
      value: boolean,
    ) => {
      setSavedAt(false);
      setDraft((prev) => {
        const current = prev[menuKey];
        if (!current) return prev;

        const next: MenuPermissionInput = { ...current };
        if (flag === "canView") {
          next.canView = value;
          if (!value) {
            next.canEdit = false;
            next.canDelete = false;
          }
        } else if (flag === "canEdit") {
          next.canEdit = value;
          if (value) next.canView = true;
        } else {
          next.canDelete = value;
          if (value) next.canView = true;
        }
        return { ...prev, [menuKey]: next };
      });
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!selected) return;
    setIsSaving(true);
    setSaveError(null);
    setSavedAt(false);

    try {
      const granted = Object.values(draft).filter(
        (input) => input.canView || input.canEdit || input.canDelete,
      );

      // Only genuinely-overridden menus are sent. A menu left at its resolved value
      // carries no information, and writing it would pin today's fallback into the
      // database — so flipping `ABSENT_ROW_GRANTS_EVERYTHING` later would not move it.
      // A menu that differs from the fallback is pinned deliberately; that is what
      // unticking is.
      const baseline = resolveMenuAccess([]);
      const changed = granted.filter((input) => {
        const before = baseline(input.menuKey);
        return (
          input.canView !== before.canView ||
          input.canEdit !== before.canEdit ||
          input.canDelete !== before.canDelete
        );
      });

      const written = await savePermissionsForUser(selected.id, changed);

      // Re-seed from the response rather than from the draft: the server is the
      // authority on what exists, and `savePermissionsForUser` may have written fewer
      // rows than were sent if a key collapsed.
      setOverrides((prev) => {
        const next = new Map(prev);
        next.set(selected.id, written);
        return next;
      });
      setSavedAt(true);
    } catch (error) {
      setSaveError(describeSaveError(error));
    } finally {
      setIsSaving(false);
    }
  }, [draft, selected]);

  const selectedDepartment = selected?.departmentName ?? null;
  const isSelectedConfigured =
    selected !== null && (overrides.get(selected.id)?.length ?? 0) > 0;

  if (isProfileLoading) {
    return (
      <div>
        <PageMeta
          title={`${t("pageTitle")} | Asset Management App`}
          description={t("pageDescription")}
        />
        <PageBreadcrumb pageTitle={t("pageTitle")} />
        <Panel>{t("checkingAccess")}</Panel>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div>
        <PageMeta
          title={`${t("pageTitle")} | Asset Management App`}
          description={t("pageDescription")}
        />
        <PageBreadcrumb pageTitle={t("pageTitle")} />
        <Panel>{t("noAccess")}</Panel>
      </div>
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
        <p>{t("howItWorks")}</p>
      </div>

      {isLoading && <Panel>{t("loading")}</Panel>}

      {!isLoading && loadFailed !== null && (
        <Panel>
          {loadFailed === "permissions"
            ? t("loadFailedPermissions")
            : t("loadFailedAccounts")}
        </Panel>
      )}

      {!isLoading && loadFailed === null && selectablePeople.length === 0 && (
        <Panel>{t("noStaffAccounts")}</Panel>
      )}

      {!isLoading && loadFailed === null && selectablePeople.length > 0 && (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 sm:items-end">
            <div>
              <Label htmlFor="permission-person">{t("personLabel")}</Label>
              {/* Keyed on the current selection: `Select` reads `defaultValue` once
                  and holds it internally, so without the key it would keep showing the
                  first person after the admin picked another. */}
              <Select
                key={selectedId}
                id="permission-person"
                options={selectablePeople.map((person) => ({
                  value: person.id,
                  label: person.full_name ?? person.email ?? person.id,
                }))}
                placeholder={t("choosePerson")}
                defaultValue={selectedId}
                onChange={handleSelect}
              />
            </div>

            {selected && (
              <div className="flex items-center gap-3 sm:justify-end">
                {isSelectedConfigured ? (
                  <Badge color="info" size="sm">
                    {t("configured", {
                      count: overrides.get(selected.id)?.length ?? 0,
                    })}
                  </Badge>
                ) : (
                  <Badge color="light" size="sm">
                    {t("notConfigured")}
                  </Badge>
                )}
                <Button
                  onClick={handleSave}
                  disabled={isSaving || !selected}
                  className="shrink-0"
                >
                  {isSaving ? t("saving") : t("save")}
                </Button>
              </div>
            )}
          </div>

          {selected && (
            <>
              <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                {selectedDepartment
                  ? t("selectedDepartment", {
                      name: selectedDepartment,
                      email: selected.email ?? "—",
                    })
                  : t("selectedNoDepartment", { email: selected.email ?? "—" })}
              </p>

              {savedAt && !saveError && (
                <p
                  role="status"
                  className="mt-4 rounded-2xl border border-success-200 bg-success-50 p-4 text-sm text-success-700 dark:border-success-800/60 dark:bg-success-500/10 dark:text-green-300"
                >
                  {t("saved")}
                </p>
              )}

              {saveError && (
                <p
                  role="alert"
                  className="mt-4 rounded-2xl border border-error-200 bg-error-50 p-4 text-sm text-error-700 dark:border-error-800/60 dark:bg-error-500/10 dark:text-red-300"
                >
                  {saveError}
                </p>
              )}

              <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
                <div className="hidden grid-cols-[1fr_auto_auto_auto] items-center gap-6 border-b border-gray-200 bg-gray-50 px-5 py-3 text-xs font-semibold tracking-wide text-gray-500 uppercase sm:grid dark:border-gray-800 dark:bg-white/3 dark:text-gray-400">
                  <span>{t("columnMenu")}</span>
                  <span className="w-20 text-center">{t("columnView")}</span>
                  <span className="w-20 text-center">{t("columnEdit")}</span>
                  <span className="w-20 text-center">{t("columnDelete")}</span>
                </div>

                {PERMISSION_MENU_KEYS.map((menuKey) => {
                  const row = draft[menuKey];
                  if (!row) return null;

                  // The unit the menu is scoped to, and the reader's own. A grant
                  // outside their unit is inert: the sidebar ANDs the two and the
                  // database refuses the read anyway, so saving it would look granted
                  // and do nothing. Said here, where the operator can act on it.
                  const unit = permissionMenuUnit(menuKey);
                  const isUnitMismatch =
                    unit !== null &&
                    selectedDepartment !== null &&
                    unit !== selectedDepartment;

                  return (
                    <div
                      key={menuKey}
                      className="grid grid-cols-1 items-center gap-4 border-b border-gray-200 px-5 py-4 last:border-b-0 sm:grid-cols-[1fr_auto_auto_auto] sm:gap-6 dark:border-gray-800"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                          {tGlobal(`sidebar.items.${menuKey}`)}
                        </p>
                        {isUnitMismatch && (
                          <p className="mt-1 text-xs text-warning-600 dark:text-orange-400">
                            {t("unitMismatch", {
                              unit,
                              department: selectedDepartment,
                            })}
                          </p>
                        )}
                      </div>

                      {/*
                        Labels are visible rather than screen-reader-only, because
                        `Checkbox` has no `aria-label` and no children: its `label` prop
                        is the only thing that names the input. Hiding it with `sr-only`
                        would leave a `<label>` whose text is in the accessible name but
                        not on screen — which is fine for a screen reader and useless for
                        everyone looking at a three-column matrix, where the column
                        headers do not line up with these cells on a phone.
                      */}
                      <div className="flex flex-wrap gap-6 sm:gap-0">
                        <div className="flex w-28 justify-start sm:w-20 sm:justify-center">
                          <Checkbox
                            id={`perm-${menuKey}-view`}
                            label={t("columnView")}
                            checked={row.canView}
                            onChange={(value) =>
                              toggle(menuKey, "canView", value)
                            }
                          />
                        </div>
                        <div className="flex w-28 justify-start sm:w-20 sm:justify-center">
                          <Checkbox
                            id={`perm-${menuKey}-edit`}
                            label={t("columnEdit")}
                            checked={row.canEdit}
                            disabled={!row.canView}
                            onChange={(value) =>
                              toggle(menuKey, "canEdit", value)
                            }
                          />
                        </div>
                        <div className="flex w-28 justify-start sm:w-20 sm:justify-center">
                          <Checkbox
                            id={`perm-${menuKey}-delete`}
                            label={t("columnDelete")}
                            checked={row.canDelete}
                            disabled={!row.canView}
                            onChange={(value) =>
                              toggle(menuKey, "canDelete", value)
                            }
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
                {t("notAnAccessControl")}
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Map a save failure onto something an operator can act on.
 *
 * `UnknownMenuKeyError` and `NoRowsWrittenError` get their own sentences because they
 * mean different things and only one of them is a retry. Anything else is passed through
 * as its own message: this is a service-layer error from Supabase, not an `AuthError`,
 * so `authErrors.ts` does not cover it and inventing a generic sentence would throw away
 * the code that identifies it.
 */
function describeSaveError(error: unknown): string {
  if (error instanceof UnknownMenuKeyError) {
    return `Unknown menu key: ${error.keys}`;
  }
  if (error instanceof NoRowsWrittenError) {
    return "The database refused the write and no row was saved.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong while saving.";
}

/** Shared bordered surface for the states that carry no table. */
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500 dark:border-gray-800 dark:bg-white/3 dark:text-gray-400">
      {children}
    </div>
  );
}
