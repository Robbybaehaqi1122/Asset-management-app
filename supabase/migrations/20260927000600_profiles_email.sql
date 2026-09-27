-- profiles.email
--
-- The email lives in `auth.users`, which PostgREST does not expose: the client
-- can only reach the `public` schema, so a user list cannot show or search by
-- email without either a `service_role` key (forbidden here) or a copy of the
-- one column we actually need.
--
-- This is a denormalisation and it can go stale. `on_auth_user_created` keeps
-- new rows correct, which is the case that really happens; an address changed
-- by hand in Auth will not appear here until the UPDATE below is re-run.
-- `profiles.email` is display data, never a source of truth — the
-- authoritative address is `auth.users.email`, and sign-in uses that one.

alter table public.profiles add column email text;

comment on column public.profiles.email is
  'Denormalised copy of auth.users.email written by on_auth_user_created. Display only; the authoritative address is auth.users.email.';

-- The trigger already exists on `auth.users`, so `create or replace function`
-- updates the body underneath it and the attachment survives. Declaring it
-- again would fail with "trigger already exists".
--
-- Every property of the original body is load-bearing and unchanged here:
-- `security definer` because the caller has no INSERT policy on `profiles`,
-- `set search_path = public` so a schema earlier in the path cannot shadow it,
-- and a hardcoded `staff` because role must never come from signup metadata.
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
    insert into public.profiles (id, email, full_name, department, role)
    values (
        new.id,
        nullif(trim(coalesce(new.email, '')), ''),
        nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
        nullif(trim(coalesce(new.raw_user_meta_data ->> 'department', '')), ''),
        'staff'
    );
    return new;
end;
$$;

-- Backfill rows that predate the column. `nullif` leaves the column NULL when
-- the account has no address to copy rather than storing the empty string that
-- `auth.users` uses for a phone-only user.
update public.profiles p
   set email = nullif(trim(u.email), '')
  from auth.users u
 where u.id = p.id
   and p.email is null;

-- `auth.users` already enforces unique email, so this cannot collide for a
-- real account; it asserts the invariant rather than adding a new one. NULLs
-- stay distinct in Postgres, so any row that could not be backfilled is fine.
create unique index profiles_email_key on public.profiles (email);
