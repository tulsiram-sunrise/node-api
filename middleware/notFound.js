const HttpError = require("../lib/httpError");

module.exports = (req, res, next) => {
    next(new HttpError(404, `Route ${req.method} ${req.path} not found`, "NOT_FOUND"));
};
