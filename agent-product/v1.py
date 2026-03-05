"""
Product Decision Agent v1
Analyzes raw product inputs and returns structured analysis.
"""

import anthropic
import os
from datetime import datetime

# ── Input Collection ─────────────────────────────────────────────────────────

def collect_input() -> str:
    import sys
    print("Paste your product inputs below (interviews, tickets, requests).")
    print("Press Ctrl+D when done.")
    print("─" * 60)
    return sys.stdin.read().strip()

# ── Prompt ───────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a senior product strategist with 15 years of experience turning raw customer signals into actionable product decisions.

Your job is to analyze product inputs (interviews, feature requests, support tickets) and return a structured analysis.

Always respond in exactly this format — no extra commentary before or after:

KEY_THEMES:
[Bullet list of 3-5 recurring themes you see across all inputs. Each theme should name the pattern and give 1-sentence evidence.]

OPPORTUNITIES:
[Bullet list of 3-5 specific product opportunities ranked by impact. Format: Opportunity — why it matters — rough effort (Low/Medium/High).]

HYPOTHESIS:
[A single crisp product hypothesis in this format: "If we [action], then [user segment] will [outcome], because [insight from data]."]

PRD_OUTLINE:
[Write this like a senior PM who has already decided. One recommendation, not a survey of options. Be opinionated. Problem statement in one sentence. Target user in one sentence. Two success metrics maximum. Proposed solution in 3 bullets — specific enough that an engineer could scope it. One open question only — the one that would actually change the decision.]"""

# ── Runs ─────────────────────────────────────────────────────────────────────

RUNS_DIR = os.path.join(os.path.dirname(__file__), "..", "runs")


def save_run(raw_input: str, analysis: str, tldr: str = "") -> str:
    os.makedirs(RUNS_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    filename = f"{ts}.md"
    path = os.path.join(RUNS_DIR, filename)
    content = f"# Product Analysis — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n## Input\n\n{raw_input}\n\n## Analysis\n\n{analysis}\n"
    if tldr:
        content += f"\n## TL;DR\n\n{tldr}\n"
    with open(path, "w") as f:
        f.write(content)
    return filename


# ── Agent ────────────────────────────────────────────────────────────────────

def run_product_agent(raw_input: str = None) -> str:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise EnvironmentError(
            "ANTHROPIC_API_KEY is not set. "
            "Run: export ANTHROPIC_API_KEY='your-key-here'"
        )

    client = anthropic.Anthropic(api_key=api_key)

    prompt = f"""Analyze these product inputs and return your structured analysis:

{raw_input}"""

    print("Running Product Decision Agent...")
    print("─" * 60)

    message = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )

    return client, message.content[0].text


def get_tldr(client: anthropic.Anthropic, analysis: str) -> str:
    message = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=128,
        messages=[{
            "role": "user",
            "content": (
                f"Given this product analysis:\n\n{analysis}\n\n"
                "Give me one sentence — the single most important thing a PM should act on first."
            ),
        }],
    )
    return message.content[0].text.strip()


def main():
    raw = collect_input()
    client, result = run_product_agent(raw)
    print(result)
    tldr = get_tldr(client, result)
    print(f"\nTL;DR: {tldr}")
    filename = save_run(raw, result, tldr)
    print("\n" + "─" * 60)
    print(f"Saved to runs/{filename}")
    print("Done.")


if __name__ == "__main__":
    main()
