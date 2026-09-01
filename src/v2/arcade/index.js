const express = require('express');
const router = express.Router();
const {
    RECIPIENT,
    ARCADE_PRICE_LAMPORTS,
    TOTAL_PLAYS,
    PLAYS_LIMIT,
    buildChallengeMessage,
    isValidChallenge,
    verifyWalletSignature,
    signJwt,
    authRequired,
    requireAdmin,
    getUmi,
    getPayerSigner,
    getPayerPublicKey,
    createMerkleTree,
    getMerkleTree,
    setMerkleTree,
    getPass,
    mintPass,
    verifyPaymentTransaction,
    MINT_PRIVATE_KEY,
    JWT_SECRET,
} = require('../../lib/arcade');
const { getSupabaseClient } = require('../../lib/supabase');
const { publicKey } = require('@metaplex-foundation/umi');

// GET /api/v1/arcade — service info
router.get('/', (req, res) => {
    res.json({
        version: '1.0.0',
        price: { sol: 0.05, lamports: ARCADE_PRICE_LAMPORTS },
        recipient: RECIPIENT || null,
        arcades: TOTAL_PLAYS,
        plays_limit: PLAYS_LIMIT,
        configured: {
            rpc: !!process.env.SOLANA_RPC_URL || !!process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
            payer: !!MINT_PRIVATE_KEY,
            jwt: !!JWT_SECRET,
        },
    });
});

// GET /challenge — wallet sign-in challenge
router.get('/challenge', (req, res) => {
    const wallet = String(req.query.wallet || '').trim();
    if (!wallet || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
        return res.status(400).json({ error: 'Bad Request', message: 'Valid wallet address required.' });
    }
    res.json(buildChallengeMessage(wallet));
});

// POST /login — verify signature, create session
router.post('/login', async (req, res) => {
    try {
        const { wallet, nonce, message, signature } = req.body || {};
        if (!wallet || !nonce || !message || !signature) {
            return res.status(400).json({ error: 'Bad Request', message: 'wallet, nonce, message and signature are required.' });
        }
        const expected = isValidChallenge(message, wallet);
        if (!expected) {
            return res.status(401).json({ error: 'Unauthorized', message: 'Challenge invalid or expired.' });
        }
        if (!verifyWalletSignature(message, signature, wallet)) {
            return res.status(401).json({ error: 'Unauthorized', message: 'Signature verification failed.' });
        }

        const client = getSupabaseClient();
        let pass = null;
        if (client) {
            await client.from('arcade_users').upsert({ wallet, last_login_at: new Date().toISOString() }, { onConflict: 'wallet' });
            pass = await getPass(wallet);
        }

        const token = signJwt({ wallet });
        res.json({ token, wallet, pass });
    } catch (e) {
        console.error('arcade login error:', e.message);
        res.status(500).json({ error: 'Server error', details: e.message });
    }
});

// GET /me — session + pass status
router.get('/me', authRequired, async (req, res) => {
    try {
        if (!JWT_SECRET) {
            return res.status(503).json({ error: 'Setup required', message: 'ARCADE_JWT_SECRET is not configured.' });
        }
        const pass = await getPass(req.wallet);
        res.json({
            wallet: req.wallet,
            pass,
            plays_limit: PLAYS_LIMIT,
            configured: {
                payer: !!MINT_PRIVATE_KEY,
                tree: !!(pass || null) || !!(await getMerkleTree()),
            },
        });
    } catch (e) {
        res.status(500).json({ error: 'Server error', details: e.message });
    }
});

// POST /pass/session — create a pending payment for the next mint
router.post('/pass/session', authRequired, async (req, res) => {
    try {
        const existing = await getPass(req.wallet);
        if (existing) {
            return res.status(409).json({ error: 'Conflict', message: 'Pass already owned.', pass: existing });
        }
        if (!RECIPIENT) {
            return res.status(503).json({ error: 'Setup required', message: 'ARCADE_RECIPIENT is not configured.' });
        }
        const client = getSupabaseClient();
        if (!client) return res.status(503).json({ error: 'Setup required', message: 'Supabase is not configured.' });

        const sessionId = crypto.randomUUID();
        const { error } = await client.from('arcade_payments').insert({
            id: sessionId,
            wallet: req.wallet,
            amount_lamports: ARCADE_PRICE_LAMPORTS,
            status: 'pending',
            expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        });
        if (error) throw error;

        res.json({
            session_id: sessionId,
            amount_lamports: ARCADE_PRICE_LAMPORTS,
            amount_sol: '0.05',
            recipient: RECIPIENT,
            expires_in_seconds: 15 * 60,
        });
    } catch (e) {
        console.error('arcade session error:', e.message);
        res.status(500).json({ error: 'Server error', details: e.message });
    }
});

// POST /pass/confirm — verify on-chain transfer, then mint the cNFT
router.post('/pass/confirm', authRequired, async (req, res) => {
    const { session_id, signature } = req.body || {};
    if (!session_id || !signature) {
        return res.status(400).json({ error: 'Bad Request', message: 'session_id and signature are required.' });
    }

    try {
        const client = getSupabaseClient();
        if (!client) return res.status(503).json({ error: 'Setup required', message: 'Supabase is not configured.' });

        // Existing pass? Idempotent success.
        const existing = await getPass(req.wallet);
        if (existing) {
            return res.json({ ok: true, already_owned: true, pass: existing });
        }

        // Payment row lookup.
        const { data: payRows } = await client.from('arcade_payments').select('*').eq('id', session_id);
        const payment = payRows?.[0];
        if (!payment || payment.wallet !== req.wallet) {
            return res.status(404).json({ error: 'Not found', message: 'Payment session not found.' });
        }
        if (Date.now() > Date.parse(payment.expires_at)) {
            return res.status(410).json({ error: 'Expired', message: 'Payment session expired. Start a new one.' });
        }
        if (payment.status === 'success') {
            return res.status(409).json({ error: 'Conflict', message: 'Payment already used.' });
        }

        // Dedupe by signature.
        const { data: usedSig } = await client.from('arcade_payments').select('id').eq('signature', signature);
        if (usedSig?.length) {
            return res.status(409).json({ error: 'Conflict', message: 'Transfer already used.' });
        }

        // Verify on-chain transfer to our recipient for the exact amount.
        const valid = await verifyPaymentTransaction(signature, req.wallet, RECIPIENT);
        if (!valid) {
            return res.status(422).json({ error: 'Unverified', message: 'On-chain transfer not verified for this session.' });
        }

        const { error: markError } = await client
            .from('arcade_payments')
            .update({ status: 'paid', signature, paid_at: new Date().toISOString() })
            .eq('id', session_id);
        if (markError) throw markError;

        // Mint the cNFT.
        const umi = getUmi();
        const payerSigner = getPayerSigner(umi);
        if (!payerSigner) {
            return res.status(503).json({ error: 'Setup required', message: 'MINT_PRIVATE_KEY not configured — cannot mint.' });
        }
        let tree = await getMerkleTree();
        if (!tree) {
            return res.status(503).json({ error: 'Setup required', message: 'Merkle tree not created. Run the /setup endpoint first.' });
        }

        const leafOwner = publicKey(req.wallet);
        const { signature: mintSig, assetId } = await mintPass(umi, payerSigner, tree, leafOwner, signature);

        const { error: passError } = await client.from('arcade_passes').insert({
            wallet: req.wallet,
            asset_id: assetId,
            mint_signature: mintSig,
            purchase_payment: signature,
            created_at: new Date().toISOString(),
        });
        if (passError) {
            console.error('pass insert error:', passError.message);
        }
        await client.from('arcade_payments').update({ status: 'done' }).eq('id', session_id);

        res.json({ ok: true, pass: { wallet: req.wallet, asset_id: assetId, mint_signature: mintSig } });
    } catch (e) {
        console.error('arcade confirm error:', e.message);
        res.status(500).json({ error: 'Server error', details: e.message, hint: 'Payment may have succeeded — retry confirm to re-mint.' });
    }
});

// POST /setup — create the Merkle tree (admin)
router.post('/setup', requireAdmin, async (req, res) => {
    try {
        const existing = await getMerkleTree();
        if (existing) {
            return res.json({ ok: true, tree: existing.toString(), created: false });
        }
        const tree = await createMerkleTree();
        await setMerkleTree(tree);
        res.json({ ok: true, tree: tree.toString(), created: true, payer: getPayerPublicKey() });
    } catch (e) {
        console.error('arcade setup error:', e.message);
        res.status(500).json({ error: 'Setup failed', details: e.message });
    }
});

// POST /play/start — consume one game start; at the limit the pass disappears
router.post('/play/start', authRequired, async (req, res) => {
    try {
        const client = getSupabaseClient();
        if (!client) return res.status(503).json({ error: 'Setup required', message: 'Supabase is not configured.' });

        const pass = await getPass(req.wallet);
        if (!pass) {
            return res.status(403).json({ error: 'Forbidden', message: 'Arcade Pass required.' });
        }

        const used = (pass.plays_used || 0) + 1;
        if (used >= PLAYS_LIMIT) {
            const { error } = await client.from('arcade_passes').delete().eq('wallet', req.wallet);
            if (error) throw error;
            return res.json({ ok: true, plays_left: 0, consumed: true, pass: null });
        }

        const { error } = await client.from('arcade_passes').update({ plays_used: used }).eq('wallet', req.wallet);
        if (error) throw error;
        return res.json({ ok: true, plays_left: PLAYS_LIMIT - used, consumed: false });
    } catch (e) {
        console.error('arcade play/start error:', e.message);
        res.status(500).json({ error: 'Server error', details: e.message });
    }
});

// POST /play — record a high score for an arcade
router.post('/play', authRequired, async (req, res) => {
    try {
        const { game, score } = req.body || {};
        if (!game || typeof score !== 'number') {
            return res.status(400).json({ error: 'Bad Request', message: 'game and score are required.' });
        }
        const pass = await getPass(req.wallet);
        if (!pass) {
            return res.status(403).json({ error: 'Forbidden', message: 'Arcade Pass required.' });
        }
        const client = getSupabaseClient();
        if (!client) return res.status(503).json({ error: 'Setup required', message: 'Supabase is not configured.' });

        const { data: existing } = await client
            .from('arcade_scores')
            .select('score')
            .eq('wallet', req.wallet)
            .eq('game', game)
            .maybeSingle();

        if (existing && score <= existing.score) {
            return res.json({ ok: true, best: existing.score, new_high: false });
        }

        const { error } = await client.from('arcade_scores').upsert(
            { wallet: req.wallet, game, score, created_at: new Date().toISOString() },
            { onConflict: 'wallet,game' }
        );
        if (error) throw error;
        res.json({ ok: true, best: score, new_high: true });
    } catch (e) {
        res.status(500).json({ error: 'Server error', details: e.message });
    }
});

// GET /scores — current user best scores
router.get('/scores', authRequired, async (req, res) => {
    try {
        const client = getSupabaseClient();
        if (!client) return res.status(503).json({ error: 'Setup required', message: 'Supabase is not configured.' });
        const { data } = await client.from('arcade_scores').select('*').eq('wallet', req.wallet).order('score', { ascending: false });
        res.json({ scores: data || [] });
    } catch (e) {
        res.status(500).json({ error: 'Server error', details: e.message });
    }
});

module.exports = router;