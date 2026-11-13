jest.mock("../api/v1/services/oauth");

const request = require("supertest");
const oauth = require("../api/v1/services/oauth");
const HttpError = require("../lib/httpError");
const logger = require("../lib/logger");
const { User } = require("../api/v1/models/user");
const createApp = require("../app");
const testDb = require("./helpers/db");

const app = createApp();
const UA = "SecurityLogTest/1.0";

beforeAll(testDb.start);
let info;
beforeEach(() => {
    info = jest.spyOn(logger, "info");
});
afterEach(async () => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
    await testDb.clear();
});
afterAll(testDb.stop);

/** Metadata of every security event logged so far, in order. */
const events = () => info.mock.calls.map(([, meta]) => meta).filter((meta) => meta?.securityEvent);
const eventNamed = (name) => events().find((e) => e.securityEvent === name);

const identity = { provider: "google", providerId: "g-1", email: "jane@example.com", name: "Jane" };

async function login() {
    oauth.verifyGoogleToken.mockResolvedValue(identity);
    const res = await request(app)
        .post("/api/v1/auth/google")
        .set("user-agent", UA)
        .send({ id_token: "secret-id-token" })
        .expect(200);
    return { token: res.headers["x-auth-token"], id: res.body.id, requestId: res.headers["x-request-id"] };
}

describe("security event log (B4)", () => {
    it("logs a login with user, provider, IP, user agent and request ID; newUser only the first time", async () => {
        const first = await login();
        expect(eventNamed("auth.login")).toEqual(
            expect.objectContaining({
                userId: first.id,
                provider: "google",
                newUser: true,
                ip: expect.any(String),
                userAgent: UA,
                requestId: first.requestId,
            })
        );

        info.mockClear();
        await login();
        expect(eventNamed("auth.login")).toMatchObject({ userId: first.id, newUser: false });
    });

    it("logs a rejected provider token, but not a provider outage", async () => {
        oauth.verifyFacebookToken.mockRejectedValueOnce(new HttpError(401, "Invalid Facebook token", "INVALID_TOKEN"));
        await request(app).post("/api/v1/auth/facebook").send({ access_token: "bad" }).expect(401);
        expect(eventNamed("auth.login_failed")).toMatchObject({ provider: "facebook", reason: "INVALID_TOKEN" });

        info.mockClear();
        oauth.verifyFacebookToken.mockRejectedValueOnce(new HttpError(502, "Facebook is unavailable", "PROVIDER_UNAVAILABLE"));
        await request(app).post("/api/v1/auth/facebook").send({ access_token: "x" }).expect(502);
        expect(events()).toEqual([]);
    });

    it("logs profile edits by field name only", async () => {
        const { token, id } = await login();
        info.mockClear();

        await request(app)
            .patch("/api/v1/users/me")
            .set("authorization", `Bearer ${token}`)
            .send({ name: "Private Name", profilePic: null })
            .expect(200);

        const event = eventNamed("user.profile_updated");
        expect(event).toMatchObject({ userId: id, fields: ["name", "profilePic"] });
        expect(JSON.stringify(event)).not.toContain("Private Name");
    });

    it("logs discoverability changes", async () => {
        const { token, id } = await login();
        info.mockClear();

        await request(app)
            .patch("/api/v1/users/me/discoverable")
            .set("authorization", `Bearer ${token}`)
            .send({ discoverable: true })
            .expect(200);

        expect(eventNamed("user.discoverable_changed")).toMatchObject({ userId: id, discoverable: true });
    });

    it("logs account deletion", async () => {
        const { token, id } = await login();
        info.mockClear();

        await request(app).delete("/api/v1/users/me").set("authorization", `Bearer ${token}`).expect(204);

        expect(eventNamed("user.deleted")).toMatchObject({ userId: id, via: "self" });
        expect(await User.countDocuments()).toBe(0);
    });

    it("never logs tokens or emails", async () => {
        const { token } = await login();
        await request(app).patch("/api/v1/users/me").set("authorization", `Bearer ${token}`).send({ name: "N" });

        const logged = JSON.stringify(info.mock.calls);
        expect(events().length).toBeGreaterThanOrEqual(2);
        expect(logged).not.toContain("secret-id-token");
        expect(logged).not.toContain(token);
        expect(logged).not.toContain(identity.email);
    });
});
