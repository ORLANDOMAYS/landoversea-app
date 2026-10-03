---
name: E2E regression suite conventions
description: How the Playwright + API regression tests run in this workspace
---

- Browser tests live in `artifacts/landoversea/e2e` (Playwright); the API concurrency test in `artifacts/api-server/tests` (node:test via tsx). Validation commands: `e2e` and `api-test`.
- Tests run against the dev proxy at `http://localhost:80` (web at `/`, API at `/api`) and **require both workflows running** — they do not start servers themselves.
- Chromium comes from `$REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` (no `playwright install` needed/possible on Nix).
- **Why:** the auth rate limiter (10/15min on login+register) is skipped when `NODE_ENV !== "production"` so repeated test runs don't trip it; keep that skip if the limiter is touched.
- App has no data-testids; tests use placeholder/role/text selectors. UI routes worth remembering: coach apply is `/coaches/apply`, booking is `/coaches/:id/book`; profile logout is a two-step confirm ("Log out" then "Log Out"). `/api/auth/me` returns the user object directly (no `{user}` wrapper) unlike register/login.
