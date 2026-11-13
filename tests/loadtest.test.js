const path = require("node:path");
const http = require("node:http");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { percentile, summarize, withinBudget, runFixedRate } = require("../scripts/lib/load");
const { readOptions } = require("../scripts/loadtest");

const run = promisify(execFile);
const ROOT = path.join(__dirname, "..");

describe("load statistics (B18)", () => {
    it("uses nearest-rank percentiles", () => {
        const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
        expect(percentile(sorted, 50)).toBe(50);
        expect(percentile(sorted, 95)).toBe(95);
        expect(percentile(sorted, 100)).toBe(100);
        expect(percentile([7], 95)).toBe(7);
        expect(percentile([], 95)).toBeNaN();
    });

    it("counts non-2xx responses and connection errors as failures", () => {
        const s = summarize({ latencies: [3, 1, 2, 4], statuses: [200, 201, 429, 500], errors: 1 });
        expect(s).toMatchObject({ sent: 5, ok: 2, failed: 3, p50: 2, max: 4 });
    });

    it("passes only under the p95 budget and failure rate", () => {
        const budget = { budgetMs: 200, maxFailureRate: 0.01 };
        expect(withinBudget({ sent: 100, failed: 1, p95: 199 }, budget)).toBe(true);
        expect(withinBudget({ sent: 100, failed: 1, p95: 200 }, budget)).toBe(false);
        expect(withinBudget({ sent: 100, failed: 2, p95: 10 }, budget)).toBe(false);
        expect(withinBudget({ sent: 0, failed: 0, p95: NaN }, budget)).toBe(false);
    });
});

describe("runFixedRate", () => {
    let server;
    let port;
    const seen = [];

    beforeAll(async () => {
        server = http.createServer((req, res) => {
            let body = "";
            req.on("data", (c) => (body += c));
            req.on("end", () => {
                seen.push({ method: req.method, url: req.url, body, type: req.headers["content-type"] });
                res.statusCode = req.url === "/fail" ? 503 : 200;
                res.end("ok");
            });
        });
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        port = server.address().port;
    });
    afterAll(() => new Promise((resolve) => server.close(resolve)));

    it("sends rps x duration requests, spread over the duration", async () => {
        seen.length = 0;
        const t0 = performance.now();
        const s = await runFixedRate({
            port,
            rps: 100,
            durationMs: 500,
            makeRequest: () => ({ method: "POST", path: "/x", body: { a: 1 } }),
        });
        const elapsed = performance.now() - t0;

        expect(s).toMatchObject({ sent: 50, ok: 50, failed: 0 });
        expect(elapsed).toBeGreaterThanOrEqual(450); // paced, not fired all at once
        expect(seen[0]).toEqual({ method: "POST", url: "/x", body: '{"a":1}', type: "application/json" });
    });

    it("reports error statuses and refused connections as failures", async () => {
        const errors = await runFixedRate({ port, rps: 50, durationMs: 200, makeRequest: () => ({ method: "GET", path: "/fail" }) });
        expect(errors).toMatchObject({ sent: 10, ok: 0, failed: 10 });

        const closed = http.createServer();
        await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
        const deadPort = closed.address().port;
        await new Promise((resolve) => closed.close(resolve));
        const refused = await runFixedRate({ port: deadPort, rps: 50, durationMs: 100, makeRequest: () => ({ method: "GET", path: "/" }) });
        expect(refused).toMatchObject({ sent: 5, ok: 0, failed: 5 });
    });
});

describe("loadtest CLI", () => {
    it("reads defaults (50 rps assumed peak) and rejects bad options", () => {
        expect(readOptions([])).toEqual({
            rps: 50,
            durationMs: 30_000,
            users: 2000,
            budgetMs: 200,
            scenarios: ["login", "me", "nearby"],
        });
        expect(readOptions(["--only", "me,nearby"]).scenarios).toEqual(["me", "nearby"]);
        expect(() => readOptions(["--only", "logout"])).toThrow(/--only/);
        expect(() => readOptions(["--rps", "0"])).toThrow(/--rps/);
    });

    it("runs every endpoint against the real app and fails when over budget", async () => {
        const args = [path.join(ROOT, "scripts", "loadtest.js"), "--rps", "20", "--duration", "1", "--users", "50", "--budget-ms", "0"];
        const err = await run(process.execPath, args, { cwd: ROOT }).catch((e) => e);

        expect(err.code).toBe(1);
        // Every request succeeded (stubbed login, valid tokens, nearby data); only the 0 ms budget fails.
        for (const name of ["login", "me", "nearby"]) {
            expect(err.stdout).toMatch(new RegExp(`^${name}\\s+20\\s+20\\s+0\\s.*FAIL$`, "m"));
        }
        expect(err.stdout).toMatch(/Over budget/);
    }, 120_000);
});
