"""
Momentum Agent v1
Analyzes a daily weight loss check-in and returns a structured coaching response.
"""

import anthropic
import json
import os
import re
from datetime import date

# ── Test Input ──────────────────────────────────────────────────────────────

TEST_CHECKIN = {
    "goal_weight_lbs": 175,
    "current_weight_lbs": 191,
    "days_in": 19,
    "planned_daily_deficit_cals": 500,
    "adherence_pct": 80,
    "motivation_level": 7,
    "notes": "Bounced back today. Hit the gym, ate on plan, drank water. Feeling more like myself. Yesterday's check-in helped.",
}

# ── Prompt ───────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a world-class weight loss coach — direct, warm, data-informed, and focused on sustainable behavior change. You do not moralize or shame. You find the signal in the data and help people take the next right step.

You will receive a daily check-in with: goal weight, current weight, days elapsed, planned calorie deficit, adherence %, motivation level (1-10), and free-form notes.

Respond in exactly this format — no extra commentary before or after:

STATUS: [On track / Drifting / Off track]
[One sentence explaining the status based on the numbers.]

DAILY_ACTION:
[One specific, concrete action for today only. Make it achievable given the motivation level. Start with a verb.]

DRIFT_SIGNAL:
[If STATUS is On track: "None detected." Otherwise: name the specific behavior pattern causing drift — be precise, not generic.]

ENCOURAGEMENT:
[2-3 sentences. Acknowledge what IS working. Speak to where the person actually is emotionally, not where you wish they were. No toxic positivity.]

ADJUSTED_PLAN:
[Only include this section if STATUS is Drifting or Off track. Provide 2-3 specific, small adjustments to the plan for the next 7 days. Focus on behavior, not outcomes.]"""

# ── Memory ───────────────────────────────────────────────────────────────────

DATA_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "checkins.json")


def load_history() -> list:
    if not os.path.exists(DATA_FILE):
        return []
    with open(DATA_FILE, "r") as f:
        return json.load(f)


def save_entry(checkin: dict, status: str) -> None:
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    history = load_history()
    history.append({
        "date": date.today().isoformat(),
        "checkin": checkin,
        "status": status,
    })
    with open(DATA_FILE, "w") as f:
        json.dump(history, f, indent=2)


def count_streak(history: list) -> int:
    streak = 0
    for entry in reversed(history):
        if entry["status"].lower() == "on track":
            streak += 1
        else:
            break
    return streak


def detect_persistent_drift(history: list) -> bool:
    last_3 = [e["status"].lower() for e in history[-3:]]
    if len(last_3) < 3:
        return False
    return all(s in ("drifting", "off track") for s in last_3)


def format_history(history: list) -> str:
    if not history:
        return ""
    lines = ["RECENT HISTORY (last entries, oldest first):"]
    for entry in history[-7:]:
        c = entry["checkin"]
        lines.append(
            f"- {entry['date']}: {c['current_weight_lbs']} lbs, "
            f"adherence {c['adherence_pct']}%, motivation {c['motivation_level']}/10, "
            f"status {entry['status']}"
        )
    return "\n".join(lines)


# ── Agent ────────────────────────────────────────────────────────────────────

def format_checkin(checkin: dict) -> str:
    lbs_to_lose = checkin["current_weight_lbs"] - checkin["goal_weight_lbs"]
    expected_loss = (checkin["days_in"] * checkin["planned_daily_deficit_cals"]) / 3500
    return f"""DAILY CHECK-IN:
- Goal weight: {checkin["goal_weight_lbs"]} lbs
- Current weight: {checkin["current_weight_lbs"]} lbs
- Pounds remaining to goal: {lbs_to_lose} lbs
- Days in: {checkin["days_in"]}
- Planned daily calorie deficit: {checkin["planned_daily_deficit_cals"]} cals
- Expected weight loss by now (if fully adherent): {expected_loss:.1f} lbs
- Adherence: {checkin["adherence_pct"]}% of days fully on plan
- Motivation level: {checkin["motivation_level"]}/10
- Notes: {checkin["notes"]}"""


def run_momentum_agent(checkin: dict = None) -> str:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise EnvironmentError(
            "ANTHROPIC_API_KEY is not set. "
            "Run: export ANTHROPIC_API_KEY='your-key-here'"
        )

    client = anthropic.Anthropic(api_key=api_key)
    data = checkin or TEST_CHECKIN
    formatted = format_checkin(data)

    history = load_history()
    history_text = format_history(history)
    persistent_drift = detect_persistent_drift(history)
    streak = count_streak(history)

    DRIFT_ALERT = (
        "ALERT: This user has been Drifting or Off Track for 3+ consecutive days. "
        "This is a pattern. Do not encourage. Do not soften. Be direct: name the specific "
        "behavior that is causing drift, tell them the one thing that matters this week and "
        "nothing else, and cut the adjusted plan to a single non-negotiable action. If they "
        "do not do this one thing, the goal is at risk. Say that."
    )

    parts = []
    if history_text:
        parts.append(history_text)
    if persistent_drift:
        parts.append(DRIFT_ALERT)
    parts.append(formatted)
    user_content = "\n\n".join(parts)

    print("Running Momentum Agent...")
    if streak > 0:
        print(f"🔥 Current streak: {streak} day(s) on track")
    print("─" * 60)
    print(formatted)
    if history_text:
        print("\n" + history_text)
    if persistent_drift:
        print(f"\n⚠ Persistent drift detected — escalation prompt injected.")
    print("─" * 60)

    message = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    )

    response = message.content[0].text

    # Extract STATUS — handles plain "STATUS:" and bold "**STATUS:**"
    match = re.search(r"\*{0,2}STATUS:\*{0,2}\s*(.+)", response)
    status = match.group(1).split(".")[0].strip() if match else "Unknown"
    print(f"Extracted status: '{status}'")
    save_entry(data, status)

    return response


def main():
    result = run_momentum_agent()
    print(result)
    print("\n" + "─" * 60)
    print("Done.")


if __name__ == "__main__":
    main()
