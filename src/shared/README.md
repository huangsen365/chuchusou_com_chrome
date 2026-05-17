# Plasmo shared/config migration notes

This directory is the new TypeScript-facing adapter layer for the existing SSoT files.

Current rule during migration:

- Do not edit menu or engine data here.
- The source of truth remains:
  - config/unifiedMenuConfig.json
  - config/engines.json
  - prompts/*.json
- `src/assets-json/**` contains Plasmo-importable mirrors of those SSoT files.
- `scripts/verify-shared-config.mjs` fails if any mirror drifts from the root SSoT.
- `src/shared/configAssets.ts` imports the mirrors and `src/shared/config.ts` exposes typed helpers for new Plasmo/React/TS entrypoints.

Why this layer exists:

- Future popup, sidepanel, content, and background modules should import typed helpers from src/shared/config instead of reaching into globalThis or duplicating JSON loading logic.
- Legacy production code still uses the old background/popup/shared scripts until each entrypoint is migrated.
- The compat build keeps copying the original JSON files so runtime behavior stays identical while TypeScript code can be introduced safely.

Verification:

- npm run typecheck
- npm run plasmo:build
- npm run plasmo:package
