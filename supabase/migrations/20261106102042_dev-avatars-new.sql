-- MANUAL SETUP ONLY: review and run in the intended project's Supabase SQL editor.
-- No application code executes this script. Public means avatars can be read by anyone.
-- Existing differently named policies are NOT removed: audit them for broader grants,
-- since permissive RLS policies are ORed together.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('developer-avatars', 'developer-avatars', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Public URL reads bypass SELECT RLS; authenticated SDK operations still need it.
drop policy if exists "developer_avatars_owned_select" on storage.objects;
create policy "developer_avatars_owned_select" on storage.objects
for select to authenticated using (
    bucket_id = 'developer-avatars' and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "developer_avatars_owned_insert" on storage.objects;
create policy "developer_avatars_owned_insert" on storage.objects
for insert to authenticated with check (
    bucket_id = 'developer-avatars' and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "developer_avatars_owned_update" on storage.objects;
create policy "developer_avatars_owned_update" on storage.objects
for update to authenticated using (
    bucket_id = 'developer-avatars' and (storage.foldername(name))[1] = (select auth.uid()::text)
) with check (
    bucket_id = 'developer-avatars' and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "developer_avatars_owned_delete" on storage.objects;
create policy "developer_avatars_owned_delete" on storage.objects
for delete to authenticated using (
    bucket_id = 'developer-avatars' and (storage.foldername(name))[1] = (select auth.uid()::text)
);

commit;
