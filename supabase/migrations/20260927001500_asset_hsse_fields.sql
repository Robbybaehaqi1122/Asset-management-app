-- The HSSE asset form: the four fields that only a health-safety-security item
-- has, and a unit on the asset itself.
--
-- The common fields the form shows for both units already exist — `asset_code`,
-- `name`, `category_id`, `location_id`, `purchase_date`, `condition`,
-- `asset_pic`, `serial_number`, `manufacture`, `model_name`, `model_type`,
-- `short_name`, `description` and `capacity` are all on `assets` today. Four
-- columns are genuinely new, and they are plain `date` / `text` rather than a
-- `jsonb specifications` blob: the shape of each is already known, so a free-form
-- column would only allow `"31/12/2026"` to be stored beside a real date with
-- nothing to object, and would make "expire within 30 days" unindexable. The
-- reasoning is the one already recorded for `usage_status` and `locations.name`.

-- ---------------------------------------------------------------------------
-- 1. The HSSE fields
-- ---------------------------------------------------------------------------
-- Calibration and inspection dates rather than "next service date": an item with
-- an expiry has a hard date, and a *next inspection* is a schedule rather than a
-- fact, which is why the two are separate columns instead of one.
alter table public.assets
  add column expiration_date date,
  add column last_inspection_date date,
  add column next_inspection_date date,
  add column calibration_cert_no text;

comment on column public.assets.expiration_date is
  'HSSE: the item''s expiry or refill date.';
comment on column public.assets.last_inspection_date is
  'HSSE: when the item was last inspected.';
comment on column public.assets.next_inspection_date is
  'HSSE: when the item is next due for inspection. A schedule, not a fact, which'
  ' is why it is not derived from the last one plus an interval.';
comment on column public.assets.calibration_cert_no is
  'HSSE: the calibration or test certificate number, as printed on the document.';

-- ---------------------------------------------------------------------------
-- 2. The unit on the asset
-- ---------------------------------------------------------------------------
-- `assets.department` is **derived from the category and must never be written
-- directly.** It exists so the list and any future report can filter by unit
-- without a join, and the trigger below is what makes that safe: a client cannot
-- put an HSSE category on an asset and call it IT, or the other way round.
--
-- The alternative — no column and a join every time — would also work, and is
-- what this was before. The column is kept because a filter on a column the
-- database guarantees is simpler than a filter on a join, and because the
-- guarantee is the interesting part.
alter table public.assets
  add column department text not null default 'IT';

comment on column public.assets.department is
  'The unit that owns this asset, copied from its category''s department by'
  ' assets_sync_department. Do not write it: a value that disagrees with the'
  ' category is not a variant, it is a bug, and the trigger overwrites it so it'
  ' cannot become one.';

-- The trigger always overwrites rather than raising on a mismatch.
--
-- Raising was the alternative and it is the worse one here: the client cannot
-- tell "the caller did not send this column" from "the caller sent the default",
-- so an honest insert that omits `department` and points at an HSSE category
-- would be refused for a disagreement nobody made. Overwriting makes
-- disagreement impossible by construction, for every writer including a
-- service-role one, which is the same reasoning as
-- `assignments_sync_asset_status` and the other status triggers.
create or replace function public.assets_sync_department()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.category_id is null then
    -- No category yet, so no unit to copy. IT is the unit the seed came from and
    -- the column default, and an uncategorised asset is what it was before this
    -- migration added a second unit.
    new.department := 'IT';
    return new;
  end if;

  select c.department into new.department
  from public.categories c
  where c.id = new.category_id;

  -- A category id that does not resolve cannot happen while the foreign key
  -- holds, but `select into` leaves the variable null when it finds nothing, and
  -- the column is `not null`.
  if new.department is null then
    new.department := 'IT';
  end if;

  return new;
end;
$$;

comment on function public.assets_sync_department() is
  'Copies categories.department onto assets.department so the two cannot disagree.'
  ' security definer so the read is not filtered by the caller''s RLS, and'
  ' search_path is pinned so a caller cannot shadow the table references.';

-- **`update of category_id, department`, not just `category_id`.** The first
-- version of this trigger fired on `category_id` only, and a plain
-- `update assets set department = 'IT'` then wrote straight past it — verified
-- on the local stack, where the value came back as `IT` on an HSSE category.
-- An `UPDATE OF` list only fires when the named column appears in the SET list,
-- so a column that is only ever meant to be derived still has to be named, or
-- nothing stops a direct write to it.
create trigger assets_sync_department
  before insert or update of category_id, department on public.assets
  for each row execute function public.assets_sync_department();

-- The existing rows all belong to IT categories today, so the backfill is the
-- same statement the trigger would have run. Written as an update so it is
-- visible in the ledger as a real step rather than implied by the default.
update public.assets a
set department = c.department
from public.categories c
where c.id = a.category_id
  and a.department is distinct from c.department;
