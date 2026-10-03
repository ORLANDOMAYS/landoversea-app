---
name: Dual repository boundary
description: Safety rule for work spanning the preserved Replit app and its materially different GitHub counterpart.
---

Treat the Replit application and `ORLANDOMAYS/landoversea-app` as separate repository lineages unless the user explicitly authorizes a migration or replacement.

**Why:** The two main branches have no merge base and contain materially different architectures. Combining them as ordinary branches risks replacing a working product or contaminating both histories.

**How to apply:** Preserve the Replit branch and its backups. Base GitHub reviews on GitHub `main` in an isolated worktree and publish only a dedicated review branch/PR. Never merge, force-push, or reconcile either `main` implicitly.

When a fetch-only review remote must be updated through the GitHub connector, treat the remote tree and reference as the source of truth rather than assuming the API-created commit will keep the local SHA.

**Why:** Connector Git Data writes can be throttled, GitHub may canonicalize or sign the commit into a different SHA despite an identical tree, and the pull-request view can briefly lag the branch reference.

**How to apply:** Upload below the connector rate limit, verify the expected parent and exact tree, update the review ref without force, verify the ref directly, then fetch and align the isolated worktree to the remote commit.

Advancing GitHub `main` can automatically trigger the repository's Vercel deployment integration even when no deployment API or publish action is called.

**Why:** A reviewed pull-request merge immediately produced a completed GitHub deployment record for Vercel. Treating "merge" and "deploy" as independent operations would give the user a false guarantee.

**How to apply:** Before merging GitHub `main`, warn that the configured repository integration may deploy automatically. If the user requires an absolute no-deploy window, pause the integration before the merge rather than relying on not calling a deployment tool.