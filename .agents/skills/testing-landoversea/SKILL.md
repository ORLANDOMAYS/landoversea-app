# Testing LandOverSea App

## Overview
Next.js 14 app with Supabase auth (OTP-based login). Monorepo using pnpm workspaces.

## Prerequisites

### Devin Secrets Needed
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL (format: `https://xxxxx.supabase.co`)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase legacy JWT anon key (starts with `eyJ...`). **NOT** the new publishable key format (`sb_publishable__...`)
- `VERCEL_EMAIL` — Vercel login email
- `VERCEL_PASSWORD` — Vercel login password (used for GitHub SSO if Vercel account is linked to GitHub)

### Important: Supabase Key Format
Supabase has two key formats:
- **Legacy JWT anon key**: Starts with `eyJhbGciOiJIUzI1NiIs...` — this is what `@supabase/supabase-js` `createClient()` expects
- **New publishable key**: Starts with `sb_publishable__...` — this is the new format shown in Supabase dashboard under "Publishable and secret API keys"

The app uses the legacy format. If the wrong format is used, you may see "Database error saving new user" when trying OTP login. To find the correct key: Supabase Dashboard → Settings → API Keys → "Legacy anon, service_role API keys" tab.

## Local Development

```bash
cd apps/web
NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" pnpm dev
```

Dev server runs on `localhost:3000`.

## Vercel Login

Vercel uses email verification codes or GitHub SSO:
1. **GitHub SSO** (recommended): Go to vercel.com/login → "Continue with GitHub" → enter GitHub credentials → may require device verification (GitHub Mobile or email code)
2. **Email verification**: Codes expire quickly (~60s). If using this method, the user should enter the code directly via the Desktop tab to avoid expiration.

## Testing Pages

| Page | URL | What to Check |
|------|-----|---------------|
| Home | `/` | "LandOverSea" heading, "Login" and "Open App" links |
| Auth | `/auth` | "Login" heading, email input, "Send Login Link" button |
| App | `/app` | Shows "Loading..." briefly, then "You are not logged in." + "Go to Login" (unauthenticated) or "Welcome" + user email (authenticated) |

## OTP Auth Flow Test
1. Navigate to `/auth`
2. Enter a registered email (e.g., the existing user in Supabase)
3. Click "Send Login Link"
4. Expected: Status changes to "Sending..." then "Check your email for the login link."
5. If you see "Database error saving new user", the Supabase anon key is likely wrong (using publishable format instead of legacy JWT)

## Vercel Environment Variables
The Vercel project needs:
- `NEXT_PUBLIC_SUPABASE_URL` — Must be the project URL (not a key)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Must be the legacy JWT anon key (not `sb_publishable__`)

If env vars are changed, a redeployment is needed. For preview branches, push a new commit to trigger a rebuild.

## Known Issues
- Production build on `main` may fail if `apps/web/src/app/app/page.tsx` is empty (the bug fixed in PR #2)
- Vercel email verification codes expire very quickly — use GitHub SSO or Desktop tab for real-time entry
