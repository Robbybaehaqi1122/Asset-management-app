-- Align the asset columns with the headers of "IT Hardware Asset Database.xlsx".
--
-- 01200 read that workbook and copied the column headings per sheet, because
-- the form is specified as "100% follow the sheet headers". Three things that
-- the spreadsheet asks for are deliberately not followed, and each is a
-- deliberate decision rather than an omission:
--
--   * `Credential - Username` / `Credential - Password` stay in
--     `asset_credentials`, not on `assets`. `assets_select_authenticated` is
--     `using (true)`, so every signed-in user reads every asset row, and RLS
--     filters rows rather than columns. Two columns on `assets` would put a
--     plaintext device password into every staff member's list response.
--   * `img_1` / `img_2` / `img_3` are not added. They are image attachments and
--     this project has no Supabase Storage bucket, no upload path and no
--     policy; three text columns holding paths would be a promise the app
--     cannot keep.
--   * `Usage Status` is added, because the workbook's values are a real,
--     closed set the database can hold, but it is kept strictly separate from
--     `assets.status`. See the constraint below.
--
-- The port columns are counts (`HDMI = 3`, `VGA = 1`), not the boolean
-- checkbox list that 01100 modelled as `input_ports text[]`. The workbook is
-- unambiguous about this, so this migration replaces the array columns with
-- per-port integer counts.

-- ---------------------------------------------------------------------------
-- 1. Granular specification columns
-- ---------------------------------------------------------------------------
-- COMPUTER splits what 01100 stored as four free-text boxes into the workbook's
-- own headings: processor maker/model/spec, RAM maker/type/speed/slots/
-- channel/size, GPU model and whether it is onboard, storage maker/type/size,
-- and the display's model/type/size. The old text columns stay; they are what
-- 01100 already shipped and nothing reads them once the form switches over.

alter table public.assets
  add column processor_mfg text,
  add column processor_model text,
  add column ram_mfg text,
  add column ram_type text,
  add column ram_speed integer,
  add column ram_slots integer,
  add column ram_channel text,
  add column ram_size_gb integer,
  add column gpu_onboard boolean,
  add column storage_mfg text,
  add column storage_type text,
  add column storage_size_gb integer,
  add column display_model text,
  add column display_type text,
  add column display_size text;

comment on column public.assets.processor_mfg is
  'COMPUTER: Processor_MFG. "Processor maker", e.g. INTEL, AMD, QUALCOMM.';
comment on column public.assets.processor_model is
  'COMPUTER: the "Model" column after Processor_MFG, e.g. "Ultra 5 225T".';
comment on column public.assets.ram_mfg is 'COMPUTER: RAM_MFG, e.g. Samsung.';
comment on column public.assets.ram_type is
  'COMPUTER: RAM_Type, e.g. DDR5, DDR4, INTERNAL, Onboard.';
comment on column public.assets.ram_speed is
  'COMPUTER: the RAM "Speed" column, in MT/s, e.g. 5600, 4800.';
comment on column public.assets.ram_slots is
  'COMPUTER: the RAM "Slot" column, how many slots the memory occupies.';
comment on column public.assets.ram_channel is
  'COMPUTER: the "Chanel" column as written in the workbook, e.g. "Dual Chanel".'
  ' Spelled as the sheet spells it, because the value is carried through as'
  ' text rather than being normalised to a channel count.';
comment on column public.assets.ram_size_gb is 'COMPUTER: RAM "Size (GB)".';
comment on column public.assets.gpu_onboard is
  'COMPUTER: the "Onboard (Y/N)" column, true for Y.';
comment on column public.assets.storage_mfg is
  'COMPUTER: Storage_MFG. IOT and SERVER also record storage detail, so this'
  ' column is shared rather than per-category.';
comment on column public.assets.storage_type is
  'COMPUTER: Storage_Type, e.g. SSD-NVME, INTERNAL.';
comment on column public.assets.storage_size_gb is
  'COMPUTER, IOT and SERVER: Storage_Size in GB as a number. The workbook also'
  ' writes values like "120GB" and "2x 4TB" for the same heading, so those'
  ' belong in storage_size_text, not here.';
comment on column public.assets.display_model is
  'COMPUTER: the "Model11" column, the display model attached to the computer.';
comment on column public.assets.display_type is
  'COMPUTER: the "Type12" column, e.g. WQXGA, Curve, AMOLED.';
comment on column public.assets.display_size is
  'COMPUTER: the "Size" column, e.g. 14", 27", 6,7 inci.';

-- Storage sizes are not always a plain integer: the workbook has "120GB" on
-- NETWORK-DEVICES and "2x 4TB" / "4x 12TB" on SERVER. One text column holds
-- those, and the form sends to it whenever the value is not a bare number.
alter table public.assets
  add column storage_size_text text;

comment on column public.assets.storage_size_text is
  'Free-form storage size for the values that are not a plain GB number, e.g.'
  ' "120GB", "2x 4TB". Used instead of storage_size_gb when the entered value'
  ' is not numeric.';

-- ---------------------------------------------------------------------------
-- 2. Port counts, replacing the 01100 array columns
-- ---------------------------------------------------------------------------
-- 01100 modelled DISPLAY inputs as `input_ports text[]` and PERIPHERAL
-- connectivity as `connectivity text[]`, both holding port *names*. The
-- workbook holds *counts* in dedicated columns instead: DISPLAY has
-- VGA / HDMI / LAN / WIFI / USB, PERIPHERAL has USB / BT/Wireless / HDMI / LAN
-- / WIFI, and NETWORK-DEVICES has USB / RJ45 Port / SFP+ Slot / Console Port /
-- Power Port. A count cannot live in a name array, and "HDMI" and "3" are
-- different facts.

alter table public.assets
  add column port_vga integer,
  add column port_hdmi integer,
  add column port_lan integer,
  add column port_wifi integer,
  add column port_usb integer,
  add column port_bluetooth integer;

comment on column public.assets.port_vga is 'DISPLAY: VGA port count.';
comment on column public.assets.port_hdmi is 'DISPLAY and PERIPHERAL: HDMI port count.';
comment on column public.assets.port_lan is 'DISPLAY and PERIPHERAL: LAN port count.';
comment on column public.assets.port_wifi is
  'DISPLAY and PERIPHERAL: WIFI port count. Not the same fact as ip_wifi, which'
  ' is an address.';
comment on column public.assets.port_usb is
  'DISPLAY, PERIPHERAL and NETWORK-DEVICES: USB port count.';
comment on column public.assets.port_bluetooth is
  'PERIPHERAL: the "BT/Wireless" column, Bluetooth or wireless support.';

-- The three NETWORK-DEVICES port counts 01100 asked for already exist
-- (port_rj45, port_sfp, port_console). Power Port is new.
alter table public.assets
  add column port_power integer;

comment on column public.assets.port_power is
  'NETWORK-DEVICES: Power Port count.';

alter table public.assets
  add constraint assets_ram_speed_nonneg check (ram_speed is null or ram_speed >= 0),
  add constraint assets_ram_slots_nonneg check (ram_slots is null or ram_slots >= 0),
  add constraint assets_ram_size_gb_nonneg check (ram_size_gb is null or ram_size_gb >= 0),
  add constraint assets_storage_size_gb_nonneg check (storage_size_gb is null or storage_size_gb >= 0),
  add constraint assets_port_vga_nonneg check (port_vga is null or port_vga >= 0),
  add constraint assets_port_hdmi_nonneg check (port_hdmi is null or port_hdmi >= 0),
  add constraint assets_port_lan_nonneg check (port_lan is null or port_lan >= 0),
  add constraint assets_port_wifi_nonneg check (port_wifi is null or port_wifi >= 0),
  add constraint assets_port_usb_nonneg check (port_usb is null or port_usb >= 0),
  add constraint assets_port_bluetooth_nonneg check (port_bluetooth is null or port_bluetooth >= 0),
  add constraint assets_port_power_nonneg check (port_power is null or port_power >= 0);

-- The two array columns go, because keeping them would leave two competing
-- models for the same fact: a row could say `input_ports = '{HDMI}'` and
-- `port_hdmi = 1`, or `input_ports = '{}'` and `port_hdmi = 3`, and nothing
-- would say which is right. That is exactly the drift `00500` was written to
-- remove from `assets.status`.
--
-- The guard is the point of this block. `pg_raise` was added because dropping
-- a column that holds data is not recoverable on the remote: there is no
-- re-apply path and no rollback for an already-applied file. If anyone has
-- entered a display or a peripheral into the app between 01100 and now, this
-- migration refuses to run rather than deleting their port list silently. The
-- count was 0 on the remote when this was written.
do $$
declare
  using_arrays bigint;
begin
  select count(*) into using_arrays
  from public.assets
  where input_ports is not null or connectivity is not null;

  if using_arrays > 0 then
    raise exception
      'assets rows carry input_ports/connectivity data (%). Convert them to the'
      ' port_* count columns first, then re-run this migration.', using_arrays;
  end if;
end;
$$;

alter table public.assets
  drop column input_ports,
  drop column connectivity;

-- The workbook records firmware as two separate headings: `Firmware` holds a
-- platform name ("CISCO", "FortiGate") and `Firmware Version` holds the version
-- ("4.1.3.36"). 01100 has only one column, which is the version, so the maker
-- column is new.
alter table public.assets
  add column firmware_platform text;

comment on column public.assets.firmware_platform is
  'NETWORK-DEVICES: the `Firmware` column, which holds a platform or maker name'
  ' ("CISCO", "FortiGate") rather than a version. The version lives in'
  ' os_or_firmware_version.';

-- IOT and SERVER record where the device draws power, and the workbook has
-- this for both while no other category does.
alter table public.assets
  add column power_source text;

comment on column public.assets.power_source is
  'IOT and SERVER: Power Source, e.g. "PoE (Power over Ethernet)", "Battery".';

-- ---------------------------------------------------------------------------
-- 3. Usage Status
-- ---------------------------------------------------------------------------
-- `assets.status` is the loan state and is kept honest by
-- `assignments_sync_asset_status` and `assets_guard_status`: `available` and
-- `assigned` follow the actual loans and cannot be written by hand. The
-- workbook's `Usage Status` is a different judgement with a different value
-- set, so it is a separate column rather than an extension of `status`.
--
-- The constraint is a closed set taken from the workbook's own values, so
-- "in use by user" and "In used by User" cannot both exist. That is the same
-- reasoning as the `input_ports` check 01100 added.
--
-- The overlap is real and intentional: "Lent out" is a loan state that
-- `assets.status = 'assigned'` also describes. This column is the workbook's
-- record and is not kept in step with the loans; `assets.status` is the one
-- the triggers enforce. The form shows both, and the Administration tab
-- labels this one as the spreadsheet's own field.

alter table public.assets
  add column usage_status text;

comment on column public.assets.usage_status is
  'The workbook''s `Usage Status`, a person''s judgement, held separately from'
  ' `status` which the loan triggers own. Values are the closed set the'
  ' workbook uses. "Lent out" overlaps `status = ''assigned''`; the triggers'
  ' do not read this column and it is not kept in step with the loans.';

alter table public.assets
  add constraint assets_usage_status_check
  check (usage_status is null or usage_status in (
    'In used by User',
    'Idle',
    'Shared',
    'Lent out'
  ));

-- ---------------------------------------------------------------------------
-- 4. Sub-categories the workbook actually lists
-- ---------------------------------------------------------------------------
-- 01100 seeded 23 sub-categories that do not match the workbook. These are the
-- `Sub-Cat` values found in the file, per sheet. Only INSERTs happen: the
-- existing rows are left alone rather than renamed or deleted, because
-- `assets.category_id` may already point at them and `categories.name` is
-- UNIQUE, so a rename could collide with a workbook value.
--
-- ON CONFLICT DO NOTHING keeps this re-runnable in spirit and, more usefully,
-- keeps it from failing if a sub-category an admin already created by hand
-- happens to share a name with one of these.

insert into public.categories (name, parent_id)
select v.sub_cat, p.id
from (values
  -- COMPUTER
  ('COMPUTER', 'PC'),
  ('COMPUTER', 'Notebook'),
  ('COMPUTER', 'Handheld'),
  ('COMPUTER', 'AIO'),
  -- DISPLAY
  ('DISPLAY', 'TV'),
  -- NETWORK-DEVICES
  -- Switch and Firewall are already seeded by 01100.
  -- PERIPHERAL
  ('PERIPHERAL', 'MK SET'),
  ('PERIPHERAL', 'Headphone'),
  ('PERIPHERAL', 'Speaker'),
  ('PERIPHERAL', 'External Storage'),
  ('PERIPHERAL', 'Keyboard'),
  -- UTILITIES
  ('UTILITIES', 'Bracket TV + Port Electric'),
  ('UTILITIES', 'Network Tools'),
  -- IOT
  ('IOT', 'AI & Compute'),
  ('IOT', 'Surveillance & Autogate')
  -- SERVER: the workbook's only SERVER sub-category is "Server" itself, which
  -- collides with the parent name under categories_name_key, so it is skipped
  -- and the sheet's rows keep the parent directly. A trailing comment cannot sit
  -- after the last row without a comma, so the list ends at IOT.
) as v(parent_name, sub_cat)
join public.categories p on p.name = v.parent_name and p.parent_id is null
on conflict (name) do nothing;
