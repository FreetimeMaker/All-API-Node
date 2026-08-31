# API

The central backend for all Freetime Maker services. Built with Express.js and deployed as a Vercel serverless function.

## Services

| Service | Description |
| --- | --- |
| **GeoWeather** | Subscription management for the GeoWeather weather app (tiers: free, freemium, premium, ultrimium) |
| **Wallora** | Wallpaper catalog, purchases, and platform-aware pricing |
| **F-Port** | Open-source app directory with cloud-synced likes |
| **Sol Arcade** | Compressed NFT (cNFT) Arcade Pass minting on Solana with limited plays per pass |
| **Auth** | Supabase OAuth login/logout for the dashboard |

## Quick Start

```bash
cp .env.example .env      # fill in values
npm install
npm start                 # http://localhost:3000
```

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | yes | Supabase publishable (anon) key |
| `SUPABASE_SERVICE_ROLE_KEY` | no | Service role key for elevated DB access |
| `SOLANA_RPC_URL` | no | Solana RPC endpoint (default: mainnet-beta) |
| `MINT_PRIVATE_KEY` | Arcade | Base58 private key of the payer wallet (fee payer + Merkle tree creator) |
| `ARCADE_RECIPIENT` | Arcade | Wallet address that receives the 0.05 SOL pass payment |
| `ARCADE_JWT_SECRET` | Arcade | Secret for signing Arcade session JWTs |
| `ARCADE_ADMIN_TOKEN` | Arcade | Token for admin-only endpoints (e.g. `/setup`) |
| `ARCADE_ASSET_BASE` | no | Base URL for the cNFT metadata JSON (default: `https://free-time.me/sol-arcade`) |
| `ARCADE_PLAYS_LIMIT` | no | Game starts allowed per pass (default: `10`) |
| `PORT` | no | Server port for local development (default: `3000`) |

## Endpoints

All endpoints are mounted under `/api/v1` (and mirrored under `/api/v2`).

### Health

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/v1/health` | - | Service status + timestamp |

### Auth (Supabase OAuth)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/v1/auth/config` | - | Whether Supabase is configured |
| `GET/POST` | `/api/v1/auth/login` | - | Start OAuth flow (pass `provider` as query/body) |
| `GET` | `/api/v1/auth/login/:provider` | - | Start OAuth for a specific provider |
| `POST` | `/api/v1/auth/logout` | Bearer | Sign out |
| `GET` | `/api/v1/auth/me` | Bearer | Current user info |
| `GET` | `/api/v1/auth/callback` | - | OAuth callback page (browser redirect) |
| `POST` | `/api/v1/auth/callback` | - | Validate OAuth tokens |
| `GET` | `/api/v1/auth/linked-accounts` | Bearer | List linked accounts |
| `POST` | `/api/v1/auth/link-account` | Bearer | Link an external account |
| `DELETE` | `/api/v1/auth/link-account/:accountId` | Bearer | Unlink an account |

### GeoWeather

| Method | Path | Auth | Description |
| --- | --- | --- | ---|
| `GET` | `/api/v1/geoweather/subscriptions/plans` | - | List available subscription tiers |
| `POST` | `/api/v1/geoweather/subscriptions/redeem` | Bearer | Redeem a subscription code |
| `GET` | `/api/v1/geoweather/subscriptions` | Bearer | Get current subscription |

### Wallora

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/v1/wallora/wallpapers` | - | List wallpapers (filter by `?category=`) |
| `GET` | `/api/v1/wallora/wallpapers/:id` | - | Get wallpaper details |
| `POST` | `/api/v1/wallora/wallapers/:id/purchase` | Bearer | Purchase a wallpaper |
| `POST` | `/api/v1/wallora/wallpapers` | Bearer | Add a new wallpaper |

Wallpaper cost is automatically waived for the official Wallora Android app (`com.freetime.wallora`).

### F-Port

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/v1/fport/apps` | - | List all apps |
| `GET` | `/api/v1/fport/apps/:id` | - | Get app details |
| `POST` | `/api/v1/fport/apps/:id/like` | optional | Like an app (persisted if authenticated) |
| `POST` | `/api/v1/fport/apps` | Bearer | Add or update an app |

### Sol Arcade (v2 only)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/v2/arcade` | - | Service info (price, plays limit, config status) |
| `GET` | `/api/v2/arcade/challenge?wallet=` | - | Get a sign-in challenge message |
| `POST` | `/api/v2/arcade/login` | - | Verify signature, return JWT + pass status |
| `GET` | `/api/v2/arcade/me` | Bearer | Current session, pass, and plays remaining |
| `POST` | `/api/v2/arcade/pass/session` | Bearer | Create a pending payment session |
| `POST` | `/api/v2/arcade/pass/confirm` | Bearer | Verify on-chain payment, mint cNFT |
| `POST` | `/api/v2/arcade/play/start` | Bearer | Consume one game start (pass removed at limit) |
| `POST` | `/api/v2/arcade/play` | Bearer | Record a high score |
| `GET` | `/api/v2/arcade/scores` | Bearer | Get best scores for current wallet |
| `POST` | `/api/v2/arcade/setup` | Admin | Create the Solana Merkle tree |

**Arcade flow:**
1. Frontend calls `GET /challenge?wallet=` to get a message to sign.
2. User signs with their wallet; frontend sends `POST /login` with the signed message.
3. If the user owns a pass (`pass` in response), they can play.
4. To buy a pass: `POST /pass/session` returns payment details, user transfers 0.05 SOL on-chain, then calls `POST /pass/confirm` with the transaction signature.
5. Before each game: `POST /play/start` decrements the play counter. At the limit, the pass row is deleted (the NFT "disappears" from the app).

## Database

Supabase (PostgreSQL) with Row Level Security enabled. All arcade RLS policies are open (the API layer owns validation via JWT and on-chain checks).

### Tables

| Table | Purpose |
| --- | --- |
| `geoweather_subscriptions` | User subscription tiers for GeoWeather |
| `geoweather_codes` | Redeemable subscription codes |
| `wallora_wallpapers` | Wallpaper catalog |
| `wallora_purchases` | User wallpaper purchases |
| `fport_apps` | App directory entries |
| `fport_likes` | App likes (cloud-synced) |
| `arcade_users` | Wallet-based user accounts |
| `arcade_passes` | Active Arcade Passes (`plays_used` tracks consumption) |
| `arcade_payments` | Payment sessions (pending/paid/done) |
| `arcade_scores` | Per-game high scores |
| `arcade_config` | Key-value config (Merkle tree public key) |

### Migrations

Located in `supabase/migrations/`. Apply with:

```bash
# Link to your Supabase project (one-time)
supabase link --project-ref <project-id>

# Pull remote schema to keep migrations in sync
supabase db pull

# Apply all pending migrations
supabase db push
```

Or apply individual migrations manually via the Supabase SQL Editor.

## Project Structure

```
api/
├── src/
│   ├── index.js              # Express app entry point
│   ├── lib/
│   │   ├── supabase.js       # Supabase client + auth helpers
│   │   ├── arcade.js         # Solana/cNFT logic + JWT + stateless auth
│   │   └── arcade-glue.js    # Pre-bundled CJS (web3, bubblegum, umi, bs58, nacl, jwt)
│   ├── v1/
│   │   ├── index.js          # v1 router
│   │   ├── health/
│   │   ├── auth/             # Supabase OAuth routes
│   │   ├── geoweather/       # Subscriptions + code redemption
│   │   ├── wallora/          # Wallpaper CRUD + purchases
│   │   └── fport/            # App directory
│   └── v2/
│       ├── index.js          # v2 router (identical to v1 + arcade)
│       ├── ...               # Same modules as v1
│       └── arcade/           # Sol Arcade endpoints
├── supabase/
│   └── migrations/           # SQL migration files
├── package.json
└── .env                      # Local env (gitignored)
```

## Notes

- **`arcade-glue.js`** is a pre-built esbuild bundle. To rebuild after changing dependencies, run `node src/lib/arcade-glue-entry.cjs | esbuild --bundle ...` (see the entry file for the exact command).
- The `asRouter()` helper in `index.js` unwraps Vercel Rolldown's inconsistent module exports (`{ default: router }`, `{ default: { default: router } }`, memo wrappers, etc.).
- `dotenv.config()` is called at startup; on Vercel the `.env` file is not present (env vars are set via the dashboard), which is handled gracefully.
