-- Current locations: the physical place an asset is in right now, as reference
-- data of its own.
--
-- The workbook has `Location` (a registered area) and `Current Location` / `Room`
-- as two separate headings, and `01100` handled the second one by adding a free
-- text column on `assets`. That column was a deliberate trade and it still holds:
-- a physical room or desk changes faster than a picker can be kept current.
--
-- **What changed is the request.** A current location is now managed the same way
-- a registered location is — the admin adds "Jakarta / Gedung B" in Asset Settings
-- and the asset form picks from it — so it needs its own table and a real foreign
-- key, exactly as `locations` and `assets.location_id` are one another. Keeping a
-- free-text box beside a managed list would be the second source of truth this
-- project keeps refusing: a picker whose options nobody maintains, next to a table
-- somebody does.
--
-- The trade the free text bought is not lost, only moved. `current_location_id` and
-- `location_id` are still independent columns and still can point at different
-- places — the asset is *registered* at one location and *sitting* at another — but
-- a current location is now a row rather than a note, so the two are both reference
-- data and the delete guard below has something real to count.

-- -----------------------------------------------------------------------------
-- 1. current_locations — the same shape as `locations`
-- -----------------------------------------------------------------------------
-- Deliberately identical to `locations` rather than a variant of it: an admin
-- manages the two the same way, the asset form draws from them the same way, and a
-- difference between the two tables would be one more thing to keep in step. The
-- comment on each column says which question it answers, because "location" on its
-- own is now ambiguous between the two tables.
create table public.current_locations (
    id          uuid primary key default gen_random_uuid(),
    area_name   text not null,
    room_name   text,
    notes       text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

comment on table public.current_locations is
  'The physical place an asset is in now, as reference data. Same shape as'
  ' `locations`, different question: `locations` is where the asset is'
  ' registered, this is where it actually is. The two are independent by design.';

comment on column public.current_locations.area_name is
  'The area, e.g. Jakarta. Where the asset physically is, not where it is registered.';
comment on column public.current_locations.room_name is
  'The specific room or place inside the area, e.g. Gedung B. Nullable: an area on'
  ' its own is a legitimate value, exactly as on `locations`.';
comment on column public.current_locations.notes is
  'Free-text note about this place.';

-- The two uniqueness rules are copied from `locations` rather than simplified, and
-- both are load-bearing. The pair stops two rooms in one area being one place; the
-- partial index is what actually stops two room-less rows for the same area, since
-- `null` is distinct from every other `null` in a Postgres unique index.
create unique index current_locations_area_room_key
  on public.current_locations (area_name, room_name);

create unique index current_locations_area_only_key
  on public.current_locations (area_name)
  where room_name is null;

-- The empty-string case the partial index above would not catch, for the same
-- reason `locations` carries it: '' is not null.
alter table public.current_locations
  add constraint current_locations_area_name_not_blank check (btrim(area_name) <> ''),
  add constraint current_locations_room_name_not_blank check (room_name is null or btrim(room_name) <> '');

create trigger current_locations_set_updated_at
    before update on public.current_locations
    for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. grants and RLS — identical to `locations`
-- -----------------------------------------------------------------------------
-- `anon` is revoked explicitly rather than left to the default privileges, for the
-- reason `01000` records: Supabase hands `anon` all seven privileges on a new table
-- in `public`, and with no `anon` policy every query comes back *empty*, which
-- reads exactly like correct. The grant is the first line of defence and the policy
-- is the second.
revoke all on public.current_locations from anon;

grant select, insert, update, delete on public.current_locations to authenticated;

-- Reference data is read by every signed-in user, because the asset form's
-- Current Location picker has to populate for a staff member, and written by admins
-- alone. Same split as `locations` and `categories`: a staff write could re-point
-- every asset in the place.
alter table public.current_locations enable row level security;
alter table public.current_locations force row level security;

create policy "current_locations_select_authenticated"
    on public.current_locations for select to authenticated
    using (true);

create policy "current_locations_write_admin"
    on public.current_locations for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- 3. assets.current_location_id
-- -----------------------------------------------------------------------------
-- `on delete set null`, exactly like `assets.location_id` and for the same reason:
-- a deleted reference should degrade into "not set" rather than break an unrelated
-- write. The cost is identical and is why the application asks before deleting:
-- see `CurrentLocationInUseError` in `settingService.ts`.
alter table public.assets
  add column current_location_id uuid references public.current_locations (id) on delete set null;

comment on column public.assets.current_location_id is
  'The place the asset physically is now, from `current_locations`. Independent'
  ' of `location_id`, which is where the asset is *registered*: an asset registered'
  ' at one site and sitting in another room is the normal case, not a mistake.';

-- -----------------------------------------------------------------------------
-- 4. backfill, then drop the free-text column
-- -----------------------------------------------------------------------------
-- Every distinct non-blank value in the old `current_location` becomes one row,
-- as an area with no room. The old column was a shop-floor note ("Gedung B"), so
-- there is no area to file it under, and inventing one would be a guess in a
-- migration — the same reasoning `01300` used to carry "Server Room" across as an
-- area rather than invent a parent for it.
insert into public.current_locations (area_name)
select distinct btrim(current_location)
from public.assets
where current_location is not null
  and btrim(current_location) <> ''
order by btrim(current_location);

update public.assets a
set current_location_id = cl.id
from public.current_locations cl
where a.current_location is not null
  and btrim(a.current_location) = cl.area_name;

-- The drop is the one destructive statement here, and it is guarded. The two
-- statements above preserve every non-blank value as a selectable row, so this
-- should be a formality — but the remote has no re-apply path, and a value that
-- failed to backfill would be gone for good. A blank string is not data and is
-- allowed through: it becomes NULL rather than a current-locations row named "".
do $$
begin
  if exists (
    select 1 from public.assets
    where current_location is not null
      and btrim(current_location) <> ''
      and current_location_id is null
  ) then
    raise exception
      'Refusing to drop assets.current_location: some values did not backfill';
  end if;
end;
$$;

-- Dropped rather than kept beside the new column, for the reason `01300` dropped
-- `locations.name`: two columns for one fact is a second source of truth, and
-- nothing would say which of the two is right. Reverting this is a new migration.
alter table public.assets drop column current_location;
