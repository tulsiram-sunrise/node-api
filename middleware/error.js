const winston = require("winston");

module.exports = (err, req, res, next) => {
    /**
     * winston has following methods, and the order in which
     * they preffered to be logged(Logging levels)
     *
     * 1) error
     * 2) warn
     * 3) info
     * 4) verbose
     * 5) debug
     * 6) silly
     */

    winston.error(err.message, err);

    res.status(500).send("Something failed...");
};
