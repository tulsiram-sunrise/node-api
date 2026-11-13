const config = require("config");
const logger = require("../lib/logger");

const MIN_SECRET_LENGTH = 32;

/**
 * Fail fast on configuration that would make the API insecure or unusable.
 * Social providers are optional: an unconfigured provider answers 501.
 */
module.exports = function validateConfig() {
    const secret = config.get("jwt.secret");
    if (!secret) {
        throw new Error("FATAL ERROR: jwt.secret (env napi_JWTPrivateKey) is not defined.");
    }
    if (secret.length < MIN_SECRET_LENGTH) {
        const msg = `jwt.secret should be at least ${MIN_SECRET_LENGTH} characters long.`;
        if (process.env.NODE_ENV === "production") throw new Error(`FATAL ERROR: ${msg}`);
        logger.warn(msg);
    }

    const fb = config.get("auth.facebook");
    const google = config.get("auth.google");
    if (Boolean(fb.appId) !== Boolean(fb.appSecret)) {
        throw new Error("FATAL ERROR: Facebook appId and appSecret must be set together.");
    }
    if (!fb.appId && !google.clientId) {
        logger.warn("No social login provider is configured; /api/v1/auth/* will return 501.");
    }

    validateTimeouts(config.get("timeouts"));
};

function validateTimeouts(timeouts) {
    for (const [name, value] of Object.entries(timeouts)) {
        if (!Number.isInteger(value) || value <= 0) {
            throw new Error(`FATAL ERROR: timeouts.${name} must be a positive integer (milliseconds).`);
        }
    }
    // Node requires headersTimeout <= requestTimeout.
    if (timeouts.headersMs > timeouts.requestMs) {
        throw new Error("FATAL ERROR: timeouts.headersMs must not exceed timeouts.requestMs.");
    }
}
