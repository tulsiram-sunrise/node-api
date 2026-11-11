# Security

This document covers what the API protects, how it does it, and what each change must be checked against.

## Reporting a vulnerability

Do not open a public issue. Email the maintainer (the repository owner) with the steps to reproduce. Expect an acknowledgement within 3 working days.

## Assets and threats

| Asset | Threat | Controls |
| --- | --- | --- |
| User accounts | Sign-in with a token issued to another app; forged tokens | Facebook `debug_token` app-ID check plus `appsecret_proof`; Google `verifyIdToken` audience check |
| API sessions | JWT forgery, algorithm confusion, token reuse across services | HS256 pinned; `iss`/`aud`/`exp` checked; secret of at least 32 characters required in production |
| User location | Unwanted discovery; exact position disclosed, or trilateration | Opt-in discoverability with consent timestamp; coordinates never returned to others; whole-mile rounding; caller excluded from results; owner-only `location` |
| Personal data | Leaking emails or provider IDs | `select: false`; `toJSON` strips internal fields; nearby search projects public fields only |
| Database | NoSQL operator injection; mass assignment | Joi with `stripUnknown`; Mongoose `sanitizeFilter` and `strictQuery` |
| Availability | Brute force, flooding, large payloads, hung upstreams | Rate limits (300 overall and 20 on auth per 15 min per IP); 10 kB body cap; 5 s provider timeouts |
| Error channel | Stack traces or internal messages exposed | A single error handler; generic 500 message; request ID for correlation |
| Browser clients | Clickjacking, MIME sniffing, cross-origin abuse | helmet defaults; CORS allow-list (empty by default) |
| Supply chain | Vulnerable or malicious packages | Minimal dependencies; CI production audit; `npm ci --ignore-scripts` in the image |
| Host | Container breakout impact | Non-root `node` user; minimal Alpine image |

## Known gaps (tracked in PLAN.md)

| Gap | Risk | Plan item |
| --- | --- | --- |
| Access tokens last 1 day and can't be revoked | A stolen token works until it expires | PLAN 9.1 refresh tokens (GAP B3) |
| Rate limits are per instance | Limits multiply when scaled out | PLAN 6.3 Redis store (GAP B19) |
| No blocking between users | Harassment through nearby search | GAP A14 (Phase 10, before public launch) |
| No secret scanning, DAST or penetration test | Leaked secrets or exploitable flaws found late | GAP B24, A27, A30 |

The OWASP API Security Top 10 (2023) check is in [GAP_ANALYSIS.md](GAP_ANALYSIS.md).

## Secrets

| Secret | Env var | Rotation |
| --- | --- | --- |
| JWT signing key | `napi_JWTPrivateKey` | Rotating it signs every user out. Plan rotation with asymmetric keys and `kid` (PLAN 9.2) |
| Facebook app secret | `napi_FacebookClientSecret` | Rotate in the Facebook developer console, then redeploy |
| Google client IDs | `napi_GoogleClientId` | Not secret, but must match every client build |

Generate the JWT key with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

## Security review checklist for pull requests

- [ ] New input has a Joi schema with bounds, and `stripUnknown` still applies.
- [ ] New queries use validated values only. Aggregations get real `ObjectId`s, not strings from the request.
- [ ] Responses expose only intended fields. Add a test asserting private fields are absent.
- [ ] New errors use `HttpError` with a safe message and a code listed in API.md.
- [ ] Outbound calls have a timeout and map upstream failures to 502.
- [ ] No secrets, tokens or emails in logs.
- [ ] New config secrets come from environment variables only.
- [ ] `npm run audit:prod` is clean.
- [ ] Location or other personal-data features follow the privacy rules above.
