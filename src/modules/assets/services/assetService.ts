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

export type AssetCredentials = {
  username: string | null;
  password: string | null;
};

export type AssetRef = {
  id: string;
  name: string;
};

export type CategoryOption = AssetRef & {
  /** The parent category, when this row is a sub-category. */
  parentId: string | null;
  parentName: string | null;
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
  created_at, updated_at,
  category:categories!assets_category_id_fkey ( id, name ),
  location:locations!assets_location_id_fkey ( id, name ),
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
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    category: category
      ? { id: String(category.id), name: String(category.name) }
      : null,
    location: location
      ? { id: String(location.id), name: String(location.name) }
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
  locations: AssetRef[];
}> {
  const [categories, locations] = await Promise.all([
    supabase
      .from("categories")
      .select(
        "id, name, parent_id, parent:categories!categories_parent_id_fkey(id, name)",
      )
      .order("name", { ascending: true }),
    supabase
      .from("locations")
      .select("id, name")
      .order("name", { ascending: true }),
  ]);

  if (categories.error) throw categories.error;
  if (locations.error) throw locations.error;

  return {
    categories: ((categories.data ?? []) as RawAsset[]).map((row) => {
      const parent = embedded<RawAsset>(row.parent);
      return {
        id: String(row.id),
        name: String(row.name),
        parentId: str(row.parent_id),
        parentName: parent ? String(parent.name) : null,
      };
    }),
    locations: ((locations.data ?? []) as AssetRef[]).map((row) => ({
      id: row.id,
      name: row.name,
    })),
  };
}

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
  };
}

/**
 * Write the credential row for an asset.
 *
 * Upsert rather than insert, because `asset_credentials_asset_id_key` is unique
 * and an edit that submitted a second row would fail on every save after the
 * first. Clearing both fields deletes the row instead of storing an empty one,
 * so "no credentials" and "an empty credential" stay the same thing.
 */
async function writeCredentials(
  assetId: string,
  credentials: AssetCredentials,
): Promise<void> {
  const username = credentials.username?.trim() || null;
  const password = credentials.password?.trim() || null;

  if (username === null && password === null) {
    const { error } = await supabase
      .from("asset_credentials")
      .delete()
      .eq("asset_id", assetId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from("asset_credentials")
    .upsert(
      { asset_id: assetId, username, password },
      { onConflict: "asset_id" },
    );
  if (error) throw error;
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

  if (credentials) await writeCredentials(assetId, credentials);

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

  if (credentials) await writeCredentials(assetId, credentials);

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
