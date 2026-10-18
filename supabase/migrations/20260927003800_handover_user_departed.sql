-- Offboarding: mark a roster entry as departed, and refuse to do it while they
-- still hold an asset.
--
-- ## The problem this solves
--
-- `handover_users` had no way to say "this person has left". Two consequences, and
-- both are silent:
--
--   1. They stay in `getHandoverUserOptions()`, so an asset can be issued to
--      somebody who no longer works here.
--   2. Nothing lists who is gone *and still holding something*. The only way to
--      find that out is to remember to look.
--
-- ## Why `departed_at timestamptz` and not `is_active boolean`
--
-- The same shape as `assignments.returned_at`, and for the same reasons: it records
-- *when*, which is the fact an audit asks for, and "is departed" is then derived as
-- `departed_at is null` rather than stored twice. A boolean would also have to be
-- reset by hand on a mistaken click, where nulling the column is the same action.
--
-- **It is not a `profiles` column.** A roster row is a person who receives assets,
-- and most of them never sign in — a contractor, a visitor, a technician on
-- someone else's site. That is the whole reason `02000` split the recipient out of
-- `profiles`. Putting the flag on `profiles` would make it invisible for exactly the
-- rows it exists to cover.
--
-- ## The guard is the point, not the flag
--
-- A flag with nothing enforcing it is a label. `guard_handover_user_departure()`
-- refuses to set `departed_at` while an open loan exists, so the roster cannot claim
-- somebody has left while the register still says they are holding a laptop. The
-- count in the message is what makes it actionable — it is the same shape as
-- `HandoverUserInUseError` on the other side of the same table.
--
-- **`security definer`, and it has to be.** The count is over `assignments`, whose
-- read policy is `assignments_select_own_department_or_admin`: a staff member
-- calling this would see only their own loans, the count would come back zero, and
-- the guard would wave the departure through. This is the identical reason
-- `guard_handover_user_delete` is `security definer`, and the identical reason
-- `assets_guard_status` is.
--
-- ## The second guard is what stops the flag being decorative
--
-- `guard_handover_recipient_active()` refuses a **new** handover addressed to a
-- departed roster row. Without it the flag would be a note in a list that the write
-- path never reads — the asset goes out to somebody who has left, the loan is
-- recorded honestly, and nothing anywhere objects.
--
-- It is a trigger rather than an RLS policy for the same reason the other
-- cross-table guards are: the check is about another table's row, and a `with check`
-- subquery would either re-enter `handover_users`' RLS or be unreadable in the
-- expression. `security definer` again, for the same count reason — and here it also
-- matters that a caller cannot influence the answer by what they may see.
--
-- ## Only the transition is checked
--
-- `before update of departed_at` fires when the column appears in the SET list. The
-- guard then returns early unless the value actually moved from null to a timestamp,
-- so editing a name, a position or a note on an already-departed entry is not
-- refused for holding something — a departed entry can legitimately still be the
-- holder of a *closed* loan, and that is what `assignments_open_idx` counts.
--
-- ## The index is for the "who has left" list
--
-- A partial index over the departed rows only, ordered by name, so the roster can
-- sort departures to the bottom without sorting the whole table on the way.

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------

alter table public.handover_users add column departed_at timestamptz;

comment on column public.handover_users.departed_at is
  'When this person left. NULL while they are still here. Setting it is refused while they still hold an open handover, so the flag and the register cannot disagree. NOT a profiles column on purpose: most roster rows never sign in.';

-- ---------------------------------------------------------------------------
-- 2. Refuse to mark somebody departed while they still hold something
-- ---------------------------------------------------------------------------

create or replace function public.guard_handover_user_departure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open integer;
begin
  -- Only the transition matters. A later edit to the name or the notes on an
  -- already-departed row must not be refused for the same reason.
  if new.departed_at is null or new.departed_at is not distinct from old.departed_at then
    return new;
  end if;

  -- Counted through `assignments_open_idx` (user_id) where returned_at is null.
  select count(*) into v_open
    from public.assignments
   where user_id = new.id
     and returned_at is null;

  if v_open > 0 then
    raise exception
      'Handover user % still holds % asset(s); transfer or return them first',
      new.name, v_open
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger handover_users_guard_departure
  before update of departed_at on public.handover_users
  for each row execute function public.guard_handover_user_departure();

-- ---------------------------------------------------------------------------
-- 3. Refuse to issue to somebody who has left
-- ---------------------------------------------------------------------------

create or replace function public.guard_handover_recipient_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select h.name into v_name
    from public.handover_users h
   where h.id = new.user_id
     and h.departed_at is not null;

  if v_name is not null then
    raise exception
      'Handover user % has departed and cannot receive assets',
      v_name
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger assignments_guard_recipient_active
  before insert on public.assignments
  for each row execute function public.guard_handover_recipient_active();

-- ---------------------------------------------------------------------------
-- 4. The index
-- ---------------------------------------------------------------------------

create index handover_users_departed_idx
    on public.handover_users (name)
 where departed_at is not null;

-- ---------------------------------------------------------------------------
-- 5. What this does NOT do
-- ---------------------------------------------------------------------------
--
-- It does not delete anything, and nothing here changes what deleting an account
-- does. `assignments.user_id` points at `handover_users` with `on delete restrict`,
-- so a departed person's loan history survives their account being deleted —
-- `handover_users.profile_id` goes null and the roster row stays. That was already
-- true before this migration; this one only makes the departure a fact the register
-- can hold rather than something an admin has to remember.
