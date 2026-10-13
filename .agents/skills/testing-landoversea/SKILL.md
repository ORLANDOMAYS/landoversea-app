---
name: testing-landoversea
description: Validate the current LandOverSEA Vite, Expo, API, Supabase, and release surfaces without exposing credentials or testing the obsolete app tree.
---

# Testing LandOverSEA

## Current architecture

- Web: `artifacts/landoversea` (React + Vite).
- Native: `artifacts/landoversea-mobile` (Expo Router).
- API sidecar: `artifacts/api-server`.
- Identity, member profiles, chat, and matching: the connected Supabase project.
- Native Premium entitlement: RevenueCat, reconciled by the API. Never simulate Premium by changing a profile row.

The historical GitHub `apps/web` Next.js tree and old Vercel environment are not the source of truth for the current app. Confirm the artifact and environment before interpreting a failure.

## Credentials and configuration

- Never print, paste, commit, or request passwords, tokens, service-role keys, cookies, or private connection strings.
- Use configured Replit workflows, secrets, and integrations. A browser-facing Supabase publishable/anon key is configuration, not authorization; Row Level Security remains mandatory.
- `@supabase/supabase-js` 2.115 supports current `sb_publishable_...` keys. Do not rewrite a working publishable key into a legacy JWT-shaped key.
- Use a dedicated test account through approved test tooling. Never put credentials in this skill or in test source.

## Fast validation

Run the smallest relevant checks first:

```sh
pnpm --filter @workspace/landoversea run typecheck
pnpm --filter @workspace/landoversea run test:unit
pnpm --filter @workspace/landoversea run build

pnpm --filter @workspace/landoversea-mobile run typecheck
pnpm --filter @workspace/landoversea-mobile run test:native
pnpm --filter @workspace/landoversea-mobile run build

pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run test:api
```

The web production build is the regression check for the former empty-app failure. A successful dev-server response alone is not enough.

## Browser validation

1. Start or restart the configured API and web workflows once after the code batch.
2. Check workflow and browser logs.
3. Use the public login/registration surfaces for static validation.
4. Use the authenticated browser-testing flow only for a materially changed critical journey.
5. Keep `landover-sea.com`, Supabase callback allowlists, and the artifact base path distinct; never construct a production URL from a development domain.

## Supabase changes

- Add schema changes as forward, idempotent migrations.
- Apply DDL through the connected Supabase migration operation, not raw ad hoc DDL.
- After applying a migration, inspect security and performance advisors.
- Verify RLS using separate participant and non-participant sessions; service-role success does not prove client authorization.

## Release checks

- Native release identity must continue using the established App Store/Play records and advancing build numbers.
- RevenueCat access must be reconciled authoritatively before Premium is treated as active.
- A GitHub `main` update can trigger Vercel independently of Replit. Confirm which repository and deployment are being changed before writing.