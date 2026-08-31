-- Arcade: limited plays per pass.
-- Each game start consumes a play; once plays_used reaches the configured
-- limit (ARCADE_PLAYS_LIMIT), the pass is consumed and removed.
-- Run manually via Supabase SQL editor, or apply as a migration.

ALTER TABLE public.arcade_passes ADD COLUMN IF NOT EXISTS plays_used INTEGER NOT NULL DEFAULT 0;