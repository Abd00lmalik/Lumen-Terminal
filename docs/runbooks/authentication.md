# Authentication Runbook (Phase F)

Status: ACTIVE IN PRODUCTION (Phase F.1, 2026-09-28): Firebase env live, real two-account
email-link sign-in verified through the browser UI, admin gates and workspace isolation
verified live. NEVER paste secrets into chat, commits, or issues; all values go through
`npx vercel env add` or the Vercel dashboard.

## 1. What runs where

- **SPA** (`frontend/`): Firebase JS SDK — Google popup sign-in + email-link (passwordless)
  sign-in; session restore; fresh ID token attached to every API request
  (`frontend/src/auth.tsx`, `frontend/src/api/client.ts`).
- **API** (`src/api/identity.ts`): verifies each request's ID token against Google's public
  keys. NO service-account secret is needed for verification.

## 2. One-time Firebase setup (operator)

1. Create a project at https://console.firebase.google.com (or reuse an existing one).
2. **Authentication → Sign-in method**: enable **Google** and **Email link
   (passwordless)**. For Email link, the "Email link" toggle under Email/Password is what
   must be ON; Firebase sends the verification links (no SMTP config needed).
3. **Authentication → Settings → Authorized domains**: add your production domain
   (`asklumen.vercel.app`, plus any custom domain).
4. **Project settings → General → Your apps → Web app**: create one and copy the config
   values (these are PUBLIC identifiers by design, not secrets).

## 3. Environment variables

Frontend (build-time, Vercel project env — visible in the bundle by design):

| Variable | Value |
|---|---|
| `VITE_FIREBASE_API_KEY` | Web app API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | `<project>.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `<project-id>` |
| `VITE_FIREBASE_APP_ID` | Web app app id |

Backend (runtime, server-side only):

| Variable | Value |
|---|---|
| `FIREBASE_PROJECT_ID` | Same project id (token `aud`/`iss` checks) |
| `FIREBASE_API_KEY` | Same API key (used only to decide auth-enabled; never returned) |
| `ADMIN_EMAILS` | Comma-separated operator emails (storage/ops surface gate) |
| `CRON_SECRET` | Random string; Vercel Cron sends it as `Authorization: Bearer` |

Set with `npx vercel env add <NAME>` (select Production), then REDEPLOY — env changes do
not reach already-running functions.

## 4. Activation checklist (production)

1. Set all env vars above; redeploy (`npx vercel --prod --yes`).
2. `GET /api/health` → `identity.firebaseConfigured: true`, `authEnforced: true`,
   `openMode: false`.
3. Browser: opening `/history` signed-out shows the sign-in view (NOT the old shared
   history). ✅ verified live 2026-09-28.
4. Google sign-in → account indicator appears in the topbar; History is empty (new
   workspace) — the legacy quarantine is NOT visible (policy). (Email-link path is the
   one production-verified below; Google popup not exercised in F.1.)
5. Email-link sign-in → the link arrives, opens the app, session established, email
   verified by construction. ✅ verified live 2026-09-28 (see §4.1).

### 4.1 Phase F.1 activation result (2026-09-28)

- Health: `firebaseConfigured:true, authEnforced:true, openMode:false`.
- **Found + fixed during activation (production-only failures, mocked tests stayed green):**
  1. **JWKS endpoint:** verification fetched the x509 cert **map**
     (`…/metadata/x509/securetoken@system.gserviceaccount.com`) instead of a JWK Set —
     every real token 401'd. Fixed to `https://www.googleapis.com/service_accounts/v1/jwk/
     securetoken@system.gserviceaccount.com` (`src/api/identity.ts`, `REMOTE_JWKS_URL`,
     keys test-seam; regression tests `tests/api/identity-jwks.test.ts`).
  2. **Email-link completion:** Firebase's hosted action handler forwards to the continue
     URL **without `mode=signIn`**, so `isSignInWithEmailLink()` returned false and
     completion silently no-oped. Fixed `frontend/src/auth.tsx` `completeEmailSignIn()`:
     detect `oobCode` OR `isSignInWithEmailLink()`, clean `#/signin` from the URL on
     success, and surface completion errors as typed UI errors (quota-exceeded is how
     Firebase's daily email limit actually renders).
  3. **`/api/health` exemption:** the global onRequest 401 hook blocked the health probe;
     explicit exemption for exactly `/api/health` (path before `?`), all other routes
     still gated.
- Verified live (real Chrome profiles, real emails, real tokens): admin + one non-admin
  account completed sign-in through the actual UI flow; fresh workspaces start EMPTY (no
  legacy inheritance); all 7 `/api/storage/*` endpoints return 404 for non-admins;
  non-admin sees only their own records. Full run: `.data/phase-f1-acceptance/`.
- Known limitation: Firebase **daily email-quota protection** blocks further sign-in-link
  sends per project/day (rendered as `auth/quota-exceeded` in the UI). Wait for the quota
  window or use Google sign-in.
- Quota-exceeded surfaced to users (F.1 mitigation): the sign-in UI maps Firebase auth
  errors to human-readable text (`describeAuthError` in `frontend/src/auth.tsx`) —
  quota-exceeded explains the project-level limit and the Google alternative; unknown
  errors still surface verbatim. Operator levers: wait for the daily window, use Google
  sign-in, or raise the quota in Google Cloud IAM → Firebase Auth quota (paid tier).

## 5. Legacy workspace assignment (explicit operator act)

The pre-F shared workspace is quarantined (write-protected). To give it to ONE designated
account (a whole-copy — history is never filtered or rewritten):

1. Generate a one-time token locally: `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`.
2. Inventory first (read-only): `GET /api/storage/legacy-inventory` (admin) — record the
   `sha256` and counts.
3. Assign: `POST /api/storage/legacy-assign` (admin) with
   `{"approvalToken":"<token>","targetUid":"<firebase-uid>"}`.
   Order enforced server-side: recovery-point copy → target copy → byte verification →
   auditable marker (token stored ONLY as a SHA-256 fingerprint). One-time: a second call
   is refused while the marker exists.
4. The designated user sees the full legacy history in their workspace on next sign-in.

## 6. Failure modes

| Symptom | Meaning | Fix |
|---|---|---|
| `401 UNAUTHORIZED` on every call, `openMode: false` | Token missing/expired/invalid | Sign in again; check clock skew; check Firebase domain allowlist |
| `openMode: true` in production | Firebase env missing on the deployment | Set `FIREBASE_*` env + redeploy |
| Google popup closes instantly | Domain not authorized | Firebase console → Authorized domains |
| Email link signs in a different browser | Link + email context must match; Firebase handles cross-device via same browser profile | Follow Firebase's email-link guidance; request a new link |
| `PER_USER_PERSISTENCE_REQUIRES_BLOB` style 500 | Auth on but `BLOB_READ_WRITE_TOKEN` absent | Enable Vercel Blob for the project (per-user workspaces are Blob-backed by design) |

## 7. What this design deliberately does NOT do

- No passwords (email-link only) — nothing to hash/leak.
- No account merging of Google + email with the same address UNLESS Firebase's own
  `linkWithCredential` flow is used later (documented future hardening; today the two
  sign-in methods create separate identities, exactly as the brief requires).
- No public diagnostics: all storage/ops endpoints are admin-gated.
- No tokens in localStorage (Firebase manages its own persistence; our client code never
  touches tokens), no tokens in logs (identity errors never include token contents).
