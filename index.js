const config = require("config");
const logger = require("./lib/logger");
const validateConfig = require("./startup/config");
const db = require("./startup/db");
const createApp = require("./app");

const SHUTDOWN_TIMEOUT_MS = 10_000;

function fatal(label) {
    return (err) => {
        logger.error(`${label}: ${err?.message ?? err}`, { err });
        process.exit(1);
    };
}

process.on("uncaughtException", fatal("Uncaught exception"));
process.on("unhandledRejection", fatal("Unhandled rejection"));

async function main() {
    validateConfig();
    await db.connect(config.get("db"));

    const app = createApp();
    const port = config.get("port");
    const server = app.listen(port, () => logger.info(`Server listening on port ${port}`));

    let shuttingDown = false;
    const shutdown = (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info(`${signal} received, shutting down`);
        setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
        server.close(async () => {
            await db.disconnect();
            process.exit(0);
        });
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch(fatal("Startup failed"));
