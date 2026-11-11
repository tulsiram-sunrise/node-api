const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const db = require("../../startup/db");

let server;

async function start() {
    server = await MongoMemoryServer.create();
    await db.connect(server.getUri());
    await mongoose.model("User").syncIndexes();
}

async function clear() {
    const { collections } = mongoose.connection;
    await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

async function stop() {
    await db.disconnect();
    await server?.stop();
}

module.exports = { start, clear, stop };
