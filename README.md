# Momentum AI

Two single-file AI agents built from scratch using the Anthropic SDK. No frameworks. No abstraction layers. Just prompts, structured outputs, and enough logic to make them actually useful.

---

## Setup

```bash
pip install anthropic
export ANTHROPIC_API_KEY='your-key-here'
```

Add the export to `~/.zshrc` or `~/.bashrc` to make it stick.

---

## Agent 1 — Product Decision Agent

`agent-product/v1.py`

Takes raw, messy product signal — customer interview notes, support ticket themes, feature request counts — and returns a structured analysis a PM can act on in the next sprint.

**Run it:**
```bash
python3 momentum-ai/agent-product/v1.py
```

Paste your raw input at the prompt, then hit `Ctrl+D` when done.

**Output:**
- `KEY_THEMES` — 3-5 patterns across all inputs, with evidence
- `OPPORTUNITIES` — ranked by impact, with effort estimates
- `HYPOTHESIS` — one crisp "If we / then / because" statement
- `PRD_OUTLINE` — problem statement, target user, success metrics, proposed solution, open questions for the top opportunity
- `TL;DR` — a second API call that distills the whole thing to one sentence: the single thing a PM should do first

**Audit trail:**

Every run saves a timestamped markdown file to `runs/YYYY-MM-DD_HH-MM-SS.md` with the full input, analysis, and TL;DR. You end up with a log of every analysis you've ever run, which is useful when you want to see how your thinking evolved or share a specific output.

---

## Agent 2 — Momentum Agent

`agent-momentum/v1.py`

A daily weight loss coaching agent. You give it a check-in — goal weight, current weight, days in, planned deficit, adherence %, motivation level, and notes — and it gives you a coaching response calibrated to where you actually are, not where a generic plan assumes you should be.

**Run it:**
```bash
python3 momentum-ai/agent-momentum/v1.py
```

Edit `TEST_CHECKIN` in the file to change the input data.

**Output:**
- `STATUS` — On track / Drifting / Off track, with one sentence of reasoning
- `DAILY_ACTION` — one concrete thing to do today, sized to your motivation level
- `DRIFT_SIGNAL` — the specific behavior pattern causing drift (not a generic label)
- `ENCOURAGEMENT` — 2-3 sentences that acknowledge what's actually working
- `ADJUSTED_PLAN` — only appears when drifting or off track; behavior-level changes for the next 7 days

**Memory:**

Every check-in is saved to `data/checkins.json` as a JSON array with date, full input, and extracted status. On the next run, the last 7 entries are included in the prompt as `RECENT HISTORY` so the agent can spot trends — not just react to today's data in isolation.

**Drift detection:**

Before each API call, the agent checks the last 3 entries. If all 3 are `Drifting` or `Off track`, it injects an escalation alert into the prompt: this is a pattern, not a bad day — be more direct, reset expectations, simplify the plan. The response you get back is noticeably different in tone and specificity when this fires.

**Streak counter:**

If the most recent entries are all `On track`, the current streak is printed before each run:
```
🔥 Current streak: 4 day(s) on track
```
Nothing is printed when the streak is 0. No false encouragement.

---

## Project structure

```
momentum-ai/
  agent-product/
    v1.py
  agent-momentum/
    v1.py
  data/
    checkins.json     # persistent memory for the momentum agent
  runs/
    YYYY-MM-DD_HH-MM-SS.md   # one file per product agent run
  README.md
```

---

## What I'm learning

**Prompt pipelines.** The product agent makes two API calls in sequence — the second one receives the first one's output as context. Small chain, but it reveals how much you can do by just composing prompts rather than writing code.

**Structured outputs without a framework.** Both agents return fixed-format text (not JSON, not function calls) enforced entirely through the system prompt. This is fragile if you push it too far, but surprisingly robust for a small number of named fields. Understanding where it breaks is the point.

**Memory patterns.** The momentum agent's `checkins.json` is the simplest possible memory: read a file, prepend it to the prompt, append a new entry after the call. No vector DB, no embeddings. It works well enough to detect multi-day patterns, which is the actual goal.

**Behavioral feedback loops.** The drift escalation is the most interesting thing built so far. The agent's behavior changes based on accumulated history, not just the current input. That's a meaningful shift from "stateless text generator" to something that can actually track a user over time.

**Versioning prompts like code.** Each meaningful change gets a new version file. This makes it easy to diff what changed and run the old version if a "better" prompt turns out to perform worse on real data.
