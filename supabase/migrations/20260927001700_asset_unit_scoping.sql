-- =============================================================================
-- Assets are read per unit: a staff member sees their own department's rows.
--
-- Until now `assets_select_authenticated` was `using (true)`, which made every
-- signed-in user read every asset. That was a deliberate decision and it is still
-- the right one for *staff reading stock*: an asset list is useless if you cannot
-- see the category it sits in. What it did not account for is that by now there
-- are **two units with separate forms, separate routes and separate columns** —
-- IT hardware and HSSE equipment. A staff member in HSSE was reading the IT
-- inventory in full, which is a different proposition from "stock is visible to
-- everyone".
--
-- **Admin is unaffected and keeps reading every row.** The unit is a scoping tool
-- for staff, not a partition of who may see what.
--
-- **This compares two columns that mean the same thing and are not joined.**
-- The caller's unit comes from `profiles.department_id -> departments.name`,
-- which is the department of a *person*. The row's unit is `assets.department`,
-- free text copied from `categories.department`, which is the unit that owns a
-- *category*. `AGENTS.md` records that collision as deliberate. Nothing in the
-- schema ties the two together, so this policy joins them by **name** and that is
-- a real coupling: renaming a `departments` row or typing a variant into
-- `categories.department` silently empties somebody's asset list rather than
-- erroring. It fails toward fewer rows, never toward more, which is the direction
-- that matters for a policy.
--
-- **`current_asset_unit()` is `security definer` for the same reason `is_admin()`
-- is.** The policy has to read `profiles`, and doing that through the caller's own
-- RLS would make the answer depend on a policy that has nothing to do with this
-- one — `profiles_select_own_or_admin` happens to let a caller read their own row
-- today, so a plain subquery would work right now and could stop working if that
-- policy were ever narrowed. Pinning `search_path` is for the same reason as every
-- other definer function here.
--
-- `text` rather than a uuid: the two units are compared as names because one side
-- is a name and the other is free text. There is no unit table to point at yet —
-- `categories.department` and `departments.name` would have to be unified first,
-- which is a larger change than this policy and is not implied by it.
-- =============================================================================

create or replace function public.current_asset_unit()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select d.name
    from public.profiles p
    join public.departments d on d.id = p.department_id
   where p.id = auth.uid()
$$;

-- Narrow the EXECUTE grant.
--
-- **Revoking from `public` is not enough, and this was a live defect.** Supabase
-- sets default privileges on schema `public` that grant EXECUTE on new functions
-- to `anon`, `authenticated` and `service_role` **explicitly**. `revoke ... from
-- public` removes only the implicit PUBLIC grant, so the explicit `anon=X` entry
-- survives — verified by reading `pg_proc.proacl` rather than trusting the revoke
-- to have done what it looked like it did:
--
--   is_admin  → {postgres=X, anon=X, authenticated=X, service_role=X}
--
-- `00300` revoked `is_admin()` the insufficient way and it has been that way ever
-- since. Not exploitable today: both functions take no arguments, are
-- `security definer`, and resolve against `auth.uid()`, which is NULL without a
-- JWT — so `is_admin()` returns false and `current_asset_unit()` returns NULL for
-- an anonymous caller. The leak is nil and the boundary is intact. It is fixed
-- here because the two lines below name the roles explicitly, and a function that
-- reports which department the caller sits in is still nothing `anon` should be
-- able to ask.
--
-- `service_role` is revoked alongside `anon` for the same reason; it can already
-- bypass RLS entirely, so the grant was redundant rather than dangerous.
revoke all on function public.current_asset_unit() from public, anon, service_role;
grant execute on function public.current_asset_unit() to authenticated;

-- The same two lines for `is_admin()`, which has carried the defect since 00200.
-- Redefining the function here is not needed and is deliberately not done: only
-- the privilege changes, and a `revoke` is enough. (`00300` already tried this and
-- its wording is left alone — an applied migration is a historical record.)
revoke all on function public.is_admin() from public, anon, service_role;
grant execute on function public.is_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- The policy itself.
--
-- Replaced rather than amended: `using (true)` and the new expression cannot both
-- be true-or-false in a way that composes, and an OR-ed old policy would widen
-- the grant rather than narrow it. Postgres ORs multiple permissive policies for
-- the same command, so leaving the old one in place would have made this a no-op.
--
-- Writes are untouched. `assets_write_admin` already refuses every staff member,
-- so a staff reader gains nothing here and loses nothing either — this only decides
-- *which rows* a non-writing caller can read.
--
-- The `public.is_admin()` arm comes first because an admin's `departments` row
-- may well say `Engineer` or be null entirely, and the admin must see both units
-- regardless of what it says.
-- -----------------------------------------------------------------------------
drop policy "assets_select_authenticated" on public.assets;

create policy "assets_select_authenticated"
    on public.assets for select to authenticated
    using (
        public.is_admin()
        or assets.department = public.current_asset_unit()
    );

-- -----------------------------------------------------------------------------
-- `maintenance` is deliberately **not** scoped here, and that is a known gap
-- rather than an oversight.
--
-- `maintenance_select_authenticated` is still `using (true)`, so a staff member in
-- HSSE can read maintenance rows belonging to IT assets — and, after this
-- migration, can no longer read those assets to find out what they are. The rows
-- are therefore readable but not resolvable: the staff member learns that an
-- unseen asset was serviced, and nothing else.
--
-- Scoping it is not free. `maintenance` has no unit column of its own, so the
-- policy would need a join to `assets` — from inside a policy on a table that
-- `assets` references, which is the same self-referential shape that made the
-- `categories` embed unusable (see `AGENTS.md`, the self-embed trap). It is left
-- for the maintenance feature, which does not exist yet, rather than guessed at
-- here.
-- -----------------------------------------------------------------------------