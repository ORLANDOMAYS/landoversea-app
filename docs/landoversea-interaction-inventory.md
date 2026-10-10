# LandOverSEA interaction inventory

## Scope, method, and limitations

This is a source-and-automated-test inventory. It was produced by reading the routed React web application in `artifacts/landoversea/src`, its Playwright and Node tests in `artifacts/landoversea/e2e` and `artifacts/landoversea/test`, the Expo Router application in `artifacts/landoversea-mobile/app` and `components`, and `artifacts/landoversea-mobile/test/native-regression.test.mjs`.

An “instance” below is a route or shared product component, not a count of JSX `onClick`/`onPress` tokens. Repeated, data-driven controls are grouped only where every item invokes the same behavior; the option count or source is stated. Headless UI primitives under `src/components/ui` are not counted independently because their user-visible behavior is captured at each product-level instantiation.

The Base44 editor preview is auth-gated and no Base44 export environment variables are configured. Therefore this document makes **no evidence-grade Base44 visual comparison** and does not invent Base44 details. Source inspection cannot prove real-device hit testing, store dialogs, OS permission sheets, browser history behavior outside tested cases, or backend/provider availability. “Gap” means no current automated test specifically exercises that visible control, even where implementation source is clear.

### Behavior notation

- **API** identifies a generated API mutation/query; success normally invalidates/refetches relevant query data.
- **Local** means component state, media state, a menu, or a modal changes without navigation.
- Unless a row says otherwise, async buttons disable/show a pending indicator where implemented; failures use an inline alert or toast. There is generally no separate offline mode: offline requests follow the network-error path.
- A Back control uses browser history/fallback routing on web or `router.back()` on native unless a destination is stated.

## Coverage summary

| Surface | Inventoried route/component instances | With direct current automated interaction/contract evidence | Explicit coverage gaps |
|---|---:|---:|---:|
| Web routed page components | 48 | 22 | 26 |
| Web shared interactive product components | 7 | 3 | 4 |
| Native routed/layout components | 39 | 31 | 8 |
| Native shared interactive product components | 4 | 3 | 1 |

“Contract evidence” includes the native source-regression assertions, which inspect wiring and states but do not drive a simulator. Web “direct” evidence is primarily Playwright. Counts are by route or component, not raw handlers.

## Shared web controls

| Component/surface | Visible control or accessible label | Intended result and state behavior | Automated evidence |
|---|---|---|---|
| `MobileNav` (small-screen shell) — Discover | localized **Discover**, `mobile-tab-discover` | Navigate to `/discover`; active for `/discover`, `/filters`, `/voice-intro` and children. From a deep route, tap returns to root. At root, re-tap prevents navigation/history growth and scrolls both shell and window to top. | `e2e/mobile-bottom-nav-control-matrix.spec.ts`: all-five, deep-route, root-retap, and rapid-tap cases. |
| `MobileNav` — Matches | localized **Matches**, `mobile-tab-matches` | Navigate `/matches`; active for `/matches` and `/who-liked-me`; same deep-route/root-retap behavior. | Same four matrix cases. |
| `MobileNav` — Chat | localized **Chat**, `mobile-tab-messages`; unread badge (`1…99+`) | Navigate `/messages`; active for list and `/messages/:id`; badge derives from conversations with unread count. Deep route returns to root; root re-tap scrolls to top. | Same matrix, including group chat deep-route exit. Badge polling/display is a **gap**. |
| `MobileNav` — Coaches | localized **Coaches**, `mobile-tab-coaches` | Navigate `/coaches`; active for coach children, `/coaching`, dashboard, and client progress; same root/deep/retap behavior. | Same matrix. |
| `MobileNav` — Profile | localized **Profile**, `mobile-tab-profile` | Navigate `/profile`; active for edit, premium, settings, verification, notifications; same root/deep/retap behavior. Rapid Discover→Coaches→Profile taps must land on Profile; outgoing transition suppresses pointer events. | Same matrix explicitly covers rapid taps and final active state. |
| `TopHeader` (wide shell) | 8 identical links: Discover, Matches, Chat, Passport, Events, Coaches, Premium, Profile; notification bell; `LanguageSwitcher` | Route to `/discover`, `/matches`, `/messages`, `/cultural`, `/events`, `/coaches`, `/premium`, `/profile`, or `/notifications`; unread dot reflects polling. Language menu changes locale. | Locale change: `e2e/i18n-switching.spec.ts`. Other header links/badge: **gap**. |
| `DesktopSidebar` | logo; 7 main links; conditional Coach Dashboard/Admin; 3 footer links | Logo→Discover. Main: Discover, Matches, Messages, Cultural Passport, Learn, Coaches, Premium. Role-gated dashboard/admin. Footer: Profile, Settings, Safety. | Role entry visibility is partly covered by `native-regression.test.mjs` only for native equivalents; web sidebar itself: **gap**. |
| `FloatingLanguageControl` / `LanguageSwitcher` | **Change language**, locale menu (configured locales) | Tap toggles menu; choosing locale updates i18n. Floating mobile control can be dragged, persists position, suppresses post-drag click, closes via menu semantics; keyboard hides it. | `e2e/i18n-switching.spec.ts` covers locale switching; drag/persistence/cancel: **gap**. |
| `ReportUserModal` | reason selector; optional details; **Cancel**, **Submit report**; dialog close/backdrop | Local validation then report API; pending prevents cancel, success calls close, error remains visible; close/cancel leaves without submit. | Conversation report entry is present in `e2e/conversation-chat.spec.ts`, but modal submit/error/cancel: **gap**. |
| `ErrorBoundary` | **Try again** | Clears captured error and remounts route keyed boundary. | **Gap**. |

## Web route inventory

### Authentication, account, and legal

| Route/component | Visible controls | Outcome and loading/success/error/cancel behavior | Automated evidence |
|---|---|---|---|
| `/login` (`login.tsx`) | Email/password inputs; password visibility; **Sign in** form; **Forgot password?**; **Create account** | Login API; success clears user-scoped caches and routes to Discover or Onboarding; validation/API error stays on form; pending submit disabled. Links route to reset request/register. | `e2e/production-readiness.spec.ts` persisted auth/logout-login; `e2e/auth-onboarding.spec.ts` redirect and cache isolation. |
| `/register` | Language step: configured locales; Continue/Back. Age step: **I am 18 or older**, under-18/back. Account inputs, password visibility, **Create Account**, Terms, Privacy, Sign in | Local step state and adult gate; registration API routes to Verify Email/Onboarding. Pending/error rendered; unavailable social providers are hidden. | `e2e/auth-onboarding.spec.ts` registration, hidden providers, narrow keyboard flow; Terms/Privacy links also asserted by native contract only. |
| `/forgot-password` | Email; **Send reset link**; **Back to sign in** | Forgot-password API; success confirmation (development token when returned); retry by resubmitting after error; link→Login. | `e2e/production-readiness.spec.ts` complete reset flow. |
| `/reset-password` | New/confirm password, visibility controls, **Reset password**, **Back to sign in** | Validates token/password and calls reset API; success button routes Login; invalid/error stays retryable. | `e2e/auth-onboarding.spec.ts` verifies `newPassword` request contract. |
| `/verify-email` | Six-digit code; **Verify**, **Resend**, **Continue**, **Try again**, **Back to sign in** | Verify API→Onboarding. Resend API with pending state; success/invalid/error status panels can return to input or continue. | `e2e/launch-blockers.spec.ts` invalid/resend/success states; `e2e/auth-onboarding.spec.ts` registration verification. |
| `/delete-account` | Email; **Submit Deletion Request**; **Go to Profile Settings** | Public request API; pending disables; success replaces form with non-enumerating receipt; network failure is alert and same submit remains retryable. | `e2e/account-deletion.spec.ts` success and network retry. |
| `/terms`, `/privacy` | Content links inherited from shell; no route-local action | Read-only legal text. | `e2e/account-deletion.spec.ts` disclosures; route-local controls not applicable. |
| Not found | **Return to Discover** | Route `/discover`. | **Gap**. |

### Onboarding, discovery, matches, and profile

| Route/component | Visible controls | Outcome and loading/success/error/cancel behavior | Automated evidence |
|---|---|---|---|
| `/onboarding` | 14-step Back/Next/Finish; name/age/country/city/bio; upload photo; single-choice gender (6), looking-for (4), relationship goals (6), relocation (3), long-distance (2), primary languages (22); multi-choice learning languages (22, max 4), preferred countries (20), cultural goals (6), interests (30) | Local draft per account; validation blocks progression (18+, required fields, limits). Photo upload and final profile API show pending/error; success clears draft→Discover. Back is local step navigation. | `e2e/auth-onboarding.spec.ts` complete persistence and account-isolated draft/photo; `native-regression.test.mjs` independently asserts native 14-stage/full sets. |
| `/discover` | Card/profile tap; **Filters**; Pass, Super Like, Like; Translate bio; match-result **Message**; retry; filter modal close/backdrop, Save/Apply, Clear, Retry; filter inputs min/max age, country, language, relationship goal and switches global/verified/interests/long-distance/relocation | Swipe buttons/API advance card; drag/swipe gesture maps horizontal direction to pass/like (super-like is explicit button); match dialog links chat. Filter modal hydrates and saves API; dirty state protected, failed payload retryable; close cancels local session even while save hangs. Loading/empty/error and retry supplied. | `e2e/production-readiness.spec.ts` reciprocal actions; advanced/language filter specs; `e2e/visible-control-regressions.spec.ts` related mutations; native regression separately asserts tap-safe gesture. Web drag gesture itself: **gap**. |
| `/filters` | Back; Retry load/save; numeric inputs and paired age sliders; gender (4); country (20)/language (22) selectors; relationship goals (6); 5 switches; **Clear**, **Apply** | Same persisted filter API; Apply saves then Discover; Clear resets; load/save errors inline and failed payload can retry. | `e2e/discover-advanced-filters.spec.ts` hydrate/apply/refetch/clear and failed PATCH retry; language spec. |
| `/matches` | Empty-state Discover; per match **Message**, overflow; sheet backdrop/close, Message, Report, Block, Unmatch | Message→conversation. Overflow local sheet. Report/Block currently toast-only on this surface; Unmatch API removes relationship/conversation, pending/error toast. | `e2e/production-readiness.spec.ts` visible match/unmatch teardown. Sheet report/block: **gap**. |
| `/who-liked-me` | Premium upgrade; Discover; repeated Like back/Pass | Non-premium→Premium. Like/pass swipe API removes item and may create match/chat; pending/error toast. | **Gap**. |
| `/profile` | Settings; Edit profile; inline bio Edit/Cancel/Save; shortcuts Edit/Matches; menu rows (Who Liked Me, Verification, Voice Intro, Premium, Notifications and coming-soon item); Log out open/cancel/confirm; Delete account open/backdrop/cancel/password/confirm | Bio API. Links navigate. Logout confirmation clears auth/cache→Login. Delete modal requires password, API success clears session→Login; backdrop/cancel closes unless pending; errors remain in dialog. | `e2e/launch-blockers.spec.ts` password deletion/session removal; `e2e/production-readiness.spec.ts` profile persistence/logout isolation. Other shortcuts: **gap**. |
| `/profile/:userId` | Back; retry/fallback Discover | Loads public profile; Back uses history else Discover. | Card-to-profile is source-only; **gap**. |
| `/edit-profile` | Back; top/bottom Save; photo upload/delete; name/bio/location/age; gender (4), primary language select (20), learning languages (20), cultures (12), relocation switch, interests (30), relationship goals (6) | Local edits; profile/photo APIs. Save pending and errors toast; success invalidates profile→Profile. Photo input cancel is a no-op; delete/update errors remain retryable. | `e2e/production-readiness.spec.ts` edit survives reload and account switch. Photo and selector operations: **gap**. |
| `/voice-intro` | Back; Record/Stop; Play/Pause; Re-record; Delete; Upload | Browser MediaRecorder and local preview; upload updates profile then Profile. Permission/record/upload failures show error/toast; re-record/delete clear local media. | Conversation media controls have tests, but this route: **gap**. |
| `/verification` | Back Settings; Profile; choose file, clear, submit, retry selection | Validates selfie file, requests private upload URL, uploads/finalizes verification; pending shown, success status/link, errors retryable without trapping file selection. | `e2e/launch-blockers.spec.ts` invalid file and failed private-upload retry. |
| `/settings` | Back Profile; current/new password and visibility toggles; **Change password**; Retry preferences; 4 notification preference switches; route rows; **Log out** | Password API validation/success reset. Preference toggles optimistically call API and revert on failure; retry refetch. Rows route to notifications, verification, safety, legal/account destinations; logout clears cache→Login. | Cache isolation/logout in `e2e/production-readiness.spec.ts`; preference controls: **gap**. |
| `/safety` | Back Settings; safety-topic accordions (data-defined); repeated **Unblock** | Accordion open/close is local. Unblock API removes the returned blocked user, invalidates the list, and reports failures by toast; repeated users share the same handler. | **Gap**. |
| `/notifications` | Back; **Mark all**; Retry list/mutation; repeated notification row | Query loading/error/retry. Mark-all API disables pending and failed mutation exposes Retry. Row marks read then safely routes by type: Matches, conversation/messages, Who Liked Me, Verification, or Coaching. | `e2e/visible-control-regressions.spec.ts` deep-link reload, list retry, mark-all failure/retry. |

### Messaging, culture, learning, and community

| Route/component | Visible controls | Outcome and loading/success/error/cancel behavior | Automated evidence |
|---|---|---|---|
| `/messages` | Conversation links; search; empty Discover; **New group**; group dialog backdrop/close, title, repeated member toggles, **Create Group** | Search local. Conversation→detail. Group API; pending disabled, error visible, success closes→new conversation; backdrop/cancel discards dialog state. | `e2e/mobile-bottom-nav-control-matrix.spec.ts` accessible group modal, payload, success route. Error/member selection: **gap**. |
| `/messages/:conversationId` | Back; profile link; translation language menu (configured languages), clear translation; More menu/backdrop: mute/unmute, report, unmatch, block; **Load earlier**; attachment open; per-message Translate, reaction toggle, Copy, failed Retry/Discard, emoji reactions; starter chips; emoji picker/backdrop; image attachment; voice Record/Stop; message input/Send | Queries poll and mark read. Send API uses stable client ID; failed optimistic item remains with Retry/Discard. Attachment uses presigned upload; voice transcribes then inserts/sends. Menu actions call mute/report/unmatch/block APIs; destructive success routes Messages. Backdrops close without action. | `e2e/conversation-chat.spec.ts` language-menu semantics/focus, reaction, copy, image/voice accessibility, retry/discard dedupe, image upload flow. |
| `/cultural` and alias `/passport` | Passport country/fact cards; Next fact; Tribes link; repeated Join/Leave tribe; conversation-starter copy/use actions | Local country/fact carousel index; tribe membership API with pending/toast/query invalidation; navigation to Tribes; starter action updates local/copied state. | **Gap**. |
| `/tribes` | Back Passport; search; category filters (data-defined); repeated Join/Leave | Search/filter local; membership APIs update list with pending/toast. | Native contract covers equivalent generated flow; web: **gap**. |
| `/events` | Retry; search; category filters (data-defined); repeated event card; repeated RSVP/Cancel RSVP; mutation Retry | Search/filter local; card→detail. RSVP/cancel APIs update query; pending per event; failures alert/toast and retain retry payload. | `e2e/visible-control-regressions.spec.ts` RSVP cancellation retry and persistence. |
| `/events/:eventId` | Back; load Retry; RSVP/Cancel RSVP (desktop/mobile placements share handler) | Generated RSVP/cancel API; pending disabled, success invalidates; failure shown and same action can retry. | Cancellation list case covered; detail control specifically: **gap**. |
| `/learn` and alias `/quiz` | Quiz links (first/featured/list); coach chat input/Send; Premium; Leaderboard | Quiz navigation. AI message API appends history; pending/error toast. Premium gating link. | **Gap**. |
| `/learn/quiz/:quizId` | Back to Lab; answer options (question-defined); **Next/Finish** | Local answer selection and scoring; Next advances; Finish/result returns Learn. | **Gap**. |
| `/leaderboard` | Back; period/category tabs (data-defined) | Local tab changes displayed ranking query/view. | **Gap**. |
| `/workshops` | Back; search; filters (data-defined); repeated card/details link and Enroll | Search/filter local; card→detail. Enroll API updates card, pending/error toast. | Native contract covers equivalent flow; web: **gap**. |
| `/workshops/:workshopId` | Back/List; external Join workshop link when enrolled; Enroll (responsive duplicates share handler) | Enrollment API; pending/disabled when enrolled/full, success invalidates; failure toast. External meeting opens new context. | **Gap**. |

### Coaching, premium, and administration

| Route/component | Visible controls | Outcome and loading/success/error/cancel behavior | Automated evidence |
|---|---|---|---|
| `/coaches` | AI Coach, Conversation Coach, Profile Coach, Safety Advice, Coach Dashboard/Apply, search, repeated View Profile | Route links; search filters local list; coach card→detail. | `e2e/coaching-booking.spec.ts` discovery-to-booking reachability. |
| `/coaches/:coachId` | Back; Message; session duration options (data returned); **Book Session** | Local duration selection; book link→`/coaches/:id/book`; errors/not-found offer back. Message currently routes conversation list. | `e2e/coaching-booking.spec.ts`. |
| `/coaches/:coachId/book` | Back; calendar date selector; available slot buttons (API-defined); session type options; notes; submit | Availability query. Selection local; create-booking API; pending disabled, unavailable slots disabled, success→Coaching; error toast. | `e2e/coaching-booking.spec.ts` apply, availability, booking, cancellation. |
| `/coaching` | Back; Upcoming/Past tabs; Pay; Request refund; Cancel booking; Write review open, stars (5), comment, Submit/Cancel | Payment handoff/refund calls provider endpoints; unavailable configuration disables Pay and displays status. Cancel API only when cancellable. Review API with pending/toast, success closes. | Booking/cancel in `e2e/coaching-booking.spec.ts`; payment/refund/review: **gap**. |
| `/coach-dashboard` | Back; Apply/View Coaches/Settings links and credential/apply link; booking data | Navigation around coach management; no mutation on dashboard in current source. | `e2e/coaching-booking.spec.ts` reaches coach workflow; dashboard links: **gap**. |
| `/coaches/apply` | Back; selected days (7) and time windows (data-defined); bio/rate/experience; specialties and languages (configured lists); Submit/Update availability; Dashboard | Profile/availability APIs; pending disabled, validation/toast; approved/pending status changes available actions. | `e2e/coaching-booking.spec.ts`; credential route separately tested. |
| `/coaches/verify` | Back/step navigation; document type options; Choose file, Upload, Retry; video URL, Continue/Skip; identity/certification/experience inputs; Review/Submit | Multi-step local draft. Validates PDF/JPEG/PNG and size, private upload then finalize credential, submit verification API. Failed upload/finalize remains retryable; Back/Skip cancel that step without submission. | `e2e/coach-credentials.spec.ts` upload/finalize, invalid/oversize, retry failures, authorization. |
| `/coaches/ai` | Back; Premium; prompt chips (data-defined); input/Send | AI message API; pending and subscription gating; success appends/refetches, error visible. | **Gap**. |
| `/coaches/conversation` | Back; pasted message; tone options (data-defined); Get Suggestions/Retry; repeated Copy | AI API; disabled empty/pending; retry repeats; copy writes clipboard/toast. | **Gap**. |
| `/coaches/profile-coach` | Back; profile text/input; Analyze; **Start over** | AI analysis API; pending/error; success result, start-over clears local analysis. | **Gap**. |
| `/coaches/safety-advice` | Back; accordion topics (data-defined); Safety Center | Accordion local single-open state; link→Safety. | **Gap**. |
| `/client-progress` | Back; Coaches links; repeated goal checkboxes | Local goal completion display/toggle over queried coaching plans; no persistence mutation visible for toggle. | **Gap**. |
| `/premium` | Back/Home; plan options (API-defined); Subscribe; Cancel subscription modal open/backdrop/Keep/Confirm | Plan selection local; subscribe API/provider handoff with loading/error/retry. Cancel modal closes on backdrop/Keep; confirm cancellation API updates subscription, pending locks action, error remains visible. | `e2e/launch-blockers.spec.ts` hosted checkout failure/retry/Stripe handoff. Cancellation: **gap**. |
| `/admin` | Main tabs (analytics, user reports, user verification, cultural facts, coach verification); status/search filters; per verification Approve/Reject + notes; per report Dismiss/Reviewed/Action + notes; cultural Add open/save/cancel, enabled toggle/delete; coach credential download, Approve/Reject, payout-ready toggle, audit expand | Role-gated generated admin APIs. Pending controls disabled; success invalidates/refetches; failures toast/inline. Downloads use authenticated admin stream URL. Add/cancel only mutate local form until Save. | `e2e/coach-credentials.spec.ts` normal user cannot call admin endpoints. Admin control execution: **gap**. |
| `/user-dashboard` | Matches/individual chat, Premium, Learn, Cultural, quick links (data-defined) | Navigation only; queried dashboard summaries. | **Gap**. |

## Native shared navigation and controls

| Component/surface | Visible control | Outcome and state behavior | Automated evidence |
|---|---|---|---|
| Expo bottom tab — Discover | localized Discover/planet | Selects `/(tabs)/discover`; native stack state is managed by Expo Router. | `native-regression.test.mjs` checks tab layout appearance, but tab selection/deep-route/root-retap/rapid-tap behavior is a **gap**. Unlike web `MobileNav`, source defines no explicit root-retap scroll reset. |
| Expo bottom tab — Matches | localized Matches/heart | Selects `/(tabs)/matches`. | Same gap. |
| Expo bottom tab — Messages | localized Messages/chatbubbles | Selects `/(tabs)/messages`. | Same gap. |
| Expo bottom tab — Coaches | localized Coaches/compass | Selects `/(tabs)/coaches`. | Same gap. |
| Expo bottom tab — Profile | localized Profile/person | Selects `/(tabs)/profile`. | Same gap. |
| `AuthenticatedProfileImage` / media image | image; on failure **Retry** | Validates URI schemes; private objects load with bearer auth. Failure announces unavailable state and Retry increments nonce/reloads. | `native-regression.test.mjs`: “message attachment images validate sources and expose truthful recovery.” |
| `ErrorFallback` | **View error details**, **Restart/Try again**; details modal close/back request | Opens diagnostic modal; close/backdrop dismisses; restart invokes recovery/reload. | `native-regression.test.mjs` locale-key/source checks; modal interaction itself: **gap**. |
| startup error in `_layout` | **Retry** | Re-runs auth/startup resolution; protected-route redirects to Welcome, Verify Email, Onboarding, or Discover; notification taps use allowlisted internal route with not-found fallback. | `native-regression.test.mjs`: startup recoverability and notification allowlist/deep links. |

## Native route inventory

### Authentication, onboarding, account, and settings

| Route/component | Visible controls | Outcome and loading/success/error/cancel behavior | Automated evidence |
|---|---|---|---|
| `/` | No direct control | Auth/layout redirect resolver. | Route/auth wiring in `native-regression.test.mjs`. |
| `/(auth)/welcome` | **Create account**, **Sign in**, public deletion-request link if rendered | Routes Register/Login/request flow. | Route presence/wiring contract; presses: **gap**. |
| `/(auth)/login` | Email/password; **Forgot password**, **Sign in**, **Register** | Login API; pending/error; success replaces root for protected routing. | Auth wiring contract; driven native UI: **gap**. |
| `/(auth)/register` | Back; locale choices (configured locales); Next; adult switch; name/email/password; Register; Terms/Privacy | Three-step local state, adult validation, register API→Verify Email; pending/error. Back decrements step or route. | `native-regression.test.mjs`: registration/legal/auth allowlist and locale completeness. |
| `/(auth)/forgot-password` | Back; email; Submit; success Back | API request; pending/error, success receipt; Back cancels route. | Route presence only: **gap**. |
| `/(auth)/reset-password` | New/confirm inputs; Reset; Back to Login | Token deep-link reset API; validates match/minimum 8, pending/error; success→Login. | `native-regression.test.mjs`: exact token/`newPassword` contract and deep links. |
| `/(auth)/verify-email` | Code; Verify; Resend; Log out | Verify→root resolver; resend disables for 60-second cooldown with live feedback; logout clears auth→Welcome. | `native-regression.test.mjs`: resend throttling and accessible feedback. |
| `/onboarding` | 14-stage Back/Next/Finish; same sets as web: gender 6, looking-for 4, goals 6, languages 22, countries 20, interests 30, cultural goals 6, relocation 3, long-distance 2; text fields; photo Upload/Retry | Local/account-scoped draft, adult and max-four-language validation; profile query/refetch, photo upload, profile update→Discover. Errors are alerts and retryable. | `native-regression.test.mjs`: validation, full 14 stages/sets, localization, recoverable photo state. |
| `/profile/edit` | Back; per photo Move earlier, Make primary, Delete, Move later (up to 6); Upload; name/bio/country/city; Save/Retry | Generated photo/profile APIs; sole photo cannot be deleted, edge reorder disabled; pending/error, success refetch/back. Picker cancellation leaves unchanged. | `native-regression.test.mjs`: all four photo operations, six-photo cap, sole-photo rule. |
| `/settings` | Back; locale options (configured locales); Retry; 4 switches: push, email, booking, read receipts; failed-save Retry; Notifications, coach Apply/Dashboard, conditional Admin, Privacy, Terms, Support/Safety, Logout, Delete Account | Locale persists/RTL updates. Preferences optimistically call API, revert on failure, retry exact failed payload; no local-storage fallback. Role routes. Logout confirmation/cancel is OS Alert; confirm clears auth. | `native-regression.test.mjs`: preferences, locale/RTL, legal/support/admin/coaching routing. |
| `/delete-account` | Back; password; **Delete account**; OS confirm/cancel | Confirmation then delete API; pending/error; success disconnects account and replaces Welcome. Cancel does not call API. | Route presence and RevenueCat disconnect source contract; full interaction: **gap**. |
| `/delete-account-request` | Back; email; Submit; success Back to Welcome | Public deletion request API; pending/error and non-enumerating success. | Route presence only: **gap**. |
| `/terms`, `/privacy` | accessible 44pt Back | Back; read-only scroll content. | `native-regression.test.mjs`: legal routes, links, scroll and target size. |
| `+not-found` | Home link | Routes `/`, then auth resolver. | Internal fallback contract; press: **gap**. |

### Native tabs, messaging, and discovery

| Route/component | Visible controls | Outcome and loading/success/error/cancel behavior | Automated evidence |
|---|---|---|---|
| `/(tabs)/discover` | Filters; pull-to-refresh; profile card; Pass/Super Like/Like; horizontal card pan; load Retry; filter modal Close/system back, Save, failed-save Retry; age inputs; gender 6, country 20, language 22, goals 6; global + 4 other switches | Swipe API and match alert→conversation; horizontal gesture threshold locks Y and ignores vertical swipes. Refresh resets index. Filter modal preserves dirty edits, APIs save, failure retains exact payload; close always escapes hung save. | `native-regression.test.mjs`: dirty-safe complete filters, retry, gestures, card tap, accessible actions, close semantics. |
| `/(tabs)/matches` | repeated match→conversation; pull-to-refresh; Retry | Query loading/error; Retry/refresh refetch; each returned match uses identical dynamic chat route. | `native-regression.test.mjs`: collection states and pull-to-refresh. |
| `/(tabs)/messages` | repeated conversation row; pull-to-refresh; Retry | Row→conversation; query loading/error/retry, 30s freshness polling. | `native-regression.test.mjs`: collection states/polling. |
| `/messages/:conversationId` | Back; pull-to-refresh; query Retry; failed message Retry/Discard; image attachment picker; text input keyboard submit; Send | Conversation/messages polling and mark-read once per successful load. Stable client request IDs avoid duplicate retry bubbles. Image uses presigned private upload. Picker cancel is no-op; send/upload errors retain retry/discard. | `native-regression.test.mjs`: stable retry IDs, authenticated media recovery, fetch/refresh/poll/mark-read. |
| `/(tabs)/profile` | query Retry; Edit Profile, Settings, Safety, Premium, Culture, Learning, coach Apply/Dashboard, conditional Admin, Logout | Navigation rows. Logout OS alert cancel/confirm; confirm disconnects identity and replaces Welcome. | `native-regression.test.mjs`: profile query/image states and role-gated entries. |
| `/notifications` | Back; Mark all; pull-to-refresh; load/mutation Retry; repeated notification row | Queries/polls 30s. Mark API tracks pending IDs; rows mark read then allowlisted route. Failure visible/retryable. | `native-regression.test.mjs`: collection states, pending IDs, routing allowlist. |

### Native coaching, premium, culture, and administration

| Route/component | Visible controls | Outcome and loading/success/error/cancel behavior | Automated evidence |
|---|---|---|---|
| `/(tabs)/coaches` | Workshops; pull-to-refresh; Retry; repeated coach row | Workshops route; coach row→dynamic detail; query loading/error/refetch. | `native-regression.test.mjs`: collection states and coaching reachability. |
| `/coaches/:id` | accessible Back; query/availability Retry; session type choices (configured); API-returned availability slots; Book | Select local session/slot; booking API. Pending/validation error; success confirmation/back; payment-not-configured is explicit rather than fake success. | `native-regression.test.mjs`: availability, booking, payment configuration, 44pt Back. |
| `/coaches/apply` | Back; query Retry; display name/bio/languages/specialties/rate; Save; Submit for review; Dashboard | Create profile and submit-verification APIs; status controls which action is shown; pending/error visible. | `native-regression.test.mjs`: application hooks/status and profile/settings reachability. |
| `/coaches/dashboard` | Back; Retry; bio/rate; Save Coach Profile; Choose credential; failed upload Retry | Update coach API. Credential picker/private upload/finalize; cancellation leaves prior state; pending/error and retry. | `native-regression.test.mjs`: update/save ID and full coaching reachability; private ArrayBuffer upload contract. |
| `/premium` | Back; load/sync Retry; store-defined package buttons; Restore Purchases; purchase confirmation modal Cancel/system back/Confirm | RevenueCat offerings are source of truth. Package labels/prices come from store. Confirm serializes purchase and server reconciliation; user cancellation is not mislabeled failure. Restore reports restored/nothing/error. Completed store purchase with failed server projection shows sync pending/error, not purchase failure. | `native-regression.test.mjs`: RevenueCat offering, entitlement, cancellation, restore, reconciliation, identity serialization, modal and localized states. |
| `/culture` | Back; Events; Tribes | Passport query display; links route to generated list flows. | `native-regression.test.mjs`: both route links. |
| `/events` | Back; pull-to-refresh/load Retry; repeated event card; per-event RSVP/Cancel; failed mutation Retry | Card→detail. Generated RSVP/cancel mutation, pending per item, cache invalidation; failed next state retained for Retry. | `native-regression.test.mjs`: real list/detail flow and retryable localized cancellation. |
| `/events/:id` | Back; load Retry/not-found Back; RSVP/Cancel; failed mutation Retry | Same generated mutation/cache behavior on detail, with live success feedback. | Same native event tests. |
| `/tribes` | Back; pull-to-refresh/load Retry; repeated tribe card | Card→detail; query loading/error/refetch. | `native-regression.test.mjs`: real list flow/RTL. |
| `/tribes/:id` | Back; load Retry/not-found Back; Join/Leave; mutation Retry | Generated membership APIs; pending, assertive error, exact toggle retry; list/detail cache invalidated. | `native-regression.test.mjs`: membership retry/invalidation and IDs. |
| `/workshops` | Back; pull-to-refresh/load Retry; repeated workshop card | Card→detail; query loading/error/refetch. | `native-regression.test.mjs`: real list flow/RTL. |
| `/workshops/:id` | Back; load Retry/not-found Back; Enroll/Enrolled; mutation Retry | Generated enrollment; pending, enrolled disabled, assertive retryable error; detail and list invalidated. | `native-regression.test.mjs`: enrollment retry/invalidation and IDs. |
| `/learning` | Back | Displays language streak/learning content; no additional route-local mutation. | `native-regression.test.mjs`: accessible full-size Back; other interaction not applicable. |
| `/safety` | Back; repeated Unblock | Unblock API; OS confirm/cancel before mutation; pending/error and cache invalidation. | `native-regression.test.mjs`: accessible Back; unblock interaction: **gap**. |
| `/admin` | Back/unauthorized Back; load/action Retry; pull-to-refresh; repeated verification Approve/Reject; repeated report Dismiss/Restrict | Server role gates queries. Generated review APIs; pending/error and query invalidation. Grouped repeated controls have identical behavior per returned item. | `native-regression.test.mjs`: server role, hooks, loading/error/refetch, all four test-ID families. |

## Cross-cutting control-category checklist

| Requested category | Inventory location |
|---|---|
| Buttons and links | Shared navigation plus every route table |
| Five-tab navigation | Five explicit web rows and five explicit native rows; web deep-route/root-retap/rapid-tap behavior is stated and tested; native gaps are explicit |
| Form submissions and text inputs | Auth/account, onboarding, messaging, profile, coaching, admin |
| Selectors, switches, sliders | Web Discover/Filters/Edit/Profile/Settings and both onboarding implementations; option counts stated |
| Modal open/close/confirm/cancel/backdrop | Report modal, message/group menus, profile logout/delete, premium cancellation/purchase, error details |
| Menu items | Header/sidebar, profile rows, conversation language/more/emoji menus |
| Pagination/carousels | Discover card index/swipes, cultural fact Next, quiz Next, message Load earlier; no conventional numbered pagination was found |
| Swipe/gesture actions | Web/native Discover; draggable web language control |
| Pull-to-refresh | Native Discover, Matches, Messages, conversation, Coaches, Notifications, Events, Tribes, Workshops, Admin |
| Retry controls | Explicit in route rows for query, filter, mutation, send, upload, startup, and media errors |
| Attachment/media controls | Web/native conversation image, web voice note/intro, profile/onboarding/verification/credential uploads |
| Auth/account actions | Login/register/reset/verify/logout/delete/request deletion |
| Admin/coaching/payment/premium | Dedicated web and native sections, including Stripe/provider handoff and RevenueCat cancellation/restore semantics |

## Known evidence limitations

1. Web Playwright directly drives a strong subset: authentication/onboarding, deletion, discovery/filtering, navigation, chat/media, coaching booking, credentials, notifications, events, and checkout. Many secondary navigation and local-only selectors remain explicit gaps.
2. Native evidence is static Node source/contract regression, not Detox/Appium device automation. It demonstrates current generated-hook wiring and required recovery/accessibility branches, but not physical gestures, OS dialogs, picker cancellation, tab stack semantics, or store purchase UI.
3. No dedicated offline queue exists except failed chat sends. Other offline conditions are represented by the same query/mutation error and Retry paths as network failures.
4. Repeated controls whose cardinality is server-driven (coaches, conversations, matches, events, slots, plans/packages, reports, verifications, credentials) are listed as API-defined rather than assigned a fabricated count.