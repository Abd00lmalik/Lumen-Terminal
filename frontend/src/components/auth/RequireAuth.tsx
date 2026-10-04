/**
 * Phase F auth UI (part 2): the route guard. Private pages render ONLY for an
 * authenticated session; every other state (loading / signed-out / auth-inactive) gets
 * an honest full-page view instead of leaked data or a fake empty app.
 */
import type { ReactNode } from "react";
import { useAuth, authActive } from "../../auth.js";
import { SignInView } from "./SignInView.js";

export function RequireAuth({ children, notice }: { children: ReactNode; notice?: string }) {
  const { loading, user } = useAuth();
  if (!authActive) {
    // LOCAL DEV, OPEN MODE: the API explicitly serves an unauthenticated single workspace when
    // no Firebase env is configured (src/api/server.ts OPEN mode; tests and local dev use it).
    // The client now mirrors that seam, so a developer can drive the REAL product locally
    // instead of a sign-in wall that no local configuration can satisfy. This is a development
    // affordance only: a production build never reaches it (import.meta.env.DEV is false), and
    // the server stays the enforcing boundary — a deployed build with Firebase configured
    // requires a real session, exactly as before.
    if (import.meta.env.DEV) return <>{children}</>;
    return <SignInView notice="Authentication is not configured in this build." />;
  }
  if (loading) {
    return (
      <div style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>
        <p className="mono">Checking your session…</p>
      </div>
    );
  }
  if (user === null) {
    return <SignInView notice={notice} />;
  }
  return <>{children}</>;
}
