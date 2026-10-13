-- Let a staff member work the inventory, and keep the three admin-only screens admin-only.
--
-- ## What this actually changes
--
-- Nothing about **reading** — `01700` already scopes that:
--
-- ```sql
-- create policy assets_select_authenticated on public.assets for select to authenticated
--   using (public.is_admin() or assets.department = public.current_asset_unit());
-- ```
--
-- So an IT staff member's Asset HSSE list was **already empty**. The menu offering it was
-- the visible half of a boundary the database had been enforcing since `01700`.
--
-- What refused the other half was `assets_write_admin`, a single `for all` policy keyed on
-- `is_admin()`. This adds narrower policies beside it rather than replacing it, and the
-- reason matters: Postgres **ORs** multiple permissive policies for the same command, so
-- keeping `assets_write_admin` and adding `assets_write_own_unit_or_admin` composes
-- cleanly — `is_admin()` is a subset of the new expression, and nothing is widened beyond
-- what is intended. Replacing it instead would have had to restate the DELETE rule.
--
-- ## Add and edit are scoped to the caller's own unit
--
-- `assets.department` is **not written by the client**: `assets_sync_department` copies it
-- off the asset's category and overwrites whatever was sent. That is what makes the
-- `with check` below meaningful. A staff member who inserts while naming an HSSE category
-- has the trigger set `department = 'HSSE'`, and the check then refuses the row — so
-- **the category cannot be used to smuggle an asset into another unit**, and the same
-- holds for an UPDATE that repoints `category_id`.
--
-- ## Delete stays admin-only, and that is not an oversight
--
-- It was a decision, and the migration says so because the alternative reads like an
-- oversight. Removing an asset is irreversible, and `assets_guard_delete` refuses it while
-- the asset has any loan or maintenance history — so the rows a staff member *could* still
-- delete are exactly the ones with nothing to lose and nothing to check. The owner was
-- asked and kept `deleteHandover` and asset deletion admin-only alongside this.
--
-- ## A staff handover is to themselves, and only to assets in their own unit
--
-- `assignments_insert_admin` is admin-only, so this adds `assignments_insert_own_or_admin`
-- beside it. **Two conditions, and the second is the one that was not asked for.**
--
-- 1. The recipient must be the roster row linked to the caller's own account —
--    `exists (select 1 from handover_users where id = user_id and profile_id = auth.uid())`.
--    That is the same join `02000` introduced and the reason it is written as an explicit
--    `exists` rather than an equality: `assignments.user_id` points at `handover_users`,
--    not at `auth.users`, so comparing the two directly is false for every row and for
--    every caller — a failure that raises nothing and silently empties a staff member's
--    list. This is the fifth occurrence of that shape in this schema.
--
-- 2. **The asset must be in the caller's own unit**, or a staff member could hand an HSSE
--    asset to themselves by naming its uuid. The check is
--    `exists (select 1 from assets where id = asset_id and department = current_asset_unit())`,
--    and it needs no explicit unit test: the subquery runs as the caller, so
--    `assets_select_authenticated` already filters it to their unit. A policy can lean on
--    another policy's row filter instead of repeating the expression.
--
-- **The owner was asked whether a staff member could hand an asset to a colleague and chose
-- self-service**, which is what `00300`'s comment described and never implemented.

-- -----------------------------------------------------------------------------
-- assets: insert and update for the caller's own unit.
-- -----------------------------------------------------------------------------

create policy assets_insert_own_unit_or_admin
    on public.assets for insert to authenticated
    with check (public.is_admin() or assets.department = public.current_asset_unit());

create policy assets_update_own_unit_or_admin
    on public.assets for update to authenticated
    using (public.is_admin() or assets.department = public.current_asset_unit())
    with check (public.is_admin() or assets.department = public.current_asset_unit());

comment on policy assets_insert_own_unit_or_admin on public.assets is
  'Add an asset to your own department. assets.department is overwritten by
   assets_sync_department from the category, so the check judges the category the row
   actually landed in rather than whatever the client sent.';
comment on policy assets_update_own_unit_or_admin on public.assets is
  'Edit an asset in your own department. Repointing category_id to another unit is
   refused by the same expression, because the trigger moves department first.';

-- DELETE is deliberately left to assets_write_admin: an irreversible removal is an admin
-- decision, and the owner confirmed it when this was written.

-- -----------------------------------------------------------------------------
-- assignments: issue a handover, to yourself, from your own department.
-- -----------------------------------------------------------------------------

create policy assignments_insert_own_or_admin
    on public.assignments for insert to authenticated
    with check (
        public.is_admin()
        or (
            -- to yourself: the roster row linked to this account
            exists (
                select 1 from public.handover_users h
                where h.id = assignments.user_id
                  and h.profile_id = auth.uid()
            )
            -- and an asset in your own department, filtered by that table's own policy
            and exists (
                select 1 from public.assets a
                where a.id = assignments.asset_id
                  and a.department = public.current_asset_unit()
            )
        )
    );

comment on policy assignments_insert_own_or_admin on public.assignments is
  'Self-service checkout: to a roster row linked to your own account, and only from an
   asset in your own department. The unit test leans on assets_select_authenticated
   rather than restating it. Assignments to a colleague remain admin-only.';

-- Returning a handover a staff member holds is already permitted by
-- assignments_update_own_or_admin, and deleting one is still admin-only by decision.
-- No policy is added for either.