---
name: PostgreSQL advisor hardening
description: Non-obvious PostgreSQL rules for function defaults and recursion-safe RLS enforcement.
---

To remove PostgreSQL's built-in default `PUBLIC EXECUTE` grant from functions created by a migration owner, use a global `ALTER DEFAULT PRIVILEGES` revoke. A schema-scoped revoke cannot subtract the global built-in default; schema defaults can only add to it.

**Why:** A schema-scoped statement can execute successfully while every subsequently created function still inherits anonymous execution.

**How to apply:** Revoke the global function default for the migration owner, then explicitly grant intended RPC roles. For existing functions, update ACLs separately and exclude extension-owned functions from broad application hardening.

Do not enforce a row count or quota by querying a table from that same table's RLS policy.

**Why:** PostgreSQL detects the policy's self-reference as infinite recursion. Concurrent inserts can also race even when the query appears logically correct.

**How to apply:** Keep RLS responsible for ownership. Enforce quotas in a fixed-search-path trigger, use a per-owner transaction advisory lock, and revoke direct client execution of the trigger function.