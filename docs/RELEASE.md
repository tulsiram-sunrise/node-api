# Release runbook: v2.0.0

Follow these steps in order. Each step lists who does it and how to check it worked. Phase 5 of [PLAN.md](PLAN.md) tracks overall progress.

## 0. Prerequisites

- `upgrade/modernize-api` is merged into `master`, and CI is green.
- Client builds that send `id_token` for Google login are approved and ready to publish.
- You have shell access to the production MongoDB with permission to create indexes.

## 1. Prepare configuration

Set these variables in the deployment environment. See `.env.example` for the full list.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `napi_db` | Production connection string |
| `napi_JWTPrivateKey` | New random secret, at least 32 characters |
| `napi_FacebookClientId`, `napi_FacebookClientSecret` | Facebook app credentials |
| `napi_GoogleClientId` | All Google client IDs, comma-separated |
| `napi_corsOrigins` | JSON array, e.g. `["https://app.example.com"]` |
| `napi_trustProxy` | Number of proxies in front of the app, usually `1` |

Remove `napi_GoogleClientSecret`; it is no longer used.

Optionally set `napi_publicUrl` (e.g. `https://api.example.com`) so links the API returns use the public host.

In the Meta App Dashboard, set the **Data Deletion Request Callback URL** to `https://<public host>/api/v1/auth/facebook/data-deletion`. Meta requires it for apps that use Facebook Login.

Check: the app starts in staging, and `GET /ready` returns 200.

## 2. Back up

```bash
mongodump --uri="$napi_db" --collection=users --out=backup-$(date +%F)
```

Check: the dump file exists, and its document count matches `db.users.countDocuments()`.

## 3. Find duplicate provider IDs

Run with `napi_db` pointing at production:

```bash
npm run db:find-duplicates
```

It prints each duplicated `facebook.id` / `google.id` with the `_id`s that share it. It exits with code 1 while duplicates exist, so a release job can gate on it.

If there are any, keep the oldest document for each value (the lowest `_id`), merge any profile data you need into it, and delete the rest. Record the deleted `_id`s.

Check: rerunning prints `0 duplicated value(s)` for both fields and exits with code 0.

## 4. Run migrations before deploying

Production runs with `autoIndex: false`, so indexes come only from migrations. With `napi_db` pointing at production:

```bash
npm run migrate:status   # lists pending migrations
npm run migrate:up       # applies them; stops on the first failure
```

The users-index migration refuses to run while duplicate provider IDs exist (step 3). Migrations are recorded in the `changelog` collection and guarded by a lock, so running them twice or from two places is safe.

The users nearby-index migration (B14) builds the compound geo index, then drops the plain `location_2dsphere` one. For a moment the collection has two geo indexes. That is safe: v1 runs no geo queries, and v2 passes `key: "location"` to `$geoNear`, which otherwise refuses to choose between two indexes. Keep `key` in any new `$geoNear` call.

The users country-code migration (B12) removes v1 `currentCountryCode` values, which are IDs into a `referencecodes` collection this service never had. If that collection exists in production, the migration stops, because the IDs might map to ISO codes. Either write a one-off script that sets `countryCode` from it, or confirm the data isn't needed and drop the collection. Then rerun `npm run migrate:up`. The removal can't be undone, so take the backup first (B15).

Check: `npm run migrate:status` shows no `PENDING` rows.

## 5. Deploy

1. Deploy the image to staging. Run a manual Facebook login, a Google login, `GET /users/me`, a location update and a nearby search.
2. Deploy to production with a rolling update. The readiness probe is `/ready` and the liveness probe is `/health`.
3. Publish the client updates.
4. Announce that users must sign in again, and that they must turn on visibility to appear in nearby search. Until users opt in, nearby results will be empty or sparse.

## 6. Monitor for 48 hours

| Signal | Healthy | Act if |
| --- | --- | --- |
| Successful logins per hour | Back to the pre-release level within 24 h | Google logins near zero (client config or `napi_GoogleClientId` is wrong) |
| 401 rate | Spike at release, then falling | Still elevated after 24 h |
| 502 rate | Near zero | Sustained (provider outage or network egress blocked) |
| 5xx rate | Near zero | Any sustained rate; search logs by `requestId` |
| 429 rate | Low | Many clients affected (check `napi_trustProxy`) |

## 7. Roll back if needed

1. Redeploy the v1 image and its previous environment variables, including the old JWT secret.
2. Leave the indexes in place; they are compatible with v1.
3. Users will need to sign in again.
4. Restore the backup only if data was damaged. Indexes and new fields don't require a restore.

## After the release

- Tick the Phase 5 items in [PLAN.md](PLAN.md) and add a change-log row.
- Delete the `upgrade/modernize-api` branch.
- Tag the release: `git tag v2.0.0 && git push origin v2.0.0`.
