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
        ["users", User, usersIndexes],
        ["deletionrequests", DeletionRequest, deletionIndexes],
    ])("%s", async (coll, Model, migration) => {
        await migration.up(db);
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

        const status = await run(process.execPath, [cli, "status"], { cwd: ROOT, env });
        expect(status.stdout).not.toMatch(/PENDING/);
    });
});
