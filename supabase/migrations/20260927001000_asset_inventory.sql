-- Asset inventory: the IT asset sheet, as columns on a table that already exists.
--
-- Issue #49 specified `create table assets` with ~30 columns copied from an Excel
-- inventory. `public.assets` has existed since 20260927000100 with a different
-- shape, so a create would fail with `relation "assets" already exists` and, if
-- forced through, would drop the two tables that reference it. This migration
-- adds what is missing instead of replacing what is there.
--
-- ---------------------------------------------------------------------------
-- What was deliberately NOT added
-- ---------------------------------------------------------------------------
-- Each of these was in the spreadsheet and is intentionally absent. In every
-- case the reason is the same as the recorded one for `profiles.email` and
-- `profiles.department`: a second source of truth for something the database
-- already owns is a thing that drifts, and nothing later can enforce the
-- difference.
--
--   device_name          -> `assets.name`, which is already not null. A second
--                           "what is this called" column would be the same
--                           question asked twice with no answer.
--   notes                -> `assets.description`.
--   category             -> `assets.category_id` already references
--                           public.categories. See below.
--   sub_category         -> `public.categories.parent_id` added below.
--   location             -> `assets.location_id` already references
--                           public.locations.
--   current_location     -> a second location beside `location_id` that
--                           nothing would keep in step with it. If the day comes
--                           that "where it is registered" and "where it
--                           actually is" diverge, that needs a transition rule
--                           and an audit trail, not a nullable text column.
--   device_condition     -> `assets.condition`, already constrained to five
--                           values by the database.
--   usage_status         -> `assets.status` and `assets.condition` between them
--                           already cover the sheet's "In Use / Idle / Good /
--                           Service" column. See the long version below.
--
-- On usage_status specifically, because it is the one that looks like an
-- omission. The sheet's column mixes two different axes: "In Use" and "Idle"
-- are loan state, "Good" is condition, and "Service" is maintenance state. The
-- first is already `assets.status`, kept honest by `assignments_sync_asset_status`
-- and `assets_guard_status`; the second is already `assets.condition`; the third
-- is `status = 'maintenance'`. Adding a fourth, unguarded text column whose
-- values can contradict the two that are enforced would reintroduce exactly the
-- inconsistency 20260927000500 was written to remove. The list below is the one
-- badge set the UI renders, and every value in it comes from a check constraint.

-- ---------------------------------------------------------------------------
-- Identity and procurement
-- ---------------------------------------------------------------------------
-- `asset_code` and `name` are the only two columns the create form cannot submit
-- without, and both are already not null. Everything here is optional, because a
-- partial inventory entry is more useful than a rejected one: an asset that
-- exists and is findable by its code is discoverable before anyone has typed its
-- processor spec.
alter table public.assets
    add column po_number       text,
    add column serial_number   text,
    add column short_name      text,
    add column manufacture     text,
    add column model_name      text,
    add column model_type      text,
    add column ownership       text,
    add column asset_pic       text,
    add column is_labeled      boolean not null default false,
    add column handover_doc_no text;

comment on column public.assets.po_number is
    'Purchase order the asset was bought under, replacing the free-text supplier field for procurement tracing.';
comment on column public.assets.serial_number is
    'Manufacturer serial number. Unique in practice, not in the database: a scan can read the same tag twice, and a false duplicate would block a real entry.';
comment on column public.assets.short_name is
    'Short internal tag, the thing people actually call the device on a desk.';
comment on column public.assets.manufacture is
    'Manufacturer, spelled as the inventory sheet spells it.';
comment on column public.assets.ownership is
    'Owned / leased / borrowed. Left free text: it is descriptive per-asset data that is never aggregated on, unlike status or condition.';
comment on column public.assets.asset_pic is
    'Person in charge of this asset, free text rather than a profiles reference: a handover record should survive the person leaving.';
comment on column public.assets.is_labeled is
    'Whether the physical asset tag has been printed and attached.';
comment on column public.assets.handover_doc_no is
    'Document number of the signed handover, when there is one.';

-- ---------------------------------------------------------------------------
-- Network
-- ---------------------------------------------------------------------------
-- Not secrets, and not hidden. `ip_*` and `mac_*` are inventory facts anyone
-- reading the asset list has already been cleared for by `assets_select_authenticated`.
alter table public.assets
    add column hostname               text,
    add column ip_wifi                text,
    add column ip_eth                 text,
    add column mac_wifi               text,
    add column mac_eth                text,
    add column os_or_firmware_version text,
    add column product_key            text;

comment on column public.assets.hostname is 'Network name of the device.';
comment on column public.assets.product_key is
    'OEM product key. Not a secret in the way a password is, and not reversible into anything, but kept out of the default list query rather than fetched on every row.';

-- ---------------------------------------------------------------------------
-- Hardware specification
-- ---------------------------------------------------------------------------
-- Four free-text columns rather than a specification table. That is the one
-- place free text is genuinely right: a CPU string has no closed value set, and
-- splitting it into parts would mean deciding which parts matter for a filter
-- nobody has asked for yet.
alter table public.assets
    add column processor_spec text,
    add column ram_spec       text,
    add column storage_spec   text,
    add column display_spec   text;

-- ---------------------------------------------------------------------------
-- Sub-categories
-- ---------------------------------------------------------------------------
-- The sheet has a category and a sub-category. `categories` had no way to
-- express the second, so it gets a self-reference instead of a second free-text
-- column on every asset. `on delete set null` for the same reason
-- `assets.category_id` uses it: removing a sub-category should promote its
-- assets, not delete them.
alter table public.categories
    add column parent_id uuid references public.categories (id) on delete set null;

comment on column public.categories.parent_id is
    'Self-reference giving a second level under a category. Null means top level.';

create index categories_parent_id_idx on public.categories (parent_id);

-- ---------------------------------------------------------------------------
-- Credentials
-- ---------------------------------------------------------------------------
-- The one part of the sheet that is actually a secret, and the reason this is a
-- separate table rather than two more columns.
--
-- `assets_select_authenticated` is `using (true)`, so every signed-in user
-- including staff reads every asset row. Two columns on `assets` would therefore
-- mean every staff member's asset list carried a plaintext device password, in
-- the response to the list query, whether or not anybody asked for it. RLS
-- cannot fix that: a policy filters rows, not columns, and no policy can stop a
-- permitted row from carrying a field you did not want read.
--
-- A separate table is the one lever RLS does give, and it is the same answer
-- `asset_credentials` is the only reason to exist for:
--
--   - staff keep `assets_select_authenticated` and lose nothing they had
--   - PostgREST applies the policy to the embedded resource, so a staff member
--     selecting `assets(*, credentials:asset_credentials(*))` gets the asset
--     rows and `credentials: null`
--   - the write is admin-only by the same `is_admin()` the rest of the module uses
--
-- KNOWN GAP, stated plainly: `password` is plaintext at rest. It is behind an
-- admin-only read rather than encrypted, which is a real improvement over
-- putting it on `assets` and not the same as being safe. Encrypting it properly
-- needs a key that lives outside the database, which means an Edge Function to
-- decrypt on read, and this project has no such key. Until one exists, treat
-- "who can read a device password" as a database-admin question, not an
-- application one. The fix is a `bytea` column plus a function with the key as a
-- function secret; it is not small and it was not asked for.
create table public.asset_credentials (
    id         uuid primary key default gen_random_uuid(),
    asset_id   uuid not null unique references public.assets (id) on delete cascade,

    username   text,
    password   text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.asset_credentials is
    'Device login credentials, split out of assets so that assets_select_authenticated cannot leak them to every signed-in user. One row per asset.';
comment on column public.asset_credentials.password is
    'PLAINTEXT. Readable only by admins, but not encrypted at rest. See the migration header.';

create trigger asset_credentials_set_updated_at
    before update on public.asset_credentials
    for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------
-- `anon` gets nothing, same as every other table in this project, so the absence
-- of a policy is not the only thing keeping it out.
--
-- The revoke is not optional bookkeeping. Supabase's default privileges already
-- grant `anon` all seven privileges on a new table in `public`, so a migration
-- that only grants to `authenticated` leaves the table readable-by-grant to
-- anonymous callers. RLS would still return zero rows — there is no `anon`
-- policy — which is exactly why it is easy to ship: the queries come back empty
-- and the mistake is invisible until someone reads the grant list directly.
-- Verified: without the revoke, `information_schema.role_table_grants` shows
-- `anon` holding select, insert, update, delete, truncate, trigger and
-- references on this table. The project rule is that the *grant* is the first
-- line of defence and the policy is the second, so both have to be right.
revoke all on public.asset_credentials from anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.asset_credentials to authenticated;

alter table public.asset_credentials enable row level security;
alter table public.asset_credentials force row level security;

-- One policy per operation rather than a single `for all`, so the insert case
-- does not rely on a using expression that has no row to read yet. Same split
-- `20260927000900_departments.sql` uses.
create policy "asset_credentials_select_admin"
    on public.asset_credentials
    for select to authenticated
    using (public.is_admin());

create policy "asset_credentials_insert_admin"
    on public.asset_credentials
    for insert to authenticated
    with check (public.is_admin());

create policy "asset_credentials_update_admin"
    on public.asset_credentials
    for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

create policy "asset_credentials_delete_admin"
    on public.asset_credentials
    for delete to authenticated
    using (public.is_admin());

-- `assets` needs no new policy. The columns added above are covered by the
-- existing `assets_select_authenticated` and `assets_write_admin`, and
-- `assets_guard_status` keeps applying to the rows it always did.
