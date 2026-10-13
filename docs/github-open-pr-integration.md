# GitHub open-PR reconciliation

The GitHub pull requests were authored against an older Next.js/Expo tree with history separate from the current Replit Vite/Express/Expo workspace. Their intended value is reconciled here without restoring the obsolete architecture.

| Pull request | Reconciled result |
| --- | --- |
| #2 — empty app/build fix | Superseded by the current routed Vite app. The production build and a source-contract test guard against an empty entry page. |
| #3 — testing and hosting guidance | Adapted into `.agents/skills/testing-landoversea/SKILL.md` for the current artifacts, connected Supabase project, safe credential handling, and independent GitHub/Vercel and Replit release paths. |
| #5 — Premium, video chat, and coach marketplace | Existing authoritative RevenueCat entitlement reconciliation and the verified coach marketplace remain in place. The placeholder camera page is replaced by participant-scoped Supabase signaling and real peer-to-peer WebRTC calls. Unpaid client-side Premium activation is intentionally not imported. |
| #7 — logo redesign | The heart/globe/swoosh identity is implemented as reusable, resolution-independent web and native components and placed on the main authentication and navigation surfaces. Existing store identity and binary release assets remain untouched. |

This is a semantic integration: newer working account, onboarding, private-photo, Supabase, Resend, coaching, and subscription behavior takes precedence over stale implementations in the old pull-request tree.