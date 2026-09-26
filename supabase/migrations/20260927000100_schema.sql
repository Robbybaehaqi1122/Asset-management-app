-- =============================================================================
-- Asset Management App — initial schema
--
-- Creates six tables: profiles, categories, locations, assets, assignments,
-- maintenance. Policies live in the companion rls.sql; the split keeps the
-- security-critical half reviewable on its own.
--
-- Conventions used throughout:
--   - Surrogate PK `uuid` with `gen_random_uuid()`.
--   - `created_at` / `updated_at` are `timestamptz`, never bare `timestamp`. A
--     `timestamp` without a zone silently means a different instant per reader,
--     and office staff in more than one timezone is the normal case, not the
--     edge case. `profiles` has only `created_at`; the spec it was written to
--     has no mutable application fields that need a modifiable stamp.
--   - Money is `numeric(14,2)`. Never `float` — binary rounding on currency is
--     a real bug, not a style preference.
--   - Enumerated columns are `text` + `check` rather than `enum`. Postgres
--     enums are painful to extend (see "Don'ts" in AGENTS.md).
--   - Optional parent references use `on delete set null` so deleting a
--     category or location never silently destroys assets.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles — one row per auth user
--
-- `id` is both the primary key and the FK to auth.users, so the two tables are
-- 1:1 by construction rather than by convention. `on delete cascade` means
-- removing an auth user removes the profile; without it, a deleted auth user
-- would leave an orphan row that no policy can match, since every policy keys
-- off auth.uid().
--
-- `role` is deliberately plain text, not a table of roles: two roles is not
-- worth the join, and it makes the admin check a single indexed lookup. The
-- check constraint is what makes the column's option list real — without it
-- `default 'staff'` documents nothing and any string is accepted.
--
-- Nothing here is writable by the user at signup except full_name and
-- department, both of which the trigger copies from user metadata. `role` is
-- never taken from the client, for the reason given in the trigger migration.
-- -----------------------------------------------------------------------------
create table public.profiles (
    id          uuid primary key references auth.users (id) on delete cascade,
    full_name   text,
    role        text not null default 'staff'
                check (role in ('admin', 'staff')),
    department  text,
    created_at  timestamptz not null default now()
);

comment on table public.profiles is
    'Application-level user record, one per auth.users row, created automatically on signup.';
comment on column public.profiles.id is
    'Matches auth.users.id exactly. Not a surrogate key: the same value in both tables is the point.';
comment on column public.profiles.role is
    'Either admin or staff. Set by the first-user bootstrap or by an admin; never by the profile owner.';
comment on column public.profiles.department is
    'Free text. No departments table, so nothing constrains the spelling.';

-- -----------------------------------------------------------------------------
-- categories — what kind of thing an asset is
-- -----------------------------------------------------------------------------
create table public.categories (
    id          uuid primary key default gen_random_uuid(),
    name        text not null unique,
    description text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- locations — where an asset currently is
-- -----------------------------------------------------------------------------
create table public.locations (
    id          uuid primary key default gen_random_uuid(),
    name        text not null unique,
    address     text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- assets — the core table
--
-- `asset_code` is the human-facing identifier (AST-0001) and is unique, but the
-- `id` uuid is what every foreign key references. Do not reference asset_code.
-- -----------------------------------------------------------------------------
create table public.assets (
    id             uuid primary key default gen_random_uuid(),
    asset_code     text not null unique,
    name           text not null,
    description    text,

    category_id    uuid references public.categories (id) on delete set null,
    location_id    uuid references public.locations (id) on delete set null,

    status         text not null default 'available'
                   check (status in ('available', 'assigned',
                                     'maintenance', 'damaged', 'retired')),
    condition      text not null default 'good'
                   check (condition in ('new', 'good', 'fair', 'poor', 'broken')),

    purchase_date  date,
    purchase_price numeric (14, 2) check (purchase_price is null or purchase_price >= 0),
    supplier       text,

    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

-- An asset cannot sit in maintenance while still being checked out, but that
-- invariant spans `assets` and `assignments`, and a CHECK constraint may not
-- reference another table. It is enforced by
-- `assets_block_maintenance_while_assigned` in 20260927000200_triggers.sql. An
-- earlier draft expressed it here as `check (status <> 'maintenance')`, which
-- did not enforce that at all — it simply made the `maintenance` status
-- unreachable, contradicting the enum check two lines above.

comment on column public.assets.status is
    'Lifecycle state. Note nothing auto-syncs this to assignments — see AGENTS.md.';
comment on column public.assets.asset_code is
    'Human-facing identifier shown in the UI. Foreign keys reference assets.id, never this.';

-- -----------------------------------------------------------------------------
-- assignments — who has which asset, since when
--
-- A nullable `returned_at` is the return marker: non-null means the loan is
-- closed. Deleting rows instead would destroy the audit trail this table exists
-- to provide.
-- -----------------------------------------------------------------------------
create table public.assignments (
    id           uuid primary key default gen_random_uuid(),
    asset_id     uuid not null references public.assets (id) on delete cascade,
    user_id      uuid not null references public.profiles (id) on delete cascade,
    assigned_by  uuid references public.profiles (id) on delete set null,

    assigned_at  timestamptz not null default now(),
    due_date     date,
    returned_at  timestamptz,

    notes        text,

    -- A return cannot precede the loan it closes.
    constraint assignments_dates_ordered
        check (returned_at is null or returned_at >= assigned_at)
);

-- At most one open loan per asset. This is the invariant that stops the same
-- laptop being handed to two people, and it has to be a database constraint
-- rather than application logic — a race between two requests would slip past
-- any check written in the client.
create unique index assignments_one_open_per_asset
    on public.assignments (asset_id)
    where returned_at is null;

-- -----------------------------------------------------------------------------
-- maintenance — service history and scheduled work
-- -----------------------------------------------------------------------------
create table public.maintenance (
    id               uuid primary key default gen_random_uuid(),
    asset_id         uuid not null references public.assets (id) on delete cascade,

    type             text not null default 'repair'
                     check (type in ('repair', 'upgrade', 'inspection', 'calibration')),
    description      text,
    status           text not null default 'scheduled'
                     check (status in ('scheduled', 'in_progress', 'completed', 'cancelled')),

    scheduled_date   date,
    completed_at     timestamptz,
    cost             numeric (14, 2) check (cost is null or cost >= 0),
    vendor           text,

    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),

    constraint maintenance_completion_ordered
        check (completed_at is null or scheduled_date is null
               or completed_at >= scheduled_date)
);

-- =============================================================================
-- Indexes
--
-- Postgres does not create indexes on the referencing side of a foreign key, so
-- every one of these is deliberate. Without them, deleting a category or
-- listing an asset's history degrades into a sequential scan.
-- =============================================================================
create index assets_category_id_idx  on public.assets (category_id);
create index assets_location_id_idx  on public.assets (location_id);
create index assets_status_idx       on public.assets (status);
create index profiles_role_idx       on public.profiles (role);

create index assignments_asset_idx      on public.assignments (asset_id);
create index assignments_user_idx       on public.assignments (user_id);
create index assignments_open_idx       on public.assignments (user_id) where returned_at is null;
create index maintenance_asset_idx      on public.maintenance (asset_id);
create index maintenance_status_idx     on public.maintenance (status);
