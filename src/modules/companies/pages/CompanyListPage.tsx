import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import PageMeta from "@/components/common/PageMeta";
import Label from "@/components/form/Label";
import Input from "@/components/form/input/InputField";
import { Modal } from "@/components/ui/modal";
import Button from "@/components/ui/button/Button";
import { useAuth } from "@/context/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useModal } from "@/hooks/useModal";
import { CloseIcon, PencilIcon, PlusIcon, TrashBinIcon } from "@/icons";

import {
  createCompany,
  deleteCompany,
  getCompanies,
  isDuplicateCompanyError,
  updateCompany,
  CompanyInUseError,
  CompanyNameRequiredError,
} from "../services/companyService";
import type { Company } from "../services/companyService";

/**
 * Companies: the list of company names an admin maintains.
 *
 * **A list, and nothing more.** Nothing in the schema references `companies` yet —
 * no asset, no department, no roster row carries a `company_id` — so this screen
 * adds, renames and removes names and does not pretend to scope anything. See
 * `20260927002600` for why that is the stopping point rather than the first half of
 * a larger design.
 *
 * **The same shape as `/departments` and `/positions`, on purpose.** All three are
 * short admin-managed lists that every signed-in user reads and only an admin
 * changes. Two implementations would be two places to fix the next RLS surprise.
 *
 * **The delete is refused while anybody's roster entry names this company as their
 * employer**, which is the guard `02600` could not have and `02700` added. The count
 * beside each row is the same number the refusal message uses, so the admin can see
 * why a row cannot be removed without pressing the button first.
 *
 * **This one can rename**, which `/departments` cannot. A misspelled department can
 * only be fixed by deleting it, and only while nobody is in it; a company name is
 * typed by hand as often as a department name is, and "add a second one and leave
 * the wrong spelling" fragments the list this module exists to keep whole.
 *
 * **Not gated on the route**, same as `/users`, `/departments` and `/positions`: the
 * page checks `useIsAdmin()` and renders a refusal. A second route guard would be a
 * second place to keep in sync without adding a row of enforcement.
 */

/** The add/edit form. Never kept in state after the modal closes. */
type CompanyForm = { name: string; description: string };

const EMPTY_COMPANY: CompanyForm = { name: "", description: "" };

export default function CompanyListPage() {
  const { t } = useTranslation("common", { keyPrefix: "companies" });
  const { isProfileLoading } = useAuth();
  const isAdmin = useIsAdmin();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  /**
   * One modal for both create and edit, because the fields are identical and a
   * second modal would be a copy that drifts — the same reason the asset settings
   * page drives its two place tables off one `placeKind` flag.
   */
  const formModal = useModal();
  const deleteModal = useModal();

  const [form, setForm] = useState<CompanyForm>(EMPTY_COMPANY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Company | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((prev) => prev + 1), []);

  useEffect(() => {
    // `cancelled` covers a sign-out landing while the read is in flight, which would
    // otherwise set state for a screen that is no longer shown.
    let cancelled = false;

    void getCompanies().then(
      (rows) => {
        if (cancelled) return;
        setCompanies(rows);
        setLoadFailed(false);
        setIsLoading(false);
      },
      () => {
        if (cancelled) return;
        setCompanies([]);
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
    setEditingId(null);
    setForm(EMPTY_COMPANY);
    formModal.openModal();
  };

  const handleOpenEdit = (row: Company) => {
    setSaveError(null);
    setEditingId(row.id);
    setForm({ name: row.name, description: row.description ?? "" });
    formModal.openModal();
  };

  const handleSave = async () => {
    // Checked here rather than left to the database, so the refusal names the box
    // that is empty instead of arriving as a bare `23514` naming a constraint.
    if (form.name.trim() === "") {
      setSaveError(t("errors.nameRequired"));
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const input = {
        name: form.name.trim(),
        description: form.description,
      };

      if (editingId) {
        await updateCompany(editingId, input);
        setNotice(t("updated", { name: input.name }));
      } else {
        await createCompany(input);
        setNotice(t("created", { name: input.name }));
      }

      formModal.closeModal();
      reload();
    } catch (error) {
      // `23505` is the one code this can raise from a uniqueness angle, and it is
      // `companies_name_ci_key` rather than an inline constraint — so it fires for a
      // company that already exists **under a different spelling**, which is the
      // case the case-insensitive index exists to catch.
      if (error instanceof CompanyNameRequiredError) {
        setSaveError(t("errors.nameRequired"));
      } else if (isDuplicateCompanyError(error)) {
        setSaveError(t("errors.duplicate"));
      } else {
        setSaveError(t("errors.save"));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenDelete = (row: Company) => {
    setDeleteError(null);
    setPendingDelete(row);
    deleteModal.openModal();
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;

    setIsSaving(true);
    setDeleteError(null);
    try {
      await deleteCompany(pendingDelete.id);
      deleteModal.closeModal();
      setNotice(t("deleted", { name: pendingDelete.name }));
      reload();
    } catch (error) {
      // The in-use refusal is a *refusal*, not a failure, and naming the count tells
      // the admin what is left to do: move those people to another company first.
      // This case arrived with `02700` — before it, nothing referenced a company and
      // the delete had nothing to be refused by.
      if (error instanceof CompanyInUseError) {
        setDeleteError(t("errors.inUse", { count: error.memberCount }));
      } else {
        setDeleteError(t("errors.delete"));
      }
    } finally {
      setIsSaving(false);
    }
  };

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

      {/* Outside any modal, for the same reason the other modules' notices are: the
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
            {t("addCompany")}
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
        ) : companies.length === 0 ? (
          <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
            {t("empty")}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {companies.map((row) => (
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

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenEdit(row)}
                    aria-label={t("editLabel", { name: row.name })}
                  >
                    <PencilIcon className="size-4" />
                  </Button>

                  {/* Disabled rather than hidden, and the title says why: a company
                      that still employs somebody on the roster cannot be removed,
                      because `handover_users.company_id` is `on delete restrict` and
                      `companies_guard_delete` counts the rows. Silently refusing on
                      click would leave the admin guessing which control is broken. */}
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
        isOpen={formModal.isOpen}
        onClose={formModal.closeModal}
        className="max-w-md"
      >
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {editingId ? t("editTitle") : t("createTitle")}
          </h3>

          <div className="mt-5 space-y-4">
            <div>
              <Label htmlFor="company-name">
                {t("fields.name")} <span className="text-error-500">*</span>
              </Label>
              <Input
                id="company-name"
                name="name"
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder={t("fields.namePlaceholder")}
                autoFocus
              />
            </div>

            <div>
              <Label htmlFor="company-description">
                {t("fields.description")}{" "}
                <span className="text-sm font-normal text-gray-400 dark:text-gray-500">
                  ({t("optional")})
                </span>
              </Label>
              <Input
                id="company-description"
                name="description"
                value={form.description}
                onChange={(event) =>
                  setForm((prev) => ({
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
              onClick={formModal.closeModal}
              disabled={isSaving}
            >
              {t("cancel")}
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
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

/** The gates below need a page shell, so the header goes on regardless of state. */
function Frame({ children }: { children: ReactNode }) {
  const { t } = useTranslation("common", { keyPrefix: "companies" });
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

/**
 * Shared bordered surface for the states that carry no list.
 *
 * Takes no `useTranslation`, unlike a copy that reads it and never uses it: the
 * message inside is already a translated string from the caller.
 */
function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500 dark:border-gray-800 dark:bg-white/3 dark:text-gray-400">
      {children}
    </div>
  );
}
