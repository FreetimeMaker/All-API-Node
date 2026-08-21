const express = require('express');
const router = express.Router();
const { getAuthenticatedUser, getSupabaseClient } = require('../../lib/supabase');

// Mock data for initial testing if Supabase is not available or table is empty
const mockApps = [
    { id: '1', name: 'App One', description: 'A cool open source app', likes: 10, developer: 'Dev A' },
    { id: '2', name: 'App Two', description: 'Another great tool', likes: 5, developer: 'Dev B' }
];

// GET /api/v1/fdows/apps - List all apps
router.get('/', async (req, res) => {
    try {
        const client = getSupabaseClient();
        if (!client) {
            return res.json(mockApps);
        }

        const { data, error } = await client
            .from('fdows_apps')
            .select('*');

        if (error) throw error;
        res.json(data && data.length > 0 ? data : mockApps);
    } catch (error) {
        console.error('Error fetching apps:', error.message);
        res.status(500).json({ error: 'Failed to fetch apps', details: error.message });
    }
});

// GET /api/v1/fdows/apps/:id - Get app details
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const client = getSupabaseClient();

        if (!client) {
            const app = mockApps.find(a => a.id === id);
            return app ? res.json(app) : res.status(404).json({ error: 'App not found' });
        }

        const { data, error } = await client
            .from('fdows_apps')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(404).json({ error: 'App not found' });
    }
});

// POST /api/v1/fdows/apps/:id/like - Like an app
router.post('/:id/like', async (req, res) => {
    const { id } = req.params;
    let user = null;

    // Check if user is authenticated
    try {
        user = await getAuthenticatedUser(req, { requireConfig: false });
    } catch (e) {
        // Not authenticated
        user = null;
    }

    if (!user) {
        // Return success but indicate it's local
        return res.status(200).json({
            message: 'Like accepted (Local Storage)',
            storage: 'local',
            appId: id,
            info: 'User not logged in. Please save this like in local storage on the client.'
        });
    }

    // Authenticated: Persist to Supabase
    try {
        const client = getSupabaseClient();
        if (!client) throw new Error('Supabase client not available');

        // Insert or update like in a hypothetical 'fdows_likes' table
        const { data, error } = await client
            .from('fdows_likes')
            .upsert({ user_id: user.id, app_id: id, created_at: new Date().toISOString() })
            .select();

        if (error) throw error;

        return res.status(200).json({
            message: 'Like saved successfully',
            storage: 'cloud',
            user: user.id,
            appId: id,
            data
        });
    } catch (error) {
        console.error('Error saving like to cloud:', error.message);
        return res.status(500).json({
            error: 'Failed to save like to cloud',
            message: error.message,
            storage: 'none'
        });
    }
});

// POST /api/v1/fdows/apps - Add or update an app (Admin or developer check could be added here)
router.post('/', async (req, res) => {
    try {
        const appData = req.body;
        const client = getSupabaseClient();

        if (!client) {
            return res.status(503).json({ error: 'Cloud storage unavailable' });
        }

        const { data, error } = await client
            .from('fdows_apps')
            .upsert(appData)
            .select();

        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        res.status(400).json({ error: 'Failed to save app', details: error.message });
    }
});

module.exports = router;
