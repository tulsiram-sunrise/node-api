# Architecture

node-api is a stateless Express 5 service in front of MongoDB. Users sign in with Facebook or Google, receive a JWT, and use it to manage their profile and find nearby users.

## Folder layout

```
index.js                 Process entry: validate config → connect DB → listen → graceful shutdown
app.js                   createApp(): builds the Express app; no network or DB side effects
config/                  `config` package files (default, test, production, env-var mapping)
startup/
  config.js              Fail-fast config validation
  db.js                  MongoDB connect/disconnect/isConnected; global Mongoose settings
  security.js            helmet, CORS, global rate limiter; authLimiter() factory
  routes.js              /, /health, /ready, /api, 404 and error handlers
  server.js              HTTP server request/headers/keep-alive timeouts
middleware/              Cross-cutting, version-independent middleware
  requestContext.js      Request ID + access log line
  validate.js            Joi validation for body/query/params
  validateObjectId.js    400 on a malformed :id
  notFound.js            404 → HttpError
  error.js               The single error handler; renders the JSON error shape
lib/                     Framework-free helpers
  logger.js              winston logger (console, optional file, optional MongoDB)
  tokens.js              JWT sign/verify (HS256, iss, aud, sub, exp)
  httpError.js           HttpError(status, message, code, details)
  geo.js                 miles↔meters, {lat,lng} → GeoJSON Point
  cursor.js              Encrypted, tamper-proof pagination cursors (AES-256-GCM, key from jwt.secret via HKDF)
  countries.js           ISO 3166-1 alpha-2 country codes (B12)
  securityLog.js         securityEvent(): one structured info line per security event (see SECURITY.md)
api/
  routes.js              JSON body parser (10 kB) + /v1 mount
  v1/
    routes/              Route tables only: path → middleware → controller
    middlewares/auth.js  Bearer / x-auth-token → req.auth
    validators/          Joi schemas per resource
    controllers/         Thin HTTP handlers: read req, call model/service, write res
    services/oauth.js    Facebook and Google token verification (outbound HTTP)
    models/user.js       Mongoose schema, indexes, toJSON transform, upsertOAuthUser
migrations/              migrate-mongo migrations (indexes, data changes); config in migrate-mongo-config.js
scripts/                 Operational CLIs (find-duplicate-users.js, seed.js, loadtest.js) and shared helpers in scripts/lib/
tests/                   Jest + supertest; helpers/db.js runs mongodb-memory-server
docs/                    This documentation
```

## Layers and allowed dependencies

```
routes → middleware/validators → controllers → services / models → lib
```

- Routes contain no logic. They only wire middleware and controllers.
- Controllers never call `fetch` or the provider SDKs. That is the job of services.
- Services and models never touch `req` or `res`.
- `lib/` imports nothing from `api/`, `startup/` or `middleware/`.
- Anything versioned lives under `api/v1/`. A future v2 gets its own `api/v2/` folder and can reuse models and services.

## Request lifecycle

1. `requestContext` assigns `req.id`. It reuses an incoming `x-request-id` if that matches `^[\w-]{1,64}$`, sets the response header, and logs the request when it finishes.
2. `security` applies helmet, CORS and the global rate limiter. `/health` and `/ready` are exempt from the limiter.
3. `/api` parses JSON, with a 10 kB limit.
4. The route's middleware runs: `auth` sets `req.auth` from the JWT, then `validate(schema)` replaces `req.body` or sets `req.validated.query`.
5. The controller runs. In Express 5, a rejected promise goes straight to the error handler.
6. An unknown route falls through to `notFound`, which raises a 404 `HttpError`.
7. `error.js` renders `{ error: { code, message, details?, requestId } }`. Unexpected errors are logged and returned as a generic 500.

## Login flow

```
Client SDK ──token──▶ POST /api/v1/auth/{facebook|google}
                         │ validate body
                         │ services/oauth.verify*Token()
                         │    Facebook: GET /debug_token (app_id must match) → GET /me (appsecret_proof)
                         │    Google:   verifyIdToken(audience = client IDs)
                         │ User.upsertOAuthUser(identity)   (atomic findOneAndUpdate upsert, retried once on E11000)
                         │ tokens.sign(user)
                         │ securityEvent auth.login (auth.login_failed if the provider rejects the token)
                         ◀── 200 user JSON + x-auth-token header
```

The API never sees passwords or provider refresh tokens, and it stores no provider access tokens.

## Data model: `users`

| Field | Type | Notes |
| --- | --- | --- |
| `provider` | `"facebook" \| "google"` | `select: false`; the provider used for the first sign-in |
| `facebook.id`, `google.id` | string | `select: false`; unique sparse indexes |
| `email` | string | Lower-cased; for Google, stored only if verified |
| `name`, `profilePic` | string | Taken from the provider on first sign-in only |
| `level` | enum | `Beginner` (default), `Intermediate`, `Advanced` |
| `discoverable` | boolean | Default `false`; only `true` users appear in nearby search |
| `discoverableSince` | Date | When the user last opted in (consent record); removed on opt-out |
| `location` | GeoJSON Point | `[lng, lat]`; compound index `{ location: "2dsphere", discoverable: 1, level: 1 }` (B14), so nearby filters run inside the index; returned to the owner as `{ lat, lng }` |
| `setting` | object | `distance` (1–100 miles), `preferredTime[] { day, timing }` |
| `countryCode` | string | ISO 3166-1 alpha-2 (`lib/countries.js`), set by the user with `PATCH /users/me`; replaces v1 `currentCountryCode` (B12). Not in nearby results |
| `createdAt`, `updatedAt` | Date | Mongoose timestamps |

`toJSON` renames `_id` to `id` and removes `provider`, `facebook`, `google` and `__v`.

## Data model: `deletionrequests`

One record per Facebook data-deletion callback: `code` (unique confirmation code), `provider`, `status`, timestamps. It holds no user identifiers. A TTL index removes records after 365 days.

## Configuration

The `config` package merges `default.json`, then `<NODE_ENV>.json`, then the environment variables mapped in `custom-environment-variables.json`. See `.env.example` for every variable. `startup/config.js` refuses to start without a JWT secret, and in production refuses one shorter than 32 characters.

## Operations

- `GET /health`: liveness. It returns 200 whenever the process is up.
- `GET /ready`: readiness. It returns 503 until MongoDB is connected.
- SIGTERM/SIGINT: stop accepting connections, let in-flight requests finish, disconnect MongoDB, exit. If that takes more than 10 seconds, the process exits with code 1.
- An uncaught exception or unhandled rejection is logged and the process exits with code 1. The orchestrator restarts it.
- Timeouts (GAP B10, `timeouts.*` in config): the whole request must arrive within 30 s and headers within 10 s; idle keep-alive sockets close after 65 s, which is above the 60 s idle timeout of common load balancers. MongoDB `find`, `findOne`, `countDocuments`, `findOneAndUpdate` and `aggregate` carry `maxTimeMS` (5 s), and one that runs over returns 503 `QUERY_TIMEOUT`. Deletes don't carry it; they match by `_id` or an indexed field. Provider calls have their own 5 s timeout.
- The service is stateless apart from MongoDB. Rate-limit counters are per instance until PLAN item 6.3 (Redis store) ships.
