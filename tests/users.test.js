const request = require("supertest");
const jwt = require("jsonwebtoken");
const config = require("config");
const { User } = require("../api/v1/models/user");
const tokens = require("../lib/tokens");
const { toPoint } = require("../lib/geo");
const createApp = require("../app");
const testDb = require("./helpers/db");

const app = createApp();

beforeAll(testDb.start);
afterEach(testDb.clear);
afterAll(testDb.stop);

let n = 0;
async function makeUser(fields = {}) {
    n += 1;
    const user = await User.create({ provider: "google", google: { id: `g-${n}` }, name: `U${n}`, ...fields });
    return { user, token: tokens.sign(user) };
}

// Central London and nearby points
const LONDON = { lat: 51.5074, lng: -0.1278 };
const TWO_MILES_AWAY = { lat: 51.5363, lng: -0.1278 };
const OXFORD = { lat: 51.752, lng: -1.2577 }; // ~50 miles

describe("auth middleware", () => {
    it("requires a token", async () => {
        const res = await request(app).get("/api/v1/users/me");
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("accepts Bearer and legacy x-auth-token headers", async () => {
        const { token } = await makeUser();
        const a = await request(app).get("/api/v1/users/me").set("authorization", `Bearer ${token}`);
        const b = await request(app).get("/api/v1/users/me").set("x-auth-token", token);
        expect(a.status).toBe(200);
        expect(b.status).toBe(200);
    });

    it("rejects tokens signed with a different algorithm or secret", async () => {
        const { user } = await makeUser();
        const none = jwt.sign({ sub: String(user._id) }, null, { algorithm: "none" });
        const wrong = jwt.sign({ sub: String(user._id) }, "x".repeat(40));
        for (const t of [none, wrong]) {
            const res = await request(app).get("/api/v1/users/me").set("authorization", `Bearer ${t}`);
            expect(res.status).toBe(401);
        }
    });

    it("rejects tokens with the wrong audience", async () => {
        const { user } = await makeUser();
        const t = jwt.sign({}, config.get("jwt.secret"), {
            subject: String(user._id),
            issuer: config.get("jwt.issuer"),
            audience: "someone-else",
        });
        const res = await request(app).get("/api/v1/users/me").set("authorization", `Bearer ${t}`);
        expect(res.status).toBe(401);
    });
});

describe("profile endpoints", () => {
    it("GET /me returns the profile without internal fields", async () => {
        const { token } = await makeUser({ location: toPoint(LONDON) });
        const res = await request(app).get("/api/v1/users/me").set("authorization", `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.location).toEqual(LONDON);
        expect(res.body.google).toBeUndefined();
        expect(res.body.__v).toBeUndefined();
    });

    it("PATCH /me/level validates and updates", async () => {
        const { token } = await makeUser();
        const bad = await request(app)
            .patch("/api/v1/users/me/level")
            .set("authorization", `Bearer ${token}`)
            .send({ level: "Wizard" });
        expect(bad.status).toBe(400);

        const ok = await request(app)
            .patch("/api/v1/users/me/level")
            .set("authorization", `Bearer ${token}`)
            .send({ level: "Advanced" });
        expect(ok.status).toBe(200);
        expect(ok.body.level).toBe("Advanced");
    });

    it("PUT /me/location validates coordinates", async () => {
        const { token } = await makeUser();
        const bad = await request(app)
            .put("/api/v1/users/me/location")
            .set("authorization", `Bearer ${token}`)
            .send({ location: { lat: 200, lng: 0 } });
        expect(bad.status).toBe(400);

        const ok = await request(app)
            .put("/api/v1/users/me/location")
            .set("authorization", `Bearer ${token}`)
            .send({ location: LONDON });
        expect(ok.status).toBe(200);
        expect(ok.body.location).toEqual(LONDON);
    });

    it("PUT /me/setting stores settings and strips unknown keys", async () => {
        const { token } = await makeUser();
        const res = await request(app)
            .put("/api/v1/users/me/setting")
            .set("authorization", `Bearer ${token}`)
            .send({
                distance: 5,
                preferredTime: [{ day: "Monday", timing: "18:00-20:00" }],
                isAdmin: true,
            });
        expect(res.status).toBe(200);
        expect(res.body.setting).toEqual({
            distance: 5,
            preferredTime: [{ day: "Monday", timing: "18:00-20:00" }],
        });
        expect(res.body.isAdmin).toBeUndefined();
    });

    it("DELETE /me removes the account; the token then stops working", async () => {
        const { token } = await makeUser();
        const del = await request(app).delete("/api/v1/users/me").set("authorization", `Bearer ${token}`);
        expect(del.status).toBe(204);
        const after = await request(app).get("/api/v1/users/me").set("authorization", `Bearer ${token}`);
        expect(after.status).toBe(404);
    });
});

describe("PATCH /users/me/discoverable", () => {
    const patch = (token, body) =>
        request(app).patch("/api/v1/users/me/discoverable").set("authorization", `Bearer ${token}`).send(body);

    it("is off by default for new users", async () => {
        const { token } = await makeUser();
        const res = await request(app).get("/api/v1/users/me").set("authorization", `Bearer ${token}`);
        expect(res.body.discoverable).toBe(false);
        expect(res.body.discoverableSince).toBeUndefined();
    });

    it("opting in records when consent was given; opting out clears it", async () => {
        const { token } = await makeUser();
        const before = Date.now();

        const on = await patch(token, { discoverable: true });
        expect(on.status).toBe(200);
        expect(on.body.discoverable).toBe(true);
        expect(Date.parse(on.body.discoverableSince)).toBeGreaterThanOrEqual(before - 1000);

        const off = await patch(token, { discoverable: false });
        expect(off.body.discoverable).toBe(false);
        expect(off.body.discoverableSince).toBeUndefined();
    });

    it.each([[{}], [{ discoverable: "yes" }], [{ discoverable: 1 }]])("rejects %j", async (body) => {
        const { token } = await makeUser();
        const res = await patch(token, body);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("requires authentication", async () => {
        const res = await request(app).patch("/api/v1/users/me/discoverable").send({ discoverable: true });
        expect(res.status).toBe(401);
    });
});

describe("GET /users/nearby", () => {
    it("requires the caller to have a location", async () => {
        const { token } = await makeUser();
        const res = await request(app).get("/api/v1/users/nearby").set("authorization", `Bearer ${token}`);
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("LOCATION_REQUIRED");
    });

    it("returns nearby users sorted by distance, excluding self and far users", async () => {
        const { token } = await makeUser({ location: toPoint(LONDON) });
        const visible = { discoverable: true };
        await makeUser({ name: "Near", location: toPoint(TWO_MILES_AWAY), level: "Advanced", ...visible });
        await makeUser({ name: "Same", location: toPoint(LONDON), ...visible });
        await makeUser({ name: "Far", location: toPoint(OXFORD), ...visible });
        await makeUser({ name: "Nowhere", ...visible });

        const res = await request(app)
            .get("/api/v1/users/nearby?distance=10")
            .set("authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.users.map((u) => u.name)).toEqual(["Same", "Near"]);
        expect(res.body.users[1].distanceMiles).toBe(2);
        // No precise location or private fields exposed.
        expect(res.body.users[0]).not.toHaveProperty("location");
        expect(res.body.users[0]).not.toHaveProperty("email");
    });

    it("filters by level and falls back to the user's distance setting", async () => {
        const { token } = await makeUser({ location: toPoint(LONDON), setting: { distance: 100 } });
        await makeUser({ name: "Far", location: toPoint(OXFORD), level: "Advanced", discoverable: true });
        await makeUser({ name: "Near", location: toPoint(TWO_MILES_AWAY), discoverable: true });

        const res = await request(app)
            .get("/api/v1/users/nearby?level=Advanced")
            .set("authorization", `Bearer ${token}`);
        expect(res.body.radiusMiles).toBe(100);
        expect(res.body.users.map((u) => u.name)).toEqual(["Far"]);
    });

    it("only returns users who opted in to being discoverable", async () => {
        const { token } = await makeUser({ location: toPoint(LONDON) });
        await makeUser({ name: "OptedIn", location: toPoint(TWO_MILES_AWAY), discoverable: true });
        await makeUser({ name: "Default", location: toPoint(TWO_MILES_AWAY) });
        await makeUser({ name: "OptedOut", location: toPoint(TWO_MILES_AWAY), discoverable: false });

        const res = await request(app).get("/api/v1/users/nearby").set("authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.users.map((u) => u.name)).toEqual(["OptedIn"]);
    });

    it("validates query parameters", async () => {
        const { token } = await makeUser({ location: toPoint(LONDON) });
        const res = await request(app)
            .get("/api/v1/users/nearby?distance=5000")
            .set("authorization", `Bearer ${token}`);
        expect(res.status).toBe(400);
    });
});

describe("GET /users/nearby pagination (B7)", () => {
    const nearby = (token, query) =>
        request(app).get("/api/v1/users/nearby").query(query).set("authorization", `Bearer ${token}`);

    // Points spaced north of London at ~0.07 miles each, plus duplicates at the
    // same spot to exercise the _id tie-break.
    async function seed() {
        const caller = await makeUser({ location: toPoint(LONDON) });
        const names = [];
        for (let i = 1; i <= 5; i += 1) {
            const at = { lat: LONDON.lat + i * 0.001, lng: LONDON.lng };
            for (const suffix of ["a", "b"]) {
                const name = `P${i}${suffix}`;
                await makeUser({ name, location: toPoint(at), discoverable: true });
                names.push(name);
            }
        }
        return { token: caller.token, names };
    }

    async function collectPages(token, query) {
        const seen = [];
        let cursor;
        let pages = 0;
        do {
            const res = await nearby(token, { ...query, ...(cursor && { cursor }) });
            expect(res.status).toBe(200);
            expect(res.body.count).toBe(res.body.users.length);
            seen.push(...res.body.users.map((u) => u.name));
            cursor = res.body.nextCursor;
            pages += 1;
        } while (cursor && pages < 20);
        return { seen, pages };
    }

    it("returns nextCursor: null when everything fits on one page", async () => {
        const { token } = await seed();
        const res = await nearby(token, { limit: 50 });
        expect(res.body.count).toBe(10);
        expect(res.body.nextCursor).toBeNull();
    });

    it.each([1, 3, 4])(
        "walks every user exactly once, closest first, with limit=%i (ties included)",
        async (limit) => {
            const { token } = await seed();
            const all = (await nearby(token, { limit: 50 })).body.users.map((u) => u.name);

            const { seen, pages } = await collectPages(token, { limit });

            expect(seen).toEqual(all);
            expect(new Set(seen).size).toBe(10);
            expect(pages).toBe(Math.ceil(10 / limit));
        }
    );

    it("pages through a tie group larger than a page, in _id order", async () => {
        const { token } = await makeUser({ location: toPoint(LONDON) });
        const spot = toPoint(TWO_MILES_AWAY);
        const ids = [];
        for (let i = 0; i < 5; i += 1) {
            ids.push(String((await makeUser({ name: `T${i}`, location: spot, discoverable: true })).user._id));
        }
        await makeUser({ name: "Closer", location: toPoint(LONDON), discoverable: true });
        const aggregate = jest.spyOn(User, "aggregate");

        try {
            const first = await nearby(token, { limit: 2 });
            // "Closer" plus the first tied user; the tie straddles the edge, so a second query ran.
            expect(aggregate).toHaveBeenCalledTimes(2);

            const { seen } = await collectPages(token, { limit: 2 });
            const tiedIds = ids.slice().sort();
            const byId = Object.fromEntries((await User.find({}, "name")).map((u) => [String(u._id), u.name]));

            expect(first.body.users.map((u) => u.name)).toEqual(["Closer", byId[tiedIds[0]]]);
            expect(seen).toEqual(["Closer", ...tiedIds.map((id) => byId[id])]);
        } finally {
            aggregate.mockRestore();
        }
    });

    it("uses a single query when no tie straddles the page edge", async () => {
        const { token } = await seed();
        const aggregate = jest.spyOn(User, "aggregate");
        try {
            // limit=4 ends on P2b; the next row is P3a at a different distance.
            await nearby(token, { limit: 4 }).expect(200);
            expect(aggregate).toHaveBeenCalledTimes(1);
        } finally {
            aggregate.mockRestore();
        }
    });

    it("keeps the level filter across pages", async () => {
        const { token } = await makeUser({ location: toPoint(LONDON) });
        for (let i = 1; i <= 4; i += 1) {
            const at = toPoint({ lat: LONDON.lat + i * 0.001, lng: LONDON.lng });
            await makeUser({ name: `A${i}`, location: at, level: "Advanced", discoverable: true });
            await makeUser({ name: `B${i}`, location: at, level: "Beginner", discoverable: true });
        }

        const { seen } = await collectPages(token, { level: "Advanced", limit: 3 });

        expect(seen).toEqual(["A1", "A2", "A3", "A4"]);
    });

    it.each([
        ["a different level", { level: "Advanced" }],
        ["a different radius", { distance: 50 }],
    ])("rejects a cursor reused with %s", async (_label, change) => {
        const { token } = await seed();
        const first = await nearby(token, { limit: 2 });

        const res = await nearby(token, { limit: 2, ...change, cursor: first.body.nextCursor });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("INVALID_CURSOR");
    });

    it("rejects a cursor from another user", async () => {
        const { token } = await seed();
        const other = await makeUser({ location: toPoint(LONDON) });
        const first = await nearby(token, { limit: 2 });

        const res = await nearby(other.token, { limit: 2, cursor: first.body.nextCursor });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("INVALID_CURSOR");
    });

    it("rejects a cursor after the caller moves", async () => {
        const { token } = await seed();
        const first = await nearby(token, { limit: 2 });
        await request(app)
            .put("/api/v1/users/me/location")
            .set("authorization", `Bearer ${token}`)
            .send({ location: TWO_MILES_AWAY })
            .expect(200);

        const res = await nearby(token, { limit: 2, cursor: first.body.nextCursor });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("INVALID_CURSOR");
    });

    it.each([
        ["garbage", "abc"],
        ["bad characters", "a+b/c="],
        ["too long", "a".repeat(513)],
    ])("rejects a %s cursor", async (_label, cursor) => {
        const { token } = await makeUser({ location: toPoint(LONDON) });
        const res = await nearby(token, { cursor });
        expect(res.status).toBe(400);
        expect(["INVALID_CURSOR", "VALIDATION_ERROR"]).toContain(res.body.error.code);
    });
});
