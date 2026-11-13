/**
 * Child process for scripts/loadtest.js (GAP B18). Not for direct use.
 *
 * Starts an in-memory MongoDB, seeds users, replaces the Facebook/Google
 * verification with a local stub (load tests must never call real providers),
 * and serves createApp() on a random local port. Reports { port, tokens } to
 * the parent over IPC and shuts down on "stop".
 *
 * Config comes from NODE_CONFIG set by the parent: a random JWT secret per run,
 * rate limits lifted, logging at error, NODE_ENV=production (so autoIndex is
 * off and the indexes are built here, as the migrations would).
 */
const http = require("node:http");
const { MongoMemoryServer } = require("mongodb-memory-server");
const db = require("../startup/db");
const { User } = require("../api/v1/models/user");
const oauth = require("../api/v1/services/oauth");
const tokens = require("../lib/tokens");
const createApp = require("../app");
const { generateSeedUsers } = require("./lib/seedUsers");

const CENTER = { lat: 51.5074, lng: -0.1278 };
const TOKEN_POOL = 200;

// The auth controller calls oauth.verify*Token through the module object, so
// replacing the functions here takes effect for every request.
const stubIdentity = (provider) => async (token) => ({ provider, providerId: String(token), name: "Load User" });
oauth.verifyGoogleToken = stubIdentity("google");
oauth.verifyFacebookToken = stubIdentity("facebook");

async function main() {
    const users = Number(process.env.LOADTEST_USERS) || 2000;
    const mongo = await MongoMemoryServer.create();
    await db.connect(mongo.getUri("loadtest"), { autoIndex: false });
    await User.createIndexes();
    await User.insertMany(generateSeedUsers({ count: users, center: CENTER, radiusMiles: 20, seed: 1 }));

    const sample = await User.find().select("_id").limit(TOKEN_POOL).lean();
    const server = http.createServer(createApp());
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    process.on("message", async (msg) => {
        if (msg !== "stop") return;
        server.close();
        await db.disconnect();
        await mongo.stop();
        process.exit(0);
    });
    process.send({
        port: server.address().port,
        users,
        tokens: sample.map((u) => tokens.sign(u)),
        seedIds: Array.from({ length: Math.min(users, TOKEN_POOL) }, (_, i) => `seed-${i + 1}`),
    });
}

main().catch((err) => {
    process.stderr.write(`loadtest server failed: ${err.stack}\n`);
    process.exit(1);
});
