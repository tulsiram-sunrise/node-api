#!/usr/bin/env node
/**
 * Create sample users round a point, for testing nearby search by hand (GAP B27).
 *
 *   npm run db:seed                                   # 200 users within 20 miles of central London
 *   npm run db:seed -- --lat 40.7128 --lng -74.006    # round another point
 *   npm run db:seed -- --count 500 --radius 50 --seed 7
 *   npm run db:seed -- --reset                        # delete earlier seed users first
 *   npm run db:seed -- --remove                       # only delete seed users
 *
 * Uses config `db` / env napi_db. Re-running updates the same users (keyed on a
 * "seed-" Google ID), so it never creates duplicates or touches real accounts.
 * It refuses to run when NODE_ENV=production, and against a non-local database
 * unless --allow-remote is given.
 */
const { parseArgs } = require("node:util");
const config = require("config");
const mongoose = require("mongoose");
const db = require("../startup/db");
const { User } = require("../api/v1/models/user");
const { SEED_PREFIX, generateSeedUsers } = require("./lib/seedUsers");

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const LIMITS = { count: [1, 5000], radius: [0.1, 100], lat: [-85, 85], lng: [-180, 180] };

function readOptions(argv) {
    const { values } = parseArgs({
        args: argv,
        options: {
            count: { type: "string", default: "200" },
            lat: { type: "string", default: "51.5074" },
            lng: { type: "string", default: "-0.1278" },
            radius: { type: "string", default: "20" },
            seed: { type: "string", default: "1" },
            reset: { type: "boolean", default: false },
            remove: { type: "boolean", default: false },
            "allow-remote": { type: "boolean", default: false },
        },
    });
    const num = (name) => {
        const n = Number(values[name]);
        const [min, max] = LIMITS[name] ?? [-Infinity, Infinity];
        if (!Number.isFinite(n) || n < min || n > max) {
            throw new Error(`--${name} must be a number from ${min} to ${max}`);
        }
        return n;
    };
    return {
        count: Math.trunc(num("count")),
        center: { lat: num("lat"), lng: num("lng") },
        radiusMiles: num("radius"),
        seed: Math.trunc(num("seed")),
        reset: values.reset,
        remove: values.remove,
        allowRemote: values["allow-remote"],
    };
}

/** Hosts in a mongodb:// or mongodb+srv:// URI, without credentials. */
function uriHosts(uri) {
    const match = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/.exec(uri);
    if (!match) throw new Error("db is not a mongodb:// URI");
    return match[1].split(",").map((h) => h.replace(/:\d+$/, ""));
}

function assertSafeTarget(uri, allowRemote) {
    if (process.env.NODE_ENV === "production") {
        throw new Error("refusing to seed with NODE_ENV=production");
    }
    const remote = uriHosts(uri).filter((h) => !LOCAL_HOSTS.has(h));
    if (remote.length && !allowRemote) {
        throw new Error(`refusing to seed non-local host(s) ${remote.join(", ")}; pass --allow-remote if you mean it`);
    }
}

// trusted(): startup/db turns on sanitizeFilter, which would neutralise this $regex.
// It is a constant, never user input.
const seedFilter = () => ({ "google.id": mongoose.trusted({ $regex: `^${SEED_PREFIX}` }) });

async function main(argv) {
    const options = readOptions(argv);
    const uri = config.get("db");
    assertSafeTarget(uri, options.allowRemote);

    const autoIndex = config.get("autoIndex");
    await db.connect(uri, { autoIndex });
    try {
        // Mongoose builds indexes in the background; wait, so nearby search works
        // as soon as the script exits. Without autoIndex, migrations own the indexes.
        if (autoIndex) await User.init();
        else process.stdout.write("autoIndex is off: run `npm run migrate:up` if nearby search reports a missing index\n");

        if (options.reset || options.remove) {
            const { deletedCount } = await User.deleteMany(seedFilter());
            process.stdout.write(`Removed ${deletedCount} seed user(s)\n`);
            if (options.remove) return 0;
        }

        const users = generateSeedUsers(options);
        const result = await User.bulkWrite(
            users.map((user) => ({
                updateOne: { filter: { "google.id": user.google.id }, update: { $set: user }, upsert: true },
            }))
        );
        const visible = users.filter((u) => u.discoverable).length;
        const { lat, lng } = options.center;
        process.stdout.write(
            `Seeded ${users.length} user(s) within ${options.radiusMiles} miles of ${lat},${lng} ` +
                `(${result.upsertedCount} new, ${result.modifiedCount} updated; ${visible} discoverable)\n`
        );
        return 0;
    } finally {
        await db.disconnect();
    }
}

if (require.main === module) {
    main(process.argv.slice(2)).then(
        (code) => process.exit(code),
        (err) => {
            process.stderr.write(`seed failed: ${err.message}\n`);
            process.exit(1);
        }
    );
}

module.exports = { readOptions, uriHosts, assertSafeTarget };
