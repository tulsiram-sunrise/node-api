const config = require("config");
const helmet = require("helmet");
const cors = require("cors");
const { rateLimit } = require("express-rate-limit");

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
        rateLimit({
            windowMs,
            limit: max,
            standardHeaders: "draft-8",
            legacyHeaders: false,
            // Don't let load-balancer / orchestrator probes eat the budget.
            skip: (req) => req.path === "/health" || req.path === "/ready",
        })
    );
};

/** Stricter limiter for login endpoints, which call out to third parties. */
module.exports.authLimiter = () => {
    const { windowMs, authMax } = config.get("rateLimit");
    return rateLimit({
        windowMs,
        limit: authMax,
        standardHeaders: "draft-8",
        legacyHeaders: false,
    });
};
