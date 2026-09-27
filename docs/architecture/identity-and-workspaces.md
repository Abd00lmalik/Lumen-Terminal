# Identity & Workspaces (Phase F)

Status: implemented (backend + frontend), production verification pending Firebase setup.

## Ownership model

```
Firebase account (uid, verified email)
  └─ Workspace (1:1 with uid; path workspaces/{uid}/snapshot.json)
       ├─ Research / History (rs_*)
       ├─ Evidence / Claims / Judgments (ev_/cl_/jd_*)
       ├─ Saved artifacts + tombstones (sa_*)
       ├─ Theses + assessments (th_*)
       └─ (future) Challenge / Monitor state — same workspace ownership path
```

- Identity comes ONLY from a Firebase ID token verified server-side per request
  (`src/api/identity.ts`): signature against Google's public keys (`jose`), issuer
  `https://securetoken.google.com/{projectId}`, audience `{projectId}`, expiry, and
  `email_verified` for email sign-in. Client-supplied `userId`/email/workspace fields are
  ignored BY CONSTRUCTION (no route reads them).
- The workspace blob path is constructed ONLY by `workspaceBlobPath(uid)` from the
  VERIFIED uid — never from transport input. Id shape is validated (`[A-Za-z0-9_-]{1,128}`).
- One `ResearchApp` (one full engine graph) per workspace per warm instance, held by
  `WorkspaceSessions` (idle expiry 10min, hard ceiling 50). Two concurrent invocations on
  DIFFERENT VMs never share memory; the Phase E merge/conditional-write law makes their
  durable writes safe. Requests sharing one VM are serialized by the invocation.
- Adapter-side reads (LOCAL_KNOWLEDGE) resolve the request's workspace through
  `AsyncLocalStorage` (`requestWorkspaceStorage`), filled per request by `appForRequest`.
  There is NO global "current user" or "current workspace".

## API authorization model

- Every private API (`/api/research*`, `/api/saved*`, `/api/thesis*`, `/api/theses*`,
  `/api/evidence*`, `/api/claims`, `/api/hypotheses`, `/api/judgments`, `/api/memory`,
  `/api/artifacts`, `/api/monitors*`, `/api/workspace`, `/api/session`) requires a valid
  session. Missing/invalid → typed `401 UNAUTHORIZED` (auth hook in `server.ts`).
  There is NO fallback to a shared workspace.
- Cross-user access is an existence-hiding **404** (a guessed ref of another user is
  indistinguishable from an unknown ref) — enforced by workspace scoping: the app only
  ever sees its own graph.
- Storage/ops surface (`/api/storage/audit|diagnose|health|sessions|compact|backup*|
  legacy-*`) is ADMIN-gated (`ADMIN_EMAILS` allowlist, checked against the verified
  email). Non-admins get a 404 (route existence hidden).
- The cron entrypoint (`/api/cron`) is gated by `CRON_SECRET` (Bearer).

## Open mode (tests/local dev only)

When `FIREBASE_PROJECT_ID`/`FIREBASE_API_KEY` are absent, `buildApi` runs in explicit
OPEN mode: single workspace, no auth — exactly pre-Phase-F behavior. Production always
configures Firebase, so the gate is always on there. `/api/health` reports
`identity: { firebaseConfigured, authEnforced, openMode }` (presence booleans only).

## Legacy data

The pre-F shared workspace stays at `workspace/snapshot.json` as a WRITE-PROTECTED
quarantine (approved policy; `VercelBlobStore` `writeProtected` refuses every save).
Assignment to a designated owner is a one-time, token-gated WHOLE copy
(`POST /api/storage/legacy-assign`, runbook: authentication.md §legacy).

## Session lifecycle

- The SPA holds Firebase's session (in-memory + Firebase persistence); each API call
  fetches a fresh ID token (`getIdToken()` refreshes near expiry).
- Logout (`signOut`) stops token refresh; the next API call is 401 → the UI shows
  sign-in. Server-side, tokens are stateless JWTs (max 1h); there is no server session
  store to invalidate — revocation semantics follow Firebase (token expiry + checkRevoked
  is future hardening if needed).
- `401 UNAUTHORIZED` anywhere in the SPA → sign-in view (the guard renders it).

## Security invariants (checked by tests)

1. No session → 401 on every private route (never the shared workspace).
2. Invalid token → typed 401, never an opaque 500.
3. A's guessed refs/ids against B → 404, no existence leak.
4. Client identity fields (`userId`, `x-user-id`, query params) cannot redirect storage.
5. Concurrent users interleave without overwriting each other.
6. Each user's own flows (research → save → thesis → history) match pre-F behavior.
7. Storage tooling hidden from non-admins (404).
