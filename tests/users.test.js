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

describe("GET /users/nearby", () => {
    it("requires the caller to have a location", async () => {
        const { token } = await makeUser();
        const res = await request(app).get("/api/v1/users/nearby").set("authorization", `Bearer ${token}`);
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("LOCATION_REQUIRED");
    });

    it("returns nearby users sorted by distance, excluding self and far users", async () => {
        const { token } = await makeUser({ location: toPoint(LONDON) });
        await makeUser({ name: "Near", location: toPoint(TWO_MILES_AWAY), level: "Advanced" });
        await makeUser({ name: "Same", location: toPoint(LONDON) });
        await makeUser({ name: "Far", location: toPoint(OXFORD) });
        await makeUser({ name: "Nowhere" });

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
        await makeUser({ name: "Far", location: toPoint(OXFORD), level: "Advanced" });
        await makeUser({ name: "Near", location: toPoint(TWO_MILES_AWAY) });

        const res = await request(app)
            .get("/api/v1/users/nearby?level=Advanced")
            .set("authorization", `Bearer ${token}`);
        expect(res.body.radiusMiles).toBe(100);
        expect(res.body.users.map((u) => u.name)).toEqual(["Far"]);
    });

    it("validates query parameters", async () => {
        const { token } = await makeUser({ location: toPoint(LONDON) });
        const res = await request(app)
            .get("/api/v1/users/nearby?distance=5000")
            .set("authorization", `Bearer ${token}`);
        expect(res.status).toBe(400);
    });
});
