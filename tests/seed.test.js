const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { generateSeedUsers, pointNear, prng, SEED_PREFIX } = require("../scripts/lib/seedUsers");
const { readOptions, uriHosts, assertSafeTarget } = require("../scripts/seed");
const { User } = require("../api/v1/models/user");
const { metersToMiles } = require("../lib/geo");

const run = promisify(execFile);
const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "seed.js");
const LONDON = { lat: 51.5074, lng: -0.1278 };

/** Great-circle distance in miles, independent of the generator's flat-earth maths. */
function haversineMiles(a, b) {
    const rad = (d) => (d * Math.PI) / 180;
    const h =
        Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
        Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
    return metersToMiles(2 * 6_371_008.8 * Math.asin(Math.sqrt(h)));
}

describe("generateSeedUsers (B27)", () => {
    const users = generateSeedUsers({ count: 300, center: LONDON, radiusMiles: 20, seed: 42 });

    it("creates valid users with seed IDs, fake names and no emails", () => {
        expect(users).toHaveLength(300);
        expect(new Set(users.map((u) => u.google.id)).size).toBe(300);
        for (const doc of users) {
            expect(doc.google.id.startsWith(SEED_PREFIX)).toBe(true);
            expect(doc.name).toMatch(/^Seed User \d+$/);
            expect(doc).not.toHaveProperty("email");
            expect(new User(doc).validateSync()).toBeUndefined();
        }
    });

    it("scatters users within the radius, using the whole area", () => {
        const miles = users.map((u) => {
            const [lng, lat] = u.location.coordinates;
            return haversineMiles(LONDON, { lat, lng });
        });
        expect(Math.max(...miles)).toBeLessThanOrEqual(20.2); // flat-earth error at 20 miles is well under 1%
        expect(miles.filter((m) => m < 10).length).toBeGreaterThan(30); // uniform over the disc: ~25% inside half the radius
        expect(miles.filter((m) => m > 15).length).toBeGreaterThan(100);
    });

    it("mixes levels, discoverability and preferred times", () => {
        const levels = new Set(users.map((u) => u.level));
        expect([...levels].sort()).toEqual(["Advanced", "Beginner", "Intermediate"]);
        const discoverable = users.filter((u) => u.discoverable).length;
        expect(discoverable).toBeGreaterThan(200);
        expect(discoverable).toBeLessThan(300);
        expect(users.some((u) => u.setting.preferredTime.length > 0)).toBe(true);
        expect(users.filter((u) => u.discoverable).every((u) => u.discoverableSince instanceof Date)).toBe(true);
    });

    it("gives the same users for the same seed and different ones for another", () => {
        const again = generateSeedUsers({ count: 5, center: LONDON, radiusMiles: 20, seed: 42 });
        const other = generateSeedUsers({ count: 5, center: LONDON, radiusMiles: 20, seed: 43 });
        const strip = (list) => list.map(({ discoverableSince, ...rest }) => rest); // eslint-disable-line no-unused-vars
        expect(strip(again)).toEqual(strip(users.slice(0, 5)));
        expect(strip(other)).not.toEqual(strip(again));
    });

    it("places points near the poles of its own range without NaN", () => {
        const p = pointNear({ lat: 85, lng: 179.9 }, 100, prng(1));
        expect(Number.isFinite(p.lat) && Number.isFinite(p.lng)).toBe(true);
    });
});

describe("seed script options and safety", () => {
    it("reads defaults and rejects out-of-range numbers", () => {
        expect(readOptions([])).toMatchObject({ count: 200, center: LONDON, radiusMiles: 20, seed: 1, reset: false });
        expect(() => readOptions(["--count", "0"])).toThrow(/--count/);
        expect(() => readOptions(["--count", "abc"])).toThrow(/--count/);
        expect(() => readOptions(["--radius", "101"])).toThrow(/--radius/);
        expect(() => readOptions(["--lat", "91"])).toThrow(/--lat/);
        expect(() => readOptions(["--bogus"])).toThrow();
        expect(readOptions([]).timeZone).toBe("Europe/London");
        expect(readOptions(["--tz", "US/Eastern"]).timeZone).toBe("America/New_York");
        expect(() => readOptions(["--tz", "Mars/Olympus"])).toThrow(/--tz/);
    });

    it("parses hosts from single, replica-set and SRV URIs without credentials", () => {
        expect(uriHosts("mongodb://127.0.0.1:27017/nodeapi")).toEqual(["127.0.0.1"]);
        expect(uriHosts("mongodb://user:pass@a.example.com:27017,b.example.com/db?replicaSet=rs")).toEqual([
            "a.example.com",
            "b.example.com",
        ]);
        expect(uriHosts("mongodb+srv://user:pass@cluster0.example.net/db")).toEqual(["cluster0.example.net"]);
    });

    it("refuses production and remote hosts unless allowed", () => {
        const env = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = "production";
            expect(() => assertSafeTarget("mongodb://127.0.0.1/db", true)).toThrow(/production/);
        } finally {
            process.env.NODE_ENV = env;
        }
        expect(() => assertSafeTarget("mongodb://db.example.com/db", false)).toThrow(/--allow-remote/);
        expect(() => assertSafeTarget("mongodb://db.example.com/db", true)).not.toThrow();
        expect(() => assertSafeTarget("mongodb://localhost:27017/db", false)).not.toThrow();
    });
});

describe("seed script CLI", () => {
    let server;
    let client;
    let users;
    let env;

    beforeAll(async () => {
        server = await MongoMemoryServer.create();
        client = await new mongoose.mongo.MongoClient(server.getUri()).connect();
        users = client.db("seed_test").collection("users");
        env = { ...process.env, napi_db: `${server.getUri()}seed_test` };
    });
    afterAll(async () => {
        await client?.close();
        await server?.stop();
    });

    const seed = (...args) => run(process.execPath, [SCRIPT, ...args], { cwd: ROOT, env });

    it("seeds users that nearby search can find, re-runs without duplicates, and removes only seed users", async () => {
        await users.insertOne({ provider: "google", google: { id: "real-123" }, name: "Real" });

        const first = await seed("--count", "40", "--radius", "5");
        expect(first.stdout).toMatch(/Seeded 40 user\(s\) within 5 miles .*\(40 new, 0 updated;/);
        expect(await users.countDocuments()).toBe(41);

        // Same seed again: the same users are updated, not duplicated.
        const again = await seed("--count", "40", "--radius", "5");
        expect(again.stdout).toMatch(/\(0 new,/);
        expect(await users.countDocuments()).toBe(41);

        // The data works with the real nearby pipeline and its compound geo index.
        const found = await users
            .aggregate([
                {
                    $geoNear: {
                        near: { type: "Point", coordinates: [LONDON.lng, LONDON.lat] },
                        distanceField: "distance",
                        maxDistance: 5 * 1609.344 * 1.01,
                        spherical: true,
                        key: "location",
                        query: { discoverable: true },
                    },
                },
            ])
            .toArray();
        expect(found.length).toBeGreaterThan(20);

        const reset = await seed("--reset", "--count", "10");
        expect(reset.stdout).toMatch(/Removed 40 seed user\(s\)/);
        expect(await users.countDocuments()).toBe(11);

        const removed = await seed("--remove");
        expect(removed.stdout).toMatch(/Removed 10 seed user\(s\)/);
        expect(await users.find({}, { projection: { _id: 0, name: 1 } }).toArray()).toEqual([{ name: "Real" }]);
    });

    it("exits 1 with a message on a non-local database", async () => {
        await expect(
            run(process.execPath, [SCRIPT], { cwd: ROOT, env: { ...env, napi_db: "mongodb://db.example.com:27017/x" } })
        ).rejects.toMatchObject({ code: 1, stderr: expect.stringMatching(/refusing to seed non-local host/) });
    });
});
