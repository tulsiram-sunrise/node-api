# Conventions

These rules keep the codebase consistent. CI enforces the ones ESLint can check; reviewers enforce the rest.

## Language and modules

- Plain JavaScript, CommonJS (`require` / `module.exports`), targeting Node 22 and later.
- Use modern syntax freely: `?.`, `??`, `??=`, numeric separators (`10_000`), top-level `async` helpers.
- Import built-ins with the `node:` prefix: `require("node:crypto")`.
- Use the global `fetch` and `AbortSignal.timeout()` for outbound HTTP. Don't add an HTTP client library.

## Formatting

- 4-space indent, double quotes, semicolons, trailing commas in multi-line literals.
- Aim for lines of 100 characters or less.
- `const` by default, `let` only when you reassign, never `var`. Always `===`. ESLint enforces these.

## Naming

| Thing | Style | Example |
| --- | --- | --- |
| Files | camelCase `.js` | `userController.js`, `requestContext.js` |
| Classes, Mongoose models | PascalCase | `HttpError`, `User` |
| Functions, variables | camelCase | `verifyFacebookToken`, `radiusMiles` |
| Module constants | UPPER_SNAKE_CASE | `MIN_SECRET_LENGTH`, `REQUEST_TIMEOUT_MS` |
| Error codes | UPPER_SNAKE_CASE strings | `LOCATION_REQUIRED` |
| Env vars | `napi_` + camelCase (`PORT` excepted) | `napi_corsOrigins` |
| Config keys | camelCase, nested by area | `auth.facebook.appId` |
| URL paths | lower-case nouns, `/me` for the caller | `/users/me/location` |
| JSON fields | camelCase; keep a provider's field name when it is the provider's token | `distanceMiles`, `id_token` |

Put the unit in the name when a number has one: `windowMs`, `radiusMiles`, `SHUTDOWN_TIMEOUT_MS`.

## Where code goes

| You are adding | Put it in | Rule |
| --- | --- | --- |
| An endpoint | `api/v1/routes/<resource>.js` | Route table only: path, middleware, controller |
| Input rules | `api/v1/validators/<resource>.js` | One Joi schema per endpoint, exported by name |
| Request handling | `api/v1/controllers/<resource>Controller.js` | `async (req, res)`; no try/catch just to forward errors |
| Third-party calls | `api/v1/services/<name>.js` | No `req`/`res`; throw `HttpError` for client-visible failures |
| Persistence rules | `api/v1/models/<model>.js` | Schema, indexes, `toJSON`, statics for multi-step writes |
| Cross-cutting middleware | `middleware/` | Not tied to an API version |
| Pure helpers | `lib/` | No imports from `api/`, `startup/` or `middleware/` |
| App wiring | `startup/` | Called from `app.js` or `index.js` |

## HTTP API

- Mount every route under `/api/v1`. Breaking changes need a new version folder, not edits to v1.
- Methods: `GET` reads; `POST` creates or runs an action; `PUT` replaces a whole sub-resource; `PATCH` changes one field; `DELETE` removes.
- Status codes: 200 with a body, 201 on create (with a `Location` header), 204 with no body, 4xx for client errors, 5xx only for server or upstream failures.
- Success responses return the resource itself, or a named object for collections: `{ count, users: [...] }`. Never return a bare array.
- Never return a raw Mongoose document with private fields. Rely on `toJSON`, or project explicitly as `nearby` does.
- Every list has a `limit` with a maximum.

## Validation

- Every endpoint that accepts input has a Joi schema applied through `validate(schema, source)`.
- `stripUnknown` is on, so a schema is also the field allow-list. If a field isn't in the schema, it doesn't reach the database.
- Bound everything: string `max`, number `min`/`max`, array `max`.
- Read validated query values from `req.validated.query`. Express 5 makes `req.query` read-only.
- Put enum values in the model (`LEVELS`, `DAYS`) and import them into validators, so they are defined once.

## Errors

- To send a client-visible error, `throw new HttpError(status, message, CODE[, details])` or pass it to `next()`.
- Never call `res.status(4xx).send(...)` directly. All errors go through `middleware/error.js`, so the shape stays the same.
- Messages are short, human-readable, and safe to show to an end user. Never put internal details, stack traces or input echoes in them.
- Any other thrown error becomes a generic 500 and is logged with the request ID.
- When you add a new error code, add it to the table in [API.md](API.md).

## Database

- Use `async`/`await` only; Mongoose 9 has no callbacks.
- Use atomic operators (`$set`, `$setOnInsert`, `findOneAndUpdate` with `upsert`) instead of read-modify-save.
- Updates pass `{ returnDocument: "after", runValidators: true }`.
- Declare indexes in the schema, and also create them by script before any release that adds them (see [RELEASE.md](RELEASE.md)).
- Store coordinates as GeoJSON `[lng, lat]`. The API exposes `{ lat, lng }`; convert with `lib/geo.js`.
- Mongoose doesn't cast aggregation pipelines. Pass real `ObjectId`s and validated values.

## Logging

- Import `lib/logger.js`. Never use `console.*` in application code.
- Levels: `error` for bugs and failures needing action, `warn` for expected-but-notable events (provider outage, config gaps), `info` for lifecycle, `http` for access logs, `debug` for development detail.
- Include `requestId` in metadata whenever a request is in scope.
- Never log tokens, secrets, full request bodies or emails.

## Configuration

- Every new setting gets a default in `config/default.json`, an env mapping in `custom-environment-variables.json` if it varies per environment, a line in `.env.example`, and fail-fast validation in `startup/config.js` if it is required.
- Read config at the point of use (`config.get("a.b")`), not at module load, unless the value can't change.
- Secrets never go in JSON config files. They come only from environment variables.

## Tests

- Every endpoint has tests for the success path, validation failures, an auth failure, and any privacy rule.
- Tests use `createApp()` with supertest and `tests/helpers/db.js` for a fresh in-memory MongoDB. Never connect to a real database.
- Mock outbound HTTP at the service boundary: `jest.mock("../api/v1/services/oauth")` or a stubbed `global.fetch`. Never call the real providers.
- Name tests as behaviour: `it("rejects tokens issued to another app")`.
- Run with `npm test`, not `npx jest` (see [DECISIONS.md](DECISIONS.md) ADR-005).

## Git and pull requests

- Branch from `master`: `feature/<topic>`, `fix/<topic>`, `chore/<topic>`, `upgrade/<topic>`.
- Commit subjects are imperative and at most 72 characters: `Add nearby search level filter`. Use the body to explain why.
- One logical change per PR. CI (lint, tests, production audit) must be green before merge.
- A PR that changes behaviour also updates [API.md](API.md), [PLAN.md](PLAN.md) and, for decisions, [DECISIONS.md](DECISIONS.md).
- Never commit `.env`, logs or secrets. `.gitignore` covers the usual paths.

## Dependencies

- Add a dependency only when it removes real work or risk. Prefer Node built-ins.
- Use caret ranges in `package.json`. The committed `package-lock.json` is the source of truth; CI installs with `npm ci`.
- Every new runtime dependency must leave `npm run audit:prod` clean.
