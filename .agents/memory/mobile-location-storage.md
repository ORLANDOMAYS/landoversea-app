---
name: Mobile location storage
description: Why mobile onboarding keeps ISO country and subdivision selections in the existing profile location contract.
---

Mobile onboarding must only accept countries and available subdivisions selected from the ISO dataset, while persisting their canonical English display names through the existing profile location contract.

**Why:** The current profile contract has country and city strings but no dedicated subdivision name or stable ISO-code fields. Reusing that contract delivered validated locations without an unrequested database/API migration or breaking existing drafts.

**How to apply:** Treat the second onboarding location value as a subdivision, not free-form city text. If true city support or stable ISO codes are added, introduce an explicit backward-compatible profile migration before changing what existing fields mean.