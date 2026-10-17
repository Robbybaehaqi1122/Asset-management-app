import {
  BoxCubeIcon,
  CalenderIcon,
  GroupIcon,
  SliderHorizontalIcon,
} from "@/icons";
import { isPermissionMenuKey } from "@/modules/permissions/menuAccess";

/**
 * The sidebar's menu, and the one predicate that decides who sees which row.
 *
 * Extracted out of `AppSidebar.tsx` so the command palette can offer the same
 * destinations **under the same rules**. Two lists built from two copies of this data
 * is how a palette ends up offering a screen the sidebar refuses to draw — the reader
 * types a name, gets a result, lands on a page that renders nothing, and concludes the
 * app is broken rather than that the screen is not theirs.
 *
 * **No i18n here.** `name` is the fallback for a row with no `key`, and `key` is the
 * `sidebar.items.<key>` lookup both consumers perform at render, because `useTranslation`
 * cannot be called from here.
 */

export type NavSubItem = {
  name: string;
  key?: string;
  path: string;
  target?: string;
  /**
   * Hidden from users who are not admins.
   *
   * On a sub-item rather than the group, because a group can mix an
   * open-to-everyone screen with an admin-only one: the asset inventory is
   * readable by every signed-in user while the reference-data editor is not, and
   * marking the group would take the inventory away from staff. Same fail-closed
   * reading as `NavItem.adminOnly` — the entry is absent until the profile has
   * arrived — and, like it, not an access control.
   */
  adminOnly?: boolean;
  /**
   * The unit this screen is for, matched against the reader's own department.
   *
   * **This is a menu filter, not an access control, and the database has been enforcing
   * the real boundary since `01700`:** `assets_select_authenticated` is
   * `is_admin() or department = current_asset_unit()`. An IT staff member's Asset HSSE
   * list was always empty — the row in the menu offering it was the visible half of a
   * boundary the query layer had been applying.
   *
   * **`null` matches everyone.** A sub-item without a unit is not department-scoped, and
   * treating a missing value as "matches nobody" would hide User Management and every
   * other unsuffixed entry.
   */
  unit?: string | null;
};

export type NavItem = {
  name: string;
  key?: string;
  icon: React.ReactNode;
  path?: string;
  target?: string;
  subItems?: NavSubItem[];
  /** Renders as a non-interactive placeholder instead of a link or submenu. */
  disabled?: boolean;
  /**
   * Hidden entirely from users who are not admins.
   *
   * `useIsAdmin()` rather than `profile?.role`, so the fail-closed default
   * lives in one place: until the profile has arrived the entry is absent,
   * which is the safe direction for an admin-only screen. Not an access
   * control — the screen and the RLS policies both refuse a non-admin on
   * their own.
   */
  adminOnly?: boolean;
};

export const navItems: NavItem[] = [
  {
    icon: <CalenderIcon fontSize={24} />,
    name: "Calendar",
    key: "calendar",
    path: "/calendar",
  },
  {
    icon: <BoxCubeIcon fontSize={24} />,
    name: "Asset Management",
    key: "assetManagement",
    // A submenu rather than a top-level row for the same reason user management
    // is one: this marks the group, the screen lives under it. The group with an
    // open submenu is derived from the active route, so navigating into Asset IT
    // opens it on its own.
    //
    // Asset Settings carries `adminOnly` on the *sub-item* rather than on the
    // group: the inventory itself is readable by every signed-in user, and hiding
    // the whole group from staff would take that away. The sub-item is where the
    // admin-only screen lives, so that is where the flag goes.
    subItems: [
      // One row per unit, matching the one route per unit in `App.tsx`. These
      // are separate lists rather than one list with a unit filter, because the
      // two have almost nothing in common: an HSSE item is inspected and expires,
      // an IT item is specced and networked, and the form shows a different
      // fieldset for each.
      // One row per unit, each carrying its unit so the menu can hide the other's. The
      // strings are the ones `assets_sync_department` copies off the category, so a
      // reader's department matches them exactly.
      { name: "IT Assets", key: "assetIt", path: "/assets", unit: "IT" },
      {
        name: "HSSE Assets",
        key: "assetHsse",
        path: "/assets-hsse",
        unit: "HSSE",
      },
      // One row, not one per unit — the reverse of the two rows above, and
      // deliberately so. Handover records nothing that varies by unit: it is one
      // list of who is holding what, so splitting it bought a second page rather
      // than a distinction. The unit became a filter inside the page, the same
      // shape `/asset-settings` uses for its own unit filter.
      //
      // Deliberately *not* `adminOnly`: a staff member can see what they are
      // holding and return it, which is the whole point of handing something out.
      // `assignments_select_own_or_admin` gives them their own rows and
      // `assignments_update_own_or_admin` lets them close one. The Issue button
      // is admin-gated inside the page instead, because
      // `assignments_insert_admin` is what refuses it.
      { name: "Handover", key: "handover", path: "/handover" },
      {
        name: "Reference Data",
        key: "assetSettings",
        path: "/asset-settings",
        adminOnly: true,
      },
    ],
  },
  {
    icon: <SliderHorizontalIcon fontSize={24} />,
    name: "System",
    key: "systemSetting",
    // `adminOnly` on the **group**, like User Management: everything filed under
    // System Setting is configuration for the installation rather than data anybody
    // needs to read, so the whole group disappearing for a staff member is correct —
    // and it means the next sub-item inherits the restriction without repeating it.
    adminOnly: true,
    // A submenu of one, which is deliberate rather than premature. The group is what
    // gives a *second* setting somewhere to live that nobody has to decide on in
    // advance, and it makes `/system-setting` a real route instead of a description.
    //
    // Kept separate from **Asset Settings** on purpose: that one owns the reference
    // data behind the asset form's pickers, and this one owns how the installation
    // behaves. Merging them would put "who may change a category" and "how the printer
    // is configured" in one list.
    subItems: [
      { name: "Print Setting", key: "printSetting", path: "/system-setting" },
    ],
  },
  {
    icon: <GroupIcon fontSize={24} />,
    name: "User Management",
    key: "userManagement",
    adminOnly: true,
    // A submenu rather than separate top-level rows, because these are screens of
    // one thing: the people, and the reference data they are described by. The one
    // with an open submenu is derived from the active route, so navigating into any
    // of them opens this group on its own.
    //
    // `adminOnly` is on the **group**, so a new sub-item inherits it without
    // repeating it — and a group whose every sub-item is admin-only is dropped
    // entirely rather than rendered as a dead row for a staff member.
    subItems: [
      { name: "Users", key: "userList", path: "/users" },
      // Per-person menu access. It carries **no** `adminOnly` because the group already
      // has it, so a new sub-item inherits it without repeating it — which is exactly
      // what the group-level flag is for.
      //
      // **Deliberately not gated by `user_menu_permissions` itself.** The four
      // configurable keys are `calendar`, `assetIt`, `assetHsse` and `handover`;
      // `permission` is not among them, so `isPermissionMenuKey` returns false for it
      // and the filter below lets it through untouched. Adding it to that set would mean
      // an admin could switch off the screen that switches permissions off.
      { name: "Permissions", key: "permission", path: "/permissions" },
      // Departments, job titles and employers on one screen, as three tabs.
      //
      // **One row rather than three, and rather than a fourth group.** They were
      // separate pages under this same group, and the grouping was wrong there: nothing
      // that is about an account reads any of the three. `profiles` reads
      // `department_id` and nothing else, while positions and companies are read only by
      // the roster form on Reference Data — and a company's name is printed on the
      // handover document itself, in the issuer's signature block and the recipient's
      // parties block. So two lists that had nothing to do with logins sat beside the one
      // screen whose subject is logins, and the screen where you *use* a list was a
      // different screen from the one that *held* it.
      //
      // Keeping them inside User Management rather than promoting them to a group of
      // their own is the owner's call, and it holds up: all three describe who works
      // here, and a fourth top-level group for three small lists was more structure than
      // the menu needed.
      //
      // `keyPrefix: "organisation"` in the i18n namespace, distinct from this `key`.
      { name: "Organisation", key: "organisation", path: "/organisation" },
    ],
  },
];

/**
 * Everything the reader's role, department and menu permissions decide.
 *
 * `canViewMenu` is injected rather than imported, because the permission read lives in
 * a hook and this module is plain data. Passing the resolver in is what keeps the
 * sidebar and the palette from each deciding the rule for themselves.
 */
export type MenuVisibility = {
  isAdmin: boolean;
  /** The reader's own unit, or `null`. See `NavSubItem.unit`. */
  readerUnit: string | null;
  canViewMenu: (menuKey: string) => boolean;
};

/**
 * Whether one sub-item renders for this reader.
 *
 * **Three separate questions, ANDed together** — and the order is the argument:
 *
 * 1. is it admin-only, and is the reader an admin?
 * 2. is it scoped to a unit, and is that the reader's unit?
 * 3. has a per-person menu permission withheld it?
 *
 * **All three narrow, none widens.** That is the same rule the `03500` migration states
 * about `user_menu_permissions`, and it is why a permission row can never hand a staff
 * member a screen RLS would refuse.
 */
function isSubItemVisible(
  sub: NavSubItem,
  { isAdmin, readerUnit, canViewMenu }: MenuVisibility,
): boolean {
  if (sub.adminOnly && !isAdmin) return false;

  // Admins are shown every unit; everyone else only their own. `null` means
  // "not department-scoped", so it always survives.
  if (sub.unit != null && !isAdmin && sub.unit !== readerUnit) return false;

  // An admin short-circuits: `useMenuAccess` resolves an admin against no rows at
  // all, and without this an admin whose rows somehow existed would lose menus, which
  // is the one outcome that table must never produce.
  if (isAdmin) return true;

  // A sub-item with no `key` is not one of the four configurable menus — the four are
  // named, and `permission` is deliberately not one of them. Anything unnamed passes
  // untouched rather than being filtered against a key it does not have.
  const key = sub.key;
  if (key === undefined || !isPermissionMenuKey(key)) return true;

  return canViewMenu(key);
}

/**
 * The menu as this reader may see it, groups with no visible children dropped.
 *
 * Filtering happens **here, once**, rather than during render: the sidebar maps over
 * this array, and a filter applied inside that `map` would shift the indices its
 * submenu state is keyed by, so the open-submenu marker would point at the wrong row.
 */
export function visibleNavItems(visibility: MenuVisibility): NavItem[] {
  return (
    navItems
      .filter((nav) => !nav.adminOnly || visibility.isAdmin)
      .map((nav) =>
        nav.subItems
          ? {
              ...nav,
              subItems: nav.subItems.filter((s) =>
                isSubItemVisible(s, visibility),
              ),
            }
          : nav,
      )
      // A group whose every sub-item is admin-only would render as a dead row
      // for a staff member, which is a worse affordance than hiding it. The
      // test is "does it still have any sub-items", NOT "is it adminOnly" —
      // the latter also threw away the admin-only groups for an admin, which
      // is how User Management went missing.
      .filter((nav) => !nav.subItems || nav.subItems.length > 0)
  );
}

/** One reachable destination, flattened out of the two-level menu. */
export type MenuDestination = {
  path: string;
  /** `sidebar.items.<key>`, resolved by the consumer. */
  labelKey: string;
  /** Untranslated, for the palette's fallback when a key is missing. */
  fallbackLabel: string;
  /** The group's `sidebar.items.<key>`, so a result says where it lives. */
  groupLabelKey: string;
  groupFallbackLabel: string;
  /** The group's icon, reused for sub-items which carry none. */
  icon: React.ReactNode;
  /**
   * `target` is deliberately **not** carried through.
   *
   * `NavItem` and `NavSubItem` both declare it because `Link` accepts it, but no row in
   * this menu sets it — every destination is an in-app route. Propagating it here would
   * mean a field nothing populates and a branch in the palette that can never run, and
   * react-router's `navigate` has no `target` option at all, so the honest shape is to
   * navigate in place. If a row ever does need a new tab, it needs a real decision here,
   * not a pass-through that silently does the wrong thing.
   */
};

/**
 * Every destination this reader can reach, as one flat list.
 *
 * Built from `visibleNavItems`, so it inherits all three filters — a staff member's
 * palette offers exactly the screens their sidebar draws, no more.
 *
 * A group with a `path` of its own is skipped: no group in this menu has one, but if
 * one were added it would be drawn as a link in the sidebar and must appear here too.
 * `disabled` rows are skipped for the same reason the sidebar does not link them.
 */
export function menuDestinations(
  visibility: MenuVisibility,
): MenuDestination[] {
  const destinations: MenuDestination[] = [];

  for (const nav of visibleNavItems(visibility)) {
    if (nav.disabled) continue;

    if (nav.subItems) {
      for (const sub of nav.subItems) {
        destinations.push({
          path: sub.path,
          labelKey: sub.key ? `sidebar.items.${sub.key}` : "",
          fallbackLabel: sub.name,
          groupLabelKey: nav.key ? `sidebar.items.${nav.key}` : "",
          groupFallbackLabel: nav.name,
          icon: nav.icon,
        });
      }
      continue;
    }

    if (!nav.path) continue;

    destinations.push({
      path: nav.path,
      labelKey: nav.key ? `sidebar.items.${nav.key}` : "",
      fallbackLabel: nav.name,
      // A top-level row has no group. `AppSidebar` renders `sidebar.groups.menu`
      // above them, and that is the honest context for a result like Calendar.
      groupLabelKey: "sidebar.groups.menu",
      groupFallbackLabel: "Menu",
      icon: nav.icon,
    });
  }

  return destinations;
}
