---
name: Mobile auth overlays
description: Preventing global floating controls from obstructing autofill-sensitive mobile authentication forms.
---

On narrow public authentication forms, suppress a global floating control when the route already provides the same capability locally.

**Why:** At iPhone width, a floating language control can cover the password/autofill row before a software-keyboard resize is detected, even when the control has keyboard-aware hiding logic.

**How to apply:** Audit fixed and draggable overlays at 320px with focused, invalid, and autofilled fields. Let registration's route-level language step own language selection instead of layering a duplicate control over the form.