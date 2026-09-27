# Phase F Read-Only Audit (2026-09-27)

Written BEFORE any implementation change. Every claim below was verified against the
current code/production, not assumed. Sources: source reading, production probes,
`/api/storage/audit`, blob `head()`, `docs/runbooks/*.md`, `handoff.md`.

## 1. Current identity model

**None.** There is no authentication, no session, no user identity anywhere:

- `grep userId|user_id|ownerId` across `src/domain`, `src/api` → zero hits.
- `src/api/server.ts`: "No global auth: single local trader identity for the hackathon
  MVP … auth is a future migration step" (explicitly deferred until now).
- Every request derives the SAME server-side origin: `TRADER_ORIGIN`
  (`src/api/research-app.ts`: `{ kind: "trader", detail: "F0 API session (local trader identity)" }`).
- `POST /api/session` returns a hard-coded `workspaceRef: "local"` stub.

## 2. How requests identify the active user

They don't. Every route handler is unauthenticated; the frontend ships no token; CORS is
localhost-dev-only but the API itself checks nothing.

## 3. Persisted objects and their relationship to the workspace

ONE global graph, `src/domain/workspace.ts` `WorkspaceSnapshot`:

| Collection | Ref prefix | Notes |
|---|---|---|
| researches | `rs_` | run identity + provenance; run-group via `runId` |
| sources | `src_` | currently 0 in production |
| evidence | `ev_` | 5,145 objects, 12.4MB — the size driver |
| claims / hypotheses / analyses / branches | — | small |
| judgments | `jd_` | append-only per research |
| theses | `th_` | trader-owned lifecycle |
| savedArtifacts + savedTombstones | `sa_` | tombstones make unsave win merges |
| memories / monitors / thesisAssessments | `mem_`/`mon_` | handoff state |
| researchResponses | (by researchId) | one slim run record per completed run (v2/v1 mix) |
| activeThesisId | — | trader selection working-state |
| id counters | — | NOT persisted as state; re-derived in `Workspace.fromSnapshot` via `restoreIdCountersFrom` (monotonic per prefix; tombstone-aware via `bumpIdCounterPastId`) |

Implication: ownership is a WORKSPACE-level property. Every object belongs to exactly one
workspace; scoping at workspace granularity covers every collection at once. No object
carries any user reference today.

## 4. Current shared-workspace data flow

1. Cold start: `createProductionStore()` picks `VercelBlobStore` (Blob token present) →
   `ResearchApp.create()` loads THE one snapshot into a per-instance `Workspace`.
2. Warm instance: serves reads from memory (TTL 3s re-read on some paths; Saved/Thesis
   reads use `loadFresh()`).
3. Writes: engine/LUI mutates the in-memory graph → `store.save(snapshot)` =
   merge-before-conditional-write (Phase E law) against `workspace/snapshot.json`.
4. Frontend: hash-routed SPA calls `/api/*` directly; no credentials anywhere.

## 5. Blob snapshot format & write/merge law (unchanged by Phase F, protected)

- One object `workspace/snapshot.json`, public store, 16,535,929 bytes (~16.5MB) at audit time.
- Write law (Phase E, MUST SURVIVE): a save may only replace content it actually read —
  origin reads (`useCache:false` + cache-bust), bounded I/O (20s), merge union by id with
  more-provenance-wins, strong-ETag conditional writes (`head()`), `BlobReadUnavailableError`
  on thrown/truncated/blank/unparseable reads, no blind writes ever.
- Per-object merge: union by id, researchResponses union by researchId, tombstone-wins,
  activeThesisId kept only if it exists in the union.

## 6. Existing persistence failure protections (keep all)

Honest abort on untrusted reads; conditional writes with re-merge on conflict; bounded
retries; no empty-graph invention on load; no eviction/deletion; tombstones; counter
continuity; compaction is reference-based and guarded by byte-match rehydration.

## 7. Current blob size & record composition (measured)

- 16.54MB snapshot; 248 researches; 5,145 evidence (12.4MB); 104 judgments; 102 run
  records (56 v2 + 46 v1-by-design; 0 further normalizable — verified idempotent);
  9 theses; 0 live saved artifacts; 15 tombstones; largest record rs_000090 (855KB).
- Read path cost: every cold start downloads the WHOLE 16.5MB; every save re-reads +
  re-writes the whole thing. Single-user today; multi-user amplifies both per user count.

## 8. Vercel-compatible authentication options (checked, not assumed)

- **Firebase Auth** (chosen): Google OAuth + Email-link (passwordless, email-verified by
  construction) in one provider; `firebase` JS SDK on the SPA; server verification by
  fetching Google's public X.509/JWKS keys and verifying the ID token (RS256, `aud`,
  `iss`, `exp`, `email_verified`) — no service account secret needed on the server for
  verification; works on plain Fastify/Vercel functions (no Next.js requirement);
  generous free tier (50k MAU); account linking only via Firebase's own
  `linkWithCredential` flow (never silent merges; `auth/account-exists-with-different-
  credential` handled explicitly).
- Rejected for this stack: Clerk/Auth.js (Next.js-centric), Auth0/WorkOS (pricing/tier
  orientation), Stytch/Magic (fine but two vendors for what one does), Cognito (heavier
  setup), SuperTokens (self-host burden).
- Secrets: only the Firebase WEB config is client-visible by design (it is a public
  identifier, not a credential); server verification needs NO secret. Nothing to leak.

## 9. Vercel-compatible backup options (checked)

- **Cloudflare R2** (chosen): S3-compatible API (aws4fetch, no SDK bloat), **zero
  egress fees**, separate failure domain from Vercel Blob (different company/region
  plane), AES-256 at rest + TLS in transit, versioning + lifecycle support, ~$0 at this
  scale (10GB free tier).
- Rejected: same-store copies (NOT offsite — same failure domain), AWS S3/GCS (egress
  cost + heavier creds), Azure (same), Backblaze/Wasabi (fine but no advantage over R2
  here).

## 10. Security risks introduced by multi-user support

1. Cross-user data leakage via shared snapshot (the core risk Phase F removes).
2. IDOR: every `/api/research/:ref` / `/api/saved/:id` / `/api/thesis/:ref` is
   guessable-by-sequence (`rs_000123`) — with per-user workspaces, a guessed ref must
   404 (not 403) so existence is never revealed.
3. Session forgery: solved by server-side ID-token verification against Google's public
   keys, per-request, stateless.
4. Client-supplied identity (`userId` in body/query) must be ignored BY CONSTRUCTION —
   identity comes only from the verified token.
5. Sensitive logs: error paths already key-free; keep tokens/emails out of logs.
6. Storage-key manipulation: per-user blob paths must be derived from the VERIFIED uid,
   never from any client input (`workspaces/{uid}/snapshot.json` with uid from token).
7. Public diagnostics: `/api/storage/audit|diagnose|compact` currently unauthenticated —
   must become admin-only or removed from public access.

## 11. Migration risks & decisions requiring approval

- Historical records have ZERO owner metadata; ownership cannot be inferred (brief
  forbids heuristics). → Quarantine policy proposed (§4 of the plan doc).
- Blob path change means every new user starts an EMPTY workspace; the legacy workspace
  stays untouched at its current path as an explicit quarantine.
- Snapshot schema needs a version marker for future migrations (additive, optional on
  read).
- Compaction of the 46 v1 stragglers requires per-record inspection; only
  fidelity-preserving transforms allowed; some may be structurally unsafe → report.
- Watchdog on Vercel requires Vercel Cron (vercel.json) — must verify platform support
  for this project's plan; fallback: external scheduler documented in the runbook.
- The Phase E smoke suite assumes an open API; it must become auth-aware (two test
  accounts) or it will fail after the auth gate lands.

## 12. Persistence invariant (carried forward unchanged)

**A save may only replace content it actually read.** Any failed, blank, truncated,
unparseable, stale, or otherwise untrusted read must not authorize an overwrite. Origin
reads, strong-ETag conditional writes, bounded I/O, honest typed failures: all preserved
per workspace object under the new layout.
