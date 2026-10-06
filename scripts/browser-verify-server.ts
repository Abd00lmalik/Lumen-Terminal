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
// It returns SEVERAL dated price prints plus one reported headline, because the flow under test
// is exactly the DIRECT_OBSERVATION vs REPORTED_CLAIM split: a factual timeline must be built
// from the prints, and the headline must be labelled a claim rather than an observation.
const stubAdapter: ProviderAdapter = {
  providerId: "browser-verify/stub",
  capabilities: ["CRYPTO_MARKET_DATA", "FALSIFICATION", "NEWS", "ONCHAIN"],
  limitations: ["deterministic browser-verification stub; not a live market feed"],
  freshnessProfile: "test:live",
  async execute(capability: string, params: Record<string, unknown> = {}) {
    const prices = [84821, 85340, 84990];
    // SHAPE-AWARE STUB, mirroring what the real chain now does: a request for a windowed
    // series is served candles, and anything else is served the aggregate spot snapshot a
    // CoinGecko /simple/price fallback returns. Declaring the shapes explicitly is what lets
    // the field-coverage scenario prove that a snapshot resolves only the shape it carries.
    const demanded = Array.isArray(params.requiredFacets) ? (params.requiredFacets as string[]) : [];
    const wantsSeries = demanded.some((f) => ["SERIES", "OHLC", "HIGH", "LOW", "OPEN", "CLOSE", "VOLUME"].includes(f));
    // THE PRODUCTION CONDITION, REPRODUCED. The live failure happened when the primary
    // exchange path was down and the keyless CoinGecko fallback was all that answered. Scenario
    // G asks for the enumerated 24-hour field list, so this feed serves ONLY the fallback
    // snapshot for it — which is what makes the scenario a reproduction rather than a demo of
    // the happy path. Every other scenario keeps the candle path.
    const fallbackOnly = /\bprice path\b|\b(?:high|low|opening|closing)\b[^.?!]{0,60}\bprice\b/i.test(
      String(params.question ?? params.objective ?? ""),
    );
    if (capability !== "CRYPTO_MARKET_DATA" || fallbackOnly || !wantsSeries) {
      return {
        tool: "browser-verify",
        capability,
        transport: "https",
        outputs: [
          {
            outputClass: "QUANTITATIVE_OBSERVATION" as const,
            dataFacets: ["SNAPSHOT", "CLOSE", "AGGREGATE_VOLUME", "TIMESTAMP"] as const,
            coverageHours: 0,
            content: {
              coin: "bitcoin",
              priceUsd: 85335,
              change24hPct: 0.002039,
              marketCapUsd: 1_700_000_000_000,
              volume24hUsd: 31_200_000_000,
              asOf: new Date().toISOString(),
              source: "browser-verify spot snapshot",
            },
            about: "BTC",
          },
          {
            outputClass: "FACTUAL_OBSERVATION" as const,
            dataFacets: ["REPORTED_EVENT"] as const,
            content: "Reported headline: spot bitcoin ETF inflows resume as sentiment improves",
            about: "BTC",
          },
        ],
      };
    }
    const now = Date.now();
    return {
      tool: "browser-verify",
      capability,
      transport: "https",
      outputs: [
        {
          outputClass: "QUANTITATIVE_OBSERVATION" as const,
          dataFacets: ["SERIES", "OHLC", "HIGH", "LOW", "OPEN", "CLOSE", "VOLUME", "TIMESTAMP"] as const,
          coverageHours: 24,
          timeframe: "1h",
          content: prices.map((price, i) => ({
            ts: (now - (prices.length - i) * 3_600_000) / 1000,
            open: price - 120,
            high: price + 260,
            low: price - 310,
            close: price,
            baseVol: 1_200_000 + i * 40_000,
          })),
          about: "BTC",
        },
        {
          outputClass: "FACTUAL_OBSERVATION" as const,
          dataFacets: ["REPORTED_EVENT"] as const,
          content: "Reported headline: spot bitcoin ETF inflows resume as sentiment improves",
          about: "BTC",
        },
      ],
    };
  },
};

/**
 * The router's flow decision, stood in for the model.
 *
 * `lui.resolved_target` is a MODEL call, so a deterministic harness must answer it. It used to
 * answer WHY_IT_HAPPENED for every request, which made a WHAT_HAPPENED / THESIS / FORWARD-FACTORS
 * scenario impossible to drive through the browser at all: the flow under test was overridden by
 * the harness before any engine code ran. This resolver reads the same question shapes the product
 * reads (descriptive, causal, forward, thesis, historical, falsification, framework, synthesis),
 * so a scenario can drive the flow it is meant to test.
 */
function flowOf(question: string): string {
  const q = question.toLowerCase();
  // The turn text carries system framing as well as the trader's words; match the shapes only
  // where the trader's own request appears, and ignore the prompt's rule text.
  // SYSTEM FRAMING is dropped too: the engine hands the LUI the conversation frame, which quotes
  // the trader's message AND the interpreted request AND any prior turns. A router that reads
  // the whole frame classifies on the PREVIOUS turn's words — scenario G was routed as a thesis
  // question because scenario D's thesis turn was still inside the frame. The trader's own turn
  // is the routing authority, so only that is read.
  const ask = q.split("\n").filter((l) => !/^- |^\d\.|^(you|the assistant|respond|output|return)\b/i.test(l.trim())).join(" ");
  const traderTurn = /trader message:\s*"(.*?)"/s.exec(q)?.[1];
  const routing = traderTurn !== undefined && traderTurn !== "" ? traderTurn : ask;
  if (/\bprove\b.*\bwrong\b|\binvalidate\b|\bfalsif\w*/.test(routing)) return "WHAT_COULD_PROVE_ME_WRONG";
  if (/\baccording to my\b|\bmy framework\b|framework criteria/.test(routing)) return "EVALUATE_WITH_MY_FRAMEWORK";
  if (/\bthesis\b|\bdoes my\b|\bstill hold\b/.test(routing)) return "DOES_MY_THESIS_HOLD";
  if (/\bhappened before\b|\bhistor\w*|\banalog\w*/.test(routing)) return "HAS_THIS_HAPPENED_BEFORE";
  if (/\b(?:could|would|might) affect\b|\bupcoming\b|\bcatalysts?\b|\bnext few days\b|\bnext few weeks\b/.test(routing)) return "WHAT_COULD_AFFECT_IT";
  if (/\bwhy\b|\bwhat (?:caused|drove)\b|\bwhat(?:'s| is|s) (?:behind|pushing|driving)\b/.test(routing)) return "WHY_IT_HAPPENED";
  if (/\bwhat happened\b|\bwhat occurred\b|\btimeline\b|\bsequence of\b|\bfactual\b/.test(routing)) return "WHAT_HAPPENED";
  // An enumerated observational ask is a reconstruction even without the words "what happened":
  // "the observed high, low, opening/reference price, closing/current price, timestamps, volume".
  if (/\bprice (?:path|sequence|trajectory)\b|\b(?:high|low|opening|closing)\b[^.?!]{0,60}\bprice\b/.test(routing)) return "WHAT_HAPPENED";
  return "WHAT_DOES_ALL_INFORMATION_SAY";
}

function scripted(schemaName: string, question: string): string {
  switch (schemaName) {
    case "lui.normalized_request":
      return JSON.stringify({ primaryAction: "RESEARCH", compoundActions: [], objective: question, isExplanationOnly: false, disclosureLevel: 0 });
    case "lui.resolved_target":
      return JSON.stringify({ asset: "BTC", flow: flowOf(question), objectRefs: [], unresolved: [] });
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
        // The planner declares the observation ITS OWN methodology needs — the flow briefs it,
        // it does not hardcode capabilities for it. The WHAT_HAPPENED brief asks for a timestamped
        // price timeline; a causal question asks for drivers.
        requirements: flowOf(question) === "WHAT_HAPPENED"
          ? [{ description: "the timestamped BTC price movement across the requested 24 hour window", importance: "CRITICAL", timeSensitivity: "CURRENT" }]
          : [],
        completionCriteria: ["observations"],
        adaptationPolicy: "stop when covered",
      });
    case "research.adaptive_decision":
      return JSON.stringify({ decision: "COMPLETE", rationale: "observations collected", nextTasks: [] });
    case "flow2.causal_synthesis":
      return JSON.stringify({
        eventDefinition: "BTC moved intraday on the retrieved exchange prints.",
        leadingExplanation: "liquidity conditions, as a plausible mechanism rather than a proven cause",
        supportingReasons: ["the retrieved prints show the move", "reported flow headlines coincide"],
        competingExplanations: ["positioning reset"],
        contradictions: [],
        causalStatus: "PLAUSIBLE_MECHANISM",
        confidence: "LOW",
        uncertainty: ["single feed"],
        whatWouldChange: ["a second independent venue"],
        citedObjectRefs: [],
      });
    case "flow3.factor_landscape":
      return JSON.stringify({
        overallAssessment: "conditional factors, not predictions",
        factors: [
          { name: "scheduled macro events", mechanism: "changes expectations", status: "OBSERVED_CURRENT_DRIVER", wouldMatterWhen: ["a print lands"], evidenceRefs: [] },
          { name: "ETF flow continuity", mechanism: "demand pressure", status: "POTENTIAL", wouldMatterWhen: ["flows continue"], evidenceRefs: [] },
        ],
        unresolvedFactors: [],
        missingInformation: [],
        confidence: "LOW",
        uncertainty: [],
        whatWouldChange: ["new scheduled events"],
        citedObjectRefs: [],
      });
    case "flow4.thesis_evaluation":
      return JSON.stringify({
        thesisStatement: "the trader's thesis as stated",
        components: [{ name: "price component", assessment: "WEAKENED", rationale: "prints moved against it" }],
        overallAssessment: "WEAKENED",
        evidenceBasisQuality: "MIXED",
        strongestSupport: ["flow continuity"],
        strongestOpposition: ["the intraday prints"],
        invalidationConditionStatus: [],
        unresolved: [],
        whatWouldChange: ["a break of the stated level"],
        confidence: "LOW",
        rationale: "the retrieved evidence supports and weakens different components",
        citedObjectRefs: [],
      });
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
    // The trader's message travels in `prompt` (with protected fragments), not `userText`;
    // reading userText gave this stand-in an empty string, so the router decision it made was
    // the catch-all for EVERY question and scenario D could never reach its flow.
    const turn = `${request.userText ?? ""}\n${request.prompt ?? ""}`.trim();
    const raw = scripted(request.schemaName, turn);
    return { data: JSON.parse(raw) as T, raw, schemaName: request.schemaName, modelId: "scripted-1" };
  },
};

const registry = new CapabilityRegistry();
registry.register(stubAdapter);

// A FILE-backed store: the durable persistence path, not an in-memory stand-in.
const store = createStore("file", process.env.WORKSPACE_FILE ?? ".data/browser-verify-workspace.json");

await startApi({ provider, registry, store, port: API_PORT, host: "127.0.0.1" });

// SKIP_WEB: run the API only, against a frontend already serving elsewhere. The dev CORS
// allowlist is fixed to the documented local origins (5173/4173 — see src/api/server.ts), so a
// browser can only be driven against the frontend on one of those ports; this flag lets the
// harness supply just the API while the real dev server serves the real UI.
if (process.env.SKIP_WEB === "1") {
  console.log(`[browser-verify] api=${API_PORT} (web served elsewhere)`);
} else {
  const vite = await createServer({
    configFile: "frontend/vite.config.ts",
    root: "frontend",
    server: { host: "0.0.0.0", port: WEB_PORT, strictPort: true },
  });
  await vite.listen();
  vite.printUrls();
  console.log(`[browser-verify] api=${API_PORT} web=${WEB_PORT}`);
}
