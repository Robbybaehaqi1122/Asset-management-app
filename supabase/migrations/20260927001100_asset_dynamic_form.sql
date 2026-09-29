-- Dynamic asset form: coded categories, the reference data the form needs to
-- drive its fieldsets, and the per-category columns those fieldsets write.
--
-- Issue #50. The form in `src/modules/assets/pages/AssetListPage.tsx` used to
-- show the same five tabs for every category. It now switches on the *main*
-- category, so the database has to be able to say which category that is. A name
-- is not stable enough to switch on — an admin renaming "COMPUTER" would
-- silently empty that category's fieldset — so the category gets a `code`.
--
-- Nothing here changes access. `anon` still holds no privilege on any table,
-- staff still read every `assets` row, and `asset_credentials` stays admin-only.
-- See AGENTS.md, "The asset inventory", for the reasoning this file inherits.
--
-- ---------------------------------------------------------------------------
-- What was deliberately NOT added, again
-- ---------------------------------------------------------------------------
-- `usage_status` was requested a second time in #50 and is still absent, now by
-- explicit decision rather than by omission. The sheet's "In Use / Idle" is
-- `assets.status` and nothing else: `assignments_sync_asset_status` keeps it in
-- step with the loans and `assets_guard_status` refuses a write that disagrees.
-- A second column would be a second answer to the same question, free to
-- contradict the one the database already enforces. The form shows the status
-- read-only and points at the existing status control.
--
-- `device_name`, `notes`, `device_condition`, `category` and `location` are
-- still mapped onto `name`, `description`, `condition`, `category_id` and
-- `location_id` for the same reason they were in 20260927001000: one source of truth
-- per fact.

-- ---------------------------------------------------------------------------
-- 1. Categories become data the form can switch on
-- ---------------------------------------------------------------------------
-- Nullable, not `not null`: the seven codes below are seeded, but a category an
-- admin adds later has no code, and it must still be insertable. The form treats
-- a category with no code as "common fields only", which is the honest behaviour
-- for a category nobody has taught it about yet.
alter table public.categories
    add column code text;

comment on column public.categories.code is
    'Stable machine key the asset form switches its fieldset on (COMPUTER, DISPLAY, …). Null for a category the form does not know, which falls back to the common fields. Survives a rename of `name`.';

-- A plain unique index, so the many NULLs a custom category carries are allowed
-- while a real code can only mean one category.
create unique index categories_code_key on public.categories (code);

-- ---------------------------------------------------------------------------
-- 2. Seed the reference data
-- ---------------------------------------------------------------------------
-- The dynamic form cannot work on an empty install: nothing to pick, no code to
-- switch on. Parents carry the code; children are identified by their parent.
--
-- `do update set code = excluded.code` rather than `do nothing` so a parent that
-- already exists without a code (created by hand before this migration) still
-- gets one. Children `do nothing` on conflict: re-parenting an existing category
-- is not this migration's business.
insert into public.categories (name, code) values
    ('COMPUTER',        'COMPUTER'),
    ('DISPLAY',         'DISPLAY'),
    ('NETWORK-DEVICES', 'NETWORK_DEVICES'),
    ('PERIPHERAL',      'PERIPHERAL'),
    ('UTILITIES',       'UTILITIES'),
    ('IOT',             'IOT'),
    ('SERVER',          'SERVER')
on conflict (name) do update set code = excluded.code;

insert into public.categories (name, parent_id)
select child.name, parent.id
from (values
    ('COMPUTER',        'PC'),
    ('COMPUTER',        'Laptop'),
    ('COMPUTER',        'Workstation'),
    ('DISPLAY',         'Monitor'),
    ('DISPLAY',         'Smart TV'),
    ('DISPLAY',         'Projector'),
    ('NETWORK-DEVICES', 'Switch'),
    ('NETWORK-DEVICES', 'Firewall'),
    ('NETWORK-DEVICES', 'Router'),
    ('NETWORK-DEVICES', 'Access Point'),
    ('PERIPHERAL',      'Printer'),
    ('PERIPHERAL',      'Scanner'),
    ('PERIPHERAL',      'UPS'),
    ('PERIPHERAL',      'Mouse/Keyboard'),
    ('UTILITIES',       'Rak Server'),
    ('UTILITIES',       'Cables'),
    ('UTILITIES',       'Tools'),
    ('IOT',             'CCTV'),
    ('IOT',             'Autogate Controller'),
    ('IOT',             'Smart Sensor'),
    ('SERVER',          'Physical Server'),
    ('SERVER',          'Blade'),
    ('SERVER',          'Storage Server')
) as child(parent_name, name)
join public.categories parent on parent.name = child.parent_name
on conflict (name) do nothing;

-- A few locations so the Location picker is usable out of the box. There is no
-- admin screen for locations yet; these are a starting point, not a policy.
insert into public.locations (name) values
    ('Head Office'),
    ('Server Room'),
    ('Gudang IT')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 3. The per-category columns
-- ---------------------------------------------------------------------------
-- All nullable. Every existing asset stays valid, and an asset of a category
-- that does not use a column simply leaves it NULL — the form only ever sends
-- the fields its fieldset shows, and it sends the loaded value back unchanged
-- for the rest.
alter table public.assets
    add column gpu_model       text,
    add column resolution      text,
    add column panel_size      text,
    add column capacity        text,
    add column speed           text,
    add column current_location text,
    add column protocol_url    text,
    add column connection_type text
        check (connection_type is null
               or connection_type in ('ethernet', 'wifi', 'fiber', 'cellular', 'other')),
    add column port_rj45       integer check (port_rj45 is null or port_rj45 >= 0),
    add column port_sfp        integer check (port_sfp is null or port_sfp >= 0),
    add column port_console    integer check (port_console is null or port_console >= 0),
    -- Multi-value checkbox fields, as arrays rather than a child table. They are
    -- a handful of fixed options that are never joined on, and the check keeps
    -- the set closed so "HDMI" and "hdmi" cannot become two values.
    add column input_ports     text[]
        check (input_ports is null
               or input_ports <@ array['vga', 'hdmi', 'lan', 'wifi', 'usb']::text[]),
    add column connectivity    text[]
        check (connectivity is null
               or connectivity <@ array['usb', 'bt_wireless', 'hdmi', 'lan', 'wifi']::text[]);

comment on column public.assets.current_location is
    'Room or desk the asset is actually in, when that differs from the registered `location_id`. Free text: a physical location changes faster than a picker can be edited, and this is the shop-floor note. It can diverge from `location_id`, which is a known and accepted limitation — nothing keeps the two in step.';
comment on column public.assets.gpu_model is 'Graphics adapter, COMPUTER only.';
comment on column public.assets.resolution is 'Native resolution, DISPLAY only.';
comment on column public.assets.panel_size is 'Panel diagonal, DISPLAY only. Free text so "27 inch" and "27\"" both live here without a units column.';
comment on column public.assets.input_ports is
    'Video/network inputs the display offers, from a closed set. Array rather than a column per option.';
comment on column public.assets.capacity is 'Peripheral capacity (tray, sheet, battery), free text.';
comment on column public.assets.speed is 'Peripheral speed (ppm, Mbps), free text.';
comment on column public.assets.connectivity is
    'How a peripheral connects, from a closed set. Array rather than a column per option.';
comment on column public.assets.connection_type is
    'Primary uplink of a network device, from a closed set.';
comment on column public.assets.port_rj45 is 'Count of RJ45 ports, NETWORK-DEVICES / SERVER / IOT.';
comment on column public.assets.port_sfp is 'Count of SFP+ ports, NETWORK-DEVICES / SERVER / IOT.';
comment on column public.assets.port_console is 'Count of console ports, NETWORK-DEVICES / SERVER / IOT.';
comment on column public.assets.protocol_url is
    'Stream or control URL for a network device. NOT a secret column: it lives on `assets`, which every signed-in user reads. A URL that embeds credentials (rtsp://user:pass@host/…) therefore leaks them to every staff member — the form warns, it does not prevent. See AGENTS.md.';
