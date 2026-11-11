const crypto = require("node:crypto");
const config = require("config");
const { verifyFacebookToken, verifyGoogleToken } = require("../api/v1/services/oauth");

const { appId, appSecret } = config.get("auth.facebook");

function mockFetch(responses) {
    const calls = [];
    global.fetch = jest.fn(async (url) => {
        calls.push(new URL(url));
        const [status, body] = responses.shift();
        return { ok: status < 400, status, json: async () => body };
    });
    return calls;
}

const realFetch = global.fetch;
afterEach(() => {
    global.fetch = realFetch;
});

describe("verifyFacebookToken", () => {
    it("checks app id and signs the profile request", async () => {
        const calls = mockFetch([
            [200, { data: { is_valid: true, app_id: appId, user_id: "42" } }],
            [200, { id: "42", name: "Jane", email: "j@x.com", picture: { data: { url: "https://p" } } }],
        ]);

        const identity = await verifyFacebookToken("user-token");

        expect(identity).toEqual({
            provider: "facebook",
            providerId: "42",
            email: "j@x.com",
            name: "Jane",
            profilePic: "https://p",
        });
        expect(calls[0].pathname).toMatch(/debug_token$/);
        const expectedProof = crypto.createHmac("sha256", appSecret).update("user-token").digest("hex");
        expect(calls[1].searchParams.get("appsecret_proof")).toBe(expectedProof);
    });

    it("rejects tokens issued to another app", async () => {
        mockFetch([[200, { data: { is_valid: true, app_id: "other-app", user_id: "42" } }]]);
        await expect(verifyFacebookToken("t")).rejects.toMatchObject({ status: 401 });
    });

    it("rejects invalid tokens", async () => {
        mockFetch([[200, { data: { is_valid: false } }]]);
        await expect(verifyFacebookToken("t")).rejects.toMatchObject({ status: 401 });
    });

    it("maps provider outages to 502", async () => {
        mockFetch([[503, {}]]);
        await expect(verifyFacebookToken("t")).rejects.toMatchObject({ status: 502 });
    });
});

describe("verifyGoogleToken", () => {
    it("rejects a malformed ID token", async () => {
        await expect(verifyGoogleToken("not-a-jwt")).rejects.toMatchObject({ status: 401 });
    });
});
