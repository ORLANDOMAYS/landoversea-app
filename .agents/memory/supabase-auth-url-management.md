---
name: Supabase Auth URL management
description: How hosted Supabase Site URL, redirect allowlists, and email-link callback configuration must be changed.
---

Hosted Supabase Auth URL configuration is not stored in the project database or repository. Database-oriented MCP tools cannot update the Site URL, redirect allowlist, or hosted email templates.

**Why:** An unallowlisted callback is canonicalized to the hosted Auth Site URL before it appears in a verification email. SQL migrations and app-side `redirectTo` values cannot override a stale hosted Site URL.

**How to apply:** Prefer an integration tool that explicitly exposes Auth configuration. Otherwise use a Supabase Management API personal access token from Replit Secrets to inspect and patch `/v1/projects/{ref}/config/auth`, preserving required native and development callbacks while pinning production to the canonical origin. Never relax callback validation or expose the token.