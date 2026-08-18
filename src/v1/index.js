const express = require('express');
const router = express.Router();
const axios = require('axios');
const health = require('./health');
const products = require('./fms/products');

router.use('/health', health);
router.use('/fms/products', products);

router.get('/', (req, res) => {
    res.json({
        message: 'Welcome to the All API v1!',
        version: '1.0.0',
        endpoints: {
            'cross endpoints': {
                health: '/api/v1/health',
            },
            'Freetime Maker Shop': {
                products: '/api/v1/fms/products',
            }
        }
    });
});

module.exports = router;