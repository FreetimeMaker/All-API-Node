const express = require('express');
const router = express.Router();
const { getSupabaseClient, getAuthenticatedUser } = require('../../lib/supabase');

/**
 * GET /api/v2/lumastore/apps
 * List all apps with their platforms and categories
 */
router.get('/apps', async (req, res) => {
    try {
        const client = getSupabaseClient();
        if (!client) {
            return res.status(500).json({ error: 'Database connection failed' });
        }

        const { category, platform, search } = req.query;

        let query = client
            .from('store_apps')
            .select(`
                *,
                category:store_categories(name),
                platforms:store_app_platforms(platform, download_url)
            `);

        if (category) {
            query = query.eq('category_id', category);
        }

        if (search) {
            query = query.ilike('name', `%${search}%`);
        }

        const { data, error } = await query;

        if (error) throw error;

        // Filter by platform in JS if needed (or use joining logic in SQL)
        let result = data;
        if (platform) {
            result = data.filter(app =>
                app.platforms.some(p => p.platform.toLowerCase() === platform.toLowerCase())
            );
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch apps', message: error.message });
    }
});

/**
 * GET /api/v2/lumastore/apps/:id
 * Get detailed information for a specific app
 */
router.get('/apps/:id', async (req, res) => {
    try {
        const client = getSupabaseClient();
        const { id } = req.params;

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
        res.json(data);
    } catch (error) {
        res.status(404).json({ error: 'App not found', message: error.message });
    }
});

module.exports = router;
