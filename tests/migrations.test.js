const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { User } = require("../api/v1/models/user");
const { DeletionRequest } = require("../api/v1/models/deletionRequest");
const { findDuplicateProviderIds } = require("../scripts/lib/duplicates");
const usersIndexes = require("../migrations/20261111000000-users-indexes");
const deletionIndexes = require("../migrations/20261111000100-deletionrequests-indexes");
const nearbyIndex = require("../migrations/20261113000000-users-nearby-index");
const countryCode = require("../migrations/20261113000100-users-country-code");
const preferredTime = require("../migrations/20261113000200-users-preferred-time");

const run = promisify(execFile);
const ROOT = path.join(__dirname, "..");

let server;
let client;
let db;
let dbCounter = 0;

beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = await new mongoose.mongo.MongoClient(server.getUri()).connect();
});
beforeEach(() => {
    // A fresh, index-free database per test: no Mongoose autoIndex involved.
    dbCounter += 1;
    db = client.db(`migrations_${dbCounter}`);
});
afterAll(async () => {
    await client?.close();
    await server?.stop();
});

const indexNames = async (coll) =>
    (await db.collection(coll).indexes()).map((i) => i.name).sort();

describe("findDuplicateProviderIds", () => {
    it("groups users sharing a provider ID and ignores empty values", async () => {
        await db.collection("users").insertMany([
            { facebook: { id: "fb-1" } },
            { facebook: { id: "fb-1" } },
            { facebook: { id: "fb-2" } },
            { google: { id: "g-1" } },
            { google: { id: "g-1" } },
            { google: { id: "g-1" } },
            { facebook: { id: null } },
            { facebook: { id: null } },
            { google: { id: "" } },
            { google: { id: "" } },
        ]);

        const dupes = await findDuplicateProviderIds(db);

        expect(dupes.map(({ field, value, count }) => ({ field, value, count }))).toEqual([
            { field: "facebook.id", value: "fb-1", count: 2 },
            { field: "google.id", value: "g-1", count: 3 },
        ]);
    });
});

describe("migration: users indexes", () => {
    it("creates the unique provider and geo indexes, and down removes them", async () => {
        await db.collection("users").insertOne({ facebook: { id: "fb-1" } });

        await usersIndexes.up(db);
        expect(await indexNames("users")).toEqual(
            ["_id_", "facebook.id_1", "google.id_1", "location_2dsphere"].sort()
        );
        await expect(db.collection("users").insertOne({ facebook: { id: "fb-1" } })).rejects.toThrow(/E11000/);

        await usersIndexes.down(db);
        expect(await indexNames("users")).toEqual(["_id_"]);
    });

    it("refuses to run while duplicate provider IDs exist, naming them", async () => {
        await db.collection("users").insertMany([{ google: { id: "g-dup" } }, { google: { id: "g-dup" } }]);

        await expect(usersIndexes.up(db)).rejects.toThrow(/Duplicate provider IDs.*google\.id=g-dup \(2 users\)/);
        expect(await indexNames("users")).toEqual(["_id_"]);
    });

    it("is safe to run twice", async () => {
        await usersIndexes.up(db);
        await expect(usersIndexes.up(db)).resolves.toBeUndefined();
    });
});

describe("migration: users nearby index (B14)", () => {
    const COMPOUND = "location_2dsphere_discoverable_1_level_1";

    it("replaces the plain geo index with the compound one, and down restores it", async () => {
        await usersIndexes.up(db);
        await nearbyIndex.up(db);
        expect(await indexNames("users")).toEqual(["_id_", "facebook.id_1", "google.id_1", COMPOUND].sort());

        await nearbyIndex.down(db);
        expect(await indexNames("users")).toEqual(
            ["_id_", "facebook.id_1", "google.id_1", "location_2dsphere"].sort()
        );
    });

    it("is safe to run twice, and down is safe on a fresh database", async () => {
        await nearbyIndex.up(db);
        await expect(nearbyIndex.up(db)).resolves.toBeUndefined();
        await db.collection("users").drop();
        await expect(nearbyIndex.down(db)).resolves.toBeUndefined();
    });
});

describe("migration: users country code (B12)", () => {
    it("removes the legacy currentCountryCode and leaves everything else", async () => {
        const users = db.collection("users");
        const legacyId = new mongoose.Types.ObjectId();
        await users.insertMany([
            { name: "Legacy", currentCountryCode: legacyId, level: "Advanced" },
            { name: "Modern", countryCode: "GB" },
        ]);

        await countryCode.up(db);

        const rows = await users.find({}, { projection: { _id: 0 } }).sort({ name: 1 }).toArray();
        expect(rows).toEqual([
            { name: "Legacy", level: "Advanced" },
            { name: "Modern", countryCode: "GB" },
        ]);
        await expect(countryCode.up(db)).resolves.toBeUndefined();
        await expect(countryCode.down(db)).resolves.toBeUndefined();
    });

    it("refuses to discard IDs while a referencecodes collection could map them", async () => {
        await db.collection("users").insertOne({ name: "Legacy", currentCountryCode: new mongoose.Types.ObjectId() });
        await db.collection("referencecodes").insertOne({ code: "GB" });

        await expect(countryCode.up(db)).rejects.toThrow(/referencecodes exists, so 1 user currentCountryCode value/);
        expect(await db.collection("users").countDocuments({ currentCountryCode: { $exists: true } })).toBe(1);
    });
});

describe("migration: users preferred time (B11)", () => {
    const legacy = [
        { name: "A", setting: { distance: 5, preferredTime: [
            { day: "Monday", timing: "6-8pm" },
            { day: "Tuesday", timing: "after work" },
            { day: "Friday", timing: "Evening" },
        ] } },
        { name: "B", setting: { distance: 9, preferredTime: [{ day: "Sunday", timing: "6-8" }] } },
        { name: "C", setting: { distance: 3, preferredTime: [{ day: "Monday", start: "07:00", end: "08:00" }], timeZone: "UTC" } },
        { name: "D" },
    ];
    const byName = async () =>
        (await db.collection("users").find({}, { projection: { _id: 0 } }).sort({ name: 1 }).toArray());
    let out;
    beforeEach(() => {
        out = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    });
    afterEach(() => out.mockRestore());

    it("converts readable entries, drops unreadable ones, reports both, and leaves new-shape users alone", async () => {
        await db.collection("users").insertMany(structuredClone(legacy));

        await preferredTime.up(db);

        expect(await byName()).toEqual([
            { name: "A", setting: { distance: 5, preferredTime: [
                { day: "Monday", start: "18:00", end: "20:00" },
                { day: "Friday", start: "17:00", end: "21:00" },
            ] } },
            { name: "B", setting: { distance: 9, preferredTime: [] } },
            legacy[2],
            legacy[3],
        ]);
        const printed = out.mock.calls.map(([s]) => s).join("");
        expect(printed).toMatch(/2 user\(s\) with legacy entries; 2 entr\(ies\) converted, 2 unreadable entr\(ies\) dropped/);
        expect(printed).toMatch(/"after work" x1/);
        expect(printed).toMatch(/"6-8" x1/);

        // Idempotent: nothing legacy remains.
        await preferredTime.up(db);
        expect(out.mock.calls.at(-1)[0]).toMatch(/0 user\(s\) with legacy entries/);
    });

    it("down turns ranges back into timing strings and removes timeZone", async () => {
        await db.collection("users").insertMany(structuredClone(legacy));
        await preferredTime.up(db);
        await preferredTime.down(db);

        const rows = await byName();
        expect(rows[0].setting.preferredTime).toEqual([
            { day: "Monday", timing: "18:00-20:00" },
            { day: "Friday", timing: "17:00-21:00" },
        ]);
        expect(rows[2].setting).toEqual({ distance: 3, preferredTime: [{ day: "Monday", timing: "07:00-08:00" }] });
    });

    it("preview script reports the same outcome without changing anything", async () => {
        out.mockRestore();
        const dbName = db.databaseName;
        await db.collection("users").insertMany(structuredClone(legacy));
        const env = { ...process.env, napi_db: `${server.getUri()}${dbName}` };
        const script = path.join(ROOT, "scripts", "preview-preferred-time.js");

        const err = await run(process.execPath, [script], { cwd: ROOT, env }).catch((e) => e);

        expect(err.code).toBe(1); // something would be dropped
        expect(err.stdout).toMatch(/2 entr\(ies\) would be converted, 2 unreadable entr\(ies\) would be dropped/);
        expect(await db.collection("users").countDocuments({ "setting.preferredTime.timing": { $exists: true } })).toBe(2);
        out = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    });
});

describe("migration: deletionrequests indexes", () => {
    it("creates the unique code and TTL indexes; down tolerates a missing collection", async () => {
        await deletionIndexes.up(db);
        const indexes = await db.collection("deletionrequests").indexes();
        expect(indexes.find((i) => i.name === "code_1")).toMatchObject({ unique: true });
        expect(indexes.find((i) => i.name === "createdAt_1")).toMatchObject({ expireAfterSeconds: 31_536_000 });

        await deletionIndexes.down(db);
        await db.collection("deletionrequests").drop();
        await expect(deletionIndexes.down(db)).resolves.toBeUndefined();
    });
});

describe("migrations match the Mongoose models", () => {
    // Guards against drift: if a model index changes without a migration (or
    // vice versa), production (autoIndex=false) would silently diverge.
    it.each([
        ["users", User, [usersIndexes, nearbyIndex]],
        ["deletionrequests", DeletionRequest, [deletionIndexes]],
    ])("%s", async (coll, Model, migrations) => {
        for (const migration of migrations) await migration.up(db);
        const created = (await db.collection(coll).indexes()).filter((i) => i.name !== "_id_");
        const relevant = ["unique", "sparse", "expireAfterSeconds"];

        const fromModel = Model.schema.indexes().map(([key, options]) => ({
            key,
            ...Object.fromEntries(relevant.filter((k) => options[k] !== undefined).map((k) => [k, options[k]])),
        }));
        const fromMigration = created.map((i) => ({
            key: i.key,
            ...Object.fromEntries(relevant.filter((k) => i[k] !== undefined).map((k) => [k, i[k]])),
        }));

        const sortByKey = (a, b) => JSON.stringify(a.key).localeCompare(JSON.stringify(b.key));
        expect(fromMigration.sort(sortByKey)).toEqual(fromModel.sort(sortByKey));
    });
});

describe("migrate-mongo CLI", () => {
    it("applies all migrations against the configured database", async () => {
        const cli = path.join(ROOT, "node_modules", "migrate-mongo", "bin", "migrate-mongo.js");
        const env = { ...process.env, napi_db: `${server.getUri()}cli_test` };

        const up = await run(process.execPath, [cli, "up"], { cwd: ROOT, env });
        expect(up.stdout).toMatch(/MIGRATED UP: 20261111000000-users-indexes\.js/);
        expect(up.stdout).toMatch(/MIGRATED UP: 20261111000100-deletionrequests-indexes\.js/);
        expect(up.stdout).toMatch(/MIGRATED UP: 20261113000000-users-nearby-index\.js/);
        expect(up.stdout).toMatch(/MIGRATED UP: 20261113000100-users-country-code\.js/);
        expect(up.stdout).toMatch(/MIGRATED UP: 20261113000200-users-preferred-time\.js/);

        const status = await run(process.execPath, [cli, "status"], { cwd: ROOT, env });
        expect(status.stdout).not.toMatch(/PENDING/);
    });
});
