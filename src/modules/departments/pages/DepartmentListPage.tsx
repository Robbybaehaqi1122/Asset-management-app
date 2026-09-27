import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import PageMeta from "@/components/common/PageMeta";
import Label from "@/components/form/Label";
import Input from "@/components/form/input/InputField";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import { useAuth } from "@/context/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useModal } from "@/hooks/useModal";
import { CloseIcon, PlusIcon, TrashBinIcon } from "@/icons";

import {
  createDepartment,
  deleteDepartment,
  getDepartments,
  DepartmentInUseError,
} from "../services/departmentService";
import type { Department } from "../services/departmentService";

/** The add form. Never kept in state after the modal closes. */
type NewDepartmentForm = { name: string; description: string };

const EMPTY_NEW_DEPARTMENT: NewDepartmentForm = { name: "", description: "" };

/**
 * Department management: the list the user picker draws from.
 *
 * Admin-only, and gated exactly the way `/users` is — the page checks
 * `useIsAdmin()` and renders a refusal rather than there being a second route
 * guard. RLS already limits what a staff member can do here: they can read the
 * list (they need it, to understand who belongs where) and every write is
 * refused.
 *
 * Reads are not gated on `isAdmin` in the effect, unlike `UserListPage`. The
 * difference is deliberate: `profiles_select_own_or_admin` hides rows from a
 * staff member, so that read has to be gated or a staff member would be handed a
 * one-row list that looks broken. `departments_select_authenticated` is
 * `using (true)`, so this read returns the same rows either way and gating it
 * would only make the page slower for no benefit.
 */
export default function DepartmentListPage() {
  const { t } = useTranslation("common", { keyPrefix: "departments" });
  const { isProfileLoading } = useAuth();
  const isAdmin = useIsAdmin();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const createModal = useModal();
  const deleteModal = useModal();

  const [newDepartment, setNewDepartment] =
    useState<NewDepartmentForm>(EMPTY_NEW_DEPARTMENT);
  const [pendingDelete, setPendingDelete] = useState<Department | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((prev) => prev + 1), []);

  useEffect(() => {
    // `cancelled` covers a sign-out landing while the read is in flight, which
    // would otherwise set state for a screen that is no longer shown.
    let cancelled = false;

    void getDepartments().then(
      (rows) => {
        if (cancelled) return;
        setDepartments(rows);
        setLoadFailed(false);
        setIsLoading(false);
      },
      () => {
        if (cancelled) return;
        setDepartments([]);
        setLoadFailed(true);
        setIsLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const handleOpenCreate = () => {
    setSaveError(null);
    setNewDepartment(EMPTY_NEW_DEPARTMENT);
    createModal.openModal();
  };

  const handleCreate = async () => {
    const name = newDepartment.name.trim();
    const description = newDepartment.description.trim();

    // Checked here for an immediate message, and again by the unique index,
    // which is the one that actually has to be believed: two admins in two tabs
    // can both pass this check.
    if (name === "") {
      setSaveError(t("errors.nameRequired"));
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      await createDepartment({ name, description });
      createModal.closeModal();
      reload();
    } catch (error) {
      setSaveError(
        isDuplicateError(error) ? t("errors.duplicate") : t("errors.create"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenDelete = (row: Department) => {
    setDeleteError(null);
    setPendingDelete(row);
    deleteModal.openModal();
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;

    setIsSaving(true);
    setDeleteError(null);
    try {
      await deleteDepartment(pendingDelete.id);
      deleteModal.closeModal();
      setNotice(t("deleted", { name: pendingDelete.name }));
      reload();
    } catch (error) {
      // The in-use refusal is the interesting one: it is a *refusal*, not a
      // failure, and it is worth naming the count so the admin knows moving
      // people is what is left to do.
      if (error instanceof DepartmentInUseError) {
        setDeleteError(
          t("errors.inUse", {
            count: error.memberCount,
            name: pendingDelete.name,
          }),
        );
      } else {
        setDeleteError(t("errors.delete"));
      }
    } finally {
      setIsSaving(false);
    }
  };

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

      {/* Outside any modal, for the same reason the user list's warnings are: the
          outcome is raised after the modal has closed, and `Modal` returns null
          while closed, so a message rendered in there would never be seen. */}
      {notice && (
        <div
          role="status"
          className="mt-4 flex items-start justify-between gap-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-white/5 dark:text-gray-300"
        >
          <p>{notice}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label={t("dismiss")}
            className="shrink-0 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
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

          <Button
            variant="outline"
            onClick={handleOpenCreate}
            startIcon={<PlusIcon className="size-4" />}
          >
            {t("addDepartment")}
          </Button>
        </div>

        {isLoading ? (
          <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
            {t("loading")}
          </p>
        ) : loadFailed ? (
          <p className="p-6 text-sm text-error-600 dark:text-error-500">
            {t("errors.load")}
          </p>
        ) : departments.length === 0 ? (
          <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
            {t("empty")}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {departments.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-4 px-6 py-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-800 dark:text-white/90">
                    {row.name}
                  </p>
                  {row.description && (
                    <p className="mt-0.5 truncate text-sm text-gray-500 dark:text-gray-400">
                      {row.description}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {row.memberCount === 0
                      ? t("noMembers")
                      : t("members", { count: row.memberCount })}
                  </span>

                  {/* Disabled rather than hidden, and the title says why: a
                      department that still has people in it cannot be removed
                      without silently un-assigning all of them, because the
                      foreign key is `on delete set null`. */}
                  <span
                    title={row.memberCount > 0 ? t("deleteInUse") : undefined}
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={row.memberCount > 0}
                      onClick={() => handleOpenDelete(row)}
                      aria-label={t("deleteLabel", { name: row.name })}
                    >
                      <TrashBinIcon className="size-4" />
                    </Button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        isOpen={createModal.isOpen}
        onClose={createModal.closeModal}
        className="max-w-md"
      >
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {t("createTitle")}
          </h3>

          <div className="mt-5 space-y-4">
            <div>
              <Label htmlFor="new-department-name">
                {t("fields.name")} <span className="text-error-500">*</span>
              </Label>
              <Input
                id="new-department-name"
                name="name"
                value={newDepartment.name}
                onChange={(event) =>
                  setNewDepartment((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
                placeholder={t("fields.namePlaceholder")}
                autoFocus
              />
            </div>

            <div>
              <Label htmlFor="new-department-description">
                {t("fields.description")}{" "}
                <span className="text-sm font-normal text-gray-400 dark:text-gray-500">
                  ({t("optional")})
                </span>
              </Label>
              <Input
                id="new-department-description"
                name="description"
                value={newDepartment.description}
                onChange={(event) =>
                  setNewDepartment((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                placeholder={t("fields.descriptionPlaceholder")}
              />
            </div>
          </div>

          {saveError && (
            <p className="mt-4 text-sm text-error-600 dark:text-error-500">
              {saveError}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={createModal.closeModal}
              disabled={isSaving}
            >
              {t("cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={isSaving}>
              {isSaving ? t("saving") : t("addDepartment")}
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

          {pendingDelete && (
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {t("deleteBody", { name: pendingDelete.name })}
            </p>
          )}

          {deleteError && (
            <p className="mt-4 text-sm text-error-600 dark:text-error-500">
              {deleteError}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={deleteModal.closeModal}
              disabled={isSaving}
            >
              {t("cancel")}
            </Button>
            <Button onClick={handleConfirmDelete} disabled={isSaving}>
              {isSaving ? t("deleting") : t("deleteConfirm")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/**
 * `23505` is `unique_violation`, and it is the only code this insert can raise
 * from a uniqueness angle — the check for an empty name happens before the
 * request, and the name is not empty by the time it is sent.
 *
 * Matched on the code rather than on Postgres's wording, because the wording
 * names whichever constraint tripped, including the primary key, and would not
 * translate.
 */
function isDuplicateError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

/** Shared bordered surface for the states that carry no list. */
function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500 dark:border-gray-800 dark:bg-white/3 dark:text-gray-400">
      {children}
    </div>
  );
}
