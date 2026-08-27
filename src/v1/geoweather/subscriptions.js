const router = require('express').Router();
const { getAuthenticatedUser } = require('../../lib/supabase');
const Subscription = require('./models/Subscription');
const Code = require('./models/Code');

async function optionalAuth(req, res, next) {
    try {
        const user = await getAuthenticatedUser(req, { requireConfig: false });
        req.user = user || null;
    } catch {
        req.user = null;
    }

    if (!req.user) {
        req.sessionId = req.headers['x-session-id'] || null;
    }

    next();
}

router.use(optionalAuth);

router.get('/plans', (req, res) => {
    res.json({
        plans: {
            free: Subscription.FEATURES.free,
            freemium: Subscription.FEATURES.freemium,
            premium: Subscription.FEATURES.premium,
            ultrimium: Subscription.FEATURES.ultrimium,
        },
        types: Object.values(Subscription.TYPES),
    });
});

router.post('/redeem', async (req, res) => {
    try {
        const { code } = req.body;
        const userId = req.user?.id || null;

        if (!code) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'A code is required.',
            });
        }

        if (!userId) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'You must be logged in to redeem a code.',
            });
        }

        const { code: redeemedCode, type } = await Code.redeem(code, userId);

        const subscription = await Subscription.applyCodeUpgrade(userId, type, redeemedCode.id);

        const features = Subscription.getFeatures(type);

        res.json({
            message: 'Code redeemed successfully',
            subscription: {
                ...subscription,
                features,
            },
        });
    } catch (error) {
        const status = error.message.includes('already used') ? 409 : 400;
        res.status(status).json({
            error: 'Redeem Failed',
            message: error.message,
        });
    }
});

router.get('/', async (req, res) => {
    try {
        const userId = req.user?.id || null;
        const sessionId = req.sessionId || null;

        if (!userId && !sessionId) {
            return res.json({ subscriptions: [] });
        }

        const subscriptions = await Subscription.getAll(userId, sessionId);
        res.json({
            userId: userId || null,
            sessionId: sessionId || null,
            subscriptions,
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to fetch subscriptions',
            message: error.message,
        });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const userId = req.user?.id || null;
        const sessionId = req.sessionId || null;
        const subscription = await Subscription.getById(req.params.id, userId, sessionId);
        res.json(subscription);
    } catch (error) {
        res.status(404).json({
            error: 'Not Found',
            message: 'Subscription not found.',
        });
    }
});

router.post('/', async (req, res) => {
    try {
        const { location, type, coordinates } = req.body;
        const userId = req.user?.id || null;
        const sessionId = req.sessionId || null;

        if (!location) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'A city (location) is required.',
            });
        }

        if (type && !Object.values(Subscription.TYPES).includes(type)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: `Invalid type. Allowed: ${Object.values(Subscription.TYPES).join(', ')}`,
            });
        }

        const subscription = await Subscription.create(userId, sessionId, {
            location,
            type,
            coordinates,
        });

        res.status(201).json({
            message: 'Subscription created successfully',
            subscription,
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to create subscription',
            message: error.message,
        });
    }
});

router.patch('/:id', async (req, res) => {
    try {
        const { location, type, coordinates, is_active } = req.body;
        const userId = req.user?.id || null;
        const sessionId = req.sessionId || null;

        if (type && !Object.values(Subscription.TYPES).includes(type)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: `Invalid type. Allowed: ${Object.values(Subscription.TYPES).join(', ')}`,
            });
        }

        const subscription = await Subscription.update(req.params.id, userId, sessionId, {
            location,
            type,
            coordinates,
            is_active,
        });

        res.json({
            message: 'Subscription updated successfully',
            subscription,
        });
    } catch (error) {
        res.status(404).json({
            error: 'Not Found',
            message: 'Subscription not found or no valid fields to update.',
        });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const userId = req.user?.id || null;
        const sessionId = req.sessionId || null;
        const removed = await Subscription.remove(req.params.id, userId, sessionId);
        res.json({
            message: 'Subscription deleted successfully',
            subscription: removed,
        });
    } catch (error) {
        res.status(404).json({
            error: 'Not Found',
            message: 'Subscription not found.',
        });
    }
});

module.exports = router;
