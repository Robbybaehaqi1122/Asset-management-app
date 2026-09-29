-- Give each category a owning unit, so the asset settings screen can show one
-- unit at a time and the reference data can grow beyond the IT inventory.
--
-- The column is on `categories`, not on a new `asset_categories` table: that
-- table was never created, `categories` already holds both levels through
-- `parent_id`, and `assets.category_id` already references it.

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
-- `not null default 'IT'` because every existing row is IT inventory — the seed
-- came from the IT hardware workbook — and a nullable column would put the same
-- "which unit?" question in front of every existing row.
--
-- **The default is the one place new units have to be added.** The value lives in
-- each row, not in the column definition, so a third unit is a form constant plus
-- a migration to widen the default if it is ever needed. That is the honest cost
-- of a text column over an enum, and it is taken deliberately: the request named
-- IT / HSSE / GA and "dll", so a closed check constraint would be wrong the
-- first time someone spelled a unit differently.
--
-- **The name is a deliberate collision.** `departments` already exists in this
-- schema and `profiles.department_id` points at it: that is the department of a
-- *person*, and it is unrelated to this column, which is the unit that owns a
-- *category*. Both may hold "IT" and nothing joins them. The comment says so
-- where the column is read, because the alternative is a reader assuming they are
-- the same thing.
alter table public.categories
  add column department text not null default 'IT';

comment on column public.categories.department is
  'The unit that owns this category: IT, HSSE, GA, ... Free text rather than a'
  ' closed set, so a new unit is a form constant and not a migration. NOT the'
  ' same thing as `profiles.department_id`, which is the department of a person;'
  ' `departments` is unrelated to this column even though both may hold "IT".';

-- ---------------------------------------------------------------------------
-- 2. Uniqueness, per unit
-- ---------------------------------------------------------------------------
-- `categories_name_key` is UNIQUE (name) *globally*, and that is what stops
-- HSSE having a `MONITOR` while IT already has one: the second insert is refused
-- with 23505. Per-unit uniqueness is what a unit filter actually needs, so the
-- global constraint is replaced by two partial ones.
--
-- A category's identity is its name *within its unit* for a top-level category,
-- and its name *within its parent* for a sub-category — the second is unchanged in
-- meaning from before, because a sub-category is only ever reached through its
-- parent.
--
-- The migration is safe to run on the existing data precisely because no name is
-- currently duplicated: verified on the local stack with a `group by name having
-- count(*) > 1`, which returned no rows. A duplicate would fail the CREATE INDEX
-- rather than merge two rows silently.
-- `drop constraint`, not `drop index`: the uniqueness was created by
-- `categories.name text not null unique`, so it is a table constraint backed by
-- an index of the same name. Dropping the index is refused with 2BP01 because the
-- constraint needs it.
alter table public.categories drop constraint categories_name_key;

create unique index categories_department_name_key
  on public.categories (department, name)
  where parent_id is null;

create unique index categories_parent_name_key
  on public.categories (parent_id, name)
  where parent_id is not null;

-- ---------------------------------------------------------------------------
-- 3. A sub-category must belong to the same unit as its parent
-- ---------------------------------------------------------------------------
-- Without this the unit filter is quietly broken rather than loudly wrong. A
-- sub-category filed under `COMPUTER` but carrying `department = 'HSSE'` is
-- invisible in the IT view, and in the HSSE view it appears with no parent above
-- it — an orphan row with nothing to expand, and no explanation on screen.
--
-- `guard_category_parent` is replaced rather than extended so the rule lives in
-- one place, next to the third-level check that also belongs to "is this a
-- sensible parent".
create or replace function public.guard_category_parent()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_department text;
begin
  if new.parent_id is null then
    return new;
  end if;

  -- A third level would break the asset form's fieldset switch, which resolves a
  -- sub-category's main category by one hop through `parent_id`.
  if exists (
    select 1 from public.categories p
    where p.id = new.parent_id and p.parent_id is not null
  ) then
    raise exception 'A sub-category cannot have a sub-category parent'
      using errcode = '23514';
  end if;

  -- The unit filter is only honest if a child is filed under the same unit.
  select p.department into parent_department
  from public.categories p
  where p.id = new.parent_id;

  if parent_department is distinct from new.department then
    raise exception 'A sub-category must belong to the same department as its parent'
      using errcode = '23514',
            detail = format('parent is in %s, category is in %s',
                            coalesce(parent_department, 'null'),
                            coalesce(new.department, 'null'));
  end if;

  return new;
end;
$$;

comment on function public.guard_category_parent() is
  'Refuses a sub-category whose parent is itself a sub-category, and refuses a'
  ' sub-category filed under a parent from a different department. The second'
  ' rule is what makes the department filter on the asset settings screen'
  ' honest: without it a child can be listed under a unit where its parent is'
  ' not shown, which is an orphan row rather than an error.';

-- The insert and update triggers are recreated so the replaced function is the
-- one attached; `create trigger` has no `or replace`.
drop trigger if exists categories_guard_parent on public.categories;

create trigger categories_guard_parent
  before insert or update of parent_id, department on public.categories
  for each row execute function public.guard_category_parent();

-- Moving a category to a different unit would orphan its children, so it is
-- refused for the same reason the delete is.
create or replace function public.guard_category_department_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.department is distinct from old.department
     and exists (
       select 1 from public.categories c where c.parent_id = old.id
     ) then
    raise exception 'Move the sub-categories first, or clear them'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger categories_guard_department_change
  before update of department on public.categories
  for each row execute function public.guard_category_department_change();
