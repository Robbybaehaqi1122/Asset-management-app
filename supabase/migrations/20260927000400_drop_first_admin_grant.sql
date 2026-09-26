-- =============================================================================
-- Asset Management App — remove the implicit first-admin grant
--
-- Closes #39. `handle_new_user` used to grant `admin` to whichever profile was
-- created first in the project and `staff` to every profile after it. On a
-- reachable deployment that is a one-shot race for the entire database: whoever
-- signs up before the owner does satisfies every write policy in `rls.sql`, and
-- `protect_profile_role` will not let anyone demote them afterwards.
--
-- The grant existed to break a genuine deadlock, and that reasoning still holds:
-- with `role` defaulting to `staff`, with `profiles_protect_role` refusing
-- self-service role changes, and with no admin anywhere, no write policy can
-- ever be satisfied and the project stays permanently read-only. What changes
-- here is only *who* breaks the deadlock. The first admin is now created on
-- purpose, by a human, using the promote procedure in AGENTS.md — which is not
-- a secret, it is a deliberate three-statement act.
--
-- The alternative considered was keeping the grant and gating it on an
-- allowlisted email address, so the owner could still self-bootstrap. Removing
-- it outright was preferred: a hardcoded address inside a migration is its own
-- thing to keep correct, and the first-run bootstrap is the one place where
-- being wrong is not recoverable by editing the file afterwards.
--
-- The trigger is deliberately left alone. `on_auth_user_created` already calls
-- `public.handle_new_user()` by name, so `create or replace` keeps the same OID
-- and the trigger stays attached. Dropping and recreating the trigger would be a
-- no-op with a window in which a concurrent signup creates no profile at all.
--
-- Applying this is one-way in practice: once this version is recorded in
-- `schema_migrations`, restoring any first-admin grant means a further
-- migration, not an edit to this file.
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    -- No advisory lock and no first-user check any more. Every profile is
    -- created as `staff`, so two concurrent signups can no longer disagree
    -- about who was first, and there is no window in which the answer depends
    -- on who happened to arrive first.
    --
    -- `security definer` and `set search_path = public` are both load-bearing
    -- and stay: this function runs as the owner and writes a table the caller
    -- has no INSERT policy on, and without the pinned search_path a caller who
    -- could create a schema earlier in the path could shadow `public.profiles`.
    insert into public.profiles (id, full_name, department, role)
    values (
        new.id,
        nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
        nullif(trim(coalesce(new.raw_user_meta_data ->> 'department', '')), ''),
        'staff'
    );
    return new;
end;
$$;
