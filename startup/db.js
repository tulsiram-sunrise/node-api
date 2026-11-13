const mongoose = require("mongoose");
const logger = require("../lib/logger");

// Reject unknown fields in query filters, and strip `$`-operators that arrive
// inside user-supplied filter values (NoSQL injection defence in depth).
mongoose.set("strictQuery", true);
mongoose.set("sanitizeFilter", true);

/**
 * @param {string} uri
 * @param {{ autoIndex?: boolean, maxTimeMS?: number }} [options]
 *   autoIndex=false in production: indexes are created by migrations
 *   (npm run migrate:up), not at startup.
 *   maxTimeMS: server-side time limit for find, findOne, countDocuments,
 *   findOneAndUpdate and aggregate (GAP B10). A query that runs over it fails
 *   with MaxTimeMSExpired, which the error handler returns as 503 QUERY_TIMEOUT.
 */
async function connect(uri, { autoIndex = true, maxTimeMS } = {}) {
    if (maxTimeMS) mongoose.set("maxTimeMS", maxTimeMS);
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, autoIndex });
    logger.info("Connected to MongoDB");
    mongoose.connection.on("disconnected", () => logger.warn("MongoDB disconnected"));
    mongoose.connection.on("reconnected", () => logger.info("MongoDB reconnected"));
}

async function disconnect() {
    await mongoose.disconnect();
}

const isConnected = () => mongoose.connection.readyState === 1;

module.exports = { connect, disconnect, isConnected };
