---
name: Conversation attachment authorization
description: Security boundary for upload registration, access, reuse, and transcription of chat attachments.
---

Chat attachment authorization must bind the exact object path to the authenticated uploader, declared purpose, and destination conversation before registration. Registration is one-time: an existing ACL is never overwritten. Recipient access is derived from current conversation membership rather than copied user lists.

**Why:** Accepting a known object path and rewriting its ACL lets a participant take over another upload or disclose it into a different conversation. Read permission alone is also insufficient for sending or transcribing because one user can legitimately belong to multiple conversations.

**How to apply:** Use a short-lived server-signed upload claim issued only after participant verification. On registration, verify every claim dimension and reject already-bound objects. Sending and transcription must require both object read permission and an exact ACL rule for the route conversation.