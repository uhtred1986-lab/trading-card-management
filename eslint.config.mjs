import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Restrict @anthropic-ai/sdk imports to providers only; all feature code goes through the contract.
const restrictedImports = {
  rules: {
    "no-restricted-imports": [
      "error",
      "@anthropic-ai/sdk",
      "@anthropic-ai/claude-agent-sdk",
    ],
  },
};

// Provider files are allowed to import vendor SDKs; also temporary exceptions for #513, #515 which still convert
const exceptions = {
  files: [
    "src/lib/ai/providers/**",  // Vendor adapters import the SDKs
    "src/lib/ai/deck*.ts",      // #513 still uses SDK (being converted)
    "src/lib/ai/scan*.ts",      // #513 still uses SDK (being converted)
    "scripts/verify/ai-contract.ts",  // #515 may use SDK
    "scripts/verify-ai-runs.mts",     // #515 may use SDK
  ],
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
