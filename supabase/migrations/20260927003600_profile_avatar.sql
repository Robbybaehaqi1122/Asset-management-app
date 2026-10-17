alter table public.profiles add column avatar_path text;

comment on column public.profiles.avatar_path is
  'Path within the ''avatars'' bucket, NOT a URL. A signed URL expires, so storing one stores a broken link. The first path segment is always the owner ''s id.';

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true);

create policy avatars_objects_read
    on storage.objects for select
    using (bucket_id = 'avatars');

create policy avatars_objects_insert_own_or_admin
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'avatars'
        and (public.is_admin() or (storage.foldername(name))[1] = (select auth.uid())::text)
    );

create policy avatars_obejects_update_own_or_admin
    on storage.objects for update to authenticated
    using (
        bucket_id = 'avatars'
        and (public.is_admin() or (storage.foldername(name))[1] = (select auth.uid())::text)
    )
    with check (
        bucket_id = 'avatars'
        and (public.is_admin() or (storage.foldername(name))[1] = (select auth.uid())::text)
    );

create policy avatars_obejects_delete_own_ora_admin
    on storage.objects for delete to authenticated
    using (
        bucket_id = 'avatars'
        and (public.is_admin() or (storage.foldername(name))[1] = (select auth.uid())::text)
    )