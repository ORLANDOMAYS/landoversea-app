---
name: Supabase magic-link release fixtures
description: Non-privileged live-auth fixture constraints for callback origins, disposable mailboxes, and email quotas.
---

Live release tests that provision new identities must use the actual registration UI; login magic links must not create unknown users. Consume the delivered email through the Supabase verification endpoint, validate the PKCE callback, and persist normal-user storage state. An unallowlisted development redirect may be canonicalized to the configured site URL; pin the expected origin explicitly, capture the verification redirect without loading the external page, and replay only its one-time PKCE code into the local callback that owns the verifier.

Mailbox collection responses may arrive either as Hydra member objects or plain arrays. Treat both shapes as valid.

Cached browser storage state should be refreshed and rewritten through the app before provisioning another identity. Do not discard a valid refresh token just because its short-lived access token expired.

Auth Site URL, Redirect URLs, and the recovery email template are separate controls. A hard-coded `SiteURL` template can bypass a valid client `redirectTo`; preserve the confirmation/redirect template variables.

**Why:** The live project has a very low email-send quota. Repeated setup attempts can exhaust the window, and blindly following a canonicalized external callback can leak a one-time code or test the wrong build. Correct client code cannot override a stale Auth URL or hard-coded email template.

**How to apply:** Reuse validated normal-user states, send email only when refresh fails, require an exact trusted callback origin and path, inspect URL Configuration and the recovery template together, and never use Admin Auth, service-role access, mocked JWTs, or privileged identity cleanup.