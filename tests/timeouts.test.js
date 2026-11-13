const http = require("node:http");
const express = require("express");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");
const db = require("../startup/db");
const { applyServerTimeouts } = require("../startup/server");
const requestContext = require("../middleware/requestContext");
const error = require("../middleware/error");
const { User } = require("../api/v1/models/user");

describe("HTTP server timeouts", () => {
    it("applies request, headers and keep-alive timeouts", () => {
        const server = http.createServer();
        applyServerTimeouts(server, { requestMs: 30000, headersMs: 10000, keepAliveMs: 65000 });
        expect(server.requestTimeout).toBe(30000);
        expect(server.headersTimeout).toBe(10000);
        expect(server.keepAliveTimeout).toBe(65000);
    });
});

describe("query maxTimeMS", () => {
    let server;

    beforeAll(async () => {
        // Test commands enable the maxTimeAlwaysTimeOut failpoint, which makes any
        // operation that carries a maxTimeMS fail as if it had run too long.
        server = await MongoMemoryServer.create({
            instance: { args: ["--setParameter", "enableTestCommands=1"] },
        });
        await db.connect(server.getUri(), { maxTimeMS: 5000 });
    });

    afterAll(async () => {
        mongoose.set("maxTimeMS", undefined);
        await db.disconnect();
        await server?.stop();
    });

    const failpoint = (mode) =>
        mongoose.connection.db.admin().command({ configureFailPoint: "maxTimeAlwaysTimeOut", mode });

    afterEach(() => failpoint("off"));

    it("attaches the configured maxTimeMS to queries and aggregations", () => {
        expect(mongoose.get("maxTimeMS")).toBe(5000);
    });

    it.each([
        ["find", () => User.find({})],
        ["findOne", () => User.findOne({})],
        ["findOneAndUpdate", () => User.findOneAndUpdate({ name: "x" }, { $set: { name: "y" } })],
        ["countDocuments", () => User.countDocuments({})],
        ["aggregate", () => User.aggregate([{ $match: {} }])],
    ])("%s fails with MaxTimeMSExpired when the limit is hit", async (_name, run) => {
        await failpoint("alwaysOn");
        await expect(run()).rejects.toMatchObject({ code: 50 });
    });

    it("does not time out when no maxTimeMS is set (control for the failpoint)", async () => {
        mongoose.set("maxTimeMS", undefined);
        try {
            await failpoint("alwaysOn");
            await expect(User.find({})).resolves.toEqual([]);
        } finally {
            mongoose.set("maxTimeMS", 5000);
        }
    });

    it("returns 503 QUERY_TIMEOUT through the error handler", async () => {
        const app = express();
        app.use(requestContext);
        app.get("/slow", async () => {
            await User.find({});
        });
        app.use(error);

        await failpoint("alwaysOn");
        const res = await request(app).get("/slow");

        expect(res.status).toBe(503);
        expect(res.body.error).toMatchObject({ code: "QUERY_TIMEOUT" });
        expect(res.body.error.requestId).toBe(res.headers["x-request-id"]);
    });
});
