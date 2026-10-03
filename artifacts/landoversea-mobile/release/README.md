# Mobile release setup checklist

The confirmed production website and API origin is
`https://landover-sea.com`. Do not publish the deep-link association templates
in this directory until every remaining token below is replaced with verified
external input.

- [ ] Create/link the EAS project and set its real project ID.
- [x] Set production `EXPO_PUBLIC_DOMAIN` to `landover-sea.com`.
- [x] Pin the EAS production profile and pre-install validation hook to the
  canonical production host and make production iOS builds fail closed when
  `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` is absent. Development and preview builds
  continue to use RevenueCat Test Store.
- [x] Set production `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` through Replit configuration.
- [x] Use the owner-confirmed existing App Store Connect bundle identifier
  `com.base69d7f8da4081d841a49332c3.app`.
- [x] Set the candidate to marketing version `2.121943.2`, build `4`, above the
  previous Replit candidate (`3`) and highest previously confirmed upload (`2`)
  on that exact record.
- [ ] Supply Apple Team ID, App Store Connect app ID, signing, and APNs details.
- [ ] Create the RevenueCat iOS app for the verified bundle identifier, sync the
  App Store products, and configure the production iOS public SDK key. Current
  weekly, monthly, and annual products exist only in RevenueCat Test Store.
- [ ] Supply Android signing certificate fingerprints and FCM configuration.
- [ ] Replace every `REPLACE_WITH_*` token in store metadata and associations.
- [ ] Complete and validate `app-store-review-notes.md` on the signed candidate.
- [ ] Publish and verify support, privacy, and terms URLs.
- [ ] Configure universal/app links only after association files are deployed.
- [x] Run typecheck, native tests, Expo Doctor, config inspection, and an
  unsigned iOS export for version `2.121943.2`, build `4`. These checks do not
  prove Apple signing, upload, or TestFlight processing.
- [ ] Complete physical-device authentication, upload, notification, and deletion tests.

Required external URLs:

- Support: `REPLACE_WITH_HTTPS_SUPPORT_URL`
- Privacy: `REPLACE_WITH_HTTPS_PRIVACY_URL`
- Terms: `REPLACE_WITH_HTTPS_TERMS_URL`
