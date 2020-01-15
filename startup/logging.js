const config = require("config");
const winston = require("winston");
require("winston-mongodb");
require("express-async-errors");

module.exports = () => {
    // adding console to log in development mode
    if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
        winston.add(new winston.transports.Console({ format: winston.format.simple() }));
    }

    // This line will catch and log all the uncatughtException and unhandledRejection
    // occured outside of request processing pipe line
    winston.exceptions.handle(
        new winston.transports.File({ filename: "uncaughtExceptions.log" })
    );

    // This line will cause unhandledRejection to be caught by winston
    process.on("unhandledRejection", err => {
        throw err;
    });

    // Here setting file or database where logging will be done by winston
    winston.add(new winston.transports.File({ filename: "logfile.log" }));
    winston.add(new winston.transports.MongoDB({ db: config.get("log_db") }));
};
