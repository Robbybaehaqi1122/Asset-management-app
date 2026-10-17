/**
 * The closed set of menus a staff member's access can be configured per, and the one
 * rule that turns stored rows into an answer.
 *
 * This is the code half of `user_menu_permissions_menu_key_known` in migration
 * `20260927003500`. The check constraint is what actually holds; this list is what the
 * UI offers, so an admin is never shown a key the database would refuse. Two copies of
 * a closed set is the shape `categories.department` versus `departments` is already
 * documented for, which is exactly why the constraint exists rather than the two being
 * left to agree by discipline.
 *
 * ## Why only these four
 *
 * Every menu the sidebar can render is either here or `adminOnly`, and the split is
 * the point. An `adminOnly` menu is refused by RLS anyway — `profiles_select_own_or_admin`
 * hands a staff member their own row and nothing else — so a row in this table granting
 * it could only ever produce a link that opens a page that refuses to render. A
 * configuration that looks granted and is not is worse than one that was never offered.
 *
 * The unit-scoped asset rows are also filtered by the reader's own department in
 * `AppSidebar`, and the database has refused the cross-unit read since `01700`. The two
 * are **ANDed**, never ORed: a row here can narrow what a staff member is offered, and
 * cannot widen them past the unit their department already decides.
 */

/**
 * `NavSubItem.key` values this table can be asked about. Deliberately the same strings
 * as the i18n keys under `sidebar.items`, so a page can name a menu with
 * `t(`sidebar.items.${key}`)` without this module having to carry a second label map.
 */
export const PERMISSION_MENU_KEYS = [
  "calendar",
  "assetIt",
  "assetHsse",
  "handover",
] as const;

export type PermissionMenuKey = (typeof PERMISSION_MENU_KEYS)[number];

const PERMISSION_MENU_KEY_SET: ReadonlySet<string> = new Set(
  PERMISSION_MENU_KEYS,
);

/** True for a key this module — and therefore the database — knows. */
export function isPermissionMenuKey(value: string): value is PermissionMenuKey {
  return PERMISSION_MENU_KEY_SET.has(value);
}

/**
 * The unit a menu is scoped to, or `null` when it is not unit-scoped.
 *
 * **This mirrors the `unit` on the two asset rows in `navItems` and is not the copy that
 * decides anything.** `AppSidebar` owns rendering and keeps its own `unit`; if the two
 * ever disagreed, the sidebar's would decide what appears and this would only make the
 * admin page's warning wrong — which is why it is stated rather than deduplicated,
 * because removing it means the admin can save a grant that will silently do nothing.
 *
 * The boundary being warned about is not this map either: `01700` established
 * `assets_select_authenticated` as `is_admin() or department = current_asset_unit()`, and
 * that is what actually refuses a cross-unit read. `AppSidebar` ANDs its unit check with
 * the permission check, so a grant outside the reader's unit never reaches the query
 * layer at all.
 */
const PERMISSION_MENU_UNITS: Readonly<
  Record<PermissionMenuKey, string | null>
> = {
  calendar: null,
  assetIt: "IT",
  assetHsse: "HSSE",
  handover: null,
};

/** The unit `menuKey` is scoped to, or `null`. See the note on the map. */
export function permissionMenuUnit(menuKey: string): string | null {
  return isPermissionMenuKey(menuKey) ? PERMISSION_MENU_UNITS[menuKey] : null;
}

/**
 * Which configurable menu a unit-scoped asset screen answers to.
 *
 * The two asset routes are `/assets` (IT) and `/assets-hsse` (HSSE), and each has to ask
 * the permission question under its own key — so this is the one place that knows the
 * route's `unit` and the menu key are the same fact written two ways.
 *
 * **The fallback is deliberately reachable-looking rather than locked.** `AssetUnit` is
 * the closed `"IT" | "HSSE"` pair and `ASSET_DEPARTMENTS` is the same set, so a typed
 * caller cannot land on it. Returning `assetIt` for anything unexpected means a third
 * unit added later would apply IT's grants to its own screen — visibly wrong during
 * testing, rather than a screen nobody can open at all.
 */
export function assetMenuKeyForUnit(unit: string): PermissionMenuKey {
  return unit === "HSSE" ? "assetHsse" : "assetIt";
}

/** One stored override, as `user_menu_permissions` returns it. */
export interface MenuPermissionRow {
  /**
   * The account this row is about.
   *
   * Carried even though the sidebar never reads it: `getAllPermissions` groups by it,
   * and the admin page addresses a row by it. Snake_case because this is the wire shape
   * straight off the response — not a mapped type, which is the point of the split from
   * `MenuPermissionInput`.
   */
  profile_id: string;
  menu_key: string;
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

/**
 * What a reader is allowed on one menu, and why it is what it is.
 *
 * `isOverridden` is the field that keeps the admin page honest. Because a missing row
 * grants everything, "no rows at all" and "rows that all say no" are opposite
 * instructions that would otherwise render identically — and the second one is a person
 * who has been deliberately shut down to nothing.
 */
export interface MenuAccess {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** False when the answer came from the fallback rather than from a row. */
  isOverridden: boolean;
}

/**
 * **A missing row grants the menus the reader can already reach.**
 *
 * Load-bearing, and the single line to change if this ever becomes default-deny: it is
 * what makes migration `03500` a no-op for every account that already exists.
 *
 * Default-deny was the first instinct and it is the worse choice on rollout — it would
 * strip every current staff member of every menu the moment the migration landed, with
 * no error and no empty state that says anything is wrong. The cost is that absence now
 * means "unconfigured" rather than "forbidden", so revoking is an explicit row with all
 * three flags false, and `isOverridden` exists to tell the two situations apart on
 * screen. Configure everyone, then flip this.
 */
export const ABSENT_ROW_GRANTS_EVERYTHING = true;

/**
 * The answer for a reader with no stored row for this menu.
 *
 * **All three flags, including `canDelete`.** An earlier version returned
 * `canDelete: false` here on the reasoning that delete is an action an admin should have
 * to name explicitly. That was wrong, and wrong in the direction this module exists to
 * prevent: with `canDelete` false in the fallback, an **admin with no override row would
 * lose the Delete action** on `/assets`, because `AssetListPage` ANDs
 * `isAdmin && canDelete`. Every existing admin would have found a destructive action
 * gone from their inventory without anybody configuring anything.
 *
 * That is the whole argument for `ABSENT_ROW_GRANTS_EVERYTHING` in one place: absence
 * has to mean *exactly today's behaviour*, and today's behaviour for asset delete is
 * `isAdmin`. Narrowing delete to admins is the **page's** `isAdmin &&`, where the
 * database already draws that line via `assets_write_admin` — not a flag smuggled into
 * the fallback, where it would apply to every menu and quietly disagree with the schema.
 *
 * `isOverridden: false` is what lets the admin page still tell "no row" from "a row that
 * says no", which is the distinction that fallback creates in the first place.
 */
function absentRowAccess(): MenuAccess {
  return {
    canView: ABSENT_ROW_GRANTS_EVERYTHING,
    canEdit: ABSENT_ROW_GRANTS_EVERYTHING,
    canDelete: ABSENT_ROW_GRANTS_EVERYTHING,
    isOverridden: false,
  };
}

/**
 * The answer while the reader is **unknown** — the profile has not arrived yet.
 *
 * A distinct exported value rather than an empty row set, because the empty set is the
 * *permissive* answer: `resolveMenuAccess([])` is exactly what an admin is given, and it
 * falls through to `absentRowAccess()`, which grants everything. A "loading" state that
 * was expressed by passing no rows would therefore fail **open**, while the sidebar
 * needs it to fail closed — the same direction `useIsAdmin` fails in.
 *
 * Handed out as a function returning the constant so a caller cannot mutate the object
 * every reader shares.
 */
export function denyAllMenuAccess(): MenuAccess {
  return DENY_ALL;
}

const DENY_ALL: MenuAccess = {
  canView: false,
  canEdit: false,
  canDelete: false,
  isOverridden: false,
};

/**
 * Turn stored rows into a lookup. Called with the reader's own rows, or with `[]` for
 * an admin — which is why an admin needs no rows at all.
 *
 * A pure function over its arguments rather than a hook, so the sidebar and every page
 * that wants `canEdit` are resolving the rule through the same code instead of each
 * re-implementing the comparison. They can still disagree about *timing* (each fetches
 * independently), which is why `useMenuAccess` fetches only the four rows behind one
 * call — but they cannot disagree about what the answer means.
 *
 * A row for a key this module does not know is ignored rather than honoured. The
 * database refuses those now, so the only way one arrives is a hand-written `INSERT`,
 * and treating it as access would mean an unknown string could grant something.
 */
export function resolveMenuAccess(
  rows: readonly MenuPermissionRow[],
): (menuKey: string) => MenuAccess {
  const byKey = new Map<string, MenuPermissionRow>();
  for (const row of rows) {
    if (isPermissionMenuKey(row.menu_key)) byKey.set(row.menu_key, row);
  }

  return (menuKey: string): MenuAccess => {
    if (!isPermissionMenuKey(menuKey)) {
      // Not a configurable menu. Admin-only screens answer from `adminOnly`, which is
      // why returning "everything" here is safe rather than a hole: this function is
      // never consulted for them, and the caller ANDs it with the admin check.
      return {
        canView: true,
        canEdit: true,
        canDelete: true,
        isOverridden: false,
      };
    }

    const row = byKey.get(menuKey);
    if (!row) return absentRowAccess();

    return {
      canView: row.can_view,
      canEdit: row.can_edit,
      canDelete: row.can_delete,
      isOverridden: true,
    };
  };
}
