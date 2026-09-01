const express = require('express');
const router = express.Router();
const axios = require('axios');
const health = require('./health/health');
const supabaseRoutes = require('./auth/supabase');
const geoWeatherSubscriptions = require('./geoweather/subscriptions');
const fportApps = require('./fport/apps');
const walloraWallpapers = require('./wallora/wallpapers');

// Vercel (Rolldown) liefert gebündelte Module in wechselnden Formen:
// { default: <router> }, { default: { default: <router> } }, Memo-Wrapper-
// Funktion oder direkt die Funktion. asRouter entpackt rekursiv bis zum echten
// express.Router (max. 5 Ebenen, um zyklische Strukturen auszuschließen).
const asRouter = (m) => {
    for (let d = 0; d < 5 && m != null; d++) {
        if (typeof m === 'function') {
            if (typeof m.use === 'function' && typeof m.get === 'function') return m;
            m = m();
            continue;
        }
        if (typeof m.default === 'function') {
            if (typeof m.default.use === 'function' && typeof m.default.get === 'function') return m.default;
            m = m.default();
            continue;
        }
        if (m.default && typeof m.default === 'object') {
            m = m.default;
            continue;
        }
        return null;
    }
    return null;
};

router.use('/health', asRouter(health));
router.use('/auth', asRouter(supabaseRoutes));
router.use('/geoweather/subscriptions', asRouter(geoWeatherSubscriptions));
router.use('/fport/apps', asRouter(fportApps));
router.use('/wallora/wallpapers', asRouter(walloraWallpapers));

router.get('/api/v1', (req, res) => {
    res.json({
        message: 'Welcome to the All API v1!',
        version: '1.5.0',
        message: 'This API Version is deprecated please visit /api/v2 instead of /api/v1.',
        endpoints: {
            'cross endpoints': {
                health: '/health',
                login: '/auth/login',
                logout: '/auth/logout'
            },
            'GeoWeather endpoints': {
                subscriptions: '/geoweather/subscriptions',
                plans: '/geoweather/subscriptions/plans',
                redeem: '/geoweather/subscriptions/redeem',
            },
            'F-Port endpoints': {
                apps: '/fport/apps'
            },
            'Wallora endpoints': {
                wallpapers: '/wallora/wallpapers'
            }
        }
    });
});

module.exports = router;