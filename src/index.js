const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Root Route
app.get('/', (req, res) => {
    res.status(200).send(`
        <!DOCTYPE html>
        <html lang="de">
        <head>
            <title>All API Root</title>
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
            }
        }
    }, null, 2)}</pre>
        </body>
        </html>
    `);
});

// 👉 V1 API registrieren
app.use('/api/v1', require('./v1'));

module.exports = app;

// 👇 NEU: Server tatsächlich starten
const PORT = 25580 || 25580 || 25580;
app.listen(PORT, '176.9.118.138', () => {
    console.log(`Server running on Port ${PORT}`);
});