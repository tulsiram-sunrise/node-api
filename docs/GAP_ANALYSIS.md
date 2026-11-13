# Gap analysis: what is missing

Status: Proposed · As of 2026-11-07 · Feeds Phases 6, 9 and 10 in [PLAN.md](PLAN.md)

This lists what a production API of this kind is expected to have but node-api does not, split into **basic** (expected before or soon after go-live) and **advanced** (needed as usage, team or risk grows). Restructuring and tooling standards are covered separately in [RESTRUCTURE.md](RESTRUCTURE.md) and [STANDARDS.md](STANDARDS.md).

Priority: **P0** = before or at the v2.0.0 release · **P1** = within the next quarter · **P2** = when the trigger in the notes occurs. Effort is in engineer-days.

## Summary

| Category | Basic gaps | Advanced gaps |
| --- | --- | --- |
| Compliance and platform rules | 2 | 2 |
| Auth and accounts | 3 | 4 |
| API design | 5 | 3 |
| Data model and database | 5 | 4 |
| Product features | 2 | 5 |
| Reliability and performance | 3 | 5 |
| Observability | 3 | 3 |
| Security testing and supply chain | 2 | 4 |
| Developer experience | 4 | 2 |

The two P0 gaps that are easiest to miss: **Facebook requires a data-deletion callback** for apps that use Facebook Login, and **the stored `preferredTime` settings are never used** by the search they were designed for.

---

## Basic gaps

### Compliance and platform rules

| ID | Gap | Why it matters | Fix | Pri | Effort |
| --- | --- | --- | --- | --- | --- |
| B1 | No Facebook **data deletion callback** | Meta's platform policy requires apps using Facebook Login to provide a data-deletion callback URL or instructions URL. Without it, app review can fail or the app can be restricted | `POST /api/v1/auth/facebook/data-deletion`: verify the `signed_request` HMAC with the app secret, delete the user by `facebook.id`, return `{ url, confirmation_code }`, and add a status page for the code | P0 | 1 |
| B2 | No privacy policy or retention rules for location data | Location is personal data under GDPR and similar laws. You need a stated purpose, retention period and consent | Document retention (e.g. drop locations not updated for 90 days); record location consent with a timestamp; link the policy from the clients | P0 | 1 + legal |

### Auth and accounts

| ID | Gap | Why it matters | Fix | Pri | Effort |
| --- | --- | --- | --- | --- | --- |
| B3 | No logout or token revocation | A stolen or leaked token is valid for 24 h; account deletion doesn't end sessions | Refresh tokens + sessions collection (PLAN 9.1); until then, shorten `expiresIn` | P1 | 3–4 |
| B4 | No security event log | You can't answer "who signed in when, from where" during an incident | Log `auth.login`, `auth.login_failed`, `user.deleted` with user ID, IP and user agent at `info` (no tokens); retain 90 days | P1 | 0.5 |
| B5 | Name and photo can't be edited | They are set once from the provider. Users can't fix a wrong name or remove a photo | `PATCH /users/me` for `name` (1–100 chars, trimmed) and `profilePic` (null to remove) | P1 | 0.5 |

### API design

| ID | Gap | Why it matters | Fix | Pri | Effort |
| --- | --- | --- | --- | --- | --- |
| B6 | 429 is plain text | Breaks the documented error contract | `handler` → `HttpError(429, …, "RATE_LIMITED")` plus `Retry-After` (PLAN 5.1) | P0 | 0.25 |
| B7 | (Done 2026-11-13, PLAN 6.4; cursor is encrypted because it holds an exact distance) No pagination beyond `limit` | Nearby search returns at most 50 users and there's no way to get the next page | Cursor pagination: `?cursor=` holding the last distance and `_id`, plus `nextCursor` in the response; `$geoNear` with `minDistance` | P1 | 1 |
| B8 | No published API description | Clients reverse-engineer the README | OpenAPI 3.1 (STANDARDS S9). Until then, API.md is the contract | P1 | 2 |
| B9 | `404` instead of `405` for a wrong method on a known path | Misleading for client developers | Per-router `.all()` fallback returning 405 with an `Allow` header | P2 | 0.25 |
| B10 | (Done 2026-11-13, PLAN 6.2) No server-side request timeout | A slow MongoDB query holds a connection indefinitely | Set `server.requestTimeout` and `headersTimeout`; set `keepAliveTimeout` above the load balancer's idle timeout; `maxTimeMS` on queries | P1 | 0.5 |

### Data model and database

| ID | Gap | Why it matters | Fix | Pri | Effort |
| --- | --- | --- | --- | --- | --- |
| B11 | `preferredTime.timing` is free text | Can't be compared or matched (`"6-8pm"` vs `"18:00-20:00"`), and there's no time zone | `{ day, start: "HH:mm", end: "HH:mm" }` plus user `timeZone` (IANA name); migrate existing values | P1 | 1 |
| B12 | `currentCountryCode` refers to a model that doesn't exist | A dead field that can't be populated or validated | Decide: drop it, or replace it with an ISO 3166-1 alpha-2 `countryCode` string | P1 | 0.25 |
| B13 | No migration tooling | Index and data changes rely on manual snippets | migrate-mongo with `migrations/` (STANDARDS S18) | P0 | 0.5 |
| B14 | Nearby `level` filter isn't covered by an index | Filtered geo queries scan more documents than they need to | Compound index `{ location: "2dsphere", level: 1 }` | P1 | 0.25 |
| B15 | No backup and restore procedure beyond the release dump | Data loss has no tested recovery | Scheduled backups (Atlas or `mongodump`), quarterly restore drill, documented RPO/RTO | P0 | 1 |

### Product features

| ID | Gap | Why it matters | Fix | Pri | Effort |
| --- | --- | --- | --- | --- | --- |
| B16 | Nearby search ignores `preferredTime` | Users enter availability, but matching only uses distance and level | Add `?matchTimes=true`: return only users with an overlapping day/time slot, and add `overlapSlots` to each result. Needs B11 | P1 | 2 |
| B17 | Discoverability is not a user choice | Everyone with a location is visible to everyone | `setting.discoverable` (default `false`), filtered in `$geoNear` (PLAN 5.1 decision) | P0 | 0.5 |

### Reliability and performance

| ID | Gap | Why it matters | Fix | Pri | Effort |
| --- | --- | --- | --- | --- | --- |
| B18 | No load test or performance budget | Capacity is unknown before launch | k6 script for login (with providers mocked), `/users/me` and `/users/nearby`; budget p95 < 200 ms at the expected peak RPS | P1 | 1 |
| B19 | Rate limiter is per instance | Limits multiply when scaled out | Redis store (`rate-limit-redis`) | P1 | 1 |
| B20 | No retries for transient provider failures | A single network blip fails a login | One retry with jitter on network errors and 5xx for the Graph API; never retry 4xx | P2 | 0.25 |

### Observability

| ID | Gap | Why it matters | Fix | Pri | Effort |
| --- | --- | --- | --- | --- | --- |
| B21 | No metrics | No request rate, latency or error dashboards; no alerts | RED metrics per route plus provider latency (OpenTelemetry metrics, or `prom-client` at `/metrics`) | P1 | 1 |
| B22 | No error tracking | 500s are visible only by searching logs | Sentry (or an equivalent) with `requestId` and release tags; scrub PII | P1 | 0.5 |
| B23 | No alerting or on-call runbook | Nobody is told when login breaks | Alerts on 5xx above 1 %, 502 above 5 %, login success rate dropping 50 % hour-on-hour, and `/ready` failing; a runbook per alert | P1 | 1 |

### Security testing and supply chain

| ID | Gap | Why it matters | Fix | Pri | Effort |
| --- | --- | --- | --- | --- | --- |
| B24 | No secret scanning | A committed secret goes unnoticed | gitleaks in CI and pre-commit (STANDARDS S14) | P0 | 0.25 |
| B25 | No automated dependency updates | Advisories pile up between manual upgrades | Dependabot or Renovate (STANDARDS S14) | P1 | 0.25 |

### Developer experience

| ID | Gap | Why it matters | Fix | Pri | Effort |
| --- | --- | --- | --- | --- | --- |
| B26 | No local stack | New contributors must install MongoDB | `compose.yaml` (STANDARDS S16) | P1 | 0.5 |
| B27 | No seed data | Manual testing of nearby search needs hand-made users | `scripts/seed.js`: around 200 users scattered round a configurable point, mixed levels and times | P1 | 0.5 |
| B28 | No coverage threshold | Coverage can quietly fall | Measure the current coverage, set the CI threshold just below it, raise it over time | P1 | 0.25 |
| B29 | No CHANGELOG or tagged versions | Clients can't see what changed | release-please (STANDARDS S13) | P1 | 0.25 |

---

## Advanced gaps

### Compliance and privacy

| ID | Gap | Fix | Trigger / Pri | Effort |
| --- | --- | --- | --- | --- |
| A1 | No user data export | `GET /users/me/export` (GDPR Art. 15/20) | P1 | 1 |
| A2 | Exact coordinates stored at full precision | Store a coarsened point (about 100 m, geohash precision 7) unless exact matching is needed; or encrypt the field with MongoDB Queryable Encryption | Before EU launch · P2 | 1–3 |

### Auth and accounts

| ID | Gap | Fix | Trigger / Pri | Effort |
| --- | --- | --- | --- | --- |
| A3 | Symmetric signing, no key rotation | Asymmetric JWT + JWKS + `kid` (STANDARDS S10) | With refresh tokens · P1 | 2 |
| A4 | One account per provider identity | Account linking that proves both identities; never by email | User demand · P2 | 3 |
| A5 | No roles or admin capability | `role` claim (`user`, `moderator`, `admin`); `/admin` routes for user lookup, suspension and report handling; admin actions audit-logged | Before any moderation need · P1 | 3 |
| A6 | No reaction to provider-side account events | Facebook deauthorize callback; Google Cross-Account Protection (RISC) events to revoke sessions | P2 | 2 |

### API design

| ID | Gap | Fix | Trigger / Pri | Effort |
| --- | --- | --- | --- | --- |
| A7 | No v2 API or deprecation process | `/api/v2` with Problem Details plus deprecation headers on v1 (STANDARDS S8, S11) | P2 | 2 |
| A8 | No conditional requests | `ETag` on `GET /users/me`; `If-Match` on updates to prevent lost updates from two devices | Multi-device clients · P2 | 1 |
| A9 | No idempotency on retried writes | `Idempotency-Key` header on non-idempotent `POST`s, stored 24 h | When payments or invites arrive · P2 | 1 |

### Data model and database

| ID | Gap | Fix | Trigger / Pri | Effort |
| --- | --- | --- | --- | --- |
| A10 | No soft delete or grace period | `deletedAt` plus a 30-day purge job, so accidental deletion can be undone | P2 | 1 |
| A11 | No multi-document transactions | Use transactions when one action writes several collections (e.g. account deletion plus sessions plus blocks) | With 9.1 / 10.2 · P1 | 0.5 |
| A12 | No read scaling | Read preference `secondaryPreferred` for nearby search; Atlas Search or a geo cache for hot areas | Above around 500 RPS on nearby · P2 | 2 |
| A13 | No data retention jobs | Scheduled purge of stale locations, expired sessions (TTL index) and old security logs | With B2 · P1 | 1 |

### Product features

| ID | Gap | Fix | Trigger / Pri | Effort |
| --- | --- | --- | --- | --- |
| A14 | No safety tools | Block and report users; blocked users hidden both ways; moderator queue (needs A5) | Before public launch · P1 | 3 |
| A15 | No connections or messaging | Invite / accept a nearby user; activity requests built around `preferredTime` slots | Product decision · P2 | 5+ |
| A16 | No notifications | Push notifications (FCM/APNs) for invites and new nearby matches; device-token registration endpoint | With A15 · P2 | 3 |
| A17 | No real-time updates | WebSocket or SSE channel for invites and messages | With A15 · P2 | 3 |
| A18 | No public profile view | `GET /users/:id` with public fields only; respects blocks | P1 | 1 |

### Reliability and performance

| ID | Gap | Fix | Trigger / Pri | Effort |
| --- | --- | --- | --- | --- |
| A19 | No background job system | BullMQ on Redis for purges, notifications and exports | With A13 or A16 · P2 | 2 |
| A20 | No caching | Short-TTL Redis cache for public profiles; Google certificate caching is already handled by the library | Above around 1k RPS · P2 | 1 |
| A21 | No circuit breaker for providers | Open the breaker after repeated Graph API failures and return 502 immediately | Frequent provider incidents · P2 | 0.5 |
| A22 | No feature flags | Env-driven flags at first; a flag service later, for gradual rollouts such as `matchTimes` | P2 | 0.5 |
| A23 | No SLOs | Define SLOs (e.g. 99.9 % of logins succeed; nearby p95 < 300 ms) with error budgets driving release decisions | After B21–B23 · P1 | 0.5 |

### Observability

| ID | Gap | Fix | Trigger / Pri | Effort |
| --- | --- | --- | --- | --- |
| A24 | No distributed tracing | OpenTelemetry traces across HTTP, MongoDB and provider calls; trace ID in logs (STANDARDS S17) | P1 | 1.5 |
| A25 | No business metrics | Daily sign-ins per provider, location-set rate, nearby searches with zero results | P2 | 0.5 |
| A26 | No audit trail for data access | Append-only audit log for admin reads and writes of user data | With A5 · P1 | 1 |

### Security testing and supply chain

| ID | Gap | Fix | Trigger / Pri | Effort |
| --- | --- | --- | --- | --- |
| A27 | No dynamic security testing | OWASP ZAP API scan against staging in CI, driven by OpenAPI | After S9 · P1 | 1 |
| A28 | No API fuzzing | Schemathesis against the OpenAPI spec | After S9 · P2 | 0.5 |
| A29 | No signed artifacts or provenance | cosign plus build provenance, SBOM attached to images (STANDARDS S14) | P1 | 0.5 |
| A30 | No external review | Penetration test against the OWASP API Security Top 10 before public launch | P1 | external |

### Developer experience

| ID | Gap | Fix | Trigger / Pri | Effort |
| --- | --- | --- | --- | --- |
| A31 | No preview environments | Per-PR ephemeral environment with seeded data | Team of 3+ · P2 | 2 |
| A32 | No contract tests with clients | Consumer-driven contract tests (e.g. Pact), or OpenAPI diffing in CI to block breaking changes | Several client teams · P2 | 1 |

---

## OWASP API Security Top 10 (2023) check

| Risk | Status | Remaining gap |
| --- | --- | --- |
| API1 Broken object-level authorization | OK: all user routes act on `req.auth.sub`; there are no `/:id` writes | Keep it so when A18 and A5 add `/:id` routes |
| API2 Broken authentication | Mostly OK | B3, A3 |
| API3 Broken object-property-level authorization | OK: `stripUnknown` and projections | Add a test per new field |
| API4 Unrestricted resource consumption | Partly: rate and body limits, list `limit`, request and query timeouts (B10), cursor pagination (B7) | B19 |
| API5 Broken function-level authorization | Not applicable yet (no roles) | Design together with A5 |
| API6 Unrestricted access to sensitive business flows | Partly | Per-user limits on nearby search to stop location harvesting by scraping |
| API7 Server-side request forgery | OK: outbound calls only to fixed provider hosts | Never fetch user-supplied URLs (e.g. `profilePic`) server-side |
| API8 Security misconfiguration | Mostly OK | B24, A27 |
| API9 Improper inventory management | Gap | B8, A7 |
| API10 Unsafe consumption of APIs | OK: timeout, app-ID checks, response validation | B20, A21 |

## How these feed the plan

- **P0 items** go into Phase 5 (release): B1, B2, B6, B13, B15, B17, B24.
- **P1 basics** form Phase 6 (production baseline).
- **P1/P2 advanced items** are split across Phase 9 (identity and security) and Phase 10 (product and scale).

See the roadmap in [PLAN.md](PLAN.md) for sequencing.
