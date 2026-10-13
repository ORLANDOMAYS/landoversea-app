---
name: Mobile identity transitions
description: Cross-account ordering rules for Supabase auth state and native purchase identity.
---

Every asynchronous profile read or account-derived state update must be bound to the identity generation and expected immutable subject that started it. Clear prior account state immediately when the subject changes.

RevenueCat disconnect, login, purchase, restore, and reconciliation work must share one non-React identity coordinator and one operation queue. A disconnect must reserve its place in that queue synchronously before local sign-out can allow another account to associate.

**Why:** Unbound profile reads can commit one member's data after another member signs in, and a delayed purchase-provider disconnect can log out the newly active account.

**How to apply:** Any new auth observer, cache hydration, subscription side effect, or purchase operation must capture the expected subject/generation and verify it again before committing state. Never defer queue entry behind a dynamic import.