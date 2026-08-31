-- Arcade: compressed NFT passthrough payments, users, passes, high scores
-- Manually run via Supabase SQL editor, or apply as a migration.

-- Wallet users (wallet address is the primary key)
CREATE TABLE IF NOT EXISTS public.arcade_users (
    wallet TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ DEFAULT NOW()
);

-- One pass per wallet, once minted the wallet can play all arcades
CREATE TABLE IF NOT EXISTS public.arcade_passes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet TEXT NOT NULL UNIQUE REFERENCES public.arcade_users(wallet) ON DELETE CASCADE,
    asset_id TEXT,
    mint_signature TEXT,
    purchase_payment TEXT,
    plays_used INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- A payment session -> on-chain transfer -> done
CREATE TABLE IF NOT EXISTS public.arcade_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet TEXT NOT NULL REFERENCES public.arcade_users(wallet) ON DELETE CASCADE,
    amount_lamports BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | done | failed
    signature TEXT UNIQUE,
    paid_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Key/value config (e.g. merkle tree public key)
CREATE TABLE IF NOT EXISTS public.arcade_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- High scores
CREATE TABLE IF NOT EXISTS public.arcade_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet TEXT NOT NULL REFERENCES public.arcade_users(wallet) ON DELETE CASCADE,
    game TEXT NOT NULL,
    score BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (wallet, game)
);

-- RLS is enabled, but access is fully open: the API layer owns validation
-- (JWT session + on-chain signature checks) and runs with the anon key.
ALTER TABLE public.arcade_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "arcade_users_anon_all" ON public.arcade_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "arcade_passes_anon_all" ON public.arcade_passes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "arcade_payments_anon_all" ON public.arcade_payments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "arcade_config_anon_all" ON public.arcade_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "arcade_scores_anon_all" ON public.arcade_scores FOR ALL USING (true) WITH CHECK (true);