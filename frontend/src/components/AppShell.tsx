/**
 * AppShell; persistent sidebar + topbar + content + (optional) contextual right panel.
 * Responsive: sidebar and context rail collapse into drawers below their breakpoints.
 */
import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth, logout } from "../auth.js";

const NAV = [
  { to: "/home", label: "Home", glyph: "⌂" },
  { to: "/research", label: "Research", glyph: "◎" },
  { to: "/history", label: "History", glyph: "⟲" },
  { to: "/saved", label: "Saved", glyph: "❑" },
  { to: "/thesis", label: "Thesis", glyph: "◈" },
  { to: "/challenge", label: "Challenge", glyph: "⨂" },
  { to: "/monitor", label: "Monitor", glyph: "∿" },
];

export function AppShell({ title, children, contextRail }: {
  title: string;
  children: ReactNode;
  contextRail?: ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <div className="brand-name">Lumen Terminal</div>
            <div className="brand-sub">AI RESEARCH WORKBENCH</div>
          </div>
        </div>

        <button className="ws-select" onClick={() => navigate("/home")}>
          <span>
            <span className="ws-label">WORKSPACE</span>
            <span className="ws-name">Default</span>
          </span>
          <span className="mono" style={{ color: "var(--text-3)" }}>⌄</span>
        </button>

        <nav className="nav" aria-label="Primary">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`} onClick={() => setSidebarOpen(false)}>
              <span aria-hidden style={{ width: 16, textAlign: "center" }}>{n.glyph}</span>
              {n.label}
            </NavLink>
          ))}
          <div className="nav-section">workspace</div>
          <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`} onClick={() => setSidebarOpen(false)}>
            <span aria-hidden style={{ width: 16, textAlign: "center" }}>⚙</span>
            Settings
          </NavLink>
        </nav>

        <div className="sidebar-foot">
          research only; no execution
          <br />
          live backend · F0 API
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <button className="btn ghost sm" style={{ display: "none" }} aria-hidden tabIndex={-1}>n</button>
          <button className="btn ghost sm nav-burger" aria-label="Toggle navigation" onClick={() => setSidebarOpen((v) => !v)}>☰</button>
          <span className="crumb">lumen / <b>{title.toLowerCase()}</b></span>
          <div className="topbar-right">
            <span className="badge gray" title="Connection status">F0 API</span>
            {/* D6: the flag makes the workspace DROP its thread/viewed run/stream — a plain
                navigate("/research") left the previous conversation on screen (same route). */}
            <button className="btn sm" onClick={() => navigate("/research", { state: { newResearch: true } })}>New research</button>
            {user !== null && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span className="badge gray" title={user.email ?? user.uid} aria-label="Account identity indicator">
                  {user.label}
                </span>
                <button
                  className="btn ghost sm"
                  onClick={() => { void logout().then(() => navigate("/")); }}
                  aria-label="Logout"
                >
                  Sign out
                </button>
              </span>
            )}
          </div>
        </header>

        <div className="content">
          <div className="with-context">
            <div className="center-col">{children}</div>
            {contextRail && (
              <>
                <aside className={`context-rail ${railOpen ? "open" : ""}`} aria-label="Context panel">
                  {contextRail}
                </aside>
                <button
                  className="btn sm rail-toggle"
                  aria-label="Toggle context panel"
                  onClick={() => setRailOpen((v) => !v)}
                >
                  {railOpen ? "→" : "←"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
