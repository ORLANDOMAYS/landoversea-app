# LandOverSea Real App Starter

This is a real starter repo for a dating app web/mobile stack.

## Included
- `apps/web` — Next.js web app
- `apps/mobile` — Expo React Native starter
- `supabase/migrations` — starter schema
- `supabase/functions` — starter edge functions
- `package.json` + `pnpm-workspace.yaml`

## Quick start
1. Create a Supabase project
2. Run the SQL migrations in `supabase/migrations`
3. Deploy the edge functions in `supabase/functions`
4. Set env vars:
   - Web: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_FUNCTIONS_BASE`
   - Mobile: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_FUNCTIONS_BASE`
5. Install and run:
   - `pnpm install`
   - `pnpm dev:web`
   - `pnpm dev:mobile`

## Deploy to Vercel
- Import repo
- Root directory: `apps/web`

## Domain
- Point `app.landoversea.net` to Vercel using a CNAME to `cname.vercel-dns.com`
