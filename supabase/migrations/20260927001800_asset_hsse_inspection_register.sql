-- The HSSE inspection register: "Equipement HSSE PGT.xlsx", sheet `EN`, headers on
-- row 2 (row 1 is the title `EQUIPMENT HSSE PGT`). Twelve headings, of which
-- **four already have a home** and eight are new below.
--
-- Four things about that file are worth stating before the SQL, because each one
-- changed what got built.
--
-- **1. The workbook has no category column at all.** `Equipment Family` (column
-- 12) is the only classification it carries, and it holds exactly three values:
-- `Fire Safety and Emergency Response` (117 rows), `Material Handling and
-- Lifting Equipment` (9) and `Vehicles and Road Transport` (1). That maps onto
-- the *top level* of `categories`, so it is seeded as three HSSE parent
-- categories below rather than becoming a column. A separate `equipment_family`
-- column beside `category_id` would be a second source of truth for one fact —
-- the reasoning that removed `profiles.department` as free text and kept
-- `usage_status` from being a rename of `status`.
--
-- **2. `Type dequipement` (column 6) is not a type.** Its values are checklist
-- *document codes*:
--
--     FORM-PGT-HSE-CL-003-08-2025_Cheklist Fire Extinguisher_ver01
--
-- so column 6 is the form's code and column 10 (`Checklist Name`) is its title.
-- Two headings, two facts, and the same shape as `Firmware` versus `Firmware
-- Version` in the IT hardware workbook — which is why they are two columns here
-- too, rather than one column holding whichever half was noticed first.
--
-- **3. `Frequence` and `Periodicite` are one fact in two columns.** The data
-- reads `1` + `Monthly`, `2` + `Daily`. An integer cannot hold `1x Monthly`, and
-- a single text column holding `"1 Monthly"` cannot be indexed for "inspected
-- more often than monthly". So the number and the unit are separate and the
-- check below refuses one without the other — the same treatment
-- `storage_size_gb` / `storage_size_text` got in `01200`.
--
-- **4. Two of the twelve columns have no data behind them.** `Checklist Link`
-- (column 11) is empty in all 127 rows and `Serial Number` (column 1) is empty
-- in every row that is not a placeholder. `Serial Number` maps to the existing
-- `assets.serial_number` and costs nothing. `Checklist Link` is added anyway,
-- because a URL is plain text needing no upload path — unlike the `img_1` /
-- `img_2` / `img_3` columns `01200` refused, which would have been three text
-- columns promising an attachment this project has no bucket for.
--
-- Two more facts about the file that do *not* affect the schema, recorded so
-- nobody re-derives them: **90 of the 127 `EN` rows are the literal string
-- `on progress`** in nearly every column rather than data, and the `FR` sheet is
-- two example rows belonging to a different company (`AGL Liberia`,
-- `AGL Cote d'Ivoire`, serials `XX34JHJ` / `MM45E`). `FR` is ignored: this app
-- is English-only, and those rows are a template, not inventory.

-- ---------------------------------------------------------------------------
-- 1. The eight new columns
-- ---------------------------------------------------------------------------
alter table public.assets
  add column entity_name text,
  add column country text,
  add column checklist_form_code text,
  add column checklist_name text,
  add column checklist_url text,
  add column inspection_generation_mode text,
  add column inspection_frequency integer,
  add column inspection_period_unit text;

comment on column public.assets.entity_name is
  'HSSE: the legal entity that owns the item, as the register spells it'
  ' ("Patimban Global Gateway Terminal"). Deliberately per-asset rather than a'
  ' column on locations: the register is multi-country by design, so two sites'
  ' under one entity still need it, and it is what makes an asset row readable'
  ' on its own without a join.';
comment on column public.assets.country is
  'HSSE: the country the item is in. Free text and not derived from the site,'
  ' because the register is multi-country and a site name does not imply one.';
comment on column public.assets.checklist_form_code is
  'HSSE: the checklist''s own form code as printed on the document, e.g.'
  ' FORM-PGT-HSE-CL-003-08-2025. The workbook calls this "Type dequipement",'
  ' which is a misnomer: the values are document identifiers, not types.';
comment on column public.assets.checklist_name is
  'HSSE: the checklist''s title, e.g. FIRE EXTINGUISHER CHECKLIST. Separate from'
  ' the form code because renaming a document should not invalidate the code'
  ' printed on the signed sheet, and vice versa.';
comment on column public.assets.checklist_url is
  'HSSE: link to the checklist document. Empty throughout the source workbook.'
  ' A plain URL, not an attachment: there is no Storage bucket in this project,'
  ' and this column therefore makes no promise the app cannot keep.';
comment on column public.assets.inspection_generation_mode is
  'HSSE: whether the inspection is raised by hand or generated automatically.'
  ' Constrained because it is a closed two-value set, on the same reasoning as'
  ' `usage_status` — a typo should be refused, not stored.';
comment on column public.assets.inspection_frequency is
  'HSSE: how many units of inspection_period_unit pass between inspections.'
  ' Paired with that column rather than merged into one text field, so'
  ' "inspected more often than monthly" stays an indexable integer test.';
comment on column public.assets.inspection_period_unit is
  'HSSE: the unit inspection_frequency counts in. Constrained, same reasoning as'
  ' inspection_generation_mode.';

-- ---------------------------------------------------------------------------
-- 2. The closed sets
-- ---------------------------------------------------------------------------
-- `Manual` is the only value the source workbook actually records for the
-- generation mode; `Automatic` is the counterpart of the French sheet's
-- `Manuel` / `Automatique` pair. Likewise the register observes `Daily` and
-- `Monthly` only, and `Weekly` / `Yearly` are added because an inspection
-- register that cannot express an annual fire-extinguisher check would refuse
-- real data. Both additions are inferred rather than observed, and are called
-- out here so the next reader does not mistake them for the file's values.
--
-- Every rejection here is `23514`, the same code `assets_guard_status` and the
-- maintenance guards raise, so a client sees one recognisable code.
alter table public.assets
  add constraint assets_inspection_generation_mode_check
    check (
      inspection_generation_mode is null
      or inspection_generation_mode in ('Manual', 'Automatic')
    ),
  add constraint assets_inspection_period_unit_check
    check (
      inspection_period_unit is null
      or inspection_period_unit in ('Daily', 'Weekly', 'Monthly', 'Yearly')
    ),
  add constraint assets_inspection_frequency_check
    check (inspection_frequency is null or inspection_frequency > 0);

-- The frequency and its unit are one schedule, so half of one is refused rather
-- than stored. Same pairing constraint as `storage_size_gb` / `storage_size_text`.
alter table public.assets
  add constraint assets_inspection_schedule_paired_check
    check (
      (inspection_frequency is null) = (inspection_period_unit is null)
    );

-- ---------------------------------------------------------------------------
-- 3. The three equipment families, as HSSE parent categories
-- ---------------------------------------------------------------------------
-- Seeded verbatim from column 12. They are `parent_id is null`, which is what
-- makes a row a parent, and `department = 'HSSE'` so the unit filter and
-- `assets_sync_department` file the assets correctly without the client ever
-- writing that column.
--
-- The workbook has **no middle level**: `Designation` (column 2) holds 127
-- distinct values that are mostly numbered instances — `Fire Extinguisher 1`
-- through `Fire Extinguisher 90`, `SCBA 1` through `SCBA 4`. Deriving
-- sub-categories from those would mean stripping the trailing number, which is
-- an inference about intent rather than a value the file states, so none are
-- seeded. An admin who wants `Fire Extinguisher` / `SCBA` / `Fire Truck` as
-- sub-categories adds them in Asset Settings, and `guard_category_parent`
-- keeps them inside this unit. An asset with no sub-category stores the parent
-- directly on `category_id`, which is the rule the form already followed.
--
-- A bare insert, no `on conflict`, like every other migration here: this is a
-- historical record of what ran, not a re-runnable script. If an admin created
-- one of these names by hand before this migration, the insert is *meant* to
-- fail loudly with `23505` rather than quietly merge or overwrite their row.
insert into public.categories (name, department, description) values
  (
    'Fire Safety and Emergency Response',
    'HSSE',
    'HSSE equipment family: fire extinguishers, breathing apparatus, and other fire and emergency response stock.'
  ),
  (
    'Material Handling and Lifting Equipment',
    'HSSE',
    'HSSE equipment family: lifting and material handling equipment, inspected under its own checklists.'
  ),
  (
    'Vehicles and Road Transport',
    'HSSE',
    'HSSE equipment family: emergency and operational vehicles, inspected under vehicle checklists.'
  );