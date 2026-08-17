const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.status(200).send(`
        <!DOCTYPE html>
        <html lang="de">
        <head>
            <title>All API v1.0.0</title>
        </head>
        <body>
            <pre>${JSON.stringify({
        message: 'Welcome to the All API!',
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

app.use('/api/v1', require('./v1'));

module.exports = app;