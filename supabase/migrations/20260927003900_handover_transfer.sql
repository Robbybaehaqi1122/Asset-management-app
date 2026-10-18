-- Handover transfer: record where a loan came from, and add a transfer RPC that
-- returns an open loan (or a whole batch) and re-issues it to a different
-- recipient in one go.
--
-- ## Why
--
-- Returning then re-issuing has three observable gaps:
-- 1. The asset goes to `available` between the two statements (race prevented by
--    `assignments_one_open_per_asset`, but the window exists).
-- 2. No link between the old and new loan, so history is unlinked.
-- 3. Accessories stay on the returned loan; the replacement document lists none.
--    The issue asks to record the link and to decide accessory/document behaviour.
--
-- This migration introduces `assignments.transferred_to` to link the new loan
-- back to the loan it came from. The RPC `transfer_handover` returns the old
-- loan(s) and creates new ones for the same asset(s), copying accessories. It
-- operates on the **whole batch** containing the given loan (same user_id,
-- assigned_by, assigned_at) because a batch is one printed document.
--
-- ## Constraints/Notes
-- - Only open loans (returned_at is null) can be transferred.
-- - Cannot transfer if the target recipient is departed (enforced by the
--   `assignments_guard_recipient_active` trigger added in 03800).
-- - Accessories are copied to the new loans. The originals remain on the old
--   (now returned) loan — that preserves the signed paper for the old loan.
-- - `assigned_by` is set to the caller (auth.uid()). `assigned_at` is the
--   server's `now()` for the new batch.
-- - The function is `security invoker` so RLS applies as the caller. That means
--   only someone allowed to return the old loan(s) and issue the new one(s) can
--   call it. In practice this is admin-only for returning someone else's loan
--   (see assignments_update_own_or_admin).
--
-- - **The accessory copy makes it effectively admin-only, and that is emergent
--   rather than stated.** `assignments_accessories_insert_admin` is admin-only, and
--   `security invoker` means the copy runs as the caller. So a staff caller
--   transferring a batch *with* accessories is refused with 42501 on the accessory
--   insert -- after the old loans were already closed in the same transaction, which
--   rolls the whole thing back, so nothing is half-transferred. A batch with *no*
--   accessories inserts zero rows, no policy is ever evaluated, and the transfer
--   succeeds. The boundary is therefore "admin, or staff on an accessory-less
--   batch", which is a worse rule to reason about than either half of it. The UI
--   offers Transfer to admins only; this comment is here so nobody reads that as an
--   admin check that does not exist in the database.

-- 1) Add column
alter table public.assignments
  add column transferred_to uuid references public.assignments(id) on delete set null;

comment on column public.assignments.transferred_to is
  'The loan this loan was created from via transfer. Points to the old (now returned) assignment.';

-- 2) Index for lookups
create index assignments_transferred_to_idx on public.assignments (transferred_to);

-- 3) Transfer RPC
create or replace function public.transfer_handover(
  p_loan uuid,
  p_new_user uuid,
  p_notes text default null
)
returns table (
  old_loan_id uuid,
  new_loan_id uuid
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old_user uuid;
  v_assigned_by uuid;
  v_assigned_at timestamptz;
  v_now timestamptz := now();
  v_caller uuid := auth.uid();
  rec record;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Find batch key of source loan (open only)
  select user_id, assigned_by, assigned_at
    into v_old_user, v_assigned_by, v_assigned_at
    from public.assignments
   where id = p_loan
     and returned_at is null;

  -- `no_data_found`, **not** `check_violation`. The departed-recipient guard added
  -- in 03800 also raises 23514, so reusing it here would give the client two
  -- different refusals with one code and no way to say which happened. P0002 is the
  -- exact meaning — "no row in the state you asked for" — so the three refusals this
  -- function can produce are P0002 (source already back), 23503 (not a roster row) and
  -- 23514 (recipient departed), and each maps to its own sentence.
  if not found then
    raise exception 'source loan not found or already returned' using errcode = 'no_data_found';
  end if;

  -- Target must exist; departed guard will also refuse via assignments_guard_recipient_active
  perform 1 from public.handover_users h where h.id = p_new_user;
  if not found then
    raise exception 'target user not found' using errcode = 'foreign_key_violation';
  end if;

  -- Collect batch
  create temp table _batch (
    old_id uuid,
    asset_id uuid,
    cond text,
    due_date date
  ) on commit drop;
  insert into _batch (old_id, asset_id, cond, due_date)
  select a.id, a.asset_id, a.condition_at_handover, a.due_date
    from public.assignments a
   where a.user_id = v_old_user
     and ((a.assigned_by is null and v_assigned_by is null) or a.assigned_by = v_assigned_by)
     and a.assigned_at = v_assigned_at
     and a.returned_at is null
   order by a.asset_id;

  -- Close old, insert new and return mapping
  for rec in select * from _batch loop
    -- close old
    update public.assignments set returned_at = v_now where id = rec.old_id and returned_at is null;
    -- insert new
    insert into public.assignments (
      asset_id, user_id, assigned_by, assigned_at, condition_at_handover, due_date, notes, transferred_to
    ) values (
      rec.asset_id, p_new_user, v_caller, v_now, rec.cond, rec.due_date,
      nullif(trim(coalesce(p_notes, '')), ''), rec.old_id
    ) returning id into new_loan_id;
    -- copy accessories from old loan to new loan
    insert into public.assignments_accessories (assignment_id, name, serial_number)
    select new_loan_id, aa.name, aa.serial_number
      from public.assignments_accessories aa
     where aa.assignment_id = rec.old_id;
    -- return row
    old_loan_id := rec.old_id;
    return next;
  end loop;

  return;
end;
$$;

comment on function public.transfer_handover is
  'Transfers an entire batch (all open assignments sharing user_id/assigned_by/assigned_at) from the source loan to p_new_user. Closes old loans, creates new ones linked via transferred_to, and copies accessories. Runs with security invoker so RLS applies.';
