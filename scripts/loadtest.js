#!/usr/bin/env node
/**
 * Load test with a performance budget (GAP B18).
 *
 *   npm run loadtest                                   # 50 rps, 30 s per endpoint, budget p95 < 200 ms
 *   npm run loadtest -- --rps 200 --duration 60
 *   npm run loadtest -- --only nearby --users 10000
 *
 * Runs the API in a child process against an in-memory MongoDB seeded with
 * --users sample users, with the Facebook/Google check stubbed. Each endpoint
 * gets the full --rps on its own (stricter than a realistic mix). Exits 1 if any
 * endpoint's p95 is at or over --budget-ms, or more than 1% of requests fail.
 *
 * The default 50 rps is an ASSUMPTION, not a measured or agreed peak; replace
 * it when the expected peak is known (docs/PLAN.md 6.9). Results measure this
 * machine, so treat them as a regression baseline, not production capacity.
 */
const path = require("node:path");
const crypto = require("node:crypto");
const { fork } = require("node:child_process");
const { parseArgs } = require("node:util");
const { runFixedRate, withinBudget } = require("./lib/load");

const ASSUMED_PEAK_RPS = 50;
const MAX_FAILURE_RATE = 0.01;
const SCENARIOS = ["login", "me", "nearby"];

function readOptions(argv) {
    const { values } = parseArgs({
        args: argv,
        options: {
            rps: { type: "string", default: String(ASSUMED_PEAK_RPS) },
            duration: { type: "string", default: "30" },
            users: { type: "string", default: "2000" },
            "budget-ms": { type: "string", default: "200" },
            only: { type: "string" },
        },
    });
    const num = (name, min, max) => {
        const n = Number(values[name]);
        if (!Number.isFinite(n) || n < min || n > max) throw new Error(`--${name} must be a number from ${min} to ${max}`);
        return n;
    };
    const only = values.only ? values.only.split(",") : SCENARIOS;
    const unknown = only.filter((s) => !SCENARIOS.includes(s));
    if (unknown.length) throw new Error(`--only accepts ${SCENARIOS.join(", ")}; got ${unknown.join(", ")}`);
    return {
        rps: num("rps", 1, 10_000),
        durationMs: num("duration", 1, 3600) * 1000,
        users: Math.trunc(num("users", 10, 100_000)),
        budgetMs: num("budget-ms", 0, 60_000),
        scenarios: only,
    };
}

function startServer(users) {
    const child = fork(path.join(__dirname, "loadtest-server.js"), [], {
        env: {
            ...process.env,
            // Production mode, as deployed (Express and config/production.json settings).
            NODE_ENV: "production",
            LOADTEST_USERS: String(users),
            NODE_CONFIG: JSON.stringify({
                jwt: { secret: crypto.randomBytes(32).toString("hex") },
                rateLimit: { max: 1e9, authMax: 1e9 },
                logging: { level: "error" },
            }),
        },
        stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    const ready = new Promise((resolve, reject) => {
        child.once("message", resolve);
        child.once("exit", (code) => reject(new Error(`loadtest server exited with code ${code}`)));
    });
    return { child, ready };
}

const pickFrom = (list) => {
    let i = 0;
    return () => list[i++ % list.length];
};

function requestFor(scenario, { tokens, seedIds }) {
    const nextToken = pickFrom(tokens);
    const nextSeedId = pickFrom(seedIds);
    switch (scenario) {
        case "login":
            // The stub accepts any token and returns it as the Google ID, so this
            // logs in existing seed users (the common case: returning users).
            return () => ({ method: "POST", path: "/api/v1/auth/google", body: { id_token: nextSeedId() } });
        case "me":
            return () => ({ method: "GET", path: "/api/v1/users/me", headers: { "x-auth-token": nextToken() } });
        case "nearby":
            return () => ({
                method: "GET",
                path: "/api/v1/users/nearby?distance=20",
                headers: { "x-auth-token": nextToken() },
            });
    }
}

const ms = (n) => (Number.isFinite(n) ? n.toFixed(1) : "-");

async function main(argv) {
    const options = readOptions(argv);
    const { child, ready } = startServer(options.users);
    try {
        const server = await ready;
        const assumed = options.rps === ASSUMED_PEAK_RPS ? " (assumed peak; see docs/PLAN.md 6.9)" : "";
        process.stdout.write(
            `Load test: ${options.rps} rps${assumed}, ${options.durationMs / 1000} s per endpoint, ` +
                `${server.users} seeded users, budget p95 < ${options.budgetMs} ms and <= 1% failures\n\n`
        );
        process.stdout.write("endpoint   sent     ok  failed    p50 ms   p95 ms   p99 ms   max ms  result\n");

        let pass = true;
        for (const scenario of options.scenarios) {
            const summary = await runFixedRate({
                port: server.port,
                rps: options.rps,
                durationMs: options.durationMs,
                makeRequest: requestFor(scenario, server),
            });
            const ok = withinBudget(summary, { budgetMs: options.budgetMs, maxFailureRate: MAX_FAILURE_RATE });
            pass &&= ok;
            process.stdout.write(
                `${scenario.padEnd(8)} ${String(summary.sent).padStart(6)} ${String(summary.ok).padStart(6)} ` +
                    `${String(summary.failed).padStart(7)} ${ms(summary.p50).padStart(9)} ${ms(summary.p95).padStart(8)} ` +
                    `${ms(summary.p99).padStart(8)} ${ms(summary.max).padStart(8)}  ${ok ? "PASS" : "FAIL"}\n`
            );
        }
        process.stdout.write(`\n${pass ? "Within budget" : "Over budget"}\n`);
        return pass ? 0 : 1;
    } finally {
        if (child.connected) child.send("stop");
    }
}

if (require.main === module) {
    main(process.argv.slice(2)).then(
        (code) => process.exitCode = code,
        (err) => {
            process.stderr.write(`loadtest failed: ${err.message}\n`);
            process.exitCode = 2;
        }
    );
}

module.exports = { readOptions };
