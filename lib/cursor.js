const crypto = require("node:crypto");
const config = require("config");

/**
 * Opaque, tamper-proof pagination cursors.
 *
 * A cursor can hold values clients must not see. For example, the nearby search
 * cursor holds an exact distance in meters, and the API only reveals whole miles.
 * So the payload is encrypted with AES-256-GCM, not merely signed. The key is
 * derived from jwt.secret with HKDF, separately for each `purpose`, so a cursor
 * for one endpoint can't be decrypted or replayed on another.
 *
 * Format: base64url(iv[12] | authTag[16] | ciphertext).
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;
const keys = new Map();

function keyFor(purpose) {
    const secret = config.get("jwt.secret");
    const cacheKey = `${purpose}\0${secret}`;
    if (!keys.has(cacheKey)) {
        const key = Buffer.from(crypto.hkdfSync("sha256", secret, "", `node-api:cursor:${purpose}`, 32));
        keys.set(cacheKey, key);
    }
    return keys.get(cacheKey);
}

/** Encrypt a JSON-serializable payload into a URL-safe cursor string. */
function seal(payload, purpose) {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv("aes-256-gcm", keyFor(purpose), iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** Decrypt a cursor. Returns null for anything malformed, tampered or from another purpose. */
function open(cursor, purpose) {
    try {
        const raw = Buffer.from(cursor, "base64url");
        if (raw.length <= IV_BYTES + TAG_BYTES) return null;
        const iv = raw.subarray(0, IV_BYTES);
        const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
        const decipher = crypto.createDecipheriv("aes-256-gcm", keyFor(purpose), iv, { authTagLength: TAG_BYTES });
        decipher.setAuthTag(tag);
        const body = Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
        return JSON.parse(body.toString("utf8"));
    } catch {
        return null;
    }
}

module.exports = { seal, open };
