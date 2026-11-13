/**
 * Minimal fixed-rate (open-model) HTTP load generator for the load test (GAP B18).
 *
 * Requests start on a schedule (rps x duration) whether or not earlier ones have
 * finished, and each latency is measured from its *scheduled* start. A slow
 * server therefore shows up as higher latency instead of quietly lowering the
 * request rate (no coordinated omission).
 */
const http = require("node:http");

/** Nearest-rank percentile of an ascending array. */
function percentile(sorted, p) {
    if (!sorted.length) return NaN;
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/**
 * @param {{ latencies: number[], statuses: number[], errors: number }} raw
 */
function summarize({ latencies, statuses, errors }) {
    const sorted = [...latencies].sort((a, b) => a - b);
    const ok = statuses.filter((s) => s >= 200 && s < 300).length;
    const sent = statuses.length + errors;
    return {
        sent,
        ok,
        failed: sent - ok,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        max: sorted.at(-1) ?? NaN,
    };
}

/** Pass/fail against the budget: p95 under budgetMs and failures at most maxFailureRate. */
function withinBudget(summary, { budgetMs, maxFailureRate }) {
    return summary.sent > 0 && summary.p95 < budgetMs && summary.failed / summary.sent <= maxFailureRate;
}

/**
 * Send `makeRequest()` requests at `rps` for `durationMs` against http://host:port.
 * @param {{ port: number, rps: number, durationMs: number, makeRequest: () => { method: string, path: string, headers?: object, body?: object } }} options
 */
function runFixedRate({ port, rps, durationMs, makeRequest }) {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 512 });
    const total = Math.max(1, Math.round((rps * durationMs) / 1000));
    const latencies = [];
    const statuses = [];
    let errors = 0;
    let started = 0;
    let finished = 0;

    return new Promise((resolve) => {
        const t0 = performance.now();

        const fire = (scheduledAt) => {
            const { method, path, headers = {}, body } = makeRequest();
            const payload = body === undefined ? undefined : JSON.stringify(body);
            const req = http.request(
                {
                    host: "127.0.0.1",
                    port,
                    method,
                    path,
                    agent,
                    headers: payload ? { ...headers, "content-type": "application/json" } : headers,
                },
                (res) => {
                    res.resume();
                    res.on("end", () => {
                        latencies.push(performance.now() - scheduledAt);
                        statuses.push(res.statusCode);
                        done();
                    });
                }
            );
            req.on("error", () => {
                errors += 1;
                done();
            });
            req.end(payload);
        };

        const done = () => {
            finished += 1;
            if (finished === total) {
                agent.destroy();
                resolve(summarize({ latencies, statuses, errors }));
            }
        };

        // Every tick, start whatever the schedule says is due by now.
        const timer = setInterval(() => {
            const elapsed = performance.now() - t0;
            const due = Math.min(total, Math.floor((elapsed / 1000) * rps) + 1);
            while (started < due) {
                fire(t0 + (started * 1000) / rps);
                started += 1;
            }
            if (started >= total) clearInterval(timer);
        }, 2);
    });
}

module.exports = { percentile, summarize, withinBudget, runFixedRate };
