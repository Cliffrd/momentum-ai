#!/usr/bin/env python3
"""
Momentum AI — local development server.

Serves ui/ as static files and proxies Anthropic API calls so the
browser never needs to hold a long-lived API key.

Usage:
    python3 server.py
    open http://localhost:8000/product-agent.html
"""

import json
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

PORT = 8000
UI_DIR = Path(__file__).parent / "ui"

# ── System prompts (verbatim from the Python agents) ─────────────────────────

PRODUCT_SYSTEM_PROMPT = """You are a senior product strategist. Analyze raw customer signals and return a crisp, opinionated analysis.

Respond in exactly this format — no markdown formatting, no bold markers, no asterisks, no extra commentary before or after:

KEY_THEMES:
[Three themes maximum. One sentence each. No inline evidence citations. Just the clean insight.]

OPPORTUNITIES:
[Three opportunities maximum. Each on its own line, formatted exactly as:
Opportunity name — why it matters — effort level]

HYPOTHESIS:
[One sentence. Crisp and direct. No structural template required.]

PRD_OUTLINE:
Problem: [one sentence]
User: [one sentence]
Win condition: [one metric only]
Build this:
- [specific action, under 10 words]
- [specific action, under 10 words]
- [specific action, under 10 words]
Decide first: [one question only, the one that would change the decision]"""

MOMENTUM_SYSTEM_PROMPT = """You are a world-class weight loss coach — direct, warm, data-informed, and focused on sustainable behavior change. You do not moralize or shame. You find the signal in the data and help people take the next right step.

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

# ── CORS / MIME ───────────────────────────────────────────────────────────────

CORS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".json": "application/json",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".svg":  "image/svg+xml",
    ".ico":  "image/x-icon",
    ".txt":  "text/plain; charset=utf-8",
}

# ── Anthropic API calls ───────────────────────────────────────────────────────

def anthropic_call(api_key: str, messages: list, system: str = None, max_tokens: int = 2048) -> str:
    payload = {"model": "claude-opus-4-5", "max_tokens": max_tokens, "messages": messages}
    if system:
        payload["system"] = system

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type":      "application/json",
            "x-api-key":         api_key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read())["content"][0]["text"]
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get("error", {}).get("message", f"HTTP {e.code}")
        except Exception:
            msg = f"Anthropic API error {e.code}"
        raise RuntimeError(msg)


def run_product(input_text: str, api_key: str) -> dict:
    """Two-step: full analysis then TL;DR (mirrors agent-product/v1.py)."""
    analysis = anthropic_call(
        api_key,
        [{"role": "user", "content": f"Analyze these product inputs and return your structured analysis:\n\n{input_text}"}],
        system=PRODUCT_SYSTEM_PROMPT,
        max_tokens=2048,
    )
    tldr = anthropic_call(
        api_key,
        [{"role": "user", "content": (
            f"Given this product analysis:\n\n{analysis}\n\n"
            "Respond with one sentence only. Start with a verb. No bold markers. No hedging."
        )}],
        max_tokens=128,
    )
    return {"result": analysis, "tldr": tldr.strip()}


def run_momentum(input_text: str, api_key: str) -> dict:
    """Single call (mirrors agent-momentum/v1.py)."""
    return {"result": anthropic_call(
        api_key,
        [{"role": "user", "content": input_text}],
        system=MOMENTUM_SYSTEM_PROMPT,
        max_tokens=1024,
    )}

# ── HTTP handler ──────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        parts = (args[0] if args else "").split()
        method = parts[0] if parts else "?"
        path   = parts[1] if len(parts) > 1 else "?"
        status = args[1] if len(args) > 1 else "?"
        print(f"  {status}  {method} {path}")

    # CORS preflight
    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in CORS.items():
            self.send_header(k, v)
        self.end_headers()

    # Static file server
    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/":
            path = "/product-agent.html"
        file_path = UI_DIR / path.lstrip("/")
        if not file_path.is_file():
            self.send_error(404, f"Not found: {path}")
            return
        data = file_path.read_bytes()
        mime = MIME.get(file_path.suffix.lower(), "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        for k, v in CORS.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    # API endpoint
    def do_POST(self):
        if self.path != "/api/analyze":
            self.send_error(404)
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body   = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, ValueError):
            self._json({"error": "Invalid JSON body"}, 400)
            return

        api_key    = body.get("apiKey",  "").strip()
        input_text = body.get("input",   "").strip()
        req_type   = body.get("type",    "")

        if not api_key:
            self._json({"error": "apiKey is required"}, 400)
            return
        if not input_text:
            self._json({"error": "input is required"}, 400)
            return

        try:
            if req_type == "product":
                self._json(run_product(input_text, api_key))
            elif req_type == "momentum":
                self._json(run_momentum(input_text, api_key))
            else:
                self._json({"error": f"Unknown type: {req_type!r}"}, 400)
        except RuntimeError as e:
            self._json({"error": str(e)}, 502)
        except Exception as e:
            self._json({"error": f"Server error: {e}"}, 500)

    def _json(self, data: dict, status: int = 200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in CORS.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if not UI_DIR.is_dir():
        print(f"Error: ui/ directory not found at {UI_DIR}", file=sys.stderr)
        sys.exit(1)

    server = HTTPServer(("", PORT), Handler)
    print(f"\n  Momentum AI  →  http://localhost:{PORT}\n")
    print(f"  Product Agent   http://localhost:{PORT}/product-agent.html")
    print(f"  Momentum        http://localhost:{PORT}/momentum-agent.html")
    print(f"\n  Ctrl+C to stop\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
