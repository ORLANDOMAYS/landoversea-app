---
name: Coach marketplace gating & seed fixtures
description: Rules for coach visibility/bookability and safe marketplace seed data
---

## Rules
- A coach is publicly visible/bookable only when `isVerified === true` AND `verificationStatus === 'approved'`. Apply this predicate to every public coach route (list, detail, availability, reviews, booking) — unapproved coaches return 404 except to their owner. Legacy status `'verified'` is normalized to `'approved'` in the seed path.
- Marketplace seed fixtures (e.g. the seeded approved coach) must be: idempotent, skipped when `NODE_ENV === 'production'`, and non-authenticatable (random non-bcrypt password sentinel so bcrypt.compare always fails).
- Verification and payout-readiness changes must write to `coach_audit_events` (field: verification|payout) with actor, previous/new value, notes.

**Why:** Completion review rejected work twice: once for a booking route bypassing the approval gate, once for a production-seeded account with a hardcoded credential.

**How to apply:** Any new coach-facing route or seed data must respect the approved predicate and the fixture safety rules.
