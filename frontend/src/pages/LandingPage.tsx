/**
 * Landing page — the most expressive surface. Signature art: a candlestick spine that
 * dissolves upward into an evidence constellation (CSS/SVG only, no images, no 3D libs).
 */
import { useNavigate } from "react-router-dom";

/** Deterministic pseudo-random candle series (fixed seed — no flicker between renders). */
function candles(n: number): { up: boolean; h: number }[] {
  const out: { up: boolean; h: number }[] = [];
  let s = 7;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const r = (s / 2147483648) - 0.5;
    out.push({ up: r > -0.15, h: 8 + Math.abs(r) * 46 });
  }
  return out;
}

function HeroArt() {
  const series = candles(14);
  const nodes = [
    { x: 8, y: 4, c: "var(--cls-observation)" },
    { x: 78, y: 9, c: "var(--cls-derived)" },
    { x: 30, y: 16, c: "var(--cls-proxy)" },
    { x: 62, y: 22, c: "var(--cls-observation)" },
    { x: 15, y: 30, c: "var(--cls-interpretation)" },
    { x: 84, y: 34, c: "var(--cls-derived)" },
    { x: 45, y: 40, c: "var(--cls-speculation)" },
    { x: 70, y: 48, c: "var(--cls-observation)" },
    { x: 22, y: 54, c: "var(--cls-derived)" },
    { x: 52, y: 60, c: "var(--cls-interpretation)" },
  ];
  return (
    <div className="hero-art" aria-hidden>
      <div style={{ position: "relative", height: 420 }}>
        <div className="hero-orbit" style={{ left: "6%", right: "6%", top: "8%", bottom: "30%" }} />
        {/* candlestick spine */}
        <div style={{ position: "absolute", left: 0, bottom: "18%", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div className="candle-col">
            {series.map((c, i) => (
              <div key={i} className={`candle ${c.up ? "up" : "down"}`} style={{ height: c.h, opacity: 0.35 + (i / series.length) * 0.65 }} />
            ))}
          </div>
        </div>
        {/* dissolve into constellation */}
        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }} viewBox="0 0 100 100" preserveAspectRatio="none">
          <line x1="4" y1="34" x2="18" y2="30" stroke="rgba(1,212,200,0.35)" strokeWidth="0.25" />
          <line x1="18" y1="30" x2="45" y2="40" stroke="rgba(1,212,200,0.28)" strokeWidth="0.25" />
          <line x1="45" y1="40" x2="78" y2="9" stroke="rgba(1,212,200,0.3)" strokeWidth="0.25" />
          <line x1="45" y1="40" x2="84" y2="34" stroke="rgba(1,212,200,0.24)" strokeWidth="0.25" />
          <line x1="18" y1="30" x2="8" y2="4" stroke="rgba(1,212,200,0.3)" strokeWidth="0.25" />
          <line x1="84" y1="34" x2="70" y2="48" stroke="rgba(1,212,200,0.3)" strokeWidth="0.25" />
          <line x1="70" y1="48" x2="52" y2="60" stroke="rgba(1,212,200,0.22)" strokeWidth="0.25" />
          <line x1="8" y1="4" x2="78" y2="9" stroke="rgba(1,212,200,0.14)" strokeWidth="0.2" />
        </svg>
        {nodes.map((n, i) => (
          <span key={i} className="constellation-node" style={{ left: `${n.x}%`, top: `${n.y}%`, color: n.c }} />
        ))}
      </div>
    </div>
  );
}

const CAPABILITIES = [
  { glyph: "◎", title: "Evidence-first answers", body: "Every judgment traces to classified evidence — observations stay observations, interpretations stay labeled, proxy data carries its basis." },
  { glyph: "⨂", title: "Built-in falsification", body: "The workbench actively searches for what could prove your thesis wrong — and tells you when it finds nothing instead of pretending." },
  { glyph: "∿", title: "Continuity that decays honestly", body: "Saved knowledge is tracked with freshness. Stale memory never silently outranks current research." },
];

export function LandingPage() {
  const navigate = useNavigate();
  return (
    <div className="landing">
      <header className="landing-top">
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark" aria-hidden />
          <div>
            <div className="brand-name">Lumen Terminal</div>
            <div className="brand-sub">AI RESEARCH WORKBENCH</div>
          </div>
        </div>
        <nav className="landing-nav" aria-label="Landing">
          <a href="#capabilities">Capabilities</a>
          <a href="#workflow">Workflow</a>
          <button className="btn primary sm" onClick={() => navigate("/home")}>Enter workspace</button>
        </nav>
      </header>

      <section className="hero">
        <HeroArt />
        <div className="hero-kicker">Bitget AI Hackathon · Track 3 · research, not execution</div>
        <h1>
          Ask better questions.<br />
          <span className="dim">Get evidence, not echo.</span>
        </h1>
        <p className="hero-sub">
          Lumen is an AI research workstation for traders. It plans investigations, gathers
          classified evidence, tests your thesis against it — and shows its uncertainty instead
          of hiding it.
        </p>
        <div className="hero-ctas">
          <button className="btn primary" onClick={() => navigate("/home")}>Enter the workspace</button>
          <button className="btn ghost" onClick={() => navigate("/research")}>See a live research thread</button>
        </div>

        <div className="research-note-bar">
          <span className="badge teal">research only</span>
          <span style={{ color: "var(--text-2)", fontSize: 13 }}>
            No order tickets, no execution, no leverage controls — the trader makes every decision.
            Lumen does the investigating.
          </span>
        </div>
      </section>

      <section className="landing-section" id="capabilities">
        <h2>What the workbench does</h2>
        <p className="lead">Three disciplines most tools skip: epistemic classification, active falsification, and honest memory.</p>
        <div className="cap-grid">
          {CAPABILITIES.map((c) => (
            <div className="cap-card" key={c.title}>
              <div className="cap-glyph" style={{ color: "var(--accent)" }} aria-hidden>{c.glyph}</div>
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section" id="workflow">
        <h2>How a question becomes a judgment</h2>
        <p className="lead">A structured pipeline — every stage produces artifacts you can inspect, not a wall of text.</p>
        <div className="flow-strip">
          {[
            ["01", "You ask", "Plain language in. The workbench classifies intent and resolves context from your workspace."],
            ["02", "It plans", "A living research plan picks capabilities by information value — never a fixed script."],
            ["03", "It investigates", "Market, news, sentiment and macro evidence gathered, classified and time-stamped."],
            ["04", "It cross-checks", "Contradictions are preserved and typed — never forced into a tidy story."],
            ["05", "You decide", "A judgment with confidence, uncertainty, and what would change it. The call is yours."],
          ].map(([n, t, b]) => (
            <div className="flow-step" key={n}>
              <span className="flow-num">{n}</span>
              <h4>{t}</h4>
              <p>{b}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="landing-foot">
        <div>
          <b style={{ color: "var(--text-2)" }}>Lumen Terminal</b>
          <br />A product identity built for the Bitget AI Hackathon Track 3 prototype.
          Research content comes from your own workspace via the workbench backend.
        </div>
        <div>
          Research workstation — not an exchange interface. Not affiliated with Bitget.
          <br />Research only · no trading execution · no keys in the browser.
        </div>
      </footer>
    </div>
  );
}
