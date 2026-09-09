# ShilpSarathi seller app: current engineering status

**Updated:** 7 September 2026  
**Scope:** Android-first seller application only

The repository now has production-oriented boundaries for authentication, seller profiles, private inventory, image upload validation, and AI-assisted image enhancement. Credential-free localhost mode does not accept fake OTPs or claim that unchanged images were AI-enhanced. Real OTP and listing generation require configured providers, and the API refuses to start in production with demo settings.

## Implemented

- Capacitor Android client with Firebase phone OTP integration.
- Firebase ID-token attachment on authenticated API calls.
- Server verification of token signature, issuer, audience, expiry, phone sign-in provider, disabled users, and revoked sessions.
- Server-derived seller identity. Client-supplied seller IDs are ignored.
- SQLite users and products tables with seller-scoped create, read, update, delete, share, and sync operations.
- Server-persisted seller name, trusted phone number, language, and consent metadata.
- JPEG, PNG, and WebP signature and dimension validation, decoded-size limits, and malformed-file rejection.
- Private media delivery through short-lived, seller-bound HMAC links. Direct upload-folder access is blocked.
- Gemini or OpenAI image enhancement from the server only, with conservative instructions to preserve the product and change only background/lighting.
- Safe original-image fallback when enhancement is unavailable; fallback is not represented as an enhanced result.
- Per-user AI request limiting, CORS allow-listing, safe public error responses, and a production release guard.
- Android backup disabled and cleartext network traffic disabled.

## Verified in this phase

| Check | Result |
|---|---|
| Backend unit and API integration tests | Pass: 11 of 11 |
| Firebase JWT verification test with local JWKS | Pass |
| Cross-seller inventory isolation | Pass |
| MIME spoof and image structure validation | Pass |
| Signed media and direct-upload blocking | Pass |
| Production web build | Pass |
| Capacitor Android asset/plugin sync | Pass |
| Production dependency audit | Pass: 0 known vulnerabilities |
| Release configuration guard | Pass: correctly blocks missing production secrets and legal/operator data |
| Native Gradle APK compilation | Not completed on this host because the Gradle distribution download endpoint timed out |

## Required operator configuration

These values cannot be fabricated in source control and must be supplied by the app owner:

1. Create the Firebase Android app for `in.shilpsarathi.app`, enable phone authentication and India in the SMS region policy, register release SHA-1/SHA-256 fingerprints, and place the downloaded `google-services.json` in `android/app/`.
2. Deploy the API at a real HTTPS origin with Application Default Credentials, `AUTH_MODE=firebase`, the Firebase project ID, revoked-token checking, a random media-signing key, and a strict CORS list.
3. Add one server-side Gemini or OpenAI key and set live AI mode. Never place this key in the Android application.
4. Complete the real business identity and qualified legal/content-rights review required by `npm run check:release`.
5. Configure release signing and run phone OTP, camera, poor-network, process-restart, and accessibility acceptance tests on physical Android devices before Play Store submission.

## Deployment boundary

SQLite plus local uploads is suitable only for a single API instance with encrypted persistent storage and backups. Before horizontal scaling or deploying to ephemeral instances, migrate inventory to a managed SQL database and media to private object storage. Live Firebase SMS and AI-provider calls cannot be truthfully integration-tested without the owner credentials and billable provider access.

See `BACKEND.md` for setup and endpoint details.
