import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import PageMeta from "@/components/common/PageMeta";
import Label from "@/components/form/Label";
import Input from "@/components/form/input/InputField";
import TextArea from "@/components/form/input/TextArea";
import Select from "@/components/form/Select";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import { useAuth } from "@/context/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useModal } from "@/hooks/useModal";
import { CloseIcon, PencilIcon, PlusIcon, TrashBinIcon } from "@/icons";

import {
  createCategory,
  createLocation,
  deleteCategory,
  deleteLocation,
  getCategoriesWithSubCategoryCounts,
  getLocations,
  updateCategory,
  updateLocation,
  CategoryInUseError,
  LocationInUseError,
} from "../services/settingService";
import type { CategoryRow, LocationRow } from "../services/settingService";

/**
 * Asset settings: the reference data behind the asset form's pickers.
 *
 * **Admin-only, gated the way `/users` and `/departments` are.** The page checks
 * `useIsAdmin()` and renders a refusal; there is no second route guard, because a
 * guard is a second place to keep in sync without adding a single row of
 * enforcement. RLS is the real boundary — `categories` and `locations` are
 * readable by every signed-in user and writable by admins alone, which is why the
 * asset form can populate its pickers for a staff member while this screen cannot
 * be opened by one.
 *
 * **Two tabs rather than two pages**, because the two are edited together: a
 * category is meaningless without knowing its sub-categories, and both are small
 * enough to sit under one breadcrumb.
 *
 * **The delete buttons are disabled, not hidden, and the guard is in the
 * database too.** A category with assets or sub-categories cannot be removed,
 * because `assets.category_id` is `on delete set null` and the database would
 * otherwise un-assign every asset there without a word. `categories_guard_delete`
 * holds for any caller; the button state is only there so the admin is told why
 * before pressing it.
 */

const TABS = ["categories", "locations"] as const;
type Tab = (typeof TABS)[number];

type CategoryForm = {
  name: string;
  description: string;
  parent_id: string;
  code: string;
};

type LocationForm = {
  area_name: string;
  room_name: string;
  notes: string;
};

const EMPTY_CATEGORY: CategoryForm = {
  name: "",
  description: "",
  parent_id: "",
  code: "",
};

const EMPTY_LOCATION: LocationForm = {
  area_name: "",
  room_name: "",
  notes: "",
};

export default function AssetSettingsPage() {
  const { t } = useTranslation("common", { keyPrefix: "assetSettings" });
  const { isProfileLoading } = useAuth();
  const isAdmin = useIsAdmin();

  const [tab, setTab] = useState<Tab>("categories");
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const categoryModal = useModal();
  const locationModal = useModal();
  const deleteModal = useModal();

  const [categoryForm, setCategoryForm] =
    useState<CategoryForm>(EMPTY_CATEGORY);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(
    null,
  );
  const [locationForm, setLocationForm] =
    useState<LocationForm>(EMPTY_LOCATION);
  const [editingLocationId, setEditingLocationId] = useState<string | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: "category"; row: CategoryRow }
    | { kind: "location"; row: LocationRow }
    | null
  >(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((prev) => prev + 1), []);

  useEffect(() => {
    // `cancelled` covers a sign-out landing while the reads are in flight, which
    // would otherwise set state for a screen that is no longer shown.
    let cancelled = false;

    void Promise.all([
      getCategoriesWithSubCategoryCounts(),
      getLocations(),
    ]).then(
      ([categoryRows, locationRows]) => {
        if (cancelled) return;
        setCategories(categoryRows);
        setLocations(locationRows);
        setLoadFailed(false);
        setIsLoading(false);
      },
      () => {
        if (cancelled) return;
        setCategories([]);
        setLocations([]);
        setLoadFailed(true);
        setIsLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  /** Top-level categories only, because a sub-category is the second level. */
  const parentChoices = useMemo(
    () =>
      categories
        .filter((row) => !row.parentId)
        .map((row) => ({ value: row.id, label: row.name })),
    [categories],
  );

  const subCategoriesByParent = useMemo(() => {
    const map = new Map<string, CategoryRow[]>();
    for (const row of categories) {
      if (!row.parentId) continue;
      const list = map.get(row.parentId) ?? [];
      list.push(row);
      map.set(row.parentId, list);
    }
    return map;
  }, [categories]);

  const handleOpenCreateCategory = () => {
    setSaveError(null);
    setEditingCategoryId(null);
    setCategoryForm(EMPTY_CATEGORY);
    categoryModal.openModal();
  };

  const handleOpenEditCategory = (row: CategoryRow) => {
    setSaveError(null);
    setEditingCategoryId(row.id);
    setCategoryForm({
      name: row.name,
      description: row.description ?? "",
      parent_id: row.parentId ?? "",
      // Only a top-level category carries a code, and the database refuses it on
      // a child, so the box is cleared rather than sent back as-is.
      code: row.parentId ? "" : (row.code ?? ""),
    });
    categoryModal.openModal();
  };

  const handleSaveCategory = async () => {
    const name = categoryForm.name.trim();
    if (name === "") {
      setSaveError(t("errors.nameRequired"));
      return;
    }
    // A sub-category cannot carry a code: the form switches on the main
    // category's code, so a code here is meaningless and the database refuses it.
    const code = categoryForm.parent_id ? null : categoryForm.code.trim();

    setIsSaving(true);
    setSaveError(null);
    try {
      if (editingCategoryId) {
        await updateCategory(editingCategoryId, {
          name,
          description: categoryForm.description,
          parent_id: categoryForm.parent_id || null,
          code: code || null,
        });
        setNotice(t("categoryUpdated", { name }));
      } else {
        await createCategory({
          name,
          description: categoryForm.description,
          parent_id: categoryForm.parent_id || null,
          code: code || null,
        });
        setNotice(t("categoryCreated", { name }));
      }
      categoryModal.closeModal();
      reload();
    } catch (error) {
      setSaveError(
        isDuplicateError(error) ? t("errors.duplicate") : t("errors.save"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenCreateLocation = () => {
    setSaveError(null);
    setEditingLocationId(null);
    setLocationForm(EMPTY_LOCATION);
    locationModal.openModal();
  };

  const handleOpenEditLocation = (row: LocationRow) => {
    setSaveError(null);
    setEditingLocationId(row.id);
    setLocationForm({
      area_name: row.area_name,
      room_name: row.room_name ?? "",
      notes: row.notes ?? "",
    });
    locationModal.openModal();
  };

  const handleSaveLocation = async () => {
    const areaName = locationForm.area_name.trim();
    if (areaName === "") {
      setSaveError(t("errors.areaRequired"));
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const input = {
        area_name: areaName,
        room_name: locationForm.room_name,
        notes: locationForm.notes,
      };
      if (editingLocationId) {
        await updateLocation(editingLocationId, input);
        setNotice(t("locationUpdated", { name: areaName }));
      } else {
        await createLocation(input);
        setNotice(t("locationCreated", { name: areaName }));
      }
      locationModal.closeModal();
      reload();
    } catch (error) {
      setSaveError(
        isDuplicateError(error) ? t("errors.duplicate") : t("errors.save"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenDelete = (
    kind: "category" | "location",
    row: CategoryRow | LocationRow,
  ) => {
    setDeleteError(null);
    setPendingDelete(
      kind === "category"
        ? { kind, row: row as CategoryRow }
        : { kind, row: row as LocationRow },
    );
    deleteModal.openModal();
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;

    setIsSaving(true);
    setDeleteError(null);
    try {
      if (pendingDelete.kind === "category") {
        const row = pendingDelete.row as CategoryRow;
        await deleteCategory(row.id);
        setNotice(t("categoryDeleted", { name: row.name }));
      } else {
        const row = pendingDelete.row as LocationRow;
        await deleteLocation(row.id);
        setNotice(t("locationDeleted", { name: row.area_name }));
      }
      deleteModal.closeModal();
      reload();
    } catch (error) {
      // The in-use refusal is a *refusal*, not a failure, and naming the count
      // tells the admin what is left to do: move the things first.
      if (error instanceof CategoryInUseError) {
        setDeleteError(
          t("errors.categoryInUse", {
            assets: error.assetCount,
            subCategories: error.subCategoryCount,
          }),
        );
      } else if (error instanceof LocationInUseError) {
        setDeleteError(t("errors.locationInUse", { count: error.assetCount }));
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

  const pendingName =
    pendingDelete?.kind === "category"
      ? (pendingDelete.row as CategoryRow).name
      : pendingDelete?.kind === "location"
        ? (pendingDelete.row as LocationRow).area_name
        : "";

  return (
    <div>
      <PageMeta
        title={`${t("pageTitle")} | Asset Management App`}
        description={t("pageDescription")}
      />
      <PageBreadcrumb pageTitle={t("pageTitle")} />

      {/* Outside any modal, for the same reason the other modules' notices are:
          the outcome is raised after the modal has closed, and `Modal` returns
          null while closed, so a message rendered in there would never be seen. */}
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
        <div className="border-b border-gray-200 p-6 dark:border-gray-800">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {t("pageTitle")}
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t("subtitle")}
          </p>

          <div
            role="tablist"
            aria-label={t("tabsLabel")}
            className="mt-5 inline-flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-white/5"
          >
            {TABS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`asset-settings-tab-${key}`}
                aria-selected={tab === key}
                aria-controls={`asset-settings-panel-${key}`}
                onClick={() => setTab(key)}
                className={
                  tab === key
                    ? "rounded-md bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-theme-xs dark:bg-white/10 dark:text-white"
                    : "rounded-md px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                }
              >
                {t(`tabs.${key}`)}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
            {t("loading")}
          </p>
        ) : loadFailed ? (
          <p className="p-6 text-sm text-error-600 dark:text-error-500">
            {t("errors.load")}
          </p>
        ) : (
          <>
            {tab === "categories" && (
              <section
                id="asset-settings-panel-categories"
                role="tabpanel"
                aria-labelledby="asset-settings-tab-categories"
              >
                <div className="flex flex-col gap-4 border-b border-gray-200 p-6 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t("categoriesHint")}
                  </p>
                  <Button
                    variant="outline"
                    onClick={handleOpenCreateCategory}
                    startIcon={<PlusIcon className="size-4" />}
                  >
                    {t("addCategory")}
                  </Button>
                </div>

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableCell>{t("table.category")}</TableCell>
                        <TableCell>{t("table.code")}</TableCell>
                        <TableCell>{t("table.subCategories")}</TableCell>
                        <TableCell>{t("table.assets")}</TableCell>
                        <TableCell>{t("table.actions")}</TableCell>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {categories
                        .filter((row) => !row.parentId)
                        .map((parent) => {
                          const children =
                            subCategoriesByParent.get(parent.id) ?? [];
                          return (
                            <CategoryGroup
                              key={parent.id}
                              parent={parent}
                              children={children}
                              onEdit={handleOpenEditCategory}
                              onDelete={handleOpenDelete}
                            />
                          );
                        })}
                    </TableBody>
                  </Table>
                </div>
              </section>
            )}

            {tab === "locations" && (
              <section
                id="asset-settings-panel-locations"
                role="tabpanel"
                aria-labelledby="asset-settings-tab-locations"
              >
                <div className="flex flex-col gap-4 border-b border-gray-200 p-6 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t("locationsHint")}
                  </p>
                  <Button
                    variant="outline"
                    onClick={handleOpenCreateLocation}
                    startIcon={<PlusIcon className="size-4" />}
                  >
                    {t("addLocation")}
                  </Button>
                </div>

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableCell>{t("table.area")}</TableCell>
                        <TableCell>{t("table.room")}</TableCell>
                        <TableCell>{t("table.notes")}</TableCell>
                        <TableCell>{t("table.assets")}</TableCell>
                        <TableCell>{t("table.actions")}</TableCell>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {locations.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{row.area_name}</TableCell>
                          <TableCell>{row.room_name ?? t("noRoom")}</TableCell>
                          <TableCell>
                            <span className="text-gray-500 dark:text-gray-400">
                              {row.notes ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            {t("assetCount", { count: row.assetCount })}
                          </TableCell>
                          <TableCell>
                            <RowActions
                              editLabel={t("editLabel", {
                                name: row.area_name,
                              })}
                              deleteLabel={t("deleteLabel", {
                                name: row.area_name,
                              })}
                              deleteDisabled={row.assetCount > 0}
                              deleteTitle={
                                row.assetCount > 0
                                  ? t("deleteInUse")
                                  : undefined
                              }
                              onEdit={() => handleOpenEditLocation(row)}
                              onDelete={() => handleOpenDelete("location", row)}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <Modal
        isOpen={categoryModal.isOpen}
        onClose={categoryModal.closeModal}
        className="max-w-lg"
      >
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {editingCategoryId ? t("editCategoryTitle") : t("addCategory")}
          </h3>

          <div className="mt-5 space-y-4">
            <div>
              <Label htmlFor="setting-category-name">
                {t("fields.name")} <span className="text-error-500">*</span>
              </Label>
              <Input
                id="setting-category-name"
                name="name"
                value={categoryForm.name}
                onChange={(event) =>
                  setCategoryForm((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
                placeholder={t("fields.namePlaceholder")}
                autoFocus
              />
            </div>

            <div>
              <Label htmlFor="setting-category-parent">
                {t("fields.parent")}{" "}
                <span className="text-sm font-normal text-gray-400 dark:text-gray-500">
                  ({t("optional")})
                </span>
              </Label>
              <Select
                // Keyed on the row being edited: `Select` reads `defaultValue`
                // once, so a modal reused for a second category would keep
                // showing the first one's choice.
                key={`setting-parent-${editingCategoryId ?? "new"}`}
                id="setting-category-parent"
                options={parentChoices}
                placeholder={t("fields.noParent")}
                defaultValue={categoryForm.parent_id}
                onChange={(v) =>
                  setCategoryForm((prev) => ({ ...prev, parent_id: v }))
                }
              />
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                {t("fields.parentHint")}
              </p>
            </div>

            <div>
              <Label htmlFor="setting-category-code">
                {t("fields.code")}{" "}
                <span className="text-sm font-normal text-gray-400 dark:text-gray-500">
                  ({t("optional")})
                </span>
              </Label>
              <Input
                id="setting-category-code"
                name="code"
                value={categoryForm.code}
                // The code is what the asset form switches its fieldset on, so a
                // sub-category cannot have one: the box is disabled rather than
                // cleared, which is the honest reason it is unavailable.
                disabled={categoryForm.parent_id !== ""}
                onChange={(event) =>
                  setCategoryForm((prev) => ({
                    ...prev,
                    code: event.target.value,
                  }))
                }
                placeholder="COMPUTER"
              />
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                {t("fields.codeHint")}
              </p>
            </div>

            <div>
              <Label htmlFor="setting-category-description">
                {t("fields.description")}{" "}
                <span className="text-sm font-normal text-gray-400 dark:text-gray-500">
                  ({t("optional")})
                </span>
              </Label>
              <TextArea
                id="setting-category-description"
                rows={2}
                value={categoryForm.description}
                onChange={(v) =>
                  setCategoryForm((prev) => ({ ...prev, description: v }))
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
              onClick={categoryModal.closeModal}
              disabled={isSaving}
            >
              {t("cancel")}
            </Button>
            <Button onClick={handleSaveCategory} disabled={isSaving}>
              {isSaving ? t("saving") : t("save")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={locationModal.isOpen}
        onClose={locationModal.closeModal}
        className="max-w-lg"
      >
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {editingLocationId ? t("editLocationTitle") : t("addLocation")}
          </h3>

          <div className="mt-5 space-y-4">
            <div>
              <Label htmlFor="setting-location-area">
                {t("fields.area")} <span className="text-error-500">*</span>
              </Label>
              <Input
                id="setting-location-area"
                name="area_name"
                value={locationForm.area_name}
                onChange={(event) =>
                  setLocationForm((prev) => ({
                    ...prev,
                    area_name: event.target.value,
                  }))
                }
                placeholder={t("fields.areaPlaceholder")}
                autoFocus
              />
            </div>

            <div>
              <Label htmlFor="setting-location-room">
                {t("fields.room")}{" "}
                <span className="text-sm font-normal text-gray-400 dark:text-gray-500">
                  ({t("optional")})
                </span>
              </Label>
              <Input
                id="setting-location-room"
                name="room_name"
                value={locationForm.room_name}
                onChange={(event) =>
                  setLocationForm((prev) => ({
                    ...prev,
                    room_name: event.target.value,
                  }))
                }
                placeholder={t("fields.roomPlaceholder")}
              />
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                {t("fields.roomHint")}
              </p>
            </div>

            <div>
              <Label htmlFor="setting-location-notes">
                {t("fields.notes")}{" "}
                <span className="text-sm font-normal text-gray-400 dark:text-gray-500">
                  ({t("optional")})
                </span>
              </Label>
              <TextArea
                id="setting-location-notes"
                rows={2}
                value={locationForm.notes}
                onChange={(v) =>
                  setLocationForm((prev) => ({ ...prev, notes: v }))
                }
                placeholder={t("fields.notesPlaceholder")}
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
              onClick={locationModal.closeModal}
              disabled={isSaving}
            >
              {t("cancel")}
            </Button>
            <Button onClick={handleSaveLocation} disabled={isSaving}>
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
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {t("deleteBody", { name: pendingName })}
          </p>

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
 * One parent row plus its sub-category rows.
 *
 * Rendered as a fragment rather than nested markup because a `<Table>` cannot
 * hold a `<div>`, and the sub-categories are visibly indented children of the row
 * above rather than peers of it.
 */
function CategoryGroup({
  parent,
  children,
  onEdit,
  onDelete,
}: {
  parent: CategoryRow;
  children: CategoryRow[];
  onEdit: (row: CategoryRow) => void;
  onDelete: (kind: "category", row: CategoryRow) => void;
}) {
  const { t } = useTranslation("common", { keyPrefix: "assetSettings" });

  return (
    <>
      <TableRow>
        <TableCell>
          <span className="font-medium text-gray-800 dark:text-white/90">
            {parent.name}
          </span>
          {parent.description && (
            <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
              {parent.description}
            </span>
          )}
        </TableCell>
        <TableCell>
          {parent.code ? (
            <Badge size="sm" color="info">
              {parent.code}
            </Badge>
          ) : (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {t("noCode")}
            </span>
          )}
        </TableCell>
        <TableCell>
          {t("subCategoryCount", { count: parent.subCategoryCount })}
        </TableCell>
        <TableCell>{t("assetCount", { count: parent.assetCount })}</TableCell>
        <TableCell>
          <RowActions
            editLabel={t("editLabel", { name: parent.name })}
            deleteLabel={t("deleteLabel", { name: parent.name })}
            deleteDisabled={
              parent.assetCount > 0 || parent.subCategoryCount > 0
            }
            deleteTitle={
              parent.assetCount > 0 || parent.subCategoryCount > 0
                ? t("deleteInUse")
                : undefined
            }
            onEdit={() => onEdit(parent)}
            onDelete={() => onDelete("category", parent)}
          />
        </TableCell>
      </TableRow>

      {children.map((child) => (
        <TableRow key={child.id}>
          <TableCell>
            <span className="ps-6 text-gray-700 dark:text-gray-300">
              {child.name}
            </span>
            {child.description && (
              <span className="mt-0.5 block ps-6 text-xs text-gray-500 dark:text-gray-400">
                {child.description}
              </span>
            )}
          </TableCell>
          <TableCell>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {t("subCategory")}
            </span>
          </TableCell>
          <TableCell>—</TableCell>
          <TableCell>{t("assetCount", { count: child.assetCount })}</TableCell>
          <TableCell>
            <RowActions
              editLabel={t("editLabel", { name: child.name })}
              deleteLabel={t("deleteLabel", { name: child.name })}
              deleteDisabled={child.assetCount > 0}
              deleteTitle={child.assetCount > 0 ? t("deleteInUse") : undefined}
              onEdit={() => onEdit(child)}
              onDelete={() => onDelete("category", child)}
            />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

/** Edit and delete, shared by both tables so the two cannot drift apart. */
function RowActions({
  editLabel,
  deleteLabel,
  deleteDisabled,
  deleteTitle,
  onEdit,
  onDelete,
}: {
  editLabel: string;
  deleteLabel: string;
  deleteDisabled: boolean;
  deleteTitle?: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={onEdit}
        aria-label={editLabel}
      >
        <PencilIcon className="size-4" />
      </Button>
      {/* Disabled rather than hidden, and the title says why: a row still in use
          cannot be removed without silently un-assigning what points at it,
          because the foreign keys are `on delete set null`. */}
      <span title={deleteTitle}>
        <Button
          size="sm"
          variant="outline"
          disabled={deleteDisabled}
          onClick={onDelete}
          aria-label={deleteLabel}
        >
          <TrashBinIcon className="size-4" />
        </Button>
      </span>
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { t } = useTranslation("common", { keyPrefix: "assetSettings" });
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

/** Shared bordered surface for the states that carry no list. */
function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500 dark:border-gray-800 dark:bg-white/3 dark:text-gray-400">
      {children}
    </div>
  );
}

/**
 * `23505` is `unique_violation`, the only code these inserts raise from a
 * uniqueness angle. Matched on the code rather than Postgres's wording, because
 * the wording names whichever constraint tripped, including the primary key, and
 * would not translate.
 */
function isDuplicateError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}
