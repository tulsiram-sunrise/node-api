const config = require("config");
const helmet = require("helmet");
const cors = require("cors");
const { rateLimit } = require("express-rate-limit");
const HttpError = require("../lib/httpError");

/**
 * Rate limiter whose 429 goes through the error middleware, so it has the
 * same JSON shape as every other error. Retry-After and RateLimit headers are
 * set by express-rate-limit before the handler runs.
 */
function createLimiter({ windowMs, limit, skip }) {
    return rateLimit({
        windowMs,
        limit,
        skip,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        handler: (req, res, next, options) =>
            next(new HttpError(options.statusCode, "Too many requests, try again later", "RATE_LIMITED")),
    });
}

module.exports = (app) => {
    // Set this to the number of proxies in front of the app (e.g. 1 behind a
    // load balancer) so req.ip and the rate limiter see the real client IP.
    app.set("trust proxy", config.get("trustProxy"));

    app.use(helmet());

    const origins = config.get("cors.origins");
    app.use(
        cors({
            origin: origins.length ? origins : false,
            exposedHeaders: ["x-auth-token", "x-request-id"],
            maxAge: 600,
        })
    );

    const { windowMs, max } = config.get("rateLimit");
    app.use(
        createLimiter({
            windowMs,
            limit: max,
            // Don't let load-balancer / orchestrator probes eat the budget.
            skip: (req) => req.path === "/health" || req.path === "/ready",
        })
    );
};

/** Stricter limiter for login endpoints, which call out to third parties. */
module.exports.authLimiter = () => {
    const { windowMs, authMax } = config.get("rateLimit");
    return createLimiter({ windowMs, limit: authMax });
};

module.exports.createLimiter = createLimiter;
