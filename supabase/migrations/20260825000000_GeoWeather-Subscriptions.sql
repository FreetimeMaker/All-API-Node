CREATE TABLE IF NOT EXISTS public.geoweather_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id TEXT,
    location TEXT NOT NULL,
    coordinates JSONB,
    type TEXT NOT NULL DEFAULT 'daily' CHECK (type IN ('daily', 'hourly', 'alerts')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (user_id IS NOT NULL OR session_id IS NOT NULL)
);

-- Enable Row Level Security
ALTER TABLE public.geoweather_subscriptions ENABLE ROW LEVEL SECURITY;

-- Policies for authenticated users (own subscriptions)
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

-- Policies for anonymous users (session-based)
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

-- Service role bypass (for server-side operations)
CREATE POLICY "Service role full access"
ON public.geoweather_subscriptions
TO service_role
USING (true)
WITH CHECK (true);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_geoweather_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'update_geoweather_subscriptions_updated_at'
    ) THEN
        CREATE TRIGGER update_geoweather_subscriptions_updated_at
        BEFORE UPDATE ON public.geoweather_subscriptions
        FOR EACH ROW
        EXECUTE PROCEDURE update_geoweather_subscriptions_updated_at();
    END IF;
END $$;
