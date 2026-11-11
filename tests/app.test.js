const request = require("supertest");
const createApp = require("../app");

const app = createApp();

describe("app basics", () => {
    it("GET / responds", async () => {
        const res = await request(app).get("/");
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/running/);
    });

    it("GET /health is always ok", async () => {
        const res = await request(app).get("/health");
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("ok");
    });

    it("GET /ready is 503 without a database", async () => {
        const res = await request(app).get("/ready");
        expect(res.status).toBe(503);
    });

    it("sets security headers and a request id", async () => {
        const res = await request(app).get("/health");
        expect(res.headers["x-powered-by"]).toBeUndefined();
        expect(res.headers["x-content-type-options"]).toBe("nosniff");
        expect(res.headers["x-request-id"]).toMatch(/^[\w-]+$/);
    });

    it("rejects an unsafe incoming request id", async () => {
        const res = await request(app).get("/health").set("x-request-id", "bad id; DROP");
        expect(res.headers["x-request-id"]).not.toContain("bad");
    });

    it("returns JSON 404 for unknown routes", async () => {
        const res = await request(app).get("/nope");
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("returns 400 for malformed JSON", async () => {
        const res = await request(app)
            .post("/api/v1/auth/facebook")
            .set("content-type", "application/json")
            .send("{bad json");
        expect(res.status).toBe(400);
        expect(res.body.error).toBeDefined();
    });

    it("returns 413 for oversized bodies", async () => {
        const res = await request(app)
            .post("/api/v1/auth/facebook")
            .send({ access_token: "x".repeat(20_000) });
        expect(res.status).toBe(413);
    });
});
