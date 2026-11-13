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

    const putSetting = (token, body) =>
        request(app).put("/api/v1/users/me/setting").set("authorization", `Bearer ${token}`).send(body);

    it("PUT /me/setting stores ranges and a canonical time zone, and strips unknown keys (B11)", async () => {
        const { user, token } = await makeUser();
        const res = await putSetting(token, {
            distance: 5,
            preferredTime: [{ day: "Monday", start: "18:00", end: "20:00" }],
            timeZone: "US/Eastern",
            isAdmin: true,
        });
        expect(res.status).toBe(200);
        expect(res.body.setting).toEqual({
            distance: 5,
            // timing is the deprecated echo for older app versions.
            preferredTime: [{ day: "Monday", start: "18:00", end: "20:00", timing: "18:00-20:00" }],
            timeZone: "America/New_York",
        });
        expect(res.body.isAdmin).toBeUndefined();
        const stored = await User.findById(user._id).lean();
        expect(stored.setting.preferredTime).toEqual([{ day: "Monday", start: "18:00", end: "20:00" }]);
    });

    it("PUT /me/setting converts legacy free-text timing from older app versions (B11)", async () => {
        const { token } = await makeUser();
        const res = await putSetting(token, {
            distance: 10,
            preferredTime: [
                { day: "Monday", timing: "6-8pm" },
                { day: "Tuesday", timing: "Evening" },
                { day: "Sunday", timing: "9pm - 12am" },
            ],
        });
        expect(res.status).toBe(200);
        expect(res.body.setting.preferredTime.map(({ day, start, end }) => [day, start, end])).toEqual([
            ["Monday", "18:00", "20:00"],
            ["Tuesday", "17:00", "21:00"],
            ["Sunday", "21:00", "24:00"],
        ]);
    });

    it("PUT /me/setting keeps the stored time zone when an older app omits it", async () => {
        const { token } = await makeUser();
        await putSetting(token, { distance: 5, preferredTime: [], timeZone: "Europe/London" }).expect(200);
        const res = await putSetting(token, { distance: 7, preferredTime: [{ day: "Friday", timing: "18:00-19:00" }] });
        expect(res.status).toBe(200);
        expect(res.body.setting).toMatchObject({ distance: 7, timeZone: "Europe/London" });
    });

    it.each([
        ["ambiguous legacy timing", { day: "Monday", timing: "6-8" }, /could not be read/],
        ["end before start", { day: "Monday", start: "20:00", end: "18:00" }, /must be after/],
        ["equal start and end", { day: "Monday", start: "18:00", end: "18:00" }, /must be after/],
        ["a 24:00 start", { day: "Monday", start: "24:00", end: "24:00" }, /start/],
        ["a missing end", { day: "Monday", start: "18:00" }, /end/],
        ["both timing and a range", { day: "Monday", timing: "6-8pm", start: "18:00", end: "20:00" }, /./],
        ["neither timing nor a range", { day: "Monday" }, /./],
        ["a bad time format", { day: "Monday", start: "6pm", end: "8pm" }, /start/],
    ])("PUT /me/setting rejects %s", async (_label, item, message) => {
        const { token } = await makeUser();
        const res = await putSetting(token, { distance: 5, preferredTime: [item] });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
        expect(JSON.stringify(res.body.error)).toMatch(message);
    });

    it("PUT /me/setting rejects an unknown time zone", async () => {
        const { token } = await makeUser();
        const res = await putSetting(token, { distance: 5, preferredTime: [], timeZone: "Mars/Olympus" });
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body.error)).toMatch(/IANA time zone/);
    });

    it("DELETE /me removes the account; the token then stops working", async () => {
        const { token } = await makeUser();
        const del = await request(app).delete("/api/v1/users/me").set("authorization", `Bearer ${token}`);
        expect(del.status).toBe(204);
        const after = await request(app).get("/api/v1/users/me").set("authorization", `Bearer ${token}`);
        expect(after.status).toBe(404);
    });
});

describe("PATCH /users/me (B5)", () => {
    const patchMe = (token, body) =>
        request(app).patch("/api/v1/users/me").set("authorization", `Bearer ${token}`).send(body);

    it("updates the name (trimmed) and photo", async () => {
        const { token } = await makeUser({ name: "Old", profilePic: "https://cdn.example.com/old.jpg" });

        const res = await patchMe(token, { name: "  New Name  ", profilePic: "https://cdn.example.com/new.jpg" });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ name: "New Name", profilePic: "https://cdn.example.com/new.jpg" });
    });

    it("changes only the fields sent", async () => {
        const { token } = await makeUser({ name: "Keep", profilePic: "https://cdn.example.com/a.jpg" });
        const res = await patchMe(token, { name: "Renamed" });
        expect(res.body).toMatchObject({ name: "Renamed", profilePic: "https://cdn.example.com/a.jpg" });
    });

    it("removes the photo when profilePic is null", async () => {
        const { user, token } = await makeUser({ profilePic: "https://cdn.example.com/a.jpg" });

        const res = await patchMe(token, { profilePic: null });

        expect(res.status).toBe(200);
        expect(res.body).not.toHaveProperty("profilePic");
        expect((await User.findById(user._id).lean()).profilePic).toBeUndefined();
    });

    it.each([
        ["an empty body", {}],
        ["only unknown keys", { email: "x@example.com" }],
        ["an empty name", { name: "   " }],
        ["a name over 100 characters", { name: "a".repeat(101) }],
        ["an http photo URL", { profilePic: "http://cdn.example.com/a.jpg" }],
        ["a javascript: URL", { profilePic: "javascript:alert(1)" }],
        ["a data: URL", { profilePic: "data:image/png;base64,AAAA" }],
        ["a non-string name", { name: { $ne: null } }],
        ["an unassigned country code", { countryCode: "XX" }],
        ["a region that isn't a country", { countryCode: "EU" }],
        ["an alpha-3 country code", { countryCode: "GBR" }],
        ["a non-string country code", { countryCode: 44 }],
    ])("rejects %s", async (_label, body) => {
        const { token } = await makeUser();
        const res = await patchMe(token, body);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("sets the country as an upper-case ISO code, and null removes it (B12)", async () => {
        const { user, token } = await makeUser();

        const set = await patchMe(token, { countryCode: " gb " });
        expect(set.status).toBe(200);
        expect(set.body.countryCode).toBe("GB");
        const me = await request(app).get("/api/v1/users/me").set("authorization", `Bearer ${token}`);
        expect(me.body.countryCode).toBe("GB");

        const cleared = await patchMe(token, { countryCode: null });
        expect(cleared.status).toBe(200);
        expect(cleared.body).not.toHaveProperty("countryCode");
        expect((await User.findById(user._id).lean()).countryCode).toBeUndefined();
    });

    it("rejects an invalid country code in the database too (model enum)", async () => {
        const { user } = await makeUser();
        await expect(
            User.findByIdAndUpdate(user._id, { $set: { countryCode: "XX" } }, { runValidators: true })
        ).rejects.toThrow(/countryCode/);
    });

    it("enforces preferred-time ranges and canonical time zones in the model too (B11)", async () => {
        const setting = (preferredTime, timeZone) => new User({ provider: "google", setting: { distance: 5, preferredTime, timeZone } });

        expect(setting([{ day: "Monday", start: "18:00", end: "20:00" }], "Europe/London").validateSync()).toBeUndefined();
        expect(setting([{ day: "Monday", start: "20:00", end: "18:00" }]).validateSync().message).toMatch(/end must be after start/);
        expect(setting([{ day: "Monday", start: "6pm", end: "20:00" }]).validateSync().message).toMatch(/start/);
        expect(setting([{ day: "Monday", timing: "6-8pm" }]).validateSync().message).toMatch(/start/);
        expect(setting([], "US/Eastern").validateSync().message).toMatch(/time zone/);

        const { user } = await makeUser();
        await expect(
            User.findByIdAndUpdate(user._id, { $set: { "setting.timeZone": "Mars/Olympus" } }, { runValidators: true })
        ).rejects.toThrow(/time zone/);
    });

    it("can't change email or other fields", async () => {
        const { user, token } = await makeUser({ email: "me@example.com" });
        await patchMe(token, { name: "N", email: "evil@example.com", discoverable: true, level: "Advanced" }).expect(200);
        const stored = await User.findById(user._id).lean();
        expect(stored).toMatchObject({ email: "me@example.com", discoverable: false, level: "Beginner" });
    });

    it("requires authentication", async () => {
        await request(app).patch("/api/v1/users/me").send({ name: "X" }).expect(401);
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

    it("uses the compound geo index, and still works while a migration has two geo indexes (B14)", async () => {
        const { token } = await makeUser({ location: toPoint(LONDON) });
        await makeUser({ name: "Match", location: toPoint(TWO_MILES_AWAY), level: "Advanced", discoverable: true });
        await makeUser({ name: "Hidden", location: toPoint(TWO_MILES_AWAY), level: "Advanced" });
        await User.syncIndexes();
        const names = (await User.collection.indexes()).map((i) => i.name);
        expect(names).toContain("location_2dsphere_discoverable_1_level_1");

        // Mid-migration state: the old plain index exists alongside the new one.
        await User.collection.createIndex({ location: "2dsphere" });
        try {
            const res = await request(app)
                .get("/api/v1/users/nearby?level=Advanced")
                .set("authorization", `Bearer ${token}`);
            expect(res.status).toBe(200);
            expect(res.body.users.map((u) => u.name)).toEqual(["Match"]);
        } finally {
            await User.collection.dropIndex("location_2dsphere");
        }
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

describe("GET /users/nearby?matchTimes=true (B16)", () => {
    const slot = (day, start, end) => ({ day, start, end });
    const evenings = [slot("Monday", "18:00", "21:00"), slot("Wednesday", "18:00", "21:00")];
    const search = (token, query = "") =>
        request(app).get(`/api/v1/users/nearby?matchTimes=true${query}`).set("authorization", `Bearer ${token}`);
    const near = (name, preferredTime, timeZone = "Europe/London", extra = {}) =>
        makeUser({ name, location: toPoint(TWO_MILES_AWAY), discoverable: true, setting: { distance: 10, preferredTime, timeZone }, ...extra });
    const caller = (preferredTime = evenings, timeZone = "Europe/London") =>
        makeUser({ location: toPoint(LONDON), setting: { distance: 10, preferredTime, timeZone } });

    it("requires the caller's preferred times and time zone", async () => {
        const noTimes = await makeUser({ location: toPoint(LONDON), setting: { distance: 10, preferredTime: [], timeZone: "UTC" } });
        const noZone = await makeUser({ location: toPoint(LONDON), setting: { distance: 10, preferredTime: evenings } });
        for (const { token } of [noTimes, noZone]) {
            const res = await search(token);
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("AVAILABILITY_REQUIRED");
        }
    });

    it("returns only users with overlapping times, with the overlap in the caller's zone", async () => {
        const { token } = await caller();
        await near("Overlap", [slot("Monday", "20:00", "23:00")]);
        await near("Paris", [slot("Wednesday", "21:00", "23:00")], "Europe/Paris");
        await near("Mornings", [slot("Monday", "07:00", "09:00")]);
        await near("NoTimes", []);
        await near("NoZone", [slot("Wednesday", "17:00", "19:00")], undefined); // assumed to share the caller's zone

        const res = await search(token);
        expect(res.status).toBe(200);
        const byName = Object.fromEntries(res.body.users.map((u) => [u.name, u.overlapSlots]));
        expect(Object.keys(byName).sort()).toEqual(["NoZone", "Overlap", "Paris"]);
        expect(byName.Overlap).toEqual([slot("Monday", "20:00", "21:00")]);
        expect(byName.Paris).toEqual([slot("Wednesday", "20:00", "21:00")]); // Paris 21:00 = London 20:00 in either season
        expect(byName.NoZone).toEqual([slot("Wednesday", "18:00", "19:00")]);
        // Nothing private leaks with the extra projection.
        expect(res.body.users[0]).not.toHaveProperty("setting");
        expect(res.body.users[0]).not.toHaveProperty("location");
    });

    it("leaves plain nearby search unchanged (no overlapSlots, no time filter)", async () => {
        const { token } = await caller();
        await near("Mornings", [slot("Monday", "07:00", "09:00")]);
        const res = await request(app).get("/api/v1/users/nearby").set("authorization", `Bearer ${token}`);
        expect(res.body.users.map((u) => u.name)).toEqual(["Mornings"]);
        expect(res.body.users[0]).not.toHaveProperty("overlapSlots");
    });

    it("pages through matches beyond one scan batch without gaps or repeats", async () => {
        const { token } = await caller();
        const docs = Array.from({ length: 250 }, (_, i) => ({
            provider: "google",
            google: { id: `bulk-${i}` },
            name: `B${i}`,
            discoverable: true,
            // Spread outwards so distance order is meaningful; every third user matches.
            location: toPoint({ lat: LONDON.lat + 0.0005 * (i + 1), lng: LONDON.lng }),
            setting: { distance: 10, timeZone: "Europe/London", preferredTime: [i % 3 === 0 ? slot("Monday", "19:00", "20:00") : slot("Friday", "07:00", "08:00")] },
        }));
        await User.insertMany(docs);

        const seen = [];
        let cursor = "";
        do {
            const res = await search(token, `&limit=20${cursor ? `&cursor=${cursor}` : ""}`);
            expect(res.status).toBe(200);
            seen.push(...res.body.users.map((u) => u.name));
            cursor = res.body.nextCursor;
        } while (cursor);

        const expected = docs.filter((_, i) => i % 3 === 0).map((d) => d.name);
        expect(seen).toEqual(expected);
    });

    it("caps the scan per request: a page may be short while nextCursor continues", async () => {
        const { token } = await caller();
        const misses = Array.from({ length: 1050 }, (_, i) => ({
            provider: "google",
            google: { id: `miss-${i}` },
            name: `M${i}`,
            discoverable: true,
            location: toPoint({ lat: LONDON.lat + 0.00005 * (i + 1), lng: LONDON.lng }),
            setting: { distance: 10, timeZone: "Europe/London", preferredTime: [slot("Friday", "07:00", "08:00")] },
        }));
        await User.insertMany(misses);
        await makeUser({ name: "FarMatch", location: toPoint({ lat: LONDON.lat + 0.1, lng: LONDON.lng }), discoverable: true, setting: { distance: 10, timeZone: "Europe/London", preferredTime: evenings } });

        const first = await search(token);
        expect(first.status).toBe(200);
        expect(first.body.users).toEqual([]);
        expect(first.body.nextCursor).toEqual(expect.any(String));

        const second = await search(token, `&cursor=${first.body.nextCursor}`);
        expect(second.body.users.map((u) => u.name)).toEqual(["FarMatch"]);
        expect(second.body.nextCursor).toBeNull();
    });

    it("rejects a cursor after the caller changes their times, or reused without matchTimes", async () => {
        const { user, token } = await caller();
        for (let i = 0; i < 3; i += 1) await near(`U${i}`, evenings);
        const first = await search(token, "&limit=1");
        expect(first.body.nextCursor).toEqual(expect.any(String));

        const plain = await request(app)
            .get(`/api/v1/users/nearby?limit=1&cursor=${first.body.nextCursor}`)
            .set("authorization", `Bearer ${token}`);
        expect(plain.body.error.code).toBe("INVALID_CURSOR");

        await User.updateOne({ _id: user._id }, { $set: { "setting.preferredTime": [slot("Monday", "18:00", "20:00")] } });
        const changed = await search(token, `&limit=1&cursor=${first.body.nextCursor}`);
        expect(changed.body.error.code).toBe("INVALID_CURSOR");
    });

    it("rejects a non-boolean matchTimes", async () => {
        const { token } = await caller();
        const res = await request(app).get("/api/v1/users/nearby?matchTimes=maybe").set("authorization", `Bearer ${token}`);
        expect(res.status).toBe(400);
    });
});
