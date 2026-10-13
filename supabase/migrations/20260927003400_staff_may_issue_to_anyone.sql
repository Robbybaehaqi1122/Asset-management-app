-- A staff member may hand an asset in their own department to anyone on the roster.
--
-- ## This reverses a decision made two migrations ago
--
-- `03100` added `assignments_insert_own_or_admin`, whose `with check` required the
-- recipient to be the roster row linked to the caller's own account. The owner chose
-- self-service when asked. **They have since asked for the opposite**, having found that
-- the picker showed nothing at all — see "Why it looked empty" below — so the restriction
-- is lifted and the reversal is written down rather than quietly edited in.
--
-- ## What is lifted, and what is not
--
-- | | before | after |
-- |---|---|---|
-- | issue an asset **in your own department** | to yourself | **to anyone on the roster** |
-- | issue an asset in another department | refused | **refused** |
-- | return a handover | your own only | **your own only** |
-- | delete a handover | admin | **admin** |
--
-- **The unit boundary on the asset side is untouched**, and it is the one that matters. A
-- staff member can hand out their own department's stock to whoever; they cannot touch
-- another department's. That is the same shape `03100` established and the same reason the
-- Issue form's picker is already filtered by `getHandoverTargets(unit)`.
--
-- **The recipient is deliberately unrestricted.** `handover_users` exists precisely because
-- the recipient is often not an account — a contractor, a visitor, a technician who never
-- signs in here. Restricting recipients to the caller's own department would make that table
-- unusable from staff, and would refuse the ordinary case of lending a laptop to someone who
-- belongs to no department at all.
--
-- **Consequence, stated plainly:** any staff member can now assign their department's
-- equipment to any person on the roster. That is what the owner asked for and it is what
-- this grants. Returning it stays with the holder, so the loan cannot be closed by the
-- person who issued it.
--
-- ## Why it looked like a policy problem and was not
--
-- The picker was empty, and the obvious reading is "the filter is wrong". It was not. The
-- staff account had **no row in `handover_users` at all**, so `ownUserIds` was empty and
-- the self-only filter removed every option — including the one that account would have
-- been. With the filter gone the list is populated regardless, which is why the fix is
-- needed at all; but the missing roster row is a separate data gap and still matters, because
-- the Return button and the "addressed to me" arm both join through `profile_id`.

drop policy assignments_insert_own_or_admin on public.assignments;

create policy assignments_insert_own_unit_or_admin
    on public.assignments for insert to authenticated
    with check (
        public.is_admin()
        or exists (
            select 1
            from public.assets a
            where a.id = assignments.asset_id
              and a.department = public.current_asset_unit()
        )
    );

comment on policy assignments_insert_own_unit_or_admin on public.assignments is
  'Issue a handover: an admin may issue anything, a staff member may issue an asset in
   their own department to any person on the roster. The recipient is unrestricted on
   purpose — handover_users exists for people who never sign in. Returning a handover is
   still limited to its holder, and deleting one to admins.';