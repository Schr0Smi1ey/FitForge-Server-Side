const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  { ignores: ["node_modules", "coverage"] },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      // This server is CommonJS (require/module.exports), not ESM.
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Caught errors are frequently intentionally unused (we log a generic
      // message instead of leaking driver internals); allow an _ prefix to opt out.
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["__tests__/**/*.js"],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
  },
];
