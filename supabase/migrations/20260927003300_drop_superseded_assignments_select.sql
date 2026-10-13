-- Drop the superseded assignments select policy.
--
-- ## Why this is its own file
--
-- `03200` added `assignments_select_own_department_or_admin` and left
-- `assignments_select_own_or_admin` in place. **Behaviourally that was fine** — Postgres
-- ORs multiple permissive policies for the same command, so the wider one won — but it was
-- the wrong shape, and the `01700` migration already sets the precedent for not leaving a
-- superseded policy beside its replacement.
--
-- Read back off the remote before dropping anything:
--
-- ```
-- old:  is_admin() OR exists (handover_users h
--                            where h.id = user_id and h.profile_id = auth.uid())
-- new:  is_admin()
--    OR exists (assets a      where a.id = asset_id and a.department = current_asset_unit())
--    OR exists (handover_users h where h.id = user_id and h.profile_id = auth.uid())
-- ```
--
-- **The old expression is the new one's third arm, verbatim.** It is therefore a strict
-- subset: dropping it cannot change which rows any caller sees. Verified by reading both
-- `pg_policies.qual` values rather than by reasoning about the migration text.
--
-- Two SELECT policies on one table is a maintenance hazard nobody needs: a reader has to
-- work out which one wins, and the answer — "both, and it does not matter" — is not the
-- kind of thing a schema should require anyone to hold.

drop policy "assignments_select_own_or_admin" on public.assignments;

comment on policy assignments_select_own_department_or_admin on public.assignments is
  'Read: admin sees everything; a staff member sees their own department''s handovers, plus
   any addressed to them even if the asset has since moved unit. Supersedes the policy of
   the same table dropped by 03300, whose expression is this one''s third arm.

   Write is unchanged: returning, issuing and deleting are all as restrictive as before.';