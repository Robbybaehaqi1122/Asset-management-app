import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import PageMeta from "@/components/common/PageMeta";
import Label from "@/components/form/Label";
import Checkbox from "@/components/form/input/Checkbox";
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
  AssetUnit,
  CategoryOption,
  ConnectionType,
  SelectableAssetStatus,
  UsageStatus,
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
  /** UI-only: the main category. `category_id` holds the chosen sub-category. */
  parent_category_id: string;
  category_id: string;
  location_id: string;
  current_location_id: string;
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
  gpu_model: string;
  resolution: string;
  panel_size: string;
  capacity: string;
  speed: string;
  protocol_url: string;
  connection_type: string;
  usage_status: string;
  // COMPUTER, per the workbook's own headings.
  processor_mfg: string;
  processor_model: string;
  ram_mfg: string;
  ram_type: string;
  ram_speed: string;
  ram_slots: string;
  ram_channel: string;
  ram_size_gb: string;
  gpu_onboard: boolean | null;
  storage_mfg: string;
  storage_type: string;
  storage_size: string;
  display_model: string;
  display_type: string;
  display_size: string;
  firmware_platform: string;
  power_source: string;
  // Port counts, one per port. The workbook holds numbers here, not names.
  port_vga: string;
  port_hdmi: string;
  port_lan: string;
  port_wifi: string;
  port_usb: string;
  port_bluetooth: string;
  port_rj45: string;
  port_sfp: string;
  port_console: string;
  port_power: string;
  credential_username: string;
  credential_password: string;
  // HSSE only. Null on an IT asset, and never shown for one.
  expiration_date: string;
  last_inspection_date: string;
  next_inspection_date: string;
  calibration_cert_no: string;
};

const EMPTY_FORM: AssetForm = {
  asset_code: "",
  name: "",
  description: "",
  condition: "good",
  parent_category_id: "",
  category_id: "",
  location_id: "",
  current_location_id: "",
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
  gpu_model: "",
  resolution: "",
  panel_size: "",
  capacity: "",
  speed: "",
  protocol_url: "",
  connection_type: "",
  usage_status: "",
  processor_mfg: "",
  processor_model: "",
  ram_mfg: "",
  ram_type: "",
  ram_speed: "",
  ram_slots: "",
  ram_channel: "",
  ram_size_gb: "",
  gpu_onboard: null,
  storage_mfg: "",
  storage_type: "",
  storage_size: "",
  display_model: "",
  display_type: "",
  display_size: "",
  firmware_platform: "",
  power_source: "",
  port_vga: "",
  port_hdmi: "",
  port_lan: "",
  port_wifi: "",
  port_usb: "",
  port_bluetooth: "",
  port_rj45: "",
  port_sfp: "",
  port_console: "",
  port_power: "",
  credential_username: "",
  credential_password: "",
  expiration_date: "",
  last_inspection_date: "",
  next_inspection_date: "",
  calibration_cert_no: "",
};

/** Credentials are omitted when the tab was never opened on an existing asset. */
function formFromAsset(asset: Asset, categories: CategoryOption[]): AssetForm {
  const category = asset.category_id
    ? (categories.find((c) => c.id === asset.category_id) ?? null)
    : null;

  return {
    asset_code: asset.asset_code,
    name: asset.name,
    description: asset.description ?? "",
    condition: asset.condition,
    // A sub-category's parent is what the fieldset switches on; a top-level
    // category is its own parent.
    parent_category_id: category ? (category.parentId ?? category.id) : "",
    category_id: category?.parentId ? category.id : "",
    location_id: asset.location_id ?? "",
    current_location_id: asset.current_location_id ?? "",
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
    gpu_model: asset.gpu_model ?? "",
    resolution: asset.resolution ?? "",
    panel_size: asset.panel_size ?? "",
    capacity: asset.capacity ?? "",
    speed: asset.speed ?? "",
    protocol_url: asset.protocol_url ?? "",
    connection_type: asset.connection_type ?? "",
    usage_status: asset.usage_status ?? "",
    processor_mfg: asset.processor_mfg ?? "",
    processor_model: asset.processor_model ?? "",
    ram_mfg: asset.ram_mfg ?? "",
    ram_type: asset.ram_type ?? "",
    ram_speed: asset.ram_speed === null ? "" : String(asset.ram_speed),
    ram_slots: asset.ram_slots === null ? "" : String(asset.ram_slots),
    ram_channel: asset.ram_channel ?? "",
    ram_size_gb: asset.ram_size_gb === null ? "" : String(asset.ram_size_gb),
    gpu_onboard: asset.gpu_onboard,
    storage_mfg: asset.storage_mfg ?? "",
    storage_type: asset.storage_type ?? "",
    // One box, two columns: the integer column when it is a bare number, the
    // text one otherwise. `normalise` splits them.
    storage_size:
      asset.storage_size_gb !== null
        ? String(asset.storage_size_gb)
        : (asset.storage_size_text ?? ""),
    display_model: asset.display_model ?? "",
    display_type: asset.display_type ?? "",
    display_size: asset.display_size ?? "",
    firmware_platform: asset.firmware_platform ?? "",
    power_source: asset.power_source ?? "",
    port_vga: asset.port_vga === null ? "" : String(asset.port_vga),
    port_hdmi: asset.port_hdmi === null ? "" : String(asset.port_hdmi),
    port_lan: asset.port_lan === null ? "" : String(asset.port_lan),
    port_wifi: asset.port_wifi === null ? "" : String(asset.port_wifi),
    port_usb: asset.port_usb === null ? "" : String(asset.port_usb),
    port_bluetooth:
      asset.port_bluetooth === null ? "" : String(asset.port_bluetooth),
    port_rj45: asset.port_rj45 === null ? "" : String(asset.port_rj45),
    port_sfp: asset.port_sfp === null ? "" : String(asset.port_sfp),
    port_console: asset.port_console === null ? "" : String(asset.port_console),
    port_power: asset.port_power === null ? "" : String(asset.port_power),
    // Null for a staff member, so this stays empty rather than showing a blank
    // that looks like a stored-but-empty credential.
    credential_username: asset.credentials?.username ?? "",
    credential_password: asset.credentials?.password ?? "",
    expiration_date: asset.expiration_date ?? "",
    last_inspection_date: asset.last_inspection_date ?? "",
    next_inspection_date: asset.next_inspection_date ?? "",
    calibration_cert_no: asset.calibration_cert_no ?? "",
  };
}

/**
 * Empty box means "not recorded", never zero.
 *
 * Used for every count the workbook keeps in its own column: ports, RAM speed,
 * slot count, RAM size. `handleSave` has already rejected anything that is not a
 * non-negative integer, so a NaN here means the field was not reached rather
 * than that the admin typed nonsense.
 */
function portOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

/** The two required fields, the price, and the two credential boxes. */
function toInput(form: AssetForm, includeCredentials: boolean): AssetInput {
  const price = form.purchase_price.trim();

  return {
    asset_code: form.asset_code,
    name: form.name,
    description: form.description || null,
    condition: form.condition,
    // The sub-category wins when one is chosen; otherwise a top-level category is
    // stored on the asset directly.
    category_id: form.category_id || form.parent_category_id || null,
    location_id: form.location_id || null,
    current_location_id: form.current_location_id || null,
    purchase_date: form.purchase_date || null,
    // Sent as the raw `YYYY-MM-DD` a native date input produces, and only for
    // HSSE: the fieldset does not render them for IT, so they arrive empty and
    // normalise turns that into NULL rather than blanking a stored value.
    expiration_date: form.expiration_date || null,
    last_inspection_date: form.last_inspection_date || null,
    next_inspection_date: form.next_inspection_date || null,
    calibration_cert_no: form.calibration_cert_no || null,
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
    gpu_model: form.gpu_model || null,
    resolution: form.resolution || null,
    panel_size: form.panel_size || null,
    capacity: form.capacity || null,
    speed: form.speed || null,
    protocol_url: form.protocol_url || null,
    connection_type: (form.connection_type || null) as ConnectionType | null,
    usage_status: (form.usage_status || null) as UsageStatus | null,
    processor_mfg: form.processor_mfg || null,
    processor_model: form.processor_model || null,
    ram_mfg: form.ram_mfg || null,
    ram_type: form.ram_type || null,
    ram_speed: portOrNull(form.ram_speed),
    ram_slots: portOrNull(form.ram_slots),
    ram_channel: form.ram_channel || null,
    ram_size_gb: portOrNull(form.ram_size_gb),
    gpu_onboard: form.gpu_onboard,
    storage_mfg: form.storage_mfg || null,
    storage_type: form.storage_type || null,
    // One box feeding two columns; `normalise` decides which, so that "512" and
    // "2x 4TB" both survive the round trip.
    storage_size_gb: null,
    storage_size_text: form.storage_size || null,
    display_model: form.display_model || null,
    display_type: form.display_type || null,
    display_size: form.display_size || null,
    firmware_platform: form.firmware_platform || null,
    power_source: form.power_source || null,
    port_vga: portOrNull(form.port_vga),
    port_hdmi: portOrNull(form.port_hdmi),
    port_lan: portOrNull(form.port_lan),
    port_wifi: portOrNull(form.port_wifi),
    port_usb: portOrNull(form.port_usb),
    port_bluetooth: portOrNull(form.port_bluetooth),
    port_rj45: portOrNull(form.port_rj45),
    port_sfp: portOrNull(form.port_sfp),
    port_console: portOrNull(form.port_console),
    port_power: portOrNull(form.port_power),
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

/** Tabs HSSE does not get. An extinguisher or a hard hat has no address, no
    firmware and no device login, so those two panels would be empty for every
    HSSE item. The previous version kept the Network tab and filled it with a
    "there is no network here" note, arguing that a tab which appears and
    disappears is worse than an empty one. That reasoning holds *within* a unit,
    where the strip changes as you move between panels, and does not hold
    *across* units, where the tab is empty for every single row. `credentials`
    disappears for the same reason it already did for a non-admin: the panel is
    admin-only, so an HSSE form would show it to nobody at all. */
const HSSE_HIDDEN_SECTIONS: readonly Section[] = ["network", "credentials"];

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

/**
 * The categories that share the network fieldset. They are distinct parents
 * (`NETWORK_DEVICES`, `SERVER`, `IOT`) but the same set of columns serves all
 * three, so the form switches on membership here rather than on one code.
 */
const NETWORK_LIKE: ReadonlySet<string> = new Set([
  "NETWORK_DEVICES",
  "SERVER",
  "IOT",
]);

const CONNECTION_TYPES = [
  "ethernet",
  "wifi",
  "fiber",
  "cellular",
  "other",
] as const;

/**
 * The workbook's `Usage Status` values, in the order it writes them.
 *
 * Mirrors `assets_usage_status_check`. A closed set is the point: it is what
 * makes "in used by user" and "In used by User" unable to both exist.
 */
const USAGE_STATUSES = [
  "In used by User",
  "Idle",
  "Shared",
  "Lent out",
] as const;

/**
 * The port counts, per category, as the workbook's own columns name them.
 *
 * A count rather than the checkbox list 01100 used: the sheet records `HDMI = 3`
 * and `VGA = 1` in their own columns, so "HDMI" and "3" are two different facts
 * and only one of them is a boolean.
 */
const DISPLAY_PORTS = [
  { field: "port_vga", label: "fields.portVga" },
  { field: "port_hdmi", label: "fields.portHdmi" },
  { field: "port_lan", label: "fields.portLan" },
  { field: "port_wifi", label: "fields.portWifi" },
  { field: "port_usb", label: "fields.portUsb" },
] as const;

const PERIPHERAL_PORTS = [
  { field: "port_usb", label: "fields.portUsb" },
  { field: "port_bluetooth", label: "fields.portBluetooth" },
  { field: "port_hdmi", label: "fields.portHdmi" },
  { field: "port_lan", label: "fields.portLan" },
  { field: "port_wifi", label: "fields.portWifi" },
] as const;

const NETWORK_PORTS = [
  { field: "port_rj45", label: "fields.portRj45" },
  { field: "port_sfp", label: "fields.portSfp" },
  { field: "port_console", label: "fields.portConsole" },
  { field: "port_usb", label: "fields.portUsb" },
  { field: "port_power", label: "fields.portPower" },
] as const satisfies ReadonlyArray<{
  field: keyof AssetForm;
  label: string;
}>;

export default function AssetListPage({ unit }: { unit: AssetUnit }) {
  const { t } = useTranslation("common", { keyPrefix: "assets" });
  const isAdmin = useIsAdmin();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [locations, setLocations] = useState<AssetRef[]>([]);
  const [currentLocations, setCurrentLocations] = useState<AssetRef[]>([]);
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
  const [editingStatus, setEditingStatus] = useState<AssetStatus | null>(null);

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

    void Promise.all([getAssets(unit), getAssetFilterOptions()]).then(
      ([rows, options]) => {
        if (cancelled) return;
        setAssets(rows);
        setCategories(options.categories);
        setLocations(options.locations);
        setCurrentLocations(options.currentLocations);
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
  }, [reloadToken, unit]);

  const set = useCallback(
    <K extends keyof AssetForm>(key: K, value: AssetForm[K]) =>
      setForm((prev) => ({ ...prev, [key]: value })),
    [],
  );

  /**
   * Current-location options: every row in `current_locations` by its display
   * name, keyed on the id. Distinct from `locationOptions` on purpose — the
   * registered place and the place the asset actually sits are two independent
   * facts, and the legacy-value fallback the text column needed is gone because
   * `01600` backfilled every free-text value into this table before dropping it.
   */
  const currentLocationOptions = useMemo(
    () => currentLocations.map((l) => ({ value: l.id, label: l.name })),
    [currentLocations],
  );

  /**
   * The category picker reads as "Laptop / Laptop Pro" for a sub-category and
   * plain "Laptop" for a top-level one, which is the only place a person can
   * tell two same-named categories apart.
   */
  const categoryOptions = useMemo(
    () =>
      categories
        // This page's unit only. The list below is already filtered by it, so
        // offering a cross-unit category here would produce "no matches" for a
        // reason the person cannot see.
        .filter((option) => option.department === unit)
        .map((option) => ({
          value: option.id,
          label: option.parentName
            ? `${option.parentName} / ${option.name}`
            : option.name,
        })),
    [categories, unit],
  );

  /** The main-category picker: parents only. Nothing here has a `parent_id`. */
  const parentOptions = useMemo(
    () =>
      categories
        .filter(
          (option) =>
            option.parentId === null &&
            // Only this page's unit. `assets_sync_department` derives the
            // asset's unit from the category, so offering a cross-unit category
            // here would only produce a fieldset that does not match the label.
            option.department === unit,
        )
        .map((option) => ({ value: option.id, label: option.name })),
    [categories, unit],
  );

  /** The sub-category picker: children of whatever main category is chosen. */
  const childOptions = useMemo(
    () =>
      categories
        .filter(
          (option) =>
            option.parentId === form.parent_category_id &&
            option.department === unit,
        )
        .map((option) => ({ value: option.id, label: option.name })),
    [categories, form.parent_category_id, unit],
  );

  /**
   * The HSSE fieldset, chosen by the page's unit rather than by a category
   * `code`.
   *
   * HSSE categories have no `code` — the fieldset switch has never honoured one
   * on a category an admin added — so without this they would fall through to
   * `isGeneric` and be given the IT fields, which is the opposite of the point.
   */
  const isHsse = unit === "HSSE";

  /** The tabs actually rendered, which is `SECTIONS` minus the ones this unit
      and this viewer have no use for. `credentials` was already admin-gated;
      both it and `network` are additionally dropped for HSSE. */
  const visibleSections = SECTIONS.filter(
    (s) =>
      (s !== "credentials" || isAdmin) &&
      !(isHsse && HSSE_HIDDEN_SECTIONS.includes(s)),
  );

  /** The specification tab is named for what it holds in this unit: IT spec
      sheets on one, inspection dates and expiry on the other. The section id
      stays `specification` so the panel condition, the tab id and the
      `aria-labelledby` all stay stable while only the visible word changes. */
  const sectionLabelKey = (s: Section) =>
    isHsse && s === "specification" ? "sections.inspection" : `sections.${s}`;

  /**
   * The fieldset is chosen by the *main* category's `code`, never by its name.
   * A name is editable and the seed already carries two rows called "UPS", so a
   * name is not a key; the code is what the migration wrote as stable.
   */
  const parentCode = useMemo(
    () =>
      categories.find((option) => option.id === form.parent_category_id)
        ?.code ?? null,
    [categories, form.parent_category_id],
  );

  const isComputer = parentCode === "COMPUTER";
  const isDisplay = parentCode === "DISPLAY";
  const isPeripheral = parentCode === "PERIPHERAL";
  const isNetworkLike = parentCode !== null && NETWORK_LIKE.has(parentCode);
  /** DISPLAY and PERIPHERAL both record port counts; the columns differ. */
  const isPorted = isDisplay || isPeripheral;
  const portFields = isDisplay ? DISPLAY_PORTS : PERIPHERAL_PORTS;

  /**
   * Where the port-count boxes go: NETWORK-DEVICES keeps them in Specification
   * beside the storage detail, the other two in Specification as well, so one
   * fieldset serves all three rather than splitting ports away from the spec.
   */
  const portFieldsForCategory = isNetworkLike ? NETWORK_PORTS : portFields;
  // Everything else — an uncategorised asset, UTILITIES, or a code an admin
  // invented later — gets the common fields plus the original generic spec set,
  // so no category ever leaves a tab empty.
  const isGeneric =
    !isComputer && !isDisplay && !isPeripheral && !isNetworkLike;

  const usageStatusOptions = useMemo(
    () =>
      USAGE_STATUSES.map((value) => ({
        value,
        // The constraint allows no other spelling, so the label is the raw
        // value rather than a translation that could drift from it.
        label: value,
      })),
    [],
  );
  const connectionTypeOptions = useMemo(
    () =>
      CONNECTION_TYPES.map((value) => ({
        value,
        label: t(`connectionType.${value}`),
      })),
    [t],
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
    setEditingStatus(null);
    setSaveError(null);
    formModal.openModal();
  };

  const handleOpenEdit = (row: Asset) => {
    setForm(formFromAsset(row, categories));
    setSection("identity");
    setEditingId(row.id);
    setEditingStatus(row.status);
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
    // Every count column is `integer check (>= 0)`: the ten ports, plus the RAM
    // columns the workbook keeps as numbers. An empty box is "not recorded";
    // anything else has to be a whole number, or the column check refuses the
    // whole save with a message about a port nobody was looking at.
    //
    // `storage_size` is deliberately absent: it is a text box on purpose, because
    // the workbook writes "120GB" and "2x 4TB" under the same heading as "512",
    // and `normalise` splits the numeric case off into `storage_size_gb`.
    const countFields: (keyof AssetForm)[] = [
      "port_vga",
      "port_hdmi",
      "port_lan",
      "port_wifi",
      "port_usb",
      "port_bluetooth",
      "port_rj45",
      "port_sfp",
      "port_console",
      "port_power",
      "ram_speed",
      "ram_slots",
      "ram_size_gb",
    ];
    const badCount = countFields.some((field) => {
      const value = form[field];
      return (
        typeof value === "string" &&
        value.trim() !== "" &&
        !/^\d+$/.test(value.trim())
      );
    });
    if (badCount) {
      setSaveError(t("errors.portsInvalid"));
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
        title={`${t(`units.${unit}`)} | Asset Management App`}
        description={t(`pageDescription.${unit}`)}
      />
      <PageBreadcrumb pageTitle={t(`units.${unit}`)} />

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
              {t(`units.${unit}`)}
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t(`subtitle.${unit}`)}
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
            {visibleSections.map((s) => (
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
                {t(sectionLabelKey(s))}
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
                    id="asset-description"
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
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="asset-parent-category">
                      {t("fields.parentCategory")} <Optional />
                    </Label>
                    <Select
                      key={`form-parent-${editingId ?? "new"}`}
                      id="asset-parent-category"
                      options={parentOptions}
                      placeholder={t("fields.none")}
                      defaultValue={form.parent_category_id}
                      onChange={(v) => {
                        set("parent_category_id", v);
                        // Whatever sub-category was chosen belongs to the old
                        // main category, so it cannot survive the change.
                        set("category_id", "");
                      }}
                    />
                  </div>
                  <div>
                    <Label htmlFor="asset-category">
                      {t("fields.subCategory")} <Optional />
                    </Label>
                    {/* Keyed on the parent so picking a new main category
                        remounts this with that parent's children. */}
                    <Select
                      key={`form-cat-${editingId ?? "new"}-${form.parent_category_id}`}
                      id="asset-category"
                      options={childOptions}
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
                {/* HSSE gets its own fieldset and none of the IT ones. The three
                    common fields below (make, model, type) are shown for both
                    units because `01500` found they already exist on `assets` and
                    do not have to be duplicated per unit. */}
                {isHsse && (
                  <fieldset className="space-y-4">
                    <Legend>{t("fields.hsseLegend")}</Legend>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <Label htmlFor="asset-expiration">
                          {t("fields.expirationDate")} <Optional />
                        </Label>
                        <Input
                          id="asset-expiration"
                          type="date"
                          value={form.expiration_date}
                          onChange={(event) =>
                            set("expiration_date", event.target.value)
                          }
                        />
                      </div>
                      <div>
                        <Label htmlFor="asset-last-inspection">
                          {t("fields.lastInspectionDate")} <Optional />
                        </Label>
                        <Input
                          id="asset-last-inspection"
                          type="date"
                          value={form.last_inspection_date}
                          onChange={(event) =>
                            set("last_inspection_date", event.target.value)
                          }
                        />
                      </div>
                      <div>
                        <Label htmlFor="asset-next-inspection">
                          {t("fields.nextInspectionDate")} <Optional />
                        </Label>
                        <Input
                          id="asset-next-inspection"
                          type="date"
                          value={form.next_inspection_date}
                          onChange={(event) =>
                            set("next_inspection_date", event.target.value)
                          }
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <TextField
                        id="asset-calibration-cert"
                        label={t("fields.calibrationCertNo")}
                        value={form.calibration_cert_no}
                        onChange={(v) => set("calibration_cert_no", v)}
                        placeholder="CERT/HSSE/2026/0042"
                      />
                      <TextField
                        id="asset-hsse-capacity"
                        label={t("fields.capacity")}
                        value={form.capacity}
                        onChange={(v) => set("capacity", v)}
                        placeholder="5 kg"
                      />
                    </div>

                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t("fields.hsseHint")}
                    </p>
                  </fieldset>
                )}

                {!isHsse && (
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

                    {isComputer && (
                      <fieldset className="space-y-4">
                        <Legend>{t("fields.computerSpecLegend")}</Legend>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                          <TextField
                            id="asset-processor-mfg"
                            label={t("fields.processorMfg")}
                            value={form.processor_mfg}
                            onChange={(v) => set("processor_mfg", v)}
                            placeholder="INTEL"
                          />
                          <TextField
                            id="asset-processor-model"
                            label={t("fields.processorModel")}
                            value={form.processor_model}
                            onChange={(v) => set("processor_model", v)}
                            placeholder="Ultra 5 225T"
                          />
                          <TextField
                            id="asset-processor-spec"
                            label={t("fields.processorSpec")}
                            value={form.processor_spec}
                            onChange={(v) => set("processor_spec", v)}
                            placeholder="Intel Core Ultra 5 225T (2.50 GHz)"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                          <TextField
                            id="asset-ram-mfg"
                            label={t("fields.ramMfg")}
                            value={form.ram_mfg}
                            onChange={(v) => set("ram_mfg", v)}
                            placeholder="Samsung"
                          />
                          <TextField
                            id="asset-ram-type"
                            label={t("fields.ramType")}
                            value={form.ram_type}
                            onChange={(v) => set("ram_type", v)}
                            placeholder="DDR5"
                          />
                          <TextField
                            id="asset-ram-speed"
                            label={t("fields.ramSpeed")}
                            type="number"
                            value={form.ram_speed}
                            onChange={(v) => set("ram_speed", v)}
                            placeholder="5600"
                          />
                          <TextField
                            id="asset-ram-slots"
                            label={t("fields.ramSlots")}
                            type="number"
                            value={form.ram_slots}
                            onChange={(v) => set("ram_slots", v)}
                            placeholder="2"
                          />
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                          <TextField
                            id="asset-ram-channel"
                            label={t("fields.ramChannel")}
                            value={form.ram_channel}
                            onChange={(v) => set("ram_channel", v)}
                            placeholder="Dual Chanel"
                          />
                          <TextField
                            id="asset-ram-size"
                            label={t("fields.ramSizeGb")}
                            type="number"
                            value={form.ram_size_gb}
                            onChange={(v) => set("ram_size_gb", v)}
                            placeholder="16"
                          />
                          <div>
                            <Label htmlFor="asset-gpu-onboard">
                              {t("fields.gpuOnboard")}
                            </Label>
                            <div className="flex gap-5 pt-2">
                              <Checkbox
                                id="asset-gpu-onboard"
                                label="Y"
                                checked={form.gpu_onboard === true}
                                onChange={(checked) =>
                                  set("gpu_onboard", checked ? true : null)
                                }
                              />
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                          <TextField
                            id="asset-gpu"
                            label={t("fields.gpuModel")}
                            value={form.gpu_model}
                            onChange={(v) => set("gpu_model", v)}
                            placeholder="UHD Graphics 770"
                          />
                          <TextField
                            id="asset-storage-mfg"
                            label={t("fields.storageMfg")}
                            value={form.storage_mfg}
                            onChange={(v) => set("storage_mfg", v)}
                            placeholder="KIOXIA"
                          />
                          <TextField
                            id="asset-storage-type"
                            label={t("fields.storageType")}
                            value={form.storage_type}
                            onChange={(v) => set("storage_type", v)}
                            placeholder="SSD-NVME"
                          />
                        </div>

                        <TextField
                          id="asset-storage-size"
                          label={t("fields.storageSize")}
                          value={form.storage_size}
                          onChange={(v) => set("storage_size", v)}
                          placeholder="1024"
                        />

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                          <TextField
                            id="asset-display-model"
                            label={t("fields.displayModel")}
                            value={form.display_model}
                            onChange={(v) => set("display_model", v)}
                            placeholder="UA55DU8000"
                          />
                          <TextField
                            id="asset-display-type"
                            label={t("fields.displayType")}
                            value={form.display_type}
                            onChange={(v) => set("display_type", v)}
                            placeholder="Curve"
                          />
                          <TextField
                            id="asset-display-size"
                            label={t("fields.displaySize")}
                            value={form.display_size}
                            onChange={(v) => set("display_size", v)}
                            placeholder='55"'
                          />
                        </div>
                      </fieldset>
                    )}

                    {isGeneric && (
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
                        <TextField
                          id="asset-gpu"
                          label={t("fields.gpuModel")}
                          value={form.gpu_model}
                          onChange={(v) => set("gpu_model", v)}
                          placeholder="RTX 4060"
                        />
                      </div>
                    )}

                    {isDisplay && (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <TextField
                          id="asset-resolution"
                          label={t("fields.resolution")}
                          value={form.resolution}
                          onChange={(v) => set("resolution", v)}
                          placeholder="1920 x 1080"
                        />
                        <TextField
                          id="asset-panel-size"
                          label={t("fields.panelSize")}
                          value={form.panel_size}
                          onChange={(v) => set("panel_size", v)}
                          placeholder='24"'
                        />
                      </div>
                    )}

                    {isPeripheral && (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <TextField
                          id="asset-capacity"
                          label={t("fields.capacity")}
                          value={form.capacity}
                          onChange={(v) => set("capacity", v)}
                          placeholder="1200 VA / 720W"
                        />
                        <TextField
                          id="asset-speed"
                          label={t("fields.speed")}
                          value={form.speed}
                          onChange={(v) => set("speed", v)}
                          placeholder="400 MB/s"
                        />
                      </div>
                    )}

                    {isNetworkLike && (
                      <>
                        <fieldset className="space-y-4">
                          <Legend>{t("fields.storageLegend")}</Legend>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                            <TextField
                              id="asset-storage-mfg"
                              label={t("fields.storageMfg")}
                              value={form.storage_mfg}
                              onChange={(v) => set("storage_mfg", v)}
                            />
                            <TextField
                              id="asset-storage-type"
                              label={t("fields.storageType")}
                              value={form.storage_type}
                              onChange={(v) => set("storage_type", v)}
                            />
                            <TextField
                              id="asset-storage-size"
                              label={t("fields.storageSize")}
                              value={form.storage_size}
                              onChange={(v) => set("storage_size", v)}
                              placeholder="128"
                            />
                          </div>
                        </fieldset>

                        <fieldset className="space-y-4">
                          <Legend>{t("fields.portLegend")}</Legend>
                          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                            {NETWORK_PORTS.map((port) => (
                              <TextField
                                key={port.field}
                                id={`asset-${port.field}`}
                                label={t(port.label)}
                                type="number"
                                value={form[port.field]}
                                onChange={(v) => set(port.field, v)}
                              />
                            ))}
                          </div>
                        </fieldset>
                      </>
                    )}

                    {isPorted && (
                      <fieldset className="space-y-4">
                        <Legend>{t("fields.portLegend")}</Legend>
                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                          {portFieldsForCategory.map((port) => (
                            <TextField
                              key={port.field}
                              id={`asset-${port.field}`}
                              label={t(port.label)}
                              type="number"
                              value={form[port.field]}
                              onChange={(v) => set(port.field, v)}
                            />
                          ))}
                        </div>
                      </fieldset>
                    )}
                  </>
                )}
              </>
            )}

            {section === "network" && (
              <>
                {(isComputer || isNetworkLike || isGeneric) && (
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
                      label={
                        isComputer
                          ? t("fields.osOrFirmware")
                          : t("fields.firmwareVersion")
                      }
                      value={form.os_or_firmware_version}
                      onChange={(v) => set("os_or_firmware_version", v)}
                    />
                  </>
                )}

                {(isComputer || isGeneric) && (
                  <TextField
                    id="asset-product-key"
                    label={t("fields.productKey")}
                    value={form.product_key}
                    onChange={(v) => set("product_key", v)}
                  />
                )}

                {isNetworkLike && (
                  <>
                    {parentCode === "NETWORK_DEVICES" && (
                      <TextField
                        id="asset-firmware-platform"
                        label={t("fields.firmwarePlatform")}
                        value={form.firmware_platform}
                        onChange={(v) => set("firmware_platform", v)}
                        placeholder="CISCO"
                      />
                    )}

                    {(parentCode === "IOT" || parentCode === "SERVER") && (
                      <TextField
                        id="asset-power-source"
                        label={t("fields.powerSource")}
                        value={form.power_source}
                        onChange={(v) => set("power_source", v)}
                        placeholder="PoE (Power over Ethernet)"
                      />
                    )}

                    <div>
                      <Label htmlFor="asset-connection-type">
                        {t("fields.connectionType")} <Optional />
                      </Label>
                      <Select
                        key={`form-conn-${editingId ?? "new"}`}
                        id="asset-connection-type"
                        options={connectionTypeOptions}
                        placeholder={t("fields.none")}
                        defaultValue={form.connection_type}
                        onChange={(v) => set("connection_type", v)}
                      />
                    </div>
                    <TextField
                      id="asset-protocol-url"
                      label={t("fields.protocolUrl")}
                      value={form.protocol_url}
                      onChange={(v) => set("protocol_url", v)}
                      placeholder="https://10.0.0.2"
                    />
                    {/* Said plainly on the form: this column is on `assets`,
                        which every signed-in user can read, so a URL carrying a
                        device password is readable by all staff. */}
                    <p className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-xs text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-400">
                      {t("fields.protocolUrlHint")}
                    </p>
                  </>
                )}

                {isPeripheral && (
                  <>
                    <TextField
                      id="asset-hostname"
                      label={t("fields.hostname")}
                      value={form.hostname}
                      onChange={(v) => set("hostname", v)}
                    />
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <TextField
                        id="asset-ip-eth"
                        label={t("fields.ipAddress")}
                        value={form.ip_eth}
                        onChange={(v) => set("ip_eth", v)}
                      />
                      <TextField
                        id="asset-mac-eth"
                        label={t("fields.macAddress")}
                        value={form.mac_eth}
                        onChange={(v) => set("mac_eth", v)}
                      />
                    </div>
                  </>
                )}
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

                <div>
                  <Label htmlFor="asset-current-location">
                    {t("fields.currentLocation")} <Optional />
                  </Label>
                  {/* A picker over `current_locations`, not the `locations` list
                      above and not a free-text box. The two answer different
                      questions — where the asset is registered versus where it
                      actually is — so they are separate tables and separate
                      options, and this one stores a real id. */}
                  <Select
                    key={`form-current-loc-${editingId ?? "new"}`}
                    id="asset-current-location"
                    options={currentLocationOptions}
                    placeholder={t("fields.none")}
                    defaultValue={form.current_location_id}
                    onChange={(v) => set("current_location_id", v)}
                  />
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

                {/* Two different columns, and the form says so. `usage_status` is
                    the workbook's own `Usage Status` column and is editable here.
                    `status` is the loan state, which `assignments_sync_asset_status`
                    and `assets_guard_status` own, so it stays read-only with the
                    list's control as the one place to change it. "Lent out"
                    overlaps `assigned` and the triggers do not read
                    `usage_status`, so the two are not kept in step.

                    `usage_status` is IT's column, though — its four values come
                    from the IT hardware workbook and describe how a computer is
                    being lent out, which is not a question an extinguisher
                    raises. So it is hidden for HSSE while the column stays. The
                    `loanStatus` badge below it is `assets.status` and stays for
                    both: a hard hat can genuinely be issued to someone and
                    `assigned` is derived from the loans, so it is a real fact
                    about an HSSE item too. */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {!isHsse && (
                    <div>
                      <Label htmlFor="asset-usage-status">
                        {t("fields.usageStatus")} <Optional />
                      </Label>
                      <Select
                        key={`form-usage-${editingId ?? "new"}`}
                        id="asset-usage-status"
                        options={usageStatusOptions}
                        placeholder={t("fields.none")}
                        defaultValue={form.usage_status}
                        onChange={(v) => set("usage_status", v)}
                      />
                    </div>
                  )}

                  {editingId && editingStatus && (
                    <div>
                      <p className="mb-1.5 text-sm font-medium text-gray-700 dark:text-gray-400">
                        {t("fields.loanStatus")}
                      </p>
                      <div className="flex h-[38px] items-center">
                        <Badge size="sm" color={STATUS_COLOR[editingStatus]}>
                          {t(`status.${editingStatus}`)}
                        </Badge>
                      </div>
                    </div>
                  )}
                </div>

                {!isHsse && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t("fields.usageStatusHint")}
                  </p>
                )}
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

/**
 * Group heading inside a Specification fieldset.
 *
 * A `<fieldset>` with a `<legend>` rather than a bare paragraph, so the grouping
 * is announced as one and the legend is what names it. Nothing is submitted from
 * the element itself.
 */
function Legend({ children }: { children: React.ReactNode }) {
  return (
    <legend className="text-sm font-semibold text-gray-800 dark:text-white/90">
      {children}
    </legend>
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
