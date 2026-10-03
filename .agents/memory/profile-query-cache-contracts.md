---
name: Profile query cache contracts
description: Why authentication gates and member-profile surfaces must not share a client cache entry.
---

Treat each client query key as a data-contract identifier, not just a resource label. An authentication/completion gate and a full member-profile surface must use distinct keys when they return different shapes, even if both read the same database row.

**Why:** A smaller gate model once populated the cache entry expected by full profile screens. The UI still had enough fields to render a name, so the failure looked successful while photo arrays were absent and valid private photos were silently replaced by fallbacks.

**How to apply:** Give differently shaped results separate keys, invalidate both when shared profile fields change, and keep a browser regression that proves a real signed photo decodes after reload, background/foreground, and navigation.