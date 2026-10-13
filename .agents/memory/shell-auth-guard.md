---
name: Single-owner authentication boundary
description: Durable rule for deterministic authentication around the protected application shell.
---

## Decision
The protected application shell must have one owner for resolving authentication state. Layout components consume the resolved user instead of starting independent authentication checks.

**Why:** Multiple authentication observers on opposite sides of a conditional render can remount each other after an unauthenticated response, causing request loops and indefinite loading.

**How to apply:**
- Resolve loading, redirects, onboarding state, and authenticated rendering at one boundary.
- Pass the resolved identity into child layout components through props or context.
