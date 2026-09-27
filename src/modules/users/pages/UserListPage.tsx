import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import PageMeta from "@/components/common/PageMeta";
import Label from "@/components/form/Label";
import Select from "@/components/form/Select";
import Input from "@/components/form/input/InputField";
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
import { CloseIcon, EyeCloseIcon, EyeIcon, PlusIcon } from "@/icons";
import type { Profile, ProfileRole } from "@/lib/profiles";
import { generatePassword } from "@/lib/password";

import {
  getAllUsers,
  isLastAdminError,
  CreateUserError,
  NoRowsUpdatedError,
  createUser,
  updateUserDetails,
  updateUserRole,
} from "../services/userService";

/** A role change waiting for confirmation, plus who it is for. */
type PendingChange = {
  userId: string;
  name: string;
  nextRole: ProfileRole;
};

/** The two harmless columns, held in local state while the form is open. */
type EditingDetails = {
  row: Profile;
  fullName: string;
  department: string;
};

/** The add-user form. Never kept in state after the modal closes. */
type NewUserForm = {
  email: string;
  fullName: string;
  department: string;
  role: ProfileRole;
  password: string;
};

const EMPTY_NEW_USER: NewUserForm = {
  email: "",
  fullName: "",
  department: "",
  // `admin`, not `staff`, and the two must not drift apart again: the comment
  // inside the modal already argues for admin, and the Select is seeded from
  // this value, so a mismatch here is a mismatch the admin sees on screen. An
  // account created as staff leaves a project with nobody to hand the admin
  // role to, and the only fix for that is a three-statement SQL procedure.
  role: "admin",
  password: "",
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
 *
 * Editing the name and department needs no migration either, and not because
 * nothing guards them. Three triggers sit on `profiles`; the reason this works
 * is that only the two harmless columns are sent, so the two `UPDATE OF`
 * triggers never fire and the third returns early on an unchanged role. See
 * `updateUserDetails`.
 *
 * Role and name are separate controls rather than one combined form, because
 * they are separate concerns: role is protected, name is not, and folding them
 * together would either weaken the role guard or make the last-admin hint
 * depend on which field the cursor is in.
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

  // Two independent modals. `useModal` is one `useState`, so calling it twice
  // is cheaper than adding instance identity to the hook for two callers.
  const roleModal = useModal();
  const editModal = useModal();
  const createModal = useModal();
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [editing, setEditing] = useState<EditingDetails | null>(null);
  const [newUser, setNewUser] = useState<NewUserForm>(EMPTY_NEW_USER);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createWarning, setCreateWarning] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

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

  const handleOpenCreate = () => {
    setCreateError(null);
    setCreateWarning(null);
    setShowPassword(false);
    setNewUser(EMPTY_NEW_USER);
    createModal.openModal();
  };

  const handleGeneratePassword = () => {
    setNewUser((prev) => ({ ...prev, password: generatePassword() }));
    // Revealing it is the point. An admin who cannot read the value cannot
    // pass it on, and a hidden generated password is a password nobody has.
    setShowPassword(true);
  };

  const handleCreate = async () => {
    const email = newUser.email.trim().toLowerCase();
    const fullName = newUser.fullName.trim();
    const department = newUser.department.trim();
    const password = newUser.password;

    // Checked here for an immediate message, and again by the Edge Function,
    // which is the one that actually has to be believed.
    if (fullName === "") {
      setCreateError(t("errors.nameRequired"));
      return;
    }
    if (password.length < 8) {
      setCreateError(t("errors.create.weak_password"));
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    setCreateWarning(null);

    // Tracks whether the auth account came into existence, because that
    // changes what the failure below means. Once created, it cannot be undone
    // from this screen, and retrying blindly would just collide on the email.
    let createdId: string | null = null;

    try {
      const created = await createUser({
        email,
        password,
        full_name: fullName,
      });
      createdId = created.id;

      // The account exists at this point, so the list is already out of date
      // whatever happens next.
      reload();

      // Everything from here is a write the caller's own role already permits,
      // so it goes back over the normal RLS path. It is a second step rather
      // than part of the function on purpose: `protect_profile_role` refuses a
      // role change from a service-role request, because `auth.uid()` is empty
      // without a JWT. Attributing it to the admin is both the only way it
      // succeeds and the correct reason it succeeds.
      //
      // The `must_change_password` flag is not in this list, and that is not an
      // oversight. The function raised it next to the account it belongs to,
      // because nothing guards that column, and a client-side step is skippable
      // by exactly the dropped request that makes people reach for retry.
      await updateUserDetails(created.id, {
        full_name: fullName,
        department: department === "" ? null : department,
      });
      await updateUserRole(created.id, newUser.role);

      createModal.closeModal();
      reload();

      // The account exists and is fully configured, so this is not a failure —
      // but the one thing that stops the admin's password from staying known
      // forever is missing, and nothing in this screen can put it back. Said
      // out loud, which is the only thing left to do with it.
      if (!created.mustChangeFlagSet) {
        setCreateWarning(t("errors.passwordFlagFailed"));
      }
    } catch (error) {
      if (createdId !== null) {
        // Partial success, and the only kind that cannot simply be retried.
        reload();
        setCreateError(t("errors.partial"));
      } else if (error instanceof CreateUserError) {
        setCreateError(t(`errors.create.${error.code}`));
      } else {
        setCreateError(t("errors.create.unknown"));
      }
    } finally {
      setIsCreating(false);
    }
  };

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
    roleModal.openModal();
  };

  const handleOpenEdit = (row: Profile) => {
    setDetailsError(null);
    setEditing({
      row,
      fullName: row.full_name ?? "",
      department: row.department ?? "",
    });
    editModal.openModal();
  };

  const handleSaveDetails = async () => {
    if (!editing) return;

    // Trimmed before validating, so a name of spaces is a missing name rather
    // than a name the user cannot see. `department` is allowed to be empty and
    // becomes NULL, which is how the column reads "not set" everywhere else.
    const fullName = editing.fullName.trim();
    const department = editing.department.trim();

    if (fullName === "") {
      setDetailsError(t("errors.nameRequired"));
      return;
    }

    setIsSaving(true);
    setDetailsError(null);
    try {
      await updateUserDetails(editing.row.id, {
        full_name: fullName,
        department: department === "" ? null : department,
      });
      editModal.closeModal();

      // Same reason as the role change: the cached profile still holds the old
      // name, and `UserDropdown` reads it. `userId` has not changed, so the
      // fetch effect will not run on its own.
      if (editing.row.id === user?.id) {
        await refreshProfile();
      } else {
        reload();
      }
    } catch (error) {
      setDetailsError(
        error instanceof NoRowsUpdatedError
          ? t("errors.notFound")
          : t("errors.saveDetails"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirm = async () => {
    if (!pending) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateUserRole(pending.userId, pending.nextRole);
      roleModal.closeModal();

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

      {/* Deliberately outside the create modal, and not inside it. The flag
          failure is raised after `closeModal()`, because the account *was*
          created and the operator has to be shown that much; `Modal` returns
          null while closed, so a message rendered in there would be written and
          never seen. Dismissed by hand rather than on a timer, because there
          is no toast primitive in the repo and a `setState` in an effect is
          banned outright. */}
      {createWarning && (
        <div
          role="status"
          className="mt-4 flex items-start justify-between gap-4 rounded-2xl border border-warning-200 bg-warning-50 p-4 text-sm text-warning-700 dark:border-warning-800/60 dark:bg-warning-500/10 dark:text-orange-300"
        >
          <p>{createWarning}</p>
          <button
            type="button"
            onClick={() => setCreateWarning(null)}
            aria-label={t("dismiss")}
            className="shrink-0 text-warning-600 hover:text-warning-800 dark:text-orange-400 dark:hover:text-orange-200"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>
      )}

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

          {/* The only control on this screen that needs the Admin API, and the
              only one that goes through the server for it. `createUser` calls
              an Edge Function; the `service_role` key it uses never reaches
              this bundle. See `supabase/functions/create-user/index.ts`. */}
          <Button
            variant="outline"
            onClick={handleOpenCreate}
            startIcon={<PlusIcon className="size-4" />}
          >
            {t("addUser")}
          </Button>
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
                            {/* Read, not a control. This column has no trigger
                                guarding it — 00800 says so on purpose — so an
                                admin *could* clear it from here, and the only
                                reason not to offer that button is that it would
                                look like it does something security-shaped
                                while actually just writing a boolean. Clearing it
                                belongs to the account holder. */}
                            {row.must_change_password && (
                              <Badge color="warning" size="sm">
                                {t("temporaryPassword")}
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
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenEdit(row)}
                            >
                              {t("edit")}
                            </Button>
                            {/* The title sits on a wrapper because a disabled
                                button does not receive pointer events, so a
                                tooltip on it would never show.

                                The wording depends on whether there is anyone
                                to hand over to. "Promote somebody else first"
                                is unhelpful advice when this is the only
                                account in the project — which is exactly the
                                state a fresh install starts in, and the reason
                                the Add user button matters. */}
                            <span
                              title={
                                !isLastAdmin
                                  ? t("changeRole")
                                  : users.length === 1
                                    ? t("lastAdminOnlyAccount")
                                    : t("lastAdmin")
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

      <Modal
        isOpen={createModal.isOpen}
        onClose={createModal.closeModal}
        className="max-w-lg"
      >
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {t("createTitle")}
          </h3>

          <div className="mt-5 space-y-4">
            <div>
              <Label htmlFor="new-full-name">
                {t("fields.fullName")} <span className="text-error-500">*</span>
              </Label>
              <Input
                id="new-full-name"
                name="full_name"
                value={newUser.fullName}
                onChange={(event) =>
                  setNewUser((prev) => ({
                    ...prev,
                    fullName: event.target.value,
                  }))
                }
                placeholder={t("fields.fullName")}
                autoFocus
              />
            </div>

            <div>
              <Label htmlFor="new-email">
                {t("fields.email")} <span className="text-error-500">*</span>
              </Label>
              <Input
                id="new-email"
                name="email"
                type="email"
                value={newUser.email}
                onChange={(event) =>
                  setNewUser((prev) => ({ ...prev, email: event.target.value }))
                }
                placeholder="name@example.com"
                autoComplete="off"
              />
            </div>

            <div>
              <Label htmlFor="new-password">
                {t("fields.password")} <span className="text-error-500">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="new-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={newUser.password}
                  onChange={(event) =>
                    setNewUser((prev) => ({
                      ...prev,
                      password: event.target.value,
                    }))
                  }
                  placeholder="••••••••"
                  autoComplete="new-password"
                  hint={t("passwordHint")}
                  error={createError !== null && newUser.password.length < 8}
                  // Room for two controls on the trailing edge, so neither
                  // overlaps the text being typed.
                  className="pe-24"
                />
                {/* Two trailing controls rather than one stacked pair: the
                    reveal toggle is for reading what the admin typed, and this
                    one is for producing something to read. Folding them into a
                    single button would make "show" mean "replace". */}
                <button
                  type="button"
                  onClick={handleGeneratePassword}
                  title={t("generatePassword")}
                  className="absolute end-11 top-1/2 -translate-y-1/2 rounded px-1 py-0.5 text-xs font-medium text-brand-600 hover:bg-brand-50 hover:text-brand-700 dark:text-brand-400 dark:hover:bg-brand-500/10"
                >
                  {t("generatePassword")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={
                    showPassword
                      ? t("fields.hidePassword")
                      : t("fields.showPassword")
                  }
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  {showPassword ? (
                    <EyeCloseIcon className="size-5" />
                  ) : (
                    <EyeIcon className="size-5" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <Label htmlFor="new-department">
                {t("fields.department")}{" "}
                <span className="text-sm font-normal text-gray-400 dark:text-gray-500">
                  ({t("optional")})
                </span>
              </Label>
              <Input
                id="new-department"
                name="department"
                value={newUser.department}
                onChange={(event) =>
                  setNewUser((prev) => ({
                    ...prev,
                    department: event.target.value,
                  }))
                }
                placeholder={t("fields.department")}
              />
            </div>

            <div>
              {/* Admin is the correct default here, not staff. An account
                  created with no other admin around would otherwise start a
                  project with nobody able to administer it, and the only way
                  to fix that is a three-statement SQL procedure. Choosing
                  "admin" means the second account can hand over. */}
              <Label htmlFor="new-role">{t("fields.role")}</Label>
              <Select
                options={[
                  { value: "admin", label: t("roles.admin") },
                  { value: "staff", label: t("roles.staff") },
                ]}
                defaultValue={newUser.role}
                onChange={(value) =>
                  setNewUser((prev) => ({
                    ...prev,
                    role: value as ProfileRole,
                  }))
                }
              />
            </div>
          </div>

          {createError && (
            <p className="mt-4 text-sm text-error-600 dark:text-error-500">
              {createError}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={createModal.closeModal}
              disabled={isCreating}
            >
              {t("cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={isCreating}>
              {isCreating ? t("saving") : t("addUser")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={editModal.isOpen} onClose={editModal.closeModal}>
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {t("editTitle")}
          </h3>

          <div className="mt-5 space-y-4">
            <div>
              <Label htmlFor="edit-full-name">
                {t("fields.fullName")} <span className="text-error-500">*</span>
              </Label>
              <Input
                id="edit-full-name"
                name="full_name"
                value={editing?.fullName ?? ""}
                onChange={(event) =>
                  setEditing((prev) =>
                    prev ? { ...prev, fullName: event.target.value } : prev,
                  )
                }
                placeholder={t("fields.fullName")}
                autoFocus
              />
            </div>

            <div>
              <Label htmlFor="edit-department">
                {t("fields.department")}{" "}
                <span className="text-sm font-normal text-gray-400 dark:text-gray-500">
                  ({t("optional")})
                </span>
              </Label>
              <Input
                id="edit-department"
                name="department"
                value={editing?.department ?? ""}
                onChange={(event) =>
                  setEditing((prev) =>
                    prev ? { ...prev, department: event.target.value } : prev,
                  )
                }
                placeholder={t("fields.department")}
              />
            </div>
          </div>

          {/* Email and role are not here on purpose. Email lives in
              `auth.users` and `protect_profile_email` refuses writes from the
              browser; role has its own control because it is guarded. */}
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            {t("emailManagedElsewhere")}
          </p>

          {detailsError && (
            <p className="mt-3 text-sm text-error-600 dark:text-error-500">
              {detailsError}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={editModal.closeModal}
              disabled={isSaving}
            >
              {t("cancel")}
            </Button>
            <Button onClick={handleSaveDetails} disabled={isSaving}>
              {isSaving ? t("saving") : t("saveDetails")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={roleModal.isOpen}
        onClose={roleModal.closeModal}
        className="max-w-md"
      >
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
            <Button
              variant="outline"
              onClick={roleModal.closeModal}
              disabled={isSaving}
            >
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
