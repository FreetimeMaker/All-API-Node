const express = require('express');
const router = express.Router();
const { getAuthenticatedUser, getSupabaseClient } = require('../../lib/supabase');

// Mock data for initial testing
const mockWallpapers = [
    { id: '1', name: 'Neon City', description: 'A futuristic city at night', image_url: 'https://example.com/neon.jpg', cost: 0.99 },
    { id: '2', name: 'Forest Mist', description: 'Quiet forest in the morning', image_url: 'https://example.com/forest.jpg', cost: 0.00 }
];

// GET /api/v1/wallora/wallpapers - List all wallpapers
router.get('/', async (req, res) => {
    try {
        const client = getSupabaseClient();
        if (!client) {
            return res.json(mockWallpapers);
        }

        const { data, error } = await client
            .from('wallora_wallpapers')
            .select('*');

        if (error) throw error;
        res.json(data && data.length > 0 ? data : mockWallpapers);
    } catch (error) {
        console.error('Error fetching wallpapers:', error.message);
        res.status(500).json({ error: 'Failed to fetch wallpapers', details: error.message });
    }
});

// GET /api/v1/wallora/wallpapers/:id - Get wallpaper details
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const client = getSupabaseClient();

        if (!client) {
            const wallpaper = mockWallpapers.find(w => w.id === id);
            return wallpaper ? res.json(wallpaper) : res.status(404).json({ error: 'Wallpaper not found' });
        }

        const { data, error } = await client
            .from('wallora_wallpapers')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
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
            .select('cost')
            .eq('id', id)
            .single();

        if (wallError || !wallpaper) {
            return res.status(404).json({ error: 'Wallpaper not found' });
        }

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
            message: 'Purchase successful',
            cost: wallpaper.cost,
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
