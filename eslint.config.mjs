import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Restrict @anthropic-ai/sdk imports to providers only; all feature code goes through the contract.
const message = "Vendor AI SDKs are imported only by the provider adapters in src/lib/ai/providers. Go through the contract in src/lib/ai (generate / generateJson).";
const restrictedImports = {
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: ["@anthropic-ai/sdk", "@anthropic-ai/claude-agent-sdk"].map((name) => ({ name, message })),
        patterns: [{ group: ["@anthropic-ai/sdk/*", "@anthropic-ai/claude-agent-sdk/*"], message }],
      },
    ],
  },
};

// Only the provider adapters import a vendor SDK.
const exceptions = {
  files: ["src/lib/ai/providers/**"],
  rules: {
    "no-restricted-imports": "off",
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".claude/worktrees/**"]),
  restrictedImports,
  exceptions,
]);

export default eslintConfig;
