---
name: Video-call schema compatibility
description: Compatibility rule for extending the established live Supabase video-call model without splitting call history.
---

Extend the established live video-call schema in place. Preserve legacy rows, keep one participant model, and expose lifecycle transitions through authenticated participant-scoped operations instead of unrestricted direct writes.

**Why:** The live Supabase project already contained video-call data with an older schema. A greenfield migration failed transactionally, and introducing parallel caller/callee semantics would split history and authorization behavior.

**How to apply:** Inspect the live schema and retained rows before changing calls. Adapt new signaling to established columns, use idempotent forward repairs for recorded migrations, and verify participant RLS plus restricted status transitions against both old and new rows.