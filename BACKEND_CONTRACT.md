# Backend Contract — Auth & Roles

This document specifies what the backend (`API_BASE_RAW` / `CF_WORKER` in `js/main.js:1-2`) MUST return so the frontend works correctly.

## Required Endpoints

### `POST /api/login`
**Request:**
```json
{
  "username": "string",
  "password": "string",
  "user_agent": "string|null",
  "time_zone": "string|null",
  "fingerprint": "string|null",
  "browser": "Chrome|Firefox|Safari|Edge|Opera|Unknown"
}
```
**Success (200):**
```json
{
  "token": "jwt-or-opaque-string",
  "refresh_token": "optional",
  "account": {
    "username": "surge",
    "email": "user@example.com",
    "account_type": "User|VIP|Partner|Beta|Admin|Owner",
    "account_permissions": "User|VIP|Partner|Beta|UnlockAll|Admin|Owner (string or array)",
    "discord_user_id": "optional",
    "profile_picture": "optional path",
    ...
  }
}
```
**Failure (401/403/400):**
```json
{ "detail": "human-readable error message" }
```

### `POST /api/register`
Same request as login minus fingerprint. On success returns 200 and the frontend will automatically call `/api/login`.

### `POST /api/forgot_password`
Request: `{ "identifier": "username or email" }`
Response: `200 { "ok": true }`

### `POST /api/confirm_reset`
Request: `{ "identifier": "...", "code": "...", "new_password": "..." }`

### `GET /api/auth/discord`
OAuth2 entry point. Redirects the user to Discord's OAuth authorize URL with the correct `client_id`, `redirect_uri`, `scope=identify%20email`, `state=<csrf>`, and `prompt=consent`.

The `redirect_uri` should point back to `GET /api/auth/discord/callback` on this same backend.

### `GET /api/auth/discord/callback`
Receives `?code=...&state=...`. Exchanges the code with Discord for an access token, fetches the user (`/users/@me`), then:

1. Look up the local user by `discord_user_id`. If found, issue a session token and **redirect to** `?return_to=...&discord_token=<token>&discord_account=<urlencoded JSON>`.
2. If not found, create a new user record (or upsert), then issue a token and redirect the same way.

If anything fails, redirect to `?return_to=...&auth_error=<message>`.

### `GET /api/user`
Requires `Authorization: Bearer <token>` (header) or `?token=...`. Returns the full account object (same shape as `account` above). The frontend uses this to refresh user data.

---

## Role / Permission System

The frontend maps `account_permissions` (or `account_type`) to a numeric rank (`js/main.js:968`):

| Role         | Rank |
|--------------|------|
| user         | 0    |
| vip          | 1    |
| partner      | 2    |
| beta         | 3    |
| unlockall    | 4    |
| admin        | 5    |
| owner        | 6    |

Rules for the backend:
1. `account_type` describes the public-facing type label (e.g. "Owner", "Admin", "Beta Tester").
2. `account_permissions` is the **authoritative role** used for gating. It can be a string OR an array of strings (frontend takes the highest rank).
3. To grant **multiple roles** (e.g. someone is both `partner` AND `beta`), return an array.
4. The "admin" account used during development (`surge:pascal112`) should map to `account_permissions: ["Admin"]` or `account_type: "Owner"`.

## Frontend checks (`js/main.js:984`)
```js
meetsRequiredPermission('admin') // → checks rank >= 5
```

Use this to gate admin-only UI features (delete posts, ban users, see admin panel, etc.).

---

## CORS / Hosting notes
- Frontend is hosted on GitHub Pages at **https://uchiha-market.com**.
- Backend is hosted on Render at **https://uchiha-backend-d1n7.onrender.com** (`API_BASE_RAW` / `CF_WORKER` in `js/main.js:1-9`).
- CORS is open for all origins in production.

## Profile pictures
- `POST /api/profile/upload_picture` (multipart field `file`, auth required). Accepts `image/png`, `image/jpeg`, `image/webp`, max 5 MB.
- `GET /api/profile_picture/:filename` serves the picture (local file → embedded DB copy → 302 to GitHub raw).
- On Render, uploads are pushed to the `ASSETS_REPO` GitHub repository (Contents API) and mirrored in the DB, so they survive restarts. Set `GITHUB_TOKEN` + `ASSETS_REPO` in the Render dashboard for the GitHub backup.