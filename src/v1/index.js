const express = require('express');
const router = express.Router();
const health = require('./health');
const products = require('./fms/products');

router.use('/health', health);
router.use('/fms/products', products);

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
                'Freetime Maker Shop endpoints': {
                    products: '/api/v1/fms/products',
                }
            }
        }
    }, null, 2)}</pre>
        </body>
        </html>
    `);
});

module.exports = router;