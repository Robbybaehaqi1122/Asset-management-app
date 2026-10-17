import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";

import type { MenuAccess, MenuPermissionRow } from "./menuAccess";
import { denyAllMenuAccess, resolveMenuAccess } from "./menuAccess";
import { getOwnPermissions } from "./services/permissionService";

export interface MenuAccessApi {
  /**
   * `true` while a staff reader's overrides are still in flight.
   *
   * `false` for an admin, and `false` before the profile has arrived — there is nothing
   * to fetch until there is an id to fetch it for, and reporting that as "still loading"
   * would leave the sidebar waiting on a request that will never be made.
   */
  isLoading: boolean;
  /** What this reader may do on `menuKey`. Never throws, never null. */
  access: (menuKey: string) => MenuAccess;
}

const NO_ROWS: MenuPermissionRow[] = [];

/**
 * Rows together with the account they were read for.
 *
 * **The account is part of the state**, which is the whole point of holding an object
 * rather than a bare array: a sign-out or an account switch leaves the previous
 * reader's rows in state, and anything that read them would show one person's menu
 * access to another. Comparing the ids and falling back to nothing makes that impossible
 * without a `setState` in the effect, and `AuthContext` solves the same problem the same
 * way for the same reason.
 */
type LoadedRows = { profileId: string; rows: MenuPermissionRow[] };

/**
 * The signed-in reader's menu access, resolved from `user_menu_permissions`.
 *
 * ## An admin short-circuits and asks for nothing
 *
 * An admin's role already reaches every menu, so their rows are never consulted and no
 * request is made. That keeps the shell's render path free of a round trip for the
 * people who can already do everything, and it means a row that somehow exists for an
 * admin has no effect rather than becoming a way to hide a screen from them.
 *
 * ## Two consumers, two fetches — stated rather than hidden
 *
 * `AppSidebar` and any page asking for `canEdit` each call this, and each fetches its
 * own four rows. That is deliberate: it avoids a new provider threaded through
 * `AppLayout` for a table this small, and a page asking what it may write is better off
 * with rows read at navigation time than with whatever a shell-level cache held.
 *
 * The cost is that the two can briefly disagree, and it can only ever be a **menu**
 * disagreeing with a **button** on the same screen — never a wrong answer, because both
 * go through the same `resolveMenuAccess`. The rule lives in one place; only the timing
 * is duplicated.
 *
 * ## Fails closed, and visibly so
 *
 * A reader whose rows have not arrived gets `canView: false`. The sidebar therefore hides
 * the configurable menus for one frame on first load, which is the same thing
 * `AppSidebar` already does with the unit filter while `profile` is still null — the
 * existing behaviour, not a new flicker.
 *
 * `isLoading` distinguishes that frame from a reader who genuinely has no overrides, so
 * a caller that wants to say "still checking" can, rather than every wait looking like a
 * denial.
 *
 * This is a UI gate. RLS remains the only authority on data; see the table comment in
 * migration `03500` for why a row here can narrow a staff member but never widen them.
 */
export function useMenuAccess(): MenuAccessApi {
  const { profile } = useAuth();
  const isAdmin = useIsAdmin();
  const profileId = profile?.id ?? null;

  const [loaded, setLoaded] = useState<LoadedRows | null>(null);

  useEffect(() => {
    // No id to read for, and an admin never needs the read at all. Returning without
    // touching state is deliberate: everything this hook reports is derived from
    // `profileId` and `isAdmin`, so there is nothing to reset — and resetting it here
    // would be a synchronous `setState` in an effect, which is a cascading render.
    if (isAdmin || profileId === null) return;

    // Covers the request being in flight across a sign-out or an account switch, where
    // the response lands after the reader has already changed.
    let cancelled = false;

    void getOwnPermissions().then((rows) => {
      if (cancelled) return;
      setLoaded({ profileId, rows });
    });

    return () => {
      cancelled = true;
    };
  }, [isAdmin, profileId]);

  const rows = loaded?.profileId === profileId ? loaded.rows : NO_ROWS;
  const isLoaded = loaded?.profileId === profileId;

  const access = useMemo(() => {
    // Before the profile exists there is no reader to resolve, so the answer is "no".
    // This is the fail-closed direction `useIsAdmin` takes, and it is a separate
    // exported value rather than an empty row set: `resolveMenuAccess([])` is what an
    // admin is given, and it grants everything.
    if (profileId === null) return denyAllMenuAccess;

    // An admin resolves against no rows, which lands on the absent-row answer — every
    // menu readable. `canDelete` reading `false` there is not what authorises a delete
    // anywhere: every delete in the app is gated by `useIsAdmin()` independently, and
    // `assets_write_admin` is what actually refuses it.
    if (isAdmin) return resolveMenuAccess(NO_ROWS);

    return resolveMenuAccess(rows);
  }, [isAdmin, profileId, rows]);

  const isLoading = !isAdmin && profileId !== null && !isLoaded;

  return { isLoading, access };
}
