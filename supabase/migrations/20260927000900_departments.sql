-- 00900 — departments as reference data, and `profiles.department` becomes a
-- foreign key.
--
-- `profiles.department` was free text. That works right up until it is a list:
-- the Add-user form was a text box, so the same department could be typed as
-- "IT", "it" and "IT ", and nothing in the database could tell. Migration 00100
-- made the same call for `categories` and `locations` — a table with a uuid, a
-- unique `name`, and a uuid foreign key on the consuming table — and this
-- brings departments in line with that rather than inventing a third shape.
--
-- Two things are deliberate here.
--
-- **The foreign key, not a validated text column.** A `departments` table that
-- the database does not reference is a list the database cannot enforce, and it
-- will drift the first time anything writes the column from anywhere other than
-- the form. The same reasoning that put `assets.category_id` and
-- `assets.location_id` on uuid references applies here. The alternative — keep
-- the text column and only offer the list in the UI — is less code and buys
-- nothing that the app would actually rely on.
--
-- **`on delete set null`, with a guard in front of it.** Removing a department
-- must not quietly un-assign everybody in it, so the application refuses to
-- delete one that is in use. The FK is `set null` rather than `restrict` so that
-- a department removed by some future path degrades into "not set" instead of
-- failing an unrelated write, and `profiles_update_own` already treats NULL as
-- "not set" everywhere it is displayed.

-- =============================================================================
-- departments
-- =============================================================================
create table public.departments (
    id          uuid primary key default gen_random_uuid(),
    name        text not null unique,
    description text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

comment on table public.departments is
    'Departments a profile can belong to. Reference data, in the same shape as categories and locations.';
comment on column public.departments.name is
    'Unique display name. Case-sensitive, so "IT" and "it" are two departments; the application trims and normalises input rather than relying on a case-insensitive index.';

create index departments_name_idx on public.departments (name);

-- -----------------------------------------------------------------------------
-- updated_at, in the database like every other table that has the column
-- -----------------------------------------------------------------------------
create trigger departments_set_updated_at
    before update on public.departments
    for each row execute function public.set_updated_at();

-- =============================================================================
-- profiles.department (text) -> profiles.department_id (uuid)
-- =============================================================================
-- Additive first, populated second, dropped last. Dropping the text column
-- before the values are copied would throw the data away, and doing it in the
-- other order would leave two sources of truth for the same fact.
alter table public.profiles
    add column department_id uuid references public.departments (id) on delete set null;

-- Every distinct value that was ever written becomes a department, so no
-- existing profile is left pointing at nothing. `profiles.department` is the
-- only place such a value can have come from — the signup trigger copied it
-- from metadata, and an admin typed it — so reading that one column is a
-- complete backfill, and no second source needs unioning in.
insert into public.departments (name)
select distinct nullif(trim(department), '')
  from public.profiles
 where department is not null
   and nullif(trim(department), '') is not null
on conflict (name) do nothing;

update public.profiles p
   set department_id = d.id
  from public.departments d
 where p.department is not null
   and d.name = nullif(trim(p.department), '');

-- The trigger is replaced before the column goes, because a plpgsql body
-- resolves its column references at run time: leaving the old one in place while
-- the column is dropped would make every signup fail on a missing column.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    -- The metadata value is resolved to a department if one matches, and
    -- dropped if it does not. Silently creating a department here would let any
    -- anonymous signup invent rows in a table only admins may write, so an
    -- unrecognised name becomes NULL — "not set" — instead.
    resolved_department uuid;
begin
    select id into resolved_department
      from public.departments
     where name = nullif(trim(coalesce(new.raw_user_meta_data ->> 'department', '')), '')
     limit 1;

    insert into public.profiles (id, email, full_name, department_id, role)
    values (
        new.id,
        nullif(trim(coalesce(new.email, '')), ''),
        nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
        resolved_department,
        'staff'
    );
    return new;
end;
$$;

alter table public.profiles drop column department;

comment on column public.profiles.department_id is
    'The department this person belongs to, or NULL for "not set". References public.departments; was free text before 00900.';

-- =============================================================================
-- RLS
-- =============================================================================
-- Same shape as categories and locations, and for the same reason: a department
-- list is reference data that every signed-in user needs to read in order to
-- understand anything else, and only an admin may change it. `anon` is granted
-- nothing, so the absence of a policy is never the only thing protecting it.
revoke all on public.departments from anon;

grant select, insert, update, delete on public.departments to authenticated;

alter table public.departments enable row level security;
alter table public.departments force row level security;

create policy "departments_select_authenticated"
    on public.departments for select to authenticated
    using (true);

create policy "departments_write_admin"
    on public.departments for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());
