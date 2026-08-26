CREATE TABLE IF NOT EXISTS public.geoweather_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('free', 'freemium', 'premium', 'ultrimium')),
    is_used BOOLEAN DEFAULT false,
    used_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.geoweather_codes ENABLE ROW LEVEL SECURITY;

-- Only service role can access codes (admin operations)
CREATE POLICY "Service role full access"
ON public.geoweather_codes
TO service_role
USING (true)
WITH CHECK (true);

-- Authenticated users can read codes (to validate)
CREATE POLICY "Allow users to read codes"
ON public.geoweather_codes FOR SELECT
TO authenticated
USING (true);

-- Authenticated users can update (to mark as used)
CREATE POLICY "Allow users to update codes"
ON public.geoweather_codes FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);
