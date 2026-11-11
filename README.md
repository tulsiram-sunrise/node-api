# Node APIs

REST API built with Node.js, Express 5 and MongoDB (Mongoose). It provides social login (Facebook, Google), user profiles and nearby-user search.

Full documentation is in [docs/](docs/README.md). Start with the [plan](docs/PLAN.md) and the [conventions](docs/CONVENTIONS.md).

## Requirements

- Node.js 22 or newer
- MongoDB 6 or newer (needs `2dsphere` index support)

## Running locally

```bash
npm install
cp .env.example .env      # then fill in napi_JWTPrivateKey (and provider keys)
npm run dev               # auto-reload, loads .env
# or
npm start
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start with `--watch` and `.env` |
| `npm test` | Run tests against an in-memory MongoDB |
| `npm run test:coverage` | Run tests with a coverage report |
| `npm run lint` | Run ESLint |
| `npm run audit:prod` | Fail on high or critical advisories in production dependencies |

Docker: `docker build -t node-api . && docker run -p 5000:5000 --env-file .env node-api`

## Configuration

Configuration uses [`config`](https://www.npmjs.com/package/config). Defaults live in `config/default.json`. Environment variables override them (see `config/custom-environment-variables.json` and `.env.example`).

| Env var | Purpose |
| --- | --- |
| `napi_JWTPrivateKey` | **Required.** HS256 signing secret, at least 32 characters (enforced in production) |
| `napi_db` | MongoDB connection string |
| `napi_FacebookClientId` / `napi_FacebookClientSecret` | Enables Facebook login |
| `napi_GoogleClientId` | Enables Google login. May be a comma-separated list of client IDs |
| `napi_corsOrigins` | JSON array of allowed browser origins (none by default) |
| `napi_trustProxy` | Number of proxy hops in front of the app, so client IPs are correct |
| `napi_logLevel`, `napi_logFile`, `napi_logDb` | Logging level, optional log file, optional MongoDB log sink |

## API

Authenticated endpoints accept `Authorization: Bearer <token>` (preferred) or the legacy `x-auth-token: <token>` header.

Errors always use this shape: `{ "error": { "code", "message", "details?", "requestId" } }`.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/health` | – | Liveness probe |
| GET | `/ready` | – | Readiness probe (503 until the database is connected) |
| POST | `/api/v1/auth/facebook` | – | Body `{ "access_token" }`. Returns the user; the JWT is in the `x-auth-token` header |
| POST | `/api/v1/auth/google` | – | Body `{ "id_token" }` (Google Identity Services ID token). Same response |
| GET | `/api/v1/users/me` | ✓ | Current user's profile |
| DELETE | `/api/v1/users/me` | ✓ | Delete the account |
| PATCH | `/api/v1/users/me/level` | ✓ | `{ "level": "Beginner" \| "Intermediate" \| "Advanced" }` |
| PUT | `/api/v1/users/me/location` | ✓ | `{ "location": { "lat", "lng" } }` |
| PUT | `/api/v1/users/me/setting` | ✓ | `{ "distance": 1-100, "preferredTime": [{ "day": "Monday", "timing": "18:00-20:00" }] }` |
| GET | `/api/v1/users/nearby` | ✓ | `?distance=<miles>&level=&limit=` Nearby users, closest first. Defaults to your `setting.distance`, or 10 miles |

`nearby` never returns other users' coordinates or emails. Distances are rounded up to whole miles.

## Upgrading from 1.x

- **Google login:** the endpoint now expects an **ID token** in `id_token`. Google+ token login was shut down by Google. Clients must switch to Google Identity Services or the platform Sign-In SDKs. `napi_GoogleClientSecret` is no longer used.
- **Facebook login:** the request is unchanged (`access_token`). The token must now have been issued for *this* app.
- Error responses are now JSON objects instead of plain strings.
- The database gets new unique indexes on `facebook.id` and `google.id`. If duplicate accounts already exist, index creation will fail. Deduplicate them first, for example with an aggregation that groups users by `facebook.id` and keeps documents where the count is greater than 1.
