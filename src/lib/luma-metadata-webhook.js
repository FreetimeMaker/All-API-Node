const { createHash, timingSafeEqual } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { getLumaStoreSupabaseClient } = require('./supabase');
const { syncRecord } = require('./sync-luma-metadata');

function serviceClient() {
  const key = process.env.LUMASTORE_SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('LUMASTORE_SUPABASE_SERVICE_ROLE_KEY is not configured');
  const reader = getLumaStoreSupabaseClient();
  return createClient(reader.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function createMetadataWebhook({ getClient = serviceClient, synchronize = syncRecord,
  getSecret = () => process.env.LUMASTORE_METADATA_WEBHOOK_SECRET } = {}) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const secret = getSecret();
    if (!secret) return res.status(503).json({ error: 'Metadata webhook is not configured' });
    const digest = value => createHash('sha256').update(value).digest();
    if (!timingSafeEqual(digest(req.get('authorization') || ''), digest(`Bearer ${secret}`)))
      return res.status(401).json({ error: 'Invalid webhook authorization' });
    const { schema, table, type, record } = req.body || {};
    if (schema !== 'public' || !['store_apps', 'luma_submissions', 'store_app_platforms'].includes(table) ||
        !['INSERT', 'UPDATE'].includes(type) ||
        typeof record?.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(record.id))
      return res.status(400).json({ error: 'Expected a public Luma Store INSERT/UPDATE database webhook' });
    try {
      // Use only the event's identity. Never trust metadata or ownership from its payload.
      const result = await synchronize(getClient(), table, record.id, { apply: true });
      return res.json({ ok: true, ...result });
    } catch (error) {
      console.error(`Luma metadata webhook ${table}/${record.id}: ${error.message}`);
      // Await the entire sync: serverless runtimes may stop work after a response.
      return res.status(503).json({ error: 'Metadata sync failed or incomplete; retry this event' });
    }
  };
}

module.exports = { createMetadataWebhook };
