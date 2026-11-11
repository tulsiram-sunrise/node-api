const config = require("config");
const winston = require("winston");

const { level, format, file, mongo } = config.get("logging");

const transports = [
    new winston.transports.Console({
        silent: level === "silent",
        format:
            format === "json"
                ? winston.format.combine(winston.format.timestamp(), winston.format.json())
                : winston.format.combine(winston.format.colorize(), winston.format.simple()),
    }),
];

if (file) {
    transports.push(
        new winston.transports.File({
            filename: file,
            maxsize: 10 * 1024 * 1024,
            maxFiles: 5,
            format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
        })
    );
}

if (mongo) {
    // Loaded lazily so the MongoDB transport is only required when it is configured.
    require("winston-mongodb");
    transports.push(
        new winston.transports.MongoDB({ db: mongo, level: "warn", options: {} })
    );
}

const logger = winston.createLogger({
    level: level === "silent" ? "error" : level,
    format: winston.format.combine(winston.format.errors({ stack: true }), winston.format.splat()),
    transports,
});

module.exports = logger;
