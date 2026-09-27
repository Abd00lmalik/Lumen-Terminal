import { Routes, Route } from "react-router-dom";
import { LandingPage } from "./pages/LandingPage.js";
import { HomePage } from "./pages/HomePage.js";
import { HistoryPage } from "./pages/HistoryPage.js";
import { SavedPage } from "./pages/SavedPage.js";
import { ResearchWorkspacePage } from "./pages/ResearchWorkspacePage.js";
import { ActiveResearchPage } from "./pages/ActiveResearchPage.js";
import { EvidencePage } from "./pages/EvidencePage.js";
import { ThesisPage } from "./pages/ThesisPage.js";
import { ChallengePage } from "./pages/ChallengePage.js";
import { MemoryPage } from "./pages/MemoryPage.js";
import { MonitorPage } from "./pages/MonitorPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { RequireAuth } from "./components/auth/RequireAuth.js";
import { SignInView } from "./components/auth/SignInView.js";

/** Private (per-user workspace) routes; everything else stays public. */
function Private({ children }: { children: React.ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/signin" element={<SignInView />} />
      <Route path="/home" element={<Private><HomePage /></Private>} />
      <Route path="/history" element={<Private><HistoryPage /></Private>} />
      <Route path="/saved" element={<Private><SavedPage /></Private>} />
      <Route path="/research" element={<Private><ResearchWorkspacePage /></Private>} />
      <Route path="/research/:ref" element={<Private><ResearchWorkspacePage /></Private>} />
      <Route path="/research/active" element={<Private><ActiveResearchPage /></Private>} />
      <Route path="/evidence" element={<Private><EvidencePage /></Private>} />
      <Route path="/thesis" element={<Private><ThesisPage /></Private>} />
      <Route path="/thesis/:ref" element={<Private><ThesisPage /></Private>} />
      <Route path="/challenge" element={<Private><ChallengePage /></Private>} />
      <Route path="/memory" element={<Private><MemoryPage /></Private>} />
      <Route path="/monitor" element={<Private><MonitorPage /></Private>} />
      <Route path="/settings" element={<Private><SettingsPage /></Private>} />
      <Route path="*" element={<LandingPage />} />
    </Routes>
  );
}
