# Account Deletion Reviewer Notes

This document maps LandOverSEA's account deletion implementation to app store requirements.

## 1. Google Play Requirements
**Requirement:** Apps that allow account creation must offer a way to request account and data deletion from within the app and via a public web link.
**Official URL:** https://support.google.com/googleplay/android-developer/answer/13327111

**Our Implementation:**
- **In-App:** Signed-in users can immediately delete their accounts via Profile > Settings (Profile component). This confirms identity with a password.
- **Web Link (Public):** The `/delete-account` surface is unauthenticated, accessible without signing in, clearly names LandOverSEA, and provides an email form to queue a deletion request securely without enumerating existing accounts.
- **Deletion Disclosure:** Password-confirmed deletion removes the account and linked identity, profile, photos, preferences, sessions, notification data, authored messages and linked translation/attachment metadata, coach credentials, bookings, and payment metadata through database cascades. Shared conversation containers and content authored by other participants may remain with deleted-user ownership detached where permitted.
- **Public Request Record:** The public request is distinct from immediate deletion. It retains only a keyed email hash and processing status for processing and audit, not the plaintext email, and makes no completion-time promise.
- **Private Objects and Provider Records:** Cleanup requests deletion of private objects. Provider backups and operational logs may remain under their own limited retention.

## 2. Apple App Store Requirements
**Requirement:** Apps that support account creation must let users initiate account deletion from within the app. 
**Official URL:** https://developer.apple.com/support/offering-account-deletion-in-your-app/

**Our Implementation:**
- **In-App Initiation:** The app includes a clear "Delete Account" button in the authenticated user's profile settings that performs a real-time account deletion.
- **Data Scope:** Account-linked records, including the deleting user's authored messages, credentials, bookings, and payment metadata, are removed by cascade. Only shared containers or content authored by other participants may remain, with ownership detached where the schema permits.

## 3. Code-Complete vs. Publishing Blockers
- **Code-Complete:** The frontend handles both authenticated immediate deletion (via `DELETE /api/auth/delete-account`) and unauthenticated public requests (via `POST /api/auth/account-deletion-requests`). The privacy policy and terms have been updated to truthfully describe data processing and retention limits.
- **Owner/Publishing Blockers:** 
  - Public requests still require manual processing and do not promise a completion timeframe.
  - Google Play Console requires the web deletion URL to be submitted in the Data safety form. The owner must populate the live URL (`https://landover-sea.com/delete-account`) in the Data safety section before publishing.
  - No automated face/liveness/KYC or native push/IAP claims are present in the legal text.

*Disclaimer: This document details technical compliance capabilities and does not constitute a legal guarantee.*
