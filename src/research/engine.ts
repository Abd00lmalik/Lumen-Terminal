/**
 * Research engine shell (M0).
 *
 * Architectural basis: research-execution-engine.md, tool-skill-orchestration.md §41.
 * M0 ships only the capability-first routing seam; flows (Flow 1 in M2), LUI (M3), and
 * transports (M1) are deliberately not implemented here. The engine asks "what capability?",
 * the registry resolves providers, and results are returned as normalized TOOL_RESULTs for
 * evidence ingestion. It performs no evidence fabrication and owns no truth.
 */

import type { CapabilityRegistry } from "../adapters/capability-registry.js";
import type { ToolResult } from "../domain/tool-result.js";
import type { ProvenanceOrigin } from "../domain/provenance.js";
import type { Workspace } from "../domain/workspace.js";
import type { WorkspaceStore } from "../persistence/index.js";

export interface EngineOptions {
  readonly registry: CapabilityRegistry;
  readonly store: WorkspaceStore;
}

export class ResearchEngine {
  constructor(private readonly options: EngineOptions) {}

  /**
   * Execute a capability requirement. This is the lock §6 pipeline, reduced to its M0-safe core:
   * capability requirement → registry (provider selection + fallback) → normalized TOOL_RESULT.
   * Evidence validation/classification (evidence.ts) and graph updates (workspace.ts) consume
   * the result; nothing here invents outputs.
   */
  async executeCapability(
    capability: string,
    params: Record<string, unknown>,
    origin: ProvenanceOrigin,
  ): Promise<ToolResult> {
    return this.options.registry.execute(capability, params, origin);
  }

  /** Persistence hook: workspace survives beyond individual messages (lock §14). */
  async persist(workspace: Workspace): Promise<void> {
    await this.options.store.save(workspace.toSnapshot());
  }

  async restore(): Promise<Workspace | undefined> {
    return this.options.store.load();
  }
}
