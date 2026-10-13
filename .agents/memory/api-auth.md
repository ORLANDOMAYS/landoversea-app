---
name: LandOverSEA API authentication
description: How auth works in the API server
---

## Approach
Cookie-based JWT. On login/register: sign JWT with SESSION_SECRET (30d expiry), set as `los_token` HttpOnly cookie. On every protected request: `requireAuth` middleware reads cookie (or Authorization header fallback), verifies JWT, fetches user from DB.

## Key points
- Cookie name: `los_token`
- JWT expiry: 30 days
- Libraries: `bcryptjs` (password hashing, rounds=12), `jsonwebtoken`
- `SESSION_SECRET` env var must be present at startup or server throws
- `requireAdmin` wraps `requireAuth` and checks `user.role === 'admin'`

**Why:** Session-based was simpler than OAuth for this app; JWT avoids needing a sessions table.

## Atomic registration and database errors

Create the user and initial profile in one transaction. Drizzle can wrap PostgreSQL errors, so classify expected database failures by walking a bounded `cause`/driver-error chain rather than checking only the top-level error code.

**Why:** A wrapped `23505` duplicate-email error was previously misreported as HTTP 500, and separate inserts could leave an orphan user if profile creation failed.

**How to apply:** Keep multi-row auth writes atomic, map wrapped expected constraint errors to safe 4xx responses, and reserve sanitized 5xx/503 responses for unexpected infrastructure failures.

## Credential-failure parity

Unknown emails and wrong passwords must return the same generic response and both perform one bcrypt comparison. Do not leave password-recovery controls active unless a proof-of-control delivery channel is configured.

**Why:** Different messages or response times enable account enumeration; exposing reset tokens or bypassing delivery would weaken authentication.

**How to apply:** Compare unknown-email attempts against a fixed dummy bcrypt hash, keep the public failure generic, and add recovery only through short-lived one-time tokens delivered by a trusted email/SMS provider.
