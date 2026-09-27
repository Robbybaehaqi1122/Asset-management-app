import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import PageMeta from "@/components/common/PageMeta";
import Select from "@/components/form/Select";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/context/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useModal } from "@/hooks/useModal";
import { PlusIcon } from "@/icons";
import type { Profile, ProfileRole } from "@/lib/profiles";

import {
  getAllUsers,
  isLastAdminError,
  updateUserRole,
} from "../services/userService";

/** A role change waiting for confirmation, plus who it is for. */
type PendingChange = {
  userId: string;
  name: string;
  nextRole: ProfileRole;
};

/**
 * Admin-only user list: who exists, what their role is, and a way to change
 * it.
 *
 * What this screen deliberately does not have: create and delete. Both need
 * `supabase.auth.admin`, which needs a `service_role` key, and `AGENTS.md`
 * forbids putting one in the browser. Accounts are still created from the
 * Supabase Dashboard, and the `on_auth_user_created` trigger builds their
 * profile either way. Delete is not merely a missing button: `assignments`
 * cascades on `profiles`, so removing a profile would erase that person's
 * loan history and hand their assets back as `available`. See issue #48.
 *
 * The role column is the whole feature, and it needs no new policy or
 * migration: `profiles_select_own_or_admin` already lets an admin read every
 * row, `profiles_update_own` already lets one write any row, and
 * `profiles_protect_role` already restricts the change to admins.
 */
export default function UserListPage() {
  const { t } = useTranslation("common", { keyPrefix: "users" });
  const { user, isProfileLoading, refreshProfile } = useAuth();
  const isAdmin = useIsAdmin();

  const [users, setUsers] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  const { isOpen, openModal, closeModal } = useModal();
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((prev) => prev + 1), []);

  useEffect(() => {
    // Gated on `isAdmin` so a staff member never issues the read. RLS would
    // answer with their own row rather than an error, so the guard here is
    // what keeps the request honest.
    if (!isAdmin) return;

    // `cancelled` covers a sign-out or a self-demote landing while the read
    // is in flight, which would otherwise set state for a screen that is no
    // longer being shown.
    let cancelled = false;

    void getAllUsers().then(
      (rows) => {
        if (cancelled) return;
        setUsers(rows);
        setLoadFailed(false);
        setIsLoading(false);
      },
      () => {
        if (cancelled) return;
        setUsers([]);
        setLoadFailed(true);
        setIsLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [isAdmin, reloadToken]);

  const adminCount = useMemo(
    () => users.filter((row) => row.role === "admin").length,
    [users],
  );

  const visibleUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return users;
    return users.filter((row) =>
      [row.full_name, row.email, row.department].some((value) =>
        value?.toLowerCase().includes(needle),
      ),
    );
  }, [users, query]);

  const handleOpenChange = (row: Profile) => {
    // Pre-filled with the opposite of the current role, so the control opens
    // on the change the button is actually offering.
    const nextRole: ProfileRole = row.role === "admin" ? "staff" : "admin";
    setSaveError(null);
    setPending({
      userId: row.id,
      name: row.full_name || row.email || t("notSet"),
      nextRole,
    });
    openModal();
  };

  const handleConfirm = async () => {
    if (!pending) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateUserRole(pending.userId, pending.nextRole);
      closeModal();

      // Changing your own role leaves the cached profile claiming the old one,
      // so `useIsAdmin()` would keep reporting admin until a reload. This is
      // the one path that has to be told, because the request that just
      // succeeded already decided the outcome.
      if (pending.userId === user?.id) {
        await refreshProfile();
      } else {
        reload();
      }
    } catch (error) {
      setSaveError(
        isLastAdminError(error) ? t("errors.lastAdmin") : t("errors.save"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const roleLabel = (role: ProfileRole) =>
    role === "admin" ? t("roles.admin") : t("roles.staff");

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

      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/3">
        <div className="flex flex-col gap-4 border-b border-gray-200 p-6 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              {t("pageTitle")}
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t("subtitle")}
            </p>
          </div>

          {/* Not a stub for a missing form: creating an account needs the
              Admin API, which needs a `service_role` key we do not ship to the
              browser. The button is here so the gap is visible, and the title
              says why it cannot be pressed.

              The title sits on a wrapper because a disabled button does not
              receive pointer events, so a tooltip on it would never show. The
              wrapper is also why `Button` itself is left alone rather than
              growing a `title` prop for one caller. */}
          <span title={t("createNotReady")}>
            <Button
              variant="outline"
              disabled
              startIcon={<PlusIcon className="size-4" />}
            >
              {t("addUser")}
            </Button>
          </span>
        </div>

        <div className="border-b border-gray-200 p-6 dark:border-gray-800">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:ring-3 focus:ring-brand-500/10 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
          />
        </div>

        {isLoading ? (
          <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
            {t("loading")}
          </p>
        ) : loadFailed ? (
          <p className="p-6 text-sm text-error-600 dark:text-error-500">
            {t("errors.load")}
          </p>
        ) : users.length === 0 ? (
          <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
            {t("empty")}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-gray-200 dark:border-gray-800">
                    <TableCell
                      isHeader
                      className="px-6 py-3 text-start text-theme-xs text-gray-500 uppercase dark:text-gray-400"
                    >
                      {t("columns.name")}
                    </TableCell>
                    <TableCell
                      isHeader
                      className="px-6 py-3 text-start text-theme-xs text-gray-500 uppercase dark:text-gray-400"
                    >
                      {t("columns.email")}
                    </TableCell>
                    <TableCell
                      isHeader
                      className="px-6 py-3 text-start text-theme-xs text-gray-500 uppercase dark:text-gray-400"
                    >
                      {t("columns.department")}
                    </TableCell>
                    <TableCell
                      isHeader
                      className="px-6 py-3 text-start text-theme-xs text-gray-500 uppercase dark:text-gray-400"
                    >
                      {t("columns.role")}
                    </TableCell>
                    <TableCell
                      isHeader
                      className="px-6 py-3 text-end text-theme-xs text-gray-500 uppercase dark:text-gray-400"
                    >
                      {t("columns.actions")}
                    </TableCell>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {visibleUsers.map((row) => {
                    const isSelf = row.id === user?.id;
                    // The last admin cannot be demoted, and the database
                    // refuses it. Disabling the control explains that before
                    // the click rather than after it.
                    const isLastAdmin =
                      row.role === "admin" && adminCount === 1;

                    return (
                      <TableRow
                        key={row.id}
                        className="border-b border-gray-100 last:border-0 dark:border-gray-800"
                      >
                        <TableCell className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm text-gray-800 dark:text-white/90">
                              {row.full_name || t("notSet")}
                            </span>
                            {isSelf && (
                              <Badge color="light" size="sm">
                                {t("you")}
                              </Badge>
                            )}
                          </div>
                        </TableCell>

                        <TableCell className="px-6 py-4">
                          <span className="block truncate text-sm text-gray-500 dark:text-gray-400">
                            {row.email || t("notSet")}
                          </span>
                        </TableCell>

                        <TableCell className="px-6 py-4">
                          <span className="block truncate text-sm text-gray-500 dark:text-gray-400">
                            {row.department || t("notSet")}
                          </span>
                        </TableCell>

                        <TableCell className="px-6 py-4">
                          <Badge
                            color={row.role === "admin" ? "primary" : "light"}
                            variant={row.role === "admin" ? "solid" : "light"}
                          >
                            {roleLabel(row.role)}
                          </Badge>
                        </TableCell>

                        <TableCell className="px-6 py-4">
                          <div className="flex justify-end">
                            <span
                              title={
                                isLastAdmin ? t("lastAdmin") : t("changeRole")
                              }
                            >
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isLastAdmin}
                                onClick={() => handleOpenChange(row)}
                              >
                                {t("changeRole")}
                              </Button>
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {visibleUsers.length === 0 ? (
              <p className="border-t border-gray-200 p-6 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                {t("noResults")}
              </p>
            ) : (
              <p className="border-t border-gray-200 p-6 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                {t("showing", {
                  shown: visibleUsers.length,
                  total: users.length,
                })}
              </p>
            )}
          </>
        )}
      </div>

      <Modal isOpen={isOpen} onClose={closeModal} className="max-w-md">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {t("confirmTitle")}
          </h3>

          {pending && (
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {t("confirmBody", {
                name: pending.name,
                role: roleLabel(pending.nextRole),
              })}
            </p>
          )}

          {/* Only one direction is offered, so the control is not a free choice
              between the two roles. `defaultValue` is safe here because Modal
              unmounts its children while closed, so the Select remounts with
              the current role each time it opens. */}
          <div className="mt-4">
            <Select
              options={[
                { value: "admin", label: t("roles.admin") },
                { value: "staff", label: t("roles.staff") },
              ]}
              defaultValue={pending?.nextRole}
              onChange={(value) =>
                setPending((prev) =>
                  prev ? { ...prev, nextRole: value as ProfileRole } : prev,
                )
              }
            />
          </div>

          {pending?.userId === user?.id && (
            <p className="mt-3 text-sm text-warning-600 dark:text-orange-400">
              {t("selfWarning")}
            </p>
          )}

          {saveError && (
            <p className="mt-3 text-sm text-error-600 dark:text-error-500">
              {saveError}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-3">
            <Button variant="outline" onClick={closeModal} disabled={isSaving}>
              {t("cancel")}
            </Button>
            <Button onClick={handleConfirm} disabled={isSaving}>
              {isSaving ? t("saving") : t("save")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** Shared bordered surface for the states that carry no table. */
function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500 dark:border-gray-800 dark:bg-white/3 dark:text-gray-400">
      {children}
    </div>
  );
}
