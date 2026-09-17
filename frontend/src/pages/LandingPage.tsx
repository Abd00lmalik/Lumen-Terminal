/**
 * Landing page; premium dark research terminal aesthetic.
 * Cinematic 3D hero with research core visualization,
 * structured sections, scroll reveal animations.
 */
import { lazy, Suspense, useState, useEffect, useRef, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
// Code-split: the three.js hero (~1MB) loads only when the landing page mounts,
// keeping the app bundle (research surfaces) at its original size.
const ResearchCoreScene = lazy(() =>
  import("../components/hero/ResearchCore.js").then((m) => ({ default: m.ResearchCoreScene })),
);
import "../styles/landing.css";

/* ---------- scroll reveal hook ---------- */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("visible");
          obs.unobserve(el);
        }
      },
      { threshold: 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

function RevealDiv({ className, children, delay }: {
  className?: string;
  children: React.ReactNode;
  delay?: number;
}) {
  const ref = useReveal();
  const delayClass = delay ? ` reveal-delay-${delay}` : "";
  return (
    <div ref={ref} className={`reveal${delayClass}${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}

/* ---------- research prompts ---------- */
const PROMPTS = [
  "What is affecting BTC right now?",
  "Why did this happen?",
  "Search historical data for similar BTC setups",
  "What could prove my thesis wrong?",
  "Evaluate my thesis",
];

/* ---------- capabilities data ---------- */
const CAPABILITIES = [
  {
    icon: "icon-evidence",
    glyph: "◎",
    title: "Evidence-first answers",
    body: "Every judgment traces to classified evidence; observations stay observations, interpretations stay labeled, proxy data carries its basis.",
  },
  {
    icon: "icon-falsification",
    glyph: "⨂",
    title: "Built-in falsification",
    body: "The workbench actively searches for what could prove your thesis wrong; and tells you when it finds nothing instead of pretending.",
  },
  {
    icon: "icon-memory",
    glyph: "∿",
    title: "Continuity that decays honestly",
    body: "Saved knowledge is tracked with freshness. Stale memory never silently outranks current research.",
  },
];

/* ---------- pipeline steps ---------- */
const PIPELINE = [
  { num: "01", title: "You ask", body: "Plain language in. The workbench classifies intent and resolves context from your workspace." },
  { num: "02", title: "It plans", body: "A living research plan picks capabilities by information value; never a fixed script." },
  { num: "03", title: "It investigates", body: "Market, news, sentiment and macro evidence gathered, classified and time-stamped." },
  { num: "04", title: "It cross-checks", body: "Contradictions are preserved and typed; never forced into a tidy story." },
  { num: "05", title: "You decide", body: "A judgment with confidence, uncertainty, and what would change it." },
];

/* ================================================================
   LANDING PAGE COMPONENT
   ================================================================ */
export function LandingPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate("/research", { state: { question: query.trim() } });
    }
  };

  const handlePromptClick = (prompt: string) => {
    setQuery(prompt);
  };

  return (
    <div className="landing">
      {/* ===== NAVIGATION ===== */}
      <nav className={`landing-nav${mobileNavOpen ? " mobile-open" : ""}`}>
        <a href="#/" className="landing-nav-brand">
          <span className="brand-mark" aria-hidden />
          <div className="landing-nav-brand-text">
            <span className="landing-nav-brand-name">Lumen Terminal</span>
            <span className="landing-nav-brand-sub">AI Research Workbench</span>
          </div>
        </a>

        <div className="landing-nav-links">
          <a href="#capabilities">Capabilities</a>
          <a href="#workflow">Workflow</a>
          <button className="landing-nav-enter" onClick={() => navigate("/home")}>
            Enter workspace
          </button>
        </div>

        <button
          className="landing-nav-burger"
          onClick={() => setMobileNavOpen((v) => !v)}
          aria-label="Toggle navigation"
        >
          {mobileNavOpen ? "✕" : "☰"}
        </button>
      </nav>

      {/* ===== HERO ===== */}
      <section className="hero-section">
        <div className="hero-container">
          {/* left: content */}
          <div className="hero-content">
            <div className="hero-eyebrow">
              Bitget AI Hackathon · Track 3 · Research, Not Execution
            </div>

            <h1 className="hero-headline">
              <span className="line-white">Ask better questions.</span>
              <span className="line-cyan">Get evidence, not echo.</span>
            </h1>

            <p className="hero-description">
              Lumen is an AI research workbench for traders. It plans investigations,
              gathers classified evidence, tests your thesis against it; and shows its
              uncertainty instead of hiding it.
            </p>

            <form onSubmit={handleSubmit}>
              <div className="hero-input-wrap">
                <span className="hero-input-icon" aria-hidden>✦</span>
                <input
                  className="hero-input"
                  type="text"
                  placeholder="Ask a research question..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Research question"
                />
                <button className="hero-input-submit" type="submit" aria-label="Submit">
                  →
                </button>
              </div>
            </form>

            <div className="hero-chips">
              <span className="hero-chips-label">Try asking:</span>
              {PROMPTS.map((p) => (
                <button
                  key={p}
                  className="hero-chip"
                  onClick={() => handlePromptClick(p)}
                  type="button"
                >
                  {p}
                </button>
              ))}
            </div>

            <div className="hero-ctas">
              <button className="btn-primary" onClick={() => navigate("/home")}>
                Enter the workspace
              </button>
              <button className="btn-ghost" onClick={() => navigate("/research")}>
                See a live research thread
              </button>
            </div>
          </div>

          {/* right: 3D scene */}
          <div className="hero-3d">
            <Suspense fallback={null}>
              <ResearchCoreScene />
            </Suspense>
            {/* floating data cards */}
            <div className="floating-card fc-1">
              <div className="floating-card-label">Market Data</div>
              <div className="floating-card-value">
                <span className="floating-card-dot" /> connected
              </div>
            </div>
            <div className="floating-card fc-2">
              <div className="floating-card-label">News &amp; Sentiment</div>
              <div className="floating-card-value">
                <span className="floating-card-dot blue" /> analyzing
              </div>
            </div>
            <div className="floating-card fc-3">
              <div className="floating-card-label">Macro</div>
              <div className="floating-card-value">
                <span className="floating-card-dot amber" /> 1,095 observations
              </div>
            </div>
            <div className="floating-card fc-4">
              <div className="floating-card-label">Historical</div>
              <div className="floating-card-value">
                <span className="floating-card-dot violet" /> synchronized
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== RESEARCH-ONLY STRIP ===== */}
      <div className="research-strip">
        <RevealDiv>
          <div className="research-strip-inner">
            <span className="research-strip-badge">Research Only</span>
            <span className="research-strip-text">
              No order tickets, no execution, no leverage controls; the trader makes every
              decision. Lumen does the investigating.
            </span>
          </div>
        </RevealDiv>
      </div>

      {/* ===== CAPABILITIES ===== */}
      <section className="landing-section" id="capabilities">
        <RevealDiv>
          <div className="section-label">Capabilities</div>
          <h2 className="section-heading">What the workbench does</h2>
          <p className="section-subheading">
            Three disciplines most tools skip: epistemic classification, active
            falsification, and honest memory.
          </p>
        </RevealDiv>

        <div className="capabilities-grid">
          {CAPABILITIES.map((c, i) => (
            <RevealDiv key={c.title} delay={i + 1}>
              <div className="cap-card">
                <div className={`cap-card-icon ${c.icon}`}>
                  <span aria-hidden>{c.glyph}</span>
                </div>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </div>
            </RevealDiv>
          ))}
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section className="landing-section" id="workflow">
        <RevealDiv>
          <div className="section-label">Workflow</div>
          <h2 className="section-heading">How a question becomes a judgment</h2>
          <p className="section-subheading">
            A structured pipeline; every stage produces artifacts you can inspect, not a
            wall of text.
          </p>
        </RevealDiv>

        <div className="pipeline-wrap">
          <RevealDiv>
            <div className="pipeline">
              {PIPELINE.map((s) => (
                <div className="pipeline-step" key={s.num}>
                  <div className="pipeline-num">{s.num}</div>
                  <h4>{s.title}</h4>
                  <p>{s.body}</p>
                </div>
              ))}
            </div>
          </RevealDiv>
        </div>
      </section>

      {/* ===== PRODUCT PREVIEW ===== */}
      <section className="landing-section preview-section">
        <RevealDiv>
          <div className="section-label">Interface</div>
          <h2 className="section-heading">Built for serious research</h2>
          <p className="section-subheading">
            Every artifact is classified, every judgment carries its uncertainty, every
            source is traceable.
          </p>
        </RevealDiv>

        <RevealDiv>
          <div className="preview-wrap">
            <div className="preview-window">
              <div className="preview-titlebar">
                <span className="preview-dot active" />
                <span className="preview-dot" />
                <span className="preview-dot" />
                <span className="preview-titlebar-text">Lumen Terminal; Research Workspace</span>
              </div>
              <div className="preview-body">
                <div className="preview-main">
                  <div className="preview-question">
                    What is driving BTC sentiment right now?
                  </div>
                  <div className="preview-progress">
                    <div className="preview-progress-bar done" />
                    <div className="preview-progress-bar done" />
                    <div className="preview-progress-bar done" />
                    <div className="preview-progress-bar active" />
                    <div className="preview-progress-bar" />
                  </div>
                  <div className="preview-evidence">
                    <div className="preview-evidence-item">
                      <span className="preview-ev-rail" style={{ background: "var(--cls-observation)" }} />
                      <span>On-chain exchange inflows dropped 18% week-over-week; reduced selling pressure from large holders.</span>
                    </div>
                    <div className="preview-evidence-item">
                      <span className="preview-ev-rail" style={{ background: "var(--cls-derived)" }} />
                      <span>Funding rates across major perpetual markets shifted negative for the first time in 12 days.</span>
                    </div>
                    <div className="preview-evidence-item">
                      <span className="preview-ev-rail" style={{ background: "var(--cls-interpretation)" }} />
                      <span>Social sentiment metrics show cautious optimism rather than euphoria; historically a healthier signal.</span>
                    </div>
                  </div>
                </div>
                <div className="preview-sidebar">
                  <div className="preview-sidebar-title">Judgment</div>
                  <div className="preview-confidence">
                    <div className="preview-conf-track">
                      <div className="preview-conf-cell on" />
                      <div className="preview-conf-cell on" />
                      <div className="preview-conf-cell" />
                    </div>
                    <span className="preview-confidence-label">MODERATE</span>
                  </div>
                  <div className="preview-sidebar-title">Metadata</div>
                  <div className="preview-meta-row">
                    <span className="preview-meta-key">Evidence</span>
                    <span className="preview-meta-val">14 items</span>
                  </div>
                  <div className="preview-meta-row">
                    <span className="preview-meta-key">Sources</span>
                    <span className="preview-meta-val">7 unique</span>
                  </div>
                  <div className="preview-meta-row">
                    <span className="preview-meta-key">Contradictions</span>
                    <span className="preview-meta-val" style={{ color: "var(--warn)" }}>2 preserved</span>
                  </div>
                  <div className="preview-meta-row">
                    <span className="preview-meta-key">Freshness</span>
                    <span className="preview-meta-val" style={{ color: "var(--up)" }}>CURRENT</span>
                  </div>
                  <div className="preview-meta-row">
                    <span className="preview-meta-key">Duration</span>
                    <span className="preview-meta-val">42s</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </RevealDiv>
      </section>

      {/* ===== FINAL CTA ===== */}
      <section className="cta-section">
        <RevealDiv>
          <h2 className="cta-heading">Research before you decide.</h2>
          <p className="cta-text">
            Lumen carries the investigation. You keep the judgment.
          </p>
          <div className="cta-buttons">
            <button className="btn-primary" onClick={() => navigate("/home")}>
              Enter the workspace
            </button>
            <button className="btn-ghost" onClick={() => navigate("/research")}>
              Explore how it works
            </button>
          </div>
        </RevealDiv>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="landing-footer">
        <div className="footer-brand">
          <div className="footer-brand-name">Lumen Terminal</div>
          <div className="footer-brand-desc">
            AI research workbench. Built for the Bitget AI Hackathon Track 3
            prototype. Research content comes from your own workspace via the
            workbench backend.
          </div>
        </div>
        <div className="footer-links">
          <div className="footer-links-title">Product</div>
          <a href="#capabilities">Capabilities</a>
          <a href="#workflow">Workflow</a>
          <a href="#/" onClick={() => navigate("/home")}>Open workspace</a>
        </div>
        <div className="footer-legal">
          <div className="footer-legal-text">
            Research workstation; not an exchange interface.
            <br />
            Not affiliated with Bitget.
          </div>
          <div className="footer-legal-text">
            Research only.
            <br />
            No trading execution.
            <br />
            No keys in the browser.
          </div>
        </div>
      </footer>
    </div>
  );
}
