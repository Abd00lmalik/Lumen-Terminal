/**
 * Phase F identity layer: Firebase ID-token verification for a plain Fastify API.
 *
 * Chosen approach (Phase F decision, user-approved): Firebase Auth on the SPA issues
 * short-lived ID tokens (RS256 JWTs); THIS server verifies each one per request against
 * Google's public keys (JWK Set) via `jose` — no service-account secret, no session store,
 * no cookies to forge. Verification checks signature, issuer, audience, expiry, and (for
 * email sign-in) the provider's `email_verified` claim, so an unverified email identity
 * is never trusted.
 *
 * Fail-closed law: when Phase F auth is enabled (Firebase configured), a request without
 * a valid token NEVER falls back to the shared workspace — it is a typed 401. An OPEN
 * mode exists ONLY for tests and local dev (no Firebase env present), so the entire
 * existing test suite and dev flow keep working unchanged; production is always gated.
 *
 * No credential ever appears in an error message or log; token contents are never logged.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { ApiFailure } from "./errors.js";

/** The authenticated caller, derived ONLY from a verified token (never client fields). */
export interface AuthenticatedUser {
  /** Firebase uid — the workspace ownership boundary (stable, unique, never an email). */
  readonly uid: string;
  /** Email when present in the token; may be undefined (e.g. some Google-only accounts). */
  readonly email?: string;
  /** True when the token's email is provider-verified (required for email sign-in). */
  readonly emailVerified: boolean;
  /** The auth method that produced this session ("google.com" | "password" | …). */
  readonly provider: string;
}

/** Typed 401: authentication failed or was not attempted. */
export class UnauthorizedError extends ApiFailure {
  constructor(message = "Sign in required. Your session is missing or expired.") {
    super(401, "UNAUTHORIZED", message);
  }
}

/**
 * Firebase project configuration for token verification (server-side only). Presence of
 * BOTH values enables auth; anything less keeps the API in explicit OPEN mode (tests/dev).
 */
export interface IdentityConfig {
  readonly projectId: string;
  readonly apiKey: string;
}

/** Read the identity config from env (presence-only booleans are safe to expose). */
export function readIdentityConfig(env: NodeJS.ProcessEnv = process.env): IdentityConfig | undefined {
  const projectId = env.FIREBASE_PROJECT_ID;
  const apiKey = env.FIREBASE_API_KEY;
  if (projectId === undefined || projectId === "" || apiKey === undefined || apiKey === "") return undefined;
  return { projectId, apiKey };
}

/** True when the API must enforce authentication (production law). */
export function authEnabled(config: IdentityConfig | undefined): boolean {
  return config !== undefined;
}

const ISSUER_PREFIX = "https://securetoken.google.com/";
/**
 * Google's public keys for Firebase ID tokens, as a true JWK Set (jose requirement).
 * The x509 metadata endpoint (robot/v1/metadata/x509) serves a kid→certificate MAP, not
 * `{keys:[…]}` — createRemoteJWKSet against it silently matches no key and EVERY token
 * fails verification (found live in Phase F.1: real tokens 401'd while all mocked tests
 * passed). The service_accounts JWK endpoint serves the same key set (same kids) as JWK.
 */
export const REMOTE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
/** Google rotates keys; jose caches and refreshes the JWKS on unknown `kid`s. */
const JWKS = createRemoteJWKSet(new URL(REMOTE_JWKS_URL));

/** Verify a Firebase ID token and return the trusted identity, or throw UnauthorizedError.
 *  `keys` is a test seam (createLocalJWKSet) — production always uses Google's remote JWKS. */
export async function verifyIdToken(
  raw: string | undefined,
  config: IdentityConfig,
  keys: ReturnType<typeof createRemoteJWKSet> = JWKS,
): Promise<AuthenticatedUser> {
  if (raw === undefined || raw === "") throw new UnauthorizedError();
  const token = raw.startsWith("Bearer ") ? raw.slice("Bearer ".length).trim() : raw;
  if (token === "") throw new UnauthorizedError();
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, keys, {
      issuer: `${ISSUER_PREFIX}${config.projectId}`,
      audience: config.projectId,
    }));
  } catch {
    // Signature/issuer/audience/expiry failures are the SAME typed 401: never logged with
    // token contents, never leaked details about WHY (defends token-probing clients).
    throw new UnauthorizedError();
  }
  const uid = typeof payload.sub === "string" ? payload.sub : undefined;
  if (uid === undefined || uid === "") throw new UnauthorizedError();
  const email = typeof payload.email === "string" && payload.email !== "" ? payload.email : undefined;
  const emailVerified = payload.email_verified === true;
  const provider = typeof payload.firebase === "object" && payload.firebase !== null
    && typeof (payload.firebase as { sign_in_provider?: unknown }).sign_in_provider === "string"
    ? (payload.firebase as { sign_in_provider: string }).sign_in_provider
    : "unknown";
  // EMAIL SIGN-IN LAW: an email identity is trusted only when the provider verified it.
  // Google accounts carry email_verified true by construction; email-link too. Anything
  // else (an unverified password account) cannot act as a verified identity here.
  if (email !== undefined && !emailVerified && provider !== "anonymous") {
    throw new UnauthorizedError("Email address not verified. Verify your email, then sign in again.");
  }
  return { uid, ...(email !== undefined ? { email } : {}), emailVerified, provider };
}

/** Extract the bearer token from an Authorization header (undefined when absent). */
export function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const [scheme, value] = header.split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer" || value === undefined || value.trim() === "") return undefined;
  return value.trim();
}
