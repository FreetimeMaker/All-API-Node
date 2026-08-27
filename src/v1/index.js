const express = require('express');
const router = express.Router();
const axios = require('axios');
const health = require('./health/health');
const supabaseRoutes = require('./auth/supabase');
const geoWeatherSubscriptions = require('./geoweather/subscriptions');
const fportApps = require('./fport/apps');
const walloraWallpapers = require('./wallora/wallpapers');

router.use('/health', health);
router.use('/auth', supabaseRoutes);
router.use('/geoweather/subscriptions', geoWeatherSubscriptions);
router.use('/fport/apps', fportApps);
router.use('/wallora/wallpapers', walloraWallpapers);

router.get('/', (req, res) => {
    res.json({
        message: 'Welcome to the All API v1!',
        version: '1.4.0',
        endpoints: {
            'cross endpoints': {
                health: '/api/v1/health',
                login: '/api/v1/auth/login',
                logout: '/api/v1/auth/logout'
            },
            'GeoWeather endpoints': {
                subscriptions: '/api/v1/geoweather/subscriptions',
                plans: '/api/v1/geoweather/subscriptions/plans',
                redeem: '/api/v1/geoweather/subscriptions/redeem',
            },
            'F-Port endpoints': {
                apps: '/api/v1/fport/apps'
            },
            'Wallora endpoints': {
                wallpapers: '/api/v1/wallora/wallpapers'
            }
        }
    });
});

module.exports = router;