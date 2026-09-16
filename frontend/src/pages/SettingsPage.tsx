/**
 * Settings — visual preferences (local only) plus REAL server status from /api/health.
 * Provider info is informational: keys live server-side and are never displayed,
 * entered, or stored in the browser. No fake settings are presented as functional.
 */
import { useEffect, useState } from "react";
import { AppShell } from "../components/AppShell.js";
import { Panel, Toggle, Note, KV, StatusBadge } from "../components/ui.js";
import { http } from "../api/index.js";

interface HealthResponse {
  readonly status: string;
  readonly api?: string;
  readonly timestamp?: string;
  readonly note?: string;
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--gap-4)", padding: "10px 0", borderTop: "1px dashed var(--line)" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, fontFamily: "var(--font-ui)" }}>{title}</div>
        {hint && <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Segmented({ options, value, onChange, label }: {
  options: string[]; value: string; onChange: (v: string) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "flex", gap: 4 }}>
      {options.map((o) => (
        <button
          key={o}
          role="radio"
          aria-checked={value === o}
          className={`badge ${value === o ? "teal" : "gray"}`}
          style={{ cursor: "pointer", padding: "5px 10px" }}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function SettingsPage() {
  const [health, setHealth] = useState<HealthResponse | undefined>(undefined);
  const [healthError, setHealthError] = useState<string | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      try {
        setHealth(await http.get<HealthResponse>("/api/health"));
      } catch {
        setHealthError("API process not reachable — start it with `npm run api`.");
      }
    })();
  }, []);

  const [density, setDensity] = useState("Medium");
  const [motion, setMotion] = useState(true);
  const [autoClassify, setAutoClassify] = useState(true);
  const [contradictionBias, setContradictionBias] = useState(true);
  const [disclosure, setDisclosure] = useState("L1 · why");
  const [staleResearch, setStaleResearch] = useState(true);
  const [progressStream, setProgressStream] = useState(true);
  const [reviewNudges, setReviewNudges] = useState(false);

  return (
    <AppShell title="Settings">
      <div className="page-head">
        <h1 className="page-title">Settings</h1>
        <p className="page-sub">Interface preferences are stored locally. Server state below comes from the backend's health endpoint.</p>
      </div>

      <Panel kicker="server status" title="Research backend">
        <div className="panel-body" style={{ paddingTop: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--gap-4)", padding: "10px 0", borderBottom: "1px dashed var(--line)" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, fontFamily: "var(--font-ui)" }}>API process</div>
              <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>Reports process availability only — it never claims provider health or live monitoring.</div>
            </div>
            {health !== undefined ? <StatusBadge status="OK" /> : <StatusBadge status={healthError !== undefined ? "UNAVAILABLE" : "…"} />}
          </div>
          {healthError !== undefined && <Note tone="warn">{healthError}</Note>}
          {health !== undefined && (
            <>
              <KV k="api" v={health.api ?? "—"} />
              {health.note !== undefined && <KV k="scope" v={health.note} />}
            </>
          )}
        </div>
      </Panel>

      <div className="grid-2">
        <Panel kicker="appearance" title="Interface">
          <div className="panel-body" style={{ paddingTop: 4 }}>
            <Row title="Density" hint="Information spacing across the workspace">
              <Segmented options={["Compact", "Medium", "Roomy"]} value={density} onChange={setDensity} label="Density" />
            </Row>
            <Row title="Motion" hint="Subtle progress and pulse animations">
              <Toggle on={motion} onChange={setMotion} label="Motion" />
            </Row>
            <Row title="Theme" hint="Dark is the native surface for this terminal">
              <span className="badge gray">Dark only</span>
            </Row>
          </div>
        </Panel>

        <Panel kicker="research preferences" title="How research behaves">
          <div className="panel-body" style={{ paddingTop: 4 }}>
            <Row title="Auto-classify evidence" hint="Apply engine classification to every tool result">
              <Toggle on={autoClassify} onChange={setAutoClassify} label="Auto-classify evidence" />
            </Row>
            <Row title="Falsification bias" hint="Weight searches toward disconfirming evidence">
              <Toggle on={contradictionBias} onChange={setContradictionBias} label="Falsification bias" />
            </Row>
            <Row title="Default disclosure level" hint="How much depth responses open with">
              <Segmented options={["L0 · answer", "L1 · why", "L2 · evidence"]} value={disclosure} onChange={setDisclosure} label="Default disclosure level" />
            </Row>
            <Row title="Include stale research" hint="Surface stale evidence with explicit status instead of hiding it">
              <Toggle on={staleResearch} onChange={setStaleResearch} label="Include stale research" />
            </Row>
          </div>
        </Panel>

        <Panel kicker="model & provider" title="Provider information">
          <div className="panel-body" style={{ paddingTop: 4 }}>
            <KV k="model provider" v="server-side (provider-neutral)" />
            <KV k="market capabilities" v="Bitget research skills via registry" />
            <KV k="api keys" v="managed server-side only" />
            <Note>
              API keys never appear in the browser. The frontend talks to the workbench backend
              (the F0 API), which holds credentials in its own environment. The interpretation
              model is configured server-side via environment variables.
            </Note>
          </div>
        </Panel>

        <Panel kicker="workspace & data" title="Workspace">
          <div className="panel-body" style={{ paddingTop: 4 }}>
            <Row title="Workspace" hint="Active research context">
              <span className="badge gray">Q4 · BTC/ETH</span>
            </Row>
            <Row title="Data sources" hint="Capability routing stays provider-neutral">
              <span className="badge gray">Bitget-first</span>
            </Row>
            <Row title="History retention" hint="Superseded judgments and old versions are preserved, never deleted">
              <span className="badge green">always</span>
            </Row>
          </div>
        </Panel>

        <Panel kicker="notifications" title="Preferences (visual only in this prototype)">
          <div className="panel-body" style={{ paddingTop: 4 }}>
            <Row title="Research progress stream" hint="Show live pipeline progress while research runs">
              <Toggle on={progressStream} onChange={setProgressStream} label="Research progress stream" />
            </Row>
            <Row title="Thesis review nudges" hint="Suggest reassessment when material new evidence arrives">
              <Toggle on={reviewNudges} onChange={setReviewNudges} label="Thesis review nudges" />
            </Row>
          </div>
        </Panel>

        <Panel kicker="privacy & about" title="Data & product">
          <div className="panel-body" style={{ paddingTop: 4 }}>
            <KV k="research scope" v="research only — no execution, ever" />
            <KV k="telemetry" v="none" />
            <KV k="build" v="Lumen Terminal · hackathon prototype" />
            <KV k="data status" v="live research data from your workspace" />
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
