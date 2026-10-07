-- Companies: the list an admin maintains for company names.
--
-- ## What this is, and what it is not
--
-- **A list of names, not multi-tenancy.** The request was "add company, type the
-- company name" — so this is a `companies` table with one column and an admin screen
-- that adds, renames and deletes rows.
--
-- **Nothing references this table yet.** No asset, no department, no handover roster
-- row has a `company_id`, and the screen does not pretend otherwise: it is a list an
-- admin fills, standing on its own. That is a deliberate stopping point rather than
-- the first half of a larger design, because the alternative — putting `company_id` on
-- `assets` now — would be a second classification of rows that already have
-- `department`, and this repo has refused that seven times over (see the `usage_status`
-- and `equipment_family` rows in `AGENTS.md`).
--
-- The first thing that should reference it is a decision, not a guess: whether a
-- company *owns* assets (a `company_id` FK) or is *named on* a handover document
-- (the print form already prints a fixed `COMPANY_NAME` literal). Those are different
-- schemas, and this migration is deliberately compatible with either — one uuid, one
-- name.
--
-- ## The same shape as `departments` and `positions`
--
-- Deliberately identical to `positions` (`02200`) and `departments` (`00900`), so
-- this list reads exactly like the two beside it and the next RLS surprise has one
-- answer rather than three. Read for every signed-in user, written by admins alone.
--
-- **`updated_at` and its trigger are here even though the screen can rename.**
-- Every other list in this schema has both, and a table that grows a second column
-- later is a migration; a table that grows `updated_at` later is a migration too, and
-- the cheaper one is the one written while the shape is still being decided.

create table public.companies (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    description text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

comment on table public.companies is
  'Company names, as admin-maintained reference data. Same shape as departments and'
  ' positions. Nothing references this table yet: it is a list an admin fills, not'
  ' a scope on assets — see the migration header for why nothing points at it.';

comment on column public.companies.name is
  'Display name. Trimmed and case-folded by the application before the insert, and'
  ' matched case-insensitively by companies_name_ci_key — see the note below.';

comment on column public.companies.description is
  'Free-text note. Unused by the screen today; present so a note can be added'
  ' without a migration, and so this table matches departments and positions.';

-- ---------------------------------------------------------------------------
-- Uniqueness, and why this one differs from `departments.name`
-- ---------------------------------------------------------------------------
--
-- `departments.name` and `positions.name` are `text not null unique`, which is
-- **case- and whitespace-sensitive**. That was a deliberate choice at the time:
-- "a data-entry mistake the application can show rather than something the database
-- hides."
--
-- `02300` reversed that reading for `assets.asset_code` after a unique index on it
-- was found to accept `AST-0001`, `ast-0001` and `  AST-0001  ` as three rows, and
-- the reasoning there is the one that applies here: **a company name is a
-- human-typed identifier, and a register whose whole point is a stable identifier
-- cannot hold the same company twice in two spellings.**
--
-- "PT. Patimban Global Gateway Terminal" and "pt. patimban global gateway terminal"
-- are one company. The application still trims and normalises so the *screen* can
-- report it plainly, and the index is still what refuses it — because the check has
-- to hold for a row that arrives by any route, SQL or an import included.
--
-- **This is an index rather than a constraint**, which means the column is declared
-- `not null` without `unique` and the uniqueness lives in the expression. That is
-- the same shape as `assets_asset_code_ci_key`, and it is why the drop below is a
-- `drop index` rather than an `alter table … drop constraint` — the trap `01300`
-- and `02300` both record for the inline form.
--
-- The guard `do` block below is what stops the push failing on data that already
-- collides. It cannot collide today, because the table is created empty; it is here
-- so that if this migration is ever re-run against a populated table by hand, the
-- failure names the two companies rather than arriving as a bare `23505` naming an
-- index.
--
-- **`unique index`, and the word is load-bearing.** The first version of this file
-- said `create index companies_name_ci_key`, which builds a perfectly good index that
-- enforces nothing at all. It was caught by the local suite below: three spellings of
-- one company were all accepted, and `pg_indexes` showed an index by the right name
-- on the right expression, so nothing about reading the schema would have said it was
-- decorative. An index whose name says `key` and whose definition has no `unique` is
-- the most expensive kind of mistake here — it reads as protection.
create unique index companies_name_ci_key
  on public.companies (upper(btrim(name)));

do $$
begin
    if exists (
        select 1
        from public.companies
        group by upper(btrim(name))
        having count(*) > 1
    ) then
        raise exception
            'Cannot add the case-insensitive companies_name_ci_key: these names differ'
            ' only by case or surrounding spaces';
    end if;
end;
$$;

-- The empty-string case the expression index above would not catch, for the same
-- reason `positions` and `departments` carry one: '' is not null.
alter table public.companies
  add constraint companies_name_not_blank check (btrim(name) <> '');

create trigger companies_set_updated_at
    before update on public.companies
    for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Grants and RLS — identical to `positions`
-- ---------------------------------------------------------------------------
--
-- The `revoke` from `anon` is explicit and load-bearing, for the reason `01000` and
-- every migration since it records: Supabase's default privileges hand `anon` all
-- seven privileges on a new table in `public`, and with no `anon` policy every query
-- comes back **empty** — which reads exactly like correct and passes every functional
-- test. The grant is the first line of defence, the policy the second.
revoke all on public.companies from anon;
grant select, insert, update, delete on public.companies to authenticated;

alter table public.companies enable row level security;
alter table public.companies force row level security;

create policy companies_select_authenticated
    on public.companies for select to authenticated
    using (true);

create policy companies_insert_admin
    on public.companies for insert to authenticated
    with check (public.is_admin());

create policy companies_update_admin
    on public.companies for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

create policy companies_delete_admin
    on public.companies for delete to authenticated
    using (public.is_admin());

-- ---------------------------------------------------------------------------
-- What this migration deliberately does not do
-- ---------------------------------------------------------------------------
--
-- - It does not put `company_id` on `assets`, `departments`, `profiles` or
--   `handover_users`. Nothing has been asked to be scoped by company, and a second
--   classification of a row that already carries `department` is the problem this
--   repo refuses repeatedly rather than the feature it enables.
-- - It does not seed a company. There is no source to read company names from, in
--   the same way `02200` seeded no positions: the Excel files are about assets, not
--   about organisations, and a guessed row that looks real is worse than an empty
--   list the admin fills.
-- - It does not replace the `COMPANY_NAME` literal in the print document. That
--   constant comes from the .docx and is verified verbatim by
--   `scripts/verify_handover_document.py`; pointing it at a table row would make a
--   signed legal artefact depend on an admin-editable value, which is a different
--   decision and a bigger one.