# node-api upgrade, security and feature plan

Last updated: 2026-11-07 · Branch: `upgrade/modernize-api` · Target version: 2.0.0

## Status

v2.0.0 is merged into `master` but not released. Phases 1–4 and the code items of Phase 5.1 are done; Phase 5 still needs B2, B15 and the release decisions. Phase 6 code work has started (6.2, 6.4, 6.8 and 6.9 done; B14 of 6.7 done).

| Phase | Scope | Status |
| --- | --- | --- |
| 1. Platform upgrade | Node 22+, Express 5, Mongoose 9, Joi 18, app/server split | Done |
| 2. Security hardening | Token verification, JWT rules, headers, CORS, rate limits, injection guards | Done |
| 3. Profile and nearby features | Six endpoints under `/api/v1/users` | Done |
| 4. Quality and delivery | 34 tests, ESLint, Dockerfile, CI | Done |
| 5. Release and migration | P0 gaps, client changes, data migration, staged rollout | Next |
| 6. Production baseline | Basic P1 gaps: metrics, alerts, error tracking, pagination, timeouts, availability matching | In progress |
| 7. Restructure | Feature modules in `src/`, service layer, explicit dependencies ([RESTRUCTURE.md](RESTRUCTURE.md)) | Planned |
| 8. Modern standards | Node 26, ESM, TypeScript, Vitest, Zod, pino, OpenAPI, supply chain ([STANDARDS.md](STANDARDS.md)) | Planned |
| 9. Identity and security | Refresh tokens + JWKS, roles/admin, audit, tracing, retention, pentest | Planned |
| 10. Product and scale | Safety tools, public profiles, connections, notifications, caching, jobs (trigger-driven) | Planned |

The planning documents behind phases 5–10:

- [GAP_ANALYSIS.md](GAP_ANALYSIS.md): what is missing, basic (B1–B29) and advanced (A1–A32).
- [RESTRUCTURE.md](RESTRUCTURE.md): whether and how to reorganize the code.
- [STANDARDS.md](STANDARDS.md): moving to late-2026 standards (S1–S18).

IDs such as B6, A14 and S10 refer to items in those documents.

Headline results so far:

- Production dependency advisories went from 95 (12 critical, 32 high, 46 moderate, 5 low) to 0.
- Facebook and Google login work again. In v1, the auth middleware crashed on load and Google login depended on the Google+ API, which was shut down in 2019.
- Test count went from 0 to 34. The suite runs in about 4 seconds against an in-memory MongoDB.

## Goals and non-goals

**Goals**

1. Working Facebook and Google login on maintained libraries.
2. No high or critical advisories in production dependencies, enforced in CI.
3. Safe defaults: verified identity tokens, strict JWTs, rate limits, input validation, consistent JSON errors.
4. Ship the profile and nearby-user features the v1 schemas were designed for.
5. Keep the v1 contract where possible: same routes, the `x-auth-token` header, and the Facebook `access_token` field.

**Non-goals for v2.0.0**

- Email/password login. There is no `local` provider and `bcrypt` was removed.
- TypeScript or ES modules. The codebase stays CommonJS (see [DECISIONS.md](DECISIONS.md) ADR-006).
- Real-time features. `socket.io` was unused and has been removed.
- A `/api/v2` path. Breaking changes are limited to the Google login body and the error format.

## Baseline: what v1.0.0 looked like

| Area | Finding | Impact |
| --- | --- | --- |
| Broken | `api/v1/middlewares/auth.js` required `express-jwt`, which was not installed | Crashed on load, so no route could be protected |
| Broken | Google login used `passport-google-plus-token` | Google login could not succeed |
| Broken | `profile.emails[0]` was read without a check | Crashed when a user hid their email |
| Broken | `res.send(401, ...)` | Removed in modern Express |
| Data | Find-then-save upsert with no unique indexes | Concurrent first logins created duplicate users |
| Startup | Server listened before MongoDB connected | Early requests failed |
| Security | Facebook token never checked against this app's ID | A token issued to any other Facebook app could log in |
| Security | JWT signed with no pinned algorithm or audience | Weaker token validation |
| Security | `helmet` installed but unused; no rate limit or body limit | No header hardening; brute-force and large-payload exposure |
| Security | No guard against MongoDB operator injection | `{ "$ne": null }`-style payloads could reach queries |
| Dependencies | 95 advisories | Mostly from `googleapis`, `socket.io`, and old `jsonwebtoken` and `mongoose` |
| Dead code | `googleapis`, `socket.io`, `moment`, `lodash`, `bcrypt`, `joi-objectid` unused; level/location/settings schemas never wired | Larger attack surface |
| Hygiene | `Number.prototype` patch; email regex rejected TLDs longer than 3 letters; no tests, lint or CI | Hard to change safely |

## Phase 1: Platform upgrade (done)

| Package | v1 | v2 | Note |
| --- | --- | --- | --- |
| Node.js | unpinned | >= 22 | Required by `google-auth-library` 11 |
| express | 4.16 | 5.3 | Native async error handling, so `express-async-errors` was dropped |
| mongoose | 5.7 | 9.12 | No callbacks; `returnDocument: "after"` replaces `new: true` |
| joi | 14.3 | 18.3 | `valid(...list)` syntax |
| jsonwebtoken | 8.5 | 9.0 | Fixes known CVEs |
| helmet | 3.16 | 8.3 | Now actually mounted |
| config | 3.0 | 4.x | v5 is ESM-only and breaks Jest (ADR-004) |
| winston-mongodb | 5.0 | 7.0 | Loaded only when a log database is configured |
| google-auth-library | none | 11.3 | Replaces `googleapis` and the Passport Google strategy |
| express-rate-limit, cors | none | 8.7, 2.8 | New |

Removed: `passport`, `passport-facebook`, `passport-facebook-token`, `passport-google-plus-token`, `googleapis`, `socket.io`, `moment`, `lodash`, `bcrypt`, `joi-objectid`.

Structure changes:

- `app.js` builds the app. `index.js` validates config, connects to MongoDB and then listens, with graceful shutdown.
- `lib/` holds the shared helpers: logger, tokens, `HttpError` and geo.
- `api/v1` gained `services/`, `validators/`, `authController.js` and `routes/users.js`.
- Config uses nested keys. All v1 environment variable names still work.

## Phase 2: Security hardening (done)

The controls are described in [SECURITY.md](SECURITY.md). In summary:

- Facebook tokens must be issued to this app (`debug_token`), and profile calls are signed with `appsecret_proof`.
- Google ID tokens are verified against this app's client IDs. An email is stored only when Google has verified it.
- JWT: HS256 is pinned; issuer, audience, subject and expiry are checked. The secret must be at least 32 characters in production.
- Requests: helmet headers, a CORS allow-list, rate limits (300 per 15 min overall, 20 per 15 min on `/auth`), a 10 kB body limit, Joi validation, Mongoose `sanitizeFilter`.
- Errors return JSON with a request ID and never expose internal messages.
- The container runs as a non-root user.

## Phase 3: Profile and nearby features (done)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/users/me` | Read profile |
| DELETE | `/api/v1/users/me` | Delete account |
| PATCH | `/api/v1/users/me/level` | Set skill level |
| PUT | `/api/v1/users/me/location` | Set location |
| PUT | `/api/v1/users/me/setting` | Set search distance and preferred times |
| GET | `/api/v1/users/nearby` | Find nearby users, closest first |

Nearby results never include coordinates or emails. Distances are rounded up to whole miles. See [API.md](API.md) for details.

## Phase 4: Quality and delivery (done)

| Suite | Tests | Covers |
| --- | --- | --- |
| `tests/app.test.js` | 8 | Health, readiness, headers, request IDs, 404, bad JSON, 413 |
| `tests/auth.test.js` | 8 | Login flow, concurrent logins, validation, injection, error hiding |
| `tests/users.test.js` | 13 | Auth headers, bad tokens, profile CRUD, nearby search |
| `tests/oauth.test.js` | 5 | Facebook app-ID check, `appsecret_proof`, outages, bad Google token |

Also added: ESLint 10 flat config, a Dockerfile, GitHub Actions CI (Node 22 and 24: lint, test, production audit), `.env.example`, and `npm run dev` with `--watch`.

## Phase 5: Release and migration (next)

Release only when the Google client change is ready and duplicate accounts have been cleared. The step-by-step runbook is in [RELEASE.md](RELEASE.md).

### 5.1 Close P0 gaps before release (about 5 days)

- [x] **B1** (done 2026-11-11; register the URL in the Meta App Dashboard at release, see RELEASE.md step 1) Facebook data-deletion callback: `POST /api/v1/auth/facebook/data-deletion` verifies `signed_request`, deletes the user and returns a confirmation code. Meta requires this for apps that use Facebook Login.
- [ ] **B2** Privacy policy and location retention rules; record location consent with a timestamp.
- [x] **B6** (done 2026-11-11) Return 429 as JSON: an `express-rate-limit` `handler` that calls `next(new HttpError(429, "Too many requests", "RATE_LIMITED"))`, plus `Retry-After` and a test.
- [x] **B13** (done 2026-11-11) Add migrate-mongo. Turn the RELEASE.md duplicate check and index creation into `migrations/` and `scripts/find-duplicate-users.js`.
- [ ] **B15** Scheduled backups and one restore drill, with RPO/RTO written down.
- [x] **B17** (done 2026-11-11) Opt-in discoverability: top-level `discoverable` (default `false`) plus `discoverableSince` consent timestamp, `PATCH /users/me/discoverable`, filtered in `$geoNear`. It is top-level rather than under `setting`, because `PUT /me/setting` replaces the whole object (ADR-011).
- [x] **B24** (done 2026-11-11) gitleaks secret scanning in CI: the full git history is scanned on every push and PR. A pre-commit hook follows with husky in Phase 8 (8.2).
- [x] (done 2026-11-11) Tests for `startup/config.js`: missing secret, short secret in production, half-configured Facebook.

### 5.2 Breaking changes for clients

| Change | v1 | v2 | Client action |
| --- | --- | --- | --- |
| Google login body | `access_token` (Google+) | `id_token` from Google Identity Services or a platform SDK | Required |
| Error format | Plain strings | `{ error: { code, message, details?, requestId } }` | Read `error.message` and `error.code` |
| Facebook token | Any valid token | Must be issued to this app | None for first-party apps |
| Auth header | `x-auth-token` | `Authorization: Bearer` preferred; `x-auth-token` still accepted | Optional |
| Sessions | v1 JWTs | v1 tokens have no `aud` claim and are rejected | Users sign in again |
| Nearby visibility | Everyone with a location | Opt-in via `PATCH /users/me/discoverable` | Add a visibility toggle; existing users are hidden until they opt in |

### 5.3 Pre-release checklist

- [ ] Code review and merge of `upgrade/modernize-api` into `master`.
- [ ] Generate a production JWT secret of at least 32 characters.
- [ ] Set `napi_GoogleClientId` to every client ID in use (web, iOS, Android), comma-separated. Remove `napi_GoogleClientSecret`.
- [ ] Set `napi_corsOrigins` for browser clients and `napi_trustProxy` for the load balancer.
- [ ] Client builds that send `id_token` for Google login are ready to ship.
- [ ] Back up the `users` collection.
- [ ] Resolve duplicate `facebook.id` and `google.id` values.
- [ ] Build the unique and `2dsphere` indexes before deploying.
- [ ] Point the readiness probe at `/ready` and the liveness probe at `/health`.

### 5.4 Rollout

1. Deploy to staging with production-like config. Run the test suite and do a manual Facebook and Google login.
2. Deploy the API and release the client update together, because the old Google flow cannot work either way.
3. Watch 401, 429, 5xx and 502 rates and login counts for 48 hours.

Rollback: redeploy the v1 image and restore the previous secret. The new indexes and fields are additive and harmless to v1 code. Users will need to sign in again.

## Roadmap after release (Phases 6–10)

Effort figures are rough estimates in engineer-days. Phases run in order, because each makes the next cheaper:

- The **baseline** (6) gives visibility before larger changes.
- The **restructure** (7) moves files once.
- **Standards** (8) converts them once.
- **Identity** (9) is built on the new token library rather than built twice.

Interim mitigation for the longest-standing risk, the 1-day non-revocable token: shorten `napi_jwtExpiresIn` at release if clients can silently re-authenticate with the provider SDKs (see Open decisions).

### Phase 6: Production baseline (about 2.5 weeks)

Basic P1 items from [GAP_ANALYSIS.md](GAP_ANALYSIS.md).

| # | Item | Gap IDs | Effort |
| --- | --- | --- | --- |
| 6.1 | Metrics, error tracking, alerts, on-call runbook | B21, B22, B23 | 2.5 |
| 6.2 | (Done 2026-11-13) Server request timeouts and query `maxTimeMS` | B10 | 0.5 |
| 6.3 | Redis-backed rate limiter | B19 | 1 |
| 6.4 | (Done 2026-11-13) Cursor pagination for nearby search | B7 | 1 |
| 6.5 | Structured `preferredTime` (`start`/`end` + `timeZone`) with migration | B11 | 1 |
| 6.6 | Nearby matching on overlapping availability (`?matchTimes=true`) | B16 | 2 |
| 6.7 | Data model cleanup: `currentCountryCode` decision (open), compound geo index (B14 done 2026-11-13) | B12, B14 | 0.5 |
| 6.8 | (Done 2026-11-13) `PATCH /users/me` for name and photo; security event log | B5, B4 | 1 |
| 6.9 | (Done 2026-11-13) Load test with performance budget; seed script; coverage threshold. The load test peak of 50 rps is an assumption until the expected peak is agreed | B18, B27, B28 | 1.75 |

### Phase 7: Restructure (about 1 week)

Feature modules under `src/`, a users service layer, and explicit dependencies via `createApp(deps)`. Steps 7.1–7.8 are in [RESTRUCTURE.md](RESTRUCTURE.md). There are no behaviour changes.

### Phase 8: Modern standards (about 2.5 weeks)

Node 26 LTS, Prettier and Conventional Commits, CI supply-chain hardening, a multi-stage image and compose file, Vitest, Zod env config, pino, ESM, TypeScript, Zod validators and OpenAPI 3.1, `/api/v2` with Problem Details, and migrate-mongo. Steps 8.1–8.12 are in [STANDARDS.md](STANDARDS.md). Step 8.10 (jose/JWKS) is delivered in Phase 9.

### Phase 9: Identity and security (about 3.5 weeks)

| # | Item | Gap / Std IDs | Effort |
| --- | --- | --- | --- |
| 9.1 | Refresh tokens and logout: 15-minute access tokens; rotating refresh tokens stored hashed in `sessions` with a TTL index; `POST /auth/refresh` and `/auth/logout`; reuse detection revokes the whole token family; account deletion revokes sessions | B3 | 3.5 |
| 9.2 | Asymmetric signing with `jose`, `kid`, JWKS endpoint, 90-day key rotation | A3, S10 | 2 |
| 9.3 | Roles and admin API (lookup, suspend, reports), with an admin audit trail | A5, A26 | 4 |
| 9.4 | Transactions for multi-collection writes; retention and purge jobs | A11, A13 | 1.5 |
| 9.5 | Distributed tracing; SLOs and error budgets | A24, A23 | 2 |
| 9.6 | Provider account events (Facebook deauthorize, Google RISC) | A6 | 2 |
| 9.7 | Data export endpoint | A1 | 1 |
| 9.8 | ZAP API scan in CI; external penetration test before public launch | A27, A30 | 1 + external |

### Phase 10: Product and scale (trigger-driven)

Pick items by product priority, or when their trigger in [GAP_ANALYSIS.md](GAP_ANALYSIS.md) occurs. They are not planned as one block.

| Theme | Items | First pick |
| --- | --- | --- |
| Safety (needed before public launch) | Block and report users, moderator queue | A14, together with public profiles A18 |
| Social features | Connections and invites, push notifications, real-time updates | A15 → A16 → A17 |
| Accounts | Account linking, soft delete with grace period | A4, A10 |
| Privacy | Coarsened or encrypted location storage | A2, before EU launch |
| Scale | Background jobs, caching, read scaling, circuit breaker, feature flags | A19 first; others when load demands |
| API maturity | ETags, idempotency keys, 405 handling, provider retries | A8, A9, B9, B20 |
| Quality | Business metrics, API fuzzing, contract tests, preview environments | A25, A28, A32, A31 |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Google users locked out before clients update | Medium | High | Release API and clients together; monitor Google login counts |
| Duplicate provider IDs block index creation | Medium | High | Run the duplicate check and build indexes before deploy |
| Every user must sign in again | Certain | Low | Announce it; release in a low-traffic window |
| A Mongoose 9 behaviour change slips past tests | Low | Medium | Staging soak against a copy of production data |
| Facebook Graph `v21.0` reaches end of life | Medium | Medium | Version lives in config (`auth.facebook.graphVersion`); review yearly |
| Per-instance rate limits multiply when scaled out | High once scaled | Low | 6.3 Redis store |
| Nearby search reveals rough location, or is scraped | Medium | Medium | Whole-mile rounding, no coordinates; opt-in (B17); per-user search limits; blocking (A14) |
| Facebook app restricted for missing data-deletion callback | Medium | High | B1 in Phase 5 |
| Restructure or ESM/TS conversion introduces regressions | Medium | Medium | One PR per step; no behaviour changes; integration tests unchanged during moves |
| Standards work crowds out product work | Medium | Medium | Phases 7–8 are about 3.5 weeks and can be time-boxed; Phase 6 ships first, so production is observable |
| Jest depends on an experimental Node flag | Low | Low | Pinned in `npm test`; removed by the move to Vitest (8.5) |

## Open decisions

| Decision | Options | Recommendation |
| --- | --- | --- |
| Release owner and target date | Not yet named | Name both before Phase 5 starts |
| Access-token lifetime until 9.1 ships | Keep 1 day, or shorten (e.g. 1 h) and have clients silently re-authenticate with the provider SDK | Shorten, if clients can re-authenticate silently |
| Log, metrics and error-tracking platform for 6.1 | Not yet chosen | Choose before Phase 6 starts; prefer one that accepts OpenTelemetry |
| Maximum nearby radius | 100 miles today | Keep unless product asks otherwise |
| Do the restructure and modern standards at all (Phases 7–8) | Do both, or only 8.1–8.6 (tooling) | Do both before the codebase grows further. See [RESTRUCTURE.md](RESTRUCTURE.md) and [STANDARDS.md](STANDARDS.md) |
| Formatter, test runner, JWT algorithm, v1 sunset | See [STANDARDS.md](STANDARDS.md) | ESLint + Prettier, Vitest, EdDSA, 6 months |
| `currentCountryCode` | Drop it, or replace with an ISO country code | Replace with `countryCode` if any client uses it, else drop |

## Change log

| Date | Change |
| --- | --- |
| 2026-11-13 | Phase 6.9 B18 done: `npm run loadtest`, fixed-rate load test with p95 < 200 ms budget at an assumed 50 rps; 6.9 complete |
| 2026-11-13 | Phase 6.9 B27 done: `npm run db:seed` creates sample users round a point (idempotent, removable, local only) |
| 2026-11-13 | Phase 6.9 B28 done: CI fails below the coverage thresholds (92/80/94/95) |
| 2026-11-13 | Phase 6.7 B14 done: compound geo index `{ location, discoverable, level }` with migration; B12 still needs a decision |
| 2026-11-13 | Phase 6.8 (B5, B4) done: `PATCH /users/me` for name and photo; security event log |
| 2026-11-13 | Phase 6.4 (B7) done: encrypted cursor pagination for nearby search, stable on distance ties, without a blocking sort |
| 2026-11-13 | PR #31 merged Phase 5.1 into master. Phase 6.2 (B10) done: HTTP request, header and keep-alive timeouts; MongoDB `maxTimeMS` with 503 `QUERY_TIMEOUT` |
| 2026-11-11 | Phase 5.1: B6, B1, B13, B17, B24 and config tests done (PR #30); CI lockfile fix on PR #29; nearby opt-in decided (ADR-011) |
| 2026-11-07 | Added gap analysis, restructuring and standards plans; roadmap rewritten as Phases 6–10 |
| 2026-11-07 | Phases 1–4 completed on `upgrade/modernize-api`; plan written |
