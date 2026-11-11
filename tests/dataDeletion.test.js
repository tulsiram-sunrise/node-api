const crypto = require("node:crypto");
const request = require("supertest");
const config = require("config");
const { User } = require("../api/v1/models/user");
const { DeletionRequest } = require("../api/v1/models/deletionRequest");
const createApp = require("../app");
const testDb = require("./helpers/db");

const app = createApp();
const PATH = "/api/v1/auth/facebook/data-deletion";
const { appSecret } = config.get("auth.facebook");

beforeAll(testDb.start);
afterEach(testDb.clear);
afterAll(testDb.stop);

/** Build a signed_request the way Meta does. */
function signedRequest(payload, secret = appSecret) {
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
    return `${sig}.${encodedPayload}`;
}

const validPayload = (userId) => ({
    algorithm: "HMAC-SHA256",
    user_id: userId,
    issued_at: Math.floor(Date.now() / 1000),
});

const postForm = (body) => request(app).post(PATH).type("form").send(body);

describe("POST /api/v1/auth/facebook/data-deletion", () => {
    it("deletes the user and returns a status URL and confirmation code", async () => {
        await User.create({ provider: "facebook", facebook: { id: "fb-42" }, name: "Jane" });
        await User.create({ provider: "facebook", facebook: { id: "fb-other" }, name: "Keep" });

        const res = await postForm({ signed_request: signedRequest(validPayload("fb-42")) });

        expect(res.status).toBe(200);
        expect(res.body.confirmation_code).toMatch(/^[0-9a-f]{32}$/);
        expect(res.body.url).toMatch(new RegExp(`${PATH}/${res.body.confirmation_code}$`));
        expect(await User.countDocuments({ "facebook.id": "fb-42" })).toBe(0);
        expect(await User.countDocuments({ "facebook.id": "fb-other" })).toBe(1);
    });

    it("still confirms when the user does not exist (already deleted)", async () => {
        const res = await postForm({ signed_request: signedRequest(validPayload("fb-unknown")) });
        expect(res.status).toBe(200);
        expect(res.body.confirmation_code).toBeDefined();
    });

    it("stores no personal data with the deletion record", async () => {
        await postForm({ signed_request: signedRequest(validPayload("fb-42")) });
        const [record] = await DeletionRequest.find().lean();
        expect(JSON.stringify(record)).not.toContain("fb-42");
    });

    it.each([
        ["signed with another secret", () => signedRequest(validPayload("fb-42"), "not-the-app-secret")],
        ["tampered payload", () => {
            const [sig] = signedRequest(validPayload("fb-42")).split(".");
            const forged = Buffer.from(JSON.stringify(validPayload("fb-victim"))).toString("base64url");
            return `${sig}.${forged}`;
        }],
        ["wrong algorithm", () => signedRequest({ ...validPayload("fb-42"), algorithm: "none" })],
        ["missing user_id", () => signedRequest({ algorithm: "HMAC-SHA256" })],
        ["not a signed request", () => "garbage"],
    ])("rejects a signed_request that is %s", async (_label, make) => {
        await User.create({ provider: "facebook", facebook: { id: "fb-42" } });

        const res = await postForm({ signed_request: make() });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("INVALID_SIGNED_REQUEST");
        expect(await User.countDocuments()).toBe(1);
    });

    it("requires signed_request", async () => {
        const res = await postForm({});
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
});

describe("GET /api/v1/auth/facebook/data-deletion/:code", () => {
    it("reports the status of a processed request", async () => {
        const created = await postForm({ signed_request: signedRequest(validPayload("fb-42")) });
        const code = created.body.confirmation_code;

        const res = await request(app).get(`${PATH}/${code}`);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ confirmationCode: code, status: "completed" });
        expect(res.body.requestedAt).toBeDefined();
    });

    it("returns 404 for an unknown code and 400 for a malformed one", async () => {
        const unknown = await request(app).get(`${PATH}/${"0".repeat(32)}`);
        expect(unknown.status).toBe(404);
        expect(unknown.body.error.code).toBe("DELETION_REQUEST_NOT_FOUND");

        const malformed = await request(app).get(`${PATH}/not-a-code`);
        expect(malformed.status).toBe(400);
    });
});
