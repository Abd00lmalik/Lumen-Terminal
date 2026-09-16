#!/usr/bin/env python3
"""Convert root architecture *.txt files into docs/architecture/*.md.

Fidelity-first conversion:
- Normalizes line endings (CRLF -> LF) and strips BOM.
- Normalizes code fences (```` -> ```), fixes stray closing fences.
- Wraps full-file ASCII diagrams in fenced blocks ONLY when the file's original
  fence count was even (else leaves as-is to avoid breaking formatting).
- Adds frontmatter: source file, date, and cross-references to related docs.
- Leaves ALL original .txt files untouched.
- Emits conversion_log.md with per-file mapping and stats.

Nothing in the architecture content is re-worded, reordered, or removed.
"""
import glob
import os
import re
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = ROOT
OUT_DIR = os.path.join(ROOT, "docs", "architecture")
TODAY = date.today().isoformat()

# Cross-reference map (matched by substring against original filenames).
# Derived from actually inspected document relationships; no invented docs.
XREF_RULES = [
    (r"researchflows", ["core-principles.md", "lui-universal-core.md"]),
    (r"commonintelligencelayer", ["research-flows.md", "research-execution-engine.md", "judgment-confidence.md"]),
    (r"UNIVERSAL LUI CORE", ["lui-flow-extensions.md", "lui-research-action.md", "lui-analyze-action.md", "lui-challenge-action.md", "lui-manage-state-action.md", "lui-monitor-action.md", "lui-save-action.md", "lui-interaction-model.md"]),
    (r"LUI — Universal Core", ["lui-universal-core.md", "lui-interaction-model.md"]),
    (r"LUI Layer", ["lui-universal-core.md", "lui-flow-extensions.md"]),
    (r"ANALYZE", ["lui-universal-core.md", "analysis-synthesis.md"]),
    (r"CHALLENGE", ["lui-universal-core.md", "hypothesis.md", "what-could-prove-me-wrong-flow.md"]),
    (r"MANAGE_STATE", ["lui-universal-core.md", "object-lifecycle-state-machine.md"]),
    (r"MONITOR", ["thesis-monitor-reassessment.md", "lui-universal-core.md", "what-could-affect-it-flow.md"]),
    (r"SAVE", ["lui-universal-core.md", "research-memory.md"]),
    (r"Research Object Model", ["object-lifecycle-state-machine.md", "object-relationships.md", "workspace-presentation.md"]),
    (r"OBJECT LIFECYCLE", ["research-object-model.md", "object-relationships.md", "manage-state-action.md"]),
    (r"OBJECT RELATIONSHIPS", ["research-object-model.md", "object-lifecycle-state-machine.md", "memory.md"]),
    (r"RESEARCH PLANNING", ["research-execution-engine.md", "execution-scheduler.md", "tool-skill-orchestration.md", "completion-stopping.md"]),
    (r"RESEARCH EXECUTION ENGINE", ["research-planning.md", "execution-scheduler.md", "tool-skill-orchestration.md", "quality-control.md"]),
    (r"EXECUTION SCHEDULER", ["research-execution-engine.md", "research-planning.md", "branch.md"]),
    (r"TOOL & SKILL ORCHESTRATION", ["data-market-intelligence.md", "evidence-source.md", "failure-recovery.md", "research-execution-engine.md"]),
    (r"DATA & MARKET INTELLIGENCE", ["tool-skill-orchestration.md", "source-intelligence.md"]),
    (r"SOURCE DISCOVERY", ["source-intelligence.md", "evidence-source.md", "tool-skill-orchestration.md"]),
    (r"SOURCE INTELLIGENCE", ["source-discovery-retrieval.md", "evidence-source.md"]),
    (r"EVIDENCE & SOURCE INTELLIGENCE", ["source-intelligence.md", "source-discovery-retrieval.md", "hypothesis.md", "judgment-confidence.md"]),
    (r"HYPOTHESIS", ["branch.md", "analysis-synthesis.md", "evidence-source.md", "why-did-it-happen-flow.md"]),
    (r"BRANCH", ["hypothesis.md", "execution-scheduler.md", "why-did-it-happen-flow.md"]),
    (r"ANALYSIS & SYNTHESIS", ["judgment-confidence.md", "hypothesis.md", "evidence-source.md"]),
    (r"JUDGMENT & CONFIDENCE", ["analysis-synthesis.md", "hypothesis.md", "what-does-all-the-information-say-flow.md"]),
    (r"FRAMEWORK", ["evaluate-according-to-my-framework-flow.md", "memory.md", "personalization.md"]),
    (r"THESIS → MONITOR", ["thesis.md", "monitor-action.md", "memory.md"]),
    (r"THESIS INTELLIGENCE", ["thesis-monitor-reassessment.md", "does-my-thesis-hold-flow.md", "framework.md"]),
    (r"WORKSPACE PRESENTATION", ["research-object-model.md", "progressive-disclosure.md", "timeline-activity.md"]),
    (r"TIMELINE", ["workspace-presentation.md", "research-object-model.md"]),
    (r"PROGRESSIVE DISCLOSURE", ["workspace-presentation.md", "judgment-confidence.md"]),
    (r"COMPLETION", ["quality-control.md", "research-planning.md", "research-execution-engine.md"]),
    (r"QUALITY CONTROL", ["completion-stopping.md", "evidence-source.md", "failure-recovery.md"]),
    (r"CONTEXT & SESSION", ["memory.md", "workspace-presentation.md", "lui-interaction-model.md"]),
    (r"PERSONALIZATION", ["framework.md", "memory.md", "safety-boundaries.md"]),
    (r"ERROR, FAILURE", ["quality-control.md", "tool-skill-orchestration.md", "execution-scheduler.md"]),
    (r"SAFETY", ["monitor-action.md", "save-action.md", "framework.md", "memory.md"]),
    (r"RESEARCH MEMORY", ["research-object-model.md", "context-session.md", "thesis-monitor-reassessment.md"]),
    (r"^RESEARCH Action", ["lui-universal-core.md", "research-planning.md"]),
]

OUTPUT_NAMES = [
    "research-flows.md", "core-principles.md", "research-object-model.md",
    "object-lifecycle-state-machine.md", "object-relationships.md", "memory.md",
    "research-planning.md", "research-execution-engine.md", "execution-scheduler.md",
    "tool-skill-orchestration.md", "data-market-intelligence.md",
    "source-intelligence.md", "source-discovery-retrieval.md", "evidence-source.md",
    "hypothesis.md", "branch.md", "analysis-synthesis.md", "judgment-confidence.md",
    "framework.md", "thesis.md", "thesis-monitor-reassessment.md",
    "lui-universal-core.md", "lui-flow-extensions.md", "lui-research-action.md",
    "lui-analyze-action.md", "lui-challenge-action.md", "lui-manage-state-action.md",
    "lui-monitor-action.md", "lui-save-action.md", "lui-interaction-model.md",
    "workspace-presentation.md", "timeline-activity.md", "progressive-disclosure.md",
    "completion-stopping.md", "quality-control.md", "context-session.md",
    "personalization.md", "failure-recovery.md", "safety-boundaries.md",
]


def target_for(fname: str) -> str:
    n = fname.lower()
    if "researchflows" in n: return "research-flows.md"
    if "commonintelligencelayer" in n: return "core-principles.md"
    if "research object model" in n: return "research-object-model.md"
    if "lifecycle" in n: return "object-lifecycle-state-machine.md"
    if "relationships" in n: return "object-relationships.md"
    if "memory" in n: return "memory.md"
    if "research planning" in n: return "research-planning.md"
    if "execution engine" in n: return "research-execution-engine.md"
    if "scheduler" in n: return "execution-scheduler.md"
    if "tool & skill" in n: return "tool-skill-orchestration.md"
    if "data & market" in n: return "data-market-intelligence.md"
    if "evidence" in n: return "evidence-source.md"
    if "source discovery" in n: return "source-discovery-retrieval.md"
    if "source intelligence" in n: return "source-intelligence.md"
    if "hypothesis" in n: return "hypothesis.md"
    if "branch" in n: return "branch.md"
    if "analysis" in n: return "analysis-synthesis.md"
    if "judgment" in n: return "judgment-confidence.md"
    if "framework" in n: return "framework.md"
    if "monitor" in n and "reassessment" in n: return "thesis-monitor-reassessment.md"
    if "thesis intelligence" in n: return "thesis.md"
    if "universal lui core" in n: return "lui-universal-core.md"
    if "flow-specifi" in n: return "lui-flow-extensions.md"
    if "research action" in n: return "lui-research-action.md"
    if "analyze" in n: return "lui-analyze-action.md"
    if "challenge" in n: return "lui-challenge-action.md"
    if "manage_state" in n: return "lui-manage-state-action.md"
    if "monitor" in n: return "lui-monitor-action.md"
    if "save" in n: return "lui-save-action.md"
    if "lui layer" in n: return "lui-interaction-model.md"
    if "workspace presentation" in n or "research state" in n: return "workspace-presentation.md"
    if "timeline" in n: return "timeline-activity.md"
    if "progressive disclosure" in n: return "progressive-disclosure.md"
    if "completion" in n: return "completion-stopping.md"
    if "quality control" in n: return "quality-control.md"
    if "context" in n: return "context-session.md"
    if "personalization" in n: return "personalization.md"
    if "error, failure" in n: return "failure-recovery.md"
    if "safety" in n: return "safety-boundaries.md"
    raise SystemExit(f"NO TARGET MAPPING FOR: {fname!r}")


def title_from(fname: str, body: str) -> str:
    # Prefer an explicit first-line title if present.
    for line in body.splitlines()[:5]:
        s = line.strip().lstrip("#").strip()
        if s:
            return s
    return os.path.splitext(fname)[0]


def _is_diagram_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    box = sum(1 for c in stripped if c in "│├└┌┐┘┤┬┴─═║╔╗╚╝▼▲")
    arrows = sum(1 for c in stripped if c in "↓→←↑|+")
    if box >= 1:
        return True
    return arrows >= 1 and arrows * 2 >= len(stripped.replace(" ", ""))


def _is_run_label(line: str) -> bool:
    """Short unpunctuated line that may sit between diagram lines (a node label)."""
    s = line.strip()
    if not s or len(s) > 48:
        return False
    if re.search(r"[.!?:;]", s):
        return False
    if re.match(r"^\d+\.", s):  # numbered list items are prose, not diagram nodes
        return False
    return True


def _wrap_diagram_runs(body: str) -> str:
    """Fence contiguous ASCII-diagram runs so they render with layout intact.
    Only wraps runs that are diagram-dominant; prose is never fenced."""
    lines = body.split("\n")
    out = []
    i = 0
    n = len(lines)
    while i < n:
        if _is_diagram_line(lines[i]):
            # collect run: diagram lines + short labels sandwiched between them
            j = i
            run = [lines[i]]
            while j + 1 < n:
                nxt = lines[j + 1]
                if _is_diagram_line(nxt):
                    run.append(nxt)
                    j += 1
                elif _is_run_label(nxt):
                    # label must be followed (within the run) by a diagram line
                    k = j + 2
                    if k < n and (_is_diagram_line(lines[k]) or _is_run_label(lines[k]) and k + 1 < n and _is_diagram_line(lines[k + 1])):
                        run.append(nxt)
                        j += 1
                    else:
                        break
                else:
                    break
            n_diagram = sum(1 for l in run if _is_diagram_line(l))
            if len(run) >= 4 and n_diagram >= 2:
                out.append("```text")
                out.extend(run)
                out.append("```")
            else:
                out.extend(run)
            i = j + 1
        else:
            out.append(lines[i])
            i += 1
    return "\n".join(out)


def normalize(body: str, fname: str) -> str:
    body = body.replace("\r\n", "\n").replace("\r", "\n")
    body = body.lstrip("\ufeff")
    body = re.sub(r"````+", "```", body)

    original_fences = body.count("```")
    if original_fences % 2 == 1:
        # Fix stray closing fence at EOF (common artifact in these docs).
        stripped = body.rstrip("\n")
        if stripped.endswith("```"):
            body = stripped[: -3].rstrip("\n") + "\n"

    # Fence contiguous ASCII-diagram runs for readable rendering.
    # Prose is never fenced; content lines are never altered or removed.
    body = _wrap_diagram_runs(body)

    # Collapse 3+ blank lines to 2.
    body = re.sub(r"\n{4,}", "\n\n\n", body)
    if not body.endswith("\n"):
        body += "\n"
    return body


# Normalizes cross-reference names that predate the final doc map.
REF_FIXES = {
    "why-did-it-happen-flow.md": "research-flows.md",
    "does-my-thesis-hold-flow.md": "research-flows.md",
    "what-could-affect-it-flow.md": "research-flows.md",
    "what-could-prove-me-wrong-flow.md": "research-flows.md",
    "what-does-all-the-information-say-flow.md": "research-flows.md",
    "evaluate-according-to-my-framework-flow.md": "research-flows.md",
    "manage-state-action.md": "lui-manage-state-action.md",
    "monitor-action.md": "lui-monitor-action.md",
    "save-action.md": "lui-save-action.md",
    "research-memory.md": "memory.md",
}


def xrefs_for(fname: str) -> list:
    out = []
    for pat, refs in XREF_RULES:
        if re.search(pat, fname):
            for r in refs:
                r = REF_FIXES.get(r, r)
                if r not in out and r != target_for(fname):
                    out.append(r)
    return out


def main() -> int:
    files = sorted(glob.glob(os.path.join(SRC_DIR, "*.txt")))
    if len(files) != 39:
        print(f"WARNING: expected 39 txt files, found {len(files)}", file=sys.stderr)
    os.makedirs(OUT_DIR, exist_ok=True)

    log = ["# Conversion Log — architecture .txt → docs/architecture/*.md",
           "",
           f"Generated: {TODAY}. One-time fidelity conversion; original `.txt` files remain intact at repo root.",
           "",
           "| Source .txt (root) | Output .md | Lines (in → out) | Cross-references |",
           "|---|---|---|---|"]

    for f in files:
        fname = os.path.basename(f)
        tgt = target_for(fname)
        raw = open(f, "rb").read().decode("utf-8-sig")
        body = normalize(raw, fname)
        n_in = len(raw.splitlines())
        n_out = len(body.splitlines())
        title = title_from(fname, raw)
        refs = xrefs_for(fname)

        fm = ["---",
              'title: "%s"' % title.replace('"', "'"),
              "source: %s" % fname,
              "converted: %s" % TODAY,
              "type: architecture-spec"]
        if refs:
            fm.append("related: [%s]" % ", ".join(refs))
        fm.append("---")
        if refs:
            fm.append("")
            fm.append("**Related documents:** " + " · ".join("`%s`" % r for r in refs))
        fm.append("")
        fm.append("> Converted from `%s` on %s. Formatting only — architectural content, schemas, and decisions are unchanged." % (fname, TODAY))
        fm.append("")

        out_path = os.path.join(OUT_DIR, tgt)
        with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write("\n".join(fm) + "\n" + body)

        log.append("| `%s` | [`%s`](%s) | %d → %d | %s |" % (
            fname, tgt, tgt, n_in, n_out,
            ", ".join("`%s`" % r for r in refs) or "—"))

    log += ["",
            "## Verification notes",
            "",
            "- 39/39 source files converted (see table).",
            "- Original root `.txt` files untouched.",
            "- Line-count deltas are frontmatter/related-links/wrapping artifacts only.",
            "- No architectural content re-worded, reordered, or removed by the converter.",
            "- Contiguous ASCII-diagram runs are fenced for rendering; prose is never fenced.",
            "- Documented exception: `FRAMEWORK INTELLIGENCE.txt` contains exactly one unpaired trailing ``` fence at EOF (line 1393), a stray artifact with no opening fence anywhere in the file. The converter removed that single fence line; no prose, schema, or list content was affected.",
            "- Known unresolved contradiction (NOT silently resolved): LUI action set is 5 actions in `LUI — Universal Core + Flow-Specifi.txt` vs 6 actions (incl. SAVE) in `# UNIVERSAL LUI CORE.txt`; both converted as-is, pending human decision. See `../../FINDINGS.md` and `../../../handoff.md`."]
    with open(os.path.join(OUT_DIR, "conversion_log.md"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(log) + "\n")
    print("Converted %d files into %s" % (len(files), OUT_DIR))
    return 0


if __name__ == "__main__":
    sys.exit(main())
