/**
 * F0 API CLI entrypoint — `npm run api` (dev: tsx) or compiled `node dist/api/main.js`.
 *
 * Wiring only: env-configured Gemini provider (server-side; the key never crosses the API
 * surface), the real Bitget adapter set behind the capability registry, and the file-backed
 * workspace store. No research logic here — the LUI/engine own everything.
 */

import { startApi } from "./server.js";
import { GeminiProvider } from "../model/gemini.js";
import { createBitgetAdapterSet } from "../adapters/bitget-skills.js";
import { createStore } from "../persistence/index.js";

const provider = new GeminiProvider(); // env-only: GEMINI_API_KEY + GEMINI_MODEL
const { registry } = createBitgetAdapterSet();
const store = createStore("file", process.env.WORKSPACE_FILE ?? ".data/workspace.json");

await startApi({ provider, registry, store });
