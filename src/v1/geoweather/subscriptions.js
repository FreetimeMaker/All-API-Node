const router = require('express').Router();
const { getAuthenticatedUser } = require('../../lib/supabase');
const Subscription = require('./models/Subscription');

async function authenticate(req, res, next) {
    try {
        const user = await getAuthenticatedUser(req);
        req.user = user;
        next();
    } catch (error) {
        res.status(401).json({
            error: 'Unauthorized',
            message: 'You have to be logged in to access GeoWeather Subscriptions.',
        });
    }
}

router.use(authenticate);

router.get('/', async (req, res) => {
    try {
        const subscriptions = await Subscription.getAll(req.user.id);
        res.json({
            userId: req.user.id,
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
        const subscription = await Subscription.getById(req.params.id, req.user.id);
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

        const subscription = await Subscription.create(req.user.id, {
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

        if (type && !Object.values(Subscription.TYPES).includes(type)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: `Invalid type. Allowed: ${Object.values(Subscription.TYPES).join(', ')}`,
            });
        }

        const subscription = await Subscription.update(req.params.id, req.user.id, {
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
        const removed = await Subscription.remove(req.params.id, req.user.id);
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
