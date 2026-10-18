-- Handover transfer, **one device at a time**.
--
-- This replaces the batch-wide body of `transfer_handover` from `03900`. The signature,
-- the return shape and the column are unchanged; what changes is how many loans it
-- touches.
--
-- ## Why one device and not the whole batch
--
-- `03900` resolved the batch from `(user_id, assigned_by, assigned_at)` and moved every
-- open loan in it, on the reasoning that a batch is one printed document. That is right
-- about **issuing** and wrong about **transferring**, and the difference is that the two
-- acts are not the same act.
--
-- Issuing writes one document and one holder, so the group is the unit. Transferring is
-- somebody giving one thing they are holding to another person: Budi is handed a laptop
-- and a charger on Monday, goes on leave Tuesday, and hands the **laptop** to Sari while
-- the charger stays on his desk. Forcing that to move all eight devices produces a
-- refusal for the one case that has an obvious answer, and offers no way to record the
-- case that actually happened.
--
-- **It also reverses where the control lives.** The Detail modal already puts Return on
-- each device row, because "a control that acts on a device belongs beside that device" —
-- returning the laptop while keeping the mouse is a real operation. Transfer is that same
-- operation on the same axis, so it belongs in the same place and not in the batch's
-- row menu, which had also grown a per-device Delete entry for every returned device.
--
-- ## What a per-device transfer leaves behind
--
-- The transferred device becomes **its own batch**: `assigned_at = now()` and the new
-- `user_id` put it under a key nothing else shares. So the original eight-device
-- document is closed and unchanged — still the record of what went out that day — and
-- the new holder gets a one-device document of their own. Both are correct, and neither
-- is a partial state: the old loan is `returned_at`-stamped, not deleted, so its
-- accessories and its printed paper survive.
--
-- ## `FOR UPDATE` on the source loan, and why it is new here
--
-- `03900` read the source loan with no lock. Two admins clicking Transfer on the same
-- device would both see it open, both close it and both insert — and the second insert
-- would be caught by `assignments_one_open_per_asset` and reported as `23505`, a
-- duplicate-key error naming an index the admin cannot act on.
--
-- Locking the row turns that into `P0002`, which is the answer: in READ COMMITTED the
-- losing transaction re-reads the row after the winner commits, sees `returned_at` set,
-- and matches nothing. This is the same reasoning `assignments_guard_asset_available`
-- (`01900`) uses to turn an ordinary race into a `23514` that says what happened.
--
-- ## Unchanged from `03900`, deliberately
--
-- - `security invoker`, so RLS is the boundary. The accessory copy still runs under
--   `assignments_accessories_insert_admin`, which is what makes this admin-only in
--   practice for any batch whose device has a bag — see the note in `03900`.
-- - `no_data_found` for a source that is not open, so it stays distinct from the
--   departed-recipient guard's `23514`.
-- - Condition snapshot and due date copied rather than re-asked. The condition is the
--   fact as at handover, and re-reading it from the form would let the new document
--   disagree with the one that recorded it.

-- ---------------------------------------------------------------------------
-- 1. The function
-- ---------------------------------------------------------------------------

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
  v_asset uuid;
  v_cond text;
  v_due date;
  v_now timestamptz := now();
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- The source loan, and only that one. `for update` is the race guard above; the
  -- `returned_at is null` test is part of the read, so a loan closed while this waits
  -- for the lock simply matches nothing and falls into the refusal below.
  select a.asset_id, a.condition_at_handover, a.due_date
    into v_asset, v_cond, v_due
    from public.assignments a
   where a.id = p_loan
     and a.returned_at is null
     for update;

  -- `no_data_found`, **not** `check_violation` — `assignments_guard_recipient_active`
  -- raises 23514 for a departed recipient, and one code for two different refusals
  -- leaves the client unable to say which happened. See `03900`.
  if not found then
    raise exception 'source loan not found or already returned' using errcode = 'no_data_found';
  end if;

  -- Target must exist. The FK would catch it anyway; this is for the message.
  perform 1 from public.handover_users h where h.id = p_new_user;
  if not found then
    raise exception 'target user not found' using errcode = 'foreign_key_violation';
  end if;

  -- Close the old loan. `assignments_sync_asset_status` is an after-update trigger and
  -- puts the asset back to `available` right here, which is what lets the insert below
  -- satisfy `assignments_guard_asset_available` in the same transaction.
  update public.assignments
     set returned_at = v_now
   where id = p_loan;

  insert into public.assignments (
    asset_id, user_id, assigned_by, assigned_at, condition_at_handover, due_date, notes, transferred_to
  ) values (
    v_asset, p_new_user, v_caller, v_now, v_cond, v_due,
    nullif(trim(coalesce(p_notes, '')), ''), p_loan
  ) returning id into new_loan_id;

  -- Accessories travel with the device, and the originals stay on the closed loan so
  -- the document that was signed for it still matches the loan it was signed against.
  insert into public.assignments_accessories (assignment_id, name, serial_number)
  select new_loan_id, aa.name, aa.serial_number
    from public.assignments_accessories aa
   where aa.assignment_id = p_loan;

  old_loan_id := p_loan;
  return next;
  return;
end;
$$;

comment on function public.transfer_handover is
  'Transfers ONE open assignment (one device) to p_new_user: closes it with returned_at, creates a replacement loan linked via transferred_to, and copies its accessories. Runs with security invoker, so RLS applies as the caller. Returns exactly one row.';

-- ---------------------------------------------------------------------------
-- 2. What this does NOT change
-- ---------------------------------------------------------------------------
--
-- `assignments.transferred_to`, its index, `assignments_guard_recipient_active` and
-- `handover_users_guard_departure` are all left exactly as they are. `transferred_to`
-- already points at the old loan and reads the same for one device as for a batch.
--
-- **The batch grouping in the client is untouched.** `groupIntoBatches` and
-- `getHandoverDocument` both key on `(user_id, assigned_by, assigned_at)`, and a
-- per-device transfer produces a key nothing else shares — so the transferred device
-- correctly becomes a one-device batch with its own document, and the rest of the
-- original batch is unchanged. Nothing in the list has to know a transfer happened to
-- render correctly.