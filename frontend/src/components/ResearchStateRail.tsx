/**
 * The context rail's "Research state" section — presentation over the ONE decided state
 * (`researchRailState` in ../pages/researchView.js), so the rail can never re-derive its own
 * notion of current. Execution state, the selected run and the persisted lifecycle arrive as
 * distinct facts; the Empty state only renders when no run and no snapshot research belong to
 * the active view.
 */
import { KV, Empty } from "./ui.js";
import type { ResearchRailState } from "../pages/researchView.js";

export function ResearchStateRail({ state, onRefresh }: {
  readonly state: ResearchRailState;
  readonly onRefresh: () => void;
}) {
  return (
    <div className="rail-section">
      <div className="rail-title">Research state</div>
      {state.kind === "running" ? (
        <>
          <KV k="research" v="running" />
          {state.question !== undefined && (
            <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-3)", margin: "6px 0" }}>{state.question}</div>
          )}
          <KV k="stage" v={state.stage} />
        </>
      ) : state.kind === "run" ? (
        <>
          <KV k="research" v={state.ref} />
          {state.flow !== undefined && <KV k="flow" v={state.flow.replace(/_/g, " ").toLowerCase()} />}
          <KV k="status" v={state.status} />
          {state.evidenceCount !== undefined && <KV k="evidence" v={String(state.evidenceCount)} />}
        </>
      ) : (
        <Empty title="No active research" hint={state.hint} />
      )}
      <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={onRefresh}>Refresh state ↻</button>
    </div>
  );
}
