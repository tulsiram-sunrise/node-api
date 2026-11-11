#!/usr/bin/env node
/**
 * Report users that share a Facebook or Google ID (RELEASE.md step 3).
 * Exits 1 when duplicates exist, so it can gate a release job.
 *
 *   npm run db:find-duplicates            # uses config `db` / env napi_db
 */
const config = require("config");
const mongoose = require("mongoose");
const { findDuplicateProviderIds } = require("./lib/duplicates");

async function main() {
    await mongoose.connect(config.get("db"), { serverSelectionTimeoutMS: 10_000 });
    try {
        const dupes = await findDuplicateProviderIds(mongoose.connection.db);
        for (const field of ["facebook.id", "google.id"]) {
            const rows = dupes.filter((d) => d.field === field);
            process.stdout.write(`${field}: ${rows.length} duplicated value(s)\n`);
            for (const d of rows) {
                process.stdout.write(`  ${d.value} -> ${d.count} users: ${d.ids.join(", ")}\n`);
            }
        }
        return dupes.length === 0 ? 0 : 1;
    } finally {
        await mongoose.disconnect();
    }
}

main().then(
    (code) => process.exit(code),
    (err) => {
        process.stderr.write(`find-duplicate-users failed: ${err.message}\n`);
        process.exit(2);
    }
);
