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
import {
  ChevronDownIcon,
  CloseIcon,
  PencilIcon,
  PlusIcon,
  TrashBinIcon,
} from "@/icons";

import { getDepartmentOptions } from "@/modules/departments/services/departmentService";
import { getPositionOptions } from "@/modules/positions/services/positionService";
import type { PositionRef } from "@/modules/positions/services/positionService";
import { getAllUsers } from "@/modules/users/services/userService";

import {
  createCategory,
  createCurrentLocation,
  createHandoverUser,
  createLocation,
  deleteCategory,
  deleteCurrentLocation,
  deleteHandoverUser,
  deleteLocation,
  getCategoriesWithSubCategoryCounts,
  getCurrentLocations,
  getHandoverUsers,
  getLocations,
  updateCategory,
  updateCurrentLocation,
  updateHandoverUser,
  updateLocation,
  CategoryInUseError,
  CurrentLocationInUseError,
  HandoverUserInUseError,
  LocationInUseError,
  DEFAULT_DEPARTMENT,
  getCategoryUnits,
} from "../services/settingService";
import type {
  CategoryRow,
  CurrentLocationRow,
  HandoverUserRow,
  LocationRow,
} from "../services/settingService";
import type { DepartmentRef } from "@/lib/profiles";

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
 * **Four tabs rather than four pages**, because these are edited together: a
 * category is meaningless without knowing its sub-categories, and each list is
 * small enough to sit under one breadcrumb.
 *
 * **The delete buttons are disabled, not hidden, and the guard is in the
 * database too.** A category with assets or sub-categories cannot be removed,
 * because `assets.category_id` is `on delete set null` and the database would
 * otherwise un-assign every asset there without a word. `categories_guard_delete`
 * holds for any caller; the button state is only there so the admin is told why
 * before pressing it.
 */

/**
 * The four reference tables this screen administers.
 *
 * `handoverUsers` is the odd one out: it is not a place or a category but a
 * **roster of people a handover can be issued to**, and it is the only tab whose
 * rows carry an account link. It is read on every load like the others rather
 * than lazily, because `Promise.all` is already here and one more request on an
 * admin-only screen is not worth a second loading path.
 */
const TABS = [
  "categories",
  "locations",
  "currentLocations",
  "handoverUsers",
] as const;
type Tab = (typeof TABS)[number];

type CategoryForm = {
  name: string;
  description: string;
  parent_id: string;
  code: string;
  department: string;
};

/**
 * Which place table the shared modal is editing. `locations` is where an asset is
 * registered, `currentLocations` is where it physically is; the two tables have
 * the same shape and the admin manages them the same way.
 */
type PlaceKind = "location" | "currentLocation";

type LocationForm = {
  area_name: string;
  room_name: string;
  notes: string;
};

/**
 * One roster entry's editable fields.
 *
 * `department` holds the department **name**, not its id, and that is deliberate:
 * `getHandoverUsers` reads the row with `department:departments(name)` because the
 * name is what the table and the picker show, so carrying the name through the
 * form means an edit round-trips without a second lookup to render it. The id is
 * resolved back on save.
 *
 * `profileId` is the exception — an id, because that is what the row already holds
 * and `profile_id` is never displayed as a name. An empty `<Select>` is `""` and
 * `Select` has no other way to say "nothing chosen", so the service turns `""` into
 * `null` and the two never meet.
 */
type HandoverUserForm = {
  name: string;
  /**
   * A `positions` **id**, unlike `department` beside it which holds a name.
   *
   * The asymmetry is deliberate and it follows from what each row is read with.
   * `HandoverUserRow` carries both `positionId` (a uuid, for comparison) and
   * `position` (the resolved name, for display), so the form can round-trip the
   * id without a second lookup — while the department picker resolves a name
   * back to an id on save because the roster row is only read with the department's
   * *name*.
   *
   * Either would work. Storing the id is fewer moving parts.
   */
  positionId: string;
  department: string;
  profileId: string;
  notes: string;
};

const EMPTY_CATEGORY: CategoryForm = {
  name: "",
  description: "",
  parent_id: "",
  code: "",
  department: DEFAULT_DEPARTMENT,
};

const EMPTY_LOCATION: LocationForm = {
  area_name: "",
  room_name: "",
  notes: "",
};

const EMPTY_HANDOVER_USER: HandoverUserForm = {
  name: "",
  positionId: "",
  department: "",
  profileId: "",
  notes: "",
};

export default function AssetSettingsPage() {
  const { t } = useTranslation("common", { keyPrefix: "assetSettings" });
  const { isProfileLoading } = useAuth();
  const isAdmin = useIsAdmin();

  const [tab, setTab] = useState<Tab>("categories");
  const [department, setDepartment] = useState<string>(DEFAULT_DEPARTMENT);
  const [units, setUnits] = useState<string[]>([]);

  /**
   * The `departments` rows, kept as ids rather than only names.
   *
   * `units` above is the pinned IT/HSSE pair unioned with the same table, and it
   * is names-only because that is what the unit filter needs. This is the other
   * read of the same table, kept because a roster entry writes an id back and a
   * name cannot be resolved to one without a second query.
   */
  const [departments, setDepartments] = useState<DepartmentRef[]>([]);

  /**
   * The job titles the roster's position dropdown offers, loaded with everything
   * else rather than on modal open.
   *
   * Same reasoning as `departments` above: this is one more request on an
   * admin-only screen that already loads four, and a second loading path would be
   * a second thing to get wrong.
   */
  const [positions, setPositions] = useState<PositionRef[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [currentLocations, setCurrentLocations] = useState<
    CurrentLocationRow[]
  >([]);
  const [handoverUsers, setHandoverUsers] = useState<HandoverUserRow[]>([]);

  /**
   * Accounts the roster modal can link an entry to.
   *
   * `getAllUsers` rather than a dedicated read, because it is already the one
   * query that returns every profile and this screen is admin-only. It arrives as
   * `Profile[]` and is flattened here into the `{id,label}` shape `Select` wants,
   * so the modal holds options rather than domain objects.
   */
  const [linkableProfiles, setLinkableProfiles] = useState<
    { id: string; label: string }[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const categoryModal = useModal();
  const locationModal = useModal();
  /**
   * Its own modal rather than a fourth arm on the shared place modal.
   *
   * `PlaceKind` exists because two tables happen to share a shape. A person has
   * three fields the place form does not have and none of the fields it has, so
   * driving this through `PlaceKind` would mean a `PlaceKind` member that satisfies
   * neither shape — and a shared modal is exactly where a padding or a validation
   * fix ends up applied to one table and not the other.
   */
  const handoverUserModal = useModal();
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
  const [handoverUserForm, setHandoverUserForm] =
    useState<HandoverUserForm>(EMPTY_HANDOVER_USER);
  const [editingHandoverUserId, setEditingHandoverUserId] = useState<
    string | null
  >(null);
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: "category"; row: CategoryRow }
    | { kind: "location"; row: LocationRow }
    | { kind: "currentLocation"; row: CurrentLocationRow }
    | { kind: "handoverUser"; row: HandoverUserRow }
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
      getCurrentLocations(),
      getCategoryUnits(),
      getHandoverUsers(),
      // Admin-only, like every other read on this screen: `profiles_select_own_or_admin`
      // gives an admin every row. Only used to offer the account link in the
      // roster modal, and only the id and name are read.
      getAllUsers(),
      getDepartmentOptions(),
      getPositionOptions(),
    ]).then(
      ([
        categoryRows,
        locationRows,
        currentLocationRows,
        unitNames,
        handoverUserRows,
        profileRows,
        departmentRows,
        positionRows,
      ]) => {
        if (cancelled) return;
        setCategories(categoryRows);
        setLocations(locationRows);
        setCurrentLocations(currentLocationRows);
        setUnits(unitNames);
        setHandoverUsers(handoverUserRows);
        setDepartments(departmentRows);
        setPositions(positionRows);
        setLinkableProfiles(
          profileRows.map((row) => ({
            id: row.id,
            label: row.full_name || row.email || row.id,
          })),
        );
        setLoadFailed(false);
        setIsLoading(false);
      },
      () => {
        if (cancelled) return;
        setCategories([]);
        setLocations([]);
        setCurrentLocations([]);
        setUnits([]);
        setHandoverUsers([]);
        setDepartments([]);
        setPositions([]);
        setLoadFailed(true);
        setIsLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  /**
   * Only the parents of the unit on screen, both for the list and for the parent
   * picker in the modal.
   *
   * **The picker is filtered, not just the table**, because a sub-category must
   * be filed under a parent from its own unit —
   * `categories_parent_name_key` and `guard_category_parent` both enforce that, so
   * offering a cross-unit parent would only produce a `23514` the admin has to
   * decode.
   */
  const departmentCategories = useMemo(
    () => categories.filter((row) => row.department === department),
    [categories, department],
  );

  const departmentParents = useMemo(
    () => departmentCategories.filter((row) => !row.parentId),
    [departmentCategories],
  );

  const parentChoices = useMemo(
    () => departmentParents.map((row) => ({ value: row.id, label: row.name })),
    [departmentParents],
  );

  /** The sub-categories grouped under the parent, for the unit on screen. */
  const subCategoriesByParent = useMemo(() => {
    const map = new Map<string, CategoryRow[]>();
    for (const row of departmentCategories) {
      if (!row.parentId) continue;
      const list = map.get(row.parentId) ?? [];
      list.push(row);
      map.set(row.parentId, list);
    }
    return map;
  }, [departmentCategories]);

  /**
   * The unit dropdown is a live list, not a constant: `getCategoryUnits` unions
   * the pinned IT/HSSE with the `departments` table, so a department created in
   * User Management appears here on the next load. Labels fall back to the raw
   * name — only the pinned pair have i18n keys.
   */
  const departmentOptions = useMemo(
    () =>
      units.map((name) => ({
        value: name,
        label: t(`departments.${name}`, { defaultValue: name }),
      })),
    [units, t],
  );

  /**
   * Every department, with its id — the picker for a **person's** department.
   *
   * A different list from `departmentOptions` on purpose, and the difference is
   * the point. `departmentOptions` feeds the *unit* filter, whose values are the
   * pinned IT/HSSE pair the asset routes serve plus whatever `departments` holds.
   * A person's department has no such routing meaning, so this is every row and
   * nothing is pinned — a roster must be able to name a department that exists
   * for people and owns no category yet.
   *
   * Read from `getDepartmentOptions` rather than `getCategoryUnits` because that
   * one is what returns ids, and this picker needs to write one back.
   */
  const departmentChoices = useMemo(
    () => departments.map((row) => ({ value: row.id, label: row.name })),
    [departments],
  );

  /** The position dropdown's options, in the same `{value,label}` shape. */
  const positionChoices = useMemo(
    () => positions.map((row) => ({ value: row.id, label: row.name })),
    [positions],
  );

  /**
   * Which parents are collapsed, as a `Set` of ids.
   *
   * A `Set` rather than an object of booleans because the question it answers is
   * "is this one id collapsed", and a `Set` answers that without a scan. Being a
   * single value also means one functional update toggles or clears every group
   * without two of them racing.
   *
   * **Empty by default, so every group starts open.** The opposite default would
   * hide data behind a control on first sight, which is the confusion this
   * feature exists to remove; an admin who wants the compact view presses the
   * one button that collapses everything.
   */
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(
    () => new Set(),
  );

  /** Only the parents that actually have children, so a toggle is never a lie. */
  const collapsibleIds = useMemo(
    () =>
      departmentParents
        .filter((row) => (subCategoriesByParent.get(row.id) ?? []).length > 0)
        .map((row) => row.id),
    [departmentParents, subCategoriesByParent],
  );

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  /**
   * "Everything is closed" is measured against the ids that *can* be closed, not
   * against `collapsedIds.size`. A collapsed id that belongs to a category since
   * deleted would otherwise make the button claim all-closed while some group
   * still showed its children.
   */
  const allCollapsed =
    collapsibleIds.length > 0 &&
    collapsibleIds.every((id) => collapsedIds.has(id));

  const toggleAll = useCallback(() => {
    setCollapsedIds(allCollapsed ? new Set() : new Set(collapsibleIds));
  }, [allCollapsed, collapsibleIds]);

  const handleOpenCreateCategory = () => {
    setSaveError(null);
    setEditingCategoryId(null);
    // Prefilled with the unit on screen, so a new category lands in the list the
    // admin is looking at rather than in IT by default.
    setCategoryForm({ ...EMPTY_CATEGORY, department });
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
      department: row.department,
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
      const input = {
        name,
        description: categoryForm.description,
        parent_id: categoryForm.parent_id || null,
        code: code || null,
        department: categoryForm.department,
      };
      if (editingCategoryId) {
        await updateCategory(editingCategoryId, input);
        setNotice(t("categoryUpdated", { name }));
      } else {
        await createCategory(input);
        setNotice(t("categoryCreated", { name }));
      }
      categoryModal.closeModal();
      reload();
    } catch (error) {
      setSaveError(describeCategoryError(error, t));
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Which of the two place tables the shared location modal is editing.
   *
   * **One modal, two tables, rather than two modals.** `locations` and
   * `current_locations` are the same shape by design, so the form, the validation
   * and the error copy are all identical. A second modal would be the same markup
   * twice and would need its own fix whenever the fields change; the only thing
   * that differs is which service the save calls and which strings the headings
   * use, and both are read from this one flag.
   */
  const [placeKind, setPlaceKind] = useState<PlaceKind>("location");

  const handleOpenCreatePlace = (kind: PlaceKind) => {
    setSaveError(null);
    setPlaceKind(kind);
    setEditingLocationId(null);
    setLocationForm(EMPTY_LOCATION);
    locationModal.openModal();
  };

  const handleOpenEditPlace = (kind: PlaceKind, row: LocationRow) => {
    setSaveError(null);
    setPlaceKind(kind);
    setEditingLocationId(row.id);
    setLocationForm({
      area_name: row.area_name,
      room_name: row.room_name ?? "",
      notes: row.notes ?? "",
    });
    locationModal.openModal();
  };

  const handleSavePlace = async () => {
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

      if (placeKind === "currentLocation") {
        if (editingLocationId) {
          await updateCurrentLocation(editingLocationId, input);
          setNotice(t("currentLocationUpdated", { name: areaName }));
        } else {
          await createCurrentLocation(input);
          setNotice(t("currentLocationCreated", { name: areaName }));
        }
      } else if (editingLocationId) {
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

  const handleOpenCreateHandoverUser = () => {
    setSaveError(null);
    setEditingHandoverUserId(null);
    setHandoverUserForm(EMPTY_HANDOVER_USER);
    handoverUserModal.openModal();
  };

  const handleOpenEditHandoverUser = (row: HandoverUserRow) => {
    setSaveError(null);
    setEditingHandoverUserId(row.id);
    setHandoverUserForm({
      name: row.name,
      positionId: row.positionId,
      department: row.departmentName ?? "",
      profileId: row.profileId ?? "",
      notes: row.notes ?? "",
    });
    handoverUserModal.openModal();
  };

  /**
   * Name → id for the department picker.
   *
   * `getCategoryUnits()` returns `string[]` because that is what the unit *filter*
   * needs, and it is pinned to IT/HSSE plus the `departments` rows. For a person's
   * department that pinned pair is wrong — those two are the asset routes, not a
   * list of who works here — so the ids come from `departmentOptions` below rather
   * than being derived from a list shaped for a different question.
   */
  const departmentIdByName = useMemo(
    () => new Map(departmentChoices.map((row) => [row.label, row.value])),
    [departmentChoices],
  );

  const handleSaveHandoverUser = async () => {
    const name = handoverUserForm.name.trim();
    // Both are `not null` in the database — `name` by a blank check on the column,
    // `position_id` by the constraint `02200` added — so this is the same
    // validation as the price field in the asset form: catch it before the write so
    // the refusal names the box instead of arriving as a bare `23502`.
    if (name === "") {
      setSaveError(t("errors.handoverUserNameRequired"));
      return;
    }
    // An empty dropdown is `""`, which is not a `positions` id, so this is the
    // only place a missing position can be caught.
    if (handoverUserForm.positionId === "") {
      setSaveError(t("errors.handoverUserPositionRequired"));
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const input = {
        name,
        positionId: handoverUserForm.positionId,
        departmentId:
          departmentIdByName.get(handoverUserForm.department) ?? null,
        profileId: handoverUserForm.profileId || null,
        notes: handoverUserForm.notes,
      };

      if (editingHandoverUserId) {
        await updateHandoverUser(editingHandoverUserId, input);
        setNotice(t("handoverUserUpdated", { name }));
      } else {
        await createHandoverUser(input);
        setNotice(t("handoverUserCreated", { name }));
      }
      handoverUserModal.closeModal();
      reload();
    } catch {
      setSaveError(t("errors.save"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenDelete = (
    kind: "category" | "location" | "currentLocation" | "handoverUser",
    row: CategoryRow | LocationRow | HandoverUserRow,
  ) => {
    setDeleteError(null);
    // The union is keyed on `kind`, so one assignment has to be checked rather
    // than three. Each branch below re-narrows before using the row, so a
    // mismatched pair is a type error at the call site rather than here.
    switch (kind) {
      case "category":
        setPendingDelete({ kind, row: row as CategoryRow });
        break;
      case "location":
        setPendingDelete({ kind, row: row as LocationRow });
        break;
      case "currentLocation":
        setPendingDelete({ kind, row: row as CurrentLocationRow });
        break;
      case "handoverUser":
        setPendingDelete({ kind, row: row as HandoverUserRow });
        break;
    }
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
      } else if (pendingDelete.kind === "currentLocation") {
        const row = pendingDelete.row as CurrentLocationRow;
        await deleteCurrentLocation(row.id);
        setNotice(t("currentLocationDeleted", { name: row.area_name }));
      } else if (pendingDelete.kind === "handoverUser") {
        const row = pendingDelete.row as HandoverUserRow;
        await deleteHandoverUser(row.id);
        setNotice(t("handoverUserDeleted", { name: row.name }));
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
      } else if (error instanceof CurrentLocationInUseError) {
        setDeleteError(
          t("errors.currentLocationInUse", { count: error.assetCount }),
        );
      } else if (error instanceof HandoverUserInUseError) {
        setDeleteError(
          t("errors.handoverUserInUse", { count: error.handoverCount }),
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

  // Both place kinds read `area_name`, so one branch covers the two of them, the
  // category is the only row with a different name field, and a roster entry has
  // no place fields at all.
  const pendingName =
    pendingDelete?.kind === "category"
      ? (pendingDelete.row as CategoryRow).name
      : pendingDelete?.kind === "handoverUser"
        ? (pendingDelete.row as HandoverUserRow).name
        : pendingDelete?.kind === "currentLocation"
          ? (pendingDelete.row as CurrentLocationRow).area_name
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

          {/* The tab strip and the unit selector share one row, and on a phone
              the row wraps rather than becoming two full-width bars. The
              selector is here rather than in the table toolbar because it filters
              the table, not the page, and on a narrow screen the toolbar is where
              it collided with the Collapse and Add buttons.

              **The strip itself wraps too, and it has to.** Four tabs with labels
              this long do not fit a 360px screen on one line, and the three ways
              they can fail are all bad: `inline-flex` without `flex-wrap` clips
              the last tab off the card with nothing to scroll to; shrinking the
              buttons to fit wraps "Current locations" onto two lines inside its own
              pill so the row heights disagree; and a horizontal scroll hides the
              *selected* tab off-screen after the reader picks it. Wrapping between
              tabs is the only one where every tab stays reachable and the selected
              one stays visible. `w-full` below `sm` lets the strip take the line it
              needs instead of competing with the selector for the same row. */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div
              role="tablist"
              aria-label={t("tabsLabel")}
              className="flex w-full flex-wrap gap-1 rounded-lg bg-gray-100 p-1 sm:w-auto dark:bg-white/5"
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
                    // `whitespace-nowrap` on the label, not on the row: the strip
                    // wraps *between* tabs, and a label broken across two lines
                    // inside its own pill reads as a rendering fault.
                    //
                    // `px-3` below `sm` is what keeps it to **two** rows on a
                    // 360px phone instead of three. The four labels need ~497px
                    // against the ~272px available after the layout's own `p-4` and
                    // this card's `p-6`, so wrapping is unavoidable — and where the
                    // line breaks falls is decided purely by padding. At `px-4`
                    // (32px a tab) "User Handover" misses the second row by about
                    // 7px and lands alone on a third. At `px-3` (24px) both long
                    // labels fit side by side. `sm:px-4` restores the roomier
                    // desktop spacing, where the strip is one line anyway.
                    tab === key
                      ? "rounded-md bg-white px-3 py-2 text-sm font-medium whitespace-nowrap text-gray-900 shadow-theme-xs sm:px-4 dark:bg-white/10 dark:text-white"
                      : "rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap text-gray-500 hover:text-gray-700 sm:px-4 dark:text-gray-400 dark:hover:text-gray-200"
                  }
                >
                  {t(`tabs.${key}`)}
                </button>
              ))}
            </div>

            {/* Only while Categories is on screen. It filters the category list
                and nothing else, so leaving it visible over Locations would be a
                control that appears to do something and does not. */}
            {tab === "categories" && (
              <div className="w-full sm:w-48">
                <Select
                  key={`department-filter-${department}`}
                  id="category-department-filter"
                  aria-label={t("fields.departmentFilter")}
                  options={departmentOptions}
                  defaultValue={department}
                  onChange={(v) => setDepartment(v)}
                />
              </div>
            )}
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
                  <div className="sm:pe-6">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {t("categoriesHint")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
                    {/* Only rendered when there is something to collapse, so the
                        button is never a control with nothing to act on. */}
                    {collapsibleIds.length > 0 && (
                      <Button
                        variant="outline"
                        onClick={toggleAll}
                        startIcon={
                          <ChevronDownIcon
                            className={`size-4 transition-transform ${allCollapsed ? "-rotate-90" : ""}`}
                          />
                        }
                      >
                        {allCollapsed ? t("expandAll") : t("collapseAll")}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      onClick={handleOpenCreateCategory}
                      startIcon={<PlusIcon className="size-4" />}
                    >
                      {t("addCategory")}
                    </Button>
                  </div>
                </div>

                {/* The empty state names the unit it is about, because "no
                    categories" and "no categories in this unit" are different
                    facts and only one of them is a problem. */}
                {departmentParents.length === 0 ? (
                  <div className="flex flex-col items-start gap-4 p-6">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {t("emptyForDepartment", {
                        name: t(`departments.${department}`, {
                          defaultValue: department,
                        }),
                      })}
                    </p>
                    <Button
                      variant="outline"
                      onClick={handleOpenCreateCategory}
                      startIcon={<PlusIcon className="size-4" />}
                    >
                      {t("addCategory")}
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table className="min-w-[760px]">
                      <TableHeader>
                        <TableRow className="border-b border-gray-200 dark:border-gray-800">
                          <TableCell
                            isHeader
                            className="px-6 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                          >
                            {t("table.category")}
                          </TableCell>
                          <TableCell
                            isHeader
                            className="px-4 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                          >
                            {t("table.code")}
                          </TableCell>
                          <TableCell
                            isHeader
                            className="px-4 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                          >
                            {t("table.subCategories")}
                          </TableCell>
                          <TableCell
                            isHeader
                            className="px-4 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                          >
                            {t("table.assets")}
                          </TableCell>
                          <TableCell
                            isHeader
                            className="px-6 py-3 text-end text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                          >
                            {t("table.actions")}
                          </TableCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {departmentParents.map((parent) => {
                          const children =
                            subCategoriesByParent.get(parent.id) ?? [];
                          return (
                            <CategoryGroup
                              key={parent.id}
                              parent={parent}
                              children={children}
                              isCollapsed={collapsedIds.has(parent.id)}
                              onToggle={() => toggleCollapsed(parent.id)}
                              onEdit={handleOpenEditCategory}
                              onDelete={handleOpenDelete}
                            />
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>
            )}

            {tab === "locations" && (
              <section
                id="asset-settings-panel-locations"
                role="tabpanel"
                aria-labelledby="asset-settings-tab-locations"
              >
                {/* The hint is the flexible part and the buttons are not: a long
                    sentence beside short labels used to squeeze them until their
                    own labels wrapped onto two lines. `shrink-0` pins their
                    natural width. */}
                <div className="flex flex-col gap-4 border-b border-gray-200 p-6 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
                  <p className="text-sm text-gray-500 sm:pe-6 dark:text-gray-400">
                    {t("locationsHint")}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => handleOpenCreatePlace("location")}
                    startIcon={<PlusIcon className="size-4" />}
                    className="shrink-0 self-start sm:self-auto"
                  >
                    {t("addLocation")}
                  </Button>
                </div>

                <div className="overflow-x-auto">
                  <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow className="border-b border-gray-200 dark:border-gray-800">
                        <TableCell
                          isHeader
                          className="px-6 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                        >
                          {t("table.area")}
                        </TableCell>
                        <TableCell
                          isHeader
                          className="px-4 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                        >
                          {t("table.room")}
                        </TableCell>
                        <TableCell
                          isHeader
                          className="px-4 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                        >
                          {t("table.notes")}
                        </TableCell>
                        <TableCell
                          isHeader
                          className="px-4 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                        >
                          {t("table.assets")}
                        </TableCell>
                        <TableCell
                          isHeader
                          className="px-6 py-3 text-end text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                        >
                          {t("table.actions")}
                        </TableCell>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {locations.map((row) => (
                        <PlaceRow
                          key={row.id}
                          row={row}
                          onEdit={() => handleOpenEditPlace("location", row)}
                          onDelete={() => handleOpenDelete("location", row)}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            )}

            {tab === "currentLocations" && (
              <section
                id="asset-settings-panel-currentLocations"
                role="tabpanel"
                aria-labelledby="asset-settings-tab-currentLocations"
              >
                <div className="flex flex-col gap-4 border-b border-gray-200 p-6 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
                  <p className="text-sm text-gray-500 sm:pe-6 dark:text-gray-400">
                    {t("currentLocationsHint")}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => handleOpenCreatePlace("currentLocation")}
                    startIcon={<PlusIcon className="size-4" />}
                    className="shrink-0 self-start sm:self-auto"
                  >
                    {t("addCurrentLocation")}
                  </Button>
                </div>

                <div className="overflow-x-auto">
                  <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow className="border-b border-gray-200 dark:border-gray-800">
                        <TableCell
                          isHeader
                          className="px-6 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                        >
                          {t("table.area")}
                        </TableCell>
                        <TableCell
                          isHeader
                          className="px-4 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                        >
                          {t("table.room")}
                        </TableCell>
                        <TableCell
                          isHeader
                          className="px-4 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                        >
                          {t("table.notes")}
                        </TableCell>
                        <TableCell
                          isHeader
                          className="px-4 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                        >
                          {t("table.assets")}
                        </TableCell>
                        <TableCell
                          isHeader
                          className="px-6 py-3 text-end text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                        >
                          {t("table.actions")}
                        </TableCell>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {currentLocations.map((row) => (
                        <PlaceRow
                          key={row.id}
                          row={row}
                          onEdit={() =>
                            handleOpenEditPlace("currentLocation", row)
                          }
                          onDelete={() =>
                            handleOpenDelete("currentLocation", row)
                          }
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            )}
            {tab === "handoverUsers" && (
              <section
                id="asset-settings-panel-handoverUsers"
                role="tabpanel"
                aria-labelledby="asset-settings-tab-handoverUsers"
              >
                <div className="flex flex-col gap-4 border-b border-gray-200 p-6 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
                  <p className="text-sm text-gray-500 sm:pe-6 dark:text-gray-400">
                    {t("handoverUsersHint")}
                  </p>
                  <Button
                    variant="outline"
                    onClick={handleOpenCreateHandoverUser}
                    startIcon={<PlusIcon className="size-4" />}
                    className="shrink-0 self-start sm:self-auto"
                  >
                    {t("addHandoverUser")}
                  </Button>
                </div>

                {handoverUsers.length === 0 ? (
                  <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
                    {t("handoverUsersEmpty")}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table className="min-w-[860px]">
                      <TableHeader>
                        <TableRow className="border-b border-gray-200 dark:border-gray-800">
                          <TableCell
                            isHeader
                            className="px-6 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                          >
                            {t("table.handoverUserName")}
                          </TableCell>
                          <TableCell
                            isHeader
                            className="px-4 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                          >
                            {t("table.handoverUserPosition")}
                          </TableCell>
                          <TableCell
                            isHeader
                            className="px-4 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                          >
                            {t("table.handoverUserDepartment")}
                          </TableCell>
                          <TableCell
                            isHeader
                            className="px-4 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                          >
                            {t("table.handoverUserAccount")}
                          </TableCell>
                          <TableCell
                            isHeader
                            className="px-4 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                          >
                            {t("table.handoverUserHandovers")}
                          </TableCell>
                          <TableCell
                            isHeader
                            className="px-6 py-3 text-end text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                          >
                            {t("table.actions")}
                          </TableCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {handoverUsers.map((row) => (
                          <HandoverUserRowView
                            key={row.id}
                            row={row}
                            onEdit={() => handleOpenEditHandoverUser(row)}
                            onDelete={() =>
                              handleOpenDelete("handoverUser", row)
                            }
                          />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
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
              <Label htmlFor="setting-category-department">
                {t("fields.department")}{" "}
                <span className="text-error-500">*</span>
              </Label>
              <Select
                // Keyed on the row being edited: `Select` reads `defaultValue`
                // once, so a modal reused for a second category would keep
                // showing the first one's choice.
                key={`setting-department-${editingCategoryId ?? "new"}`}
                id="setting-category-department"
                options={departmentOptions}
                defaultValue={categoryForm.department}
                onChange={(v) =>
                  setCategoryForm((prev) => ({ ...prev, department: v }))
                }
              />
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                {t("fields.departmentHint")}
              </p>
            </div>

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
            {placeKind === "currentLocation"
              ? editingLocationId
                ? t("editCurrentLocationTitle")
                : t("addCurrentLocation")
              : editingLocationId
                ? t("editLocationTitle")
                : t("addLocation")}
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
            <Button onClick={handleSavePlace} disabled={isSaving}>
              {isSaving ? t("saving") : t("save")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={handoverUserModal.isOpen}
        onClose={handoverUserModal.closeModal}
        className="max-w-lg"
      >
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {editingHandoverUserId
              ? t("editHandoverUserTitle")
              : t("addHandoverUser")}
          </h3>

          <div className="mt-5 space-y-4">
            <div>
              <Label htmlFor="setting-handover-user-name">
                {t("table.handoverUserName")}{" "}
                <span className="text-error-500">*</span>
              </Label>
              <Input
                id="setting-handover-user-name"
                name="name"
                value={handoverUserForm.name}
                onChange={(event) =>
                  setHandoverUserForm((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
                placeholder={t("fields.handoverUserNamePlaceholder")}
                autoFocus
              />
            </div>

            <div>
              <Label htmlFor="setting-handover-user-position">
                {t("table.handoverUserPosition")}{" "}
                <span className="text-error-500">*</span>
              </Label>
              {/* A dropdown of the admin-managed list, not a text box. That was
                  the point of `02200`: free text could only hold the positions
                  somebody remembered to type, so `Technician` and `technician`
                  were two entries with nothing able to tell them apart.

                  No "type a new one here" path on purpose — a typo typed into a
                  box becomes a position of its own, permanently, which is the
                  exact failure the table exists to remove. Adding a title means a
                  deliberate trip to the Position list.

                  Keyed on the editing id *and* the current value, like the
                  department picker below: `Select` reads `defaultValue` once, so
                  an unkeyed one would keep showing whatever it mounted with after
                  an edit opened the modal on a different row. */}
              <Select
                key={`handover-user-position-${
                  editingHandoverUserId ?? "new"
                }-${handoverUserForm.positionId}`}
                id="setting-handover-user-position"
                options={[
                  { value: "", label: t("fields.choosePosition") },
                  ...positionChoices,
                ]}
                defaultValue={handoverUserForm.positionId}
                onChange={(value) =>
                  setHandoverUserForm((prev) => ({
                    ...prev,
                    positionId: value,
                  }))
                }
              />
              {positionChoices.length === 0 ? (
                <p className="mt-1.5 text-xs text-warning-600 dark:text-warning-500">
                  {t("fields.noPositionsYet")}
                </p>
              ) : (
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                  {t("fields.handoverUserPositionHint")}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="setting-handover-user-department">
                {t("table.handoverUserDepartment")}{" "}
                <span className="text-sm font-normal text-gray-400 dark:text-gray-500">
                  ({t("optional")})
                </span>
              </Label>
              {/* Keyed on the current value: `Select` reads `defaultValue` once, so
                  an unkeyed one would keep showing whatever it mounted with after
                  an edit opened the modal on a different row. */}
              <Select
                key={`handover-user-department-${
                  editingHandoverUserId ?? "new"
                }-${handoverUserForm.department}`}
                id="setting-handover-user-department"
                options={[
                  { value: "", label: t("noDepartment") },
                  ...departmentChoices,
                ]}
                defaultValue={handoverUserForm.department}
                onChange={(value) =>
                  setHandoverUserForm((prev) => ({
                    ...prev,
                    department: value,
                  }))
                }
              />
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                {t("fields.handoverUserDepartmentHint")}
              </p>
            </div>

            <div>
              <Label htmlFor="setting-handover-user-account">
                {t("table.handoverUserAccount")}{" "}
                <span className="text-sm font-normal text-gray-400 dark:text-gray-500">
                  ({t("optional")})
                </span>
              </Label>
              <Select
                key={`handover-user-account-${
                  editingHandoverUserId ?? "new"
                }-${handoverUserForm.profileId}`}
                id="setting-handover-user-account"
                options={[
                  { value: "", label: t("fields.noAccount") },
                  ...linkableProfiles.map((row) => ({
                    value: row.id,
                    label: row.label,
                  })),
                ]}
                defaultValue={handoverUserForm.profileId}
                onChange={(value) =>
                  setHandoverUserForm((prev) => ({
                    ...prev,
                    profileId: value,
                  }))
                }
              />
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                {t("fields.handoverUserAccountHint")}
              </p>
            </div>

            <div>
              <Label htmlFor="setting-handover-user-notes">
                {t("fields.notes")}{" "}
                <span className="text-sm font-normal text-gray-400 dark:text-gray-500">
                  ({t("optional")})
                </span>
              </Label>
              <TextArea
                id="setting-handover-user-notes"
                rows={2}
                value={handoverUserForm.notes}
                onChange={(v) =>
                  setHandoverUserForm((prev) => ({ ...prev, notes: v }))
                }
                placeholder={t("fields.handoverUserNotesPlaceholder")}
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
              onClick={handoverUserModal.closeModal}
              disabled={isSaving}
            >
              {t("cancel")}
            </Button>
            <Button onClick={handleSaveHandoverUser} disabled={isSaving}>
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
 * One parent row plus its sub-category rows, which collapse under it.
 *
 * Rendered as a fragment rather than nested markup because a `<Table>` cannot
 * hold a `<div>`, and the sub-categories are visibly indented children of the row
 * above rather than peers of it.
 *
 * **A parent with no sub-categories has no toggle at all**, not a disabled one:
 * there is nothing to open, and a control that looks like it should work but
 * does not is the same confusion the collapse is meant to remove.
 */
function CategoryGroup({
  parent,
  children,
  isCollapsed,
  onToggle,
  onEdit,
  onDelete,
}: {
  parent: CategoryRow;
  children: CategoryRow[];
  isCollapsed: boolean;
  onToggle: () => void;
  onEdit: (row: CategoryRow) => void;
  onDelete: (kind: "category", row: CategoryRow) => void;
}) {
  const { t } = useTranslation("common", { keyPrefix: "assetSettings" });
  const hasChildren = children.length > 0;

  return (
    <>
      <TableRow className="border-b border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-white/3">
        <TableCell className="px-6 py-3">
          <div className="flex items-center gap-2">
            {hasChildren ? (
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={!isCollapsed}
                // Names the group the toggle controls, which is what a screen
                // reader needs to say "collapsed COMPUTER" rather than a bare
                // "collapsed".
                aria-label={
                  isCollapsed
                    ? t("expandLabel", { name: parent.name })
                    : t("collapseLabel", { name: parent.name })
                }
                className="shrink-0 rounded p-0.5 text-gray-500 transition-transform hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white/90"
              >
                <ChevronDownIcon
                  className={`size-4 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                />
              </button>
            ) : (
              // Keeps the name on the same left edge whether or not there is a
              // toggle, so the two kinds of row stay aligned.
              <span className="size-5 shrink-0" aria-hidden="true" />
            )}

            <span className="min-w-0">
              <span className="font-medium text-gray-800 dark:text-white/90">
                {parent.name}
              </span>
              {parent.description && (
                <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                  {parent.description}
                </span>
              )}
            </span>
          </div>
        </TableCell>
        <TableCell className="px-4 py-3">
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
        <TableCell className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
          {t("subCategoryCount", { count: parent.subCategoryCount })}
        </TableCell>
        <TableCell className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
          {t("assetCount", { count: parent.assetCount })}
        </TableCell>
        <TableCell className="px-6 py-3 text-end">
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

      {/* Not `hidden` on the rows: a collapsed group is removed from the table
          entirely, so it is absent from a screen reader's row count and from
          Ctrl-F, rather than present but invisible. */}
      {!isCollapsed &&
        children.map((child) => (
          <TableRow
            key={child.id}
            className="border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-white/3"
          >
            {/* `ps-9` rather than stacking on `px-6`: Tailwind emits both as
                `padding-inline-start` and the later-declared one in the
                stylesheet wins, so two logical-direction utilities on one element
                resolve by stylesheet order rather than by the order written
                here. */}
            <TableCell className="py-3 ps-9 pe-4">
              <span className="text-gray-700 dark:text-gray-300">
                {child.name}
              </span>
              {child.description && (
                <span className="mt-0.5 block ps-9 text-xs text-gray-500 dark:text-gray-400">
                  {child.description}
                </span>
              )}
            </TableCell>
            <TableCell className="px-4 py-3">
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {t("subCategory")}
              </span>
            </TableCell>
            <TableCell className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500">
              —
            </TableCell>
            <TableCell className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
              {t("assetCount", { count: child.assetCount })}
            </TableCell>
            <TableCell className="px-6 py-3 text-end">
              <RowActions
                editLabel={t("editLabel", { name: child.name })}
                deleteLabel={t("deleteLabel", { name: child.name })}
                deleteDisabled={child.assetCount > 0}
                deleteTitle={
                  child.assetCount > 0 ? t("deleteInUse") : undefined
                }
                onEdit={() => onEdit(child)}
                onDelete={() => onDelete("category", child)}
              />
            </TableCell>
          </TableRow>
        ))}
    </>
  );
}

/**
 * One row of either place table.
 *
 * Extracted rather than written twice: the two tables are the same shape by
 * design, and a copy of these five cells is a copy that gets a padding fix in
 * one table and not the other. The only thing that varies is the callbacks, so
 * the row takes them as props and knows nothing about which table it is in.
 */
function PlaceRow({
  row,
  onEdit,
  onDelete,
}: {
  row: LocationRow;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("common", { keyPrefix: "assetSettings" });

  return (
    <TableRow className="border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-white/3">
      <TableCell className="px-6 py-3 text-sm font-medium text-gray-800 dark:text-white/90">
        {row.area_name}
      </TableCell>
      <TableCell className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
        {row.room_name ?? t("noRoom")}
      </TableCell>
      <TableCell className="px-4 py-3 text-sm">
        <span className="text-gray-500 dark:text-gray-400">
          {row.notes ?? "—"}
        </span>
      </TableCell>
      <TableCell className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
        {t("assetCount", { count: row.assetCount })}
      </TableCell>
      <TableCell className="px-6 py-3 text-end">
        <RowActions
          editLabel={t("editLabel", { name: row.area_name })}
          deleteLabel={t("deleteLabel", { name: row.area_name })}
          deleteDisabled={row.assetCount > 0}
          deleteTitle={row.assetCount > 0 ? t("deleteInUse") : undefined}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </TableCell>
    </TableRow>
  );
}

/**
 * One row of the handover roster.
 *
 * Its own component rather than a `PlaceKind` arm, because it shares nothing with
 * the place tables: no `area_name`, no `room_name`, and its last-but-one column is
 * an account link rather than an asset count.
 *
 * **The account cell is the one column that can read as a refusal.** Most rows
 * have no linked account — that is the normal case for a contractor or a visitor,
 * and the table has to say so rather than leave a blank cell that looks like a
 * failed load. The badge reads "no account" instead of an em dash for that reason.
 */
function HandoverUserRowView({
  row,
  onEdit,
  onDelete,
}: {
  row: HandoverUserRow;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("common", { keyPrefix: "assetSettings" });

  return (
    <TableRow className="border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-white/3">
      <TableCell className="px-6 py-3 text-sm font-medium text-gray-800 dark:text-white/90">
        {row.name}
      </TableCell>
      <TableCell className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
        {row.position}
      </TableCell>
      <TableCell className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
        {row.departmentName ?? t("noDepartment")}
      </TableCell>
      <TableCell className="px-4 py-3">
        {row.profileId ? (
          <Badge size="sm" color="light">
            {row.profileName ?? row.profileId}
          </Badge>
        ) : (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("handoverUserNoAccount")}
          </span>
        )}
      </TableCell>
      <TableCell className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
        {t("handoverCount", { count: row.handoverCount })}
      </TableCell>
      <TableCell className="px-6 py-3 text-end">
        <RowActions
          editLabel={t("editLabel", { name: row.name })}
          deleteLabel={t("deleteLabel", { name: row.name })}
          deleteDisabled={row.handoverCount > 0}
          deleteTitle={
            row.handoverCount > 0 ? t("deleteHandoverUserInUse") : undefined
          }
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </TableCell>
    </TableRow>
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
 * Turns a save failure into something the admin can act on.
 *
 * The three cases worth naming are all reachable from this form, and each would
 * otherwise surface as one generic "could not save":
 *
 * - `23505` — the name already exists **within this unit**. Now that uniqueness
 *   is per-department, the same name is fine in another unit, so the message says
 *   which unit rather than implying the name is taken globally.
 * - `23514` with the cross-department message — a sub-category filed under a
 *   parent from another unit. The form filters the parent picker to the unit, so
 *   this is a race or a stale modal, and saying so beats a generic failure.
 * - `23514` from the department-change guard — a parent moved between units
 *   while it still has sub-categories.
 */
function describeCategoryError(
  error: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (isDuplicateError(error)) return t("errors.duplicateInUnit");
  if (isCheckViolation(error)) {
    const message = errorMessage(error);
    if (message.includes("same department")) return t("errors.crossDepartment");
    if (message.includes("sub-categories first"))
      return t("errors.moveWithChildren");
  }
  return t("errors.save");
}

/** `23505` is `unique_violation`. Matched on the code, not the wording. */
function isDuplicateError(error: unknown): boolean {
  return postgresCode(error) === "23505";
}

/** `23514` is `check_violation`, which is what every guard in here raises. */
function isCheckViolation(error: unknown): boolean {
  return postgresCode(error) === "23514";
}

function postgresCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? ((error as { code?: string }).code ?? undefined)
    : undefined;
}

function errorMessage(error: unknown): string {
  return typeof error === "object" && error !== null && "message" in error
    ? String((error as { message?: unknown }).message)
    : "";
}
