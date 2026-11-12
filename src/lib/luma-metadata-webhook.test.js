const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMetadataWebhook } = require('./luma-metadata-webhook');
const id = 'ce113263-48cb-48ac-a77e-59e751607667';
const event = (table = 'luma_submissions', type = 'INSERT') => ({
  schema: 'public', table, type, record: { id, name: 'untrusted event metadata' },
});
function response() {
  return { statusCode: 200, headers: {},
    set(key, value) { this.headers[key] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
function request(body, authorization = 'Bearer test-secret') {
  return { body, get: name => name === 'authorization' ? authorization : undefined };
}

test('webhook refuses unconfigured or unauthenticated calls before database access', async () => {
  for (const [secret, auth, code] of [[undefined, '', 503], ['test-secret', '', 401],
    ['test-secret', 'Bearer wrong', 401]]) {
    const hook = createMetadataWebhook({ getSecret: () => secret,
      getClient: () => assert.fail('must not access database') });
    const res = response();
    await hook(request(event(), auth), res);
    assert.equal(res.statusCode, code);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
});

test('every insert and update synchronizes using only the trusted record identity', async () => {
  const client = {};
  const calls = [];
  const hook = createMetadataWebhook({ getSecret: () => 'test-secret', getClient: () => client,
    synchronize: async (...args) => {
      calls.push(args);
      return { changed: true, locales: ['en-US', 'de-DE', 'fr-FR'] };
    } });
  for (const table of ['luma_submissions', 'store_apps', 'store_app_platforms']) {
    for (const type of ['INSERT', 'UPDATE']) {
      const res = response();
      await hook(request(event(table, type)), res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(calls.at(-1), [client, table, id, { apply: true }]);
      assert.equal(res.body.ok, true);
      assert.deepEqual(res.body.locales, ['en-US', 'de-DE', 'fr-FR']);
    }
  }
  assert.equal(calls.length, 6);
});

test('invalid payloads cannot select arbitrary tables or records', async () => {
  const hook = createMetadataWebhook({ getSecret: () => 'test-secret',
    getClient: () => assert.fail('must not access database') });
  for (const body of [undefined, {}, { ...event(), table: 'auth.users' },
    { ...event(), schema: 'private' }, { ...event(), type: 'DELETE' },
    { ...event(), record: { id: 'not-a-uuid' } }]) {
    const res = response();
    await hook(request(body), res);
    assert.equal(res.statusCode, 400);
  }
});

test('the response waits for synchronization and reports failures instead of false success', async () => {
  let rejectSync;
  const pending = new Promise((resolve, reject) => { rejectSync = reject; });
  const hook = createMetadataWebhook({ getSecret: () => 'test-secret', getClient: () => ({}),
    synchronize: () => pending });
  const res = response();
  const original = console.error;
  const errors = [];
  console.error = message => errors.push(message);
  try {
    const completion = hook(request(event()), res);
    assert.equal(res.body, undefined);
    rejectSync(new Error('private backend details'));
    await completion;
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /retry/i);
    assert.doesNotMatch(JSON.stringify(res.body), /private backend details/);
    assert.equal(errors.length, 1);
  } finally { console.error = original; }
});
