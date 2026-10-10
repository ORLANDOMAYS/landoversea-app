---
name: Metro image parser audit
description: How to interpret and revisit the image-size vulnerability inherited through Expo Metro.
---

The dependency scanner currently reports a high-severity `image-size` advisory inherited through Metro. The vulnerable parser is used while Metro examines local project assets during development/builds; the deployed static server does not accept remote images through it.

**Why:** The latest upstream `image-size` release is also covered by the advisory, so forcing a major override would not remediate the finding and could break Metro. Treating it as a remotely reachable production parser would also overstate the actual exposure.

**How to apply:** Recheck after Expo/Metro dependency updates and remove this note once the lockfile resolves to an upstream-fixed release. Until then, keep production serving prebuilt assets and never expose Metro as the production server.