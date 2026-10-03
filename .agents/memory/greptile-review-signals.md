---
name: Greptile review signals
description: How to interpret Greptile's GitHub output when the numeric confidence section is absent.
---

Treat a successful Greptile check with zero comments and a separate zero-unresolved-thread query as evidence that no review findings remain, but do not translate that result into a numeric 5/5 confidence score.

**Why:** This repository's Greptile integration repeatedly completed full reviews and accepted explicit requests for a score while publishing only check summaries and inline findings—no PR summary or numeric confidence was exposed through comments, reviews, statuses, or check output.

**How to apply:** Read unresolved review threads through GitHub GraphQL after every completed Greptile check. If the user sets an iteration cap, stop at that cap and report the exact check result plus the absent numeric score rather than assuming one.