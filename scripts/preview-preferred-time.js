#!/usr/bin/env node
/**
 * Read-only preview of the B11 preferred-time migration: how many legacy
 * entries would be converted, how many dropped, and the most common values
 * that can't be read. Changes nothing (docs/RELEASE.md step 4).
 *
 *   npm run db:preview-preferred-time      # uses config `db` / env napi_db
 *
 * Exits 0 when nothing would be dropped, 1 when some entries would be.
 */
const config = require("config");
const mongoose = require("mongoose");
const { scanLegacy, report } = require("./lib/preferredTime");

async function main() {
    await mongoose.connect(config.get("db"), { serverSelectionTimeoutMS: 10_000 });
    try {
        const stats = await scanLegacy(mongoose.connection.db);
        process.stdout.write(`${report(stats, { preview: true })}\n`);
        return stats.dropped === 0 ? 0 : 1;
    } finally {
        await mongoose.disconnect();
    }
}

main().then(
    (code) => process.exit(code),
    (err) => {
        process.stderr.write(`preview-preferred-time failed: ${err.message}\n`);
        process.exit(2);
    }
);
