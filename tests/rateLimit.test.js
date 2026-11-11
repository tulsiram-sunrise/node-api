const express = require("express");
const request = require("supertest");
const { createLimiter } = require("../startup/security");
const requestContext = require("../middleware/requestContext");
const error = require("../middleware/error");

function appWithLimit(limit) {
    const app = express();
    app.use(requestContext);
    app.use(createLimiter({ windowMs: 60_000, limit }));
    app.get("/ping", (req, res) => res.json({ ok: true }));
    app.use(error);
    return app;
}

describe("rate limiting", () => {
    it("returns the standard JSON error with Retry-After once the limit is hit", async () => {
        const app = appWithLimit(2);
        await request(app).get("/ping").expect(200);
        await request(app).get("/ping").expect(200);

        const res = await request(app).get("/ping");

        expect(res.status).toBe(429);
        expect(res.headers["content-type"]).toMatch(/application\/json/);
        expect(res.headers["retry-after"]).toBeDefined();
        expect(res.headers.ratelimit).toBeDefined();
        expect(res.body.error).toMatchObject({ code: "RATE_LIMITED" });
        expect(res.body.error.requestId).toBe(res.headers["x-request-id"]);
    });
});
