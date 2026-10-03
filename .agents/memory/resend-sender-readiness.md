---
name: Resend sender readiness
description: How to distinguish an attached Resend connector from a production-ready sender.
---

Treat connector authorization and sender readiness as separate release gates. A
connector can successfully authorize a send-only key while domain-inspection
requests fail and arbitrary-recipient sends remain blocked.

**Why:** The attached connector permitted email API calls, but Resend rejected
external-recipient sends from both unverified product domains and restricted its
development sender to the provider account owner.

**How to apply:** Keep the connector as the preferred HTTPS transport, require
the configured `EMAIL_FROM` domain to be verified by Resend, and validate it
with one provider-accepted send to an address outside the provider account.
Never treat connector presence or `resend.dev` delivery as production readiness.