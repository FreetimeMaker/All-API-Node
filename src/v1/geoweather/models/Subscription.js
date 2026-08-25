const { getSupabaseClient } = require('../../../lib/supabase');

const TABLE = 'geoweather_subscriptions';

const Subscription = {
    TYPES: {
        FREE: 'free',
        FREEMIUM: 'freemium',
        PREMIUM: 'premium',
    },

    FEATURES: {
        free: {
            maxLocations: 5,
            forecastDays: 7,
            notifications: false,
        },
        freemium: {
            maxLocations: 10,
            forecastDays: 3,
            notifications: true,
        },
        premium: {
            maxLocations: 15,
            forecastDays: 1,
            notifications: true,
        },
    },

    getClient() {
        return getSupabaseClient({ useServiceRole: true });
    },

    async getAll(userId, sessionId) {
        const client = this.getClient();
        if (!client) throw new Error('Supabase client not available');

        let query = client.from(TABLE).select('*');

        if (userId) {
            query = query.eq('user_id', userId);
        } else if (sessionId) {
            query = query.eq('session_id', sessionId);
        } else {
            return [];
        }

        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    async getById(id, userId, sessionId) {
        const client = this.getClient();
        if (!client) throw new Error('Supabase client not available');

        let query = client.from(TABLE).select('*').eq('id', id);

        if (userId) {
            query = query.eq('user_id', userId);
        } else if (sessionId) {
            query = query.eq('session_id', sessionId);
        } else {
            throw new Error('No identity provided');
        }

        const { data, error } = await query.single();
        if (error) throw error;
        return data;
    },

    async create(userId, sessionId, { location, type = this.TYPES.DAILY, coordinates = null }) {
        const client = this.getClient();
        if (!client) throw new Error('Supabase client not available');

        const record = {
            user_id: userId || null,
            session_id: sessionId || null,
            location,
            type,
            coordinates: coordinates ? JSON.stringify(coordinates) : null,
        };

        const { data, error } = await client
            .from(TABLE)
            .insert(record)
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    async update(id, userId, sessionId, updates) {
        const client = this.getClient();
        if (!client) throw new Error('Supabase client not available');

        const allowed = {};
        if (updates.location) allowed.location = updates.location;
        if (updates.type) allowed.type = updates.type;
        if (updates.coordinates !== undefined) {
            allowed.coordinates = updates.coordinates ? JSON.stringify(updates.coordinates) : null;
        }
        if (updates.is_active !== undefined) allowed.is_active = updates.is_active;

        if (Object.keys(allowed).length === 0) {
            throw new Error('No valid fields to update');
        }

        let query = client.from(TABLE).update(allowed).eq('id', id);

        if (userId) {
            query = query.eq('user_id', userId);
        } else if (sessionId) {
            query = query.eq('session_id', sessionId);
        } else {
            throw new Error('No identity provided');
        }

        const { data, error } = await query.select().single();
        if (error) throw error;
        return data;
    },

    async remove(id, userId, sessionId) {
        const client = this.getClient();
        if (!client) throw new Error('Supabase client not available');

        let query = client.from(TABLE).delete().eq('id', id);

        if (userId) {
            query = query.eq('user_id', userId);
        } else if (sessionId) {
            query = query.eq('session_id', sessionId);
        } else {
            throw new Error('No identity provided');
        }

        const { data, error } = await query.select().single();
        if (error) throw error;
        return data;
    },

    async getActiveCount(userId, sessionId) {
        const client = this.getClient();
        if (!client) throw new Error('Supabase client not available');

        let query = client
            .from(TABLE)
            .select('*', { count: 'exact', head: true })
            .eq('is_active', true);

        if (userId) {
            query = query.eq('user_id', userId);
        } else if (sessionId) {
            query = query.eq('session_id', sessionId);
        } else {
            return 0;
        }

        const { count, error } = await query;
        if (error) throw error;
        return count || 0;
    },

    getFeatures(type) {
        return this.FEATURES[type] || this.FEATURES.daily;
    },
};

module.exports = Subscription;
