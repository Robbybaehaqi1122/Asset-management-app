import { supabase } from "@/lib/supabase";

/**
 * The IT asset inventory, as the columns `20260927001000_asset_inventory.sql`
 * added to a table that already existed.
 *
 * **Credentials are read separately and land in `Asset.credentials` as `null`
 * for a staff member.** That is not a client-side decision, and the shape of the
 * response is verified rather than assumed: through PostgREST an admin gets
 * `credentials: { username, password }` and a staff member gets
 * `credentials: null` on the same query, with the asset row otherwise intact.
 * The list therefore costs a staff member nothing they had, and a device
 * password is not in the payload of every list request they make.
 *
 * **Every write uses `.select()` and throws on zero rows.** `assets_write_admin`
 * and the four `asset_credentials_*_admin` policies are row filters, so a staff
 * member's UPDATE or DELETE matches nothing and PostgREST still reports success.
 * A resolved promise is not proof the row changed.
 *
 * **Status is not fully free.** `assets.status` has five values and two of them
 * are derived from the loans: `assignments_sync_asset_status` moves an asset
 * between `available` and `assigned`, and `assets_guard_status` refuses a write
 * that disagrees. So `assigned` is not a choice this module offers, and
 * `setAssetStatus` exists only for the three that are a person's judgement.
 */

/** Mirrors the `assets_status_check` constraint, not a wider client-side union. */
export type AssetStatus =
  "available" | "assigned" | "maintenance" | "damaged" | "retired";

/** The three statuses a person may choose. `assigned` is the loans' to decide. */
export type SelectableAssetStatus = Exclude<AssetStatus, "assigned">;

/** Mirrors the `assets_condition_check` constraint. */
export type AssetCondition = "new" | "good" | "fair" | "poor" | "broken";

/** Mirrors the `assets_connection_type_check` constraint. */
export type ConnectionType =
  "ethernet" | "wifi" | "fiber" | "cellular" | "other";

/**
 * Mirrors the `assets_usage_status_check` constraint, which is the closed set
 * the workbook's `Usage Status` column uses.
 *
 * Deliberately separate from `AssetStatus`. `status` is the loan state the
 * triggers own; this is the workbook's own record, which the triggers do not
 * read. "Lent out" overlaps `status = "assigned"` and the two are not kept in
 * step — see the migration's comment on the column.
 */
export type UsageStatus = "In used by User" | "Idle" | "Shared" | "Lent out";

/** The port names the workbook gives a count column to. */
export type PortName =
  | "vga"
  | "hdmi"
  | "lan"
  | "wifi"
  | "usb"
  | "bluetooth"
  | "rj45"
  | "sfp"
  | "console"
  | "power";

export type AssetCredentials = {
  username: string | null;
  password: string | null;
};

export type AssetRef = {
  id: string;
  name: string;
};

/**
 * A location, with the two halves `01300` split `locations.name` into.
 *
 * `name` is the display string the pickers show, assembled here rather than
 * stored: the database holds an area and an optional room because that is what
 * the workbook records, and a picker wants one line of text. A location with no
 * room is just the area.
 */
export type LocationOption = {
  id: string;
  areaName: string;
  roomName: string | null;
  name: string;
};

export type CategoryOption = AssetRef & {
  /** The parent category, when this row is a sub-category. */
  parentId: string | null;
  parentName: string | null;
  /**
   * The stable key the form switches its fieldset on. `null` for a category an
   * admin added after the seed, which gets the common fields only.
   */
  code: string | null;
};

export type Asset = {
  id: string;
  asset_code: string;
  name: string;
  description: string | null;

  status: AssetStatus;
  condition: AssetCondition;

  category_id: string | null;
  location_id: string | null;

  purchase_date: string | null;
  purchase_price: number | null;
  supplier: string | null;
  po_number: string | null;
  serial_number: string | null;
  short_name: string | null;
  manufacture: string | null;
  model_name: string | null;
  model_type: string | null;
  ownership: string | null;
  asset_pic: string | null;
  is_labeled: boolean;
  handover_doc_no: string | null;

  hostname: string | null;
  ip_wifi: string | null;
  ip_eth: string | null;
  mac_wifi: string | null;
  mac_eth: string | null;
  os_or_firmware_version: string | null;
  product_key: string | null;

  processor_spec: string | null;
  ram_spec: string | null;
  storage_spec: string | null;
  display_spec: string | null;

  gpu_model: string | null;
  resolution: string | null;
  panel_size: string | null;
  capacity: string | null;
  speed: string | null;
  current_location: string | null;
  protocol_url: string | null;
  connection_type: ConnectionType | null;

  /** The workbook's own `Usage Status`, separate from `status`. */
  usage_status: UsageStatus | null;

  // COMPUTER: the workbook splits the four free-text boxes above into its own
  // headings. `processor_spec`, `ram_spec`, `storage_spec` and `display_spec`
  // remain for the sheets that still use a single box, and the form writes both
  // so nothing recorded before 01200 is lost.
  processor_mfg: string | null;
  processor_model: string | null;
  ram_mfg: string | null;
  ram_type: string | null;
  ram_speed: number | null;
  ram_slots: number | null;
  ram_channel: string | null;
  ram_size_gb: number | null;
  gpu_onboard: boolean | null;
  storage_mfg: string | null;
  storage_type: string | null;
  storage_size_gb: number | null;
  /** Set instead of `storage_size_gb` when the size is not a bare number. */
  storage_size_text: string | null;
  display_model: string | null;
  display_type: string | null;
  display_size: string | null;

  /** NETWORK-DEVICES: the platform name, as opposed to the version below. */
  firmware_platform: string | null;
  /** IOT and SERVER. */
  power_source: string | null;

  /**
   * Port counts. `01200` dropped `input_ports` and `connectivity`, which held
   * port *names* in a `text[]`; the workbook holds counts in one column per
   * port, so "HDMI" and "3" are now two different columns.
   */
  port_vga: number | null;
  port_hdmi: number | null;
  port_lan: number | null;
  port_wifi: number | null;
  port_usb: number | null;
  port_bluetooth: number | null;
  port_rj45: number | null;
  port_sfp: number | null;
  port_console: number | null;
  port_power: number | null;

  created_at: string;
  updated_at: string;

  category: AssetRef | null;
  location: AssetRef | null;
  /** `null` for a staff member. See the module note. */
  credentials: AssetCredentials | null;
};

/** The fields the form owns. `id`, `status` and the timestamps are not here. */
export type AssetInput = {
  asset_code: string;
  name: string;
  description: string | null;
  condition: AssetCondition;
  category_id: string | null;
  location_id: string | null;
  purchase_date: string | null;
  purchase_price: number | null;
  supplier: string | null;
  po_number: string | null;
  serial_number: string | null;
  short_name: string | null;
  manufacture: string | null;
  model_name: string | null;
  model_type: string | null;
  ownership: string | null;
  asset_pic: string | null;
  is_labeled: boolean;
  handover_doc_no: string | null;
  hostname: string | null;
  ip_wifi: string | null;
  ip_eth: string | null;
  mac_wifi: string | null;
  mac_eth: string | null;
  os_or_firmware_version: string | null;
  product_key: string | null;
  processor_spec: string | null;
  ram_spec: string | null;
  storage_spec: string | null;
  display_spec: string | null;
  gpu_model: string | null;
  resolution: string | null;
  panel_size: string | null;
  capacity: string | null;
  speed: string | null;
  current_location: string | null;
  protocol_url: string | null;
  connection_type: ConnectionType | null;
  usage_status: UsageStatus | null;

  processor_mfg: string | null;
  processor_model: string | null;
  ram_mfg: string | null;
  ram_type: string | null;
  ram_speed: number | null;
  ram_slots: number | null;
  ram_channel: string | null;
  ram_size_gb: number | null;
  gpu_onboard: boolean | null;
  storage_mfg: string | null;
  storage_type: string | null;
  storage_size_gb: number | null;
  storage_size_text: string | null;
  display_model: string | null;
  display_type: string | null;
  display_size: string | null;

  firmware_platform: string | null;
  power_source: string | null;

  port_vga: number | null;
  port_hdmi: number | null;
  port_lan: number | null;
  port_wifi: number | null;
  port_usb: number | null;
  port_bluetooth: number | null;
  port_rj45: number | null;
  port_sfp: number | null;
  port_console: number | null;
  port_power: number | null;

  /** Omit entirely on update to leave the stored credentials untouched. */
  credentials: AssetCredentials | null;
};

/** Thrown when RLS matched no row, so the write silently did nothing. */
export class NoRowsWrittenError extends Error {
  constructor(operation: string) {
    super(`No asset row was ${operation}`);
    this.name = "NoRowsWrittenError";
  }
}

/** Thrown by `deleteAsset` when the asset still has loans or maintenance on it. */
export class AssetInUseError extends Error {
  readonly assignmentCount: number;
  readonly maintenanceCount: number;

  constructor(assignmentCount: number, maintenanceCount: number) {
    super(
      `Asset still has ${assignmentCount} assignment(s) and ${maintenanceCount} maintenance record(s)`,
    );
    this.name = "AssetInUseError";
    this.assignmentCount = assignmentCount;
    this.maintenanceCount = maintenanceCount;
  }
}

/**
 * Explicit column list rather than `*`.
 *
 * Two reasons. `product_key` is deliberately not in the list the list view uses,
 * because an OEM key is nobody's business while browsing a list, and it should
 * not ride along in every response. And a column list fails loudly when a
 * migration renames something, where `*` would quietly return null.
 *
 * **The second reason is not hypothetical, and it is the whole `locations` embed.**
 * `01300` dropped `locations.name` in favour of `area_name` + `room_name`. The
 * embed below kept asking for `name`, and the consequence was not a null in one
 * column: PostgREST refuses the whole statement with `42703` "column
 * locations_1.name does not exist", so the entire asset read 400'd and the list
 * rendered nothing. Verified against the local stack by sending the same
 * question, which reproduced the 400 exactly. The two halves are selected here
 * and the display string is assembled in `mapAsset`.
 *
 * No comments inside the literal: supabase-js parses the select string at the
 * type level, and a `--` line turns the whole thing into a parse error rather
 * than an ignored comment.
 */
const ASSET_COLUMNS = `
  id, asset_code, name, description,
  status, condition,
  category_id, location_id,
  purchase_date, purchase_price, supplier, po_number,
  serial_number, short_name, manufacture, model_name, model_type,
  ownership, asset_pic,
  is_labeled, handover_doc_no,
  hostname, ip_wifi, ip_eth, mac_wifi, mac_eth,
  os_or_firmware_version, product_key,
  processor_spec, ram_spec, storage_spec, display_spec,
  gpu_model, resolution, panel_size, capacity, speed,
  current_location, protocol_url, connection_type, usage_status,
  processor_mfg, processor_model,
  ram_mfg, ram_type, ram_speed, ram_slots, ram_channel, ram_size_gb,
  gpu_onboard,
  storage_mfg, storage_type, storage_size_gb, storage_size_text,
  display_model, display_type, display_size,
  firmware_platform, power_source,
  port_vga, port_hdmi, port_lan, port_wifi, port_usb, port_bluetooth,
  port_rj45, port_sfp, port_console, port_power,
  created_at, updated_at,
  category:categories!assets_category_id_fkey ( id, name ),
  location:locations!assets_location_id_fkey ( id, area_name, room_name ),
  credentials:asset_credentials ( username, password )
` as const;

type RawAsset = Record<string, unknown>;

/**
 * PostgREST returns an embedded resource as an object when the relationship is
 * one-to-one and `null` when the caller cannot see it. Both shapes were observed
 * against the local stack, so both are read rather than one of them cast away.
 */
function embedded<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return value as T;
}

const str = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/**
 * "Patimban / Customs Building", or just "Patimban" when the location is an
 * area with no room recorded.
 *
 * One place, used by both reads: the list's embedded location and the filter
 * pickers. `01300` split `locations.name` into `area_name` and `room_name`
 * because that is what the workbook records, and the database should hold the two
 * facts; a picker wants one line of text, so the joining is done here rather than
 * stored in a third column that could disagree with the other two.
 */
const locationDisplayName = (
  areaName: string,
  roomName: string | null,
): string => (roomName ? `${areaName} / ${roomName}` : areaName);

function mapAsset(row: RawAsset): Asset {
  const category = embedded<RawAsset>(row.category);
  const location = embedded<RawAsset>(row.location);
  const credentials = embedded<RawAsset>(row.credentials);

  return {
    id: String(row.id),
    asset_code: String(row.asset_code),
    name: String(row.name),
    description: str(row.description),
    status: row.status as AssetStatus,
    condition: row.condition as AssetCondition,
    category_id: str(row.category_id),
    location_id: str(row.location_id),
    purchase_date: str(row.purchase_date),
    purchase_price:
      row.purchase_price === null || row.purchase_price === undefined
        ? null
        : Number(row.purchase_price),
    supplier: str(row.supplier),
    po_number: str(row.po_number),
    serial_number: str(row.serial_number),
    short_name: str(row.short_name),
    manufacture: str(row.manufacture),
    model_name: str(row.model_name),
    model_type: str(row.model_type),
    ownership: str(row.ownership),
    asset_pic: str(row.asset_pic),
    is_labeled: Boolean(row.is_labeled),
    handover_doc_no: str(row.handover_doc_no),
    hostname: str(row.hostname),
    ip_wifi: str(row.ip_wifi),
    ip_eth: str(row.ip_eth),
    mac_wifi: str(row.mac_wifi),
    mac_eth: str(row.mac_eth),
    os_or_firmware_version: str(row.os_or_firmware_version),
    product_key: str(row.product_key),
    processor_spec: str(row.processor_spec),
    ram_spec: str(row.ram_spec),
    storage_spec: str(row.storage_spec),
    display_spec: str(row.display_spec),
    gpu_model: str(row.gpu_model),
    resolution: str(row.resolution),
    panel_size: str(row.panel_size),
    capacity: str(row.capacity),
    speed: str(row.speed),
    current_location: str(row.current_location),
    protocol_url: str(row.protocol_url),
    connection_type: str(row.connection_type) as ConnectionType | null,
    usage_status: str(row.usage_status) as UsageStatus | null,
    processor_mfg: str(row.processor_mfg),
    processor_model: str(row.processor_model),
    ram_mfg: str(row.ram_mfg),
    ram_type: str(row.ram_type),
    ram_speed: num(row.ram_speed),
    ram_slots: num(row.ram_slots),
    ram_channel: str(row.ram_channel),
    ram_size_gb: num(row.ram_size_gb),
    gpu_onboard:
      row.gpu_onboard === null || row.gpu_onboard === undefined
        ? null
        : Boolean(row.gpu_onboard),
    storage_mfg: str(row.storage_mfg),
    storage_type: str(row.storage_type),
    storage_size_gb: num(row.storage_size_gb),
    storage_size_text: str(row.storage_size_text),
    display_model: str(row.display_model),
    display_type: str(row.display_type),
    display_size: str(row.display_size),
    firmware_platform: str(row.firmware_platform),
    power_source: str(row.power_source),
    port_vga: num(row.port_vga),
    port_hdmi: num(row.port_hdmi),
    port_lan: num(row.port_lan),
    port_wifi: num(row.port_wifi),
    port_usb: num(row.port_usb),
    port_bluetooth: num(row.port_bluetooth),
    port_rj45: num(row.port_rj45),
    port_sfp: num(row.port_sfp),
    port_console: num(row.port_console),
    port_power: num(row.port_power),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    category: category
      ? { id: String(category.id), name: String(category.name) }
      : null,
    location: location
      ? {
          id: String(location.id),
          name: locationDisplayName(
            String(location.area_name),
            str(location.room_name),
          ),
        }
      : null,
    credentials: credentials
      ? {
          username: str(credentials.username),
          password: str(credentials.password),
        }
      : null,
  };
}

/**
 * Every asset, newest first.
 *
 * Not gated on `useIsAdmin`, and deliberately so. `assets_select_authenticated`
 * is `using (true)` and stock does not belong to one department, so a staff
 * member gets the same rows an admin does. The only difference in the payload is
 * that `credentials` is null for them, which the database decides.
 */
export async function getAssets(): Promise<Asset[]> {
  const { data, error } = await supabase
    .from("assets")
    .select(ASSET_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return ((data ?? []) as RawAsset[]).map(mapAsset);
}

/**
 * The pickers for the filter bar and the form: categories with their parents,
 * and locations. Same split as `getDepartmentOptions` — no counts, no gating,
 * because both reads are `using (true)`.
 */
export async function getAssetFilterOptions(): Promise<{
  categories: CategoryOption[];
  locations: LocationOption[];
}> {
  const [categories, locations] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, parent_id, code")
      .order("name", { ascending: true }),
    supabase
      .from("locations")
      .select("id, area_name, room_name")
      .order("area_name", { ascending: true })
      .order("room_name", { ascending: true, nullsFirst: true }),
  ]);

  if (categories.error) throw categories.error;
  if (locations.error) throw locations.error;

  const rows = (categories.data ?? []) as RawAsset[];

  // The parent's name comes out of this same result set rather than through a
  // self-referential embed. `parent:categories!categories_parent_id_fkey` is the
  // documented hint for that FK and PostgREST rejects it with PGRST200 on a
  // self-relationship; the forms that *are* accepted resolve the inbound
  // direction and return an empty array instead of the parent, so the label
  // would read "Sub-category" with nothing in front of the slash. One flat read
  // plus a lookup cannot pick the wrong direction.
  const nameById = new Map(
    rows.map((row) => [String(row.id), String(row.name)]),
  );

  return {
    categories: rows.map((row) => {
      const parentId = str(row.parent_id);
      return {
        id: String(row.id),
        name: String(row.name),
        parentId,
        parentName: parentId ? (nameById.get(parentId) ?? null) : null,
        code: str(row.code),
      };
    }),
    locations: ((locations.data ?? []) as RawAsset[]).map((row) => {
      const areaName = String(row.area_name);
      const roomName = str(row.room_name);
      return {
        id: String(row.id),
        areaName,
        roomName,
        // The same join the list uses, for the same reason.
        name: locationDisplayName(areaName, roomName),
      };
    }),
  };
}

/**
 * The storage size as an integer, or null when it is not a bare number.
 *
 * The workbook writes `512`, `120GB` and `2x 4TB` under one heading, and the
 * column is an integer, so the numeric case is split off here rather than
 * rejecting the write and making the admin re-type it.
 */
const numberOrNull = (v: string | null): number | null => {
  const trimmed = v?.trim();
  if (!trimmed) return null;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
};

/** The storage size back as text, for the values `numberOrNull` refused. */
const nonNumeric = (v: string | null): string | null => {
  const trimmed = v?.trim();
  if (!trimmed) return null;
  return /^\d+$/.test(trimmed) ? null : trimmed;
};

/**
 * Trim every optional text field, turning a whitespace-only box into NULL.
 *
 * Takes `Omit<AssetInput, "credentials">` rather than the whole input, because
 * credentials do not belong on the `assets` row and destructuring them out of the
 * result of this function is a type error rather than a silent omission.
 */
function normalise(input: Omit<AssetInput, "credentials">) {
  const text = (v: string | null) => {
    const trimmed = v?.trim();
    return trimmed ? trimmed : null;
  };

  return {
    asset_code: input.asset_code.trim(),
    name: input.name.trim(),
    description: text(input.description),
    condition: input.condition,
    category_id: input.category_id || null,
    location_id: input.location_id || null,
    purchase_date: input.purchase_date || null,
    purchase_price:
      input.purchase_price === null || Number.isNaN(input.purchase_price)
        ? null
        : input.purchase_price,
    supplier: text(input.supplier),
    po_number: text(input.po_number),
    serial_number: text(input.serial_number),
    short_name: text(input.short_name),
    manufacture: text(input.manufacture),
    model_name: text(input.model_name),
    model_type: text(input.model_type),
    ownership: text(input.ownership),
    asset_pic: text(input.asset_pic),
    is_labeled: input.is_labeled,
    handover_doc_no: text(input.handover_doc_no),
    hostname: text(input.hostname),
    ip_wifi: text(input.ip_wifi),
    ip_eth: text(input.ip_eth),
    mac_wifi: text(input.mac_wifi),
    mac_eth: text(input.mac_eth),
    os_or_firmware_version: text(input.os_or_firmware_version),
    product_key: text(input.product_key),
    processor_spec: text(input.processor_spec),
    ram_spec: text(input.ram_spec),
    storage_spec: text(input.storage_spec),
    display_spec: text(input.display_spec),
    gpu_model: text(input.gpu_model),
    resolution: text(input.resolution),
    panel_size: text(input.panel_size),
    capacity: text(input.capacity),
    speed: text(input.speed),
    current_location: text(input.current_location),
    protocol_url: text(input.protocol_url),
    connection_type: input.connection_type || null,
    usage_status: input.usage_status || null,
    processor_mfg: text(input.processor_mfg),
    processor_model: text(input.processor_model),
    ram_mfg: text(input.ram_mfg),
    ram_type: text(input.ram_type),
    ram_speed: input.ram_speed,
    ram_slots: input.ram_slots,
    ram_channel: text(input.ram_channel),
    ram_size_gb: input.ram_size_gb,
    gpu_onboard: input.gpu_onboard,
    storage_mfg: text(input.storage_mfg),
    storage_type: text(input.storage_type),
    // A bare number goes to the integer column and anything else to the text
    // one, because the workbook writes "120GB" and "2x 4TB" under the same
    // heading as "512". Exactly one of the pair is ever non-null.
    storage_size_gb: numberOrNull(input.storage_size_text),
    storage_size_text: text(nonNumeric(input.storage_size_text)),
    display_model: text(input.display_model),
    display_type: text(input.display_type),
    display_size: text(input.display_size),
    firmware_platform: text(input.firmware_platform),
    power_source: text(input.power_source),
    port_vga: input.port_vga,
    port_hdmi: input.port_hdmi,
    port_lan: input.port_lan,
    port_wifi: input.port_wifi,
    port_usb: input.port_usb,
    port_bluetooth: input.port_bluetooth,
    port_rj45: input.port_rj45,
    port_sfp: input.port_sfp,
    port_console: input.port_console,
    port_power: input.port_power,
  };
}

/**
 * Write the credential row for an asset.
 *
 * Upsert rather than insert, because `asset_credentials_asset_id_key` is unique
 * and an edit that submitted a second row would fail on every save after the
 * first. Clearing both fields deletes the row instead of storing an empty one,
 * so "no credentials" and "an empty credential" stay the same thing.
 *
 * Returns what is now stored, because the asset row was read *before* this ran.
 */
async function writeCredentials(
  assetId: string,
  credentials: AssetCredentials,
): Promise<AssetCredentials> {
  const username = credentials.username?.trim() || null;
  const password = credentials.password?.trim() || null;

  if (username === null && password === null) {
    const { error } = await supabase
      .from("asset_credentials")
      .delete()
      .eq("asset_id", assetId);
    if (error) throw error;
    return { username: null, password: null };
  }

  const { error } = await supabase
    .from("asset_credentials")
    .upsert(
      { asset_id: assetId, username, password },
      { onConflict: "asset_id" },
    );
  if (error) throw error;
  return { username, password };
}

/**
 * Create one asset.
 *
 * `status` is not in the payload, so a new asset lands on the column default
 * `available`. That is the only status a brand new asset can honestly be, and
 * sending anything else is either a lie or a contradiction `assets_guard_status`
 * would refuse.
 */
export async function createAsset(input: AssetInput): Promise<Asset> {
  const { credentials, ...columns } = input;
  const fields = normalise(columns);

  const { data, error } = await supabase
    .from("assets")
    .insert(fields)
    .select(ASSET_COLUMNS)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoRowsWrittenError("inserted");

  const row = data as RawAsset;
  const assetId = String(row.id);

  if (credentials) {
    // The select above ran before this write, so the embedded credential on it
    // is absent. Returning what was actually stored keeps the object honest
    // for a caller that renders it without reloading.
    row.credentials = await writeCredentials(assetId, credentials);
  }

  return mapAsset(row);
}

/**
 * Update one asset.
 *
 * `status` is absent here for the same reason it is absent on create, and more
 * strongly: `assets_guard_status` compares the submitted status against the
 * actual loans, so an edit form that sent `available` for an asset somebody is
 * holding would be rejected with a check violation the admin cannot act on. The
 * status column has its own function for that.
 */
export async function updateAsset(
  assetId: string,
  input: AssetInput,
): Promise<Asset> {
  const { credentials, ...columns } = input;
  const fields = normalise(columns);

  const { data, error } = await supabase
    .from("assets")
    .update(fields)
    .eq("id", assetId)
    .select(ASSET_COLUMNS)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoRowsWrittenError("updated");

  const row = data as RawAsset;

  if (credentials) {
    // Same reason as on create, and worse here: the embed carries the *previous*
    // credential, so returning `row` unchanged would hand the caller a password
    // the admin just replaced.
    row.credentials = await writeCredentials(assetId, credentials);
  }

  return mapAsset(row);
}

/**
 * Move an asset between the three statuses that are a person's judgement.
 *
 * Separate from `updateAsset` on purpose, and it takes a narrower type than
 * `AssetStatus` so `assigned` cannot even be passed. An asset that is out on
 * loan is `assigned` because the loans say so, and writing that value by hand
 * would be asking the database to agree with something it can check.
 *
 * `maintenance`, `damaged` and `retired` are the three nobody can derive, and
 * no trigger overwrites them: a retired asset stays retired while it is out on
 * loan and after it comes back.
 */
export async function setAssetStatus(
  assetId: string,
  status: SelectableAssetStatus,
): Promise<void> {
  const { data, error } = await supabase
    .from("assets")
    .update({ status })
    .eq("id", assetId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoRowsWrittenError("updated");
}

/**
 * Delete one asset, refusing while it is still borrowed or still has maintenance
 * history.
 *
 * Both foreign keys are `on delete cascade`, so an unguarded delete would take
 * the loan history and the maintenance record with it — the same loss the
 * hard-delete warning in user management spells out for accounts. The
 * difference here is that the guard is cheap, so there is no argument for the
 * hard delete: an asset with no history is safe to remove, and one with history
 * is worth keeping.
 *
 * The `assignments` count is only trustworthy for an admin, and
 * `assignments_select_own_or_admin` shows a staff member only their own loans.
 * That is not a hole, because `assets_write_admin` means the delete itself is
 * refused for a staff member regardless of what this check counted — but it is
 * why the refusal is not a security boundary here. `assets_write_admin` is.
 */
export async function deleteAsset(assetId: string): Promise<void> {
  const [assignments, maintenance] = await Promise.all([
    supabase
      .from("assignments")
      .select("id", { count: "exact", head: true })
      .eq("asset_id", assetId),
    supabase
      .from("maintenance")
      .select("id", { count: "exact", head: true })
      .eq("asset_id", assetId),
  ]);

  if (assignments.error) throw assignments.error;
  if (maintenance.error) throw maintenance.error;

  const assignmentCount = assignments.count ?? 0;
  const maintenanceCount = maintenance.count ?? 0;

  if (assignmentCount > 0 || maintenanceCount > 0) {
    throw new AssetInUseError(assignmentCount, maintenanceCount);
  }

  const { data, error } = await supabase
    .from("assets")
    .delete()
    .eq("id", assetId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoRowsWrittenError("deleted");
}
