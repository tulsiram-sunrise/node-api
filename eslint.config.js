const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
    { ignores: ["node_modules/", "coverage/", "logs/"] },
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "commonjs",
            globals: { ...globals.node },
        },
        rules: {
            "no-unused-vars": ["error", { argsIgnorePattern: "^_|^next$" }],
            eqeqeq: ["error", "always"],
            "no-var": "error",
            "prefer-const": "error",
        },
    },
    {
        files: ["tests/**/*.js"],
        languageOptions: { globals: { ...globals.jest } },
    },
];
