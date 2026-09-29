# Monitor — Product Definition (Phase H)

Monitor is **thesis-aware material change monitoring**: it watches the specific conditions that
matter to a user's thesis, detects meaningful changes through real research, and tells the user
when the change materially affects the thesis. The user remains the decision-maker.

Monitor is NOT: a price-alert system, an autonomous trading system, a notification spam feed, a
background LLM, an automatic thesis editor, or a buy/sell engine.

## Purpose

> Watch the specific conditions that matter to a user's thesis, detect meaningful changes,
> research those changes, and tell the user when the change materially affects the thesis.

## Ownership chain

`Authenticated User → Workspace → Thesis → Challenge/Falsifier → Monitor`

A monitor never exists outside a workspace. Creation is derived from the user's own Challenge
records (the falsifiers their challenge research identified) — the model invents no conditions.

## Lifecycle

`PROPOSED → ACTIVE → PAUSED ⇄ ACTIVE → COMPLETED`

- Lumen may **propose** a monitor; the user must explicitly activate it (typed confirmation in
  the UI, `POST /api/monitors/:ref/activate` over the API). Lumen cannot silently activate.
- Pausing is an explicit user action (or a documented system rule); a paused monitor executes
  nothing and incurs no research cost.
- A monitor cannot silently rewrite its own conditions, and it can never mutate the thesis
  (§12: the thesis is immutable to monitoring).

## Natural-language actions (LUI)

| Say | What happens |
| --- | --- |
| "Monitor this thesis." / "Monitor the factors that could invalidate my BTC thesis." | Monitor **proposal** from the thesis's challenge records (never silent activation) |
| "What should I monitor if this thesis is going to fail?" | **Proposal** — a question is never interpreted as activation |
| "Pause this monitor." / "Resume monitoring." | Explicit lifecycle transition |
| "What are my active monitors?" | Read the monitor workspace |
| "What changed in my monitored thesis?" | Latest assessments + notifications |
| "Check my BTC thesis (now)." | Manual check — same pipeline as scheduled checks |

## What the user sees

The Monitor page shows active/paused/proposed monitors, the challenge-derived conditions with
"why watching" rationale (derived from the thesis↔challenge relationship), last checked /
next scheduled / last material timestamps, latest assessments, and material-change notifications.

## Hard laws

1. Only **material** changes notify (meaningful+, fresh, evidence-cited). Ordinary price noise,
   duplicate headlines, stale articles, single-source claims, provider errors, missing data, and
   unrelated market movement never do. `NO DATA` is never `NEGATIVE CHANGE`.
2. Provider failure → `PROVIDER_UNAVAILABLE`; missing data → `INSUFFICIENT_EVIDENCE`;
   stale source → `STALE`. Infrastructure failure is never thesis evidence.
3. The thesis is never automatically changed — monitoring produces an implication
   ("weakens", "potentially invalidates assumption", "insufficient evidence") for the user to act on.
4. Every check's research is a normal History row (same engine, same provenance) linked back to
   the monitor and thesis. Saved artifacts remain explicit user intent only.
5. If the challenge a monitor watches changes state, the monitor does not rewrite itself; the
   change surfaces in the next assessment for the user to decide on.
