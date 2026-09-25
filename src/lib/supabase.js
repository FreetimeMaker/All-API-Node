const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || null;

// Luma Store uses its own Supabase project. Keep the generic Supabase client
// untouched so other API areas continue using the existing project.
const lumaStoreSupabaseUrl =
    process.env.LUMASTORE_SUPABASE_URL ||
    'https://ndlaevedujqxhygbyxfh.supabase.co';
const lumaStoreSupabasePublishableKey =
    process.env.LUMASTORE_SUPABASE_PUBLISHABLE_KEY ||
    'sb_publishable_HlppI4ILiXV7DZkpyrDEhQ_ytb2vV6g';

// Überprüfung der erforderlichen Umgebungsvariablen
if (!supabaseUrl) {
    console.warn('WARNUNG: SUPABASE_URL ist nicht in der .env Datei definiert.');
}
if (!supabaseAnonKey) {
    console.warn('WARNUNG: SUPABASE_ANON_KEY ist nicht in der .env Datei definiert.');
}

function createSupabaseClient(url, key) {
    if (!url || !key) {
        return null;
    }

    return createClient(url, key, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    });
}

function getSupabaseClient({ useServiceRole = false } = {}) {
    const url = supabaseUrl;
    const key = useServiceRole ? (supabaseServiceRoleKey || supabaseAnonKey) : supabaseAnonKey;

    return createSupabaseClient(url, key);
}

function getLumaStoreSupabaseClient(accessToken = null) {
    return createClient(lumaStoreSupabaseUrl, lumaStoreSupabasePublishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined
    });
}

async function getLumaStoreAuthenticatedUser(req) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    if (!token) throw new Error('Authorization header with Bearer token is required');

    const client = getLumaStoreSupabaseClient();
    if (!client) throw new Error('Luma Store Supabase credentials are not configured');

    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) throw error || new Error('Unable to validate Luma Store user token');
    return { user: data.user, token };
}

async function getAuthenticatedUser(req, { requireConfig = true } = {}) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    if (!token) {
        throw new Error('Authorization header with Bearer token is required');
    }

    const client = getSupabaseClient();
    if (!client) {
        if (requireConfig) {
            throw new Error('Supabase credentials are not configured');
        }
        return null;
    }

    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) {
        throw error || new Error('Unable to validate Supabase user token');
    }

    return data.user;
}

module.exports = {
    getSupabaseClient,
    getLumaStoreSupabaseClient,
    getLumaStoreAuthenticatedUser,
    getAuthenticatedUser
};
