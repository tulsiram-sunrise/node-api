const HttpError = require("../lib/httpError");

/**
 * Validate req[source] against a Joi schema. Unknown keys are stripped.
 * In Express 5 req.query is read-only, so validated query values are exposed
 * on req.validated.query; a validated body replaces req.body.
 */
module.exports = (schema, source = "body") => (req, res, next) => {
    const { value, error } = schema.validate(req[source] ?? {}, {
        abortEarly: false,
        stripUnknown: true,
    });

    if (error) {
        const details = error.details.map((d) => ({ path: d.path.join("."), message: d.message }));
        return next(new HttpError(400, "Validation failed", "VALIDATION_ERROR", details));
    }

    if (source === "body") req.body = value;
    req.validated = { ...req.validated, [source]: value };
    next();
};
