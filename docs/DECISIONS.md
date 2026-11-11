# Architecture decision records

Each entry records a significant decision: its context, the decision itself and the consequences. Entries are append-only. To change one, add a new entry that supersedes it.

Template:

```
## ADR-NNN: Title
Date · Status: Proposed | Accepted | Superseded by ADR-NNN
**Context** — what forced a choice.
**Decision** — what we chose.
**Consequences** — what follows, good and bad.
```

---

## ADR-001: Replace Passport with direct provider token verification

2026-11-07 · Status: Accepted

**Context.** v1 used `passport-facebook-token` and `passport-google-plus-token`. The Google strategy depends on the Google+ API, which was shut down in 2019. The Facebook strategy never checks which app a token was issued to. Both packages are unmaintained, and the API is stateless, so Passport's session machinery adds nothing.

**Decision.** Verify tokens in `api/v1/services/oauth.js`. Facebook uses Graph `debug_token` (the `app_id` must match) and `/me` with `appsecret_proof`. Google uses `google-auth-library` `verifyIdToken` with our client IDs as the audience.

**Consequences.** There are two fewer unmaintained dependencies, and token substitution is closed. Google clients must send an ID token in `id_token`, which is a breaking change. Provider logic is about 100 lines that we own and test.

## ADR-002: Keep the v1 route and token contract where possible

2026-11-07 · Status: Accepted

**Context.** Existing mobile clients call `/api/v1/auth/*` and read the JWT from `x-auth-token`.

**Decision.** Keep the routes, the `x-auth-token` response header and request header, and Facebook's `access_token` field. Add `Authorization: Bearer` as the preferred header. Change only what is unavoidable (Google's body) or clearly a bug fix (the error format).

**Consequences.** Facebook clients keep working unchanged. The legacy header must be supported until a v2 API.

## ADR-003: A single JSON error shape via `HttpError`

2026-11-07 · Status: Accepted

**Context.** v1 returned plain-text errors with inconsistent status codes.

**Decision.** All errors flow through `middleware/error.js` and render as `{ error: { code, message, details?, requestId } }`. Client-visible errors are `HttpError`s; anything else becomes a generic 500.

**Consequences.** Clients can branch on `code`, and internal messages can't leak. Every new error code must be documented in API.md.

## ADR-004: Use `config` v4, not v5

2026-11-07 · Status: Accepted

**Context.** `config` v5 is published as ESM. Jest 30 can't `require()` it from our CommonJS code without experimental flags beyond the one we already use.

**Decision.** Pin `config@^4`, which is CommonJS and still maintained.

**Consequences.** Revisit this when moving to ESM (see ADR-006) or when Jest supports `require(esm)` without flags.

## ADR-005: Run Jest with `--experimental-vm-modules`

2026-11-07 · Status: Accepted

**Context.** MongoDB driver 7.8 loads `os` through a dynamic `import()`. Jest's VM sandbox rejects that without `--experimental-vm-modules`. The driver then sends empty handshake metadata, and the server refuses the connection with "Missing required sub-document 'driver'". Production is not affected.

**Decision.** `npm test` runs `node --experimental-vm-modules node_modules/jest/bin/jest.js`.

**Consequences.** Always run tests through `npm test`, never with plain `npx jest`. Recheck on each Jest or driver upgrade, and remove the flag once it is no longer needed.

## ADR-006: Stay on CommonJS JavaScript for v2.0.0

2026-11-07 · Status: Accepted

**Context.** Moving to ESM or TypeScript at the same time as four major dependency upgrades would make failures hard to attribute.

**Decision.** v2.0.0 stays CommonJS JavaScript. TypeScript and ESM are planned for Phase 8 (STANDARDS.md, ADR-010).

**Consequences.** There is no compile step. Type safety comes from Joi at the edges and from tests until Phase 8.

## ADR-007: Nearby search exposes distance only, rounded up to whole miles

2026-11-07 · Status: Accepted

**Context.** Returning coordinates or precise distances would let any user locate others by trilateration.

**Decision.** `$geoNear` results project only `id`, `name`, `profilePic`, `level` and `distanceMiles`, where `distanceMiles = max(1, ceil(miles))`. A user's own location is visible only to them.

**Consequences.** Clients can't draw others on a map. Whether users must opt in to being discoverable is still an open decision in PLAN.md.

## ADR-008: The app factory is separate from the process entry point

2026-11-07 · Status: Accepted

**Context.** v1's `index.js` built the app, connected the database and listened, all on import, so it couldn't be tested in isolation.

**Decision.** `app.js` exports `createApp()` with no side effects. `index.js` owns config validation, the database connection, `listen` and shutdown.

**Consequences.** Tests use `createApp()` with supertest and an in-memory MongoDB. The same factory can serve scripts or other runtimes.

## ADR-009: Restructure into feature modules under `src/`

2026-11-07 · Status: Proposed

**Context.** Code is grouped by technical type inside the versioned folder `api/v1/`. Models and services would be shared awkwardly with any v2, a feature change touches 4–5 folders, and business logic (nearby search) lives in a controller. Details are in [RESTRUCTURE.md](RESTRUCTURE.md).

**Decision.** After v2.0.0, move runtime code to `src/` with `core/`, `infra/`, `config/` and `modules/<feature>/`. Add a service layer per module and pass dependencies explicitly through `createApp(deps)`. Only HTTP routing is versioned.

**Consequences.** About 5 engineer-days of mechanical moves with no behaviour change. Import boundaries become lint-enforced. Supersedes ADR-008's file locations, but not its principle.

## ADR-010: Adopt late-2026 Node standards (ESM, TypeScript, Vitest, Zod, pino)

2026-11-07 · Status: Proposed

**Context.** v2.0.0 is current on dependency versions but not on practice: CommonJS, untyped code, Jest behind an experimental flag (ADR-005), `config` pinned for CommonJS (ADR-004), and a custom error format. Node now runs TypeScript natively and supports `require(esm)`, so neither needs a build step. Details are in [STANDARDS.md](STANDARDS.md).

**Decision.** After the restructure, move to Node 26 LTS, ESM, TypeScript (type stripping plus `tsc --noEmit`), Vitest, Zod for validation and config, pino for logging, OpenAPI 3.1, and RFC 9457 Problem Details in `/api/v2`.

**Consequences.** About 14 engineer-days. Supersedes ADR-004, ADR-005 and ADR-006 once accepted. v1 stays frozen and is later deprecated with `Deprecation`/`Sunset` headers.
