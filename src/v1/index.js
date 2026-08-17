const express = require('express');
const router = express.Router();
const axios = require('axios');

// Health Check (ohne /api/v1 prefix!)
router.get('/health', async (req, res) => {
    const result = {
        status: 'ok',
        service: 'All API',
        timestamp: new Date().toISOString(),
        checks: {}
    };

    try {
        await axios.head('https://api.oxapay.com/v1/common/monitor');
        result.checks.oxapay = 'reachable';
    } catch (err) {
        result.checks.oxapay = `error: ${err.message}`;
        result.status = 'degraded';
    }

    res.status(result.status === 'ok' ? 200 : 503).json(result);
});

// Root of v1
router.get('/', (req, res) => {
    res.status(200).send(`
        <!DOCTYPE html>
        <html lang="de">
        <head>
            <title>All API v1.0.0</title>
        </head>
        <body>
            <pre>${JSON.stringify({
        message: 'Welcome to the All API v1!',
        api: {
            version: '1.0.0',
            'v1 endpoints': {
                'cross endpoints': {
                    health: '/api/v1/health',
                },
            }
        }
    }, null, 2)}</pre>
        </body>
        </html>
    `);
});

// V1 routes (ohne /api/v1 prefix!)

module.exports = router;