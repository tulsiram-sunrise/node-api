const crypto = require("node:crypto");
const config = require("config");
const { OAuth2Client } = require("google-auth-library");
const HttpError = require("../../../lib/httpError");
const logger = require("../../../lib/logger");

const REQUEST_TIMEOUT_MS = 5_000;

const notConfigured = (name) =>
    new HttpError(501, `${name} login is not configured`, "PROVIDER_NOT_CONFIGURED");
const invalidToken = (name) => new HttpError(401, `Invalid ${name} token`, "INVALID_TOKEN");

async function graphGet(url, name) {
    let res;
    try {
        res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
        logger.warn(`${name} request failed: ${err.message}`);
        throw new HttpError(502, `${name} is unreachable`, "PROVIDER_UNAVAILABLE");
    }
    const body = await res.json().catch(() => ({}));
    if (res.status >= 500) {
        throw new HttpError(502, `${name} is unavailable`, "PROVIDER_UNAVAILABLE");
    }
    if (!res.ok) throw invalidToken(name);
    return body;
}

/**
 * Verify a Facebook user access token and return the identity behind it.
 * Checks that the token was issued for *this* app (debug_token) so tokens
 * minted for other apps can't be replayed here, and signs the profile call
 * with appsecret_proof.
 */
async function verifyFacebookToken(accessToken) {
    const { appId, appSecret, graphVersion } = config.get("auth.facebook");
    if (!appId || !appSecret) throw notConfigured("Facebook");

    const base = `https://graph.facebook.com/${graphVersion}`;

    const debugUrl = new URL(`${base}/debug_token`);
    debugUrl.searchParams.set("input_token", accessToken);
    debugUrl.searchParams.set("access_token", `${appId}|${appSecret}`);
    const { data } = await graphGet(debugUrl, "Facebook");
    if (!data?.is_valid || String(data.app_id) !== String(appId) || !data.user_id) {
        throw invalidToken("Facebook");
    }

    const meUrl = new URL(`${base}/me`);
    meUrl.searchParams.set("fields", "id,name,email,picture.type(large)");
    meUrl.searchParams.set("access_token", accessToken);
    meUrl.searchParams.set(
        "appsecret_proof",
        crypto.createHmac("sha256", appSecret).update(accessToken).digest("hex")
    );
    const me = await graphGet(meUrl, "Facebook");
    if (String(me.id) !== String(data.user_id)) throw invalidToken("Facebook");

    return {
        provider: "facebook",
        providerId: String(me.id),
        email: me.email,
        name: me.name,
        profilePic: me.picture?.data?.url,
    };
}

const base64UrlDecode = (value) => Buffer.from(value, "base64url");

/**
 * Verify and decode a Facebook `signed_request` (sent to the data-deletion
 * callback). Format: base64url(HMAC-SHA256(payload, appSecret)) + "." + base64url(JSON payload).
 * Returns the payload; throws 400 if the signature or format is wrong.
 */
function parseFacebookSignedRequest(signedRequest) {
    const { appSecret } = config.get("auth.facebook");
    if (!appSecret) throw notConfigured("Facebook");

    const invalid = () =>
        new HttpError(400, "Invalid signed_request", "INVALID_SIGNED_REQUEST");

    const [encodedSig, encodedPayload, ...rest] = String(signedRequest).split(".");
    if (!encodedSig || !encodedPayload || rest.length) throw invalid();

    const expected = crypto.createHmac("sha256", appSecret).update(encodedPayload).digest();
    const actual = base64UrlDecode(encodedSig);
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
        throw invalid();
    }

    let payload;
    try {
        payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8"));
    } catch {
        throw invalid();
    }
    if (String(payload?.algorithm).toUpperCase() !== "HMAC-SHA256" || !payload.user_id) {
        throw invalid();
    }
    return payload;
}

let googleClient;

/**
 * Verify a Google ID token (from Google Identity Services / Sign-In SDKs).
 * `auth.google.clientId` may be a comma-separated list to accept web, iOS
 * and Android client IDs.
 */
async function verifyGoogleToken(idToken) {
    const clientId = config.get("auth.google.clientId");
    if (!clientId) throw notConfigured("Google");

    googleClient ??= new OAuth2Client();
    const audience = clientId.split(",").map((s) => s.trim()).filter(Boolean);

    let payload;
    try {
        const ticket = await googleClient.verifyIdToken({ idToken, audience });
        payload = ticket.getPayload();
    } catch (err) {
        logger.debug(`Google token rejected: ${err.message}`);
        throw invalidToken("Google");
    }
    if (!payload?.sub) throw invalidToken("Google");

    return {
        provider: "google",
        providerId: payload.sub,
        // Only trust addresses Google has verified.
        email: payload.email_verified ? payload.email : undefined,
        name: payload.name,
        profilePic: payload.picture,
    };
}

module.exports = { verifyFacebookToken, verifyGoogleToken, parseFacebookSignedRequest };
