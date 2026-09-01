const router = require('express').Router();

router.get('/', (req, res) => {
    const result = {
        status: 'ok',
        service: 'All API',
        timestamp: new Date().toISOString(),
        checks: {}
    };

    res.status(200).json(result);
});


module.exports = router;
