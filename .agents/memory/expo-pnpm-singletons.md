---
name: Expo pnpm singleton resolution
description: Prevent missing Expo Babel transforms and duplicate React runtimes in strict pnpm workspaces.
---

## Decision
In this strict pnpm workspace, treat Expo Router, Worklets, and React-family resolution as explicit mobile-app boundaries rather than relying on workspace-hoisted auto-detection.

**Why:** Workspace-hoisted `babel-preset-expo` could not detect app-local Router and Worklets packages, so their transforms were omitted. Metro also resolved React once from the mobile app and again from a shared workspace library, causing invalid-hook crashes on Expo Web even though production exports compiled.

**How to apply:** Keep the Expo Router transform explicit, keep the Worklets transform last, and force Metro imports of React, React DOM, and React Native through the mobile app's package paths. After dependency or Metro changes, inspect a development web bundle for one React runtime and render a real Expo Web route; a successful export alone is insufficient.