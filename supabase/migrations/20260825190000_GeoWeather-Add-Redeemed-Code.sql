ALTER TABLE public.geoweather_subscriptions
ADD COLUMN IF NOT EXISTS redeemed_code_id UUID REFERENCES public.geoweather_codes(id) ON DELETE SET NULL;
