# DEPLOYMENT.md — Lumen Terminal

Status: **the frontend deploys to Vercel as-is; the backend does not, and this document does not pretend otherwise.** Below is the honest assessment and the smallest change required for a real deployment.

---

## 1. What deploys cleanly today

**Frontend (React + Vite SPA)** — deploys to Vercel static hosting with zero changes:

| Setting | Value |
|---|---|
| Framework preset | Vite |
| Root directory | `frontend` |
| Build command | `npm run build` |
| Output directory | `frontend/dist` |
| Environment variables | none required (no secrets in the browser, by design) |

The SPA calls the backend through a single fetch boundary (`frontend/src/api/client.ts`). Point it at the deployed API via the client's base-URL configuration (defaults to the Vite dev proxy / `127.0.0.1:3001` in local development; set the production API origin for the deployed backend).

## 2. What does NOT deploy to Vercel today — and why

The backend is a **stateful, long-running Fastify server**. Three concrete incompatibilities with Vercel's serverless model:

1. **SSE + long-running requests.** A research run streams real progress over `POST /api/research?stream=1` for ~40–110 s (multi-round model calls + capability execution) and uses Fastify's `reply.hijack()` for raw streaming. Serverless functions impose per-request execution limits and are not designed for hijacked long-lived HTTP streams.
2. **Filesystem persistence.** `FileStore` persists the workspace to local disk (`.data/workspace.json`). Serverless filesystems are ephemeral — every cold start would resume from nothing (or from a stale bundled copy).
3. **Single-process state identity.** ID counters are restored from the loaded snapshot (restart-safe within one process, regression-tested), but two concurrent serverless instances would each mint ids independently and diverge — the workspace is single-writer by design.

## 3. Recommended deployment architecture (smallest change)

```
Browser ──► Vercel (static frontend)
                 │
                 ▼
     Long-running host: the EXISTING Fastify API, unchanged
     (Railway / Render / Fly.io / a small VPS)
                 │
                 ▼
     GEMINI_API_KEY + GEMINI_MODEL (server-side only)
     FileStore volume (persistent disk attached)
```

- **No code changes** to the research engine, LUI, adapters, API, or DTOs.
- Backend host must support: persistent Node.js process, port exposure, a writable volume for `WORKSPACE_FILE`, and unrestricted outbound HTTPS (Gemini + Bitget/Binance Vision/G2 sources).
- Set CORS to the frontend origin for production (dev CORS is localhost-only by configuration in `src/api/server.ts`).
- Secrets live only in the backend host's environment: `GEMINI_API_KEY`, `GEMINI_MODEL`, `API_PORT`, `WORKSPACE_FILE`. **Never** `NEXT_PUBLIC_*`/`VITE_*`-style exposure of credentials.

## 4. If Vercel must host everything (larger change, not recommended for this phase)

Would require, in order of smallest to largest:

1. Persistence → managed database (e.g. Postgres) behind the existing `WorkspaceStore` interface (the interface is already the seam; `FileStore`/`MemoryStore` prove the swap point).
2. SSE → client polling of a `GET /api/research/:ref` status endpoint (the DTO already carries lifecycle status), or an external streaming provider.
3. Single-writer discipline → id allocation moved into the database (sequences) or a single writer instance.

This is genuine engineering work and is intentionally **not** done in this phase; the current architecture is honest about being a single-trader workbench.

## 5. Runtime constraints worth knowing

- **Gemini free-tier quotas are per model per day.** Quota exhaustion surfaces as a typed `MODEL_FAILURE` (fail-fast; no long retry loops) — expect this on a public demo under load.
- **Upstream reachability varies by host.** Some networks block exchange API hosts (this was decisive in selecting the keyless Binance Vision mirror for G1). Verify outbound HTTPS to `generativelanguage.googleapis.com`, `api.bitget.com`, `data-api.binance.vision`, and G2 sources from the deployment host.
- **No background workers exist.** Monitoring is a confirmation-gated handoff; do not deploy this behind a load balancer that assumes horizontal scale-out of shared in-memory state.

## 6. Deployment checklist

- [ ] `npm test` green, `npx tsc --noEmit` clean, frontend build clean
- [ ] `.env` NOT committed; backend env vars set on the host
- [ ] Persistent volume mounted at `WORKSPACE_FILE` path
- [ ] CORS origin set to the deployed frontend
- [ ] `frontend` static deploy points at the backend origin
- [ ] Smoke test: submit a Flow 1 question, verify SSE progress + judgment render; submit a Flow 5 question, verify historical evidence appears
