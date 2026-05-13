// ESLint flat config for Drexler (Bun + TS + React 19 + Ink 7).
// See SPEC §T.2 / V34 — lint + format gate.
//
// TODO(lint-baseline): `bun run lint` currently runs with `--max-warnings=28`.
// That number is the legacy violation count at the time the gate was added.
// The goal is to drive it to 0 in a follow-up cleanup PR — do NOT raise it.
// Lowering it is the desired direction of travel.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

// Ink props that React's DOM-oriented `no-unknown-property` rule flags as unknown.
// These are first-class Ink <Box>/<Text> props; allowlist them globally for tsx.
const INK_PROPS = [
  "borderStyle",
  "borderColor",
  "paddingX",
  "paddingY",
  "marginX",
  "marginY",
  "marginTop",
  "marginBottom",
  "flexDirection",
  "flexShrink",
  "flexGrow",
  "maxWidth",
  "minWidth",
  "gap",
];

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "**/*.d.ts",
      "bun.lock",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // TS source + tests
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "tests/**/*.tsx"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      // React 17+ automatic JSX runtime — no need for `import React`.
      "react/react-in-jsx-scope": "off",
      // Treat `_`-prefixed args as intentionally unused.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // React Hooks correctness — `rules-of-hooks` stays an error; `exhaustive-deps` is a warning.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // TODO(lint-baseline): downgraded from `error` to `warn` so this PR can land
      // the lint+format CI gate (§T.2 / V34) without a sweeping code cleanup.
      // Follow-up: triage and remove these overrides, then drop --max-warnings.
      "@typescript-eslint/no-explicit-any": "warn",
      "no-empty": "warn",
      "no-useless-escape": "warn",
      "no-irregular-whitespace": "warn",
      // Terminal app legitimately strips ANSI / control chars in src/ regexes.
      // Kept as warn project-wide; revisit when those helpers are consolidated.
      "no-control-regex": "warn",
    },
  },

  // Ink JSX: allow Ink-specific layout props that the React DOM rule flags.
  {
    files: ["src/**/*.tsx"],
    rules: {
      "react/no-unknown-property": [
        "error",
        { ignore: INK_PROPS },
      ],
    },
  },

  // Tests legitimately parse terminal output containing ANSI escapes (0x1b).
  // The `no-control-regex` rule is too strict for this domain — disable in tests.
  {
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    rules: {
      "no-control-regex": "off",
    },
  },
];
