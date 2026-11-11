const mongoose = require("mongoose");
const logger = require("../lib/logger");

// Reject unknown fields in query filters, and strip `$`-operators that arrive
// inside user-supplied filter values (NoSQL injection defence in depth).
mongoose.set("strictQuery", true);
mongoose.set("sanitizeFilter", true);

async function connect(uri) {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
    logger.info("Connected to MongoDB");
    mongoose.connection.on("disconnected", () => logger.warn("MongoDB disconnected"));
    mongoose.connection.on("reconnected", () => logger.info("MongoDB reconnected"));
}

async function disconnect() {
    await mongoose.disconnect();
}

const isConnected = () => mongoose.connection.readyState === 1;

module.exports = { connect, disconnect, isConnected };
