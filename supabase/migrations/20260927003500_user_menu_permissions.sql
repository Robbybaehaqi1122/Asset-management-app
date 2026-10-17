-- Per-user menu access, maintained by an admin.
--
-- ## What this is, and what it is not
--
-- This table decides **which menus a staff member's sidebar shows** and whether the
-- pages behind them offer their write actions. It is a **UI gate and nothing more** —
-- the same status `adminOnly` on `NavItem` has carried since the sidebar was written,
-- and the same status `unit` carries on the two asset rows. Hiding a link does not stop
-- anyone with a session from sending the request.
--
-- The boundaries that actually enforce anything are unchanged and still in RLS:
-- `01700` scopes asset reads to the reader's own unit, and `03100` lets staff add and
-- edit assets in their own department while delete stays admin-only. A row here can
-- **narrow** what a staff member is offered. It cannot widen them past the database.
--
-- That is deliberate, and it is why the closed set below excludes every admin-only
-- menu. Granting somebody `/users` in this table would show the link and then land on
-- a page that refuses to render, because `profiles_select_own_or_admin` and
-- `assets_write_admin` say no — a configuration that looks granted and is not.
--
-- ## The menu keys are the sidebar's own keys
--
-- `menu_key` holds the `NavSubItem.key` from `src/layout/AppSidebar.tsx`, which is also
-- the i18n key under `sidebar.items`. Reusing them means there is one spelling of each
-- menu in the app: the row that gates a link and the string that names it cannot drift.
--
-- Mirrored in code by `PERMISSION_MENU_KEYS` in
-- `src/modules/permissions/menuAccess.ts`. Two copies of a closed set is already the
-- shape `assets.department` versus `categories.department` is documented for, so the
-- check below is what makes the two agree rather than leaving it to discipline: a key
-- the database does not know is refused with `23514` instead of becoming a row that
-- never matches anything.
--
-- ## `menu_key` is trimmed, because an untrimmed one is invisible
--
-- A stray space would produce a row that passes every `exists` in the UI and matches
-- no menu key at all, so the grant would appear to have been saved and would do
-- nothing. That is the failure class this schema has been bitten by repeatedly — the
-- `locations.name` case where a dropped column took out a whole screen, the
-- `HandoverUsers` department lookup that stored NULL and reported success. Refusing it
-- at the column is cheaper than diagnosing it later.
--
-- ## edit and delete both imply view
--
-- A row that can be written but not read describes an access nobody can use: the page
-- that would perform the write is behind the link this same row hides. Same pairing
-- reasoning as `assets_inspection_schedule_paired_check`, which refuses half of one
-- inspection schedule.
--
-- `can_delete` is **not** required to imply `can_edit`. "May delete, may not edit" is a
-- real (if unusual) instruction — an archivist who tidies up but does not amend — and
-- refusing it would be this table inventing a rule nobody asked for.
--
-- ## A missing row means "today's behaviour", not "no access"
--
-- **Absent row = the menus that reader can already reach**, so this migration is a no-op
-- for every account that already exists. Default-deny was the first instinct and it is
-- the worse choice here: it would silently strip every current staff member of every
-- menu the moment this lands, and a rule that hides UI fails completely and without
-- error when the data behind it turns out to be empty.
--
-- Revoking is therefore an **explicit row with all three flags false**, not a deletion.
-- That is a real cost — absence now means "unconfigured" rather than "forbidden", so
-- the page distinguishes a person with no rows from a person whose rows all say no —
-- and it is the reason `ABSENT_ROW_GRANTS_EVERYTHING` in `menuAccess.ts` is a named
-- constant rather than a fallback buried in a comparison. Flipping it to default-deny
-- is that one line, once every staff member has been given explicit rows.
--
-- ## Write policies are admin-only, and the read policy is the mirror of every other
--
-- A staff member may read their own row — the sidebar has to — and may not touch
-- anybody's, including their own. Granting yourself access is the whole attack this
-- table could have, so it is refused in the database rather than left to the page that
-- would be the only thing guarding it.

create table public.user_menu_permissions (
  id uuid not null default gen_random_uuid() primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  menu_key text not null,
  can_view boolean not null default true,
  can_edit boolean not null default true,
  can_delete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_menu_permissions_profile_menu_key unique (profile_id, menu_key),
  constraint user_menu_permissions_menu_key_known check (
    menu_key in ('calendar', 'assetIt', 'assetHsse', 'handover')
  ),
  constraint user_menu_permissions_key_trimmed check (
    menu_key = btrim(menu_key) and menu_key <> ''
  ),
  constraint user_menu_permissions_edit_implies_view check (
    not can_edit or can_view
  ),
  constraint user_menu_permissions_delete_implies_view check (
    not can_delete or can_view
  )
);

comment on table public.user_menu_permissions is
  'Per-user menu access for staff accounts, maintained by an admin. A UI gate, not an
   access control: it decides which sidebar rows render and whether the pages behind
   them offer their write actions, while RLS remains the sole authority on data.';
comment on column public.user_menu_permissions.profile_id is
  'The staff account this row is about. Cascade on delete, so removing an account
   removes its menu overrides with it.';
comment on column public.user_menu_permissions.menu_key is
  'The NavSubItem.key from AppSidebar, which is also the sidebar.items.<key> i18n key.
   Closed set: calendar, assetIt, assetHsse, handover. Admin-only menus are excluded
   because a row cannot widen a reader past the RLS policies that already refuse them.';
comment on column public.user_menu_permissions.can_view is
  'Whether this menu is offered to this reader at all. False here is an explicit denial:
   see the table comment on why a missing row is not one.';
comment on column public.user_menu_permissions.can_edit is
  'Whether the pages behind this menu render their create and update actions.';
comment on column public.user_menu_permissions.can_delete is
  'Whether the pages behind this menu render their delete actions. Does not require
   can_edit — "may tidy up, may not amend" is a coherent instruction.';

-- Serves the sidebar read and the admin page's per-user read. Small table, but both
-- are on the render path of the shell rather than behind a click.
create index user_menu_permissions_profile_id_idx
  on public.user_menu_permissions (profile_id);

create trigger user_menu_permissions_set_updated_at
  before update on public.user_menu_permissions
  for each row execute function public.set_updated_at();

alter table public.user_menu_permissions enable row level security;
alter table public.user_menu_permissions force row level security;

grant select, insert, update, delete on public.user_menu_permissions to authenticated;
revoke all on public.user_menu_permissions from anon;

create policy user_menu_permissions_select_own_or_admin
  on public.user_menu_permissions for select to authenticated
  using (
    public.is_admin()
    or profile_id = (select auth.uid())
  );

create policy user_menu_permissions_insert_admin
  on public.user_menu_permissions for insert to authenticated
  with check (public.is_admin());

create policy user_menu_permissions_update_admin
  on public.user_menu_permissions for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy user_menu_permissions_delete_admin
  on public.user_menu_permissions for delete to authenticated
  using (public.is_admin());

comment on policy user_menu_permissions_select_own_or_admin on public.user_menu_permissions is
  'A staff member reads their own overrides so the sidebar can filter itself; an admin
   reads every row to maintain them.';
comment on policy user_menu_permissions_insert_admin on public.user_menu_permissions is
  'Admin-only. A staff member may not grant themselves access to anything, which is the
   one privilege this table could otherwise hand out.';
comment on policy user_menu_permissions_update_admin on public.user_menu_permissions is
  'Admin-only, for the same reason as the insert policy.';
comment on policy user_menu_permissions_delete_admin on public.user_menu_permissions is
  'Admin-only. Deleting a row restores that menu to the reader''s existing behaviour, so
   this is a reset rather than a removal.';