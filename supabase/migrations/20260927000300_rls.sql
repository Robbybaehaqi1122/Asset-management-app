-- =============================================================================
-- Asset Management App — row level security
--
-- Access model:
--
--   role       read                write
--   ---------  ------------------  -----------------------------------------
--   anonymous  nothing             nothing
--   staff      all reference data  own profile only; own assignments only
--   admin      all reference data  everything
--
-- Reference data = categories, locations, assets, maintenance. Staff read all of
-- it because an asset list is useless if you cannot see what category it is in,
-- but they do not edit it. Assets are inventory, not user content.
--
-- Two independent layers, both required:
--
--   grants  — table-level privileges. `anon` is granted nothing at all, so a
--              policy mistake can never leak to unauthenticated callers.
--   RLS     — row-level filtering, which is where the role distinction lives.
--
-- Every policy is written `to authenticated`. None exist for `anon`.
--
-- `(select auth.uid())` rather than `auth.uid()` throughout: Postgres caches an
-- InitPlan for a stable function used directly in a policy, and the explicit
-- select form is what makes that caching kick in. On a policy applied per row
-- across a large table, the difference is measurable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enable RLS on everything. No exceptions. A table without this is fully
-- readable and writable by anyone holding the anon key.
-- -----------------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.categories   enable row level security;
alter table public.locations    enable row level security;
alter table public.assignments  enable row level security;
alter table public.assets       enable row level security;
alter table public.maintenance  enable row level security;

-- Belt and braces: force RLS to apply to the table owner too, not just the
-- `authenticated` and `anon` roles. Without this, a table owned by a role that
-- bypasses RLS (postgres, service_role) stays reachable — which is correct for
-- service_role, and worth being explicit about rather than accidental.
alter table public.profiles     force row level security;
alter table public.categories   force row level security;
alter table public.locations    force row level security;
alter table public.assignments  force row level security;
alter table public.assets       force row level security;
alter table public.maintenance  force row level security;

-- -----------------------------------------------------------------------------
-- Grants
--
-- `anon` deliberately receives nothing. It is not granted `usage` on any of
-- these tables, so even a bug in the policy list below cannot expose data to
-- an unauthenticated caller. Revoke first: Supabase's default privileges may
-- already have granted these.
-- -----------------------------------------------------------------------------
revoke all on public.profiles    from anon;
revoke all on public.categories  from anon;
revoke all on public.locations   from anon;
revoke all on public.assets      from anon;
revoke all on public.assignments from anon;
revoke all on public.maintenance from anon;

grant usage on schema public to authenticated;

grant select                         on public.profiles to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.locations  to authenticated;
grant select, insert, update, delete on public.assets      to authenticated;
grant select, insert, update, delete on public.assignments to authenticated;
grant select, insert, update, delete on public.maintenance to authenticated;

-- is_admin() is called from policies. Functions are executable by PUBLIC by
-- default, which would expose it to `anon`; revoke and re-grant narrowly.
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- =============================================================================
-- profiles
-- =============================================================================
-- Read: your own row, or every row if you are an admin (needed to render a
-- user picker for assignment).
create policy "profiles_select_own_or_admin"
    on public.profiles for select to authenticated
    using (id = (select auth.uid()) or public.is_admin());

-- Update: your own row only. The `with check` re-asserts the id, so a crafted
-- request cannot move the row it just wrote onto somebody else's id.
-- The role column is protected separately by the protect_profile_role trigger,
-- because a policy alone cannot restrict which columns get written.
create policy "profiles_update_own"
    on public.profiles for update to authenticated
    using (id = (select auth.uid()) or public.is_admin())
    with check (id = (select auth.uid()) or public.is_admin());

-- No INSERT policy. Rows arrive via the on_auth_user_created trigger, which is
-- security definer. A self-service insert here would let anyone fabricate a
-- profile — including one with role = 'admin'.
--
-- No DELETE policy. profiles is tied to auth.users, which handles its own
-- lifecycle; a dangling profile is a bug to fix, not something to clean up by
-- deleting the row.

-- =============================================================================
-- categories / locations — read for all staff, write for admin
-- =============================================================================
create policy "categories_select_authenticated"
    on public.categories for select to authenticated
    using (true);

create policy "categories_write_admin"
    on public.categories for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

create policy "locations_select_authenticated"
    on public.locations for select to authenticated
    using (true);

create policy "locations_write_admin"
    on public.locations for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- =============================================================================
-- assets — read for all staff, write for admin
-- =============================================================================
create policy "assets_select_authenticated"
    on public.assets for select to authenticated
    using (true);

create policy "assets_write_admin"
    on public.assets for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- =============================================================================
-- assignments — the one place staff are not merely read-only
--
-- Staff may loan an asset to themselves and hand one back; they may not record
-- a loan to a colleague. Admins may do either. This is what makes a
-- self-service checkout flow possible without giving staff write access to the
-- whole asset table.
-- =============================================================================
create policy "assignments_select_own_or_admin"
    on public.assignments for select to authenticated
    using (user_id = (select auth.uid()) or public.is_admin());

-- Returning your own loan sets `returned_at`; the `with check` keeps the row
-- pointed at you afterwards, so it cannot be used to hand the asset straight
-- from one user to another.
create policy "assignments_update_own_or_admin"
    on public.assignments for update to authenticated
    using (user_id = (select auth.uid()) or public.is_admin())
    with check (user_id = (select auth.uid()) or public.is_admin());

create policy "assignments_insert_admin"
    on public.assignments for insert to authenticated
    with check (public.is_admin());

create policy "assignments_delete_admin"
    on public.assignments for delete to authenticated
    using (public.is_admin());

-- =============================================================================
-- maintenance — read for all staff, write for admin
-- =============================================================================
create policy "maintenance_select_authenticated"
    on public.maintenance for select to authenticated
    using (true);

create policy "maintenance_write_admin"
    on public.maintenance for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());
