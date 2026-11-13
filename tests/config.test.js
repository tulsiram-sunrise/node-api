const STRONG_SECRET = "s".repeat(32);

/**
 * Load startup/config.js against a fake `config` object, with the logger
 * replaced by a mock so warnings can be asserted.
 */
function load(values, { nodeEnv = "test" } = {}) {
    const get = (key) => key.split(".").reduce((obj, part) => obj?.[part], values);
    let validateConfig;
    let logger;
    jest.isolateModules(() => {
        jest.doMock("config", () => ({ get }));
        jest.doMock("../lib/logger", () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));
        logger = require("../lib/logger");
        validateConfig = require("../startup/config");
    });
    return {
        logger,
        run: () => {
            const previous = process.env.NODE_ENV;
            process.env.NODE_ENV = nodeEnv;
            try {
                return validateConfig();
            } finally {
                process.env.NODE_ENV = previous;
            }
        },
    };
}

const baseValues = (overrides = {}) => ({
    jwt: { secret: STRONG_SECRET },
    auth: {
        facebook: { appId: "fb-app", appSecret: "fb-secret" },
        google: { clientId: "google-client" },
    },
    timeouts: { requestMs: 30000, headersMs: 10000, keepAliveMs: 65000, queryMs: 5000 },
    ...overrides,
});

afterEach(() => {
    jest.dontMock("config");
    jest.dontMock("../lib/logger");
});

describe("validateConfig", () => {
    it("accepts a complete configuration without warnings", () => {
        const { run, logger } = load(baseValues());
        expect(run).not.toThrow();
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it("refuses to start without a JWT secret", () => {
        const { run } = load(baseValues({ jwt: { secret: "" } }));
        expect(run).toThrow(/jwt\.secret/);
    });

    it("refuses a short JWT secret in production", () => {
        const { run } = load(baseValues({ jwt: { secret: "short" } }), { nodeEnv: "production" });
        expect(run).toThrow(/at least 32 characters/);
    });

    it("only warns about a short JWT secret outside production", () => {
        const { run, logger } = load(baseValues({ jwt: { secret: "short" } }), { nodeEnv: "development" });
        expect(run).not.toThrow();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/at least 32 characters/));
    });

    it.each([
        ["appId without appSecret", { appId: "fb-app", appSecret: "" }],
        ["appSecret without appId", { appId: "", appSecret: "fb-secret" }],
    ])("refuses a half-configured Facebook provider (%s)", (_label, facebook) => {
        const values = baseValues();
        values.auth.facebook = facebook;
        const { run } = load(values);
        expect(run).toThrow(/Facebook appId and appSecret/);
    });

    it("warns, but starts, when no social provider is configured", () => {
        const values = baseValues();
        values.auth = { facebook: { appId: "", appSecret: "" }, google: { clientId: "" } };
        const { run, logger } = load(values);
        expect(run).not.toThrow();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/No social login provider/));
    });

    it.each([
        ["zero", { queryMs: 0 }],
        ["negative", { requestMs: -1 }],
        ["non-integer", { keepAliveMs: 1.5 }],
        ["a string", { headersMs: "10000" }],
    ])("refuses a timeout that is %s", (_label, override) => {
        const values = baseValues();
        Object.assign(values.timeouts, override);
        const { run } = load(values);
        expect(run).toThrow(/must be a positive integer/);
    });

    it("refuses a headers timeout longer than the request timeout", () => {
        const values = baseValues();
        values.timeouts.headersMs = values.timeouts.requestMs + 1;
        const { run } = load(values);
        expect(run).toThrow(/headersMs must not exceed/);
    });

    it("accepts the shipped default timeouts", () => {
        const defaults = require("../config/default.json");
        const { run } = load(baseValues({ timeouts: defaults.timeouts }));
        expect(run).not.toThrow();
    });
});
