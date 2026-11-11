const { randomUUID } = require("node:crypto");
const logger = require("../lib/logger");

const SAFE_ID = /^[\w-]{1,64}$/;

/** Assigns a request id (honouring a sane incoming x-request-id) and logs each request. */
module.exports = (req, res, next) => {
    const incoming = req.get("x-request-id");
    req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader("x-request-id", req.id);

    const start = process.hrtime.bigint();
    res.on("finish", () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        logger.http(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`, {
            requestId: req.id,
        });
    });
    next();
};
