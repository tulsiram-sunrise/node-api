# Restructuring plan

Status: Proposed · Roadmap: Phase 7 in [PLAN.md](PLAN.md) · Decision: ADR-009 in [DECISIONS.md](DECISIONS.md)

## Verdict

Yes, a moderate restructuring is worth doing, but **after** v2.0.0 is released and **before** the TypeScript/ESM migration ([STANDARDS.md](STANDARDS.md)). That way each file moves once and gets converted once.

The current layout works for 2 resources. It will hurt as soon as roadmap features add sessions, blocks, reports and admin. The problems are structural, not cosmetic:

| # | Problem today | Why it matters | Where |
| --- | --- | --- | --- |
| R1 | Models and services live inside the versioned folder `api/v1/` | A future `/api/v2` would import its database schema from `v1`. Data is not versioned; HTTP is | `api/v1/models`, `api/v1/services` |
| R2 | Files are grouped by technical type (routes/, controllers/, validators/) | One feature change touches 4–5 folders. Ownership and boundaries are invisible | `api/v1/*` |
| R3 | No service layer for users; business logic sits in the controller | The nearby search's `$geoNear` pipeline and its privacy rules can't be reused (e.g. by a future admin view or a job) or unit-tested without HTTP | `userController.nearby` |
| R4 | Two middleware folders with different names | `middleware/` and `api/v1/middlewares/`, so it's unclear where new middleware goes | |
| R5 | Source code mixed with tooling at the repo root | `app.js`, `index.js`, `lib/`, `startup/` sit next to config, Docker and CI files | root |
| R6 | Hidden singletons instead of explicit dependencies | `logger`, `config`, the OAuth verifiers and `User` are `require`d everywhere, so tests must use `jest.mock` module patching | all |
| R7 | `startup/` mixes unrelated concerns | Config validation, the DB driver, security middleware and the route table are all "startup" | `startup/` |
| R8 | Tests are flat and integration-only | No home for fast unit tests of pure logic (tokens, geo, nearby rounding, privacy projection) | `tests/` |
| R9 | No home for scripts and migrations | The duplicate-check and index scripts exist only as snippets in RELEASE.md | |

## Target layout

Feature modules ("vertical slices") inside `src/`. Each module owns its routes, controller, service, schemas, model and tests. HTTP versioning happens only at the router.

```
src/
  server.js                 # process entry: config → db → listen → shutdown   (was index.js)
  app.js                    # createApp(deps)                                   (was app.js)
  config/
    index.js                # load + validate env once, export a frozen object (replaces `config` pkg, see STANDARDS.md)
  core/                     # framework-level, no business logic
    errors.js               # HttpError (+ Problem Details later)               (was lib/httpError.js)
    logger.js                                                                   (was lib/logger.js)
    http/
      requestContext.js  validate.js  notFound.js  errorHandler.js  security.js  (was middleware/*, startup/security.js)
      authenticate.js                                                         (was api/v1/middlewares/auth.js)
  infra/
    mongo.js                # connect / disconnect / isConnected              (was startup/db.js)
  modules/
    auth/
      auth.routes.js  auth.controller.js  auth.schemas.js  auth.service.js
      tokens.js                                                                 (was lib/tokens.js)
      providers/facebook.js  providers/google.js                                (split from services/oauth.js)
      auth.test.js
    users/
      users.routes.js  users.controller.js  users.schemas.js
      users.service.js      # nearby search, profile updates, privacy projection (moved out of the controller)
      user.model.js                                                            (was api/v1/models/user.js)
      geo.js                                                                   (was lib/geo.js)
      users.test.js  users.service.test.js
    health/
      health.routes.js                                                         (from startup/routes.js)
  routes/
    v1.js                   # mounts module routers under /api/v1
scripts/
  find-duplicate-users.js   # from RELEASE.md step 3
migrations/                 # versioned DB migrations (indexes, backfills); see GAP_ANALYSIS.md
tests/
  helpers/  integration/    # cross-module flows (login → profile → nearby)
```

### Dependency rules for the new layout

```
routes/ → modules/*/routes → controller → service → model / providers
                                        ↘ core, infra, config
```

- A module may import from `core/`, `infra/`, `config/` and its own files.
- A module may import another module **only through that module's service**, never its model. For example, `users` asks `auth` to revoke sessions on account deletion.
- `core/` and `infra/` never import from `modules/`.
- Controllers are 3–10 lines: read the validated input, call one service function, send the result.
- Services take plain arguments and return plain objects. They never see `req` or `res`.
- An ESLint rule enforces these boundaries: `no-restricted-imports` now, `eslint-plugin-boundaries` if it grows.

### Explicit dependencies (R6)

`createApp(deps)` receives its collaborators instead of each file reaching for globals:

```js
// src/server.js
const app = createApp({ config, logger, providers: { facebook, google }, clock: Date });
// tests
const app = createApp({ ...testDeps, providers: { facebook: fakeFacebook, google: fakeGoogle } });
```

Keep this light: plain factory functions, no DI container library. Modules export a factory, `usersModule(deps) → { router, service }`. Tests then stop needing `jest.mock` for providers.

## Migration steps

Each step is one pull request. The full test suite must pass after every step. Use `git mv` so history follows the files.

| Step | Change | Risk | Effort |
| --- | --- | --- | --- |
| 7.1 | Create `src/`; move `app.js`, rename `index.js` → `src/server.js`; update `package.json` `main`/scripts, the Dockerfile and CI | Low | 0.5 day |
| 7.2 | Create `core/` and `infra/`; move `lib/`, `middleware/`, `startup/` pieces; merge the two middleware folders | Low | 0.5 day |
| 7.3 | Create `modules/health` and `routes/v1.js` | Low | 0.25 day |
| 7.4 | Create `modules/auth`: split `oauth.js` into `providers/facebook.js` and `providers/google.js`; add `auth.service.js` (verify → upsert → sign) | Medium | 1 day |
| 7.5 | Create `modules/users`: move the model; extract `users.service.js` from the controller; add service unit tests | Medium | 1 day |
| 7.6 | Introduce `createApp(deps)` and module factories; replace `jest.mock` with injected fakes | Medium | 1 day |
| 7.7 | Add `scripts/` and `migrations/`; turn the RELEASE.md snippets into scripts | Low | 0.5 day |
| 7.8 | Add import-boundary lint rules; update ARCHITECTURE.md, CONVENTIONS.md and CLAUDE.md | Low | 0.5 day |

Total: about 5 engineer-days.

## Rules during the restructuring

- **Make no behaviour changes.** API responses, status codes and logs stay byte-for-byte the same. The existing integration tests are the safety net, so don't change their assertions in these PRs.
- **Don't mix in other work.** Moves and refactors only. Features and dependency upgrades go in separate PRs.
- **Freeze the area being moved.** Announce which module is moving, so others avoid conflicting edits for that day.
- **Update the docs in the last step** (7.8), not piecemeal.

## Done when

- [ ] The repo root holds only tooling, config and docs. All runtime code is in `src/`.
- [ ] No file under `src/modules/<a>` imports `src/modules/<b>/*.model.js`.
- [ ] Controllers contain no database or HTTP-client calls.
- [ ] Unit tests exist for `tokens`, `geo` and `users.service`, and run in under 1 s without MongoDB.
- [ ] `jest.mock` / `vi.mock` is no longer used for providers.
- [ ] ARCHITECTURE.md describes the new layout.
