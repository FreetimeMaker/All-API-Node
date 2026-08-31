const { getSupabaseClient } = require('./supabase');

// Metaplex/umi/@solana/bs58/nacl/jsonwebtoken sind in einem vorab gebündelten,
// vollständig selbstenthaltenen CJS-File (esbuild). So muss Vercels Rolldown-
// Builder in Production keine (teils ESM-only) Transitivabhängigkeiten auflösen,
// was ein Stubbing der Module verursacht.
const arcadeGlue = require('./arcade-glue');
const { Keypair, PublicKey, Connection } = arcadeGlue.web3;
const bs58Decode = arcadeGlue.bs58;
const nacl = arcadeGlue.nacl;
const jwt = arcadeGlue.jwt;

const RPC_URL = process.env.SOLANA_RPC_URL
    || process.env.NEXT_PUBLIC_SOLANA_RPC_URL
    || 'https://api.mainnet-beta.solana.com';

const MINT_PRIVATE_KEY = process.env.MINT_PRIVATE_KEY || '';
const RECIPIENT = process.env.ARCADE_RECIPIENT
    || process.env.NEXT_PUBLIC_SOLANA_RECIPIENT
    || '';
const JWT_SECRET = process.env.ARCADE_JWT_SECRET || '';
const ADMIN_TOKEN = process.env.ARCADE_ADMIN_TOKEN || '';
const ASSET_BASE = process.env.ARCADE_ASSET_BASE || 'https://free-time.me/sol-arcade';

const ARCADE_PRICE_LAMPORTS = 0.05 * 1e9; // 0.05 SOL
const TOTAL_PLAYS = 3; // number of arcades available
const PLAYS_LIMIT = parseInt(process.env.ARCADE_PLAYS_LIMIT || '10', 10); // game starts per pass

const JWT_TTL = '24h';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function buildChallengeMessage(wallet) {
    const nonce = crypto.randomUUID();
    return {
        nonce,
        message: `Sol Arcade — Sign in\nWallet: ${wallet}\nNonce: ${nonce}\nIssued: ${Date.now()}`,
    };
}

// Stateless check: the signed message already embeds nonce + Issued timestamp,
// so freshness/ownership can be verified without a shared in-memory map
// (which does not survive Vercel's serverless instance reuse/rotation).
function isValidChallenge(message, wallet) {
    const m = /^Sol Arcade — Sign in\nWallet: ([1-9A-HJ-NP-Za-km-z]{32,44})\nNonce: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\nIssued: (\d+)$/.exec(message || '');
    if (!m || m[1] !== wallet) return false;
    const issued = Number(m[3]);
    if (!Number.isFinite(issued)) return false;
    return Date.now() - issued <= CHALLENGE_TTL_MS;
}

function verifyWalletSignature(message, signatureB64, wallet) {
    try {
        const pub = new PublicKey(wallet);
        const signature = Uint8Array.from(Buffer.from(signatureB64, 'base64'));
        const messageBytes = Uint8Array.from(Buffer.from(message, 'utf8'));
        return nacl.sign.detached.verify(messageBytes, signature, pub.toBytes());
    } catch (e) {
        console.error('Signature verify error:', e.message);
        return false;
    }
}

function signJwt(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_TTL });
}

function authRequired(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token || !JWT_SECRET) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Valid session required.' });
    }
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        req.wallet = payload.wallet;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Session expired.' });
    }
}

function requireAdmin(req, res, next) {
    const token = req.headers['x-admin-token'] || '';
    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
        return res.status(403).json({ error: 'Forbidden', message: 'Admin token required.' });
    }
    next();
}

function getConnection() {
    return new Connection(RPC_URL, 'confirmed');
}

function getPayerSigner(umi) {
    if (!MINT_PRIVATE_KEY) return null;
    try {
        const secret = bs58Decode(MINT_PRIVATE_KEY);
        const keypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secret));
        return arcadeGlue.createSignerFromKeypair(umi, keypair);
    } catch (e) {
        console.error('MINT_PRIVATE_KEY invalid:', e.message);
        return null;
    }
}

function getPayerPublicKey() {
    if (!MINT_PRIVATE_KEY) return null;
    try {
        return new PublicKey(bs58Decode(MINT_PRIVATE_KEY).slice(0, 32)).toBase58();
    } catch (e) {
        return null;
    }
}

function getUmi() {
    return arcadeGlue.createUmi(RPC_URL);
}

async function getConfigRow() {
    const client = getSupabaseClient();
    if (!client) return null;
    const { data } = await client.from('arcade_config').select('*').eq('key', 'tree').maybeSingle();
    return data || null;
}

async function getMerkleTree() {
    const row = await getConfigRow();
    if (!row?.value?.tree) return null;
    try {
        return arcadeGlue.publicKey(row.value.tree);
    } catch (e) {
        return null;
    }
}

async function setMerkleTree(tree) {
    const client = getSupabaseClient();
    if (!client) return false;
    const { error } = await client
        .from('arcade_config')
        .upsert({ key: 'tree', value: { tree: tree.toString(), created_by: getPayerPublicKey() } });
    return !error;
}

async function getPass(wallet) {
    const client = getSupabaseClient();
    if (!client) return null;
    const { data } = await client.from('arcade_passes').select('*').eq('wallet', wallet).maybeSingle();
    return data || null;
}

async function createMerkleTree() {
    const umi = getUmi();
    const payerSigner = getPayerSigner(umi);
    if (!payerSigner) {
        throw new Error('MINT_PRIVATE_KEY (Merkle-Tree-Payer) is not configured.');
    }

    const maxDepth = 10;
    const maxBufferSize = 64;
    const tree = arcadeGlue.createTree(umi, {
        payer: payerSigner,
        maxDepth,
        maxBufferSize,
    });

    await tree.sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });
    return tree.publicKey;
}

async function findAssetId(umi, tree, leafOwner) {
    // Best-effort: use Helius DAS getAssetsByOwner, otherwise return null.
    try {
        const resp = await fetch(RPC_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getAssetsByOwner',
                params: [{ owner: leafOwner.toString(), page: 1, perPage: 100 }],
            }),
        }).then(r => r.json());
        const assets = resp?.result?.items || [];
        const treeStr = tree.toString();
        const match = assets.find(a => a?.compression?.tree === treeStr);
        return match?.id || null;
    } catch (e) {
        return null;
    }
}

async function mintPass(umi, payerSigner, tree, leafOwner, saleSignature) {
    const result = await arcadeGlue.mintV1(umi, {
        leafOwner,
        merkleTree: tree,
        metadata: {
            name: 'Arcade Pass',
            symbol: 'ARC',
            uri: `${ASSET_BASE}/arcade-pass.json`,
            sellerFeeBasisPoints: 500,
            creators: [{ address: payerSigner.publicKey, verified: true, share: 100 }],
        },
    }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });

    // Wait a beat for indexers, then try to resolve the asset id.
    await new Promise(resolve => setTimeout(resolve, 4000));
    const assetId = await findAssetId(umi, tree, leafOwner);

    return { signature: result.signature, assetId };
}

async function verifyPaymentTransaction(signature, buyer, recipient) {
    const connection = getConnection();
    const parsed = await connection.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
    });
    if (!parsed || parsed.meta?.err) return false;

    const feePayer = parsed.transaction.message.accountKeys[0]?.pubkey?.toBase58();
    if (feePayer !== buyer) return false;

    const accounts = parsed.transaction.message.accountKeys.map(k => k.pubkey.toBase58());
    if (!accounts.includes(recipient)) return false;

    const visitedInstructions = parsed.transaction.message.instructions || [];
    let found = false;
    const inspect = (ix) => {
        const { program, parsed, accounts: ixAccounts } = ix;
        if (program !== 'system' || parsed?.type !== 'transfer') return;
        const dest = ixAccounts?.[1];
        const lamports = parsed?.info?.lamports;
        if (dest === recipient && lamports === ARCADE_PRICE_LAMPORTS) found = true;
    };
    const walk = async (ixs) => {
        for (const ix of ixs) {
            inspect(ix);
            const inner = ix.instructions || [];
            if (inner.length) await walk(inner);
        }
    };
    await walk(visitedInstructions);
    return found;
}

module.exports = {
    RPC_URL,
    RECIPIENT,
    MINT_PRIVATE_KEY,
    JWT_SECRET,
    ADMIN_TOKEN,
    ASSET_BASE,
    ARCADE_PRICE_LAMPORTS,
    TOTAL_PLAYS,
    PLAYS_LIMIT,
    buildChallengeMessage,
    isValidChallenge,
    verifyWalletSignature,
    signJwt,
    authRequired,
    requireAdmin,
    getConnection,
    getUmi,
    getPayerSigner,
    getPayerPublicKey,
    createMerkleTree,
    getMerkleTree,
    setMerkleTree,
    getPass,
    mintPass,
    verifyPaymentTransaction,
};