const { getSupabaseClient } = require('../../../lib/supabase');

const TABLE = 'geoweather_codes';

const Code = {
    getClient() {
        return getSupabaseClient({ useServiceRole: true });
    },

    async findByCode(code) {
        const client = this.getClient();
        if (!client) throw new Error('Supabase client not available');

        const { data, error } = await client
            .from(TABLE)
            .select('*')
            .eq('code', code.toUpperCase())
            .single();

        if (error) throw error;
        return data;
    },

    async redeem(code, userId) {
        const client = this.getClient();
        if (!client) throw new Error('Supabase client not available');

        const existing = await this.findByCode(code);

        if (existing.is_used) {
            throw new Error('Code already used');
        }

        return { code: existing, type: existing.type };
    },

    async markAsUsed(codeId, userId) {
        const client = this.getClient();
        if (!client) throw new Error('Supabase client not available');

        const { data, error } = await client
            .from(TABLE)
            .update({
                is_used: true,
                used_by: userId,
                used_at: new Date().toISOString(),
            })
            .eq('id', codeId)
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    async isCodeValid(code) {
        try {
            const existing = await this.findByCode(code);
            return !existing.is_used;
        } catch {
            return false;
        }
    },
};

module.exports = Code;
