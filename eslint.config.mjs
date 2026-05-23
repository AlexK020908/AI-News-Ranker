import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Standalone HTML prototype — loads React/Babel from CDN via <script
    // type="text/babel"> in news-feeds/index.html, shares globals across
    // .jsx files, never enters the Next.js build. Linting it produces
    // false positives (undefined symbols, ref/render rules) for code that
    // works fine at runtime.
    "news-feeds/**",
    // Nested git worktrees created by Claude Code agents. ESLint walks
    // into these and lints stale copies of the source tree, producing
    // duplicate/outdated errors. The real source lives at the repo root.
    ".claude/**",
  ]),
]);

export default eslintConfig;
