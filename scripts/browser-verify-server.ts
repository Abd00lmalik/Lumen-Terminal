/**
 * BROWSER-VERIFICATION SERVER (development harness only; never deployed).
 *
 * The routing defect under investigation lives entirely in the deterministic layer —
 * conversation routing, thread persistence, multi-instance merge — so verifying it through a
 * real browser does not require (and must not spend) live model quota. This boots the REAL
 * Fastify API, the REAL capability registry, the REAL file-backed store and the REAL merge
 * law, and substitutes ONLY the model transport with a deterministic scripted provider.
 *
 * The consequence is stated plainly: this harness proves the routing/persistence path, not
 * answer quality. Model-output behaviour is covered by the unit and live suites instead.
 *
 * It also serves the frontend through vite on the same origin so the browser drives the real
 * HTTP + SSE + persistence path rather than a mocked client.
 */
import { createServer } from "vite";
import { startApi } from "../src/api/server.js";
import { CapabilityRegistry } from "../src/adapters/capability-registry.js";
import type { ProviderAdapter } from "../src/adapters/provider.js";
import { createStore } from "../src/persistence/index.js";
import type { StructuredRequest } from "../src/model/provider.js";

const API_PORT = Number(process.env.VERIFY_API_PORT ?? 3001);
const WEB_PORT = Number(process.env.PREVIEW_PORT ?? 5173);

// A minimal market adapter so research has something real to retrieve through the registry.
const stubAdapter: ProviderAdapter = {
  providerId: "browser-verify/stub",
  capabilities: ["CRYPTO_MARKET_DATA", "FALSIFICATION", "NEWS", "ONCHAIN"],
  limitations: ["deterministic browser-verification stub; not a live market feed"],
  freshnessProfile: "test:live",
  async execute(capability: string) {
    return {
      tool: "browser-verify",
      capability,
      transport: "https",
      outputs: [{
        outputClass: "QUANTITATIVE_OBSERVATION",
        content: JSON.stringify({
          symbol: "BTC",
          price: 84821,
          observed_at: new Date().toISOString(),
          note: `deterministic observation for ${capability}`,
        }),
        about: "BTC",
      }],
    };
  },
};

function scripted(schemaName: string, question: string): string {
  switch (schemaName) {
    case "lui.normalized_request":
      return JSON.stringify({ primaryAction: "RESEARCH", compoundActions: [], objective: question, isExplanationOnly: false, disclosureLevel: 0 });
    case "lui.resolved_target":
      return JSON.stringify({ asset: "BTC", flow: "WHY_IT_HAPPENED", objectRefs: [], unresolved: [] });
    case "lui.ambiguity":
      return JSON.stringify({ isAmbiguous: false, questions: [], reason: "clear" });
    case "lui.consequence":
      return JSON.stringify({ level: "INFORMATIONAL", rationale: "read-only", requiresConfirmation: false });
    case "safety.screen":
      return JSON.stringify({ isExecutionCommand: false, detectedViolations: [], rationale: "research question" });
    case "lui.action_plan":
      return JSON.stringify({
        steps: [{ action: "RESEARCH", description: question, capabilities: ["CRYPTO_MARKET_DATA"], params: { objective: question, question } }],
        requiresConfirmationFor: [],
      });
    case "research.plan":
      return JSON.stringify({
        objective: question,
        scopeIncluded: ["market"],
        scopeExcluded: [],
        tasks: [{ type: "FACT_FINDING", objective: question, capabilities: ["CRYPTO_MARKET_DATA"], completion: "observations" }],
        requirements: [],
        completionCriteria: ["observations"],
        adaptationPolicy: "stop when covered",
      });
    case "research.adaptive_decision":
      return JSON.stringify({ decision: "COMPLETE", rationale: "observations collected", nextTasks: [] });
    case "research.answer_synthesis":
      return JSON.stringify({
        directAnswer: `Findings for: ${question}`,
        keyFactors: [{
          factor: "liquidity", mechanism: "observed", direction: "current",
          evidenceRefs: [], counterevidenceRefs: [],
          evidenceQuality: "DIRECT_EVIDENCE", evidenceDirectness: "DIRECT",
        }],
        whatWouldChangeTheView: [], implication: "", uncertainty: [],
        confidence: "MODERATE", citedObjectRefs: [],
      });
    default:
      return JSON.stringify({});
  }
}

const provider = {
  providerId: "browser-verify/scripted",
  modelId: "scripted-1",
  async structured<T>(request: StructuredRequest) {
    const raw = scripted(request.schemaName, request.userText ?? "");
    return { data: JSON.parse(raw) as T, raw, schemaName: request.schemaName, modelId: "scripted-1" };
  },
};

const registry = new CapabilityRegistry();
registry.register(stubAdapter);

// A FILE-backed store: the durable persistence path, not an in-memory stand-in.
const store = createStore("file", process.env.WORKSPACE_FILE ?? ".data/browser-verify-workspace.json");

await startApi({ provider, registry, store, port: API_PORT, host: "127.0.0.1" });

const vite = await createServer({
  configFile: "frontend/vite.config.ts",
  root: "frontend",
  server: { host: "0.0.0.0", port: WEB_PORT, strictPort: true },
});
await vite.listen();
vite.printUrls();
console.log(`[browser-verify] api=${API_PORT} web=${WEB_PORT}`);
