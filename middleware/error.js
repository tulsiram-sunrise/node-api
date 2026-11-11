const logger = require("../lib/logger");
const HttpError = require("../lib/httpError");

// Express identifies error handlers by their 4-argument signature.
module.exports = (err, req, res, next) => {
    if (res.headersSent) return next(err);

    let status = 500;
    let code = "INTERNAL_ERROR";
    let message = "Internal Server Error";
    let details;

    if (err instanceof HttpError) {
        ({ status, message, details } = err);
        code = err.code ?? code;
    } else if (err.name === "ValidationError" || err.name === "CastError") {
        // Mongoose validation that slipped past request validation.
        status = 400;
        code = "VALIDATION_ERROR";
        message = "Invalid data";
    } else if (err.expose && err.status >= 400 && err.status < 500) {
        // body-parser / http-errors (malformed JSON, payload too large, ...)
        status = err.status;
        code = err.type ? err.type.toUpperCase().replace(/\W/g, "_") : "BAD_REQUEST";
        message = err.message;
    }

    if (status >= 500) {
        // Known upstream/config conditions (502, 501) are warnings; anything else is a bug.
        logger[err instanceof HttpError ? "warn" : "error"](err.message, { err, requestId: req.id, path: req.originalUrl });
    }

    res.status(status).json({
        error: { code, message, ...(details && { details }), requestId: req.id },
    });
};
