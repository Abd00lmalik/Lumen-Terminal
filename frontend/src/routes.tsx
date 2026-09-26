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

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/home" element={<HomePage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/saved" element={<SavedPage />} />
      <Route path="/research" element={<ResearchWorkspacePage />} />
      <Route path="/research/:ref" element={<ResearchWorkspacePage />} />
      <Route path="/research/active" element={<ActiveResearchPage />} />
      <Route path="/evidence" element={<EvidencePage />} />
      <Route path="/thesis" element={<ThesisPage />} />
      <Route path="/challenge" element={<ChallengePage />} />
      <Route path="/memory" element={<MemoryPage />} />
      <Route path="/monitor" element={<MonitorPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<LandingPage />} />
    </Routes>
  );
}
