# Privacy data map for release review

Validate this map against the production backend and vendor contracts before
submitting either store questionnaire.

| Data | Purpose | Linked to account | Sharing/processor review |
|---|---|---:|---|
| Name, email, age, gender | Account, eligibility, profile | Yes | Hosting/email providers: verify |
| Profile, interests, languages, location | Discovery and matching | Yes | Hosting provider: verify |
| Photos and message attachments | Profile and communication | Yes | Private object storage: verify |
| Messages and requested translations | Communication | Yes | Hosting/translation processors: verify |
| Coach credentials | Coach review | Yes | Private object storage: verify |
| Booking/payment metadata | Coaching transactions | Yes | Payment processor: verify |
| Subscription product, purchase, and entitlement status | Premium purchase, access, and restore | Pseudonymous purchase identity linked to account | Apple App Store and RevenueCat: verify |
| Push token and permission state | Notifications | Yes | Apple/Google push services: verify |
| Deletion-request email hash/status | Abuse-resistant request processing/audit | No plaintext email | Hosting provider: verify |

Deletion and retention statements must match the in-app privacy and deletion
screens, production database behavior, storage-provider backup policy, and
operational log policy.
