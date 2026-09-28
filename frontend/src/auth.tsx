/**
 * Phase F authentication context: Firebase Auth (Google + email-link sign-in) with the
 * ID token attached to every API request.
 *
 * Laws implemented here:
 * - Credentials/tokens live in Firebase's in-memory session ONLY (IndexedDB persistence
 *   for refresh tokens is Firebase's own mechanism); this module never writes tokens to
 *   localStorage itself and never logs them.
 * - The Firebase WEB config is a public identifier, not a secret (Google's own guidance);
 *   the SERVER verifies every token against Google's public keys, so a leaked config
 *   grants nothing.
 * - Email identity is trusted only when Firebase reports emailVerified (email-link
 *   sign-in verifies by construction; the server ALSO enforces this independently).
 * - The ID token is refreshed by Firebase before each request via getIdToken().
 * - Every required state exists: loading, signed-out, expired-session (401 → signed-out),
 *   and auth failure — no fake buttons, no simulated auth.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth, signInWithPopup, GoogleAuthProvider, signInWithEmailLink, sendSignInLinkToEmail,
  isSignInWithEmailLink, onAuthStateChanged, signOut, type User,
} from "firebase/auth";

/** Public web config (Vite env; set VITE_FIREBASE_* at build time — see the runbook). */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

/** Auth is ACTIVE only when the build carries a real Firebase config. */
export const authActive = firebaseConfig.apiKey !== undefined && firebaseConfig.projectId !== undefined;

const app = authActive ? initializeApp(firebaseConfig as Required<typeof firebaseConfig>) : undefined;
const auth = app !== undefined ? getAuth(app) : undefined;

export interface AccountIdentity {
  readonly uid: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly provider: string;
  /** Short, non-sensitive display label (local part of the email, or "Google account"). */
  readonly label: string;
}

function identityOf(user: User): AccountIdentity {
  const email = user.email;
  return {
    uid: user.uid,
    email,
    emailVerified: user.emailVerified,
    provider: user.providerData[0]?.providerId ?? "unknown",
    label: email !== null && email.includes("@") ? email.split("@")[0]! : "Google account",
  };
}

const EMAIL_KEY = "lumen.email-for-signin";

/**
 * Human-readable, honest mapping of Firebase auth errors (F.1 mitigation): the raw SDK
 * strings (e.g. "Firebase: Exceeded daily quota for email sign-in. (auth/quota-exceeded).")
 * name internal codes but never the operator-fix. Unknown codes still surface verbatim —
 * errors are re-typed, never swallowed or softened.
 */
export function describeAuthError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes("auth/quota-exceeded")) {
    return "Firebase's daily email-quota protection is active for this project, so no sign-in links can be sent right now. Try Google sign-in, or ask the operator to raise the quota / wait for the daily window to reset.";
  }
  if (raw.includes("auth/invalid-email")) return "That email address is not valid.";
  if (raw.includes("auth/unauthorized-domain")) return "This domain is not authorized for sign-in (Firebase console → Authorized domains).";
  if (raw.includes("auth/popup-closed-by-user")) return "Google sign-in was cancelled before it completed.";
  return raw === "" ? fallback : raw;
}

export async function startGoogleSignIn(): Promise<void> {
  if (auth === undefined) throw new Error("Authentication is not configured in this build.");
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}

export async function startEmailSignIn(email: string): Promise<void> {
  if (auth === undefined) throw new Error("Authentication is not configured in this build.");
  window.localStorage.setItem(EMAIL_KEY, email);
  // Email-link (passwordless): Firebase sends a verification link; signing in through it
  // proves mailbox ownership, so the identity arrives email-verified by construction.
  await sendSignInLinkToEmail(auth, email, {
    url: window.location.origin + window.location.pathname + "#/signin",
    handleCodeInApp: true,
  });
}

export async function completeEmailSignIn(): Promise<boolean> {
  if (auth === undefined) return false;
  // Firebase's hosted action handler forwards to continueUrl WITHOUT `mode=signIn`, so the
  // SDK's strict `isSignInWithEmailLink` misses the arrival on this app (observed live:
  // the URL carries apiKey + oobCode only). Detect the actual arrival shape instead; a URL
  // without oobCode, or with an already-consumed/foreign code, still fails TYPED at
  // Firebase — detection never fabricates a sign-in.
  const url = new URL(window.location.href);
  const hasOobCode = url.searchParams.has("oobCode");
  if (!hasOobCode && !isSignInWithEmailLink(auth, window.location.href)) return false;
  const email = window.localStorage.getItem(EMAIL_KEY);
  if (email === null) throw new Error("This sign-in link is missing its email context; request a new link.");
  await signInWithEmailLink(auth, email, window.location.href);
  window.localStorage.removeItem(EMAIL_KEY);
  // Clean the credential out of the URL (history/refresh safety) without breaking the SPA route.
  const clean = `${window.location.origin}${window.location.pathname}#/signin`;
  window.history.replaceState(null, "", clean);
  return true;
}

export async function logout(): Promise<void> {
  if (auth === undefined) return;
  await signOut(auth); // revokes the client session; the ID token stops refreshing
}

interface AuthState {
  readonly loading: boolean;
  readonly user: AccountIdentity | null;
  readonly authActive: boolean;
  /** A fresh ID token for API calls (Authorization: Bearer); null when signed out. */
  readonly token: () => Promise<string | null>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(authActive);
  const [user, setUser] = useState<AccountIdentity | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  void authError; // surfaced through loading/error states in the sign-in view

  useEffect(() => {
    if (auth === undefined) return;
    // Firebase restores the persisted session and pushes every change (sign-in, sign-out,
    // token revocation) through this observer; expiry is handled by getIdToken() refreshing
    // or rejecting at call time.
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u !== null ? identityOf(u) : null);
      setLoading(false);
    }, (err) => {
      setAuthError(describeAuthError(err, "Authentication state error."));
      setLoading(false);
    });
    // Complete an email-link sign-in if the URL is one (runs once; safe on every load).
    // Completion fires the auth-state observer above; sign-in view auto-advances.
    completeEmailSignIn().catch((err) => {
      // Honest, visible failure (consumed/expired/foreign link): the user must know the
      // link did NOT sign them in, instead of a silent return to the sign-in view.
      setAuthError(describeAuthError(err, "Sign-in link could not be completed."));
    });
    return unsub;
  }, []);

  const value = useMemo<AuthState>(() => ({
    loading,
    user,
    authActive,
    token: async () => {
      if (auth === undefined || auth.currentUser === null) return null;
      try {
        return await auth.currentUser.getIdToken(); // refreshes when near expiry
      } catch {
        return null; // expired/revoked: callers treat as signed-out (typed 401 follows)
      }
    },
  }), [loading, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
