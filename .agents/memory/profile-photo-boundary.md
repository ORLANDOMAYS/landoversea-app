---
name: Profile photo boundary
description: Product and security rules for profile-photo visibility, image normalization, caching, and primary ordering.
---

Profile photos are visible to authenticated LandOverSEA members, but they are not public-web assets. Any authenticated object-serving response must prohibit shared caching even when its ACL permits all signed-in members. The selected primary photo is also the canonical first photo at position zero.

Client filenames and MIME metadata are hints, not proof of image type. Treat magic bytes as authoritative, and normalize valid HEIC/HEIF input to a broadly renderable canonical format on the server before object storage. Never make HEIC work by simply relabeling its bytes.

**Why:** A member-visible ACL can still leak through a shared cache if the response is marked public, and allowing primary status to disagree with list order makes key profile surfaces display the wrong image. Safari and Expo can also provide empty, generic, stale, or misleading MIME metadata for iPhone camera-roll assets; trusting or relabeling that metadata causes both false rejections and invalid stored media.

**How to apply:** Keep profile-photo objects behind authentication, send bearer credentials from native image renderers, use private/no-store caching on authenticated media routes, validate signatures before conversion/storage, return and render the persisted object URL, and preserve contiguous ordering with exactly one primary at position zero after every mutation.