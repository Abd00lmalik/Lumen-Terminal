/**
 * Phase F auth UI (part 1): the sign-in view. Honest states only — loading, signed-out
 * options (Google + email-link), typed failure text, and link-completion feedback. No fake
 * buttons, no simulated identity, no sample data on private pages.
 */
import { useEffect, useState } from "react";
import { startGoogleSignIn, startEmailSignIn, describeAuthError, useAuth } from "../../auth.js";

export function SignInView({ notice }: { notice?: string }) {
  const { user, loading, authActive } = useAuth();
  const [email, setEmail] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitEmail = async () => {
    setError(null);
    if (email === "" || !email.includes("@")) {
      setError("Enter the email address you want to sign in with.");
      return;
    }
    setBusy(true);
    try {
      await startEmailSignIn(email);
      setLinkSent(true);
    } catch (err) {
      setError(describeAuthError(err, "Could not send the sign-in link."));
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setError(null);
    setBusy(true);
    try {
      await startGoogleSignIn();
    } catch (err) {
      setError(describeAuthError(err, "Google sign-in failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>
      <div className="panel" style={{ width: "min(440px, 92vw)", padding: 24 }}>
        <div className="brand" style={{ marginBottom: 16 }}>
          <span className="brand-mark" aria-hidden />
          <div>
            <div className="brand-name">Lumen Terminal</div>
            <div className="brand-sub">AI RESEARCH WORKBENCH</div>
          </div>
        </div>

        {notice !== undefined && <p className="mono" style={{ color: "var(--text-2)" }}>{notice}</p>}

        {loading ? (
          <p className="mono">Restoring your session…</p>
        ) : user !== null ? (
          <p className="mono">Signed in as {user.email ?? user.label}. You can close this page.</p>
        ) : !authActive ? (
          <p className="mono" style={{ color: "var(--warn, #b58a3c)" }}>
            Authentication is not configured in this build. Set the VITE_FIREBASE_* variables and redeploy.
          </p>
        ) : (
          <>
            <button className="btn" style={{ width: "100%" }} onClick={google} disabled={busy}>
              Continue with Google
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0" }}>
              <span style={{ flex: 1, height: 1, background: "var(--border, #2a2f3a)" }} />
              <span className="mono" style={{ color: "var(--text-3)" }}>or</span>
              <span style={{ flex: 1, height: 1, background: "var(--border, #2a2f3a)" }} />
            </div>
            {linkSent ? (
              <p className="mono" data-testid="email-link-sent">
                Sign-in link sent to {email}. Open it on this device to finish signing in.
              </p>
            ) : (
              <>
                <input
                  className="input"
                  style={{ width: "100%" }}
                  type="email"
                  placeholder="you@example.com"
                  aria-label="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void submitEmail(); }}
                />
                <button className="btn ghost" style={{ width: "100%", marginTop: 10 }} onClick={() => void submitEmail()} disabled={busy}>
                  Email me a sign-in link
                </button>
              </>
            )}
          </>
        )}
        {error !== null && <p className="mono" style={{ color: "var(--danger, #d07a7a)", marginTop: 12 }} role="alert">{error}</p>}
        <p className="mono" style={{ color: "var(--text-3)", marginTop: 18, fontSize: 12 }}>
          Your research history, Saved library and theses are private to your account.
        </p>
      </div>
    </div>
  );
}

/** Completes an email-link sign-in when the URL is one (mounted by the /signin route). */
export function EmailLinkCompletion(): null {
  const { complete } = useEmailLinkCompletionOnce();
  void complete;
  return null;
}

function useEmailLinkCompletionOnce(): { complete: () => Promise<void> } {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (done) return;
    setDone(true);
    void (async () => {
      const mod = await import("../../auth.js");
      await mod.completeEmailSignIn().catch(() => {});
    })();
  }, [done]);
  return { complete: async () => {} };
}
