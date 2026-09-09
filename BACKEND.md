# ShilpSarathi backend

The backend is a Node 22 service with Firebase ID-token verification, server-side seller profiles, seller-owned inventory, validated image uploads, expiring signed media links, AI processing, offline sync, and sharing APIs. SQLite runs with WAL and foreign-key enforcement and is suitable for a single-instance hackathon deployment when `backend/data` and `backend/uploads` are mounted on encrypted persistent storage.

## Start

For the evaluator demo on Windows, double-click `Start-ShilpSarathi.cmd`. It starts the app service and opens the correct browser URL. Keep the service window open during the demo.

Or start it manually:

```powershell
npm start
```

Open `http://localhost:8787` instead of opening `index.html` directly.

The default API modes are safe local placeholders. The seller UI does not accept demo OTP values, and AI listing generation is blocked unless live AI is configured. `ALLOW_DEMO_AI=true` exists only for automated tests and must not be used for evaluator or production claims. The server also refuses to start with demo authentication or demo AI when `NODE_ENV=production`.

## Production authentication

1. Create a Firebase project and Android app with package `in.shilpsarathi.app`.
2. Enable Phone authentication and allow the intended SMS region, including India.
3. Add the release SHA-1 and SHA-256 fingerprints in Firebase. SHA-256 enables Play Integrity; SHA-1 supports the reCAPTCHA fallback.
4. Download `google-services.json` into `android/app/google-services.json`. It is ignored by Git and must not be committed.
5. Deploy the API with Application Default Credentials that can read Firebase Authentication users, then set `AUTH_MODE=firebase`, `FIREBASE_PROJECT_ID`, and `FIREBASE_CHECK_REVOKED=true`.
6. Build Android with `VITE_AUTH_MODE=firebase` and the real HTTPS `VITE_API_ORIGIN`.

To test real OTP in a browser, also create a Firebase Web app, authorize the localhost/deployed domain, and set `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_APP_ID`. The browser flow uses invisible reCAPTCHA. Random six-digit values are never accepted by the application.

The Android client sends its short-lived Firebase ID token in the `Authorization: Bearer` header. The API verifies signature, issuer, audience, expiry, phone sign-in provider, disabled-user state, and token revocation. Seller IDs sent by clients are ignored.

## Enable image-aware AI

Copy `backend/.env.example` to `backend/.env`, set:

```text
AI_MODE=live
AI_PROVIDER=gemini
GEMINI_API_KEY=your_server_side_key
```

Create the key in Google AI Studio. Gemini supports image input for catalog generation and competitive price suggestions. Free quotas are limited. Demo fallback remains available for local judging, but a production server will not silently claim that demo processing is AI enhancement.

The same provider attempts a conservative studio edit that preserves the product and requests only background cleanup, lighting correction, and a neutral background. If editing is unavailable, the real original photo remains visible and is labelled as original; the UI does not fake an enhancement.

OpenAI remains an optional alternative: set `AI_PROVIDER=openai` and `OPENAI_API_KEY`.

Never put the API key in `app.js`, Android resources, or a mobile build. The service uses the key only on the server.

## Main endpoints

- `GET /api/health`
- `GET|PATCH /api/me`
- `POST /api/ai/enhance-image`
- `POST /api/ai/catalog`
- `POST /api/ai/price`
- `POST /api/listings/generate`
- `GET /api/products`
- `POST /api/products`
- `GET|PATCH|DELETE /api/products/:id`
- `POST /api/products/:id/share`
- `POST /api/sync`

Except for health and expiring signed media links, every endpoint requires a valid Firebase ID token in production. Inventory reads and writes are scoped to the authenticated Firebase UID. Images and audio are accepted as base64 data URLs. Images are checked against JPEG, PNG, or WebP file signatures, dimensions, pixel count, and a 12 MB decoded-size limit; audio has a 20 MB decoded-size limit. Media links expire and direct `/uploads` access is blocked.

Set a random `MEDIA_SIGNING_KEY` of at least 32 characters and configure the real `CORS_ALLOWED_ORIGINS`. Do not reuse an API key or Firebase credential as the media signing key.

Before scaling beyond one API instance, migrate SQLite to PostgreSQL and local uploads to private object storage. The current configuration requires one API instance with encrypted persistent volumes.

## Pricing inputs

The pricing endpoint accepts `title`, `description`, `materials`, `materialCost`, `laborHours`, `hourlyRate`, optional `marketSignals`, and an optional product image. Suggestions are estimates and remain editable by the seller.
