-- The roster's company and employee number, and the delete guard `companies` has been
-- missing since `02600`.
--
-- ## What these two columns are for
--
-- The handover document prints a `NIK/EID` and a `Company` beside the recipient, and
-- beside **both** signatories. Those are facts about a *person* — who they are
-- employed by, and their staff number — not facts about a handover, so they belong
-- on the roster rather than on `assignments` and certainly not as print-form state
-- that has to be retyped on every printing.
--
-- They are `handover_users` columns for the same reason `position_id` and
-- `department_id` are (`02200`, `02000`): a list the database does not reference is
-- a list it cannot enforce, and it drifts the first time anything writes the field
-- from outside the form.
--
-- **`company_id` is the first foreign key into `companies`,** which is what makes
-- this migration also the one that owes that table a delete guard. See below.
--
-- ## Both are nullable, and neither is `not null`
--
-- Deliberately, and unlike `position_id` which `02200` made `not null`. A roster
-- entry is very often a contractor or a visitor who has no staff number and is not
-- employed by any of the companies on the list — that is the case the table exists
-- for. Forcing either would mean refusing to record somebody who genuinely holds
-- assets.
--
-- The cost is that the document's `NIK/EID` and `Company` lines can print **empty**,
-- and a legal document with a blank line is a form nobody filled in. So the print
-- modal shows those two lines only when there is a value, rather than printing an
-- empty label — the same rule the per-device Notes column already follows.

alter table public.handover_users
    add column company_id uuid references public.companies (id) on delete restrict;

alter table public.handover_users
    add column nik_eid text;

comment on column public.handover_users.company_id is
  'The company this person is employed by, from `companies`. Printed on the handover'
  ' document beside the recipient''s name and in both signature blocks. Nullable: a'
  ' contractor or visitor has no employer on this list, and refusing to record them'
  ' would mean refusing to record who holds an asset.';

comment on column public.handover_users.nik_eid is
  'The employee''s staff number ("NIK/EID" on the document). Free text, not a'
  ' reference list: these are issued by a human resources system this application has'
  ' no model of, and an admin typing one from a letter is the real entry path.';

-- Blank is refused because a document that prints an empty label where a staff number
-- belongs is worse than one that was never given the column, and the app trims before
-- sending so this is the database's own guarantee rather than a client's.
alter table public.handover_users
    add constraint handover_users_nik_eid_not_blank
      check (nik_eid is null or btrim(nik_eid) <> '');

-- Serves the roster's company picker, and the count inside `guard_company_delete`
-- below — which is a cross-table read a trigger cannot get from an index it does not
-- have. Without this the guard would be a sequential scan of the roster per delete.
create index handover_users_company_idx
    on public.handover_users (company_id);

-- ---------------------------------------------------------------------------
-- A company still in use cannot be deleted
-- ---------------------------------------------------------------------------
--
-- **This is the guard `02600` explicitly owed and did not have.** That migration's
-- header says the delete has no in-use guard because nothing referenced the table, and
-- that "the first migration that adds a `company_id` has to add the guard in the same
-- file". This is that migration, and this is that guard. Without it the Companies
-- screen would cheerfully delete a company that half the roster belongs to, and every
-- affected person would print a document with an empty `Company` line.
--
-- `on delete restrict` on the foreign key already refuses, but a bare `23503` names
-- a constraint and nothing else. The trigger says what is in the way — the same
-- reason `categories_guard_delete` (`01300`) and `positions_guard_delete` (`02200`)
-- each exist for their own table.
--
-- `security definer` for the reason they are: a count taken through the caller's own
-- RLS would report zero for rows they cannot see and wave the delete through.
create or replace function public.guard_company_delete()
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
   where company_id = old.id;

  if v_people > 0 then
    raise exception
      'Company % is the employer of % handover user(s); move them first',
      old.name, v_people
      using errcode = '23514';
  end if;

  return old;
end;
$$;

create trigger companies_guard_delete
  before delete on public.companies
  for each row execute function public.guard_company_delete();

-- ---------------------------------------------------------------------------
-- What this migration deliberately does not do
-- ---------------------------------------------------------------------------
--
-- - It does not make either column `not null`. See the header.
-- - It does not backfill. Both columns are new and no source in this project holds an
--   employee number or an employer, so there is nothing to read. Unlike `02200`,
--   which had `handover_users.position` free text to convert, there is no prior state
--   to carry across — and unlike the IT workbook, there is no spreadsheet here that
--   anyone could mistake for one.
-- - It does not make `nik_eid` unique. Two people genuinely share nothing about a
--   staff number, but the number belongs to a human resources system this application
--   does not model, so a collision is more likely to be a transcription slip than a
--   rule being broken, and `unique` would turn a correctable mistake into a refused
--   save. The `companies_name_ci_key` argument from `02300` does **not** apply here
--   and deliberately is not reused.