const router = require('express').Router();
const { getAuthenticatedUser } = require('../../lib/supabase');

let subscriptions = [];

async function authenticate(req, res, next) {
    try {
        const user = await getAuthenticatedUser(req);
        req.user = user;
        next();
    } catch (error) {
        res.status(401).json({
            error: 'Unauthorized',
            message: 'You have to be loged in, to access GeoWeather-Subscriptions.'
        });
    }
}

router.use(authenticate);

router.get('/', (req, res) => {
    const userSubscriptions = subscriptions.filter(s => s.userId === req.user.id);
    res.json({
        userId: req.user.id,
        subscriptions: userSubscriptions
    });
});

router.post('/', (req, res) => {
    const { location, type = 'daily', coordinates } = req.body;

    if (!location) {
        return res.status(400).json({
            error: 'Validation Error',
            message: 'A City (location) is required.'
        });
    }

    const newSubscription = {
        id: `sub_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        userId: req.user.id,
        location,
        coordinates,
        type,
        createdAt: new Date().toISOString()
    };

    subscriptions.push(newSubscription);

    res.status(201).json({
        message: 'Subscription successful created',
        subscription: newSubscription
    });
});

router.delete('/:id', (req, res) => {
    const { id } = req.params;

    const index = subscriptions.findIndex(s => s.id === id && s.userId === req.user.id);

    if (index === -1) {
        return res.status(404).json({
            error: 'Not Found',
            message: 'Subscription not found or no .'
        });
    }

    const removed = subscriptions.splice(index, 1);

    res.json({
        message: 'Subscription successful removed',
        subscription: removed[0]
    });
});

module.exports = router;
