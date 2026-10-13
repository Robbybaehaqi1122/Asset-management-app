-- Print templates: a Brother P-touch template this installation can print against.
--
-- ## What this stores, and what it deliberately does not
--
-- A template is a `.lbx` file an operator authors in **P-touch Editor** — not something
-- this application draws. What the database holds is a *pointer* to one, the sheet to
-- print on, and which of the stored templates is the live one.
--
-- **The paper sizes are not stored, and that is the decision worth defending.** A
-- `.lbx` already states each sheet's size in points, and `lbxReader.ts` reads them. A
-- `width_mm`/`height_mm` pair here would be a second source of truth for a fact the file
-- owns, and it could disagree with the file the moment somebody re-exported a template
-- without re-uploading it — which is the trap this schema refuses everywhere else
-- (`profiles.department` as free text, `usage_status` beside `status`, a device password
-- on `assets`). The size dropdown reads the file instead: one 2.7 KB download, inflated
-- in the browser, which is the same fetch b-PAC makes when it opens the template anyway.
--
-- ## Why a sheet is stored at all, when the file names its own default
--
-- Because **the file's default is not necessarily the sheet anyone wants.**
-- `asset-36x15.lbx` declares `<pt:body currentSheet="36x13">`, so b-PAC opens it on the
-- 13 mm roll unless something selects otherwise. Measured from that file:
--
-- ```
-- Sheet 2    18.06 x 17.92 mm   objects: Frame17, Symbol21
-- 36x13      36.12 x 13.19 mm   objects: asset-code, Text7, Text8, Text9, Shape10
-- 36x15      36.12 x 16.02 mm   objects: asset-code, Text7, Text8, Text9, Shape10
-- ```
--
-- So `sheet` is the answer to "which roll is loaded", which is a fact about the
-- installation and **not** about the file. `null` means "use the file's own default",
-- which is the honest thing to record when the operator has not chosen.
--
-- ## One active template, enforced
--
-- A partial unique index, so the database holds the invariant rather than every caller
-- remembering to clear the previous row. `where is_active` indexes only the true rows,
-- so any number of inactive templates coexist while exactly one can be active.

create table public.print_templates (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    -- The **storage object path**, not a URL. The host is a deployment setting
    -- (`VITE_SUPABASE_URL`), so a stored URL would be wrong on every project but this
    -- one — the same reasoning `profiles.email` follows in a different direction.
    file_path text not null,
    sheet text,
    is_active boolean not null default false,
    created_by uuid references public.profiles (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint print_templates_name_not_blank check (btrim(name) <> '')
);

comment on table public.print_templates is
  'Brother P-touch templates this installation can print against. The file itself is a
   .lbx in Storage; only a pointer to it is stored here.';
comment on column public.print_templates.file_path is
  'Path inside the print-templates bucket, not a URL — the host differs per project.';
comment on column public.print_templates.sheet is
  'Which sheet of the .lbx to print on. null means "the file''s own default", which for
   asset-36x15.lbx is 36x13 and is almost never what is wanted.';
comment on column public.print_templates.created_by is
  'The administrator who uploaded it. set null on delete, like assignments.assigned_by:
   a template outlives the account that added it, but the audit trail is worth keeping.';

-- Exactly one active, enforced here rather than by every writer remembering.
create unique index print_templates_one_active on public.print_templates (is_active)
    where is_active;

-- The listing is ordered by name, and the sidebar-sized admin screen reads every row.
create index print_templates_name_idx on public.print_templates (lower(btrim(name)));

create trigger print_templates_set_updated_at
    before update on public.print_templates
    for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ RLS

alter table public.print_templates enable row level security;
alter table public.print_templates force row level security;

-- Every signed-in user may see which templates exist: the print path needs to know the
-- active one, and hiding the list from staff would make the Print button fail for them
-- for no reason. Exactly the split on `categories` — reference data is read by all and
-- written by admins.
create policy print_templates_select_authenticated
    on public.print_templates for select to authenticated using (true);

-- Four policies rather than one `for all`, for the reason `asset_credentials` needed
-- them: an INSERT is the one operation whose `with check` violation is an *error*, and
-- folding it into a `for all` would make its absence depend on a `using` expression
-- evaluated against a row that does not exist yet.
create policy print_templates_insert_admin
    on public.print_templates for insert to authenticated
    with check (public.is_admin());

create policy print_templates_update_admin
    on public.print_templates for update to authenticated
    using (public.is_admin()) with check (public.is_admin());

create policy print_templates_delete_admin
    on public.print_templates for delete to authenticated
    using (public.is_admin());

-- `anon` is revoked explicitly. Supabase's default privileges hand it all seven
-- privileges on a new table in `public`, and with no `anon` policy every query would come
-- back empty — which reads exactly like correct. The grant is the first line of defence.
revoke all on public.print_templates from anon;
grant select, insert, update, delete on public.print_templates to authenticated;

-- -------------------------------------------------------------- the bucket

-- **The bucket is public, and that is deliberate rather than an oversight.**
--
-- `Doc.Open(url)` is fetched by the b-PAC browser extension, which does **not** attach an
-- `Authorization` header — it is not this application's session, and there is nowhere for
-- it to get one. A private bucket would therefore make the template unreadable at print
-- time, which is the single thing this feature exists to do.
--
-- What a `.lbx` contains is **layout**: paper sizes, object positions, fonts, a barcode
-- type. It holds no asset code, no name, no credential — the data is written into it at
-- print time and never stored in the file. So public read discloses the shape of a blank
-- label, which is not a secret.
--
-- **Write stays admin-only**, and it is a bucket policy rather than a table policy
-- because the object is not a row of anything this schema knows about.
--
-- There is no `comment on bucket` — Postgres has no such object type, and `storage.buckets`
-- is an ordinary table, so a comment there would describe every bucket on the project
-- rather than this one. The note belongs here.
insert into storage.buckets (id, name, public)
values ('print-templates', 'print-templates', true)
on conflict (id) do nothing;

create policy print_templates_objects_read
    on storage.objects for select
    using (bucket_id = 'print-templates');

create policy print_templates_objects_insert_admin
    on storage.objects for insert to authenticated
    with check (bucket_id = 'print-templates' and public.is_admin());

create policy print_templates_objects_update_admin
    on storage.objects for update to authenticated
    using (bucket_id = 'print-templates' and public.is_admin())
    with check (bucket_id = 'print-templates' and public.is_admin());

create policy print_templates_objects_delete_admin
    on storage.objects for delete to authenticated
    using (bucket_id = 'print-templates' and public.is_admin());