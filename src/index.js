require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use('/assets', express.static(path.join(__dirname, 'src/assets')));

app.get('/', (req, res) => {
    res.json({
        message: 'Welcome to the All API!',
        api: {
            version: '1.0.0',
            'v1 endpoints': {
                'cross endpoints': {
                    health: '/api/v1/health',
                    login: '/api/v1/auth/login',
                    logout: '/api/v1/auth/logout'
                },
                'Freetime Maker Shop endpoints': {
                    products: '/api/v1/fms/products',
                }
            }
        }
    });
});

app.use('/api/v1', require('./v1'));

module.exports = app;