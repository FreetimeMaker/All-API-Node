const dotenv = require('dotenv');
const result = dotenv.config();

// Auf Plattformen wie Vercel werden Umgebungsvariablen direkt bereitgestellt,
// daher ist eine fehlende .env Datei dort normal.
if (result.error && !process.env.VERCEL) {
    console.warn('HINWEIS: Keine .env Datei gefunden (lokale Entwicklung?).');
} else if (!result.error) {
    console.log('.env Konfiguration geladen.');
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const app = express();
app.set('trust proxy', true);

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

// Falls die Datei direkt gestartet wird, Server starten
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    if (!process.env.PORT) {
        console.warn(`HINWEIS: PORT ist nicht in .env definiert. Nutze Standardport ${PORT}.`);
    }
    app.listen(PORT, () => {
        console.log(`Server läuft auf Port ${PORT}`);
    });
}

module.exports = app;