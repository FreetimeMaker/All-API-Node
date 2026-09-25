const express = require('express');
const router = express.Router();
const { getLumaStoreSupabaseClient, getLumaStoreAuthenticatedUser } = require('../../lib/supabase');

const LINUX_PACKAGE_FORMATS = ['AppImage', 'Debian-based', 'RPM-based'];

function packageFormat(platform) {
    return platform?.package_format || platform?.linux_package_base || null;
}

function normalizeApp(app, requestedPlatform = null, requestedPackageFormat = null) {
    const platforms = Array.isArray(app.platforms) ? app.platforms : [];
    const selectedPlatform = requestedPlatform
        ? platforms.find(p => {
            const platformMatches = (p.platform || '').toLowerCase() === requestedPlatform.toLowerCase();
            if (!platformMatches) return false;
            if ((requestedPlatform || '').toLowerCase() === 'linux' && requestedPackageFormat) {
                return (packageFormat(p) || '').toLowerCase() === requestedPackageFormat.toLowerCase();
            }
            return true;
        })
        : platforms.find(p => (p.platform || '').toLowerCase() === 'android') || platforms[0] || null;

    return {
        ...app,
        category: app.category?.name || null,
        platform: selectedPlatform?.platform || null,
        package_format: packageFormat(selectedPlatform),
        // Kept for backwards compatibility with existing clients/database rows.
        linux_package_base: selectedPlatform?.linux_package_base || null,
        download_url: selectedPlatform?.download_url || null,
        file_size_mb: selectedPlatform?.file_size_mb ?? null,
        platforms: platforms.map(p => ({ ...p, package_format: packageFormat(p) }))
    };
}

function validateLinuxPackageFormat(value) {
    if (!value) return null;
    return LINUX_PACKAGE_FORMATS.find(format => format.toLowerCase() === String(value).toLowerCase()) || null;
}

router.get('/apps', async (req, res) => {
    try {
        const client = getLumaStoreSupabaseClient();
        if (!client) return res.status(500).json({ error: 'Database connection failed' });

        const { category, platform, search } = req.query;
        const requestedPackage = req.query.package_format || req.query.linux_package_base || null;
        const packageFormatFilter = validateLinuxPackageFormat(requestedPackage);

        if (requestedPackage && !packageFormatFilter) {
            return res.status(400).json({ error: 'Invalid package_format', message: `package_format must be one of: ${LINUX_PACKAGE_FORMATS.join(', ')}` });
        }
        if (requestedPackage && (!platform || String(platform).toLowerCase() !== 'linux')) {
            return res.status(400).json({ error: 'Invalid platform filter', message: 'package_format can only be used together with platform=Linux' });
        }

        let query = client.from('store_apps').select(`
            *,
            category:store_categories(name),
            platforms:store_app_platforms(*)
        `);
        if (category) query = query.eq('category_id', category);
        if (search) query = query.ilike('name', `%${search}%`);

        const { data, error } = await query;
        if (error) throw error;
        let result = (data || []).map(app => normalizeApp(app, platform || null, packageFormatFilter));
        if (platform) {
            result = result.filter(app => app.platforms.some(p => {
                if ((p.platform || '').toLowerCase() !== String(platform).toLowerCase()) return false;
                return !packageFormatFilter || (packageFormat(p) || '').toLowerCase() === packageFormatFilter.toLowerCase();
            }));
        }
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch apps', message: error.message });
    }
});

router.get('/apps/:id', async (req, res) => {
    try {
        const client = getLumaStoreSupabaseClient();
        if (!client) return res.status(500).json({ error: 'Database connection failed' });
        const { id } = req.params;
        const { platform } = req.query;
        const requestedPackage = req.query.package_format || req.query.linux_package_base || null;
        const packageFormatFilter = validateLinuxPackageFormat(requestedPackage);
        if (requestedPackage && !packageFormatFilter) {
            return res.status(400).json({ error: 'Invalid package_format', message: `package_format must be one of: ${LINUX_PACKAGE_FORMATS.join(', ')}` });
        }
        if (requestedPackage && (!platform || String(platform).toLowerCase() !== 'linux')) {
            return res.status(400).json({ error: 'Invalid platform filter', message: 'package_format can only be used together with platform=Linux' });
        }
        const { data, error } = await client.from('store_apps').select(`
            *,
            category:store_categories(*),
            platforms:store_app_platforms(*)
        `).eq('id', id).single();
        if (error) throw error;
        res.json(normalizeApp(data, platform || null, packageFormatFilter));
    } catch (error) {
        res.status(404).json({ error: 'App not found', message: error.message });
    }
});


function requireGoogleIdentity(user) {
    const providers = new Set([
        user?.app_metadata?.provider,
        ...(Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : []),
        ...(Array.isArray(user?.identities) ? user.identities.map(identity => identity?.provider) : [])
    ].filter(Boolean));
    if (!providers.has('google')) {
        const error = new Error('Google sign-in is required to rate apps');
        error.status = 403;
        throw error;
    }
}

async function resolveApp(client, identifier) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier);
    const { data, error } = await client.from('store_apps').select('id,developer_id').eq(isUuid ? 'id' : 'package_name', identifier).single();
    if (error || !data) throw error || new Error('App not found');
    return data;
}

router.get('/apps/:id/ratings', async (req, res) => {
    try {
        const client = getLumaStoreSupabaseClient();
        const app = await resolveApp(client, req.params.id);
        const { data, error } = await client.from('store_app_ratings').select('rating').eq('app_id', app.id);
        if (error) throw error;
        const ratings = (data || []).map(row => Number(row.rating));
        res.json({ app_id: app.id, average: ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : 0, count: ratings.length });
    } catch (error) {
        res.status(404).json({ error: 'Ratings not found', message: error.message });
    }
});

router.get('/apps/:id/rating/me', async (req, res) => {
    try {
        const { user, token } = await getLumaStoreAuthenticatedUser(req);
        requireGoogleIdentity(user);
        const client = getLumaStoreSupabaseClient(token);
        const app = await resolveApp(client, req.params.id);
        const { data, error } = await client.from('store_app_ratings').select('rating,updated_at').eq('app_id', app.id).eq('user_id', user.id).maybeSingle();
        if (error) throw error;
        res.json({ app_id: app.id, rating: data?.rating ?? null, updated_at: data?.updated_at ?? null });
    } catch (error) {
        res.status(error.status || 401).json({ error: error.status === 403 ? 'Google sign-in required' : 'Authentication required', message: error.message });
    }
});

router.put('/apps/:id/rating/me', express.json(), async (req, res) => {
    try {
        const rating = Number(req.body?.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Invalid rating', message: 'rating must be an integer from 1 to 5' });
        const { user, token } = await getLumaStoreAuthenticatedUser(req);
        requireGoogleIdentity(user);
        const client = getLumaStoreSupabaseClient(token);
        const app = await resolveApp(client, req.params.id);
        if (app.developer_id === user.id) return res.status(403).json({ error: 'Developers cannot rate their own app' });
        const { data, error } = await client.from('store_app_ratings').upsert({ app_id: app.id, user_id: user.id, rating, updated_at: new Date().toISOString() }, { onConflict: 'app_id,user_id' }).select('rating,updated_at').single();
        if (error) throw error;
        res.json({ app_id: app.id, ...data });
    } catch (error) {
        res.status(error.status || 401).json({ error: error.status === 403 ? 'Google sign-in required' : 'Unable to save rating', message: error.message });
    }
});

router.delete('/apps/:id/rating/me', async (req, res) => {
    try {
        const { user, token } = await getLumaStoreAuthenticatedUser(req);
        requireGoogleIdentity(user);
        const client = getLumaStoreSupabaseClient(token);
        const app = await resolveApp(client, req.params.id);
        const { error } = await client.from('store_app_ratings').delete().eq('app_id', app.id).eq('user_id', user.id);
        if (error) throw error;
        res.status(204).end();
    } catch (error) {
        res.status(error.status || 401).json({ error: error.status === 403 ? 'Google sign-in required' : 'Unable to delete rating', message: error.message });
    }
});

router.get('/package-formats', (_req, res) => {
    res.json({ Linux: LINUX_PACKAGE_FORMATS });
});

module.exports = router;
