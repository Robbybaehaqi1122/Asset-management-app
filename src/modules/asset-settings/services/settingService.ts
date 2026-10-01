import { supabase } from "@/lib/supabase";

/**
 * Asset settings: the reference data the asset form's pickers draw from.
 *
 * **Nothing here is a new table.** The request asked for `asset_categories`,
 * `asset_sub_categories` and `asset_locations`, and all three already exist as
 * `categories` (holding both levels through `parent_id`) and `locations`.
 * `assets.category_id` and `assets.location_id` already reference them, so a
 * parallel set of tables would be a second source of truth for the same two
 * facts. `01300` reshapes `locations` into `area_name` + `room_name`; everything
 * else reuses what is there.
 *
 * **Admin-only, and the screen is gated rather than the route.** This matches
 * `/users` and `/departments`: the page checks `useIsAdmin()` and renders a
 * refusal, and RLS is the actual enforcement. `categories` and `locations` are
 * read by every signed-in user and written by admins alone, which is why the
 * asset form can populate its pickers for a staff member and this screen cannot
 * be opened by one.
 *
 * **Every write uses `.select()` and throws on zero rows.** The write policies
 * are row filters, so a non-admin's UPDATE or DELETE matches nothing and
 * PostgREST still reports success. A resolved promise is not proof the row
 * changed — the same reasoning `departmentService` records.
 */

/** Thrown when RLS matched no row, so the write silently did nothing. */
export class NoRowsWrittenError extends Error {
  constructor(operation: string) {
    super(`No reference-data row was ${operation}`);
    this.name = "NoRowsWrittenError";
  }
}

/** Raised by `deleteCategory` when the category is still in use. */
export class CategoryInUseError extends Error {
  readonly assetCount: number;
  readonly subCategoryCount: number;

  constructor(assetCount: number, subCategoryCount: number) {
    super(
      `Category still has ${subCategoryCount} sub-categor(y/ies) and ${assetCount} asset(s)`,
    );
    this.name = "CategoryInUseError";
    this.assetCount = assetCount;
    this.subCategoryCount = subCategoryCount;
  }
}

/** Raised by `deleteLocation` when assets still point at it. */
export class LocationInUseError extends Error {
  readonly assetCount: number;

  constructor(assetCount: number) {
    super(`Location still has ${assetCount} asset(s)`);
    this.name = "LocationInUseError";
    this.assetCount = assetCount;
  }
}

/** Raised by `deleteCurrentLocation` when assets still point at it. */
export class CurrentLocationInUseError extends Error {
  readonly assetCount: number;

  constructor(assetCount: number) {
    super(`Current location still has ${assetCount} asset(s)`);
    this.name = "CurrentLocationInUseError";
    this.assetCount = assetCount;
  }
}

/**
 * A place an asset physically is *now*. Same shape as `LocationRow` and a
 * different question: `locations` is where the asset is registered, this is
 * where it actually sits. The two are independent by design, so both tables
 * exist and an asset may point at a different row in each.
 */
export type CurrentLocationRow = LocationRow;

/** Create/update payload for one current location. */
export type CurrentLocationInput = LocationInput;

export type CategoryRow = {
  id: string;
  name: string;
  description: string | null;
  /** Null for a top-level category. Its non-null value makes it a sub-category. */
  parentId: string | null;
  /** The fieldset key, only ever set on a top-level category. */
  code: string | null;
  /**
   * The unit that owns this category. Free text in the database; the selectable
   * list is computed by `getCategoryUnits`, so creating a department in User
   * Management surfaces it here.
   */
  department: string;
  created_at: string;
  /** How many assets point at this row. Zero makes a delete safe. */
  assetCount: number;
  /** How many sub-categories point at this row. Zero makes a delete safe. */
  subCategoryCount: number;
};

export type LocationRow = {
  id: string;
  area_name: string;
  room_name: string | null;
  notes: string | null;
  created_at: string;
  /** How many assets point here. */
  assetCount: number;
};

const CATEGORY_COLUMNS =
  "id, name, description, parent_id, code, department, created_at, assets!assets_category_id_fkey(count)";

const LOCATION_COLUMNS =
  "id, area_name, room_name, notes, created_at, assets!assets_location_id_fkey(count)";

const CURRENT_LOCATION_COLUMNS =
  "id, area_name, room_name, notes, created_at, assets!assets_current_location_id_fkey(count)";

/**
 * The units pinned into the category filter, whatever the `departments` table
 * currently holds.
 *
 * These two are not optional because the **asset forms route on them**: `/assets`
 * is Asset IT and `/assets-hsse` is Asset HSSE, fixed in `App.tsx` and in
 * `ASSET_DEPARTMENTS` in `assetService.ts`. If IT or HSSE ever fell out of the
 * selectable list, existing categories under them would become un-editable, so
 * they are always present — every other unit comes from the `departments` table,
 * which is what makes a department created in User Management appear in the
 * filter.
 *
 * `categories.department` stays free text: no `check` constraint and no enum, so
 * the column cannot reject a unit that was never seeded.
 */
export const PINNED_DEPARTMENTS = ["IT", "HSSE"] as const;

/**
 * Every unit a category can belong to, alphabetically.
 *
 * Pinned IT/HSSE unioned with the rows of the `departments` table. The union is
 * deliberate: the pinned pair keeps the asset forms working against the seed,
 * and the table gives the filter the departments an admin created in User
 * Management — a "Finance" row created there appears here, and is gone again when
 * it is deleted there.
 */
export async function getCategoryUnits(): Promise<string[]> {
  const { data, error } = await supabase
    .from("departments")
    .select("name")
    .order("name", { ascending: true });

  if (error) throw error;

  const units = new Set<string>(PINNED_DEPARTMENTS);
  for (const row of data ?? []) {
    const name = String(row.name).trim();
    if (name) units.add(name);
  }
  return [...units].sort((a, b) => a.localeCompare(b));
}

/** The unit the screen opens on, and the one the existing seed belongs to. */
export const DEFAULT_DEPARTMENT = "IT";

/**
 * Every category, top-level and sub, in one flat read.
 *
 * **Not a self-referential embed.** `parent:categories!categories_parent_id_fkey`
 * is the documented hint for that FK and PostgREST rejects it with `PGRST200`;
 * the forms that are accepted resolve the *inbound* direction and return an
 * empty array where the parent belongs. A flat read plus an in-memory join cannot
 * pick the wrong direction, which is what `getAssetFilterOptions` does.
 *
 * Counts are read from the embedded array's length, which is how PostgREST
 * represents a to-many count.
 */
export async function getCategories(): Promise<CategoryRow[]> {
  const { data, error } = await supabase
    .from("categories")
    .select(CATEGORY_COLUMNS)
    .order("name", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    parentId: (row.parent_id as string | null) ?? null,
    code: (row.code as string | null) ?? null,
    department: String(row.department ?? ""),
    created_at: String(row.created_at),
    assetCount: embeddedCount(row.assets),
    subCategoryCount: 0,
  }));
}

/** The list, with the sub-category count each parent has filled in. */
export async function getCategoriesWithSubCategoryCounts(): Promise<
  CategoryRow[]
> {
  const rows = await getCategories();
  const children = new Map<string, number>();
  for (const row of rows) {
    if (!row.parentId) continue;
    children.set(row.parentId, (children.get(row.parentId) ?? 0) + 1);
  }
  return rows.map((row) => ({
    ...row,
    subCategoryCount: row.parentId ? 0 : (children.get(row.id) ?? 0),
  }));
}

/** Every location, area then room. */
export async function getLocations(): Promise<LocationRow[]> {
  const { data, error } = await supabase
    .from("locations")
    .select(LOCATION_COLUMNS)
    .order("area_name", { ascending: true })
    .order("room_name", { ascending: true, nullsFirst: true });

  if (error) throw error;

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    area_name: String(row.area_name),
    room_name: (row.room_name as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    created_at: String(row.created_at),
    assetCount: embeddedCount(row.assets),
  }));
}

export type CategoryInput = {
  name: string;
  description?: string | null;
  /** Omit or null for a top-level category. */
  parent_id?: string | null;
  /**
   * The fieldset key. Only meaningful on a top-level category, and
   * `categories_code_only_on_parents` refuses it on a sub-category.
   */
  code?: string | null;
  /**
   * The owning unit. Required by the form, and defaulted here rather than left
   * to the column so a caller that forgets gets the unit the existing data is
   * in rather than an error.
   */
  department?: string;
};

export type LocationInput = {
  area_name: string;
  room_name?: string | null;
  notes?: string | null;
};

const trimmed = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/** Create one category or sub-category. */
export async function createCategory(
  input: CategoryInput,
): Promise<{ id: string; name: string }> {
  const { data, error } = await supabase
    .from("categories")
    .insert({
      name: input.name.trim(),
      description: trimmed(input.description),
      parent_id: input.parent_id || null,
      code: trimmed(input.code),
      department: input.department?.trim() || DEFAULT_DEPARTMENT,
    })
    .select("id, name")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoRowsWrittenError("inserted");

  return { id: data.id, name: data.name };
}

/**
 * Update one category.
 *
 * `parent_id`, `code` and `department` are sent as given rather than omitted,
 * because moving a row between levels, clearing its fieldset key, and moving it
 * between units are all things the form offers.
 *
 * Two database rules hold this back and are worth knowing before the form is
 * changed: `guard_category_parent` refuses a sub-category filed under a parent
 * from another unit, and `categories_guard_department_change` refuses moving a
 * parent that still has sub-categories. Both raise `23514`.
 */
export async function updateCategory(
  categoryId: string,
  input: CategoryInput,
): Promise<{ id: string; name: string }> {
  const { data, error } = await supabase
    .from("categories")
    .update({
      name: input.name.trim(),
      description: trimmed(input.description),
      parent_id: input.parent_id || null,
      code: trimmed(input.code),
      department: input.department?.trim() || DEFAULT_DEPARTMENT,
    })
    .eq("id", categoryId)
    .select("id, name")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoRowsWrittenError("updated");

  return { id: data.id, name: data.name };
}

/**
 * Delete one category, refusing while it is still in use.
 *
 * Two independent reasons to refuse, and the database only knows about one of
 * them. `categories_guard_delete` is a trigger, so it holds for any caller
 * including a service-role delete; the count it reports is authoritative. The
 * `AssetInUseError` this throws is for the case where the row is gone from the
 * client's view but still referenced.
 */
export async function deleteCategory(categoryId: string): Promise<void> {
  const { count: assetCount, error: assetCountError } = await supabase
    .from("assets")
    .select("id", { count: "exact", head: true })
    .eq("category_id", categoryId);

  if (assetCountError) throw assetCountError;

  const { count: subCount, error: subCountError } = await supabase
    .from("categories")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", categoryId);

  if (subCountError) throw subCountError;

  if ((assetCount ?? 0) > 0 || (subCount ?? 0) > 0) {
    throw new CategoryInUseError(assetCount ?? 0, subCount ?? 0);
  }

  const { data, error } = await supabase
    .from("categories")
    .delete()
    .eq("id", categoryId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoRowsWrittenError("deleted");
}

/** Create one location. */
export async function createLocation(
  input: LocationInput,
): Promise<{ id: string; area_name: string }> {
  const { data, error } = await supabase
    .from("locations")
    .insert({
      area_name: input.area_name.trim(),
      room_name: trimmed(input.room_name),
      notes: trimmed(input.notes),
    })
    .select("id, area_name")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoRowsWrittenError("inserted");

  return { id: data.id, area_name: data.area_name };
}

export async function updateLocation(
  locationId: string,
  input: LocationInput,
): Promise<{ id: string; area_name: string }> {
  const { data, error } = await supabase
    .from("locations")
    .update({
      area_name: input.area_name.trim(),
      room_name: trimmed(input.room_name),
      notes: trimmed(input.notes),
    })
    .eq("id", locationId)
    .select("id, area_name")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoRowsWrittenError("updated");

  return { id: data.id, area_name: data.area_name };
}

/**
 * Delete one location, refusing while assets point at it.
 *
 * `assets.location_id` is `on delete set null`, so the database would happily
 * delete it and silently un-assign every asset there — the same failure the
 * department delete guard exists to prevent. The check is in the application
 * because a cross-table count is not something a foreign key can express.
 */
export async function deleteLocation(locationId: string): Promise<void> {
  const { count, error: countError } = await supabase
    .from("assets")
    .select("id", { count: "exact", head: true })
    .eq("location_id", locationId);

  if (countError) throw countError;

  if ((count ?? 0) > 0) {
    throw new LocationInUseError(count ?? 0);
  }

  const { data, error } = await supabase
    .from("locations")
    .delete()
    .eq("id", locationId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoRowsWrittenError("deleted");
}

/** Every current location, area then room. */
export async function getCurrentLocations(): Promise<CurrentLocationRow[]> {
  const { data, error } = await supabase
    .from("current_locations")
    .select(CURRENT_LOCATION_COLUMNS)
    .order("area_name", { ascending: true })
    .order("room_name", { ascending: true, nullsFirst: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    area_name: row.area_name,
    room_name: row.room_name,
    notes: row.notes,
    created_at: row.created_at,
    assetCount: embeddedCount(row.assets),
  }));
}

/** Create one current location. */
export async function createCurrentLocation(
  input: CurrentLocationInput,
): Promise<{ id: string; area_name: string }> {
  const { data, error } = await supabase
    .from("current_locations")
    .insert({
      area_name: input.area_name.trim(),
      room_name: trimmed(input.room_name),
      notes: trimmed(input.notes),
    })
    .select("id, area_name")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoRowsWrittenError("inserted");

  return { id: data.id, area_name: data.area_name };
}

/**
 * Update one current location.
 *
 * Only the three editable columns are sent. There is no column guard on this
 * table to scope away, so the reason is simpler than it is on `profiles`: a
 * narrower payload is simply a narrower write, and `created_at` is not something
 * an edit should be able to move.
 */
export async function updateCurrentLocation(
  currentLocationId: string,
  input: CurrentLocationInput,
): Promise<{ id: string; area_name: string }> {
  const { data, error } = await supabase
    .from("current_locations")
    .update({
      area_name: input.area_name.trim(),
      room_name: trimmed(input.room_name),
      notes: trimmed(input.notes),
    })
    .eq("id", currentLocationId)
    .select("id, area_name")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoRowsWrittenError("updated");

  return { id: data.id, area_name: data.area_name };
}

/**
 * Delete one current location, refusing while assets still sit there.
 *
 * `assets.current_location_id` is `on delete set null`, for the same reason
 * `assets.location_id` is: a deleted reference should degrade into "not set"
 * rather than break an unrelated write. The cost is the same too — the database
 * will happily delete a place that assets are currently in and silently un-set
 * every one of them. This check is in the application because a cross-table
 * count is not something a foreign key can express, and the count is what lets
 * the refusal name what is in the way instead of surfacing a bare refusal code.
 */
export async function deleteCurrentLocation(
  currentLocationId: string,
): Promise<void> {
  const { count, error: countError } = await supabase
    .from("assets")
    .select("id", { count: "exact", head: true })
    .eq("current_location_id", currentLocationId);

  if (countError) throw countError;

  if ((count ?? 0) > 0) {
    throw new CurrentLocationInUseError(count ?? 0);
  }

  const { data, error } = await supabase
    .from("current_locations")
    .delete()
    .eq("id", currentLocationId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoRowsWrittenError("deleted");
}

/** How many assets PostgREST's embedded to-many count reported. */
function embeddedCount(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  const first = value[0] as { count?: number } | undefined;
  return first?.count ?? value.length;
}
