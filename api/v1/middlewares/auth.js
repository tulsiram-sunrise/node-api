const tokens = require("../../../lib/tokens");
const HttpError = require("../../../lib/httpError");

function extractToken(req) {
    const header = req.get("authorization");
    if (header) {
        const [scheme, value] = header.split(" ");
        return scheme?.toLowerCase() === "bearer" ? value?.trim() : undefined;
    }
    // Legacy header kept for existing v1 clients.
    return req.get("x-auth-token");
}

/** Require a valid access token; exposes its claims on req.auth. */
module.exports = (req, res, next) => {
    const token = extractToken(req);
    if (!token) {
        return next(new HttpError(401, "Authentication required", "UNAUTHENTICATED"));
    }
    try {
        req.auth = tokens.verify(token);
    } catch {
        return next(new HttpError(401, "Invalid or expired token", "INVALID_TOKEN"));
    }
    next();
};
