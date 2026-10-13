-- A staff member sees their whole department's handovers, not only their own.
--
-- ## What widens, and what deliberately does not
--
-- The owner asked for "staff IT must see all handovers in IT", and that is a **read**
-- change only. Three things are deliberately left exactly as they were:
--
-- | | before | after |
-- |---|---|---|
-- | see handovers in their own department | only the ones addressed to them | **all of them** |
-- | return a handover | only their own | **only their own** |
-- | issue a handover | to themselves | **to themselves** |
-- | delete a handover | admin | **admin** |
--
-- **Visibility widened; authority did not.** Returning a handover is recording that a
-- colleague physically gave an item back, so `assignments_update_own_or_admin` is untouched
-- — and the Return button on a colleague's row is decided by the same
-- `getOwnHandoverUserIds()` set as before. A staff member can now *read* that a laptop went
-- out and has not come back, which is what the register is for, without being able to close
-- someone else's loan.
--
-- ## The third `or` arm is not decoration
--
-- The obvious two arms are "is admin" and "the asset is in my department". The third —
-- "this handover is addressed to a roster row linked to my account" — is kept from the
-- existing policy on purpose, because of one real scenario: **a transfer.** Someone is
-- issued a laptop in IT, then moves to Finance. Their department changes, so the
-- department arm stops matching, and without the third arm they would silently stop being
-- able to see an asset they are still physically holding. No error, no empty-state warning
-- about anything unusual — the item simply vanishes from their view.
--
-- ## The unit test is written out even though `assets_select_authenticated` would filter it
--
-- The `exists` over `assets` runs as the caller, so `01700` already hides other departments'
-- rows and the unit comparison is not strictly required. It is written anyway, for two
-- reasons: the policy reads as what it means without requiring the reader to know how RLS
-- composes inside a subquery, and **if `01700` is ever widened to `using (true)` — which is
-- what "the inventory is readable by everyone" would look like — this policy stays correct
-- on its own.** It leans on the other policy as a second line of defence, not as the only
-- one.

create policy assignments_select_own_department_or_admin
    on public.assignments for select to authenticated
    using (
        public.is_admin()
        -- every handover whose asset belongs to the caller's own department
        or exists (
            select 1
            from public.assets a
            where a.id = assignments.asset_id
              and a.department = public.current_asset_unit()
        )
        -- plus any addressed to this account regardless of its asset's unit, so that a
        -- transfer does not make a physically-held item disappear from its holder's view
        or exists (
            select 1
            from public.handover_users h
            where h.id = assignments.user_id
              and h.profile_id = (select auth.uid())
        )
    );

comment on policy assignments_select_own_department_or_admin on public.assignments is
  'Read: admin sees everything; a staff member sees their own department''s handovers, plus
   any addressed to them even if the asset has since moved unit. Write is unchanged —
   returning, issuing and deleting are all as restrictive as they were.';