-- Handover users: a person a handover can be issued to, independent of whether
-- that person has an account.
--
-- `assignments.user_id` referenced `profiles`, which quietly said two things that
-- are not the same: *who received the asset* and *who can return it*. Those are
-- different facts, and they came apart the first time somebody needed to hand a
-- hard hat to a contractor, a visitor or a technician who does not sign in to
-- this application at all. There was no way to record that, because the only
-- list of people was the login list.
--
-- This migration separates them. `handover_users` is reference data — the roster
-- a handover is issued to — and `assignments.assigned_by` continues to record
-- the **authenticated account** that created the record. That asymmetry is the
-- point: the recipient is a fact about the asset, the issuer is a fact about the
-- app's audit trail, and collapsing them is what this change undoes.
--
-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
--
-- Modelled on `current_locations` (`01600`), not on `departments` (`00900`): a
-- person has their own fields, and a second table is what lets the two lists
-- exist independently rather than one table with a "which kind is this" column.
--
-- `profile_id` is the link back to an account, and it is nullable and **not
-- unique-by-name** on purpose. It is not unique either: several roster entries
-- may belong to nobody's account, which is the normal case for a contractor.
-- `unique` on a nullable column in Postgres permits any number of NULLs, so
-- `profile_id` is *not* given a unique index — see the note in section 5 for why
-- that matters for the RLS join.
create table public.handover_users (
    id            uuid primary key default gen_random_uuid(),
    name          text not null,
    position      text not null,
    -- A person's department, which is the same meaning `profiles.department_id`
    -- already carries, so it references `departments` rather than repeating the
    -- free-text `categories.department` trap. `01400`'s free text is defensible
    -- because a *category's* unit is the closed IT/HSSE pair that the asset
    -- routes serve; a person's department has no such closed set.
    department_id uuid references public.departments (id) on delete set null,
    -- The account this roster entry belongs to, when it belongs to one.
    -- Nullable because most entries will not: the whole point is recording a
    -- holder who has no login. See section 5 — this column is load-bearing for
    -- staff self-service and dropping it silently removes that capability.
    profile_id    uuid references public.profiles (id) on delete set null,
    notes         text,

    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    -- A roster entry with no name is not a person. Position is required too: the
    -- issue form shows it, and an entry that renders as a bare name in a picker
    -- listing twenty people is the thing this table exists to prevent.
    constraint handover_users_name_not_blank check (btrim(name) <> ''),
    constraint handover_users_position_not_blank check (btrim(position) <> '')
);

comment on table public.handover_users is
  'People a handover can be issued to, as reference data separate from the login'
  ' list. assignments.user_id points here; assignments.assigned_by stays on'
  ' profiles because the issuer is an authenticated account and the recipient is'
  ' not. profile_id is what lets a staff member still see and return the handovers'
  ' held by their own roster entry — see policy assignments_select_own_or_admin.';

comment on column public.handover_users.profile_id is
  'The account this person belongs to, if any. Nullable and deliberately not'
  ' unique: most roster entries are people who never sign in, and two entries'
  ' sharing an account is a data-entry mistake rather than something the database'
  ' should refuse. This column is what assignments_select_own_or_admin joins'
  ' through, so emptying it removes that staff member''s visibility of their own'
  ' handovers rather than raising an error.';

create index handover_users_name_idx on public.handover_users (name);
create index handover_users_department_idx on public.handover_users (department_id);
-- The join in the two rewritten policies starts from `profile_id`, so it needs
-- its own index. Without it every row filter on `assignments` becomes a seq scan
-- that fans out to this table.
create index handover_users_profile_idx on public.handover_users (profile_id);

-- ---------------------------------------------------------------------------
-- 2. A roster entry still holding an asset cannot be deleted
-- ---------------------------------------------------------------------------
--
-- The FK from `assignments.user_id` is `on delete restrict` (below), so the
-- database refuses. But a raw `23503` names a constraint and nothing else, so
-- this trigger exists to say what is in the way — the same reason
-- `categories_guard_delete` (`01300`) and the `DepartmentInUseError` check in the
-- application both exist for their own tables.
create or replace function public.guard_handover_user_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loans integer;
begin
  select count(*) into v_loans
    from public.assignments
   where user_id = old.id;

  if v_loans > 0 then
    raise exception
      'Handover user % is referenced by % handover record(s); remove or reassign them first',
      old.name, v_loans
      using errcode = '23514';
  end if;

  return old;
end;
$$;

create trigger handover_users_guard_delete
  before delete on public.handover_users
  for each row execute function public.guard_handover_user_delete();

-- ---------------------------------------------------------------------------
-- 3. Repoint `assignments.user_id`
-- ---------------------------------------------------------------------------
--
-- Backfill first, so no row is left pointing at a profile that is no longer the
-- target. Every profile that appears as a holder gets one roster entry, named
-- after its `full_name` and falling back to its `email` and then its id — the
-- same fallback chain `personLabel` used, so an existing list renders the way it
-- did before.
--
-- Guarded rather than assumed: the count is checked, and the block raises if any
-- holder failed to get an entry, because a silently orphaned `assignments` row
-- would read as "this record has no holder" and nothing would say why. The remote
-- has no re-apply path, so a partial backfill there is not repairable by
-- re-running the file.
insert into public.handover_users (name, position, profile_id, notes)
select
  coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.email), ''), p.id::text),
  'Unassigned',
  p.id,
  'Backfilled from the login list by migration 02000; position needs filling in'
from public.profiles p
where exists (
  select 1 from public.assignments a where a.user_id = p.id
)
on conflict do nothing;

do $$
declare
  v_orphans integer;
begin
  select count(*) into v_orphans
    from public.assignments a
   where not exists (
     select 1 from public.handover_users h
      where h.profile_id = a.user_id
   );

  if v_orphans > 0 then
    raise exception
      'Backfill left % assignment(s) with no handover_users row; aborting rather than orphaning them',
      v_orphans
      using errcode = '23514';
  end if;
end $$;

update public.assignments a
   set user_id = h.id
  from public.handover_users h
 where h.profile_id = a.user_id
   and a.user_id <> h.id;

-- `restrict`, not `cascade` and not `set null`.
--
-- **Cascade** would delete the loan history when a roster entry is deleted, which
-- is exactly what `assets.asset_pic`'s comment warns against — *"a handover record
-- should survive the person leaving."* **Set null** would preserve it but needs
-- `not null` dropped, and then `mapHandover`'s `String(row.user_id)` and the
-- Return button's `row.userId === user?.id` both have to learn about a null they
-- currently cannot see. `restrict` keeps `not null` honest and hands the decision
-- to a human, who gets told what is in the way by the trigger above and by
-- `HandoverUserInUseError` in the application.
alter table public.assignments
  drop constraint assignments_user_id_fkey;

alter table public.assignments
  add constraint assignments_user_id_fkey
    foreign key (user_id) references public.handover_users (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- 4. Rewrite the two policies that keyed on the identity
-- ---------------------------------------------------------------------------
--
-- `assignments_select_own_or_admin` and `assignments_update_own_or_admin` both
-- compared `user_id = auth.uid()`. That was correct while `user_id` *was* an
-- `auth.users` id — all three were literally the same uuid — and it is silently
-- false the moment `user_id` points at a reference row: a reference id compared
-- against a JWT subject never matches, for any row, for any caller.
--
-- Nothing would have raised. `user_id = auth.uid()` is valid SQL either way, so
-- `tsc` passes, the policies are accepted, and a staff member's list is simply
-- empty while admins see everything. That is why the comparison is now explicit
-- about the join.
--
-- The `exists` is against `handover_users`, which every authenticated caller may
-- read (`using (true)` below), so the subquery is not itself filtered away.
-- The old policies are dropped first and the new ones created under the original
-- names. Postgres has no `ALTER POLICY ... RENAME`, and the order is safe anyway
-- because a migration runs in one transaction: there is no window in which
-- `assignments` has no policy at all.
drop policy assignments_select_own_or_admin on public.assignments;
drop policy assignments_update_own_or_admin on public.assignments;

create policy assignments_select_own_or_admin
    on public.assignments for select to authenticated
    using (
      public.is_admin()
      or exists (
        select 1
        from public.handover_users h
        where h.id = assignments.user_id
          and h.profile_id = (select auth.uid())
      )
    );

create policy assignments_update_own_or_admin
    on public.assignments for update to authenticated
    using (
      public.is_admin()
      or exists (
        select 1
        from public.handover_users h
        where h.id = assignments.user_id
          and h.profile_id = (select auth.uid())
      )
    )
    with check (
      public.is_admin()
      or exists (
        select 1
        from public.handover_users h
        where h.id = assignments.user_id
          and h.profile_id = (select auth.uid())
      )
    );

-- ---------------------------------------------------------------------------
-- 5. Grants and RLS on the new table
-- ---------------------------------------------------------------------------
--
-- Read for every signed-in user, write for admins. The read is `using (true)`
-- because the issue form's "Handed to" picker needs it, and a stock list is
-- useless without knowing who can hold something — the same reasoning
-- `categories_select_authenticated` and `departments_select_authenticated`
-- already use.
--
-- The `revoke` from `anon` is explicit and load-bearing. Supabase's default
-- privileges hand `anon` all seven privileges on a new table in `public`, and
-- with no `anon` policy every query comes back **empty** — which reads exactly
-- like correct and passes every functional test. The grant is the first line of
-- defence here; the policy is the second.
revoke all on public.handover_users from anon;
grant select on public.handover_users to authenticated;
grant insert, update, delete on public.handover_users to authenticated;

alter table public.handover_users enable row level security;
alter table public.handover_users force row level security;

create policy handover_users_select_authenticated
    on public.handover_users for select to authenticated
    using (true);

create policy handover_users_insert_admin
    on public.handover_users for insert to authenticated
    with check (public.is_admin());

create policy handover_users_update_admin
    on public.handover_users for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

create policy handover_users_delete_admin
    on public.handover_users for delete to authenticated
    using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 6. `updated_at`, same as every other table
-- ---------------------------------------------------------------------------
create trigger handover_users_set_updated_at
  before update on public.handover_users
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- What this migration deliberately does not do
-- ---------------------------------------------------------------------------
--
-- - It does not touch `assignments.assigned_by`. That column stays on
--   `profiles` because the issuer is an authenticated account; the recipient is
--   what decouples, not the audit trail.
-- - It does not make `name` unique. Two people can genuinely share a name, and
--   refusing the second one is worse than a picker showing two identical labels
--   — which the form resolves by also showing the position and the department.
-- - It does not give `profile_id` a unique index. Two roster entries sharing one
--   account is a data-entry mistake worth allowing, and `unique` on a nullable
--   column permits NULLs anyway, so it would not have prevented it.
-- - It does not delete the login list, the `profiles` table, or `/users`.
--   `handover_users` is a *roster*, not a replacement for accounts: only 4 people
--   have profiles and all of them are administrators or staff who need one.