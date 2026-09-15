const express = require('express');
const router = express.Router();
const { getLumaStoreSupabaseClient } = require('../../lib/supabase');

function normalizeApp(app, requestedPlatform = null) {
    const platforms = Array.isArray(app.platforms) ? app.platforms : [];
    const selectedPlatform = requestedPlatform
        ? platforms.find(p => (p.platform || '').toLowerCase() === requestedPlatform.toLowerCase())
        : platforms.find(p => (p.platform || '').toLowerCase() === 'android') || platforms[0] || null;

    return {
        ...app,
        category: app.category?.name || null,
        platform: selectedPlatform?.platform || null,
        download_url: selectedPlatform?.download_url || null,
        file_size_mb: selectedPlatform?.file_size_mb ?? null,
        platforms
    };
}

/**
 * GET /v2/lumastore/apps
 * List Luma Store apps from the dedicated Luma Store Supabase project.
 */
router.get('/apps', async (req, res) => {
    try {
        const client = getLumaStoreSupabaseClient();
        if (!client) {
            return res.status(500).json({ error: 'Database connection failed' });
        }

        const { category, platform, search } = req.query;

        let query = client
            .from('store_apps')
            .select(`
                *,
                category:store_categories(name),
                platforms:store_app_platforms(platform, download_url, file_size_mb)
            `);

        if (category) {
            query = query.eq('category_id', category);
        }

        if (search) {
            query = query.ilike('name', `%${search}%`);
        }

        const { data, error } = await query;
        if (error) throw error;

        let result = (data || []).map(app => normalizeApp(app, platform || null));

        if (platform) {
            result = result.filter(app =>
                app.platforms.some(p => (p.platform || '').toLowerCase() === platform.toLowerCase())
            );
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch apps', message: error.message });
    }
});

/**
 * GET /v2/lumastore/apps/:id
 * Get detailed information for a specific app.
 */
router.get('/apps/:id', async (req, res) => {
    try {
        const client = getLumaStoreSupabaseClient();
        if (!client) {
            return res.status(500).json({ error: 'Database connection failed' });
        }

        const { id } = req.params;
        const { platform } = req.query;

        const { data, error } = await client
            .from('store_apps')
            .select(`
                *,
                category:store_categories(*),
                platforms:store_app_platforms(*)
            `)
            .eq('id', id)
            .single();

        if (error) throw error;
        res.json(normalizeApp(data, platform || null));
    } catch (error) {
        res.status(404).json({ error: 'App not found', message: error.message });
    }
});

module.exports = router;
