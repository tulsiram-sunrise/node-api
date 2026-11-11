# Modernization plan: current standards

Status: Proposed · As of 2026-11-07 · Roadmap: Phase 8 in [PLAN.md](PLAN.md) · Decision: ADR-010 in [DECISIONS.md](DECISIONS.md)

## Verdict

v2.0.0 brought every dependency to its current major. It still uses 2019-era *ways of working*: CommonJS, untyped JavaScript, Jest with an experimental flag, Joi, winston, a custom error shape, and symmetric JWTs with no rotation. This plan moves those to what a new Node API would use in late 2026.

Do it after the restructure ([RESTRUCTURE.md](RESTRUCTURE.md)), so each file moves once and is converted once.

Library versions below are the latest published on 2026-11-07. Pin the current version at the time each step is implemented.

## Gap table

| # | Area | Today | Current standard | Why change |
| --- | --- | --- | --- | --- |
| S1 | Runtime | Node >= 22; image `node:24-alpine`; CI on 22 and 24 | **Node 26 (Active LTS since Oct 2026)**; CI on 24 and 26; `engines: ">=24"` | Node 22 is in maintenance until April 2027. 26 is supported until 2029 |
| S2 | Modules | CommonJS | **ESM** (`"type": "module"`) | Ecosystem default; several deps (`config` 5, `jose`) are ESM-first; removes ADR-004 |
| S3 | Language | JavaScript | **TypeScript run natively by Node** (type stripping, no build step) + `tsc --noEmit` (TypeScript 7 native compiler) for checking | Type safety without a compile step; verified working on local Node 24 |
| S4 | Tests | Jest 30 + `--experimental-vm-modules` | **Vitest 5** (Jest-compatible API, native ESM/TS) | Removes the flag workaround (ADR-005); faster watch mode |
| S5 | Validation | Joi 18 | **Zod 4** | One schema gives runtime validation, TS types and OpenAPI |
| S6 | Config | `config` 4 + JSON files + env mapping | **Zod-validated env** in `src/config`, loaded with Node `--env-file` in dev | One source of truth; typed; no ESM blocker |
| S7 | Logging | winston 3 (+ optional MongoDB transport) | **pino 10 + pino-http 11**, JSON to stdout, built-in `redact` | Faster; standard JSON; ship logs with the platform, not into the app's own database |
| S8 | Error format | Custom `{ error: { code, message } }` | **RFC 9457 Problem Details** (`application/problem+json`) with `code` and `requestId` extensions | Standard tooling understands it. Breaking, so ship it in `/api/v2` (see below) |
| S9 | API description | README tables | **OpenAPI 3.1** generated from Zod (`@asteasolutions/zod-to-openapi` 9); Spectral lint in CI; docs UI outside production | Contract-first clients, codegen, fuzzing (GAP_ANALYSIS.md) |
| S10 | Tokens | HS256 JWT, 1 day, one shared secret, `jsonwebtoken` | **EdDSA (Ed25519) or ES256** with `kid`, JWKS at `/.well-known/jwks.json`, `typ: at+jwt` (RFC 9068), 15-minute access tokens + rotating refresh tokens (RFC 9700), library **`jose` 6** | Key rotation without signing everyone out; other services can verify without the secret (RFC 8725 BCP) |
| S11 | Deprecation signalling | None | **`Deprecation` (RFC 9745) and `Sunset` (RFC 8594) headers** on legacy `x-auth-token` use and, later, all of v1 | Machine-readable warning before removal |
| S12 | Formatting | ESLint only | ESLint 10 + **typescript-eslint 8** + **Prettier 3**; `.editorconfig`; `.nvmrc` | No style debates in review |
| S13 | Commits and releases | Free-form commits, manual versions | **Conventional Commits** (commitlint) + husky/lint-staged pre-commit + **release-please** (SemVer tags, CHANGELOG.md) | Automated changelog and versioning |
| S14 | CI supply chain | `npm audit` on production deps | Actions pinned by commit SHA; Dependabot (npm, actions, docker); CodeQL; gitleaks; `npm audit signatures`; CycloneDX SBOM (`npm sbom`); Trivy image scan; cosign signing + build provenance; OpenSSF Scorecard | Current supply-chain baseline (SLSA level 2 or higher) |
| S15 | Container | Single stage, `npm ci` in the final image | **Multi-stage** build, production deps only, read-only root filesystem, non-root, digest-pinned base | Smaller attack surface, reproducible builds |
| S16 | Local dev | Needs your own MongoDB | **`compose.yaml`** with MongoDB plus the app in watch mode | One-command setup for new contributors |
| S17 | Observability | Access log line only | **OpenTelemetry** SDK (traces + metrics), W3C `traceparent` propagation, trace ID in logs | Vendor-neutral standard (GAP_ANALYSIS.md has details) |
| S18 | DB migrations | Snippets in RELEASE.md | **migrate-mongo 14**, versioned in `migrations/`, run as a release step | Repeatable index and data changes |

## Error format in v2 (S8)

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/location-required",
  "title": "Set your location first",
  "status": 409,
  "detail": "Nearby search needs your location. Call PUT /api/v2/users/me/location first.",
  "instance": "/api/v2/users/nearby",
  "code": "LOCATION_REQUIRED",
  "requestId": "8c10a3f4-2713-40ee-8d66-d4fe7daf965c"
}
```

Validation errors add `"errors": [{ "pointer": "/location/lat", "detail": "must be ≤ 90" }]`. Error codes stay the same as v1, so clients can migrate by changing only how they parse the response.

Ship it as `/api/v2`, and keep `/api/v1` frozen with its current shape. Once v2 is live, v1 responses get `Deprecation` and `Sunset` headers with at least 6 months' notice.

## Order of work

Each step is a separate PR with green CI. Steps 8.1–8.3 make the later steps cheaper.

| Step | Change | Depends on | Effort |
| --- | --- | --- | --- |
| 8.1 | Node 26: image, CI matrix (24, 26), `engines >=24`, `.nvmrc` | — | 0.25 day |
| 8.2 | Prettier, `.editorconfig`, husky + lint-staged, commitlint, release-please | — | 0.5 day |
| 8.3 | CI supply chain: SHA-pinned actions, Dependabot, CodeQL, gitleaks, SBOM, Trivy | — | 1 day |
| 8.4 | Multi-stage Dockerfile, `compose.yaml` | 8.1 | 0.5 day |
| 8.5 | Replace Jest with Vitest; drop the experimental flag | — | 0.5 day |
| 8.6 | Replace `config` with a Zod env schema; replace winston with pino + pino-http (redact `authorization`, `x-auth-token`, `*.access_token`, `*.id_token`) | 8.5 | 1 day |
| 8.7 | Convert to ESM, module by module (`require(esm)` allows a mixed codebase meanwhile) | Phase 7 restructure | 1 day |
| 8.8 | Convert to TypeScript: `strict`, `erasableSyntaxOnly`, `verbatimModuleSyntax`; `npm run typecheck` in CI | 8.7 | 3 days |
| 8.9 | Replace Joi with Zod; generate OpenAPI 3.1; Spectral lint; docs UI outside production | 8.8 | 2 days |
| 8.10 | `jose` + asymmetric keys + JWKS + `kid` (together with refresh tokens, Phase 9) | 8.8 | 2 days |
| 8.11 | `/api/v2` with Problem Details; deprecation headers on v1 | 8.9 | 2 days |
| 8.12 | migrate-mongo; move index creation out of `autoIndex` into migrations | Phase 7.7 | 0.5 day |

Total: about 14 engineer-days. OpenTelemetry (S17) is scheduled with the observability work in [GAP_ANALYSIS.md](GAP_ANALYSIS.md).

## TypeScript notes (S3)

Node runs `.ts` files directly by stripping types. This was verified on Node 24.22 and is unflagged on 22.18+/23.6+. Constraints:

- **Erasable syntax only.** No `enum`, `namespace`, or constructor parameter properties. Use `as const` objects and union types instead. Set `"erasableSyntaxOnly": true` so `tsc` enforces this.
- **Write the real extension** in imports (`./users.service.ts`) and set `"allowImportingTsExtensions": true` with `"noEmit": true`.
- **Use `import type`** for type-only imports (`"verbatimModuleSyntax": true`).
- **Type stripping doesn't check types.** `npm run typecheck` (`tsc --noEmit`) is a required CI step.
- **Mongoose types:** derive them from the schema with `InferSchemaType`. Don't hand-write interfaces.

## Decisions to make before starting

| Question | Options | Recommendation |
| --- | --- | --- |
| Formatter/linter | ESLint + Prettier, or Biome 2 for both | ESLint + Prettier: the boundary rules and typescript-eslint need ESLint anyway |
| Test runner | Vitest, or built-in `node:test` | Vitest: Jest-compatible migration, better watch mode and mocking |
| JWT algorithm | EdDSA (Ed25519), or ES256 | EdDSA, unless a consuming platform lacks support; then ES256 |
| Where keys live | Env var PEM, or a cloud KMS / secret manager | Secret manager, rotated every 90 days, with two active `kid`s during rotation |
| v1 sunset | 6 or 12 months after v2 ships | 6 months, with telemetry on remaining v1 callers |

## Done when

- [ ] `node src/server.ts` runs in production on Node 26 with no build step.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run audit:prod` all pass in CI, and there are no `require` calls left.
- [ ] `docs/openapi.yaml` is generated, linted, and matches the routes (checked in CI).
- [ ] Every error from `/api/v2` is `application/problem+json`.
- [ ] Tokens carry a `kid`, and the JWKS endpoint serves current and previous keys.
- [ ] Releases, tags and CHANGELOG.md are produced by release-please.
- [ ] Images are signed and have an SBOM and provenance attached.
- [ ] ADR-004 and ADR-005 are marked Superseded.
