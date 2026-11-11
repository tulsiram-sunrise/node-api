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

Check: the app starts in staging, and `GET /ready` returns 200.

## 2. Back up

```bash
mongodump --uri="$napi_db" --collection=users --out=backup-$(date +%F)
```

Check: the dump file exists, and its document count matches `db.users.countDocuments()`.

## 3. Find duplicate provider IDs

Run in `mongosh` against production:

```js
for (const field of ["facebook.id", "google.id"]) {
  const dupes = db.users.aggregate([
    { $match: { [field]: { $exists: true, $ne: null } } },
    { $group: { _id: `$${field}`, ids: { $push: "$_id" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();
  print(`${field}: ${dupes.length} duplicated values`);
  dupes.forEach((d) => printjson(d));
}
```

If there are any, keep the oldest document for each value (the lowest `_id`), merge any profile data you need into it, and delete the rest. Record the deleted `_id`s.

Check: rerunning the script prints `0 duplicated values` for both fields.

## 4. Create indexes before deploying

```js
db.users.createIndex({ "facebook.id": 1 }, { unique: true, sparse: true });
db.users.createIndex({ "google.id": 1 }, { unique: true, sparse: true });
db.users.createIndex({ location: "2dsphere" });
```

Check: `db.users.getIndexes()` lists all three.

## 5. Deploy

1. Deploy the image to staging. Run a manual Facebook login, a Google login, `GET /users/me`, a location update and a nearby search.
2. Deploy to production with a rolling update. The readiness probe is `/ready` and the liveness probe is `/health`.
3. Publish the client updates.
4. Announce that users must sign in again.

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
