const express = require('express');
const router = express.Router();
const axios = require('axios');
const health = require('./health/health');
const products = require('./fms/products');
const supabaseRoutes = require('./auth/supabase');
const geoWeatherSubscriptions = require('./geoweather/subscriptions');
const fdowsApps = require('./fdows/apps');

router.use('/health', health);
router.use('/fms/products', products);
router.use('/auth', supabaseRoutes);
router.use('/geoweather/subscriptions', geoWeatherSubscriptions);
router.use('/fdows/apps', fdowsApps);

router.get('/', (req, res) => {
    res.json({
        message: 'Welcome to the All API v1!',
        version: '1.0.0',
        endpoints: {
            'cross endpoints': {
                health: '/api/v1/health',
                login: '/api/v1/auth/login',
                logout: '/api/v1/auth/logout'
            },
            'Freetime Maker Shop': {
                products: '/api/v1/fms/products',
            },
        }
    });
});

module.exports = router;