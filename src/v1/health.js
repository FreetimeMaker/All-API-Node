import axios from "axios";
import router from "./index";

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

    res.status(result.status === 'ok' ? 200 : 503).send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>All API v1.0.0 Health Check - ${result.status}</title>
        </head>
        <body>
            <pre>${JSON.stringify(result, null, 2)}</pre>
        </body>
        </html>
    `);
});

module.exports = router;