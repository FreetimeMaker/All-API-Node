const express = require('express');
const crypto = require('node:crypto');
const axios = require('axios');
const router = express.Router();
const { getLumaStoreSupabaseClient, getLumaStoreAuthenticatedUser } = require('../../lib/supabase');
const { getConnection } = require('../../lib/arcade');
const { catalogEntries, catalogEntry } = require('./crypto-catalog');

const PAYMENT_TTL_MS = 15 * 60 * 1000;

async function resolveApp(client, packageName) {
    const { data, error } = await client.from('store_apps')
        .select('id,package_name,name,developer_id')
        .eq('package_name', packageName)
        .is('archived_at', null)
        .maybeSingle();
    if (error) throw error;
    if (!data) {
        const e = new Error('App not found');
        e.status = 404;
        e.code = 'APP_NOT_FOUND';
        throw e;
    }
    return data;
}

function price(row) {
    return row.price_amount_minor == null ? null : {
        amountMinor: Number(row.price_amount_minor),
        currency: row.currency
    };
}

function product(row) {
    return {
        id: row.product_id,
        title: row.title,
        description: row.description || null,
        type: row.product_type,
        price: price(row),
        suggestedPrice: row.suggested_amount_minor == null ? null : {
            amountMinor: Number(row.suggested_amount_minor), currency: row.currency
        },
        minimumPrice: row.minimum_amount_minor == null ? null : {
            amountMinor: Number(row.minimum_amount_minor), currency: row.currency
        },
        billingPeriod: row.billing_period || null
    };
}

function purchase(row, packageName) {
    return {
        transactionId: row.id,
        productId: row.product_id,
        packageName,
        status: row.status,
        purchasedAtEpochMillis: Date.parse(row.purchased_at || row.created_at),
        receipt: row.receipt || '',
        signature: row.receipt_signature || '',
        expiresAtEpochMillis: row.expires_at ? Date.parse(row.expires_at) : null
    };
}

async function resolveDeveloperCrypto(client, developerId) {
    if (!developerId) return { addresses: {}, settlementAsset: null };
    const { data, error } = await client.from('luma_developer_funding')
        .select('crypto_addresses,billing_settlement_asset').eq('developer_id', developerId).maybeSingle();
    if (error) throw error;
    return { addresses: data?.crypto_addresses || {}, settlementAsset: data?.billing_settlement_asset || null };
}

async function resolveDeveloperSolanaRecipient(client, developerId) {
    if (!developerId) return null;
    const { data, error } = await client.from('luma_developer_funding')
        .select('crypto_addresses').eq('developer_id', developerId).maybeSingle();
    if (error) throw error;
    const addresses = data?.crypto_addresses || {};
    return addresses['solana::Solana'] || addresses.solana || null;
}

async function verifySolTransfer(signature, recipient, lamports) {
    const parsed = await getConnection().getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
    });
    if (!parsed || parsed.meta?.err) return false;
    for (const ix of parsed.transaction.message.instructions || []) {
        if (ix.program !== 'system' || ix.parsed?.type !== 'transfer') continue;
        const info = ix.parsed?.info || {};
        if (info.destination === recipient && Number(info.lamports) === Number(lamports)) return true;
    }
    return false;
}

async function verifyUtxoTransfer(chain, txid, recipient, amountAtomic) {
    const defaults = {
        BITCOIN: process.env.BITCOIN_EXPLORER_API || 'https://blockstream.info/api',
        LITECOIN: process.env.LITECOIN_EXPLORER_API || 'https://litecoinspace.org/api',
        DOGECOIN: process.env.DOGECOIN_EXPLORER_API,
        BITCOIN_CASH: process.env.BITCOIN_CASH_EXPLORER_API
    };
    const base = defaults[chain];
    if (!base) throw Object.assign(new Error(chain + ' explorer API is not configured'), { status: 503, code: 'CHAIN_VERIFIER_NOT_CONFIGURED' });
    const { data: tx } = await axios.get(base + '/tx/' + encodeURIComponent(txid), { timeout: 15000 });
    if (!tx?.status?.confirmed) return false;
    return (tx.vout || []).some(out => out.scriptpubkey_address === recipient && Number(out.value) === Number(amountAtomic));
}

async function verifySplTransfer(signature, recipientOwner, mint, amountAtomic) {
    const parsed = await getConnection().getParsedTransaction(signature, {
        commitment: 'confirmed', maxSupportedTransactionVersion: 0
    });
    if (!parsed || parsed.meta?.err) return false;
    const keys = parsed.transaction.message.accountKeys || [];
    const ownerByTokenAccount = new Map();
    const mintByTokenAccount = new Map();
    for (const balance of [...(parsed.meta?.preTokenBalances || []), ...(parsed.meta?.postTokenBalances || [])]) {
        const key = keys[balance.accountIndex];
        const pubkey = typeof key === 'string' ? key : key?.pubkey?.toString?.();
        if (pubkey) {
            ownerByTokenAccount.set(pubkey, balance.owner);
            mintByTokenAccount.set(pubkey, balance.mint);
        }
    }
    for (const ix of parsed.transaction.message.instructions || []) {
        if (ix.program !== 'spl-token' || !['transfer','transferChecked'].includes(ix.parsed?.type)) continue;
        const info = ix.parsed?.info || {};
        const destination = String(info.destination || '');
        const amount = Number(info.amount ?? info.tokenAmount?.amount);
        if (ownerByTokenAccount.get(destination) === recipientOwner &&
            mintByTokenAccount.get(destination) === mint && amount === Number(amountAtomic)) return true;
    }
    return false;
}

async function verifyStellarTransfer(txid, recipient, amountAtomic) {
    const base = process.env.STELLAR_HORIZON_URL || 'https://horizon.stellar.org';
    const { data: tx } = await axios.get(base + '/transactions/' + encodeURIComponent(txid), { timeout: 15000 });
    if (!tx?.successful) return false;
    const { data: ops } = await axios.get(base + '/transactions/' + encodeURIComponent(txid) + '/operations', { timeout: 15000 });
    return (ops?._embedded?.records || []).some(op => op.type === 'payment' && op.asset_type === 'native' &&
        op.to === recipient && BigInt(Math.round(Number(op.amount) * 1e7)) === BigInt(String(amountAtomic)));
}

async function verifyMoneroTransfer(txid, recipient, amountAtomic, proof) {
    const rpc = process.env.MONERO_WALLET_RPC_URL;
    if (!rpc) throw Object.assign(new Error('MONERO_WALLET_RPC_URL is required for private Monero payment verification'), { status: 503, code: 'MONERO_VERIFIER_NOT_CONFIGURED' });
    if (!proof) throw Object.assign(new Error('Monero tx proof is required'), { status: 400, code: 'MONERO_TX_PROOF_REQUIRED' });
    const { data } = await axios.post(rpc + '/json_rpc', {
        jsonrpc: '2.0', id: '0', method: 'check_tx_proof',
        params: { txid, address: recipient, message: '', signature: proof }
    }, { timeout: 15000 });
    const r = data?.result;
    return Boolean(r?.good) && Number(r?.confirmations || 0) > 0 && BigInt(String(r?.received || 0)) === BigInt(String(amountAtomic));
}

async function evmRpc(network, method, params) {
    const envKey = 'EVM_' + network.toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_RPC_URL';
    const rpc = process.env[envKey];
    if (!rpc) throw Object.assign(new Error(envKey + ' is required'), { status: 503, code: 'CHAIN_VERIFIER_NOT_CONFIGURED' });
    const { data } = await axios.post(rpc, { jsonrpc: '2.0', id: 1, method, params }, { timeout: 15000 });
    if (data?.error) throw new Error(data.error.message || 'EVM RPC error');
    return data?.result;
}
function hexBigInt(v) { return BigInt(v || '0x0'); }
async function verifyEvmNative(network, txid, recipient, amountAtomic) {
    const tx = await evmRpc(network, 'eth_getTransactionByHash', [txid]);
    if (!tx || String(tx.to || '').toLowerCase() !== recipient.toLowerCase() || hexBigInt(tx.value) !== BigInt(String(amountAtomic))) return false;
    const receipt = await evmRpc(network, 'eth_getTransactionReceipt', [txid]);
    return receipt?.status === '0x1' && Boolean(receipt.blockNumber);
}
async function verifyEvmToken(network, txid, recipient, amountAtomic, contract) {
    if (!contract) throw Object.assign(new Error('Token contract is not configured'), { status: 503, code: 'TOKEN_NOT_CONFIGURED' });
    const receipt = await evmRpc(network, 'eth_getTransactionReceipt', [txid]);
    if (receipt?.status !== '0x1' || !receipt.blockNumber) return false;
    const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const recipientTopic = '0x' + recipient.toLowerCase().replace(/^0x/,'').padStart(64,'0');
    return (receipt.logs || []).some(log => String(log.address).toLowerCase() === contract.toLowerCase() &&
        log.topics?.[0]?.toLowerCase() === transferTopic && log.topics?.[2]?.toLowerCase() === recipientTopic &&
        hexBigInt(log.data) === BigInt(String(amountAtomic)));
}
async function verifyConfiguredRest(chain, txid, recipient, amountAtomic) {
    const envKey = chain + '_VERIFIER_API';
    const base = process.env[envKey];
    if (!base) throw Object.assign(new Error(envKey + ' is required'), { status: 503, code: 'CHAIN_VERIFIER_NOT_CONFIGURED' });
    const { data } = await axios.get(base, { params: { txid, recipient, amountAtomic: String(amountAtomic) }, timeout: 15000 });
    return data?.verified === true;
}

async function verifySettlementTransfer(statement, txid, proof = null) {
    const chain = String(statement.settlement_chain || '').toUpperCase();
    const asset = String(statement.settlement_asset || '').toUpperCase();
    const amount = statement.settlement_amount_atomic;
    const recipient = statement.settlement_recipient;
    if (chain === 'SOLANA' && asset === 'SOL') return verifySolTransfer(txid, recipient, amount);
    if (chain === 'BITCOIN' && asset === 'BTC') return verifyUtxoTransfer('BITCOIN', txid, recipient, amount);
    if (chain === 'LITECOIN' && asset === 'LTC') return verifyUtxoTransfer('LITECOIN', txid, recipient, amount);
    if (chain === 'DOGECOIN' && asset === 'DOGE') return verifyUtxoTransfer('DOGECOIN', txid, recipient, amount);
    if ((chain === 'BITCOIN CASH' || chain === 'BITCOIN_CASH') && asset === 'BCH') return verifyUtxoTransfer('BITCOIN_CASH', txid, recipient, amount);
    if (chain === 'STELLAR' && asset === 'XLM') return verifyStellarTransfer(txid, recipient, amount);
    if (chain === 'MONERO' && asset === 'XMR') return verifyMoneroTransfer(txid, recipient, amount, proof);
    const evmNetworks = new Set(['ETHEREUM','ETHEREUM (ERC-20)','BNB SMART CHAIN (BEP-20)','POLYGON','AVALANCHE C-CHAIN','ARBITRUM','OPTIMISM','BASE','SHIBARIUM']);
    if (evmNetworks.has(chain)) {
        const nativeByNetwork = { ETHEREUM:'ETH', 'BNB SMART CHAIN (BEP-20)':'BNB', POLYGON:'POL', 'AVALANCHE C-CHAIN':'AVAX' };
        if (nativeByNetwork[chain] === asset) return verifyEvmNative(chain, txid, recipient, amount);
        const contractKey = 'TOKEN_' + asset + '_' + chain.replace(/[^A-Z0-9]+/g,'_') + '_CONTRACT';
        return verifyEvmToken(chain, txid, recipient, amount, process.env[contractKey]);
    }
    if (['TRON','CARDANO','POLKADOT','AVALANCHE P-CHAIN','TON'].includes(chain)) {
        return verifyConfiguredRest(chain.replace(/[^A-Z0-9]+/g,'_'), txid, recipient, amount);
    }
    if (chain === 'SOLANA' && (asset === 'USDC' || asset === 'USDT')) {
        const mint = asset === 'USDC'
            ? (process.env.SOLANA_USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
            : process.env.SOLANA_USDT_MINT;
        if (!mint) throw Object.assign(new Error('Token mint is not configured'), { status: 503, code: 'TOKEN_NOT_CONFIGURED' });
        return verifySplTransfer(txid, recipient, mint, amount);
    }
    throw Object.assign(new Error('Settlement chain or asset is not supported'), { status: 400, code: 'UNSUPPORTED_SETTLEMENT_ASSET' });
}

async function feeForMonthlyAmount(client, amountMinor, currency) {
    const { data, error } = await client.from('luma_billing_fee_tiers').select('*')
        .eq('currency', currency).eq('active', true)
        .lte('min_monthly_amount_minor', amountMinor)
        .order('min_monthly_amount_minor', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!data || (data.max_monthly_amount_minor != null && amountMinor > Number(data.max_monthly_amount_minor))) {
        throw Object.assign(new Error('No fee tier configured for this amount'), { status: 500, code: 'FEE_TIER_MISSING' });
    }
    return {
        basisPoints: Number(data.fee_basis_points),
        amountMinor: Math.floor(Number(amountMinor) * Number(data.fee_basis_points) / 10000)
    };
}

async function assertDeveloperCanReceivePayments(client, developerId) {
    if (!developerId) return;
    const now = new Date().toISOString();
    const { data, error } = await client.from('luma_billing_monthly_statements')
        .select('id,period_start,period_end,fee_amount_minor,currency,due_at,status')
        .eq('developer_id', developerId)
        .eq('status', 'DUE')
        .not('due_at', 'is', null)
        .lte('due_at', now)
        .order('due_at', { ascending: true })
        .limit(1);
    if (error) throw error;
    if (data?.length) {
        const e = new Error('Developer billing is suspended until the overdue Luma fee is paid');
        e.status = 402;
        e.code = 'DEVELOPER_BILLING_SUSPENDED';
        e.statement = data[0];
        throw e;
    }
}

function fail(res, error, fallback = 'BILLING_ERROR') {
    const status = error.status || 500;
    return res.status(status).json({
        code: error.code || fallback,
        message: error.message || 'Billing request failed'
    });
}

router.get('/fees/tiers', async (req, res) => {
    try {
        await getLumaStoreAuthenticatedUser(req);
        const client = getLumaStoreSupabaseClient();
        const { data, error } = await client.from('luma_billing_fee_tiers').select('*')
            .eq('active', true).order('currency').order('min_monthly_amount_minor');
        if (error) throw error;
        res.json({ tiers: data || [] });
    } catch (error) {
        fail(res, error, 'FEE_TIERS_UNAVAILABLE');
    }
});

router.get('/fees/settlement', async (req, res) => {
    try {
        const { user, token } = await getLumaStoreAuthenticatedUser(req);
        const client = getLumaStoreSupabaseClient(token);
        const funding = await resolveDeveloperCrypto(client, user.id);
        const availableAssets = catalogEntries().map(entry => ({
            ...entry,
            configured: Boolean(funding.addresses[entry.id])
        }));
        res.json({ settlementAsset: funding.settlementAsset, availableAssets });
    } catch (error) {
        fail(res, error, 'SETTLEMENT_SETTINGS_UNAVAILABLE');
    }
});

router.put('/fees/settlement', async (req, res) => {
    try {
        const { user, token } = await getLumaStoreAuthenticatedUser(req);
        const client = getLumaStoreSupabaseClient(token);
        const asset = String(req.body?.asset || '').trim();
        const funding = await resolveDeveloperCrypto(client, user.id);
        const entry = catalogEntry(asset);
        if (!entry || !funding.addresses[asset]) return res.status(400).json({ code: 'UNSUPPORTED_SETTLEMENT_ASSET', message: 'Settlement asset/network must exist in Developer Funding and have a configured address' });
        const { error } = await client.from('luma_developer_funding').update({ billing_settlement_asset: asset }).eq('developer_id', user.id);
        if (error) throw error;
        res.json({ settlementAsset: asset });
    } catch (error) {
        fail(res, error, 'SETTLEMENT_SETTINGS_UPDATE_FAILED');
    }
});

router.post('/fees/monthly/:statementId/verify', async (req, res) => {
    try {
        const { user, token } = await getLumaStoreAuthenticatedUser(req);
        const client = getLumaStoreSupabaseClient(token);
        const txid = String(req.body?.chainTransactionId || '').trim();
        if (!txid) return res.status(400).json({ code: 'TRANSACTION_REQUIRED', message: 'chainTransactionId is required' });
        const { data: statement, error } = await client.from('luma_billing_monthly_statements').select('*')
            .eq('id', req.params.statementId).eq('developer_id', user.id).maybeSingle();
        if (error) throw error;
        if (!statement) return res.status(404).json({ code: 'STATEMENT_NOT_FOUND', message: 'Monthly statement not found' });
        if (statement.status === 'PAID') return res.json({ status: 'PAID', statement });
        if (!statement.settlement_asset || !statement.settlement_chain || !statement.settlement_recipient || statement.settlement_amount_atomic == null) {
            return res.status(409).json({ code: 'SETTLEMENT_QUOTE_REQUIRED', message: 'Statement has no settlement quote' });
        }
        if (statement.settlement_quote_expires_at && Date.now() > Date.parse(statement.settlement_quote_expires_at)) {
            return res.status(409).json({ code: 'SETTLEMENT_QUOTE_EXPIRED', message: 'Settlement quote has expired' });
        }
        const valid = await verifySettlementTransfer(statement, txid, req.body?.txProof || null);
        if (!valid) return res.status(422).json({ code: 'PAYMENT_NOT_VERIFIED', message: 'Settlement transaction could not be verified' });
        const now = new Date().toISOString();
        const { data: updated, error: updateError } = await client.from('luma_billing_monthly_statements')
            .update({ status: 'PAID', paid_at: now, settlement_transaction_id: txid, settlement_verified_at: now })
            .eq('id', statement.id).eq('developer_id', user.id).select('*').single();
        if (updateError) throw updateError;
        res.json({ status: 'PAID', statement: updated });
    } catch (error) {
        fail(res, error, 'SETTLEMENT_VERIFY_FAILED');
    }
});

router.get('/fees/monthly', async (req, res) => {
    try {
        const { user, token } = await getLumaStoreAuthenticatedUser(req);
        const client = getLumaStoreSupabaseClient(token);
        const { data, error } = await client.from('luma_billing_monthly_statements').select('*')
            .eq('developer_id', user.id).order('period_start', { ascending: false });
        if (error) throw error;
        res.json({ statements: data || [] });
    } catch (error) {
        fail(res, error, 'MONTHLY_FEES_UNAVAILABLE');
    }
});

router.get('/apps/:packageName/products', async (req, res) => {
    try {
        const client = getLumaStoreSupabaseClient();
        const app = await resolveApp(client, req.params.packageName);
        const { data, error } = await client.from('luma_billing_products')
            .select('*').eq('app_id', app.id).eq('active', true).order('created_at');
        if (error) throw error;
        res.json({ products: (data || []).map(product) });
    } catch (error) {
        fail(res, error, 'PRODUCTS_UNAVAILABLE');
    }
});

router.post('/apps/:packageName/purchases', async (req, res) => {
    try {
        const { user, token } = await getLumaStoreAuthenticatedUser(req);
        const client = getLumaStoreSupabaseClient(token);
        const app = await resolveApp(client, req.params.packageName);
        await assertDeveloperCanReceivePayments(client, app.developer_id);
        const productId = String(req.body?.productId || '').trim();
        if (!productId) return res.status(400).json({ code: 'INVALID_PRODUCT', message: 'productId is required' });

        const { data: item, error } = await client.from('luma_billing_products')
            .select('*').eq('app_id', app.id).eq('product_id', productId).eq('active', true).maybeSingle();
        if (error) throw error;
        if (!item) return res.status(404).json({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });

        let amount = item.price_amount_minor;
        if (item.product_type === 'PAY_WHAT_YOU_WANT') {
            amount = Number(req.body?.amountMinor);
            if (!Number.isSafeInteger(amount) || amount < Number(item.minimum_amount_minor || 0)) {
                return res.status(400).json({ code: 'AMOUNT_TOO_LOW', message: 'amountMinor is below the product minimum' });
            }
        }

        // The API creates a pending transaction. A payment rail confirms it later;
        // never grant an entitlement merely because this row exists.
        const id = crypto.randomUUID();
        const { data: row, error: insertError } = await client.from('luma_billing_purchases').insert({
            id, app_id: app.id, product_id: item.product_id, user_id: user.id,
            amount_minor: amount, currency: item.currency, status: 'PENDING'
        }).select('*').single();
        if (insertError) throw insertError;
        res.status(201).json(purchase(row, app.package_name));
    } catch (error) {
        fail(res, error, 'PURCHASE_CREATE_FAILED');
    }
});

router.get('/apps/:packageName/purchases/:transactionId/payment', async (req, res) => {
    try {
        const { user, token } = await getLumaStoreAuthenticatedUser(req);
        const client = getLumaStoreSupabaseClient(token);
        const app = await resolveApp(client, req.params.packageName);
        await assertDeveloperCanReceivePayments(client, app.developer_id);
        const { data: row, error } = await client.from('luma_billing_purchases').select('*')
            .eq('id', req.params.transactionId).eq('app_id', app.id).eq('user_id', user.id).maybeSingle();
        if (error) throw error;
        if (!row) return res.status(404).json({ code: 'PURCHASE_NOT_FOUND', message: 'Purchase not found' });
        const recipient = await resolveDeveloperSolanaRecipient(client, app.developer_id);
        if (!recipient) return res.status(409).json({ code: 'DEVELOPER_PAYMENT_NOT_CONFIGURED', message: 'Developer has no Solana funding address configured' });
        const expires = Date.parse(row.created_at) + PAYMENT_TTL_MS;
        res.json({
            transactionId: row.id,
            chain: 'SOLANA',
            asset: 'SOL',
            recipient,
            amountAtomic: Number(row.amount_minor),
            reference: row.id,
            expiresAtEpochMillis: expires
        });
    } catch (error) {
        fail(res, error, 'PAYMENT_REQUEST_FAILED');
    }
});

router.post('/apps/:packageName/purchases/:transactionId/verify', async (req, res) => {
    try {
        const { user, token } = await getLumaStoreAuthenticatedUser(req);
        const client = getLumaStoreSupabaseClient(token);
        const app = await resolveApp(client, req.params.packageName);
        const signature = String(req.body?.chainTransactionId || '').trim();
        if (!signature) return res.status(400).json({ code: 'TRANSACTION_REQUIRED', message: 'chainTransactionId is required' });
        const { data: row, error } = await client.from('luma_billing_purchases').select('*')
            .eq('id', req.params.transactionId).eq('app_id', app.id).eq('user_id', user.id).maybeSingle();
        if (error) throw error;
        if (!row) return res.status(404).json({ code: 'PURCHASE_NOT_FOUND', message: 'Purchase not found' });
        if (row.status === 'PURCHASED') return res.json({ status: 'PURCHASED', purchase: purchase(row, app.package_name) });
        if (Date.now() > Date.parse(row.created_at) + PAYMENT_TTL_MS) {
            return res.json({ status: 'EXPIRED', purchase: null });
        }
        const recipient = await resolveDeveloperSolanaRecipient(client, app.developer_id);
        if (!recipient) return res.status(409).json({ code: 'DEVELOPER_PAYMENT_NOT_CONFIGURED', message: 'Developer has no Solana funding address configured' });
        const valid = await verifySolTransfer(signature, recipient, row.amount_minor);
        if (!valid) return res.json({ status: 'VERIFYING', purchase: null });

        const purchasedAt = new Date().toISOString();
        const receiptPayload = JSON.stringify({ transactionId: row.id, productId: row.product_id, packageName: app.package_name, chain: 'SOLANA', chainTransactionId: signature, purchasedAt });
        const { data: updated, error: updateError } = await client.from('luma_billing_purchases')
            .update({ status: 'PURCHASED', purchased_at: purchasedAt, receipt: receiptPayload })
            .eq('id', row.id).eq('status', 'PENDING').select('*').single();
        if (updateError) throw updateError;
        res.json({ status: 'PURCHASED', purchase: purchase(updated, app.package_name) });
    } catch (error) {
        fail(res, error, 'PAYMENT_VERIFY_FAILED');
    }
});

router.get('/apps/:packageName/purchases', async (req, res) => {
    try {
        const { user, token } = await getLumaStoreAuthenticatedUser(req);
        const client = getLumaStoreSupabaseClient(token);
        const app = await resolveApp(client, req.params.packageName);
        const { data, error } = await client.from('luma_billing_purchases')
            .select('*').eq('app_id', app.id).eq('user_id', user.id).order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ purchases: (data || []).map(row => purchase(row, app.package_name)) });
    } catch (error) {
        fail(res, error, 'PURCHASES_UNAVAILABLE');
    }
});

router.post('/apps/:packageName/purchases/:transactionId/consume', async (req, res) => {
    try {
        const { user, token } = await getLumaStoreAuthenticatedUser(req);
        const client = getLumaStoreSupabaseClient(token);
        const app = await resolveApp(client, req.params.packageName);
        const { data: row, error: lookupError } = await client.from('luma_billing_purchases')
            .select('id,product_id,status').eq('id', req.params.transactionId)
            .eq('app_id', app.id).eq('user_id', user.id).maybeSingle();
        if (lookupError) throw lookupError;
        if (!row) return res.status(404).json({ code: 'PURCHASE_NOT_FOUND', message: 'Purchase not found' });
        const { data: item, error: productError } = await client.from('luma_billing_products')
            .select('product_type').eq('app_id', app.id).eq('product_id', row.product_id).single();
        if (productError) throw productError;
        if (item.product_type !== 'CONSUMABLE') return res.status(409).json({ code: 'NOT_CONSUMABLE', message: 'Product is not consumable' });
        if (row.status !== 'PURCHASED') return res.status(409).json({ code: 'NOT_PURCHASED', message: 'Only purchased transactions can be consumed' });
        const { error } = await client.from('luma_billing_purchases')
            .update({ status: 'CONSUMED', consumed_at: new Date().toISOString() }).eq('id', row.id);
        if (error) throw error;
        res.status(204).end();
    } catch (error) {
        fail(res, error, 'CONSUME_FAILED');
    }
});

router.post('/apps/:packageName/purchases/restore', async (req, res) => {
    try {
        const { user, token } = await getLumaStoreAuthenticatedUser(req);
        const client = getLumaStoreSupabaseClient(token);
        const app = await resolveApp(client, req.params.packageName);
        const { data, error } = await client.from('luma_billing_purchases')
            .select('*').eq('app_id', app.id).eq('user_id', user.id)
            .in('status', ['PURCHASED']).order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ purchases: (data || []).map(row => purchase(row, app.package_name)) });
    } catch (error) {
        fail(res, error, 'RESTORE_FAILED');
    }
});

module.exports = router;
