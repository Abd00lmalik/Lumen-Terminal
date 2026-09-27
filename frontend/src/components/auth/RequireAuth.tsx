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
