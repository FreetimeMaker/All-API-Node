const router = require('express').Router();
const { getAuthenticatedUser, getSupabaseClient } = require('../../lib/supabase');

const linkedAccounts = [];

// GitHub OAuth Check (falls lokal benötigt)
if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    console.warn('HINWEIS: GitHub OAuth Zugangsdaten (GITHUB_CLIENT_ID/SECRET) fehlen in .env.');
}

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
        if (!envDefault) {
            console.warn('HINWEIS: SUPABASE_DEFAULT_REDIRECT ist nicht gesetzt. Nutze automatische Host-Erkennung.');
        }

        const forwardedProto = (req.headers['x-forwarded-proto'] || req.protocol || '').split(',')[0];
        const forwardedHost = req.headers['x-forwarded-host'] || req.headers['host'] || '';
        const proto = forwardedProto || req.protocol || 'http';
        const host = forwardedHost || req.get('host') || 'localhost:3000';
        const base = envDefault ? envDefault.replace(/\/+$/, '') : `${proto}://${host}`;
        // Note: Supabase should redirect back to the server route that handles the callback
        const defaultCallbackPath = '/api/v1/auth/callback';

        // Optional: Support a 'next' parameter to redirect to after successful auth
        const next = req.body?.next || req.query?.next;
        let redirectTo = req.body?.redirectTo || req.query?.redirectTo || `${base}${defaultCallbackPath}`;

        // If we are using the default callback and have a 'next' URL, append it
        if (next && redirectTo.includes(defaultCallbackPath) && !redirectTo.includes('next=')) {
            const separator = redirectTo.includes('?') ? '&' : '?';
            redirectTo = `${redirectTo}${separator}next=${encodeURIComponent(next)}`;
        }

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
    // Disable CSP for this specific route to allow the inline script
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");

    // Minimal page to capture URL fragment (access_token) and POST it to the server.
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Auth callback</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f4f7f9; }
      .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; max-width: 90%; width: 400px; }
      .spinner { border: 3px solid rgba(0,0,0,.1); width: 36px; height: 36px; border-radius: 50%; border-left-color: #09f; animation: spin 1s linear infinite; margin: 0 auto 1rem; }
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      #status { color: #333; line-height: 1.4; }
    </style>
  </head>
  <body>
    <div class="card">
      <div id="loader" class="spinner"></div>
      <p id="status">Wird verarbeitet...</p>
    </div>
    <script>
      (async function(){
        const statusEl = document.getElementById('status');
        const loaderEl = document.getElementById('loader');

        try {
          const hash = window.location.hash ? window.location.hash.substring(1) : '';
          const search = window.location.search ? window.location.search.substring(1) : '';

          const hashParams = new URLSearchParams(hash);
          const searchParams = new URLSearchParams(search);

          // Kombiniere alle Parameter (Query + Hash)
          const payload = {};
          for (const [k,v] of searchParams) payload[k]=v;
          for (const [k,v] of hashParams) payload[k]=v;

          // 'next' bevorzugt aus Query/Hash nehmen, sonst Fallback
          let nextUrl = payload.next || '';

          if (!nextUrl) {
            // Falls kein 'next' da ist, nicht zum Provider zurückleiten
            const ref = document.referrer;
            if (ref && ref.includes(window.location.hostname)) {
              nextUrl = ref;
            } else {
              nextUrl = '/';
            }
          }

          // Robustere URL-Erkennung für den Redirect
          let finalTarget;
          try {
            if (nextUrl.startsWith('http') || nextUrl.startsWith('geoweather://')) {
              finalTarget = new URL(nextUrl);
            } else if (nextUrl.includes('.') && !nextUrl.startsWith('/')) {
              // Sieht aus wie eine Domain ohne Protokoll (z.B. all-api-front-end.vercel.app)
              finalTarget = new URL('https://' + nextUrl);
            } else {
              // Relativer Pfad
              finalTarget = new URL(nextUrl, window.location.origin);
            }
          } catch (e) {
            finalTarget = new URL('/', window.location.origin);
          }

          // Check for error response from OAuth provider/Supabase
          if (payload.error) {
            const errorMsg = payload.error_description || payload.error || 'Unbekannter Fehler';
            statusEl.innerText = 'Login fehlgeschlagen: ' + decodeURIComponent(errorMsg);
            loaderEl.style.display = 'none';
            setTimeout(() => { window.location.href = finalTarget.toString(); }, 3000);
            return;
          }

          // If no access_token found, show message
          if (!payload.access_token) {
            statusEl.innerText = 'Kein Access-Token gefunden. Leite weiter...';
            setTimeout(() => { window.location.href = finalTarget.toString(); }, 2000);
            return;
          }

          // Use the current path for the POST request
          const callbackUrl = window.location.pathname;
          const resp = await fetch(callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          const json = await resp.json();
          if (resp.ok) {
            statusEl.innerText = 'Login erfolgreich! Leite weiter...';

            // Tokens für den Redirect vorbereiten
            if (json.access_token) {
              // Wir hängen die Tokens als Fragment (#) an, wie es bei OAuth üblich ist
              // Das ist sicherer als Query-Parameter, da sie nicht in Server-Logs landen
              finalTarget.hash = \`access_token=\${json.access_token}&refresh_token=\${json.refresh_token || ''}\`;

              // Backup: LocalStorage (nur falls die Website auf der gleichen Domain liegt)
              localStorage.setItem('access_token', json.access_token);
            }

            // Automatischer Redirect
            setTimeout(() => {
              window.location.href = finalTarget.toString();
            }, 800);

            // Falls der automatische Redirect nicht klappt (z.B. in manchen In-App Browsern)
            setTimeout(() => {
              loaderEl.style.display = 'none';
              statusEl.innerHTML = \`
                Login erfolgreich!<br><br>
                <a href="\${finalTarget.toString()}" style="display:inline-block; padding:10px 20px; background:#09f; color:white; text-decoration:none; border-radius:5px;">
                  Zurück zur Website
                </a>
              \`;
            }, 3000);

          } else {
            statusEl.innerText = 'Login fehlgeschlagen: ' + (json?.message || 'Serverfehler');
            loaderEl.style.display = 'none';
            setTimeout(() => { window.location.href = finalTarget.toString(); }, 3000);
          }
        } catch (err) {
          console.error('Auth Error:', err);
          statusEl.innerText = 'Fehler bei der Verarbeitung: ' + err.message;
          loaderEl.style.display = 'none';
          const fallback = new URLSearchParams(window.location.search).get('next') || '/';
          setTimeout(() => { window.location.href = fallback; }, 5000);
        }
      })();
    </script>
  </body>
</html>`;

    res.set('Content-Type', 'text/html; charset=utf-8').status(200).send(html);
});

router.post('/callback', async (req, res) => {
    try {
        const { access_token, refresh_token, error, error_description } = req.body || {};

        // Handle error responses from OAuth flow
        if (error) {
            const message = error_description || error || 'OAuth authentication failed';
            return res.status(401).json({
                error: 'Authentication failed',
                error_code: error,
                message: decodeURIComponent(message)
            });
        }

        if (!access_token) {
            return res.status(400).json({
                error: 'Validation error',
                message: 'access_token is required'
            });
        }

        const client = getSupabaseClient();
        if (!client) {
            return res.status(500).json({
                error: 'Configuration error',
                message: 'Supabase credentials are not configured'
            });
        }

        // Validate token and get user
        const { data, error: validateError } = await client.auth.getUser(access_token);
        if (validateError || !data?.user) {
            return res.status(401).json({
                error: 'Invalid token',
                message: validateError?.message || 'Unable to validate token'
            });
        }

        // Respond with the authenticated user and minimal session info
        return res.status(200).json({
            user: data.user,
            access_token,
            refresh_token
        });
    } catch (err) {
        return res.status(500).json({
            error: 'Callback failed',
            message: err.message
        });
    }
});

module.exports = router;
