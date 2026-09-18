# Deployment

Status: **the full application deploys to Vercel**; frontend (static SPA) and backend
(serverless API functions) on one domain. This document describes the deployed
architecture honestly, including its real limitations.

Production URL: **https://asklumen.vercel.app/** (Vercel project: **lumen**, auto-deployed from `main` on GitHub)

---

## 1. Production architecture (deployed)

```mermaid
flowchart TD
    U[Trader browser] -->|https://asklumen.vercel.app| V["Vercel edge"]
    V -->|static assets| SPA["React SPA (frontend/dist)"]
    V -->|"/api/*"| F["Vercel Function (Node.js, 300s, streaming)"]
    F --> FAST["Fastify app; buildApi() (same app as `npm run api`)"]
    FAST --> LUI["LUI → Research Engine → Capability Registry"]
    LUI --> BIT["Bitget adapters (primary)"]
    LUI --> FB["Fallback providers (news RSS / Fear&Greed / World Bank)"]
    LUI --> G1["G1 historical (Bitget → Binance Vision)"]
    LUI --> G2["G2 bounded web retrieval"]
    LUI --> GEM["Gemini provider (server-side key)"]
    FAST --> MEM["MemoryStore (ephemeral per warm instance)"]
```

Key properties:

- **One application, two hosts.** `api/research.ts` is a ~40-line adapter that hosts the
  SAME Fastify app built by `buildApi()` (`src/api/server.ts`) inside Vercel's Node.js
  runtime via `app.routing()`. No research logic exists in the function file; there is no
  second backend.
- **Same-origin API.** The SPA calls relative `/api/...` in production
  (`resolveBaseUrl` returns `""` when `PROD`), so there is no cross-origin deployment and
  no CORS dependency in production. `VITE_API_URL` may still override the target
  (e.g. a locally running Fastify server during frontend development).
- **SSE streaming.** Research progress streams through the function's raw response —
  Vercel's Node.js runtime supports streaming responses. Function duration is configured
  to 300 s (`vercel.json`), comfortably above observed end-to-end research runs
  (~40–160 s live).

## 2. Configuration (Vercel project settings → Environment Variables)

| Variable | Scope | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | production, preview | Gemini model access; **server-side only; never exposed to the browser** |
| `GEMINI_MODEL` | production, preview | Model override (free-tier-reliable Flash-class default) |
| `GROQ_API_KEY` | production, preview | Optional second model (typed fallback when Gemini fails technically: quota/outage/timeout). OpenAI-compatible; free tier |
| `GROQ_MODEL` | optional | Groq model override (`llama-3.3-70b-versatile` default) |
| `HEURIST_API_KEY` | production, preview | Optional Heurist Mesh agent/data-provider fallbacks (options chains, funding/OI, SEC filings, FRED macro). See `docs/integrations/heurist.md` |
| `WORKSPACE_FILE` | optional | Opt in to a `FileStore` at an explicit path. **Do not set it to a normal serverless disk path** (see §3) |

There are no `VITE_*` secrets and no credentials in the frontend bundle; the secret scan
(`grep` over `frontend/src` and the build output) is part of the release checklist.

## 3. Persistence; honest limits

The default production store is **in-memory** (`createProductionStore` in
`api/research.ts`): serverless local disks are ephemeral, so workspace state survives
across requests on a warm function instance and is lost on cold start. The UI never
claims durable persistence, and the health endpoint does not advertise any.

- **Local development** uses the real `FileStore` (`.data/workspace.json`); state
  survives restarts and restart-ID-collisions are handled (ID counters are re-seeded
  from the restored workspace).
- **Production (current)** is per-instance memory. Acceptable for a demo workload;
  runs are visible while the instance is warm.
- **Production (durable, when needed):** the `WorkspaceStore` interface is two methods
  (`save`/`load`), so the smallest real upgrade is a hosted key-value store (e.g. Vercel
  Blob / Upstash Redis) behind the same interface; a contained change in
  `src/persistence/`, no engine changes. This is deliberately NOT faked in the current
  deployment.

## 4. Local development

```bash
npm install            # backend deps
cd frontend && npm ci  # frontend deps
npm run api            # Fastify on :3001 (FileStore persistence)
cd frontend && npm run dev   # Vite on :5173 (proxies to localhost:3001 by default)
```

## 5. Deploying

```bash
npx vercel --prod --yes     # builds the SPA + API functions, promotes to production
```

The custom domain `asklumen.vercel.app` is attached to the `lumen` Vercel project and follows each production deployment from `main`.
Note: a manual `vercel alias set` does NOT follow future deployments automatically —
re-run it after a deployment if the domain drifts, or manage the domain in the project
settings so it always tracks production.

## 6. Known deployment limitations

1. **Ephemeral workspace state** (§3); by design, documented, not silently faked.
2. **300 s function ceiling**; research runs observed so far peak well below it; a
   pathologically slow provider could still hit it (the run would surface as an honest
   transport failure, never fabricated success).
3. **No background monitoring**; monitoring remains a persistent handoff record; the
   serverless model has no worker, and the product does not pretend to run one.

### Credential injection diagnostics

`/api/health` exposes `credentials.geminiKeyDefined` / `credentials.geminiKeyNonEmpty`
(presence booleans only, never values). If research returns MODEL_FAILURE (AUTH_FAILURE)
while the dashboard shows the variables configured, check these booleans first: a
deployment built before the variable had a value, or an empty value, produces exactly
this signature. Re-saving the variable and pushing a new deployment resolves it.
