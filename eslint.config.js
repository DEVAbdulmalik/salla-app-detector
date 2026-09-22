import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import importX from "eslint-plugin-import-x";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

const SCOPE = "@salla-app-detector";

/**
 * Allowed workspace dependencies per package. The graph is acyclic and keeps the
 * detection engine free of I/O so it can be tested entirely offline.
 */
const packageBoundaries = {
  shared: [],
  engine: ["shared"],
  salla: ["shared"],
  knowledge: ["shared", "engine"],
  jobs: ["shared", "engine", "salla", "knowledge"],
};

const NETWORK_MODULES = ["node:http", "node:https", "node:net", "node:dns", "node:tls", "undici"];

const workspaceImportPatterns = (allowed) => [
  {
    group: [`${SCOPE}/*`, ...allowed.map((name) => `!${SCOPE}/${name}`)],
    message: "This package may not depend on that workspace package (see eslint.config.js).",
  },
];

export default defineConfig(
  globalIgnores(["**/node_modules/", "**/dist/", "**/coverage/", "**/.next/"]),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: { allowDefaultProject: ["*.js"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "import-x": importX },
    rules: {
      eqeqeq: ["error", "always"],
      "no-console": "error",
      "import-x/no-relative-packages": "error",
      "import-x/no-duplicates": "error",
      "object-shorthand": "error",
      "prefer-template": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },

  Object.entries(packageBoundaries).map(([name, allowed]) => ({
    files: [`packages/${name}/**/*.ts`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: workspaceImportPatterns(allowed),
          paths:
            name === "engine"
              ? NETWORK_MODULES.map((module) => ({
                  name: module,
                  message: "The engine is pure: fetch data in packages/salla and pass it in.",
                }))
              : [],
        },
      ],
    },
  })),

  {
    files: ["packages/shared/src/logger.ts"],
    rules: { "no-console": "off" },
  },

  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  prettier,
);
