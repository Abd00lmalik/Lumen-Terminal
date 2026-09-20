/**
 * useResearchStream; drives a REAL research run over the backend SSE stream.
 *
 * Honest-progress rules (integration mandate §5):
 * - Every displayed stage is a backend progress event; nothing is simulated, no
 *   timers fake progress, no percentages are invented. The only timer is real elapsed time.
 * - Backend stage vocabulary is displayed verbatim (stage id + summary + safe data).
 * - Completed stages keep their artifacts (summary lines); the final result is the
 *   backend's ResearchResponseDTO rendered by the workspace; never synthesized in React.
 */
import { useCallback, useRef, useState } from "react";
import { streamResearchRequest } from "../api/index.js";
import type { ResearchResponseDto } from "../api/index.js";

export interface StageView {
  readonly stage: string;
  readonly name: string;
  readonly summary: string;
  readonly at: string;
  readonly data?: Readonly<Record<string, string | number | boolean>>;
  readonly status: "done" | "active";
}

export interface StreamState {
  readonly running: boolean;
  readonly question: string;
  readonly stages: readonly StageView[];
  readonly capabilities: readonly { name: string; status: "RUNNING" | "COMPLETE" | "FAILED"; detail: string }[];
  readonly findings: readonly string[];
  readonly result: ResearchResponseDto | undefined;
  readonly error: { code: string; message: string } | undefined;
  /** Unique per terminal error arrival; lets the page record exactly one failure turn. */
  readonly errorId: number;
  readonly elapsedSeconds: number;
}

const STAGE_LABELS: Record<string, string> = {
  request_accepted: "Research started",
  intent_understood: "Understanding request",
  target_resolved: "Resolving target",
  ambiguity_checked: "Ambiguity gate",
  consequence_checked: "Consequence gate",
  safety_checked: "Safety gate",
  plan_created: "Building research plan",
  step_started: "Dispatching step",
  research_plan_created: "Selecting capabilities",
  capability_started: "Running research",
  capability_completed: "Capability finished",
  research_round_completed: "Validating evidence",
  research_stopped: "Assessing result",
  response_ready: "Completing research",
};

function capabilityName(event: { data?: Record<string, string | number | boolean> }): string {
  const cap = event.data?.capability;
  return typeof cap === "string" ? cap : "capability";
}

export function useResearchStream() {
  const [state, setState] = useState<StreamState>({
    running: false,
    question: "",
    stages: [],
    capabilities: [],
    findings: [],
    result: undefined,
    error: undefined,
    errorId: 0,
    elapsedSeconds: 0,
  });
  const startedAt = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const capsRef = useRef<Map<string, { status: "RUNNING" | "COMPLETE" | "FAILED"; detail: string }>>(new Map());
  const stagesRef = useRef<StageView[]>([]);
  // RUN TOKEN (state-isolation law): every submission increments this. Callbacks from an
  // older submission check the token before patching state, so a late event, late final
  // result, or a reconnecting stream from run A can NEVER write into run B's state.
  const runToken = useRef(0);

  const stopTimer = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const patch = useCallback((fn: (prev: StreamState) => StreamState) => setState(fn), []);

  const submit = useCallback(
    (question: string, options?: { confirmed?: boolean }) => {
      stopTimer();
      runToken.current += 1;
      const token = runToken.current;
      capsRef.current = new Map();
      stagesRef.current = [];
      startedAt.current = Date.now();
      patch((prev) => ({
        running: true,
        question,
        stages: [],
        capabilities: [],
        findings: [],
        result: undefined,
        error: undefined,
        errorId: prev.errorId,
        elapsedSeconds: 0,
      }));
      timer.current = setInterval(() => {
        patch((prev) => ({ ...prev, elapsedSeconds: Math.round((Date.now() - startedAt.current) / 1000) }));
      }, 1000);

      return streamResearchRequest(
        question,
        {
          onProgress: (event) => {
            if (token !== runToken.current) return; // stale run: ignore entirely
            const label = STAGE_LABELS[event.stage] ?? event.stage;
            // Mark previous stages done, append this one as active.
            stagesRef.current = [
              ...stagesRef.current.map((s) => (s.status === "active" ? { ...s, status: "done" as const } : s)),
              { stage: event.stage, name: label, summary: event.summary, at: new Date().toISOString(), data: event.data, status: "active" as const },
            ];
            const caps = capsRef.current;
            if (event.stage === "capability_started") {
              caps.set(capabilityName(event), { status: "RUNNING", detail: "executing…" });
            } else if (event.stage === "capability_completed") {
              const cap = capabilityName(event);
              const failed = event.data?.failureType !== undefined;
              const completeness = typeof event.data?.completeness === "string" ? event.data.completeness : failed ? "FAILED" : "COMPLETE";
              caps.set(cap, {
                status: failed || completeness === "FAILED" || completeness === "EMPTY" ? "FAILED" : "COMPLETE",
                detail: `completeness ${completeness}`,
              });
            } else if (event.stage === "research_round_completed") {
              patch((prev) => ({ ...prev, findings: [...prev.findings, event.summary] }));
            }
            patch((prev) => ({
              ...prev,
              stages: [...stagesRef.current],
              capabilities: [...caps.entries()].map(([name, c]) => ({ name, ...c })),
            }));
          },
          onFinal: (result) => {
            if (token !== runToken.current) return; // a superseded run's result never becomes the active result
            stopTimer();
            stagesRef.current = stagesRef.current.map((s) => ({ ...s, status: "done" as const }));
            patch((prev) => ({ ...prev, running: false, stages: [...stagesRef.current], result }));
          },
          onError: (error) => {
            if (token !== runToken.current) return;
            stopTimer();
            patch((prev) => ({ ...prev, running: false, error, errorId: prev.errorId + 1 }));
          },
          onConnectionLost: () => {
            if (token !== runToken.current) return;
            stopTimer();
            patch((prev) => ({
              ...prev,
              running: false,
              error: { code: "NETWORK", message: "Connection to the research backend was lost mid-run. The research object (if it completed) is in Research history." },
              errorId: prev.errorId + 1,
            }));
          },
        },
        options,
      );
    },
    [patch, stopTimer],
  );

  return { state, submit };
}
