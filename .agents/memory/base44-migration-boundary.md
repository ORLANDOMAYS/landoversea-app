---
name: Base44 migration boundary
description: Durable source-access and review constraints for moving production data from Base44.
---

Treat Base44 as a read-only migration source. Use admin-supplied JSON exports or one separately configured fixed HTTPS export endpoint; normal application requests must never call Base44.

Commit must be bound to both the immutable snapshot content and the exact conflict-decision plan reviewed during dry-run. Historical attachment bytes require a separate media-transfer phase rather than allowing remote Base44 URLs in the client.

**Why:** Base44 does not provide external backends with service-role access, and production migration must not create a runtime dependency on or mutate the legacy system.

**How to apply:** Keep new migration features admin-only, deterministic, idempotent, fully reported, and rollback-ledgered. Require a fresh dry-run whenever either the snapshot or conflict decisions change.