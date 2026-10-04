-- Positions: the list a person on the handover roster can hold.
--
-- `02000` gave `handover_users` a `position text not null`, which was a
-- deliberate choice at the time: the issue asked for a name, a position and a
-- department, and a fourth table for a value nobody had enumerated yet is a
-- screen with nothing in it. That reasoning has now run out. Positions are
-- written by hand into a text box, so the list that exists is only the ones
-- somebody remembered to type — `Technician` and `technician` and `Technician `
-- are three spellings of one job, and nothing can tell them apart.
--
-- This is the same argument `00900` made for departments, applied to the column
-- that was left free text. It is recorded here rather than asserted, because the
-- failure this prevents is the one the free text already invited:
--
--   - a misspelled position is invisible in a filter, so a person shows up with
--     no position while three near-identical rows exist
--   - two admins pick different spellings of the same job and the list fragments
--   - nothing counts how many people hold a position, so deleting one silently
--     blanks every person who had it
--
-- **The foreign key, not a validated text column.** A list the database does not
-- reference is a list it cannot enforce, and it drifts the first time anything
-- writes the column from outside the form.
--
-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
--
-- Deliberately the same shape as `departments` (`00900`) rather than a new one,
-- so `position` reads exactly like `department_id` next to it in the roster.
create table public.positions (
    id          uuid primary key default gen_random_uuid(),
    name        text not null unique,
    description text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

comment on table public.positions is
  'The job titles a person on the handover roster can hold, as reference data in'
  ' the same shape as departments. Added by 02200 to replace handover_users.position'
  ' as free text, which could only hold the positions somebody remembered to type.';

comment on column public.positions.name is
  'Unique display name, case-sensitive for the same reason departments.name is:'
  ' the application trims and normalises rather than relying on a case-insensitive'
  ' index, so "Technician" and "technician" being two rows is a data-entry'
  ' mistake the application can show rather than something the database hides.';

create index positions_name_idx on public.positions (name);

create trigger positions_set_updated_at
    before update on public.positions
    for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Carry the existing free text across
-- ---------------------------------------------------------------------------
--
-- One `positions` row per distinct value already in use, trimmed, then every
-- roster entry pointed at its row. **The blanks are dropped, not converted**: a
-- row of whitespace is not a position, and creating a row for it would put an
-- empty option in the picker.
--
-- The guard afterwards raises rather than leaving a half-converted table: a
-- roster entry still holding `position` and no `position_id` would render as a
-- person with no position and nothing would say why. The remote has no re-apply
-- path, so a partial conversion there is not repairable by re-running the file —
-- which is the same reasoning `01200`, `01300`, `01600` and `02000` each used for
-- their destructive statements.
insert into public.positions (name)
select distinct btrim(h.position)
  from public.handover_users h
 where btrim(h.position) <> ''
on conflict (name) do nothing;

do $$
declare
  v_unmapped integer;
begin
  select count(*) into v_unmapped
    from public.handover_users h
   where btrim(h.position) <> ''
     and not exists (
       select 1 from public.positions p
        where p.name = btrim(h.position)
     );

  if v_unmapped > 0 then
    raise exception
      'Backfill left % handover user(s) with no positions row; aborting rather than orphaning them',
      v_unmapped
      using errcode = '23514';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Swap the column
-- ---------------------------------------------------------------------------
--
-- Added, backfilled, then the old column dropped — **not** left beside the new
-- one. Two columns holding the same fact is the trap this schema refuses
-- repeatedly (`profiles.department` as free text, `usage_status` beside
-- `status`, the `handover_doc_no` debate in `01900`), and a stale `position`
-- would be one nobody reads, so the two could disagree with nothing saying
-- which was right.
--
-- The blank check moves to `positions` itself rather than onto the roster.
--
-- The obvious shape — `check (position_id is not null or exists (select …))` — is
-- **not valid Postgres**: a CHECK constraint may not contain a subquery. It also
-- would not have been the right place anyway, because the thing that must never be
-- blank is the *position's name*, and that is a fact about `positions`, not about
-- whichever roster entry happens to reference it. Asserting it here would mean
-- re-asserting it on every table that joins to `positions`.
--
-- So: `positions.name` carries the constraint, and the foreign key makes the
-- roster inherit it. A row cannot point at a blank position because no blank
-- position can exist.
alter table public.positions
    add constraint positions_name_not_blank check (btrim(name) <> '');

alter table public.handover_users
    add column position_id uuid references public.positions (id) on delete restrict;

update public.handover_users h
   set position_id = p.id
  from public.positions p
 where p.name = btrim(h.position);

-- Any row the backfill could not map is a row whose `position` was blank or
-- unmatchable, and the blank ones were deliberately dropped in section 2 rather
-- than turned into a `positions` row. There is no correct value to invent for
-- them, so this raises instead of guessing — and because the column becomes
-- `not null` immediately below, letting it through would fail the whole file
-- later with a far less obvious message.
do $$
declare
  v_unmapped integer;
begin
  select count(*) into v_unmapped
    from public.handover_users
   where position_id is null;

  if v_unmapped > 0 then
    raise exception
      '% handover user(s) have a blank or unmatchable position and cannot be converted; fill them in first',
      v_unmapped
      using errcode = '23514';
  end if;
end $$;

-- `not null`, because a position is required. The form enforces it and so does
-- the database, which is the pairing this schema keeps for anything the form
-- cannot be trusted to hold on its own — the same reason `position` itself was
-- `not null` before this migration, and the reason `name` on this table is too.
--
-- This is a real tightening rather than a translation of the old column: the
-- blank-check check has moved to `positions.name`, where it belongs and where it
-- protects every future reference, and the roster inherits it through the key.
alter table public.handover_users
    alter column position_id set not null;

alter table public.handover_users drop column position;

-- ---------------------------------------------------------------------------
-- 4. A position still in use cannot be deleted
-- ---------------------------------------------------------------------------
--
-- `on delete restrict` on the foreign key already refuses, but a bare `23503`
-- names a constraint and nothing else. The trigger says what is in the way, the
-- same reason `categories_guard_delete` (`01300`) and
-- `handover_users_guard_delete` (`02000`) each exist for their own table.
--
-- `security definer` for the reason `assets_guard_status` and
-- `handover_users_guard_delete` are: a count taken through the caller's own RLS
-- would report zero for rows they cannot see and wave the delete through.
create or replace function public.guard_position_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_people integer;
begin
  select count(*) into v_people
    from public.handover_users
   where position_id = old.id;

  if v_people > 0 then
    raise exception
      'Position % is held by % handover user(s); move them first',
      old.name, v_people
      using errcode = '23514';
  end if;

  return old;
end;
$$;

create trigger positions_guard_delete
  before delete on public.positions
  for each row execute function public.guard_position_delete();

-- Serves the picker in `getHandoverUserOptions`, which joins through it.
create index handover_users_position_idx on public.handover_users (position_id);

-- ---------------------------------------------------------------------------
-- 5. Grants and RLS
-- ---------------------------------------------------------------------------
--
-- Read for every signed-in user, write for admins — identical to
-- `departments`, and for the same reason: the roster picker shows a position, so
-- a staff member reading `/handover` needs it, and reference data is read
-- everywhere in this schema while only admins may change it.
--
-- The `revoke` from `anon` is explicit and load-bearing. Supabase's default
-- privileges hand `anon` all seven privileges on a new table in `public`, and
-- with no `anon` policy every query comes back **empty** — which reads exactly
-- like correct and passes every functional test. The grant is the first line of
-- defence; the policy is the second.
revoke all on public.positions from anon;

grant select, insert, update, delete on public.positions to authenticated;

alter table public.positions enable row level security;
alter table public.positions force row level security;

create policy "positions_select_authenticated"
    on public.positions for select to authenticated
    using (true);

create policy "positions_write_admin"
    on public.positions for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- What this migration deliberately does not do
-- ---------------------------------------------------------------------------
--
-- It does not seed any positions. There is no source to read them from — the
-- Excel inventories are about assets, not about people — and a guessed list of job
-- titles would be the template's habit of inventing data that then looks real. The
-- menu starts empty and the admin fills it with the titles this company actually
-- uses.
--
-- It does not keep `position` beside `position_id`. See section 3.
--
-- It does not add a `positions` table for the *department* of a person: that is
-- `departments` and `handover_users.department_id` already, and a second table
-- for a list that exists would be a second source of truth for one fact.