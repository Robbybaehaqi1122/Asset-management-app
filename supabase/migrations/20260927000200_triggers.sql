-- =============================================================================
-- Asset Management App — functions and triggers
--
-- Four triggers, each for something the database should guarantee regardless of
-- which client wrote the row:
--
--   1. set_updated_at              — keeps updated_at honest on every table that has it
--   2. handle_new_user             — creates the profiles row on signup
--   3. guard_maintenance_assignment — stops maintenance and checkout colliding
--   4. protect_profile_role        — stops privilege escalation via self-service update
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. updated_at maintenance
--
-- Set in the database, not the client. A client that forgets to send
-- updated_at would otherwise freeze the column, and no application code is
-- trustworthy enough to own this.
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

-- No profiles trigger. The specified profiles table has `created_at` only, so
-- there is no updated_at column for this to maintain. Adding one means adding
-- the trigger back here too.

create trigger categories_set_updated_at
    before update on public.categories
    for each row execute function public.set_updated_at();

create trigger locations_set_updated_at
    before update on public.locations
    for each row execute function public.set_updated_at();

create trigger assets_set_updated_at
    before update on public.assets
    for each row execute function public.set_updated_at();

create trigger maintenance_set_updated_at
    before update on public.maintenance
    for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Auto-create the profile on signup
--
-- SignupForm sends `options.data.full_name` and `options.data.department`, which
-- land in raw_user_meta_data. Without this trigger every new user would have a
-- session but no profile row, and the RLS policies in rls.sql are all written
-- in terms of profiles — so they would resolve to "not an admin" and the admin's
-- own account would be locked out of every write.
--
-- Reading `role` from metadata would be a privilege-escalation hole: signup
-- accepts an arbitrary `options.data` object from an anonymous caller, so anyone
-- could post `{ role: 'admin' }` and be handed an admin. `role` is therefore
-- computed here and never read from `new`.
--
-- security definer is required: the insert runs as the function owner (which
-- bypasses RLS), because an `authenticated` user has no INSERT policy on
-- profiles and must not be able to mint their own admin row.
--
-- search_path is pinned so a caller cannot shadow `insert` or `new` via a
-- malicious schema earlier in the path.
--
-- BOOTSTRAP. Every signup is `staff` except the very first, which becomes
-- `admin`. Without that, nobody can ever become an admin: the role column
-- defaults to staff, staff cannot change the role column (see
-- protect_profile_role), and no admin exists to grant it. The project would be
-- permanently read-only.
--
-- The advisory lock matters. Two simultaneous signups would otherwise both read
-- "no admin exists" and both insert an admin. `pg_advisory_xact_lock` is scoped
-- to the transaction and auto-releases, so there is no lock row to leak if this
-- throws.
--
-- This is a bootstrap, not a permanent policy. On a public deployment it is only
-- safe because it is a one-shot — after the first signup the condition is false
-- forever, so the window to claim admin is closed by whoever gets there first.
-- If that is not acceptable for a public signup form, turn off "Enable email
-- signups" in Supabase and create users from the dashboard or an admin-only
-- path instead.
--
-- To seed or repair an admin explicitly:
--
--   update public.profiles set role = 'admin' where id = '<uuid>';
--
-- To close the bootstrap off entirely, replace `v_first_user` with `false`.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_first_user boolean;
begin
    -- Serialise concurrent signups so exactly one can observe an empty profiles
    -- table. Any constant works as the key; this one names the intent.
    perform pg_advisory_xact_lock(hashtext('asset-management.first-admin'));

    select not exists (
        select 1 from public.profiles where role = 'admin'
    ) into v_first_user;

    insert into public.profiles (id, full_name, department, role)
    values (
        new.id,
        nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
        nullif(trim(coalesce(new.raw_user_meta_data ->> 'department', '')), ''),
        case when v_first_user then 'admin' else 'staff' end
    );
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 3. maintenance vs. checkout
--
-- An asset cannot be sent to maintenance while it is checked out, and it cannot
-- be checked out while it is in maintenance. Both directions are enforced here
-- because neither is expressible as a CHECK constraint — each spans two tables.
--
-- Two BEFORE triggers rather than one, since they fire on different tables. The
-- assignments side reads assets; the assets side reads assignments. Neither is
-- security definer: both tables are readable by any authenticated user under
-- the rls.sql policies, so plain invoker rights can already see what it needs.
--
-- 23514 is `check_violation`, chosen because from a caller's point of view this
-- is the same class of rejection as the CHECK constraints it replaced. The app
-- does not surface Postgres error codes from these — nothing in `src/` writes
-- these tables yet.
-- -----------------------------------------------------------------------------
create or replace function public.block_maintenance_while_assigned()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.status = 'maintenance' and old.status is distinct from 'maintenance'
       and exists (
           select 1 from public.assignments
           where asset_id = new.id and returned_at is null
       ) then
        raise exception
            'Asset % is still checked out; return it before sending it to maintenance',
            new.asset_code
            using errcode = '23514';
    end if;
    return new;
end;
$$;

create trigger assets_guard_maintenance
    before update on public.assets
    for each row execute function public.block_maintenance_while_assigned();

create or replace function public.block_assignment_while_in_maintenance()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.returned_at is null
       and exists (
           select 1 from public.assets
           where id = new.asset_id and status = 'maintenance'
       ) then
        raise exception
            'Asset % is in maintenance and cannot be checked out', new.asset_id
            using errcode = '23514';
    end if;
    return new;
end;
$$;

create trigger assignments_guard_maintenance
    before insert or update on public.assignments
    for each row execute function public.block_assignment_while_in_maintenance();

-- -----------------------------------------------------------------------------
-- 4. Role protection
--
-- RLS lets a user update their own profiles row, which means without this
-- trigger a `staff` member could set their own role to `admin` and escalate.
-- This is the classic Supabase privilege-escalation hole.
--
-- is_admin() is security definer so it can read profiles without re-entering
-- RLS. That is what stops infinite recursion, since the profiles policies in
-- rls.sql call this function.
--
-- Enforcement is left to the database on purpose. Restricting the column with
-- a column-level GRANT instead would also block legitimate admin role changes,
-- because admins hold exactly the same grants as everyone else.
--
-- Defined before protect_profile_role() because a plpgsql body resolves its
-- function calls at first execution, not at CREATE time — so the order here is
-- documentation, not a hard requirement. It should still be right.
-- -----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.profiles
        where id = (select auth.uid())
          and role = 'admin'
    );
$$;

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.role is distinct from old.role
       and not public.is_admin() then
        raise exception 'Only an admin may change the role column'
            using errcode = '42501';
    end if;
    return new;
end;
$$;

create trigger profiles_protect_role
    before update on public.profiles
    for each row execute function public.protect_profile_role();
