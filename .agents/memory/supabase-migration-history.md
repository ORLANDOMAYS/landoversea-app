---
name: Supabase migration history
description: How to deliver schema and security repairs safely when hosted projects may have different recorded migration versions.
---

Treat previously recorded Supabase migration versions as immutable delivery boundaries. A hosted project skips changed SQL under a version it already recorded, so every repair for that project must also exist in a new, higher migration.

If some legacy projects may not have recorded the earlier version and that version cannot tolerate their real schema, keep the earlier path legacy-safe too. The new forward repair remains the authoritative delivery path for projects that already recorded it.

**Why:** Editing historical SQL can pass a fresh database fixture while silently leaving an existing hosted database unchanged. Mixed migration histories require both unrecorded and already-recorded upgrade paths.

**How to apply:** Make repair migrations idempotent and data-preserving. Validate one fixture that runs the earlier path against the legacy schema and another that applies only the new forward repair as though prior versions were already recorded.