-- Fix type check constraint to allow tier types
ALTER TABLE public.geoweather_subscriptions
DROP CONSTRAINT IF EXISTS geoweather_subscriptions_type_check;

ALTER TABLE public.geoweather_subscriptions
ALTER COLUMN type DROP DEFAULT;

ALTER TABLE public.geoweather_subscriptions
ADD CONSTRAINT geoweather_subscriptions_type_check
CHECK (type IN ('free', 'freemium', 'premium', 'ultrimium'));

-- Backfill: Create subscriptions for already-redeemed codes that have no subscription yet
INSERT INTO public.geoweather_subscriptions (user_id, location, type, redeemed_code_id, is_active)
SELECT
    c.used_by,
    'default',
    c.type,
    c.id,
    true
FROM public.geoweather_codes c
WHERE c.is_used = true
  AND c.used_by IS NOT NULL
  AND c.type != 'free'
  AND NOT EXISTS (
    SELECT 1
    FROM public.geoweather_subscriptions s
    WHERE s.user_id = c.used_by
      AND s.redeemed_code_id = c.id
  );
