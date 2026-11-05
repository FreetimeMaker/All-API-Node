# All API

## This Repo is sponsored by: 
[![Sponsor](https://readme.cash/i/49druo4hvl.svg)](https://readme.cash/c/49druo4hvl)

The central backend for all Freetime Maker services. Built with Express.js and deployed as a Vercel serverless function.

## Services

| Service | Description |
| --- | --- |
| **GeoWeather** | Subscription management for the GeoWeather weather app (tiers: free, freemium, premium, ultrimium) |
| **Wallora** | Wallpaper catalog, purchases, and platform-aware pricing |
| **Auth** | Supabase OAuth login/logout for the dashboard |

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | yes | Supabase publishable (anon) key |
| `SUPABASE_SERVICE_ROLE_KEY` | no | Service role key for elevated DB access |
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

### Wallora

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/v1/wallora/wallpapers` | - | List wallpapers (filter by `?category=`) |
| `GET` | `/api/v1/wallora/wallpapers/:id` | - | Get wallpaper details |
| `POST` | `/api/v1/wallora/wallapers/:id/purchase` | Bearer | Purchase a wallpaper |
| `POST` | `/api/v1/wallora/wallpapers` | Bearer | Add a new wallpaper |

Wallpaper cost is automatically waived for the official Wallora Android app (`com.freetime.wallora`).

## Database

Supabase (PostgreSQL) with Row Level Security enabled. All arcade RLS policies are open (the API layer owns validation via JWT and on-chain checks).

### Tables

| Table | Purpose |
| --- | --- |
| `wallora_wallpapers` | Wallpaper catalog |
| `wallora_purchases` | User wallpaper purchases |

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
│   ├── v1/
│   │   ├── index.js          # v1 router
│   │   ├── health/
│   │   ├── auth/             # Supabase OAuth routes
│   │   ├── wallora/          # Wallpaper CRUD + purchases
│   └── v2/
│       ├── index.js          # v2 router (identical to v1 + arcade)
│       ├── ...               # Same modules as v1
├── supabase/
│   └── migrations/           # SQL migration files
├── package.json
└── .env                      # Local env (gitignored)
```
