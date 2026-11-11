const mongoose = require("mongoose");
const HttpError = require("../lib/httpError");

module.exports = (req, res, next) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
        return next(new HttpError(400, "Invalid id", "INVALID_ID"));
    }
    next();
};
