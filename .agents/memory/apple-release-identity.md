---
name: Apple release identity
description: Owner-confirmed identity of the existing LandOverSEA App Store Connect record.
---

The existing LAND-OVER-SEA App Store Connect record uses bundle identifier
`com.base69d7f8da4081d841a49332c3.app`. On 2026-09-20, its latest marketing
version was `2.121943.2` and its highest uploaded build number was `2`.

**Why:** Apple treats the bundle identifier as permanent. A different identifier
would create a separate app instead of updating the existing listing.

**How to apply:** Use the confirmed identifier for the first Replit-built iOS
candidate, retain or advance the marketing version as appropriate for the
existing record, and use a build number greater than `2` (minimum next value:
`3`). Pin the reviewed version and build number before Expo Launch; Replit does
not maintain those values automatically. Do not create another App Store
listing.