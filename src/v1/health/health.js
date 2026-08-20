const axios = require('axios');
const router = require('express').Router();

if (!process.env.OXAPAY_API_KEY) {
    console.warn('HINWEIS: OXAPAY_API_KEY fehlt in der .env Datei. Manche Health-Checks könnten eingeschränkt sein.');
}

router.get('/', async (req, res) => {
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


module.exports = router;