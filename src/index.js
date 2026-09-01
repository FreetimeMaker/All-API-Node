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
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.get('/', (req, res) => {
    res.json({
        message: 'Welcome to the All API!',
        api: {
            version: '2.2.0',
            'old v1 endpoints': {
                'cross endpoints': {
                    health: '/v1/health',
                    login: '/v1/auth/login',
                    logout: '/v1/auth/logout'
                },
                'GeoWeather endpoints': {
                    subscriptions: '/v1/geoweather/subscriptions',
                    plans: '/v1/geoweather/subscriptions/plans',
                    redeem: '/v1/geoweather/subscriptions/redeem',
                },
                'F-Port endpoints': {
                    apps: '/v1/fport/apps'
                },
                'Wallora endpoints': {
                    wallpapers: '/v1/wallora/wallpapers'
                }
            },
            'v2 endpoints' : {
                'cross endpoints': {
                    health: '/v2/health',
                    login: '/v2/auth/login',
                    logout: '/v2/auth/logout'
                },
                'GeoWeather endpoints': {
                    subscriptions: '/v2/geoweather/subscriptions',
                    plans: '/v2/geoweather/subscriptions/plans',
                    redeem: '/v2/geoweather/subscriptions/redeem',
                },
                'F-Port endpoints': {
                    apps: '/v2/fport/apps'
                },
                'Wallora endpoints': {
                    wallpapers: '/v2/wallora/wallpapers'
                },
                'Sol Arcade endpoints': {
                    info: '/v2/arcade',
                    challenge: '/v2/arcade/challenge',
                    login: '/v2/arcade/login',
                    me: '/v2/arcade/me',
                    setup: '/v2/arcade/setup'
                }
            }
        }
    });
});

app.get('/v2/health', (req, res) => {
    res.json({ status: 'ok' });
});

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

// Rolldown schreibt `require('./v1')` intern zu `require_index.default` um.
// Sollte diese Interop-Property auf dem Server fehlen, laden wir den real
// ausgelieferten Chunk zur Laufzeit und normalisieren ihn ebenfalls.
const staticV1 = require('./v1');
let v1Router = asRouter(staticV1);
if (!v1Router) {
    try {
        const { createRequire } = require('node:module');
        v1Router = asRouter(createRequire(__filename)('./v1' + '/index.cjs'));
    } catch {
        v1Router = null;
    }
}
if (!v1Router) {
    const describe = (m) => {
        if (m == null) return `nullish(${typeof m})`;
        const cls = typeof m;
        let out = `${cls}(keys=${Object.keys(m).join(',') || '-'}`;
        if (cls === 'object' || cls === 'function') {
            out += `,def=${typeof m.default}`;
            if (m.default && typeof m.default === 'object') {
                out += `,defkeys=${Object.keys(m.default).join(',') || '-'},defdef=${typeof m.default.default}`;
            }
        }
        return out + ')';
    };
    let probe = null;
    try {
        const { createRequire } = require('node:module');
        probe = createRequire(__filename)('./v1' + '/index.cjs');
    } catch (e) {
        probe = `REQUIRE-ERR: ${e.message}`;
    }
    console.error(`[api-v1] static=${describe(staticV1)} chunk=${describe(probe)}`);
    throw new Error('[api] konnte ./v1 nicht als Router laden.');
}
app.use('/v1', v1Router);

const staticV2 = require('./v2');
let v2Router = asRouter(staticV2);
if (!v2Router) {
    try {
        const { createRequire } = require('node:module');
        v2Router = asRouter(createRequire(__filename)('./v2' + '/index.cjs'));
    } catch {
        v2Router = null;
    }
}
if (!v2Router) {
    const describe = (m) => {
        if (m == null) return `nullish(${typeof m})`;
        const cls = typeof m;
        let out = `${cls}(keys=${Object.keys(m).join(',') || '-'}`;
        if (cls === 'object' || cls === 'function') {
            out += `,def=${typeof m.default}`;
            if (m.default && typeof m.default === 'object') {
                out += `,defkeys=${Object.keys(m.default).join(',') || '-'},defdef=${typeof m.default.default}`;
            }
        }
        return out + ')';
    };
    let probe = null;
    try {
        const { createRequire } = require('node:module');
        probe = createRequire(__filename)('./v2' + '/index.cjs');
    } catch (e) {
        probe = `REQUIRE-ERR: ${e.message}`;
    }
    console.error(`[api-v2] static=${describe(staticV2)} chunk=${describe(probe)}`);
    throw new Error('[api] konnte ./v2 nicht als Router laden.');
}
app.use('/v2', v2Router);

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