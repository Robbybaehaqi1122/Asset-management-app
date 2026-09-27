-- 00800 — a temporary password an admin chose, and the flag that says so.
--
-- The create flow has an admin either type a password or generate one. Either
-- way, the admin knows the first credential for the account, and will keep
-- knowing it for as long as nobody changes it. This column is how the app knows
-- to ask, once, on the new user's first sign-in.
--
-- It is a usability control, not a security boundary, and the difference
-- matters. GoTrue has no `mustChangePassword` equivalent to the one Windows AD
-- and LDAP carry, so nothing on the server can refuse the temporary credential.
-- What this flag buys is that the admin's knowledge of the password stops
-- being permanent the first time the user signs in. Someone who wants to keep
-- using the old password can; they just have to be the kind of person who
-- bothers to do that. The honest version of this feature is an emailed reset
-- link, where the admin never sees the password at all — that needs a working
-- mail provider, which this project does not have.
--
-- `default false` so every existing account is unaffected. There is one admin
-- and one staff row in production and neither has ever been created through the
-- create flow, so anything else would lock the owner out of their own project
-- on the next deploy.
--
-- No trigger guards this column and none should. It is not a privilege
-- decision, it is a prompt to the account holder, and `protect_profile_email`
-- and `protect_profile_role` have nothing to say about it.

alter table public.profiles
    add column must_change_password boolean not null default false;

comment on column public.profiles.must_change_password is
    'True while the account still uses the password an admin set at creation. Cleared by the user changing it. Advisory, not enforced by the database.';
