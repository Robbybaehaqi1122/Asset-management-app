import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import Label from "@/components/form/Label";
import Input from "@/components/form/input/InputField";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import { useModal } from "@/hooks/useModal";
import { CloseIcon, PencilIcon, PlusIcon, TrashBinIcon } from "@/icons";

import type {
  ReferenceInput,
  ReferenceListSpec,
  ReferenceRow,
} from "../organisationSpecs";

/** The add/edit form. Never kept in state after the modal closes. */
type Form = ReferenceInput;

const EMPTY_FORM: Form = { name: "", description: "" };

/**
 * One organisation list: load, add, optionally rename, guarded delete.
 *
 * ## What this replaced
 *
 * Three pages of 434, 476 and 473 lines that were the same screen three times — same
 * load, same two modals, same list, same `isDuplicateError` helper defined separately in
 * each, and two of the three already disagreed about whether the page frame was a
 * component called `Frame` or inline markup. Everything that differed between them is
 * now data in `organisationSpecs.ts`, and this is the one screen.
 *
 * ## Translation keys are built from the spec, not scoped by it
 *
 * `useTranslation("common")` with no `keyPrefix`, then `` t(`${spec.keyPrefix}.empty`) ``.
 *
 * `keyPrefix` on the hook's options **would** be scoped correctly and is not available
 * here, because the hook reads its options on the first render and this spec arrives as
 * a prop that the caller may change when the reader switches tab. Passing the prefix as
 * the *namespace* argument instead — the version this codebase documents as a trap — would
 * compile, throw nothing, and print raw key names.
 *
 * ## No edit control at all where a list cannot be renamed
 *
 * `spec.update` is absent for departments, and this renders nothing rather than a
 * disabled button. A control that is visible and cannot be used is the thing this repo
 * repeatedly refuses: the reader cannot tell whether the permission, the page or the data
 * is stopping them. The reason a department cannot be renamed is in
 * `organisationSpecs.ts` — `categories.department` is free text, so a rename would not
 * move the categories naming it, and a category's department is what files every asset
 * into the IT or HSSE unit filter.
 */
export default function ReferenceListPanel({
  spec,
  /** Bumped by the parent after any write here, so the tab counts refresh too. */
  reloadToken,
  onChanged,
}: {
  spec: ReferenceListSpec;
  reloadToken: number;
  onChanged: () => void;
}) {
  const { t } = useTranslation();

  const [rows, setRows] = useState<ReferenceRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const formModal = useModal();
  const deleteModal = useModal();

  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ReferenceRow | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const key = spec.keyPrefix;

  useEffect(() => {
    // `cancelled` covers a tab switch or a sign-out landing while the read is in
    // flight, which would otherwise set state for a panel that is no longer shown.
    let cancelled = false;

    void spec.list().then(
      (next) => {
        if (cancelled) return;
        setRows(next);
        setLoadFailed(false);
        setIsLoading(false);
      },
      () => {
        if (cancelled) return;
        setRows([]);
        setLoadFailed(true);
        setIsLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [reloadToken, spec]);

  const handleOpenCreate = () => {
    setSaveError(null);
    setEditingId(null);
    setForm(EMPTY_FORM);
    formModal.openModal();
  };

  const handleOpenEdit = (row: ReferenceRow) => {
    if (!spec.update) return;
    setSaveError(null);
    setEditingId(row.id);
    setForm({ name: row.name, description: row.description ?? "" });
    formModal.openModal();
  };

  const handleSave = async () => {
    const name = form.name.trim();
    const description = form.description.trim();

    // Checked here for an immediate sentence, and again by the unique index, which is
    // the one that has to be believed: two admins in two tabs can both pass this check.
    if (name === "") {
      setSaveError(t(`${key}.errors.nameRequired`));
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      if (editingId !== null && spec.update) {
        await spec.update(editingId, { name, description });
        setNotice(t(`${key}.updated`, { name }));
      } else {
        await spec.create({ name, description });
        setNotice(t(`${key}.created`, { name }));
      }

      formModal.closeModal();
      onChanged();
    } catch (error) {
      // `23505` is `unique_violation`, and it is the only uniqueness angle this can fail
      // on: the blank name was caught above, and the name is trimmed before it is sent.
      // Matched on the code rather than on Postgres's wording, which names whichever
      // constraint tripped and would not translate.
      setSaveError(
        isDuplicateError(error)
          ? t(`${key}.errors.duplicate`)
          : t(spec.saveErrorKey),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenDelete = (row: ReferenceRow) => {
    setDeleteError(null);
    setPendingDelete(row);
    deleteModal.openModal();
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;

    setIsSaving(true);
    setDeleteError(null);
    try {
      await spec.remove(pendingDelete.id);
      deleteModal.closeModal();
      setNotice(t(`${key}.deleted`, { name: pendingDelete.name }));
      onChanged();
    } catch (error) {
      // The in-use refusal is a *refusal*, not a failure, and naming the count tells
      // the admin what is left to do: move the people first. The trigger behind it is
      // `security definer` for the same reason the check exists — a count taken through
      // the caller's own RLS would report zero and wave the delete through.
      const inUse = spec.inUseCount(error);
      setDeleteError(
        inUse === null
          ? t(`${key}.errors.delete`)
          : t(`${key}.errors.inUse`, {
              count: inUse,
              name: pendingDelete.name,
            }),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      {/* Outside the card and above it, for the reason every other module does this:
          the outcome is raised after the modal has closed, and `Modal` returns null
          while closed, so a message rendered inside it would never be seen. */}
      {notice && (
        <div
          role="status"
          className="mb-4 flex items-start justify-between gap-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-white/5 dark:text-gray-300"
        >
          <p>{notice}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label={t(`${key}.dismiss`)}
            className="shrink-0 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/3">
        <div className="flex flex-col gap-4 border-b border-gray-200 p-6 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              {t(`${key}.pageTitle`)}
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t(`${key}.subtitle`)}
            </p>
          </div>

          <Button
            variant="outline"
            onClick={handleOpenCreate}
            startIcon={<PlusIcon className="size-4" />}
            // Full width below `sm`, where the toolbar stacks and a half-width button
            // is stranded on the left with empty space beside it. `shrink-0` kept from
            // the desktop row, where the long subtitle is the flexible element.
            className="w-full shrink-0 sm:w-auto"
          >
            {t(spec.addKey)}
          </Button>
        </div>

        {isLoading ? (
          <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
            {t(`${key}.loading`)}
          </p>
        ) : loadFailed ? (
          <p className="p-6 text-sm text-error-600 dark:text-error-500">
            {t(`${key}.errors.load`)}
          </p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
            {t(`${key}.empty`)}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((row) => {
              // Read off the row rather than through the spec. `spec.list()` is
              // responsible for carrying it; see `ReferenceRow.usage` for what went
              // wrong when the two were separate and the normaliser dropped it.
              const usage = row.usage;

              /**
               * Computed once and rendered in two places, so the two can never say
               * different things about the same row -- which is how a count ends up
               * explaining a disabled button on one breakpoint and absent on another.
               */
              const usageLabel =
                usage === 0
                  ? t(spec.usageZeroKey)
                  : t(spec.usageManyKey, { count: usage });

              return (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 px-4 py-4 sm:gap-4 sm:px-6"
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

                    {/*
                      The count, **under the name on a phone** and beside the buttons
                      from `sm` up.

                      **Not hidden on mobile, deliberately.** It is the only thing that
                      explains why the delete button is disabled — the foreign key is
                      `on delete restrict`, so the button is refused rather than quietly
                      doing nothing. Hiding it would leave a dead button with no reason
                      on the exact screen where space is tightest.

                      Putting it here rather than dropping it means the right-hand cluster
                      is two icon buttons, which fits any width, instead of a sentence and
                      two buttons sharing ~327px.
                    */}
                    <span className="mt-0.5 block text-xs text-gray-400 sm:hidden">
                      {usageLabel}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                    <span className="hidden text-sm text-gray-500 sm:inline dark:text-gray-400">
                      {usageLabel}
                    </span>

                    {/* Absent rather than disabled where the list cannot be renamed. See
                        the component's own doc comment. */}
                    {spec.update && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenEdit(row)}
                        aria-label={t(`${key}.editLabel`, { name: row.name })}
                      >
                        <PencilIcon className="size-4" />
                      </Button>
                    )}

                    {/* Disabled rather than hidden, and the title says why. The foreign
                        key is `on delete set null` for departments and `restrict` for
                        the other two, so a row still in use is either silently
                        un-assigning everybody or refused outright by the database. */}
                    <span
                      title={usage > 0 ? t(`${key}.deleteInUse`) : undefined}
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={usage > 0}
                        onClick={() => handleOpenDelete(row)}
                        aria-label={t(`${key}.deleteLabel`, { name: row.name })}
                      >
                        <TrashBinIcon className="size-4" />
                      </Button>
                    </span>
                  </div>
                </li>
              );
            })}
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
            {/* No `editTitle` on departments, and no way to reach this branch for one. */}
            {editingId !== null
              ? t(`${key}.editTitle`)
              : t(`${key}.createTitle`)}
          </h3>

          <div className="mt-5 space-y-4">
            <div>
              <Label htmlFor={`reference-name-${spec.keyPrefix}`}>
                {t(`${key}.fields.name`)}{" "}
                <span className="text-error-500">*</span>
              </Label>
              <Input
                id={`reference-name-${spec.keyPrefix}`}
                name="name"
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder={t(`${key}.fields.namePlaceholder`)}
                autoFocus
              />
            </div>

            <div>
              <Label htmlFor={`reference-description-${spec.keyPrefix}`}>
                {t(`${key}.fields.description`)}{" "}
                <span className="text-sm font-normal text-gray-400 dark:text-gray-500">
                  ({t(`${key}.optional`)})
                </span>
              </Label>
              <Input
                id={`reference-description-${spec.keyPrefix}`}
                name="description"
                value={form.description}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                placeholder={t(`${key}.fields.descriptionPlaceholder`)}
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
              {t(`${key}.cancel`)}
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? t(`${key}.saving`) : t(spec.addKey)}
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
            {t(`${key}.deleteTitle`)}
          </h3>

          {pendingDelete && (
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {t(`${key}.deleteBody`, { name: pendingDelete.name })}
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
              {t(`${key}.cancel`)}
            </Button>
            <Button onClick={handleConfirmDelete} disabled={isSaving}>
              {isSaving ? t(`${key}.deleting`) : t(`${key}.deleteConfirm`)}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/**
 * `23505` is `unique_violation`. Matched on the code, not on Postgres's wording, which
 * names whichever constraint tripped — including the primary key — and would not
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
