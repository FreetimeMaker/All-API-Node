const express = require('express');
const router = express.Router();
const { getLumaStoreSupabaseClient } = require('../../lib/supabase');

function normalizeApp(app, requestedPlatform = null, requestedLinuxPackageBase = null) {
    const platforms = Array.isArray(app.platforms) ? app.platforms : [];
    const selectedPlatform = requestedPlatform
        ? platforms.find(p => {
            const platformMatches = (p.platform || '').toLowerCase() === requestedPlatform.toLowerCase();
            if (!platformMatches) return false;

            if ((requestedPlatform || '').toLowerCase() === 'linux' && requestedLinuxPackageBase) {
                return (p.linux_package_base || '').toLowerCase() === requestedLinuxPackageBase.toLowerCase();
            }

            return true;
        })
        : platforms.find(p => (p.platform || '').toLowerCase() === 'android') || platforms[0] || null;

    return {
        ...app,
        category: app.category?.name || null,
        platform: selectedPlatform?.platform || null,
        linux_package_base: selectedPlatform?.linux_package_base || null,
        download_url: selectedPlatform?.download_url || null,
        file_size_mb: selectedPlatform?.file_size_mb ?? null,
        platforms
    };
}

/**
 * GET /v2/lumastore/apps
 * List Luma Store apps from the dedicated Luma Store Supabase project.
 *
 * Optional query parameters:
 * - category
 * - platform (for example Android or Linux)
 * - linux_package_base (Debian-based or RPM-based; intended for Linux)
 * - search
 */
router.get('/apps', async (req, res) => {
    try {
        const client = getLumaStoreSupabaseClient();
        if (!client) {
            return res.status(500).json({ error: 'Database connection failed' });
        }

        const { category, platform, linux_package_base: linuxPackageBase, search } = req.query;

        if (linuxPackageBase && !['debian-based', 'rpm-based'].includes(String(linuxPackageBase).toLowerCase())) {
            return res.status(400).json({
                error: 'Invalid linux_package_base',
                message: 'linux_package_base must be Debian-based or RPM-based'
            });
        }

        if (linuxPackageBase && (!platform || String(platform).toLowerCase() !== 'linux')) {
            return res.status(400).json({
                error: 'Invalid platform filter',
                message: 'linux_package_base can only be used together with platform=Linux'
            });
        }

        let query = client
            .from('store_apps')
            .select(`
                *,
                category:store_categories(name),
                platforms:store_app_platforms(platform, linux_package_base, download_url, file_size_mb)
            `);

        if (category) {
            query = query.eq('category_id', category);
        }

        if (search) {
            query = query.ilike('name', `%${search}%`);
        }

        const { data, error } = await query;
        if (error) throw error;

        let result = (data || []).map(app => normalizeApp(app, platform || null, linuxPackageBase || null));

        if (platform) {
            result = result.filter(app =>
                app.platforms.some(p => {
                    const platformMatches = (p.platform || '').toLowerCase() === String(platform).toLowerCase();
                    if (!platformMatches) return false;

                    if (String(platform).toLowerCase() === 'linux' && linuxPackageBase) {
                        return (p.linux_package_base || '').toLowerCase() === String(linuxPackageBase).toLowerCase();
                    }

                    return true;
                })
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
        const { platform, linux_package_base: linuxPackageBase } = req.query;

        if (linuxPackageBase && !['debian-based', 'rpm-based'].includes(String(linuxPackageBase).toLowerCase())) {
            return res.status(400).json({
                error: 'Invalid linux_package_base',
                message: 'linux_package_base must be Debian-based or RPM-based'
            });
        }

        if (linuxPackageBase && (!platform || String(platform).toLowerCase() !== 'linux')) {
            return res.status(400).json({
                error: 'Invalid platform filter',
                message: 'linux_package_base can only be used together with platform=Linux'
            });
        }

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
        res.json(normalizeApp(data, platform || null, linuxPackageBase || null));
    } catch (error) {
        res.status(404).json({ error: 'App not found', message: error.message });
    }
});

module.exports = router;
