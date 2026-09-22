const express = require('express');
const router = express.Router();
const health = require('./health/health');
const supabaseRoutes = require('./auth/supabase');
const geoWeatherSubscriptions = require('./geoweather/subscriptions');
const walloraWallpapers = require('./wallora/wallpapers');
const arcadeRoutes = require('./arcade');
const lumaStore = require('./lumastore/store');
const blogRoutes = require('./blog');

// Vercel (Rolldown) liefert gebündelte Module in wechselnden Formen.
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
router.use('/wallora/wallpapers', asRouter(walloraWallpapers));
router.use('/arcade', asRouter(arcadeRoutes));
router.use('/lumastore', asRouter(lumaStore));
router.use('/blog', asRouter(blogRoutes));

router.get('/v2', (req, res) => {
    res.json({
        message: 'Welcome to the All API v2!',
        version: '2.7.0',
        endpoints: {
            'cross endpoints': {
                health: '/health',
                login: '/auth/login',
                logout: '/auth/logout'
            },
            'GeoWeather endpoints': {
                subscriptions: '/geoweather/subscriptions',
                plans: '/geoweather/subscriptions/plans',
                redeem: '/geoweather/subscriptions/redeem'
            },
            'Wallora endpoints': {
                wallpapers: '/wallora/wallpapers'
            },
            'Sol Arcade endpoints': {
                info: '/v2/arcade',
                challenge: '/v2/arcade/challenge',
                login: '/v2/arcade/login',
                me: '/v2/arcade/me',
                setup: '/v2/arcade/setup'
            },
            'Luma Store endpoints': {
                apps: '/lumastore/apps',
                appDetails: '/lumastore/apps/:id',
                ratings: '/lumastore/apps/:id/ratings',
                myRating: '/lumastore/apps/:id/rating/me',
                setMyRating: 'PUT /lumastore/apps/:id/rating/me',
                deleteMyRating: 'DELETE /lumastore/apps/:id/rating/me'
            },
            'MD-Blog endpoints': {
                posts: '/blog/posts',
                postDetails: '/blog/posts/:slug',
                categories: '/blog/categories'
            }
        }
    });
});

module.exports = router;
