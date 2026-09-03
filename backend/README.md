# UCHIHA Labs Launcher — Backend

Standalone Node.js + Express + SQLite backend for the Launcher frontend.

## Quick start

```bash
cd backend
cp .env.example .env
# Edit .env: set JWT_SECRET, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, FRONTEND_ORIGIN, etc.
npm install
npm start
```

The server listens on `http://localhost:3000` by default. SQLite DB is created automatically at `data/uchiha.db` with schema and admin user (`surge`/`pascal112`) seeded.

## Frontend connection

In `Launcher/js/main.js:1-8`, set:

```js
const API_BASE_RAW = 'http://localhost:3000';
const CF_WORKER = 'http://localhost:3000'; // optional, used over HTTPS
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `PORT` | Listen port (default 3000) |
| `JWT_SECRET` | Long random string for signing tokens |
| `JWT_EXPIRES_IN` | Token lifetime (default `7d`) |
| `FRONTEND_ORIGIN` | Allowed CORS origin |
| `DISCORD_CLIENT_ID` | Discord OAuth application ID |
| `DISCORD_CLIENT_SECRET` | Discord OAuth secret |
| `DISCORD_REDIRECT_URI` | Must match Discord app, default `http://localhost:3000/api/auth/discord/callback` |
| `DISCORD_GUILD_ID` | Your main guild (optional, for role sync) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL` | Seeded on first run |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | Per-IP request limit |

## API surface

All endpoints are documented in `Launcher/BACKEND_CONTRACT.md`.

Quick reference:

| Endpoint | Auth |
|----------|------|
| `POST /api/login` | none |
| `POST /api/register` | none |
| `POST /api/forgot_password` | none |
| `POST /api/confirm_reset` | none |
| `GET /api/auth/discord?return_to=...` | none — redirects to Discord |
| `GET /api/auth/discord/callback` | none — handled by Discord |
| `POST /api/logout` | bearer |
| `GET /api/user` | bearer |
| `POST /api/profile/update` | bearer |
| `POST /api/profile/upload_picture` | bearer (multipart `file`, PNG only) |
| `GET /api/profile_picture/:filename` | none |
| `GET /api/bank` | bearer |
| `GET /api/products` | none |
| `GET /api/reviews` | none |
| `POST /api/reviews/create` | bearer |
| `POST /api/reviews/like` | bearer |
| `POST /api/payment/create` | bearer |
| `POST /api/payment/lc` | bearer |
| `GET /api/forum` | none |
| `POST /api/forum/post` | bearer |
| `POST /api/forum/comment` | bearer |
| `POST /api/forum/reply` | bearer |
| `POST /api/forum/like` | bearer |
| `POST /api/forum/comment/like` | bearer |
| `GET /health` | none |

## Role mapping

`account_permissions` (string or array of strings):
`User`, `VIP`, `Partner`, `Beta`, `UnlockAll`, `Admin`, `Owner` — see `BACKEND_CONTRACT.md` for the rank table.

## Hosting

Any Node 18+ host works:
- VPS (systemd + nginx)
- Render / Railway / Fly.io
- Oracle Cloud free tier
- A self-hosted bot on `bot-hosting.net` (port 3000)

For HTTPS termination use nginx/Caddy in front.

## Discord OAuth setup

1. Create application at https://discord.com/developers/applications
2. Add redirect URI: `https://your-domain.com/api/auth/discord/callback`
3. Copy client ID and secret into `.env`
4. In Discord Developer Portal → OAuth2 → URL Generator, enable scopes `identify` and `email`.