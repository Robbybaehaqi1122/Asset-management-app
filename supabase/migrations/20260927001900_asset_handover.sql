-- Asset handover: the UI for `assignments`, which has existed since migration
-- `001` with full RLS, a status trigger and two guards — but has never had a
-- screen. Everything here is what a handover record needs on top of a loan.
--
-- Three things below. Only the middle one is a new column; the other two record
-- why this migration is narrower than the issue asked for.
--
-- **1. The document number stays where it already is.**
-- `assets.handover_doc_no` has existed since `01000` and is already an editable
-- field on the asset form, so the document number this module needs is already
-- stored — on the asset, which is where that asset's own registration document
-- belongs. This migration adds no second copy of it.
--
-- A per-handover `assignments.handover_doc_no` was written here first and then
-- removed by decision. The argument for it was sound: one laptop handed over
-- five times has five berita acara, and a single per-asset number cannot express
-- that. The owner's answer was one column, and the honest cost is worth naming
-- rather than burying. A per-handover number is only truthful if each handover
-- can be numbered independently, and sharing one column means the second
-- handover overwrites the number the first one was recorded under — a silent
-- rewrite of history, which is the exact failure this schema refuses to design
-- in elsewhere (`profiles.department` as free text, `usage_status` as a second
-- status column).
--
-- So the handover form shows `assets.handover_doc_no` as a read-only reference
-- and never sends it. Whoever fills the asset's document number in on the asset
-- form decides what every future handover of that asset prints.
--
-- **2. `condition_at_handover` snapshots the condition, because
-- `assets.condition` cannot.** That column holds the condition *now*. A laptop
-- handed over two years ago in `good` and returned today `poor` has one
-- surviving record of its state on arrival — which is the whole point of a
-- handover form. Constrained to the same five values as `assets_condition_check`
-- rather than free text, so a condition can be compared and counted instead of
-- being spelled five ways.
--
-- **3. What `001` already did, and the one gap it left.**
-- `001` creates `assignments_one_open_per_asset` — the same partial unique index
-- this feature wants — so two people can never hold one asset, and that has held
-- since the first migration. Nothing here re-creates it, and re-declaring it
-- fails the entire file with `42P07 relation ... already exists` on a clean
-- `db reset --local`, four statements in. It did exactly that, which is the only
-- reason this paragraph exists.
--
-- What that index cannot see is the *status* of the asset being handed over. It
-- knows a loan exists; it does not know the asset is `retired`.
-- `assignments_sync_asset_status` only performs the transition `available` to
-- `assigned`, so a retired asset was still issuable: the row is written, nobody
-- errors, and the result is a person holding a retired asset with the status
-- still saying retired. Section 4's guard is what closes that, and it is the
-- only thing this migration adds to the invariant.
--
-- **The guard fires first; the index is the backstop.** The guard is
-- `before insert` and refuses with `23514`, because by then the asset already
-- reads `assigned`. `23505` is only reachable if the guard is missing. Both were
-- tested with the guard switched off inside a transaction, to prove `001`'s
-- index refuses an open duplicate on its own — without that, a green suite says
-- nothing about it, since the guard always arrives first in ordinary use.
--
-- The two codes are worth telling apart at the client: `23514` is a
-- `check_violation` that reads as "this asset is not available", and `23505` is
-- a `unique_violation` meaning a race was caught after the fact.

-- ---------------------------------------------------------------------------
-- 1. The one column
-- ---------------------------------------------------------------------------
alter table public.assignments add column condition_at_handover text;

comment on column public.assignments.condition_at_handover is
  'The asset''s condition when it left, as a handover record. assets.condition'
  ' only holds the condition now, so a two-year-old handover leaves no trace of'
  ' the state the item was received in. Constrained to the same five values as'
  ' assets_condition_check — a restated copy, not a reference, because a check'
  ' constraint cannot point at another table''s constraint. The two lists have to'
  ' be kept in step by hand.';

-- ---------------------------------------------------------------------------
-- 2. The condition closed set
-- ---------------------------------------------------------------------------
-- Deliberately a restated copy of `assets_condition_check` rather than a
-- reference to it. A check constraint cannot point at another table's constraint,
-- so the only options are a copy or a `check` against a lookup table, and a copy
-- of five literals is the cheaper of the two. It has to be kept in step by hand,
-- which is why the comment above says where the list comes from.
--
-- `23514`, the same code `assets_guard_status` and the maintenance guards raise.
alter table public.assignments
  add constraint assignments_condition_at_handover_check
    check (
      condition_at_handover is null
      or condition_at_handover in ('new', 'good', 'fair', 'poor', 'broken')
    );

-- ---------------------------------------------------------------------------
-- 3. One open loan per asset — already done, in `001`
-- ---------------------------------------------------------------------------
-- Nothing to create here. `20260927000100_schema.sql` already declares:
--
--   create unique index assignments_one_open_per_asset
--     on public.assignments (asset_id)
--     where returned_at is null;
--
-- `20260927000500_...` refers to it as an existing object in its own comments.
-- Declaring it a second time is not a no-op — Postgres raises `42P07` and the
-- whole migration fails, which is how this file came to be wrong in the first
-- place. The invariant this section used to claim as new has been true since
-- the schema was created.

-- ---------------------------------------------------------------------------
-- 4. Only an `available` asset can be handed over
-- ---------------------------------------------------------------------------
-- `block_assignment_while_in_maintenance()` from `00500` already refuses an
-- assignment while the asset is in maintenance. It says nothing about the other
-- three statuses nobody can derive, and a handover is exactly the screen where
-- that matters: without this, an asset with `status = 'retired'` can be handed
-- to somebody, and `assignments_sync_asset_status` will not move it — the
-- transition it performs is `available` to `assigned` only. The row is written,
-- nobody errors, and the result is a person holding a retired asset with the
-- status still saying retired. Verified before it was written; it is the same
-- "conditioned on the status the row is in now" behaviour that makes
-- `assignments_sync_asset_status` safe, applied here as a refusal instead.
--
-- `for update` on the asset row is load-bearing, not decoration. The unique index
-- from `001` already refuses two *committed* open handovers, but two admins
-- opening the same asset at the same moment would both read `available` and both
-- insert; the row lock serialises them so the second one sees the first one's
-- status.
--
-- `security definer` with a pinned `search_path`, for the reasons every other
-- guard in this schema has it. The caller is an admin (the INSERT policy already
-- established that), and this reads a column the caller may not otherwise be
-- able to observe consistently.
create or replace function public.block_assignment_unless_available()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status
    into v_status
    from public.assets
   where id = new.asset_id
     for update;

  -- `asset_id` is `not null` and a foreign key, so this is unreachable through
  -- the app. It is here so a service-role insert against a deleted row says what
  -- happened instead of falling through to the `null <> 'available'` branch,
  -- which is true and would report a confusing "is <null>".
  if v_status is null then
    raise exception 'Asset % does not exist', new.asset_id
      using errcode = '23503';
  end if;

  if v_status <> 'available' then
    raise exception
      'Asset % is %, not available: only an available asset can be handed over',
      new.asset_id, v_status
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger assignments_guard_asset_available
  before insert on public.assignments
  for each row execute function public.block_assignment_unless_available();