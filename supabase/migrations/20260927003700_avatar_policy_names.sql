-- Corrections to 20260927003600, which is already applied and therefore immutable.
--
-- ## Why this is a new file
--
-- `03600` is in `supabase_migrations.schema_migrations` on the remote, so its content is
-- a historical record. Editing it would not change the database and would leave the
-- checked-in files describing something the remote does not have. Every change below is
-- therefore expressed the only way an applied migration allows: forward.
--
-- ## What is being corrected
--
-- Two policy names and one column comment, all typos. **No behaviour changes.**
--
-- ## Why drop-and-create rather than ALTER POLICY … RENAME
--
-- `ALTER POLICY ... RENAME TO` is the tidier statement and was the first thing tried. It
-- requires ownership of the table, and `storage.objects` is owned by
-- `supabase_storage_admin` — not by `postgres`, which is `rolsuper = f` here and only
-- carries `rolbypassrls`. So the rename raised `42501 must be owner of table objects`.
-- `DROP POLICY` does not carry the same check and succeeds.
--
-- Dropping and recreating is safe despite touching policy twice, because the migration
-- runs inside a single transaction: there is no moment at which the policy is absent.
-- **The `USING` and `WITH CHECK` expressions below are copied verbatim from `03600`**, and
-- the refusal behaviour was re-measured afterwards rather than assumed — see the note at
-- the bottom of this file.
--
-- ## What is deliberately NOT fixed here
--
-- The bucket is still `public = true`, which means any avatar is retrievable from
-- `/storage/v1/object/public/avatars/<path>` with no authentication at all — measured
-- over HTTP with the anon key, returning the file body with a 200.
--
-- That matches the `print-templates` precedent from `02900`, which is public for a
-- reason that does not apply to a photograph of a person. It is a **privacy decision,
-- not a typo**, and it is left exactly as the owner left it. Making the bucket private
-- means every reader needs `createSignedUrl()` and the expiry handling that comes with
-- it, which is its own piece of work.
--
-- What limits the exposure today is that the path's first segment is the owner's uuid
-- and `profiles` is revoked from `anon`, so the uid is not publicly readable and the path
-- is therefore unguessable. That is obscurity rather than a boundary, which is why it is
-- written down here instead of being treated as protection.

-- Two of the three write policies were created as `avatars_obejects_*` — `obejects`, not
-- `objects` — and one of those also reads `ora_admin` rather than `or_admin`. Nothing
-- consults a policy by name at runtime, so these were harmless in behaviour and wrong in
-- the schema a reader sees: `pg_policies` listed three correctly spelled names and one
-- that did not match its siblings, and a future `drop policy` needs the typo spelled
-- exactly right.

drop policy avatars_obejects_update_own_or_admin on storage.objects;

create policy avatars_objects_update_own_or_admin
    on storage.objects for update to authenticated
    using (
        bucket_id = 'avatars'
        and (public.is_admin() or (storage.foldername(name))[1] = (select auth.uid())::text)
    )
    with check (
        bucket_id = 'avatars'
        and (public.is_admin() or (storage.foldername(name))[1] = (select auth.uid())::text)
    );

drop policy avatars_obejects_delete_own_ora_admin on storage.objects;

create policy avatars_objects_delete_own_or_admin
    on storage.objects for delete to authenticated
    using (
        bucket_id = 'avatars'
        and (public.is_admin() or (storage.foldername(name))[1] = (select auth.uid())::text)
    );

-- Re-stating the comment to fix `owner ''s id`, which rendered as `owner 's id` with a
-- stray space. The doubled quote is how SQL escapes one, so it needs no space after it.
--
-- Re-stated in full rather than edited in place, because `COMMENT ON` is idempotent and
-- re-running it is the only way to change a comment on an already-applied migration.
comment on column public.profiles.avatar_path is
  'Path within the ''avatars'' bucket, NOT a URL. A signed URL expires, so storing one stores a broken link. The first path segment is always the owner''s id.';