# API reference (v1)

Base URL: `/api/v1`. All requests and responses are JSON. Request bodies are limited to 10 kB.

## Authentication

Sign in through `/auth/facebook` or `/auth/google`. The JWT comes back in the `x-auth-token` response header. Send it on later requests as:

```
Authorization: Bearer <token>
```

The legacy header `x-auth-token: <token>` is still accepted. Tokens expire after `jwt.expiresIn`, which is 1 day by default.

## Errors

Every error uses the same shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [{ "path": "location.lat", "message": "\"location.lat\" must be less than or equal to 90" }],
    "requestId": "8c10a3f4-2713-40ee-8d66-d4fe7daf965c"
  }
}
```

`details` appears only on validation errors. Quote `requestId` when you report a problem; it is also returned in the `x-request-id` header.

| Status | Code | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Body or query failed validation |
| 400 | `ENTITY_PARSE_FAILED` | Malformed JSON |
| 400 | `INVALID_ID` | Malformed ObjectId in a path parameter |
| 401 | `UNAUTHENTICATED` | No token sent |
| 401 | `INVALID_TOKEN` | JWT or provider token is invalid or expired |
| 404 | `NOT_FOUND` | Unknown route |
| 404 | `USER_NOT_FOUND` | The token's user no longer exists |
| 409 | `LOCATION_REQUIRED` | Nearby search before setting a location |
| 413 | `ENTITY_TOO_LARGE` | Body over 10 kB |
| 429 | `RATE_LIMITED` | Rate limit exceeded; wait `Retry-After` seconds |
| 500 | `INTERNAL_ERROR` | Unexpected server error; no details are exposed |
| 501 | `PROVIDER_NOT_CONFIGURED` | That social provider is not set up on this server |
| 502 | `PROVIDER_UNAVAILABLE` | Facebook could not be reached or returned a 5xx |

## Rate limits

- All routes except `/health` and `/ready`: 300 requests per 15 minutes per IP.
- `/auth/*`: 20 requests per 15 minutes per IP.

Responses carry `RateLimit` and `RateLimit-Policy` headers (IETF draft 8 format).

---

## Auth

### `POST /auth/facebook`

```json
{ "access_token": "<Facebook user access token>" }
```

The token must have been issued for this server's Facebook app. Returns `200` with the user (see [User object](#user-object)) and the JWT in `x-auth-token`. The account is created on first sign-in.

### `POST /auth/google`

```json
{ "id_token": "<Google ID token>" }
```

Get the ID token from Google Identity Services (web) or the Google Sign-In SDK (iOS/Android). Its audience must be one of the configured client IDs. The response is the same as for Facebook.

---

## Users

All routes in this section require authentication.

### `GET /users/me`

Returns the current user.

### `DELETE /users/me`

Deletes the account. Returns `204`. The JWT keeps validating until it expires, but every user route then returns `404 USER_NOT_FOUND`.

### `PATCH /users/me/level`

```json
{ "level": "Intermediate" }
```

Allowed values: `Beginner`, `Intermediate`, `Advanced`. Returns the updated user.

### `PUT /users/me/location`

```json
{ "location": { "lat": 51.5074, "lng": -0.1278 } }
```

`lat` must be between -90 and 90, and `lng` between -180 and 180. Returns the updated user.

### `PUT /users/me/setting`

```json
{
  "distance": 10,
  "preferredTime": [{ "day": "Monday", "timing": "18:00-20:00" }]
}
```

- `distance`: 1–100 miles. It is the default radius for nearby search.
- `preferredTime`: up to 21 entries. `day` is a full English weekday name; `timing` is free text of up to 50 characters.

The whole `setting` object is replaced. Unknown keys are dropped.

### `GET /users/nearby`

| Query | Type | Default |
| --- | --- | --- |
| `distance` | miles, 1–100 | `setting.distance`, otherwise 10 |
| `level` | `Beginner` \| `Intermediate` \| `Advanced` | any |
| `limit` | 1–50 | 20 |

```json
{
  "radiusMiles": 10,
  "count": 2,
  "users": [
    { "id": "665f…", "name": "Asha", "profilePic": "https://…", "level": "Advanced", "distanceMiles": 1 },
    { "id": "665e…", "name": "Ben", "level": "Beginner", "distanceMiles": 3 }
  ]
}
```

Results are sorted closest first and never include the caller. Coordinates and emails are never returned, and `distanceMiles` is rounded up to a whole mile. Returns `409 LOCATION_REQUIRED` if the caller has not set a location.

---

## User object

```json
{
  "id": "665f1c2e9b1e8a0012345678",
  "email": "jane@example.com",
  "name": "Jane",
  "profilePic": "https://…",
  "level": "Beginner",
  "location": { "lat": 51.5074, "lng": -0.1278 },
  "setting": { "distance": 10, "preferredTime": [{ "day": "Monday", "timing": "18:00-20:00" }] },
  "createdAt": "2026-11-07T10:00:00.000Z",
  "updatedAt": "2026-11-07T10:05:00.000Z"
}
```

Fields that have no value are omitted.

## Operational endpoints (no `/api` prefix)

| Path | Response |
| --- | --- |
| `GET /` | `{ "message": "node apis running fine" }` |
| `GET /health` | `200 { "status": "ok", "uptime": <seconds> }` |
| `GET /ready` | `200 { "status": "ready" }`, or `503 { "status": "unavailable" }` while MongoDB is down |
