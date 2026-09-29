const express = require('express');
const crypto = require('node:crypto');
const router = express.Router();
const { getLumaStoreSupabaseClient, getLumaStoreAuthenticatedUser } = require('../../lib/supabase');
const { getConnection } = require('../../lib/arcade');

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
        res.json({ settlementAsset: funding.settlementAsset, availableAssets: Object.keys(funding.addresses) });
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
        if (!asset || !funding.addresses[asset]) return res.status(400).json({ code: 'UNSUPPORTED_SETTLEMENT_ASSET', message: 'Settlement asset must have a configured funding address' });
        const { error } = await client.from('luma_developer_funding').update({ billing_settlement_asset: asset }).eq('developer_id', user.id);
        if (error) throw error;
        res.json({ settlementAsset: asset });
    } catch (error) {
        fail(res, error, 'SETTLEMENT_SETTINGS_UPDATE_FAILED');
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
