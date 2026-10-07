-- Handover accessories: the bag and the charger that travel with a device.
--
-- ## The problem this solves
--
-- A laptop leaves with a bag and a charger. All three carry **one** asset code
-- (`assets_asset_code_ci_key` is unique over `upper(btrim(asset_code))`, added by
-- `02300`), so they cannot be three rows in `assets` — that is precisely what
-- makes the code a usable identifier in the first place. They are one kit, and
-- the kit is one `assets` row.
--
-- The handover is where the gap bites. `assignments` is one row per **asset**, and
-- the document is one row per assignment, so a handover that records the laptop
-- alone prints one line, and the paper somebody signs does not mention the bag.
--
-- ## Why a table rather than a column
--
-- `assignments.notes` is already a batch-wide free-text field, so "laptop +
-- charger + bag" could have been appended there. That was refused, and the reason
-- is the same one `01900` records for `condition_at_handover`: what was handed
-- over **at this moment** is a fact about the handover, not about the asset, and
-- it is exactly the kind of thing the signature block attests to. A text blob
-- cannot be listed, searched, or counted, and re-printing the document has to
-- produce the same list rather than whatever sentence was typed that day.
--
-- **It is deliberately not on `assets` either.** A bag that always belongs to one
-- laptop is a property of the *kit*, and that would be a second table
-- (`asset_accessories`) holding the permanent pairing. This migration records the
-- pairing as it was on one date instead, which is the weaker but honest claim:
-- what the signed paper says went out, is what is stored. Adding the permanent
-- kit table later is additive — it could *suggest* accessory names in the issue
-- form without this table changing.
--
-- ## One row per accessory, and why there is no quantity
--
-- "Tas", "Charger" — a name. The document already has a Qty column, and
-- `HandoverPrintModal` treats Qty as print-form state that is deliberately not
-- saved (see the note at the top of that file): a handover row *is* one asset, so
-- a quantity is always 1. An accessory is the same fact one level down, and a
-- "2 tas" line is two names. So the count stays on the printed form where the
-- template puts it, and inventing an integer here would be a second place to keep
-- that number.
--
-- The name is free text and that is intentional: it names a physical thing that
-- has not been inventoried, which is the whole premise of this table. It is not
-- a reference list because there is nothing to reference — `assets` holds devices,
-- and until a bag is given an asset code of its own there is no row to point at.

create table public.assignments_accessories (
    id            uuid primary key default gen_random_uuid(),
    assignment_id uuid not null references public.assignments (id) on delete cascade,
    name          text not null,
    created_at    timestamptz not null default now()
);

comment on table public.assignments_accessories is
  'Non-device items that travelled with a device on one handover — bag, charger,'
  ' case. One row per item, attached to the assignment row of the device it went'
  ' out with. Not part of `assets`: these items share the device''s asset code and'
  ' are not separately inventoried.';

comment on column public.assignments_accessories.assignment_id is
  'The device this item travelled with. `on delete cascade` so removing a handover'
  ' takes its accessories with it, which is what deleting an erroneous record'
  ' should mean.';

comment on column public.assignments_accessories.name is
  'What the item is, as the admin typed it at handover time ("Tas", "Charger",'
  ' "Kabel HDMI"). Free text on purpose: these items are not in `assets`, so there'
  ' is no reference list to validate against. Blank and whitespace-only names are'
  ' refused below rather than stored as an empty row.';

alter table public.assignments_accessories
  add constraint assignments_accessories_name_not_blank
    check (btrim(name) <> '');

-- Serves the one read this table has: the accessories of the rows in one batch,
-- which is also the join `getHandoverDocument` uses. Small table, but the document
-- query filters on it for every printing.
create index assignments_accessories_assignment_idx
  on public.assignments_accessories (assignment_id);

-- -----------------------------------------------------------------------------
-- Grants and RLS — mirroring `assignments` exactly, because an accessory is
-- readable and writable exactly when its handover is.
-- -----------------------------------------------------------------------------
--
-- The `revoke` from `anon` is explicit and load-bearing, for the reason `01000`
-- and every migration since it records: Supabase's default privileges hand `anon`
-- all seven privileges on a new table in `public`, and with no `anon` policy every
-- query comes back **empty** — which reads exactly like correct and passes every
-- functional test. The grant is the first line of defence, the policy the second.
revoke all on public.assignments_accessories from anon;
grant select, insert, update, delete on public.assignments_accessories to authenticated;

alter table public.assignments_accessories enable row level security;
alter table public.assignments_accessories force row level security;

-- Read follows `assignments_select_own_or_admin` through the parent row, because
-- a staff member who may see the handover holding a laptop may see that a charger
-- went with it. **The `exists` is explicit rather than relying on the join being
-- filtered**, for the same reason `02000` rewrote two policies: a comparison that
-- is silently false produces an empty list and no error, which looks like a
-- missing feature rather than a broken policy.
create policy assignments_accessories_select_own_or_admin
    on public.assignments_accessories for select to authenticated
    using (
      public.is_admin()
      or exists (
        select 1
        from public.assignments a
        join public.handover_users h on h.id = a.user_id
        where a.id = assignments_accessories.assignment_id
          and h.profile_id = (select auth.uid())
      )
    );

-- Writes are **admin only**, and that is not a copy of the parent's policies.
-- `assignments_insert_admin` is admin-only, so an accessory can only be created
-- alongside a handover the admin was allowed to create — which is also why
-- `issue_handover_batch` below needs no extra check. But an accessory must not be
-- *added to* or *removed from* an existing open handover by a holder returning it:
-- `assignments_update_own_or_admin` lets a staff member update their own row, and
-- that update is what stamps `returned_at`. Editing the accessory list at the same
-- moment would let the person returning the kit decide what the signed paper says
-- went out with it.
create policy assignments_accessories_insert_admin
    on public.assignments_accessories for insert to authenticated
    with check (public.is_admin());

create policy assignments_accessories_update_admin
    on public.assignments_accessories for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

create policy assignments_accessories_delete_admin
    on public.assignments_accessories for delete to authenticated
    using (public.is_admin());

-- -----------------------------------------------------------------------------
-- issue_handover_batch — one transaction for the handover and its accessories
-- -----------------------------------------------------------------------------
--
-- Without this, issuing a handover with accessories would be **two** statements:
-- insert the assignments, then insert the accessories. A dropped request between
-- them leaves a laptop out on loan whose bag and charger are recorded nowhere —
-- and the printed document is derived from what is stored, so the paper would
-- list the device alone. That is the same failure `issueHandover`'s single
-- multi-row insert was written to avoid, one level up, and the all-or-nothing
-- property is the point of the batch rather than a convenience.
--
-- `security invoker` — deliberately, and this is the opposite of every guard
-- trigger in this schema. The function must **not** be able to do anything the
-- caller could not do by hand: `assignments_guard_asset_available` still fires per
-- row, `assignments_insert_admin` still refuses a staff caller, and
-- `assignments_one_open_per_asset` still refuses a duplicate. A `security definer`
-- version would bypass all three, and the trigger would then be the only thing
-- standing between a staff member and issuing a handover — which is exactly the
-- privilege the policies exist to withhold. `security invoker` also means the
-- function needs no grant on it beyond what a table write already needs, so there
-- is no new capability surface.
--
-- `search_path` is pinned even though the function is invoker-rights, for the
-- ordinary reason: the names inside it resolve the same way for every caller.
--
-- `p_rows` is a jsonb array of objects matching the columns `issueHandover`
-- already sends. `p_accessories` maps an `asset_id` from that array to the list
-- of names that travelled with it — keyed by `asset_id` rather than by assignment
-- id because the caller has no assignment ids yet: they are generated inside this
-- transaction.
--
-- **`returning id, asset_id` is what ties an accessory to its row**, and it is the
-- whole mechanism. The earlier draft matched rows back by
-- `(asset_id, user_id, assigned_by, assigned_at)`, which reads as equivalent and
-- is not: it is a *guess* at which rows this call just wrote, and it guesses
-- wrong the moment two batches for the same person for the same device share a
-- timestamp — or when `assigned_by` is null, because `null = null` is unknown and
-- the predicate silently stops matching. `returning` hands back the exact row id
-- the insert produced, so there is nothing to infer. `assigned_at` is still left to
-- its `now()` default, for the reason `issueHandover` never sent it: the server's
-- clock is the only one that should decide when a handover happened, and the batch
-- grouping depends on every row of one call sharing that value.
--
-- The insert is **one statement over the whole array**, not a loop, so
-- `assignments_guard_asset_available` and `assignments_one_open_per_asset` fire per
-- row exactly as they do for a hand-written multi-row insert, and one refusal
-- rolls back every row of the batch. `foreach` over the returned ids then adds the
-- accessories, inside the same transaction: any failure in that loop unwinds the
-- assignments too, so there is no state in which a laptop is out on loan with its
-- charger recorded nowhere.
-- The `revoke` from `anon` is the same explicit belt `01700` fastens on
-- `is_admin()` and `current_asset_unit()`: Postgres grants `execute` on a new
-- function to `PUBLIC` by default, so `anon` can *call* this without being
-- granted anything on `assignments`.
--
-- Calling it would still fail — `anon` holds no privileges on either table, so
-- the first insert raises `42501` — which is why this is not an urgent fix. It is
-- here because "reachable but refused" is one step from "reachable and permitted",
-- and because a function whose body writes `assignments` should not be a thing an
-- anonymous caller can invoke at all.
create or replace function public.issue_handover_batch(
    p_rows          jsonb,
    p_accessories   jsonb default '{}'::jsonb
)
returns uuid[]
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_ids        uuid[] := array[]::uuid[];
    v_name       text;
    v_names      jsonb;
    v_asset_id   text;
    v_id         uuid;
    v_written    uuid;
    v_where      jsonb := '{}'::jsonb;
begin
    if p_rows is null or jsonb_array_length(p_rows) = 0 then
        raise exception 'No asset was selected, so there was nothing to hand over'
            using errcode = 'P0001';
    end if;

    -- **One statement for the whole batch**, iterated rather than collected.
    -- PL/pgSQL's `returning … into` assigns a single row and raises "query returned
    -- more than one row" on the second, so a multi-row batch cannot use it at all;
    -- `for … in insert … returning` is the form that iterates the result of the
    -- one insert, which keeps the property this function exists for. The batch
    -- being one statement is what makes `assignments_guard_asset_available` and
    -- `assignments_one_open_per_asset` roll the whole batch back together, exactly
    -- as PostgREST's array insert does today.
    --
    -- `assigned_at` is left to its `now()` default for the reason `issueHandover`
    -- never sent it: the server's clock is the only one that should decide when a
    -- handover happened, and the batch grouping depends on every row of one call
    -- carrying the same value.
    for v_written, v_asset_id in
        insert into public.assignments (asset_id, user_id, assigned_by, due_date, notes, condition_at_handover)
        select
            (r.asset_id)::uuid,
            (r.user_id)::uuid,
            nullif(r.assigned_by, '')::uuid,
            nullif(r.due_date, '')::date,
            nullif(btrim(r.notes), ''),
            nullif(r.condition_at_handover, '')
        from jsonb_to_recordset(p_rows) as r(
            asset_id                text,
            user_id                 text,
            assigned_by             text,
            due_date                text,
            notes                   text,
            condition_at_handover   text
        )
        returning id, asset_id
    loop
        v_ids := array_append(v_ids, v_written);
        -- The map is built from what this call just wrote, which is why there is
        -- no lookup query here and no way for it to reach a pre-existing handover of
        -- the same device. An earlier draft matched rows back by
        -- `(asset_id, user_id, assigned_by, assigned_at)`; that reads as equivalent
        -- and is not — it guesses, and it guesses wrong when `assigned_by` is null,
        -- because `null = null` is unknown rather than true.
        v_where := v_where || jsonb_build_object(v_asset_id, v_written);
    end loop;

    if array_length(v_ids, 1) is null then
        -- Reachable when RLS filtered every row, which for an INSERT against a row
        -- filter is `assignments_insert_admin` refusing a non-admin. Raising here is
        -- what stops the caller seeing "issued, zero accessories" and reporting
        -- success for a handover that did not happen.
        raise exception 'No handover was written: the insert matched no row'
            using errcode = '42501';
    end if;

    -- One loop over the accessories the caller asked for, rather than a second
    -- `insert … select` over a join. The join version is one statement and reads
    -- tidier, but the loop keeps the "an `asset_id` in `p_accessories` that is not
    -- in this batch is ignored" rule in one visible place rather than in a `where`
    -- clause three lines long — and this table gets at most a handful of rows per
    -- handover, so the statement count is not a cost.
    for v_asset_id, v_names in
        select e.key, e.value
        from jsonb_each(p_accessories) as e (key, value)
        where jsonb_array_length(coalesce(e.value, '[]'::jsonb)) > 0
    loop
        -- The `nullif` is the "ignore an id that is not in this batch" rule. It is
        -- here rather than in the loop header because the two are the same decision
        -- seen from different sides, and an accessor list naming a device the admin
        -- did not actually hand over is a form bug rather than a database error —
        -- refusing the whole batch over it would lose a valid handover.
        v_id := nullif(v_where ->> v_asset_id, '')::uuid;
        if v_id is null then
            continue;
        end if;

        for v_name in select jsonb_array_elements_text(v_names)
        loop
            -- A blank name would be refused by the check constraint with a message
            -- naming a constraint rather than the input, so it is skipped. The service
            -- trims and drops empties before it gets this far; this is the database
            -- not storing one regardless of who calls.
            if btrim(v_name) = '' then
                continue;
            end if;

            insert into public.assignments_accessories (assignment_id, name)
            values (v_id, btrim(v_name));
        end loop;
    end loop;

    return v_ids;
end;
$$;

-- The `revoke` from `anon` is the same explicit belt `01700` fastens on
-- `is_admin()` and `current_asset_unit()`: Postgres grants `execute` on a new
-- function to `PUBLIC` by default, so `anon` can *call* this without holding any
-- grant on `assignments`.
--
-- Calling it would still fail — `anon` holds no privileges on either table, so
-- the insert raises `42501` — which is why this is not an urgent fix. It is here
-- because "reachable but refused" is one step from "reachable and permitted", and
-- because a function whose body writes `assignments` should not be something an
-- anonymous caller can invoke at all. `service_role` is revoked alongside it for
-- the reason `01700` records: it bypasses RLS anyway, so the grant was redundant
-- rather than dangerous.
revoke all on function public.issue_handover_batch(jsonb, jsonb) from public, anon, service_role;
grant execute on function public.issue_handover_batch(jsonb, jsonb) to authenticated;

comment on function public.issue_handover_batch(jsonb, jsonb) is
  'Issues a batch of handovers and their accessories as one transaction. Invoker'
  ' rights on purpose: every guard and policy that applies to a hand-written'
  ' insert applies here too. Exists because a dropped request between two'
  ' statements would leave a device out on loan with its accessories recorded'
  ' nowhere, and the printed document is derived from what is stored.';

-- -----------------------------------------------------------------------------
-- What this migration deliberately does not do
-- -----------------------------------------------------------------------------
--
-- - It does not add a quantity. See the note above the table.
-- - It does not make accessories `assets` rows, and it does not relax
--   `assets_asset_code_ci_key`. A bag sharing a laptop's code is the premise; a bag
--   with its own code is a different feature that would need its own inventory
--   lifecycle.
-- - It does not let a holder edit the accessory list of a handover they are
--   returning. See the write policies.
-- - It does not change the document grouping key. Accessories hang off an
--   assignment row, so they follow the batch without the batch having to know
--   they exist.