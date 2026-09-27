import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "@fontsource-variable/space-grotesk";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles/tokens.css";
import "./index.css";
import "./styles/shell.css";
import { AppRoutes } from "./routes.js";
import { AuthProvider, useAuth, authActive } from "./auth.js";
import { setApiTokenProvider } from "./api/client.js";

/** Phase F: feed the account's fresh ID token to the API client (auth builds only). */
function TokenBridge(): null {
  const { token } = useAuth();
  setApiTokenProvider(token);
  return null;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        {authActive ? <TokenBridge /> : null}
        <AppRoutes />
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>,
);
