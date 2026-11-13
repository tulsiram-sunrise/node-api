# CLAUDE.md

Project memory for AI coding assistants working in this repository. Keep it short; details live in `docs/`.

## What this is

An Express 5 + MongoDB (Mongoose 9) REST API. It handles Facebook/Google social login (issuing JWTs), user profiles (level, location, settings) and nearby-user search. It uses CommonJS JavaScript on Node 22 or later.

Current work: v2.0.0 is merged into `master`, not released. Phases 1–4 and the Phase 5.1 code items are done; Phase 5 still waits on decisions (B2, B15, release owner and date). Phase 6 (production baseline) is in progress, one feature branch per item. See `docs/PLAN.md`.

Planned (not started, don't do ahead of time): Phase 7 moves code to `src/modules/*` (`docs/RESTRUCTURE.md`); Phase 8 moves to ESM, TypeScript, Vitest, Zod and pino (`docs/STANDARDS.md`). Until then, follow the current CommonJS/Joi/Jest conventions. When a task touches a gap from `docs/GAP_ANALYSIS.md`, refer to its ID (e.g. B6, A14).

## Commands

```bash
npm run dev        # node --watch, loads .env if present
npm start          # production start
npm test           # Jest + in-memory MongoDB. ALWAYS use this, never `npx jest` (needs --experimental-vm-modules)
npm run lint       # ESLint 10 flat config
npm run audit:prod # fails on high/critical advisories in production deps
npm run migrate:up # apply DB migrations (migrations/); production has autoIndex=false
```

Before you finish any code change, run `npm run lint && npm test`.

## Layout

- `index.js` is the process entry (config check → DB connect → listen → graceful shutdown). `app.js` has `createApp()`, which has no side effects.
- `startup/` holds config validation, the DB connection plus global Mongoose settings, security middleware, and routes.
- `middleware/` holds request context, Joi `validate`, `notFound` and the single `error` handler.
- `lib/` holds the logger, `tokens` (JWT), `HttpError` and `geo`. It never imports from `api/`.
- In `api/v1/`: `routes/` contain wiring only, `validators/` hold Joi, `controllers/` are thin, `services/` make outbound HTTP calls, and `models/` hold Mongoose.
- `tests/*.test.js` use supertest against `createApp()`. `tests/helpers/db.js` starts mongodb-memory-server.

## Rules that matter most

- Errors: `throw new HttpError(status, message, "CODE")`. Never `res.status(4xx).send()`. Add new codes to `docs/API.md`.
- Every input goes through `validate(schema, "body" | "query")` with bounded Joi schemas. Read query values from `req.validated.query` (Express 5 `req.query` is read-only).
- Database writes are atomic (`$set`, `$setOnInsert`, upserts) with `{ returnDocument: "after", runValidators: true }`. Don't use `new: true`; it is deprecated in Mongoose 9.
- Never return private fields. `toJSON` strips `provider`, `facebook`, `google` and `__v`. Nearby search returns only `discoverable: true` users (opt-in, ADR-011) and never returns coordinates or emails.
- Use `lib/logger.js`, never `console.*`. Never log tokens, secrets or emails. Never commit real secrets, even in tests or examples (CI runs gitleaks). Test fixtures use obviously fake values.
- Mock providers at `api/v1/services/oauth` or `global.fetch` in tests. Never call real Facebook or Google.
- New index: declare it in the model AND add a migration in `migrations/`. `tests/migrations.test.js` checks they match.
- New config: add a default in `config/default.json`, an env mapping in `custom-environment-variables.json`, a line in `.env.example`, and validation in `startup/config.js` if it's required.
- Keep the v1 contract: the `x-auth-token` header, Facebook `access_token`, the same routes.

## Gotchas

- `config` is pinned to v4 because v5 is ESM-only and breaks Jest (ADR-004).
- Jest needs `--experimental-vm-modules`, or MongoDB driver 7.8 sends an empty handshake and every DB test fails (ADR-005).
- Use `127.0.0.1`, not `localhost`, in Mongo URIs (Node may resolve to IPv6).
- Aggregation pipelines aren't cast by Mongoose, so pass real `ObjectId`s.

## Docs map

`docs/PLAN.md` (status, roadmap) · `docs/GAP_ANALYSIS.md` · `docs/RESTRUCTURE.md` · `docs/STANDARDS.md` · `docs/ARCHITECTURE.md` · `docs/API.md` · `docs/CONVENTIONS.md` · `docs/BEST_PRACTICES.md` · `docs/SECURITY.md` · `docs/RELEASE.md` · `docs/DECISIONS.md`

When you change behaviour, update the matching doc in the same change. When you finish a plan item, tick it in `docs/PLAN.md`.
