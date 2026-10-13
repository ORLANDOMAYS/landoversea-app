---
name: Orval codegen pitfalls
description: Fixes required to get Orval 8.23 working with Zod v3 in this monorepo
---

## Rules
- `type: integer` → must be changed to `type: number` in the OpenAPI spec before codegen; Orval 8.23 generates `zod.int()` (Zod v4 syntax) for integer fields, which fails with Zod v3.
- `format: binary` → remove entirely; generates `Blob` type which breaks the non-DOM `lib/api-zod` tsconfig.
- `format: email` → remove entirely; generates `zod.email()` (Zod v4 syntax).
- TS2308 collision: Orval generates the same name in both `lib/api-zod/src/generated/api.ts` (Zod schemas) and `lib/api-zod/src/generated/types/*.ts` (TS interfaces). Fix: after `orval` runs, overwrite `lib/api-zod/src/index.ts` with just `export * from "./generated/api";`.
- The fix is in `lib/api-spec/package.json` codegen script: `orval --config ./orval.config.ts && printf 'export * from "./generated/api";\n' > ../../lib/api-zod/src/index.ts && pnpm -w run typecheck:libs`

**Why:** Workspace catalog pins `zod@3.25.76` but Orval 8.23 generates Zod v4 syntax for certain formats.
