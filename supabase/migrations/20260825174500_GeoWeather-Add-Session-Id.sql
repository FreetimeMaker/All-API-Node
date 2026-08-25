-- Add session_id column for anonymous users
ALTER TABLE public.geoweather_subscriptions
ADD COLUMN IF NOT EXISTS session_id TEXT;

-- Allow either user_id or session_id (but not both null)
ALTER TABLE public.geoweather_subscriptions
ADD CONSTRAINT geoweather_subscriptions_identity_check
CHECK (user_id IS NOT NULL OR session_id IS NOT NULL);

-- Drop old policies that require authentication
DROP POLICY IF EXISTS "Allow users to read their own subscriptions" ON public.geoweather_subscriptions;
DROP POLICY IF EXISTS "Allow users to create their own subscriptions" ON public.geoweather_subscriptions;
DROP POLICY IF EXISTS "Allow users to update their own subscriptions" ON public.geoweather_subscriptions;
DROP POLICY IF EXISTS "Allow users to delete their own subscriptions" ON public.geoweather_subscriptions;

-- Policies for authenticated users (own subscriptions via user_id)
CREATE POLICY "Allow users to read their own subscriptions"
ON public.geoweather_subscriptions FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Allow users to create their own subscriptions"
ON public.geoweather_subscriptions FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow users to update their own subscriptions"
ON public.geoweather_subscriptions FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Allow users to delete their own subscriptions"
ON public.geoweather_subscriptions FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Policies for anonymous users (session-based access)
CREATE POLICY "Allow anon to read by session"
ON public.geoweather_subscriptions FOR SELECT
TO anon
USING (session_id IS NOT NULL);

CREATE POLICY "Allow anon to insert by session"
ON public.geoweather_subscriptions FOR INSERT
TO anon
WITH CHECK (session_id IS NOT NULL AND user_id IS NULL);

CREATE POLICY "Allow anon to update by session"
ON public.geoweather_subscriptions FOR UPDATE
TO anon
USING (session_id IS NOT NULL AND user_id IS NULL);

CREATE POLICY "Allow anon to delete by session"
ON public.geoweather_subscriptions FOR DELETE
TO anon
USING (session_id IS NOT NULL AND user_id IS NULL);

-- Service role bypass
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE policyname = 'Service role full access'
        AND tablename = 'geoweather_subscriptions'
    ) THEN
        CREATE POLICY "Service role full access"
        ON public.geoweather_subscriptions
        TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;
END $$;
