const router = require('express').Router();
const { getAuthenticatedUser, getSupabaseClient } = require('../../lib/supabase');

const linkedAccounts = [];

function getUserLinkedAccounts(userId) {
    return linkedAccounts.filter(account => account.userId === userId);
}

function getBearerToken(req) {
    const authHeader = req.headers.authorization || '';
    return authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
}

router.get('/config', (req, res) => {
    const client = getSupabaseClient();

    res.status(200).json({
        configured: Boolean(client),
        hasUrl: Boolean(process.env.SUPABASE_URL),
        hasAnonKey: Boolean(process.env.SUPABASE_ANON_KEY)
    });
});

async function startOAuthLogin(req, res, providerOverride) {
    try {
        const provider = typeof providerOverride === 'string'
            ? providerOverride
            : (typeof req.body?.provider === 'string' ? req.body.provider : '');

        const normalizedProvider = provider.trim().toLowerCase();

        if (!normalizedProvider) {
            return res.status(400).json({
                error: 'Validation error',
                message: 'provider is required, e.g. github, google, gitlab'
            });
        }

        const client = getSupabaseClient();
        if (!client) {
            return res.status(500).json({
                error: 'Configuration error',
                message: 'Supabase credentials are not configured'
            });
        }

        const envDefault = process.env.SUPABASE_DEFAULT_REDIRECT;
        const forwardedProto = (req.headers['x-forwarded-proto'] || req.protocol || '').split(',')[0];
        const forwardedHost = req.headers['x-forwarded-host'] || req.headers['host'] || '';
        const proto = forwardedProto || req.protocol || 'http';
        const host = forwardedHost || req.get('host') || 'localhost:3000';
        const base = envDefault ? envDefault.replace(/\/+$/, '') : `${proto}://${host}`;
        // Note: Supabase should redirect back to the server route that handles the callback
        const defaultCallbackPath = '/api/v1/auth/callback';
        const redirectTo = req.body?.redirectTo || req.query?.redirectTo || `${base}${defaultCallbackPath}`;

        const { data, error } = await client.auth.signInWithOAuth({
            provider: normalizedProvider,
            options: {
                redirectTo
            }
        });

        if (error) {
            return res.status(400).json({
                error: 'OAuth login failed',
                message: error.message
            });
        }

        // If this is a browser GET request (or client expects HTML), redirect directly
        const accept = (req.headers.accept || '').toLowerCase();
        const isBrowserGet = req.method === 'GET' || accept.includes('text/html');
        const redirectUrl = data?.url ?? null;

        if (isBrowserGet && redirectUrl) {
            return res.redirect(302, redirectUrl);
        }

        return res.status(200).json({
            message: 'OAuth login initiated',
            provider: normalizedProvider,
            redirectUrl,
            redirectTo
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Login failed',
            message: error.message
        });
    }
}

router.get('/login', (req, res) => {
    const provider = typeof req.query?.provider === 'string' ? req.query.provider : '';
    return startOAuthLogin(req, res, provider);
});

router.get('/login/:provider', (req, res) => {
    return startOAuthLogin(req, res, req.params.provider);
});

router.post('/login', async (req, res) => {
    return startOAuthLogin(req, res);
});

router.post('/logout', async (req, res) => {
    try {
        const token = getBearerToken(req);
        const client = getSupabaseClient();
        let user = null;

        if (token) {
            try {
                user = await getAuthenticatedUser(req, { requireConfig: false });
            } catch (error) {
                user = null;
            }
        }

        if (token && client) {
            try {
                await client.auth.signOut({ scope: 'global' });
            } catch (error) {
                // Ignore client-side signOut failures here; the API still treats the token as invalidated.
            }
        }

        return res.status(200).json({
            message: 'Logout successful',
            user: user ? { id: user.id, email: user.email } : null
        });
    } catch (error) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: error.message
        });
    }
});

router.get('/me', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        res.status(200).json({
            user,
            linkedAccounts: getUserLinkedAccounts(user.id)
        });
    } catch (error) {
        res.status(401).json({
            error: 'Unauthorized',
            message: error.message
        });
    }
});

router.get('/linked-accounts', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        res.status(200).json({
            count: getUserLinkedAccounts(user.id).length,
            accounts: getUserLinkedAccounts(user.id)
        });
    } catch (error) {
        res.status(401).json({
            error: 'Unauthorized',
            message: error.message
        });
    }
});

router.post('/link-account', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const { accountId, provider = 'supabase', providerUserId, metadata = {} } = req.body || {};

        if (!accountId || typeof accountId !== 'string' || accountId.trim().length === 0) {
            return res.status(400).json({
                error: 'Validation error',
                message: 'accountId has to be a non-empty string'
            });
        }

        const existingAccount = linkedAccounts.find(account =>
            account.userId === user.id &&
            account.accountId === accountId &&
            account.provider === provider
        );

        if (existingAccount) {
            return res.status(200).json({
                message: 'Account already linked',
                account: existingAccount
            });
        }

        const linkedAccount = {
            id: `acct_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            userId: user.id,
            accountId: accountId.trim(),
            provider,
            providerUserId: providerUserId || user.id,
            metadata,
            linkedAt: new Date().toISOString()
        };

        linkedAccounts.push(linkedAccount);

        return res.status(201).json({
            message: 'Account linked successfully',
            account: linkedAccount
        });
    } catch (error) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: error.message
        });
    }
});

router.delete('/link-account/:accountId', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const { accountId } = req.params;

        const index = linkedAccounts.findIndex(account =>
            account.userId === user.id &&
            account.accountId === accountId
        );

        if (index === -1) {
            return res.status(404).json({
                error: 'Not found',
                message: 'Linked account was not found for this user'
            });
        }

        const [removed] = linkedAccounts.splice(index, 1);

        return res.status(200).json({
            message: 'Account unlinked successfully',
            account: removed
        });
    } catch (error) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: error.message
        });
    }
});

// OAuth callback endpoints
router.get('/callback', (req, res) => {
    // Minimal page to capture URL fragment (access_token) and POST it to the server.
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Auth callback</title>
  </head>
  <body>
    <p id="status">Processing login...</p>
    <script>
      (async function(){
        try {
          const hash = window.location.hash ? window.location.hash.substring(1) : '';
          const params = new URLSearchParams(hash || window.location.search);
          const payload = {};
          for (const [k,v] of params) payload[k]=v;

          // If no access_token found, show message
          if (!payload.access_token) {
            document.getElementById('status').innerText = 'No access token found in URL. You may close this window.';
            return;
          }

          const resp = await fetch('/api/v1/auth/callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          const json = await resp.json();
          if (resp.ok) {
            document.getElementById('status').innerText = 'Login successful. You can close this window.';
          } else {
            document.getElementById('status').innerText = 'Login failed: ' + (json?.message || JSON.stringify(json));
          }
        } catch (err) {
          document.getElementById('status').innerText = 'Error: ' + err.message;
        }
      })();
    </script>
  </body>
</html>`;

    res.set('Content-Type', 'text/html; charset=utf-8').status(200).send(html);
});

router.post('/callback', async (req, res) => {
    try {
        const { access_token, refresh_token } = req.body || {};

        if (!access_token) {
            return res.status(400).json({ error: 'Validation error', message: 'access_token is required' });
        }

        const client = getSupabaseClient();
        if (!client) {
            return res.status(500).json({ error: 'Configuration error', message: 'Supabase credentials are not configured' });
        }

        // Validate token and get user
        const { data, error } = await client.auth.getUser(access_token);
        if (error || !data?.user) {
            return res.status(401).json({ error: 'Invalid token', message: error?.message || 'Unable to validate token' });
        }

        // Respond with the authenticated user and minimal session info
        return res.status(200).json({ user: data.user, access_token, refresh_token });
    } catch (err) {
        return res.status(500).json({ error: 'Callback failed', message: err.message });
    }
});

module.exports = router;
