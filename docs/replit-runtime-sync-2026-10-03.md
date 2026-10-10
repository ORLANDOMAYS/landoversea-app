# Replit runtime synchronization

This branch synchronizes the tested LandOverSEA implementation from the current Replit repository lineage into the GitHub repository without rewriting GitHub `main`.

- Replit source commit: `472cf13f39671145bca192321cc38c05bbd93036`
- GitHub parent commit: `a9e7bffabbb7986b774e1798b1d85c7c2c7b2748`
- Reconciliation history retained: `docs/open-pr-reconciliation-2026-10-03.md`

The obsolete GitHub `apps/` runtime is replaced by the Replit pnpm workspace (`artifacts/`, `lib/`, `scripts/`, and the current Supabase migrations). No force-push or `main` history rewrite is required.

Exact-branch validation also identified and corrected a type-only Expo Router segment check in the mobile auth guard. The reset-password route behavior is unchanged.

The same validation tightened the Playwright text locators so inline upload errors are distinguished from their accessibility notifications.

Before the pull request is opened, the fetched GitHub branch must pass the existing web, mobile, API, Playwright, typecheck, and production-build validation.