---
name: Contrast surface pairing
description: Durable rules for preserving readable light/dark text across adaptive, fixed-gradient, glass, and photo-backed surfaces.
---

Choose semantic foregrounds together with the surface that owns them. Never mechanically replace low-opacity white with a page foreground unless the underlying surface also adapts to the same color scheme. Fixed bright gradients need a dedicated dark foreground, while arbitrary photos need a sufficiently opaque, verified overlay before using white text.

**Why:** A theme-aware dark foreground becomes unreadable when a header keeps a fixed dark background, and white text can fail on bright pink, violet, or red surfaces even when it looks intentional.

**How to apply:** Audit foreground and background as a pair in every appearance. Calculate contrast at gradient endpoints and worst-case photo compositing, and reserve opacity changes for decoration rather than text or meaningful controls.