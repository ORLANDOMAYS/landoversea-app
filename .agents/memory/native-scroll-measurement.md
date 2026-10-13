---
name: Native scroll measurement
description: Prevent native-only clipping when variable-height cards live inside React Native scroll containers.
---

Variable-height card content inside a React Native scroll container must use intrinsic sizing. Do not give an inner content view a percentage height when its parent has no explicit height, and do not make a dynamic-content ancestor responsible for decorative clipping.

**Why:** Native Yoga measurement can resolve a percentage-height child against the viewport rather than its full descendants. If an ancestor also clips overflow, long content can render visually but remain absent from the scroll container's measured size. Web previews may not reproduce this.

**How to apply:** Let dynamic card content determine its own height, keep long actions in the same vertical scroll flow, apply safe-area padding to the scroll content, and restrict rounded overflow clipping to absolute background or blur layers.