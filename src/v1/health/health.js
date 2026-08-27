const axios = require('axios');
const crypto = require('crypto');
const router = require('express').Router();

if (!process.env.OXAPAY_API_KEY) {
    console.warn('HINWEIS: OXAPAY_API_KEY fehlt in der .env Datei. Manche Health-Checks könnten eingeschränkt sein.');
}

// OxaPay API reference: https://docs.oxapay.com/
const API_BASE = 'https://api.oxapay.com/v1';
const TIMEOUT_MS = 5000;

/**
 * Builds the authorization header for the OxaPay API.
 * Token format: <apiKey>:<sha256(apiKey)>
 * https://docs.oxapay.com/authentication
 */
function buildAuthHeader() {
    const apiKey = process.env.OXAPAY_API_KEY;
    if (!apiKey) return null;
    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
    return `${apiKey}:${hash}`;
}

async function checkEndpoint(path, name) {
    const authHeader = buildAuthHeader();
    const start = Date.now();
    try {
        const response = await axios.get(`${API_BASE}${path}`, {
            headers: authHeader ? { Authorization: authHeader } : {},
            timeout: TIMEOUT_MS,
            validateStatus: (status) => status >= 200 && status < 500,
        });
        const latency = Date.now() - start;
        return {
            status: 'reachable',
            httpStatus: response.status,
            latencyMs: latency,
            body: response.data,
        };
    } catch (err) {
        const latency = Date.now() - start;
        const isTimeout = err.code === 'ECONNABORTED';
        return {
            status: 'error',
            latencyMs: latency,
            error: isTimeout ? `timeout after ${TIMEOUT_MS}ms` : err.message,
            code: err.code || null,
        };
    }
}

router.get('/', async (req, res) => {
    const result = {
        status: 'ok',
        service: 'All API',
        timestamp: new Date().toISOString(),
        checks: {}
    };

    const apiKeyConfigured = Boolean(process.env.OXAPAY_API_KEY);

    // 1. Configuration check
    result.checks.oxapayConfig = {
        status: apiKeyConfigured ? 'configured' : 'missing',
        apiKeyConfigured: apiKeyConfigured,
    };
    if (!apiKeyConfigured) result.status = 'degraded';

    // 2. Endpoint checks
    const [monitor, balance, authStatus] = await Promise.all([
        checkEndpoint('/common/monitor', 'monitor'),
        checkEndpoint('/payment/balance', 'balance'),
    ]);

    result.checks.oxapayMonitor = monitor;
    result.checks.oxapayBalance = balance;

    // Also include auth validity based on balance endpoint response
    const balanceBody = balance.body;
    if (balance.status === 'reachable' && balanceBody) {
        if (balanceBody.status === 'successful' || balanceBody.result) {
            result.checks.oxapayAuth = { status: 'valid' };
        } else {
            result.checks.oxapayAuth = { status: 'invalid', message: balanceBody.message || 'Auth failed' };
            result.status = 'degraded';
        }
    }

    if (monitor.status === 'error' || balance.status === 'error') {
        result.status = 'degraded';
    }

    res.status(result.status === 'ok' ? 200 : 503).json(result);
});


module.exports = router;
