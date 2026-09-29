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
import { Dropdown } from "@/components/ui/dropdown/Dropdown";
import { DropdownItem } from "@/components/ui/dropdown/DropdownItem";
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
import {
  CloseIcon,
  EyeCloseIcon,
  EyeIcon,
  HorizontaLDots,
  PlusIcon,
} from "@/icons";
import type { DepartmentRef, Profile, ProfileRole } from "@/lib/profiles";
import { generatePassword } from "@/lib/password";
import { getDepartmentOptions } from "@/modules/departments/services/departmentService";

import {
  getAllUsers,
  isLastAdminError,
  CreateUserError,
  DeleteUserError,
  NoRowsUpdatedError,
  ResetPasswordError,
  createUser,
  deleteUser,
  resetUserPassword,
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
  /**
   * A `departments` id, or `""` for "not set". An id rather than a name
   * because that is what the column is, and because the picker is only ever
   * populated from rows that exist.
   */
  departmentId: string;
};

/** The add-user form. Never kept in state after the modal closes. */
type NewUserForm = {
  email: string;
  fullName: string;
  departmentId: string;
  role: ProfileRole;
  password: string;
};

const EMPTY_NEW_USER: NewUserForm = {
  email: "",
  fullName: "",
  departmentId: "",
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
 * Four of the things on this screen — add, delete, change a role, reset a
 * password — are here for different reasons and it is worth keeping them apart.
 * Editing a name and a department needs no privileged access at all, so it goes
 * over ordinary RLS and needs no migration. The other three touch
 * `supabase.auth.admin`, which needs a `service_role` key, and `AGENTS.md`
 * forbids putting one in the browser — so each has an Edge Function behind it
 * and the browser does the rest.
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
  const deleteModal = useModal();
  const resetModal = useModal();
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [editing, setEditing] = useState<EditingDetails | null>(null);
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const [resetting, setResetting] = useState<Profile | null>(null);
  const [newUser, setNewUser] = useState<NewUserForm>(EMPTY_NEW_USER);
  /**
   * The password being handed over in the reset form. Held separately from
   * `newUser` and never kept after the modal closes, for the same reason the
   * add-user form is not kept in state either.
   */
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createWarning, setCreateWarning] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /**
   * One slot for "this happened, here is what", shared by the delete and the
   * reset flows. They are the same kind of message and were going to need the
   * same banner, so a second piece of state would only be a second thing to
   * remember to clear. The warning below is separate because it is a different
   * kind of outcome and looks different on screen.
   */
  const [outcome, setOutcome] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetWarning, setResetWarning] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);

  /**
   * The departments the pickers draw from.
   *
   * Read once for the screen and re-read whenever the list is reloaded, so a
   * department added in another tab — or on the `/departments` page and
   * navigated back from — is available without a full page reload. Read without
   * an admin gate on purpose: `departments_select_authenticated` is
   * `using (true)`, so this returns the same rows for a staff member, and
   * gating it would only delay the screen.
   */
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentRef[]>(
    [],
  );

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

  // Keyed on `reloadToken` rather than on `isAdmin`, so the picker list is
  // refreshed by the same tick that refreshes the users. Separate from the read
  // above because that one is admin-gated and this one is not.
  useEffect(() => {
    let cancelled = false;

    void getDepartmentOptions().then(
      (rows) => {
        if (cancelled) return;
        setDepartmentOptions(rows);
      },
      // A failed read of the picker list leaves the pickers empty rather than
      // breaking the screen. The department column itself is unaffected: it is
      // embedded in the profiles read, not joined from here.
      () => {
        if (!cancelled) setDepartmentOptions([]);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const adminCount = useMemo(
    () => users.filter((row) => row.role === "admin").length,
    [users],
  );

  const visibleUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return users;
    return users.filter((row) =>
      [row.full_name, row.email, row.departmentName].some((value) =>
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
    const departmentId = newUser.departmentId;
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
        department_id: departmentId === "" ? null : departmentId,
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
      // The id, not the name: this is what the column holds, and the picker
      // matches on id. `""` when the person has no department, which the Select
      // shows as the "not set" placeholder.
      departmentId: row.department?.id ?? "",
    });
    editModal.openModal();
  };

  const handleSaveDetails = async () => {
    if (!editing) return;

    // Trimmed before validating, so a name of spaces is a missing name rather
    // than a name the user cannot see. The department is allowed to be unset and
    // becomes NULL, which is how the column reads "not set" everywhere else.
    const fullName = editing.fullName.trim();
    const departmentId = editing.departmentId;

    if (fullName === "") {
      setDetailsError(t("errors.nameRequired"));
      return;
    }

    setIsSaving(true);
    setDetailsError(null);
    try {
      await updateUserDetails(editing.row.id, {
        full_name: fullName,
        department_id: departmentId === "" ? null : departmentId,
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

  const handleOpenDelete = (row: Profile) => {
    setDeleteError(null);
    setOutcome(null);
    setDeleting(row);
    deleteModal.openModal();
  };

  const handleConfirmDelete = async () => {
    if (!deleting) return;

    setIsDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteUser(deleting.id);
      deleteModal.closeModal();

      // Reported rather than silent. The account is gone and there is nothing
      // to undo, so the number of loans that went with it is the last chance to
      // say so out loud.
      setOutcome(
        result.erasedLoans === 0
          ? t("deleteDone", {
              name: deleting.full_name || deleting.email || t("notSet"),
            })
          : t("deleteDoneWithLoans", {
              name: deleting.full_name || deleting.email || t("notSet"),
              count: result.erasedLoans,
            }),
      );
      reload();
    } catch (error) {
      setDeleteError(
        error instanceof DeleteUserError
          ? t(`errors.delete.${error.code}`)
          : t("errors.delete.unknown"),
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenReset = (row: Profile) => {
    setResetError(null);
    setResetWarning(null);
    setOutcome(null);
    // Cleared on the way in, not only on the way out, so a modal that was
    // closed without submitting does not leave a credential sitting in state.
    setResetPasswordValue("");
    setShowResetPassword(false);
    setResetting(row);
    resetModal.openModal();
  };

  const handleGenerateResetPassword = () => {
    setResetPasswordValue(generatePassword());
    // Revealing it is the point, for the same reason as the add-user form: a
    // generated password nobody can read is a password nobody has.
    setShowResetPassword(true);
  };

  const handleConfirmReset = async () => {
    if (!resetting) return;

    // Checked here so the message lands on the field being looked at, and again
    // in the function, which is the authority. The two rules can disagree — the
    // hosted auth allows a shorter minimum — and when they do, the stricter one
    // is the one that protects the account.
    if (resetPasswordValue.length < 8) {
      setResetError(t("errors.reset.weak_password"));
      return;
    }

    setIsResetting(true);
    setResetError(null);
    setResetWarning(null);
    try {
      const result = await resetUserPassword(resetting.id, resetPasswordValue);
      resetModal.closeModal();
      setResetPasswordValue("");

      // The flag and the badge both read that column, so the cached row is stale
      // whichever way the target compares to the signed-in user. The same rule
      // the other two handlers use, for the same reason.
      if (resetting.id === user?.id) {
        await refreshProfile();
      } else {
        reload();
      }

      setOutcome(
        t("resetDone", {
          name: resetting.full_name || resetting.email || t("notSet"),
        }),
      );

      // The credential changed before the flag write, so a failure here is not a
      // failed reset — it is a reset that will never ask to be replaced. Said
      // out loud, because nothing in this screen can put it back afterwards.
      if (!result.mustChangeFlagSet) {
        setResetWarning(
          t("resetFlagFailed", {
            name: resetting.full_name || resetting.email || t("notSet"),
          }),
        );
      }
    } catch (error) {
      setResetError(
        error instanceof ResetPasswordError
          ? t(`errors.reset.${error.code}`)
          : t("errors.reset.unknown"),
      );
    } finally {
      setIsResetting(false);
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

      {/* Same placement reasoning as `createWarning`: the outcome is raised after
          the modal closes, and `Modal` returns null while closed, so a message
          rendered in there would be written and never seen. Shared by the delete
          and reset flows, which is why it is one slot rather than two. */}
      {outcome && (
        <div
          role="status"
          className="mt-4 flex items-start justify-between gap-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-white/5 dark:text-gray-300"
        >
          <p>{outcome}</p>
          <button
            type="button"
            onClick={() => setOutcome(null)}
            aria-label={t("dismiss")}
            className="shrink-0 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>
      )}

      {/* Same placement reasoning as `createWarning`, for the same reason: the
          flag write is the last thing that can fail, after the password has
          already changed and after the modal has closed. `Modal` returns null
          while closed, so a message rendered in there would be written and never
          seen. */}
      {resetWarning && (
        <div
          role="status"
          className="mt-4 flex items-start justify-between gap-4 rounded-2xl border border-warning-200 bg-warning-50 p-4 text-sm text-warning-700 dark:border-warning-800/60 dark:bg-warning-500/10 dark:text-orange-300"
        >
          <p>{resetWarning}</p>
          <button
            type="button"
            onClick={() => setResetWarning(null)}
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
                            {row.departmentName || t("notSet")}
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
                            <RowActions
                              row={row}
                              isSelf={isSelf}
                              isLastAdmin={isLastAdmin}
                              isOnlyAccount={users.length === 1}
                              openMenuId={openMenuId}
                              setOpenMenuId={setOpenMenuId}
                              onEdit={() => handleOpenEdit(row)}
                              onChangeRole={() => handleOpenChange(row)}
                              onReset={() => handleOpenReset(row)}
                              onDelete={() => handleOpenDelete(row)}
                            />
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
              {/* A picker, not a text box, because the column is a foreign key
                  and a typed value that no row matches would be refused by the
                  database with an error the form cannot explain. The empty
                  option is "not set", which is a real value the column holds. */}
              <Select
                id="new-department"
                options={departmentOptions.map((option) => ({
                  value: option.id,
                  label: option.name,
                }))}
                defaultValue={newUser.departmentId}
                placeholder={t("fields.departmentPlaceholder")}
                onChange={(value) =>
                  setNewUser((prev) => ({ ...prev, departmentId: value }))
                }
              />
              {departmentOptions.length === 0 && (
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                  {t("noDepartmentsYet")}
                </p>
              )}
            </div>

            <div>
              {/* Admin is the correct default here, not staff. An account
                  created with no other admin around would otherwise start a
                  project with nobody able to administer it, and the only way
                  to fix that is a three-statement SQL procedure. Choosing
                  "admin" means the second account can hand over. */}
              <Label htmlFor="new-role">{t("fields.role")}</Label>
              <Select
                id="new-role"
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
              <Select
                id="edit-department"
                options={departmentOptions.map((option) => ({
                  value: option.id,
                  label: option.name,
                }))}
                defaultValue={editing?.departmentId ?? ""}
                placeholder={t("fields.departmentPlaceholder")}
                onChange={(value) =>
                  setEditing((prev) =>
                    prev ? { ...prev, departmentId: value } : prev,
                  )
                }
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
              the current role each time it opens.

              The label was missing, which left this select with no accessible
              name at all — a screen reader announces it as an unlabelled
              dropdown, and there is no `for`/`id` pair to check. `role` is
              already the term used on the badge and in the table header, so
              reusing it keeps the same word attached to the same control. */}
          <div className="mt-4">
            <Label htmlFor="change-role">{t("fields.role")}</Label>
            <Select
              id="change-role"
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

      <Modal
        isOpen={deleteModal.isOpen}
        onClose={deleteModal.closeModal}
        className="max-w-md"
      >
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {t("deleteTitle")}
          </h3>

          {deleting && (
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {t("deleteBody", {
                name: deleting.full_name || deleting.email || t("notSet"),
              })}
            </p>
          )}

          {/* The cascade, spelled out, because this is the one screen in the
              app where a single click can remove rows nobody is looking at.
              `guard_last_admin` does not cover this — it fires on
              `update of role`, and a delete is not an update — so the refusal
              below the warning is the only thing standing between this and a
              project with no administrator. */}
          <div className="mt-4 rounded-xl border border-error-200 bg-error-50 p-4 dark:border-error-800/60 dark:bg-error-500/10">
            <p className="text-sm font-medium text-error-700 dark:text-error-400">
              {t("deleteWarningTitle")}
            </p>
            <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-error-700 dark:text-error-400">
              <li>{t("deleteWarningLoans")}</li>
              <li>{t("deleteWarningLender")}</li>
              <li>{t("deleteWarningAssets")}</li>
            </ul>
          </div>

          {deleteError && (
            <p className="mt-4 text-sm text-error-600 dark:text-error-500">
              {deleteError}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={deleteModal.closeModal}
              disabled={isDeleting}
            >
              {t("cancel")}
            </Button>
            <Button onClick={handleConfirmDelete} disabled={isDeleting}>
              {isDeleting ? t("deleting") : t("deleteConfirm")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={resetModal.isOpen}
        onClose={resetModal.closeModal}
        className="max-w-lg"
      >
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {t("resetTitle")}
          </h3>

          {resetting && (
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {t("resetBody", {
                name: resetting.full_name || resetting.email || t("notSet"),
              })}
            </p>
          )}

          <div className="mt-5 space-y-4">
            <div>
              <Label htmlFor="reset-password">{t("fields.password")}</Label>
              <div className="relative">
                <Input
                  id="reset-password"
                  name="new_password"
                  type={showResetPassword ? "text" : "password"}
                  value={resetPasswordValue}
                  onChange={(event) =>
                    setResetPasswordValue(event.target.value)
                  }
                  placeholder="••••••••"
                  autoComplete="new-password"
                  hint={t("passwordHint")}
                  error={resetError !== null && resetPasswordValue.length < 8}
                  // Room for two controls on the trailing edge, so neither
                  // overlaps the text being typed. Same layout as the add-user
                  // form, for the same reason.
                  className="pe-24"
                />
                {/* Two trailing controls rather than one stacked pair: the
                    reveal toggle is for reading what the admin typed, and this
                    one is for producing something to read. Folding them into a
                    single button would make "show" mean "replace". */}
                <button
                  type="button"
                  onClick={handleGenerateResetPassword}
                  title={t("generatePassword")}
                  className="absolute end-11 top-1/2 -translate-y-1/2 rounded px-1 py-0.5 text-xs font-medium text-brand-600 hover:bg-brand-50 hover:text-brand-700 dark:text-brand-400 dark:hover:bg-brand-500/10"
                >
                  {t("generatePassword")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowResetPassword((prev) => !prev)}
                  aria-label={
                    showResetPassword
                      ? t("fields.hidePassword")
                      : t("fields.showPassword")
                  }
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  {showResetPassword ? (
                    <EyeCloseIcon className="size-5" />
                  ) : (
                    <EyeIcon className="size-5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Stated before the button, not after it. This is the one screen
              where the person reading it is going to learn somebody's
              credential, and the only thing standing between that and a
              password that never changes is the flag written on the other side
              of this button. */}
          <p className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500 dark:border-gray-800 dark:bg-white/5 dark:text-gray-400">
            {t("resetPrompt")}
          </p>

          {resetError && (
            <p className="mt-4 text-sm text-error-600 dark:text-error-500">
              {resetError}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={resetModal.closeModal}
              disabled={isResetting}
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleConfirmReset}
              disabled={isResetting || resetPasswordValue.length < 8}
            >
              {isResetting ? t("resetting") : t("resetConfirm")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/**
 * The four row actions, behind one control.
 *
 * A dropdown rather than four buttons because delete has to join them, and a
 * destructive action sitting next to routine ones as a peer button is exactly
 * the shape that gets mis-clicked. The safe items are still two clicks away and
 * no further than they were.
 *
 * Only one menu can be open at a time, and the page owns which one — `openMenuId`
 * lives here rather than in a `useState` per row, because that would mean
 * rendering a component per row just to hold one boolean.
 */
function RowActions({
  row,
  isSelf,
  isLastAdmin,
  isOnlyAccount,
  openMenuId,
  setOpenMenuId,
  onEdit,
  onChangeRole,
  onReset,
  onDelete,
}: {
  row: Profile;
  isSelf: boolean;
  isLastAdmin: boolean;
  isOnlyAccount: boolean;
  openMenuId: string | null;
  setOpenMenuId: (id: string | null) => void;
  onEdit: () => void;
  onChangeRole: () => void;
  onReset: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("common", { keyPrefix: "users" });
  const isOpen = openMenuId === row.id;

  const run = (action: () => void) => () => {
    // Closed first, so the menu is not left hanging over the modal it opens.
    setOpenMenuId(null);
    action();
  };

  // Deleting yourself would strand this very session on an auth user that no
  // longer exists, and if you are also the only admin it locks the project.
  // Neither is a thing to offer as a clickable item.
  const deleteReason = isSelf
    ? t("deleteSelf")
    : isOnlyAccount
      ? t("deleteOnlyAccount")
      : null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpenMenuId(isOpen ? null : row.id)}
        aria-label={t("actionsLabel", {
          name: row.full_name || row.email || t("notSet"),
        })}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="dropdown-toggle rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200"
      >
        <HorizontaLDots className="size-5" />
      </button>

      {isOpen && (
        <Dropdown isOpen onClose={() => setOpenMenuId(null)}>
          <DropdownItem onClick={run(onEdit)}>{t("edit")}</DropdownItem>

          {/* The title sits on a wrapper, not on the item. A disabled button
              does not receive pointer events, so a tooltip on it would never
              show — and the wording is the whole point here, because the
              alternative advice is impossible to follow when there is nobody to
              promote. */}
          <span
            title={
              !isLastAdmin
                ? undefined
                : isOnlyAccount
                  ? t("lastAdminOnlyAccount")
                  : t("lastAdmin")
            }
          >
            <DropdownItem
              onClick={run(onChangeRole)}
              className={isLastAdmin ? "pointer-events-none opacity-50" : ""}
            >
              {t("changeRole")}
            </DropdownItem>
          </span>

          {/* No wrapper, and no disabled branch, and that is the point. Every
              other guarded item on this screen needed a refusal explained
              because it has a rule that can stop it. A password reset has none:
              it does not change the admin count, and a session survives its own
              credential changing, so there is no case where the honest answer is
              "you cannot do that". It is the recovery path for somebody locked
              out, and gating it would defeat the only reason it exists. */}
          <DropdownItem onClick={run(onReset)}>
            {t("resetPassword")}
          </DropdownItem>

          {/* Same wrapper trick: the refusal needs to explain itself, and a
          control that refuses without saying why is the thing this screen
          has been careful about elsewhere. */}
          <span title={deleteReason ?? undefined}>
            <DropdownItem
              onClick={run(onDelete)}
              className={
                deleteReason
                  ? "pointer-events-none opacity-50"
                  : "text-error-600 hover:bg-error-50 dark:text-error-500 dark:hover:bg-error-500/10"
              }
            >
              {t("delete")}
            </DropdownItem>
          </span>
        </Dropdown>
      )}
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
