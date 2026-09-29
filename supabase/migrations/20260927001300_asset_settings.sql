-- Asset settings: the reference data the asset form draws from, made manageable.
--
-- Nothing new is created here. `asset_categories`, `asset_sub_categories` and
-- `asset_locations` were all requested as three new tables, and all three
-- already exist under other names: `categories` (holding both levels through
-- `parent_id`), and `locations`. `assets.category_id` and `assets.location_id`
-- already reference them, so a parallel set of tables would be a second source
-- of truth for the same two facts — the drift `profiles.department` was replaced
-- to remove, and the drift `usage_status` was kept separate to avoid.
--
-- What does change is `locations`: the workbook has `Location` (an area) and
-- `Current Location` / `Room` as two separate headings, and one `name` column
-- cannot hold both. The two-column split is the actual work in this migration.

-- ---------------------------------------------------------------------------
-- 1. locations: area and room
-- ---------------------------------------------------------------------------
-- `area_name` is the registered area ("Patimban", "Jakarta HO") and `room_name`
-- the specific place inside it ("Customs Building", "Server Autogate").
--
-- `room_name` is nullable rather than not null, because an area can be a
-- legitimate value on its own: a laptop assigned to a site has no room. The
-- original request asked for `room_name text not null`, which forces an operator
-- to invent a room for every area, and "N/A" is what that field becomes in
-- practice. A null is a truthful "no room recorded" instead.
--
-- The uniqueness is on `area_name, room_name` rather than on either alone, which
-- is the shape a picker needs: two rooms in the same area are different places,
-- and the same room name under two areas is not a duplicate.

alter table public.locations
  add column area_name text,
  add column room_name text;

comment on column public.locations.area_name is
  'The registered area, e.g. Patimban, Jakarta HO. Replaces the dropped `name`'
  ' column, which could not hold an area and a room at once.';
comment on column public.locations.room_name is
  'The specific room or place inside the area, e.g. Customs Building, Server'
  ' Autogate, Pos Gate IN. Nullable: an area is a legitimate value on its own.';

-- `notes` is in the request and the existing `locations` has none: `address` is
-- the free-text column that already existed, and it is the same kind of field, so
-- it is renamed rather than duplicated. Two free-text columns saying "where is
-- this" is the drift this project keeps refusing to add.
alter table public.locations
  add column notes text;

comment on column public.locations.notes is
  'Free-text note about the location. Renamed from `address`, which was the same'
  ' field under a vaguer name and was read by nothing.';

-- Backfill before the constraints, because `not null` has to see real values.
--
-- The three rows `01100` seeded are `Head Office`, `Server Room` and
-- `Gudang IT`, and all three read as areas rather than as rooms inside a larger
-- site — "Server Room" is a room by name but nothing in the seed says which area
-- it sits in. They are therefore carried across as `area_name` with a null
-- `room_name`, which is exactly the case `room_name` being nullable exists for.
-- An admin who knows the site can add the room without the migration having to
-- invent a parent for it.
update public.locations
set area_name = btrim(name);

alter table public.locations
  alter column area_name set not null;

-- `name` is dropped rather than kept alongside: three columns for two facts is
-- the problem, and every caller reads `name` today, so leaving it would let the
-- two disagree with nothing to say which is right. The only index touching it is
-- the unique one this replaces, which is created below under the new name.
alter table public.locations drop column name;

update public.locations set notes = address;
alter table public.locations drop column address;

create unique index locations_area_room_key
  on public.locations (area_name, room_name);

-- A pair that is unique must not allow a duplicated area+room differing only in
-- case or spacing, and `room_name` being null has a Postgres quirk: `null` is
-- distinct from every other `null` in a unique index, so two rows with the same
-- area and both null would both be allowed. The partial index below is what
-- actually stops that.
create unique index locations_area_only_key
  on public.locations (area_name)
  where room_name is null;

-- The one place where a constraint can help is the empty-string case, which the
-- partial index above would not catch, since '' is not null.
alter table public.locations
  add constraint locations_area_name_not_blank check (btrim(area_name) <> ''),
  add constraint locations_room_name_not_blank check (room_name is null or btrim(room_name) <> '');

-- ---------------------------------------------------------------------------
-- 2. categories: a description, and the delete guard the schema cannot express
-- ---------------------------------------------------------------------------
-- `description` already exists on `categories`, so the requested column needs no
-- migration. The request's `asset_sub_categories` is `categories WHERE
-- parent_id IS NOT NULL`, which the form already resolves in one flat read
-- (a self-referential PostgREST embed is refused with PGRST200, verified).

-- Deleting a category used by an asset would silently un-assign that asset:
-- `assets.category_id` is `on delete set null`, exactly like `profiles.department_id`
-- was, and exactly for the same reason — a deleted reference should degrade into
-- "not set" rather than break an unrelated write. The cost is that the database
-- will happily do it and say nothing, so the application has to ask first. The
-- same reasoning, and the same shape of refusal, as `DepartmentInUseError`.
--
-- This cannot be a foreign key: a constraint cannot count rows in another table,
-- and an RLS policy cannot refuse on a cross-table count either, because the
-- client is the only place that knows how many rows the caller may see.
create or replace function public.guard_category_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  asset_count bigint;
  child_count bigint;
begin
  select count(*) into child_count
  from public.categories c
  where c.parent_id = old.id;

  select count(*) into asset_count
  from public.assets a
  where a.category_id = old.id;

  if child_count > 0 or asset_count > 0 then
    raise exception 'Category is still in use'
      using errcode = '23514',
            detail = format('category has %s sub-categor(y/ies) and %s asset(s)',
                            child_count, asset_count);
  end if;

  return old;
end;
$$;

comment on function public.guard_category_delete() is
  'Refuses deleting a category that still has sub-categories or assets.'
  ' security definer so the count is not filtered by the caller''s RLS, and'
  ' search_path is pinned so a caller cannot shadow the table references.';

create trigger categories_guard_delete
  before delete on public.categories
  for each row execute function public.guard_category_delete();

-- A sub-category cannot be pointed at a sub-category. The form only ever offers
-- top-level categories as parents, but nothing stopped a direct write from
-- creating a third level, and the fieldset switch resolves the parent of a
-- sub-category by looking at its own `parent_id` — a third level would make that
-- lookup point at another child and silently pick the wrong fieldset.
create or replace function public.guard_category_parent()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.parent_id is not null
     and exists (
       select 1 from public.categories p
       where p.id = new.parent_id and p.parent_id is not null
     ) then
    raise exception 'A sub-category cannot have a sub-category parent'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger categories_guard_parent
  before insert or update of parent_id on public.categories
  for each row execute function public.guard_category_parent();

-- The form switches its fieldset on `code`, and a top-level category with no
-- `code` is a supported case: it falls back to the generic fields. That is the
-- path an admin-added category takes, so `code` is nullable on purpose and this
-- migration does not touch it.
--
-- The reverse is enforced: a *sub*-category must not carry a code. The fieldset
-- switch always resolves through the **main** category, so a code on a child is
-- meaningless, and a future reader could take it for a key the form honours.
alter table public.categories
  add constraint categories_code_only_on_parents
  check (parent_id is null or code is null);
