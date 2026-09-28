/**
 * Challenge service (Phase G). Reads the workspace's persisted falsification challenges and
 * runs the challenge (Flow 7 methodology) against the workspace's thesis. Challenges are
 * research results ABOUT the thesis; nothing here mutates a thesis.
 */
import { http } from "./client.js";
import type { ChallengeDto, ChallengeRunDto } from "./types.js";

export function listChallenges(query: { readonly thesisRef?: string } = {}): Promise<readonly ChallengeDto[]> {
  const params = new URLSearchParams();
  if (query.thesisRef !== undefined) params.set("thesisRef", query.thesisRef);
  const suffix = params.toString();
  return http.get<readonly ChallengeDto[]>(`/api/challenges${suffix === "" ? "" : `?${suffix}`}`);
}

export function runChallenge(thesisRef?: string): Promise<ChallengeRunDto> {
  return http.post<ChallengeRunDto>("/api/challenge", thesisRef === undefined ? {} : { thesisRef });
}
