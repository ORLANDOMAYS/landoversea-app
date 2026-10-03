# Open pull-request reconciliation

On 2026-10-03, pull requests #2, #3, #5, and #7 were semantically integrated into the current LandOverSEA Replit workspace.

The GitHub prototype and the current Replit product have unrelated histories and materially different architectures. This reconciliation records the reviewed pull-request heads without restoring the obsolete apps/ tree or replacing either repository lineage.

- **#2 — empty app/build fix:** superseded by the routed Vite application and guarded by production-build and source-contract checks.
- **#3 — testing and hosting guidance:** adapted for the current Replit artifacts, connected Supabase project, safe credential handling, and separate GitHub/Vercel and Replit release paths.
- **#5 — Premium, video chat, and coaches:** retained authoritative RevenueCat entitlements and verified coaching; added participant-scoped Supabase signaling and real WebRTC calls without unpaid Premium activation or destructive stale behavior.
- **#7 — logo redesign:** implemented as reusable resolution-independent web and native components while preserving existing store binaries.

Current Supabase accounts and data, Resend delivery, RevenueCat reconciliation, onboarding completion, coach verification, and private-photo controls remain authoritative.
