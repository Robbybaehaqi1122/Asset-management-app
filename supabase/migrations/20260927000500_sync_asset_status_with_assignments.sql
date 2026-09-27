-- =============================================================================
-- Asset Management App — keep assets.status in step with assignments
--
-- Closes #40. Until now nothing connected `assets.status` to the contents of
-- `assignments`, so all three of these were accepted by the database:
--
--   available + an open loan   -- contradictory
--   assigned  + no open loan   -- contradictory
--   retired   + an open loan   -- fine, an item can be retired while in the field
--
-- Verified on a local stack before writing this: each of the first two was
-- reachable, and a plain `update assets set status` was enough to create both.
--
-- `assignments_one_open_per_asset` already stops two people holding the same
-- asset. It says nothing about the *status* of that asset, which is why the
-- contradictions above coexisted with a correct uniqueness guarantee.
--
-- It takes two triggers, not one. The obvious half — "when an assignment is
-- inserted, set the asset to assigned" — is not sufficient, because `status` is
-- a column any client can also write directly, and nothing checked that write.
-- A client could insert a loan and then set the asset back to `available` in the
-- next statement. So:
--
--   (a) after assignments change, move the asset between available and assigned
--   (b) before assets.status is written, refuse a value that contradicts reality
--
-- (b) is the half that makes the column trustworthy, and it is also the half a
-- trigger on `assignments` alone can never provide.
--
-- Neither trigger overwrites `retired`, `damaged` or `maintenance`. Every
-- transition is conditioned on the status the row is in *now*, so a blind
-- overwrite — which would be worse than the current inconsistency — cannot
-- happen. Returning a retired asset leaves it retired; checking out a damaged
-- one leaves it damaged.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (a) follow the loans
--
-- Fires on the transition, not on every update of the row, and touches nothing
-- when the transition is not one this trigger owns. Not `security definer`:
-- whoever can modify assignments can already write assets, so no elevation is
-- needed, and this keeps the function from holding write access it does not use.
--
-- On INSERT a row may arrive with `returned_at` already set — a backdated closed
-- loan. That must not make the asset `assigned`, so only a null `returned_at`
-- does anything. It must not make it `available` either: if the asset currently
-- reads `assigned`, an open loan already exists that this insert did not create.
-- -----------------------------------------------------------------------------
create or replace function public.sync_asset_status_from_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if tg_op = 'INSERT' then
        if new.returned_at is null then
            update public.assets
            set status = 'assigned'
            where id = new.asset_id
              and status = 'available';
        end if;
        return new;

    elsif tg_op = 'DELETE' then
        -- Only a deleted *open* loan leaves the asset unheld. Removing a closed
        -- historical row is not a return and must not change the status.
        if old.returned_at is null then
            update public.assets
            set status = 'available'
            where id = old.asset_id
              and status = 'assigned';
        end if;
        return old;

    else
        if old.returned_at is distinct from new.returned_at then
            if new.returned_at is null then
                -- returned_at cleared: the loan is open again
                update public.assets
                set status = 'assigned'
                where id = new.asset_id
                  and status = 'available';
            else
                update public.assets
                set status = 'available'
                where id = new.asset_id
                  and status = 'assigned';
            end if;
        end if;
        return new;
    end if;
end;
$$;

create trigger assignments_sync_asset_status
    after insert or update or delete on public.assignments
    for each row execute function public.sync_asset_status_from_assignment();

-- -----------------------------------------------------------------------------
-- (b) refuse a status that contradicts the loans
--
-- `security definer`, unlike every other guard in this file, and deliberately so.
-- `assignments_select_own_or_admin` only lets a caller see *their own* loans, and
-- RLS on `assignments` is `force`d — so an invoker-rights check would silently see
-- an empty table and wave the contradiction straight through.
--
-- Today that cannot be exploited, because `assets_write_admin` means only an admin
-- writes `assets`, and an admin passes the `or public.is_admin()` arm of the
-- assignments policy. That is a coincidence between two policies rather than a
-- property of this function, and widening the write policies later would quietly
-- turn the guard off. Reading with elevated rights makes it correct by
-- construction instead. It raises no data to the caller: the message carries only
-- `asset_code`, which the caller is writing anyway.
--
-- 23514 is `check_violation`, the same code `block_maintenance_while_assigned`
-- uses, so all three workflow guards reject with one recognisable code.
-- -----------------------------------------------------------------------------
create or replace function public.guard_asset_status_against_assignments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Only a genuine change of status can conflict; ignore every other column.
    if tg_op = 'UPDATE' and new.status is not distinct from old.status then
        return new;
    end if;

    if new.status = 'assigned' and not exists (
        select 1
        from public.assignments
        where asset_id = new.id
          and returned_at is null
    ) then
        raise exception
            'Asset % has no open assignment and cannot be marked as assigned',
            new.asset_code
            using errcode = '23514';
    end if;

    if new.status = 'available' and exists (
        select 1
        from public.assignments
        where asset_id = new.id
          and returned_at is null
    ) then
        raise exception
            'Asset % still has an open assignment; return it before marking it available',
            new.asset_code
            using errcode = '23514';
    end if;

    return new;
end;
$$;

-- INSERT is included because a row cannot have loans yet, so declaring it
-- `assigned` on creation is the same contradiction one statement later.
create trigger assets_guard_status
    before insert or update on public.assets
    for each row execute function public.guard_asset_status_against_assignments();

-- The column comment said nothing auto-syncs this, which was true when written
-- and stops being true here.
comment on column public.assets.status is
    'Lifecycle state. available/assigned follow the open loans in assignments and are maintained by the assets_guard_status and assignments_sync_asset_status triggers; maintenance, damaged and retired are set by people and are never overwritten by those triggers.';
