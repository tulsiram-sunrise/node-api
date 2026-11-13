// migrate-mongo configuration. Uses the same `db` setting as the app
// (config/*.json, overridden by env napi_db), so no separate secrets.
const config = require("config");

module.exports = {
    mongodb: {
        url: config.get("db"),
        // databaseName omitted: taken from the connection string.
        options: { serverSelectionTimeoutMS: 10_000 },
    },
    migrationsDir: "migrations",
    changelogCollectionName: "changelog",
    lockCollectionName: "changelog_lock",
    lockTtl: 300,
    migrationFileExtension: ".js",
    useFileHash: false,
    moduleSystem: "commonjs",
};
