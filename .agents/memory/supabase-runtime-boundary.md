---
name: Supabase runtime boundary
description: Authentication, data ownership, and UUID rules for the in-place Supabase port.
---

Supabase Auth is the only client session owner, and authenticated clients use the live Supabase tables, private photo storage, RPC, and Realtime for core profile, discovery, match, message, location, and approved-coach data.

The local API may continue to serve richer translation, coaching, payment, notification, and entitlement behavior. A Supabase bearer token must be authoritative over any legacy cookie, and local account linkage must use the immutable provider subject rather than email or a password-field marker.

Profile fields that belong to the live Supabase contract, including richer preference fields, must be read and written there under the caller's RLS identity. Never mirror or fall back to the legacy profile store; if a field lacks a proven live column, disable it truthfully instead of reporting a split-store save as successful.

Never cast a Supabase UUID to a local integer. Legacy integer-only routes must accept only a complete canonical positive decimal string; permissive parsing can turn a digit-leading UUID into the wrong local record. A local sidecar action is available only when an authenticated, RLS-visible external entity can be resolved through an explicit mapping. If no mapping exists, fail clearly or disable the action rather than guessing.

## Profile column boundary

Authenticated profile clients must use explicit public-column projections and matching column grants. Keep private identity fields unreadable, keep entitlement and verification state non-writable, and do not give normal clients table-wide profile privileges.

Avoid PostgREST merge upserts for profile writes when the immutable subject column is insert-only. Update mutable fields first, insert with the subject only when no row exists, and retry the update on a unique-conflict race.

**Why:** Row-level ownership alone does not stop a member from reading private columns or changing privileged columns on their own row. PostgREST upsert can also require update permission for the submitted conflict key.

**How to apply:** Treat column grants and client projections as one contract. Verify allowed and forbidden column privileges separately, and use update-then-insert for owner-created profile rows without weakening subject immutability.

**Why:** The Replit app's local models use integer IDs while the reviewed live Supabase contract uses UUIDs and must not be changed. Stale cookies and mutable email/password fields previously created cross-account and broken-link risks, and split profile writes caused saved preferences to disappear on the next Supabase-backed read.

**How to apply:** Preserve direct Supabase ownership checks and deployed RLS as the authorization boundary. Reject noncanonical IDs before any legacy lookup, and verify ownership before returning resource metadata. Use only publishable credentials plus the current user's bearer token; never add a service-role path for normal app traffic.