const express = require('express');
const router = express.Router();
const { getLumaStoreSupabaseClient } = require('../../lib/supabase');

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

router.get('/package-formats', (_req, res) => {
    res.json({ Linux: LINUX_PACKAGE_FORMATS });
});

module.exports = router;
