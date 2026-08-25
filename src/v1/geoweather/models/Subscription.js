const { getSupabaseClient } = require('../../../lib/supabase');

const TABLE = 'geoweather_subscriptions';

const Subscription = {
    TYPES: {
        DAILY: 'daily',
        HOURLY: 'hourly',
        ALERTS: 'alerts',
    },

    FEATURES: {
        daily: {
            maxLocations: 5,
            forecastDays: 7,
            notifications: false,
        },
        hourly: {
            maxLocations: 10,
            forecastDays: 3,
            notifications: true,
        },
        alerts: {
            maxLocations: 15,
            forecastDays: 1,
            notifications: true,
        },
    },

    getClient() {
        return getSupabaseClient();
    },

    async getAll(userId) {
        const client = this.getClient();
        if (!client) throw new Error('Supabase client not available');

        const { data, error } = await client
            .from(TABLE)
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    },

    async getById(id, userId) {
        const client = this.getClient();
        if (!client) throw new Error('Supabase client not available');

        const { data, error } = await client
            .from(TABLE)
            .select('*')
            .eq('id', id)
            .eq('user_id', userId)
            .single();

        if (error) throw error;
        return data;
    },

    async create(userId, { location, type = this.TYPES.DAILY, coordinates = null }) {
        const client = this.getClient();
        if (!client) throw new Error('Supabase client not available');

        const { data, error } = await client
            .from(TABLE)
            .insert({
                user_id: userId,
                location,
                type,
                coordinates: coordinates ? JSON.stringify(coordinates) : null,
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    async update(id, userId, updates) {
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

        const { data, error } = await client
            .from(TABLE)
            .update(allowed)
            .eq('id', id)
            .eq('user_id', userId)
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    async remove(id, userId) {
        const client = this.getClient();
        if (!client) throw new Error('Supabase client not available');

        const { data, error } = await client
            .from(TABLE)
            .delete()
            .eq('id', id)
            .eq('user_id', userId)
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    async getActiveCount(userId) {
        const client = this.getClient();
        if (!client) throw new Error('Supabase client not available');

        const { count, error } = await client
            .from(TABLE)
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('is_active', true);

        if (error) throw error;
        return count || 0;
    },

    getFeatures(type) {
        return this.FEATURES[type] || this.FEATURES.daily;
    },

    canAddLocation(userId, type) {
        const features = this.getFeatures(type);
        return async () => {
            const count = await this.getActiveCount(userId);
            return count < features.maxLocations;
        };
    },
};

module.exports = Subscription;
