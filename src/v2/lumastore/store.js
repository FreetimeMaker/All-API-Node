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

async function addDownloadCounts(client, apps) {
    const rows = Array.isArray(apps) ? apps : [apps];
    if (!rows.length) return rows;

    // Raw download events are intentionally protected by RLS. Read only the
    // pre-aggregated public metric through the dedicated RPC instead.
    const withCounts = await Promise.all(rows.map(async (app) => {
        if (!app?.id) return { ...app, download_count: 0 };
        const { data, error } = await client.rpc('luma_app_download_count', { target_app_id: app.id });
        return { ...app, download_count: error ? 0 : Number(data || 0) };
    }));
    return withCounts;
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
        query = query.is('archived_at', null);
        if (category) query = query.eq('category_id', category);
        if (search) query = query.ilike('name', `%${search}%`);

        const { data, error } = await query;
        if (error) throw error;
        const appsWithDownloads = await addDownloadCounts(client, data || []);
        let result = appsWithDownloads.map(app => normalizeApp(app, platform || null, packageFormatFilter));
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
        const [appWithDownloads] = await addDownloadCounts(client, data);
        res.json(normalizeApp(appWithDownloads, platform || null, packageFormatFilter));
    } catch (error) {
        res.status(404).json({ error: 'App not found', message: error.message });
    }
});


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

router.get('/apps/:id/reviews', async (req, res) => {
    try {
        const client = getLumaStoreSupabaseClient();
        const app = await resolveApp(client, req.params.id);
        const sort = String(req.query.sort || 'newest').toLowerCase();
        const { data, error } = await client
            .from('store_app_ratings')
            .select('rating,review_text,updated_at')
            .eq('app_id', app.id)
            .not('review_text', 'is', null)
            .order(sort === 'highest' ? 'rating' : 'updated_at', { ascending: sort === 'oldest' })
            .limit(100);
        if (error) throw error;
        res.json((data || [])
            .filter(row => typeof row.review_text === 'string' && row.review_text.trim())
            .map(row => ({
                rating: Number(row.rating),
                review_text: row.review_text.trim(),
                updated_at: row.updated_at
            })));
    } catch (error) {
        res.status(404).json({ error: 'Reviews not found', message: error.message });
    }
});

router.get('/favorites/me', async (req, res) => {
    try {
        const { user, token } = await getLumaStoreAuthenticatedUser(req);
        const client = getLumaStoreSupabaseClient(token);
        const { data, error } = await client
            .from('store_saved_apps')
            .select('app_id,created_at,app:store_apps(id,package_name,name,icon_url)')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        res.status(error.status || 401).json({ error: 'Authentication required', message: error.message });
    }
});

router.get('/apps/:id/favorite/me', async (req, res) => {
    try {
        const { user, token } = await getLumaStoreAuthenticatedUser(req);
        const client = getLumaStoreSupabaseClient(token);
        const app = await resolveApp(client, req.params.id);
        const { data, error } = await client.from('store_saved_apps').select('app_id').eq('app_id', app.id).eq('user_id', user.id).maybeSingle();
        if (error) throw error;
        res.json({ app_id: app.id, favorite: Boolean(data) });
    } catch (error) {
        res.status(error.status || 401).json({ error: 'Authentication required', message: error.message });
    }
});

router.put('/apps/:id/favorite/me', async (req, res) => {
    try {
        const { user, token } = await getLumaStoreAuthenticatedUser(req);
        const client = getLumaStoreSupabaseClient(token);
        const app = await resolveApp(client, req.params.id);
        const { data, error } = await client.from('store_saved_apps').upsert({ app_id: app.id, user_id: user.id }, { onConflict: 'app_id,user_id' }).select('app_id,created_at').single();
        if (error) throw error;
        res.json({ ...data, favorite: true });
    } catch (error) {
        res.status(error.status || 401).json({ error: 'Unable to save favorite', message: error.message });
    }
});

router.delete('/apps/:id/favorite/me', async (req, res) => {
    try {
        const { user, token } = await getLumaStoreAuthenticatedUser(req);
        const client = getLumaStoreSupabaseClient(token);
        const app = await resolveApp(client, req.params.id);
        const { error } = await client.from('store_saved_apps').delete().eq('app_id', app.id).eq('user_id', user.id);
        if (error) throw error;
        res.status(204).end();
    } catch (error) {
        res.status(error.status || 401).json({ error: 'Unable to remove favorite', message: error.message });
    }
});

router.get('/ratings/me', async (req, res) => {
    try {
        const { user, token } = await getLumaStoreAuthenticatedUser(req);
        const client = getLumaStoreSupabaseClient(token);
        const { data, error } = await client
            .from('store_app_ratings')
            .select('app_id,rating,review_text,updated_at,app:store_apps(id,package_name,name,icon_url)')
            .eq('user_id', user.id)
            .order('updated_at', { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        res.status(error.status || 401).json({ error: 'Authentication required', message: error.message });
    }
});

router.get('/apps/:id/rating/me', async (req, res) => {
    try {
        const { user, token } = await getLumaStoreAuthenticatedUser(req);
        const client = getLumaStoreSupabaseClient(token);
        const app = await resolveApp(client, req.params.id);
        const { data, error } = await client.from('store_app_ratings').select('rating,review_text,updated_at').eq('app_id', app.id).eq('user_id', user.id).maybeSingle();
        if (error) throw error;
        res.json({ app_id: app.id, rating: data?.rating ?? null, review_text: data?.review_text ?? null, updated_at: data?.updated_at ?? null });
    } catch (error) {
        res.status(error.status || 401).json({ error: error.status === 403 ? 'Google sign-in required' : 'Authentication required', message: error.message });
    }
});

router.put('/apps/:id/rating/me', express.json(), async (req, res) => {
    try {
        const rating = Number(req.body?.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Invalid rating', message: 'rating must be an integer from 1 to 5' });
        const reviewText = typeof req.body?.review_text === 'string' ? req.body.review_text.trim() : '';
        if (reviewText.length > 2000) return res.status(400).json({ error: 'Review too long', message: 'review_text must be 2000 characters or fewer' });
        const { user, token } = await getLumaStoreAuthenticatedUser(req);
        const client = getLumaStoreSupabaseClient(token);
        const app = await resolveApp(client, req.params.id);
        if (app.developer_id === user.id) return res.status(403).json({ error: 'Developers cannot rate their own app' });
        const { data, error } = await client.from('store_app_ratings').upsert({ app_id: app.id, user_id: user.id, rating, review_text: reviewText || null, updated_at: new Date().toISOString() }, { onConflict: 'app_id,user_id' }).select('rating,review_text,updated_at').single();
        if (error) throw error;
        res.json({ app_id: app.id, ...data });
    } catch (error) {
        const status = error.status || 401;
        res.status(status).json({ error: status === 403 ? error.message : 'Unable to save rating', message: error.message });
    }
});

router.delete('/apps/:id/rating/me', async (req, res) => {
    try {
        const { user, token } = await getLumaStoreAuthenticatedUser(req);
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
