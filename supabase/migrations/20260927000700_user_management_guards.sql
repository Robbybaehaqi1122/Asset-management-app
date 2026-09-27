-- Two guards that the user-management screen depends on.
--
-- Both are triggers rather than client checks on purpose. The screen is a
-- convenience: hiding a control, or disabling a button, does not stop anyone
-- with a valid session from sending the request. This is the same reasoning
-- that put `profiles_protect_role` and the asset status guards in the database.

-- 1. The last admin cannot be demoted.
--
-- Without this, an admin can remove their own `admin` role in one statement
-- and leave the project with zero admins. Recovering needs manual SQL with
-- `profiles_protect_role` disabled, because that trigger is what refuses the
-- write in the first place.
--
-- `pg_advisory_xact_lock` is what makes the check sound rather than merely
-- helpful. A plain `not exists` is evaluated against a snapshot taken before
-- the other transaction committed, so two admins demoting each other at the
-- same moment would each see the other still an admin and both would pass. The
-- lock is transaction-scoped and released on commit, and taking it as a
-- statement *before* the check means the check runs against a fresh snapshot.
-- It is an advisory lock rather than `lock table` on purpose: the UPDATE
-- already holds a ROW EXCLUSIVE lock on `profiles`, and a `before update`
-- trigger asking for a conflicting table lock would deadlock its own
-- transaction.
--
-- `23514` is `check_violation`, the same code the asset status guards raise,
-- so the client recognises one code for this class of refusal.
create or replace function public.guard_last_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Promotion, or the role is not being touched: nothing to protect.
    if new.role = 'admin' then
        return new;
    end if;
    -- The row was not an admin, so no admin is being lost.
    if old.role is distinct from 'admin' then
        return new;
    end if;

    perform pg_advisory_xact_lock(hashtext('profiles.last_admin'));

    if not exists (
        select 1
          from public.profiles
         where role = 'admin'
           and id <> new.id
    ) then
        raise exception 'Cannot remove the last admin'
            using errcode = '23514';
    end if;

    return new;
end;
$$;

create trigger profiles_guard_last_admin
    before update of role on public.profiles
    for each row
    execute function public.guard_last_admin();

-- 2. `profiles.email` is not self-editable.
--
-- `profiles_update_own` lets a user write their own row, and an RLS policy
-- cannot restrict *which* columns get written, only which rows. So without
-- this trigger the new `profiles.email` column would be free for any signed-in
-- user to overwrite on their own row, and the address shown in the admin list
-- would be whatever they typed.
--
-- Impact is limited to display: sign-in and the password reset both read
-- `auth.users.email`, so this is not an account-takeover path. It is still
-- worth closing, because the whole point of copying the address was for the
-- admin list to be trustworthy.
--
-- An admin may still correct a stale copy, which keeps the re-sync path open
-- for the denormalisation caveat noted in 20260927000600. `is_admin()` reads
-- `auth.uid()`, so a bare `UPDATE` from the CLI as `postgres` is refused here
-- exactly as it is by `profiles_protect_role`; see AGENTS.md, "Promoting the
-- first admin", for the documented three-statement procedure.
create or replace function public.protect_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.email is distinct from old.email and not public.is_admin() then
        raise exception 'Only an admin may change the email column'
            using errcode = '42501';
    end if;
    return new;
end;
$$;

create trigger profiles_protect_email
    before update of email on public.profiles
    for each row
    execute function public.protect_profile_email();
