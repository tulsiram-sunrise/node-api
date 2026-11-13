const logger = require("../lib/logger");
const HttpError = require("../lib/httpError");

// MongoDB server error code for a query that ran past its maxTimeMS.
const MAX_TIME_MS_EXPIRED = 50;

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
    } else if (err.code === MAX_TIME_MS_EXPIRED) {
        // Query hit maxTimeMS (GAP B10): transient overload, safe for the client to retry.
        status = 503;
        code = "QUERY_TIMEOUT";
        message = "The request took too long; please retry";
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
