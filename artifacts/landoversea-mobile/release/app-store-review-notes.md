# App Store Review Notes Draft

This file prepares the App Review explanation for the first Replit-built iOS
candidate. It is not authorization to upload or submit the app. Do not paste
the notes into App Store Connect until every owner action below is complete and
the described flows have been verified on the exact signed build.

## Verified app identity

- The owner confirmed that the existing LandOverSEA App Store Connect record
  uses `com.base69d7f8da4081d841a49332c3.app`.
- This candidate targets marketing version `2.121943.2`, build `4`. It advances
  the previous Replit candidate (`3`); the highest previously confirmed upload
  on that record was `2`.

## Owner completion gates

- Configure the production API and Supabase environment, trusted authentication
  callback URLs, Apple signing/APNs, and an EAS project ID.
- Create the RevenueCat iOS app for the verified bundle identifier, connect the
  matching App Store products, and set the production iOS public SDK key.
  LandOverSEA currently has only RevenueCat Test Store products.
- Verify requested chat translation against the real provider on this build.
- Supply a stable, already verified reviewer account and review contact below.
- Verify every review path below on a physical iPhone. Remove any path that is
  not available in the uploaded build.

## Secure reviewer access

- Email: `OWNER_TO_SUPPLY_IN_APP_STORE_CONNECT`
- Password: `OWNER_TO_SUPPLY_IN_APP_STORE_CONNECT`
- Review contact: `OWNER_TO_SUPPLY_IN_APP_STORE_CONNECT`
- Special access instructions: `OWNER_TO_SUPPLY_IN_APP_STORE_CONNECT`

Do not commit real credentials to this file. Enter them only in App Store
Connect.

## Paste-ready app explanation

LandOverSEA is a purpose-built cross-cultural connection and learning app for
adults age 18 and over. Its primary experience is not a static content feed or
a generic social template. The app combines:

- a localized interface in 16 languages, including right-to-left Arabic;
- one-to-one messaging designed to retain the original message while allowing
  a participant to request a translation;
- a Culture Passport experience for country-focused cultural learning and
  progress;
- topic-based Tribes, cultural Events, and Workshops; and
- coach discovery and booking for cross-cultural guidance.

These connected workflows distinguish LandOverSEA from a simple dating,
messaging, event-listing, or course app. The app does not claim a particular
community size, translation success rate, or cultural outcome.

## Reviewer verification path

1. Sign in with the reviewer account above. The account should already have a
   verified email so review does not depend on receiving a new message.
2. Open Settings, choose another language, and confirm that navigation and
   screen content change. Select Arabic to verify right-to-left layout.
3. Open Culture to inspect the Culture Passport, then open Tribes, Events, and
   Workshops from the cultural community experience.
4. Open Discover to view member and coach discovery. Open a coach profile to
   inspect the booking flow. No completed booking or real payment is required.
5. Open Messages and a prepared reviewer conversation. Verify that original
   message text remains available and request a translation.
6. Open Premium to inspect the App Store subscription options and Restore
   Purchases action. TestFlight transactions must remain sandbox-only.
7. Open Settings and inspect account deletion. Deletion requires password
   confirmation and is intended to remove the account and linked app data.

## Conditional text to remove if not verified

- Remove the translation bullet and step 5 unless a real translation request
  succeeds on the exact uploaded build. Source code and mocks are not evidence
  that the provider is available.
- Remove Premium step 6 unless RevenueCat returns the current iOS offering and
  sandbox purchase and restore both work on the exact uploaded build.
- Remove any Culture, community, coach, or deletion path that is not usable
  with the supplied reviewer account and production data.

## Submission boundary

Uploading a build to TestFlight is not permission to submit it for App Store
review. The owner must approve the final metadata, privacy answers, reviewer
account, and review notes separately.