# Best practices

This document explains the why behind the [conventions](CONVENTIONS.md). Each practice is something this codebase already does, or should do when it grows.

## Express 5

- **Let async errors propagate.** Express 5 forwards a rejected promise from a handler to the error middleware, so `try/catch` that only calls `next(err)` is noise. Catch only to translate an error, as `services/oauth.js` does.
- **Keep the app factory pure.** `createApp()` builds the app without listening or connecting. Tests, scripts and a future serverless adapter can all reuse it.
- **Order middleware deliberately:** request ID first (so everything can log it), then security, then routes, then 404, then the error handler last.
- **Treat `req.query` as read-only** in Express 5. Validated values go on `req.validated`.
- **Set `trust proxy` correctly** behind a load balancer. If it is wrong, `req.ip` is the balancer's IP and every client shares one rate-limit bucket.

## Mongoose 9 and MongoDB

- **Write atomically.** `findOneAndUpdate` with `upsert` plus a unique index is race-free. Read-then-save is not; that race caused the duplicate users in v1.
- **Let the database enforce uniqueness.** Application checks can't see concurrent requests. Handle `E11000` where a race is expected.
- **Build indexes ahead of time in production.** `autoIndex` builds them at startup, which can block or fail on existing data. Use the release scripts.
- **Keep private fields private by default.** Use `select: false` on sensitive paths and a `toJSON` transform. Explicit `$project` stages in aggregations.
- **Sanitize filters.** `sanitizeFilter` and `strictQuery` are set globally in `startup/db.js`. Validation is the first defence; these are the second.
- **Use `127.0.0.1`, not `localhost`,** in local connection strings. Node 17 and later may resolve `localhost` to IPv6 `::1`, which a default `mongod` doesn't listen on.
- **Use GeoJSON and `2dsphere`** for anything spatial. `$geoNear` must be the first pipeline stage and needs exactly one geo index on the collection.

## Validation and input

- **Use an allow-list, not a block-list.** Joi with `stripUnknown` means only declared fields survive. This prevents mass assignment, for example a client sending `isAdmin`.
- **Bound every input,** including string lengths, numeric ranges, array sizes and body size. Unbounded input is a denial-of-service vector.
- **Validate at the edge, trust inside.** Controllers assume validated input; models add a second layer with schema validators.

## Authentication

- **Verify provider tokens server-side, for this app.** A token being valid isn't enough; it must be addressed to you. That means the audience for Google and `app_id` for Facebook.
- **Pin JWT algorithms** and check `iss`, `aud` and `exp`. Never accept `alg: none`.
- **Keep tokens short-lived** and refreshable once PLAN item 9.1 lands. A one-day, non-revocable token is the main remaining auth weakness.
- **Never link accounts by email alone.** Emails can be unverified or reassigned. Linking must prove control of both identities.

## Configuration and secrets

- **Fail fast.** Check required config at startup (`startup/config.js`), not on the first request that needs it.
- **Keep secrets in the environment** (or a secret manager that injects env vars), never in JSON files or the image.
- **Make optional features degrade cleanly.** An unconfigured provider returns 501 instead of crashing the process.

## Logging and observability

- **Log once, where the error is handled.** The error middleware logs 5xx errors; don't also log in controllers.
- **Use structured logs in production** (`logging.format: "json"`), so fields like `requestId` can be searched.
- **Correlate.** Every response carries `x-request-id`; clients should send it to support.
- **Record security events with `securityEvent(req, name, fields)`** (`lib/securityLog.js`) when adding anything that signs in, deletes data or changes privacy settings. Pass IDs and field names, never values. The event list is in SECURITY.md.
- **Separate liveness and readiness.** `/health` should almost never fail. `/ready` reflects dependencies, so traffic shifts away instead of the pod restarting.

## Resilience

- **Put a timeout on every outbound call.** Provider calls use `AbortSignal.timeout(5000)`. A hung upstream must not hold connections forever.
- **Map upstream failures honestly.** A provider outage is 502, not 401 (which would blame the user) and not 500 (which would blame you).
- **Shut down gracefully.** Stop accepting connections, finish in-flight requests, close the database, and set a hard deadline.
- **Crash on unknown state.** After an uncaught exception, log and exit; the orchestrator restarts a clean process.

## Testing

- **Test behaviour through HTTP.** Supertest against `createApp()` covers routing, validation, auth and serialization in one go.
- **Use a real database engine.** `mongodb-memory-server` runs real `mongod`, so indexes, geo queries and the upsert race are actually tested.
- **Mock only at the network edge,** meaning provider services and `fetch`.
- **Test security as features.** Wrong algorithm, wrong audience, injection payloads, oversized bodies and leaked fields each have a test. Keep it that way.

## Dependencies and supply chain

- **Keep fewer dependencies.** Six unused packages were most of v1's 95 advisories.
- **Gate CI on production advisories** (`npm run audit:prod`), and review dev advisories regularly.
- **Install for production with `npm ci --omit=dev --ignore-scripts`,** as in the Dockerfile.
- **Upgrade one major at a time** and read its migration guide. The Mongoose 9 deprecation of `new: true` was caught that way.

## Containers and deployment

- Run as a non-root user, with a minimal base image (`node:24-alpine`) and a `HEALTHCHECK`.
- Set `NODE_ENV=production`. It changes Express behaviour, enables JSON logs, and enforces the JWT secret length.
- Run one process per container and scale horizontally. Move shared state (rate limits) to Redis before you scale out (PLAN item 6.3).
