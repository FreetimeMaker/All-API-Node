const express = require('express');
const router = express.Router();
const { getAuthenticatedUser, getSupabaseClient } = require('../../lib/supabase');

/**
 * Helper to build full image URL for assets hosted on Vercel.
 */
const getFullImageUrl = (req, imageUrl) => {
    if (!imageUrl || imageUrl.startsWith('http')) return imageUrl;
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    return `${protocol}://${host}${imageUrl}`;
};

/**
 * Helper to adjust cost based on platform and specific app.
 * Wallpapers are free ONLY in the specific Android app (e.g., Wallora App),
 * but cost money on Web and other apps.
 */
const adjustWallpaperData = (wallpaper, req) => {
    const userAgent = req.headers['user-agent'] || '';
    const platformHeader = req.headers['x-platform'] || '';
    const appIdHeader = req.headers['x-app-id'] || req.headers['x-requested-with'] || '';

    // Define the package name/app ID that is allowed to get wallpapers for free
    const ALLOWED_APP_ID = 'com.freetime.wallora';

    const isAndroid = userAgent.toLowerCase().includes('android') ||
                      platformHeader.toLowerCase() === 'android';

    // Check if it's the specific authorized app
    const isAuthorizedApp = appIdHeader === ALLOWED_APP_ID;

    const adjusted = {
        ...wallpaper,
        image_url: getFullImageUrl(req, wallpaper.image_url)
    };

    // Only free if it's Android AND the correct App ID
    if (isAndroid && isAuthorizedApp) {
        return { ...adjusted, cost: 0.00, original_cost: wallpaper.cost };
    }

    return adjusted;
};

// GET /api/v1/wallora/wallpapers - List all wallpapers from DB
router.get('/', async (req, res) => {
    try {
        const { category } = req.query;
        const client = getSupabaseClient();

        if (!client) {
            return res.status(503).json({ error: 'Database connection not available' });
        }

        let query = client
            .from('wallora_wallpapers')
            .select('*');

        if (category) {
            query = query.eq('category', category);
        }

        const { data, error } = await query;

        if (error) throw error;

        // Adjust data based on platform and host
        const adjustedData = (data || []).map(w => adjustWallpaperData(w, req));
        res.json(adjustedData);
    } catch (error) {
        console.error('Error fetching wallpapers:', error.message);
        res.status(500).json({ error: 'Failed to fetch wallpapers', details: error.message });
    }
});

// GET /api/v1/wallora/wallpapers/:id - Get wallpaper details from DB
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const client = getSupabaseClient();

        if (!client) {
            return res.status(503).json({ error: 'Database connection not available' });
        }

        const { data, error } = await client
            .from('wallora_wallpapers')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        // Adjust data based on platform and host
        res.json(adjustWallpaperData(data, req));
    } catch (error) {
        console.error('Error fetching wallpaper details:', error.message);
        res.status(404).json({ error: 'Wallpaper not found' });
    }
});

// POST /api/v1/wallora/wallpapers/:id/purchase - Purchase a wallpaper
router.post('/:id/purchase', async (req, res) => {
    try {
        const { id } = req.params;
        const user = await getAuthenticatedUser(req);

        const client = getSupabaseClient();
        if (!client) {
            return res.status(503).json({ error: 'Cloud storage unavailable' });
        }

        // Check if wallpaper exists and get its cost
        const { data: wallpaper, error: wallError } = await client
            .from('wallora_wallpapers')
            .select('*')
            .eq('id', id)
            .single();

        if (wallError || !wallpaper) {
            return res.status(404).json({ error: 'Wallpaper not found' });
        }

        // Adjust data for the response
        const adjustedWallpaper = adjustWallpaperData(wallpaper, req);

        // Record the purchase
        const { data, error } = await client
            .from('wallora_purchases')
            .insert({ user_id: user.id, wallpaper_id: id })
            .select();

        if (error) {
            if (error.code === '23505') { // Unique violation
                return res.status(400).json({ error: 'Wallpaper already purchased' });
            }
            throw error;
        }

        res.status(201).json({
            message: adjustedWallpaper.cost === 0 ? 'Wallpaper added to library' : 'Purchase successful',
            cost: adjustedWallpaper.cost,
            data
        });
    } catch (error) {
        res.status(error.message.includes('Authorization') ? 401 : 500).json({
            error: 'Purchase failed',
            details: error.message
        });
    }
});

// POST /api/v1/wallora/wallpapers - Add a new wallpaper
router.post('/', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const wallpaperData = {
            ...req.body,
            created_by: user.id
        };

        const client = getSupabaseClient();
        if (!client) {
            return res.status(503).json({ error: 'Cloud storage unavailable' });
        }

        const { data, error } = await client
            .from('wallora_wallpapers')
            .upsert(wallpaperData)
            .select();

        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        res.status(error.message.includes('Authorization') ? 401 : 400).json({
            error: 'Failed to save wallpaper',
            details: error.message
        });
    }
});

module.exports = router;
