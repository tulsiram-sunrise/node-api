jest.mock("../api/v1/services/oauth");

const request = require("supertest");
const jwt = require("jsonwebtoken");
const config = require("config");
const oauth = require("../api/v1/services/oauth");
const HttpError = require("../lib/httpError");
const { User } = require("../api/v1/models/user");
const createApp = require("../app");
const testDb = require("./helpers/db");

const app = createApp();

beforeAll(testDb.start);
afterEach(async () => {
    jest.resetAllMocks();
    await testDb.clear();
});
afterAll(testDb.stop);

const fbIdentity = {
    provider: "facebook",
    providerId: "fb-123",
    email: "Jane@Example.com",
    name: "Jane",
};

describe("POST /api/v1/auth/facebook", () => {
    it("creates a user and returns a signed token", async () => {
        oauth.verifyFacebookToken.mockResolvedValue(fbIdentity);

        const res = await request(app)
            .post("/api/v1/auth/facebook")
            .send({ access_token: "valid" });

        expect(res.status).toBe(200);
        expect(oauth.verifyFacebookToken).toHaveBeenCalledWith("valid");
        expect(res.body).toMatchObject({ name: "Jane", email: "jane@example.com", level: "Beginner" });
        expect(res.body.id).toBeDefined();
        // Internal identity fields never leak.
        expect(res.body.facebook).toBeUndefined();
        expect(res.body.provider).toBeUndefined();

        const claims = jwt.verify(res.headers["x-auth-token"], config.get("jwt.secret"), {
            algorithms: ["HS256"],
        });
        expect(claims.sub).toBe(res.body.id);
        expect(claims.aud).toBe(config.get("jwt.audience"));
    });

    it("returns the same user on repeat and concurrent logins", async () => {
        oauth.verifyFacebookToken.mockResolvedValue(fbIdentity);
        const results = await Promise.all(
            [1, 2, 3].map(() =>
                request(app).post("/api/v1/auth/facebook").send({ access_token: "valid" })
            )
        );
        const ids = new Set(results.map((r) => r.body.id));
        expect(results.every((r) => r.status === 200)).toBe(true);
        expect(ids.size).toBe(1);
        expect(await User.countDocuments()).toBe(1);
    });

    it("keeps profile edits on later logins (B5)", async () => {
        oauth.verifyFacebookToken.mockResolvedValue({ ...fbIdentity, profilePic: "https://cdn.example.com/fb-1.jpg" });
        const first = await request(app).post("/api/v1/auth/facebook").send({ access_token: "valid" }).expect(200);
        await request(app)
            .patch("/api/v1/users/me")
            .set("x-auth-token", first.headers["x-auth-token"])
            .send({ name: "Edited Name", profilePic: null })
            .expect(200);

        // The provider now reports a different name and photo.
        oauth.verifyFacebookToken.mockResolvedValue({
            ...fbIdentity,
            name: "Provider Name",
            profilePic: "https://cdn.example.com/fb-2.jpg",
        });
        const again = await request(app).post("/api/v1/auth/facebook").send({ access_token: "valid" }).expect(200);

        expect(again.body.id).toBe(first.body.id);
        expect(again.body.name).toBe("Edited Name");
        expect(again.body).not.toHaveProperty("profilePic");
    });

    it("validates the body", async () => {
        const res = await request(app).post("/api/v1/auth/facebook").send({});
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
        expect(oauth.verifyFacebookToken).not.toHaveBeenCalled();
    });

    it("rejects operator injection in the body", async () => {
        const res = await request(app)
            .post("/api/v1/auth/facebook")
            .send({ access_token: { $ne: null } });
        expect(res.status).toBe(400);
    });

    it("passes provider errors through", async () => {
        oauth.verifyFacebookToken.mockRejectedValue(
            new HttpError(401, "Invalid Facebook token", "INVALID_TOKEN")
        );
        const res = await request(app).post("/api/v1/auth/facebook").send({ access_token: "bad" });
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe("INVALID_TOKEN");
    });

    it("hides unexpected error details", async () => {
        oauth.verifyFacebookToken.mockRejectedValue(new Error("db password is hunter2"));
        const res = await request(app).post("/api/v1/auth/facebook").send({ access_token: "x" });
        expect(res.status).toBe(500);
        expect(JSON.stringify(res.body)).not.toContain("hunter2");
    });
});

describe("POST /api/v1/auth/google", () => {
    it("creates a separate google user", async () => {
        oauth.verifyGoogleToken.mockResolvedValue({
            provider: "google",
            providerId: "g-1",
            email: "g@example.com",
        });
        const res = await request(app).post("/api/v1/auth/google").send({ id_token: "tok" });
        expect(res.status).toBe(200);
        expect(oauth.verifyGoogleToken).toHaveBeenCalledWith("tok");
        expect(res.headers["x-auth-token"]).toBeDefined();
    });

    it("requires id_token", async () => {
        const res = await request(app).post("/api/v1/auth/google").send({ access_token: "tok" });
        expect(res.status).toBe(400);
    });
});
