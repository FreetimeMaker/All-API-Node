CREATE TABLE IF NOT EXISTS public.geoweather_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    location TEXT NOT NULL,
    coordinates JSONB,
    type TEXT NOT NULL DEFAULT 'daily' CHECK (type IN ('daily', 'hourly', 'alerts')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.geoweather_subscriptions ENABLE ROW LEVEL SECURITY;

-- Policies for geoweather_subscriptions
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
