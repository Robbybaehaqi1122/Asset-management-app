-- Fix: `sync_asset_status_from_assignment` runs with the caller's rights, so a
-- staff member's return never flips the asset back to `available`.
--
-- ## The bug
--
-- `00500` created `sync_asset_status_from_assignment` as a plain trigger function
-- — **not** `security definer` — and its body ends in
--
--     update public.assets set status = 'available' where id = new.asset_id;
--
-- Invoker rights means that statement runs as whoever called the UPDATE on
-- `assignments`. `assignments_update_own_or_admin` lets a staff member return a
-- handover they hold; `assets_write_admin` is `for all using (is_admin())` and
-- lets **nobody but an admin** write `assets`. So for a staff caller the update
-- matches zero rows, and `assignments` says one thing while `assets` says another.
--
-- ## Why it is silent, and why it matters
--
-- A row filter under RLS is not an error. The staff member sees the handover
-- flip to "Returned", the list reloads, and the asset is still `assigned`. It then
-- stops appearing in the handover target picker — which reads
-- `status = 'available'` — so an asset somebody physically handed back cannot be
-- handed out again. That is a stranded asset, and nothing anywhere reports it.
--
-- Verified on the local stack before writing this: a staff member returned a
-- handover through PostgREST, `assignments.returned_at` was set, and the asset's
-- status was still `assigned`. The same return performed by an admin works,
-- because `is_admin()` passes the policy — which is why this survived the RLS
-- suite, whose "asset is back in stock" assertion was measured after an admin
-- action.
--
-- ## Why `security definer` is the fix, and why it is safe here
--
-- The precedent is already in this schema. `assets_guard_status` is
-- `security definer` and `00500` says why:
--
--     `assignments_select_own_or_admin` only shows a caller *their own* loans and
--     RLS there is `force`d, so an invoker-rights check would see an empty table
--     and wave the contradiction through.
--
-- The same reasoning applies with the roles reversed: an invoker-rights *write*
-- to `assets` is filtered to nothing by the same policies. So this is not a new
-- privilege being handed out — it is the trigger getting back the ability to do
-- the one statement its author already wrote, for the caller the RLS table
-- already permits.
--
-- The blast radius is exactly the transition `00500` already performs:
-- `available` → `assigned` and `assigned` → `available`. No other statement in
-- the function touches anything, and it only fires on a `returned_at` transition
-- (or an insert/delete of an open loan) — never on an arbitrary column change.
--
-- `search_path` is pinned for the reason every `security definer` function here
-- pins it: without it, a caller who can create a schema earlier in the path can
-- shadow `update` and redirect the write.
create or replace function public.sync_asset_status_from_assignment()
returns trigger
language plpgsql
security definer
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

comment on function public.sync_asset_status_from_assignment() is
  'security definer since 02000, and the reason is a silent bug rather than a '
  'privilege: as invoker rights the final update on public.assets matched zero '
  'rows for a staff caller (assets_write_admin is admin-only), so a return by a '
  'staff member left the asset stranded at assigned and out of the handover '
  'picker. The same asymmetry is why assets_guard_status is security definer. '
  'Search path is pinned for the reason every other security definer here pins it.';

-- ---------------------------------------------------------------------------
-- What this migration deliberately does not do
-- ---------------------------------------------------------------------------
--
-- It does not change `assets_write_admin`, and it does not loosen anything for
-- the client. A staff member still cannot write `assets` directly — this only
-- makes the trigger's own bookkeeping work for the caller RLS already trusts.
--
-- It does not re-point the trigger. The transition itself is unchanged, and
-- `assets_guard_status` still refuses any *direct* write that contradicts the
-- loans, so a stray client update cannot put the two back out of step.