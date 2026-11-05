-- Run manually in the Supabase SQL editor as the project administrator.
-- Developer avatars are intentionally public: the Android app stores public URLs.
-- This script does not change profile-table policies or remove other storage policies.
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'developer-avatars',
    'developer-avatars',
    true,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Upserting an existing avatar requires SELECT and UPDATE as well as INSERT.
-- All writes are restricted to the authenticated user's own top-level folder.
DROP POLICY IF EXISTS "luma_avatar_select_own" ON storage.objects;
CREATE POLICY "luma_avatar_select_own" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'developer-avatars'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    );

DROP POLICY IF EXISTS "luma_avatar_insert_own" ON storage.objects;
CREATE POLICY "luma_avatar_insert_own" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'developer-avatars'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    );

DROP POLICY IF EXISTS "luma_avatar_update_own" ON storage.objects;
CREATE POLICY "luma_avatar_update_own" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
        bucket_id = 'developer-avatars'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    )
    WITH CHECK (
        bucket_id = 'developer-avatars'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    );

COMMIT;
