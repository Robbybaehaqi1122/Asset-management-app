-- Print templates per department.
--
-- ## Why a template is per unit and not global
--
-- An IT laptop and an HSSE fire extinguisher are not the same label. They carry different
-- codes, different descriptions, and — the part that actually forces this — **different
-- paper**. IT is on a 36 x 15 mm roll; the inspection register is a document of its own.
-- One global template would mean every HSSE label printed with an IT layout, and the fix
-- for that would be to edit the template whenever a unit's labels needed something else.
--
-- So the template is chosen by **`assets.department`**, which is the one thing the print
-- path already has without asking anyone: `assets_sync_department` copies the unit off
-- the asset's category, so a client cannot file an HSSE item under IT.
--
-- ## The column is free text, and that is the same choice `categories.department` made
--
-- `categories.department` is free text with no `check` and no enum, so a unit nobody
-- seeded is still storable. A foreign key is therefore impossible here without first
-- changing that column, and this migration is not the place to do it. The department list
-- the panel offers is `getCategoryUnits()` — the same source the asset form's pickers use —
-- so **choosing from that dropdown is what keeps the two spellings identical**, which is
-- the only thing that would otherwise let a template be stored under a unit no asset uses.
--
-- The lookup is case- and space-insensitive for the same reason `02300` made
-- `assets_asset_code_ci_key` insensitive over `upper(btrim(...))`: "IT" and "it" are one
-- unit, and a register whose whole job is stable identifiers cannot hold two of them.
--
-- ## One active template **per department**, which is a different index
--
-- The previous `print_templates_one_active` allowed exactly one active row in the whole
-- table, which would have made two units impossible. It becomes a unique index over the
-- normalised department, still partial, so any number of inactive templates coexist while
-- each unit has at most one live template.

-- The table was empty when this was written, so the default names the unit the seed
-- belongs to rather than guessing at anything. **The service always sends it explicitly** —
-- see `uploadPrintTemplate` — so the default never decides anything in practice, and it is
-- here only so the column can be `not null` without a backfill that would invent a unit.
alter table public.print_templates
    add column department text not null default 'IT';

comment on column public.print_templates.department is
  'The owning unit, free text to match categories.department — there is no FK because that
   column is free text too. Compared case- and space-insensitively by
   print_templates_one_active_per_department.';

alter table public.print_templates
    add constraint print_templates_department_not_blank
    check (btrim(department) <> '');

-- One active per unit rather than one active in the table.
drop index public.print_templates_one_active;

create unique index print_templates_one_active_per_department
    on public.print_templates (upper(btrim(department)))
    where is_active;

-- The panel lists by department, and the print path looks up by it.
create index print_templates_department_idx
    on public.print_templates (department);