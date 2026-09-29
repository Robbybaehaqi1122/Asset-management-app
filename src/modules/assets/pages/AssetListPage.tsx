import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import PageMeta from "@/components/common/PageMeta";
import Label from "@/components/form/Label";
import Input from "@/components/form/input/InputField";
import TextArea from "@/components/form/input/TextArea";
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
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useModal } from "@/hooks/useModal";
import { CloseIcon, PencilIcon, PlusIcon, TrashBinIcon } from "@/icons";

import {
  createAsset,
  deleteAsset,
  getAssets,
  getAssetFilterOptions,
  setAssetStatus,
  updateAsset,
  AssetInUseError,
} from "../services/assetService";
import type {
  Asset,
  AssetCondition,
  AssetInput,
  AssetRef,
  AssetStatus,
  CategoryOption,
  SelectableAssetStatus,
} from "../services/assetService";

/**
 * The IT asset inventory: what exists, what it is, and where it is.
 *
 * **Not admin-only, and that is the opposite of the user list.** Stock belongs to
 * the company rather than to one department, and `assets_select_authenticated`
 * is `using (true)`, so a staff member gets the same rows an admin does. What
 * they do not get is `credentials`: the password is in a table RLS hides from
 * them, so it is not in the response to begin with. The only difference between
 * the two roles on this screen is the Credentials tab and the write actions.
 *
 * **The status column is not editable here.** `available` and `assigned` are
 * derived from the loans and `assets_guard_status` rejects a write that
 * disagrees with them, so a form that offered `assigned` would be offering a
 * value the database will refuse and the admin cannot act on. Status changes go
 * through a separate control offering only the three values nobody can derive.
 *
 * **The form is five tabs because it is ~30 fields.** A single scrolling form
 * with 30 inputs is one nobody finishes, and the fields a person is nearly always
 * typing are the ones that end up at the top. Identity opens by default.
 */

/** Every field the form owns, as strings. Controlled inputs want strings. */
type AssetForm = {
  asset_code: string;
  name: string;
  description: string;
  condition: AssetCondition;
  category_id: string;
  location_id: string;
  purchase_date: string;
  purchase_price: string;
  supplier: string;
  po_number: string;
  serial_number: string;
  short_name: string;
  manufacture: string;
  model_name: string;
  model_type: string;
  ownership: string;
  asset_pic: string;
  handover_doc_no: string;
  is_labeled: boolean;
  hostname: string;
  ip_wifi: string;
  ip_eth: string;
  mac_wifi: string;
  mac_eth: string;
  os_or_firmware_version: string;
  product_key: string;
  processor_spec: string;
  ram_spec: string;
  storage_spec: string;
  display_spec: string;
  credential_username: string;
  credential_password: string;
};

const EMPTY_FORM: AssetForm = {
  asset_code: "",
  name: "",
  description: "",
  condition: "good",
  category_id: "",
  location_id: "",
  purchase_date: "",
  purchase_price: "",
  supplier: "",
  po_number: "",
  serial_number: "",
  short_name: "",
  manufacture: "",
  model_name: "",
  model_type: "",
  ownership: "",
  asset_pic: "",
  handover_doc_no: "",
  is_labeled: false,
  hostname: "",
  ip_wifi: "",
  ip_eth: "",
  mac_wifi: "",
  mac_eth: "",
  os_or_firmware_version: "",
  product_key: "",
  processor_spec: "",
  ram_spec: "",
  storage_spec: "",
  display_spec: "",
  credential_username: "",
  credential_password: "",
};

/** Credentials are omitted when the tab was never opened on an existing asset. */
function formFromAsset(asset: Asset): AssetForm {
  return {
    asset_code: asset.asset_code,
    name: asset.name,
    description: asset.description ?? "",
    condition: asset.condition,
    category_id: asset.category_id ?? "",
    location_id: asset.location_id ?? "",
    purchase_date: asset.purchase_date ?? "",
    purchase_price:
      asset.purchase_price === null ? "" : String(asset.purchase_price),
    supplier: asset.supplier ?? "",
    po_number: asset.po_number ?? "",
    serial_number: asset.serial_number ?? "",
    short_name: asset.short_name ?? "",
    manufacture: asset.manufacture ?? "",
    model_name: asset.model_name ?? "",
    model_type: asset.model_type ?? "",
    ownership: asset.ownership ?? "",
    asset_pic: asset.asset_pic ?? "",
    handover_doc_no: asset.handover_doc_no ?? "",
    is_labeled: asset.is_labeled,
    hostname: asset.hostname ?? "",
    ip_wifi: asset.ip_wifi ?? "",
    ip_eth: asset.ip_eth ?? "",
    mac_wifi: asset.mac_wifi ?? "",
    mac_eth: asset.mac_eth ?? "",
    os_or_firmware_version: asset.os_or_firmware_version ?? "",
    product_key: asset.product_key ?? "",
    processor_spec: asset.processor_spec ?? "",
    ram_spec: asset.ram_spec ?? "",
    storage_spec: asset.storage_spec ?? "",
    display_spec: asset.display_spec ?? "",
    // Null for a staff member, so this stays empty rather than showing a blank
    // that looks like a stored-but-empty credential.
    credential_username: asset.credentials?.username ?? "",
    credential_password: asset.credentials?.password ?? "",
  };
}

/** The two required fields, the price, and the two credential boxes. */
function toInput(form: AssetForm, includeCredentials: boolean): AssetInput {
  const price = form.purchase_price.trim();

  return {
    asset_code: form.asset_code,
    name: form.name,
    description: form.description || null,
    condition: form.condition,
    category_id: form.category_id || null,
    location_id: form.location_id || null,
    purchase_date: form.purchase_date || null,
    // An empty box is "not recorded", not zero. NaN means the box holds
    // something that is not a number, which the column check would refuse.
    purchase_price:
      price === "" || Number.isNaN(Number(price)) ? null : Number(price),
    supplier: form.supplier || null,
    po_number: form.po_number || null,
    serial_number: form.serial_number || null,
    short_name: form.short_name || null,
    manufacture: form.manufacture || null,
    model_name: form.model_name || null,
    model_type: form.model_type || null,
    ownership: form.ownership || null,
    asset_pic: form.asset_pic || null,
    handover_doc_no: form.handover_doc_no || null,
    is_labeled: form.is_labeled,
    hostname: form.hostname || null,
    ip_wifi: form.ip_wifi || null,
    ip_eth: form.ip_eth || null,
    mac_wifi: form.mac_wifi || null,
    mac_eth: form.mac_eth || null,
    os_or_firmware_version: form.os_or_firmware_version || null,
    product_key: form.product_key || null,
    processor_spec: form.processor_spec || null,
    ram_spec: form.ram_spec || null,
    storage_spec: form.storage_spec || null,
    display_spec: form.display_spec || null,
    credentials: includeCredentials
      ? {
          username: form.credential_username || null,
          password: form.credential_password || null,
        }
      : null,
  };
}

const SECTIONS = [
  "identity",
  "specification",
  "network",
  "credentials",
  "administration",
] as const;
type Section = (typeof SECTIONS)[number];

/** Badge colour per status. Values come from the column's check constraint. */
const STATUS_COLOR: Record<
  AssetStatus,
  "success" | "warning" | "error" | "info" | "light"
> = {
  available: "success",
  assigned: "info",
  maintenance: "warning",
  damaged: "error",
  retired: "light",
};

const CONDITION_COLOR: Record<
  AssetCondition,
  "success" | "warning" | "error" | "info" | "light"
> = {
  new: "info",
  good: "success",
  fair: "warning",
  poor: "error",
  broken: "error",
};

export default function AssetListPage() {
  const { t } = useTranslation("common", { keyPrefix: "assets" });
  const isAdmin = useIsAdmin();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [locations, setLocations] = useState<AssetRef[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterLocation, setFilterLocation] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const formModal = useModal();
  const statusModal = useModal();
  const deleteModal = useModal();

  const [form, setForm] = useState<AssetForm>(EMPTY_FORM);
  const [section, setSection] = useState<Section>("identity");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [pendingStatus, setPendingStatus] = useState<Asset | null>(null);
  const [nextStatus, setNextStatus] =
    useState<SelectableAssetStatus>("maintenance");
  const [pendingDelete, setPendingDelete] = useState<Asset | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((prev) => prev + 1), []);

  useEffect(() => {
    // `cancelled` covers a sign-out landing while the reads are in flight.
    let cancelled = false;

    void Promise.all([getAssets(), getAssetFilterOptions()]).then(
      ([rows, options]) => {
        if (cancelled) return;
        setAssets(rows);
        setCategories(options.categories);
        setLocations(options.locations);
        setLoadFailed(false);
        setIsLoading(false);
      },
      () => {
        if (cancelled) return;
        setLoadFailed(true);
        setIsLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const set = useCallback(
    <K extends keyof AssetForm>(key: K, value: AssetForm[K]) =>
      setForm((prev) => ({ ...prev, [key]: value })),
    [],
  );

  /**
   * The category picker reads as "Laptop / Laptop Pro" for a sub-category and
   * plain "Laptop" for a top-level one, which is the only place a person can
   * tell two same-named categories apart.
   */
  const categoryOptions = useMemo(
    () =>
      categories.map((option) => ({
        value: option.id,
        label: option.parentName
          ? `${option.parentName} / ${option.name}`
          : option.name,
      })),
    [categories],
  );

  /**
   * Filtering in the browser, on purpose. `getAssets` is a plain ordered read
   * and the inventory is a few hundred rows; a query per keystroke would be
   * slower and would need the filter state to survive a reload. This is the same
   * approach the user list takes.
   */
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return assets.filter((row) => {
      if (filterCategory && row.category_id !== filterCategory) return false;
      if (filterLocation && row.location_id !== filterLocation) return false;
      if (filterStatus && row.status !== filterStatus) return false;
      if (needle === "") return true;

      return [
        row.asset_code,
        row.name,
        row.serial_number,
        row.short_name,
        row.hostname,
        row.manufacture,
        row.model_name,
        row.asset_pic,
        row.category?.name,
        row.location?.name,
      ]
        .filter((v): v is string => typeof v === "string")
        .some((v) => v.toLowerCase().includes(needle));
    });
  }, [assets, search, filterCategory, filterLocation, filterStatus]);

  const handleOpenCreate = () => {
    setForm(EMPTY_FORM);
    setSection("identity");
    setEditingId(null);
    setSaveError(null);
    formModal.openModal();
  };

  const handleOpenEdit = (row: Asset) => {
    setForm(formFromAsset(row));
    setSection("identity");
    setEditingId(row.id);
    setSaveError(null);
    formModal.openModal();
  };

  const handleSave = async () => {
    const assetCode = form.asset_code.trim();
    const name = form.name.trim();

    // Checked for an immediate message, and again by the unique index, which is
    // the one that has to be believed: two admins in two tabs can both pass this.
    if (assetCode === "") {
      setSaveError(t("errors.assetCodeRequired"));
      return;
    }
    if (name === "") {
      setSaveError(t("errors.nameRequired"));
      return;
    }
    if (
      form.purchase_price.trim() !== "" &&
      Number.isNaN(Number(form.purchase_price))
    ) {
      setSaveError(t("errors.priceInvalid"));
      return;
    }

    // Only send credentials from the form when this session is allowed to see
    // them at all. For a staff member the tab is hidden and the stored value is
    // null, so sending it would blank a password they cannot read.
    const includeCredentials = isAdmin;

    setIsSaving(true);
    setSaveError(null);
    try {
      const input = toInput(form, includeCredentials);
      if (editingId) {
        await updateAsset(editingId, input);
      } else {
        await createAsset(input);
      }
      formModal.closeModal();
      setNotice(
        t(editingId ? "updated" : "created", { name: form.name.trim() }),
      );
      reload();
    } catch (error) {
      setSaveError(
        isDuplicateError(error) ? t("errors.duplicateCode") : t("errors.save"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenStatus = (row: Asset) => {
    setStatusError(null);
    // An asset out on loan is `assigned`, which is not in this list. Defaulting
    // to `maintenance` is the safe landing spot: it is the one status a person
    // most often needs to set by hand, and it is never the loans' to decide.
    setNextStatus(row.status === "assigned" ? "maintenance" : row.status);
    setPendingStatus(row);
    statusModal.openModal();
  };

  const handleConfirmStatus = async () => {
    if (!pendingStatus) return;

    setIsSaving(true);
    setStatusError(null);
    try {
      await setAssetStatus(pendingStatus.id, nextStatus);
      statusModal.closeModal();
      setNotice(
        t("statusChanged", {
          name: pendingStatus.name,
          status: t(`status.${nextStatus}`),
        }),
      );
      reload();
    } catch (error) {
      setStatusError(
        isCheckViolation(error)
          ? t("errors.statusContradictsLoans")
          : t("errors.save"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenDelete = (row: Asset) => {
    setDeleteError(null);
    setPendingDelete(row);
    deleteModal.openModal();
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;

    setIsSaving(true);
    setDeleteError(null);
    try {
      await deleteAsset(pendingDelete.id);
      deleteModal.closeModal();
      setNotice(t("deleted", { name: pendingDelete.name }));
      reload();
    } catch (error) {
      // A refusal, not a failure, and the counts are what tell the admin why:
      // the asset has to come back from whoever is holding it, or its history
      // has to be accepted as lost, before this button does anything.
      if (error instanceof AssetInUseError) {
        setDeleteError(
          t("errors.inUse", {
            name: pendingDelete.name,
            assignments: error.assignmentCount,
            maintenance: error.maintenanceCount,
          }),
        );
      } else {
        setDeleteError(t("errors.delete"));
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <PageMeta
        title={`${t("pageTitle")} | Asset Management App`}
        description={t("pageDescription")}
      />
      <PageBreadcrumb pageTitle={t("pageTitle")} />

      {/* Outside any modal: the outcome is raised after the modal closed, and
          `Modal` returns null while closed, so a message inside would never be
          seen. */}
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

      <div className="mt-4 rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/3">
        <div className="flex flex-col gap-4 border-b border-gray-200 p-6 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              {t("pageTitle")}
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t("subtitle")}
            </p>
          </div>

          {isAdmin && (
            <Button
              variant="outline"
              onClick={handleOpenCreate}
              startIcon={<PlusIcon className="size-4" />}
            >
              {t("addAsset")}
            </Button>
          )}
        </div>

        {/* Filters. Staff see these too, because stock is not admin-only. */}
        <div className="grid grid-cols-1 gap-4 border-b border-gray-200 p-6 sm:grid-cols-2 lg:grid-cols-4 dark:border-gray-800">
          <div>
            <Label htmlFor="asset-search">{t("filters.search")}</Label>
            <Input
              id="asset-search"
              name="asset-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("filters.searchPlaceholder")}
            />
          </div>

          <div>
            <Label htmlFor="asset-filter-category">
              {t("filters.category")}
            </Label>
            <Select
              key={`cat-${filterCategory}`}
              id="asset-filter-category"
              options={categoryOptions}
              placeholder={t("filters.allCategories")}
              defaultValue={filterCategory}
              onChange={setFilterCategory}
            />
          </div>

          <div>
            <Label htmlFor="asset-filter-location">
              {t("filters.location")}
            </Label>
            <Select
              key={`loc-${filterLocation}`}
              id="asset-filter-location"
              options={locations.map((l) => ({ value: l.id, label: l.name }))}
              placeholder={t("filters.allLocations")}
              defaultValue={filterLocation}
              onChange={setFilterLocation}
            />
          </div>

          <div>
            <Label htmlFor="asset-filter-status">{t("filters.status")}</Label>
            <Select
              key={`st-${filterStatus}`}
              id="asset-filter-status"
              options={(
                [
                  "available",
                  "assigned",
                  "maintenance",
                  "damaged",
                  "retired",
                ] as const
              ).map((s) => ({ value: s, label: t(`status.${s}`) }))}
              placeholder={t("filters.allStatuses")}
              defaultValue={filterStatus}
              onChange={setFilterStatus}
            />
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
        ) : assets.length === 0 ? (
          <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
            {t("empty")}
          </p>
        ) : visible.length === 0 ? (
          <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
            {t("noMatches")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow className="border-b border-gray-200 dark:border-gray-800">
                  <TableCell
                    isHeader
                    className="px-6 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                  >
                    {t("table.assetCode")}
                  </TableCell>
                  <TableCell
                    isHeader
                    className="px-4 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                  >
                    {t("table.name")}
                  </TableCell>
                  <TableCell
                    isHeader
                    className="px-4 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                  >
                    {t("table.category")}
                  </TableCell>
                  <TableCell
                    isHeader
                    className="px-4 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                  >
                    {t("table.location")}
                  </TableCell>
                  <TableCell
                    isHeader
                    className="px-4 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                  >
                    {t("table.status")}
                  </TableCell>
                  <TableCell
                    isHeader
                    className="px-4 py-3 text-start text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                  >
                    {t("table.condition")}
                  </TableCell>
                  {isAdmin && (
                    <TableCell
                      isHeader
                      className="px-6 py-3 text-end text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                    >
                      {t("table.actions")}
                    </TableCell>
                  )}
                </TableRow>
              </TableHeader>

              <TableBody>
                {visible.map((row) => (
                  <TableRow
                    key={row.id}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-white/3"
                  >
                    <TableCell className="font-mono px-6 py-3 text-xs text-gray-700 dark:text-gray-300">
                      {row.asset_code}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <p className="font-medium text-gray-800 dark:text-white/90">
                        {row.name}
                      </p>
                      {row.hostname && (
                        <p className="font-mono mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                          {row.hostname}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                      {row.category?.name ?? "—"}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                      {row.location?.name ?? "—"}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <Badge size="sm" color={STATUS_COLOR[row.status]}>
                        {t(`status.${row.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <Badge
                        size="sm"
                        variant="light"
                        color={CONDITION_COLOR[row.condition]}
                      >
                        {t(`condition.${row.condition}`)}
                      </Badge>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="px-6 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenEdit(row)}
                            aria-label={t("editLabel", { name: row.name })}
                          >
                            <PencilIcon className="size-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenStatus(row)}
                            aria-label={t("statusLabel", { name: row.name })}
                          >
                            {t("table.changeStatus")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenDelete(row)}
                            aria-label={t("deleteLabel", { name: row.name })}
                          >
                            <TrashBinIcon className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!isLoading && !loadFailed && assets.length > 0 && (
          <p className="border-t border-gray-200 px-6 py-3 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            {t("showing", { count: visible.length, total: assets.length })}
          </p>
        )}
      </div>

      {/* ---------------------------------------------------------------- form */}
      <Modal
        isOpen={formModal.isOpen}
        onClose={formModal.closeModal}
        className="max-w-2xl"
      >
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {editingId ? t("editTitle") : t("createTitle")}
          </h3>

          <div
            role="tablist"
            aria-label={t("formTabsLabel")}
            className="mt-4 flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-800"
          >
            {SECTIONS.filter((s) => s !== "credentials" || isAdmin).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                id={`asset-tab-${s}`}
                aria-selected={section === s}
                aria-controls="asset-form-panel"
                onClick={() => setSection(s)}
                className={
                  section === s
                    ? "border-b-2 border-brand-500 px-3 py-2 text-sm font-medium text-brand-600 dark:text-brand-400"
                    : "border-b-2 border-transparent px-3 py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                }
              >
                {t(`sections.${s}`)}
              </button>
            ))}
          </div>

          <div
            id="asset-form-panel"
            role="tabpanel"
            aria-labelledby={`asset-tab-${section}`}
            className="mt-5 max-h-[55vh] space-y-4 overflow-y-auto pe-1"
          >
            {section === "identity" && (
              <>
                <TextField
                  id="asset-code"
                  label={t("fields.assetCode")}
                  required
                  value={form.asset_code}
                  onChange={(v) => set("asset_code", v)}
                  placeholder="AST-001"
                />
                <TextField
                  id="asset-name"
                  label={t("fields.name")}
                  required
                  value={form.name}
                  onChange={(v) => set("name", v)}
                />

                <div>
                  <Label htmlFor="asset-description">
                    {t("fields.description")} <Optional />
                  </Label>
                  <TextArea
                    rows={2}
                    value={form.description}
                    onChange={(v) => set("description", v)}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <TextField
                    id="asset-serial-number"
                    label={t("fields.serialNumber")}
                    value={form.serial_number}
                    onChange={(v) => set("serial_number", v)}
                  />
                  <TextField
                    id="asset-short-name"
                    label={t("fields.shortName")}
                    value={form.short_name}
                    onChange={(v) => set("short_name", v)}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="asset-condition">
                      {t("fields.condition")}
                    </Label>
                    {/* `key` is load-bearing: `Select` keeps its selection in
                        `useState(defaultValue)`, so without it the box would keep
                        showing the previously edited asset's condition. */}
                    <Select
                      key={`cond-${editingId ?? "new"}`}
                      id="asset-condition"
                      options={(
                        ["new", "good", "fair", "poor", "broken"] as const
                      ).map((c) => ({ value: c, label: t(`condition.${c}`) }))}
                      defaultValue={form.condition}
                      onChange={(v) => set("condition", v as AssetCondition)}
                    />
                  </div>

                  <div>
                    <Label htmlFor="asset-category">
                      {t("fields.category")} <Optional />
                    </Label>
                    <Select
                      key={`form-cat-${editingId ?? "new"}`}
                      id="asset-category"
                      options={categoryOptions}
                      placeholder={t("fields.none")}
                      defaultValue={form.category_id}
                      onChange={(v) => set("category_id", v)}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-gray-200 p-4 dark:border-gray-800">
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                      {t("fields.isLabeled")}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {t("fields.isLabeledHint")}
                    </p>
                  </div>
                  <input
                    id="asset-labeled"
                    type="checkbox"
                    checked={form.is_labeled}
                    onChange={(event) =>
                      set("is_labeled", event.target.checked)
                    }
                    className="size-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900"
                  />
                </div>
              </>
            )}

            {section === "specification" && (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <TextField
                    id="asset-manufacture"
                    label={t("fields.manufacture")}
                    value={form.manufacture}
                    onChange={(v) => set("manufacture", v)}
                  />
                  <TextField
                    id="asset-model-name"
                    label={t("fields.modelName")}
                    value={form.model_name}
                    onChange={(v) => set("model_name", v)}
                  />
                  <TextField
                    id="asset-model-type"
                    label={t("fields.modelType")}
                    value={form.model_type}
                    onChange={(v) => set("model_type", v)}
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <TextField
                    id="asset-processor"
                    label={t("fields.processorSpec")}
                    value={form.processor_spec}
                    onChange={(v) => set("processor_spec", v)}
                    placeholder="Apple M3 Pro"
                  />
                  <TextField
                    id="asset-ram"
                    label={t("fields.ramSpec")}
                    value={form.ram_spec}
                    onChange={(v) => set("ram_spec", v)}
                    placeholder="18 GB"
                  />
                  <TextField
                    id="asset-storage"
                    label={t("fields.storageSpec")}
                    value={form.storage_spec}
                    onChange={(v) => set("storage_spec", v)}
                    placeholder="512 GB NVMe"
                  />
                  <TextField
                    id="asset-display"
                    label={t("fields.displaySpec")}
                    value={form.display_spec}
                    onChange={(v) => set("display_spec", v)}
                    placeholder="14.2 inch Liquid Retina XDR"
                  />
                </div>
              </>
            )}

            {section === "network" && (
              <>
                <TextField
                  id="asset-hostname"
                  label={t("fields.hostname")}
                  value={form.hostname}
                  onChange={(v) => set("hostname", v)}
                  placeholder="mbp-01"
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <TextField
                    id="asset-ip-wifi"
                    label={t("fields.ipWifi")}
                    value={form.ip_wifi}
                    onChange={(v) => set("ip_wifi", v)}
                  />
                  <TextField
                    id="asset-ip-eth"
                    label={t("fields.ipEth")}
                    value={form.ip_eth}
                    onChange={(v) => set("ip_eth", v)}
                  />
                  <TextField
                    id="asset-mac-wifi"
                    label={t("fields.macWifi")}
                    value={form.mac_wifi}
                    onChange={(v) => set("mac_wifi", v)}
                  />
                  <TextField
                    id="asset-mac-eth"
                    label={t("fields.macEth")}
                    value={form.mac_eth}
                    onChange={(v) => set("mac_eth", v)}
                  />
                </div>
                <TextField
                  id="asset-os"
                  label={t("fields.osOrFirmware")}
                  value={form.os_or_firmware_version}
                  onChange={(v) => set("os_or_firmware_version", v)}
                />
                <TextField
                  id="asset-product-key"
                  label={t("fields.productKey")}
                  value={form.product_key}
                  onChange={(v) => set("product_key", v)}
                />
              </>
            )}

            {section === "credentials" && isAdmin && (
              <>
                <p className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-xs text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-400">
                  {t("fields.credentialsWarning")}
                </p>
                <TextField
                  id="asset-cred-username"
                  label={t("fields.credentialUsername")}
                  value={form.credential_username}
                  onChange={(v) => set("credential_username", v)}
                />
                <TextField
                  id="asset-cred-password"
                  label={t("fields.credentialPassword")}
                  type="password"
                  value={form.credential_password}
                  onChange={(v) => set("credential_password", v)}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("fields.credentialsHint")}
                </p>
              </>
            )}

            {section === "administration" && (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="asset-location">
                      {t("fields.location")} <Optional />
                    </Label>
                    <Select
                      key={`form-loc-${editingId ?? "new"}`}
                      id="asset-location"
                      options={locations.map((l) => ({
                        value: l.id,
                        label: l.name,
                      }))}
                      placeholder={t("fields.none")}
                      defaultValue={form.location_id}
                      onChange={(v) => set("location_id", v)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="asset-purchase-date">
                      {t("fields.purchaseDate")} <Optional />
                    </Label>
                    {/* A native date input rather than the `DatePicker` primitive:
                        it is controlled, so the value the form holds is the value
                        on screen, and it produces the `YYYY-MM-DD` the `date`
                        column wants without a conversion step. `DatePicker` wraps
                        flatpickr, which owns its input and hands back hook objects
                        rather than a value. */}
                    <Input
                      id="asset-purchase-date"
                      type="date"
                      value={form.purchase_date}
                      onChange={(event) =>
                        set("purchase_date", event.target.value)
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <TextField
                    id="asset-purchase-price"
                    label={t("fields.purchasePrice")}
                    type="number"
                    value={form.purchase_price}
                    onChange={(v) => set("purchase_price", v)}
                  />
                  <TextField
                    id="asset-supplier"
                    label={t("fields.supplier")}
                    value={form.supplier}
                    onChange={(v) => set("supplier", v)}
                  />
                  <TextField
                    id="asset-po-number"
                    label={t("fields.poNumber")}
                    value={form.po_number}
                    onChange={(v) => set("po_number", v)}
                  />
                  <TextField
                    id="asset-ownership"
                    label={t("fields.ownership")}
                    value={form.ownership}
                    onChange={(v) => set("ownership", v)}
                  />
                  <TextField
                    id="asset-pic"
                    label={t("fields.assetPic")}
                    value={form.asset_pic}
                    onChange={(v) => set("asset_pic", v)}
                  />
                  <TextField
                    id="asset-handover"
                    label={t("fields.handoverDocNo")}
                    value={form.handover_doc_no}
                    onChange={(v) => set("handover_doc_no", v)}
                  />
                </div>
              </>
            )}
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

      {/* -------------------------------------------------------------- status */}
      <Modal
        isOpen={statusModal.isOpen}
        onClose={statusModal.closeModal}
        className="max-w-md"
      >
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {t("statusTitle")}
          </h3>

          {pendingStatus && (
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {t("statusBody", {
                name: pendingStatus.name,
                current: t(`status.${pendingStatus.status}`),
              })}
            </p>
          )}

          <div className="mt-5">
            <Label htmlFor="asset-next-status">{t("statusLabel2")}</Label>
            {/* No `assigned` here, deliberately. It is derived from the loans, and
                `assets_guard_status` rejects a write that claims it without one. */}
            <Select
              key={`next-${pendingStatus?.id ?? "none"}`}
              id="asset-next-status"
              options={(
                ["available", "maintenance", "damaged", "retired"] as const
              ).map((s) => ({ value: s, label: t(`status.${s}`) }))}
              defaultValue={nextStatus}
              onChange={(v) => setNextStatus(v as SelectableAssetStatus)}
            />
          </div>

          {statusError && (
            <p className="mt-4 text-sm text-error-600 dark:text-error-500">
              {statusError}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={statusModal.closeModal}
              disabled={isSaving}
            >
              {t("cancel")}
            </Button>
            <Button onClick={handleConfirmStatus} disabled={isSaving}>
              {isSaving ? t("saving") : t("confirm")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* -------------------------------------------------------------- delete */}
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

/** `23505` is `unique_violation` — here, on `assets_asset_code_key`. */
function isDuplicateError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

/**
 * `23514` is `check_violation`, which is what `assets_guard_status` raises. The
 * admin cannot fix it from this screen, so the message says what happened rather
 * than repeating "could not save".
 */
function isCheckViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23514"
  );
}

/** One labelled text input, so 25 fields do not mean 25 repeated prop lists. */
function TextField({
  id,
  label,
  value,
  onChange,
  required = false,
  type = "text",
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>
        {label}{" "}
        {required ? <span className="text-error-500">*</span> : <Optional />}
      </Label>
      <Input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

/** Marks the many fields the database is happy to leave NULL. */
function Optional() {
  const { t } = useTranslation("common", { keyPrefix: "assets" });
  return (
    <span className="text-sm font-normal text-gray-400 dark:text-gray-500">
      ({t("optional")})
    </span>
  );
}
