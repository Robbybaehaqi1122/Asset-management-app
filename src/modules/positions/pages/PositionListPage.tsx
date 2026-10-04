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
  createPosition,
  deletePosition,
  getPositions,
  updatePosition,
  PositionInUseError,
} from "../services/positionService";
import type { Position } from "../services/positionService";

/**
 * Positions: the job titles an admin maintains for the handover roster.
 *
 * **The same shape as `/departments`, on purpose.** Positions and departments are
 * the same kind of thing — a short admin-managed list that every signed-in user
 * reads and only an admin changes — and the roster form links to one beside the
 * other. Two implementations would be two places to fix the next RLS surprise.
 *
 * **One deliberate difference from `/departments`: this one can rename.**
 * `DepartmentListPage` can only add and delete, so a misspelled department can
 * only be fixed by deleting it — and only while nobody is in it. A job title is
 * typed by hand far more often than a department name, so a typo here is the
 * commonest event rather than the rarest, and "add a second one and leave the
 * wrong spelling" fragments the list this module exists to keep whole. So the
 * edit control is here, and the department page is the one with the gap.
 *
 * **Not gated on the route.** Same as `/users` and `/departments`: the page
 * checks `useIsAdmin()` and renders a refusal. A second route guard would be a
 * second place to keep in sync without adding a row of enforcement.
 */

/** The add/edit form. Never kept in state after the modal closes. */
type PositionForm = { name: string; description: string };

const EMPTY_POSITION: PositionForm = { name: "", description: "" };

export default function PositionListPage() {
  const { t } = useTranslation("common", { keyPrefix: "positions" });
  const { isProfileLoading } = useAuth();
  const isAdmin = useIsAdmin();

  const [positions, setPositions] = useState<Position[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  /**
   * One modal for both create and edit, because the fields are identical and a
   * second modal would be a copy that drifts — the same reason the settings page
   * drives its place tables off one `placeKind` flag.
   */
  const formModal = useModal();
  const deleteModal = useModal();

  const [form, setForm] = useState<PositionForm>(EMPTY_POSITION);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Position | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((prev) => prev + 1), []);

  useEffect(() => {
    // `cancelled` covers a sign-out landing while the read is in flight, which
    // would otherwise set state for a screen that is no longer shown.
    let cancelled = false;

    void getPositions().then(
      (rows) => {
        if (cancelled) return;
        setPositions(rows);
        setLoadFailed(false);
        setIsLoading(false);
      },
      () => {
        if (cancelled) return;
        setPositions([]);
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
    setForm(EMPTY_POSITION);
    formModal.openModal();
  };

  const handleOpenEdit = (row: Position) => {
    setSaveError(null);
    setEditingId(row.id);
    setForm({ name: row.name, description: row.description ?? "" });
    formModal.openModal();
  };

  const handleSave = async () => {
    const name = form.name.trim();
    // Checked here rather than left to the database, so the refusal names the box
    // that is empty instead of arriving as a bare `23514`.
    if (name === "") {
      setSaveError(t("errors.nameRequired"));
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const input = { name, description: form.description };

      if (editingId) {
        await updatePosition(editingId, input);
        setNotice(t("updated", { name }));
      } else {
        await createPosition(input);
        setNotice(t("created", { name }));
      }

      formModal.closeModal();
      reload();
    } catch (error) {
      // `23505` is the only uniqueness angle this can fail on: the blank name was
      // caught above, and `positions_name_not_blank` cannot trip because the name
      // is trimmed before it is sent.
      setSaveError(
        isDuplicateError(error) ? t("errors.duplicate") : t("errors.save"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenDelete = (row: Position) => {
    setDeleteError(null);
    setPendingDelete(row);
    deleteModal.openModal();
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;

    setIsSaving(true);
    setDeleteError(null);
    try {
      await deletePosition(pendingDelete.id);
      deleteModal.closeModal();
      setNotice(t("deleted", { name: pendingDelete.name }));
      reload();
    } catch (error) {
      // The in-use refusal is a *refusal*, not a failure, and naming the count
      // tells the admin what is left to do: move the people first.
      if (error instanceof PositionInUseError) {
        setDeleteError(
          t("errors.inUse", {
            count: error.holderCount,
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
            {t("addPosition")}
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
        ) : positions.length === 0 ? (
          <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
            {t("empty")}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {positions.map((row) => (
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
                    {row.holderCount === 0
                      ? t("noHolders")
                      : t("holders", { count: row.holderCount })}
                  </span>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenEdit(row)}
                    aria-label={t("editLabel", { name: row.name })}
                  >
                    <PencilIcon className="size-4" />
                  </Button>

                  {/* Disabled rather than hidden, and the title says why: a
                      position still held by somebody cannot be removed, because
                      `handover_users.position_id` is `on delete restrict`. */}
                  <span
                    title={row.holderCount > 0 ? t("deleteInUse") : undefined}
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={row.holderCount > 0}
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
              <Label htmlFor="position-name">
                {t("fields.name")} <span className="text-error-500">*</span>
              </Label>
              <Input
                id="position-name"
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
              <Label htmlFor="position-description">
                {t("fields.description")}{" "}
                <span className="text-sm font-normal text-gray-400 dark:text-gray-500">
                  ({t("optional")})
                </span>
              </Label>
              <Input
                id="position-description"
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

/**
 * `23505` is `unique_violation`, and it is the only code this insert can raise
 * from a uniqueness angle — the blank-name check happens before the request, and
 * the name is trimmed before it is sent.
 *
 * Matched on the code rather than on Postgres's wording, because the wording
 * names whichever constraint tripped and would not translate.
 */
function isDuplicateError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

/** The gates below need a page shell, so the header goes on regardless of state. */
function Frame({ children }: { children: ReactNode }) {
  const { t } = useTranslation("common", { keyPrefix: "positions" });
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
 * Takes no `useTranslation`, unlike the departments page's copy of it: the message
 * inside is already a translated string from the caller, so the hook here would
 * be read and never used.
 */
function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500 dark:border-gray-800 dark:bg-white/3 dark:text-gray-400">
      {children}
    </div>
  );
}
