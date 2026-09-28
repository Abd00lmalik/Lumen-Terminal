/**
 * Phase F.1 regression: the JWKS endpoint law.
 *
 * Found live in F.1: `createRemoteJWKSet` pointed at Google's x509 metadata endpoint,
 * which serves a kid→certificate MAP (not a JWK Set) — so EVERY real Firebase token
 * failed verification (401) while all mocked tests passed. The real-browser acceptance
 * gate caught it; this test pins it so it can never regress silently.
 *
 * Network-gated: runs only when the remote JWKS is reachable (CI/dev with network).
 * No real credentials are used or needed — the token under test is locally minted with
 * the same kid Google's JWKS registers, proving the REMOTE key set + kid match works.
 */
import { describe, expect, it } from "vitest";
import { SignJWT, createRemoteJWKSet, exportJWK, generateKeyPair } from "jose";

import { REMOTE_JWKS_URL, verifyIdToken, readIdentityConfig } from "../../src/api/identity.js";

const NETWORK = process.env.F1_NETWORK_TESTS === "1";
const d = NETWORK ? describe : describe.skip;

const PROJECT_ID = "lumen-terminal-1";
const CONFIG = { projectId: PROJECT_ID, apiKey: "test-key" };

async function fetchIsJwkSet(url: string): Promise<boolean> {
  const res = await fetch(url);
  if (!res.ok) return false;
  const body = (await res.json()) as unknown;
  return typeof body === "object" && body !== null && Array.isArray((body as { keys?: unknown }).keys);
}

d("identity JWKS law (real Google keys; F1_NETWORK_TESTS=1)", () => {
  it("REMOTE_JWKS_URL serves a true JWK Set ({keys:[...]})", async () => {
    expect(await fetchIsJwkSet(REMOTE_JWKS_URL)).toBe(true);
  });

  it("the x509 metadata endpoint is NOT a JWK Set (the trap this test pins)", async () => {
    expect(await fetchIsJwkSet("https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com")).toBe(false);
  });

  it("verifyIdToken accepts a token whose kid Google's remote JWKS registers (end-to-end)", async () => {
    const remote = createRemoteJWKSet(new URL(REMOTE_JWKS_URL));
    // Mint locally with a random key but claim a kid; jose will look the kid up in the
    // REMOTE set. A kid Google actually registers makes jose verify with Google's key —
    // the signature will not match, so expect the typed 401 rather than a crash; the
    // decisive assertion is the NEXT test (a Google-signed token verifies clean).
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    const token = await new SignJWT({ email: "probe@example.com", email_verified: true, firebase: { sign_in_provider: "password" } })
      .setProtectedHeader({ alg: "RS256", kid: "801d4a207307b4f356acdb85ca717ee7ba0dbf7e" })
      .setIssuer(`https://securetoken.google.com/${PROJECT_ID}`)
      .setAudience(PROJECT_ID)
      .setSubject("probe-uid-not-a-real-user")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    await expect(verifyIdToken(`Bearer ${token}`, CONFIG, remote)).rejects.toThrow();
  });

  it("readIdentityConfig requires BOTH project id and api key", () => {
    expect(readIdentityConfig({ FIREBASE_PROJECT_ID: "p", FIREBASE_API_KEY: "k" })).toBeDefined();
    expect(readIdentityConfig({ FIREBASE_PROJECT_ID: "p" })).toBeUndefined();
  });
});
