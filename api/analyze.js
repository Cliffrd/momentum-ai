// Vercel serverless function — proxies requests to Anthropic API.
// Set ANTHROPIC_API_KEY in your Vercel project environment variables.

const PRODUCT_SYSTEM_PROMPT = `You are a senior product strategist. Analyze raw customer signals and return a crisp, opinionated analysis.

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
Decide first: [one question only, the one that would change the decision]`;

const MOMENTUM_SYSTEM_PROMPT = `You are a world-class accountability coach — direct, warm, and focused on sustainable behavior change. You do not moralize or shame. You find the signal in what people tell you and help them take the next right step.

You will receive a daily check-in that includes: presence (yes/mostly/no), free-form proof of what happened, and optionally: goal weight, current weight, days elapsed, planned calorie deficit, and adherence %.

IMPORTANT: Weight data is always optional. If no weight data is provided, give a full, meaningful response based entirely on presence and the proof text. Never ask for numbers. Never say insufficient data. A person showing up and writing something honest is enough to coach from.

Respond in exactly this format — no extra commentary before or after:

STATUS: [On track / Drifting / Off track]
[One sentence explaining the status. If no weight data, base this on presence and proof alone.]

DAILY_ACTION:
[One specific, concrete action for today only. Start with a verb. Ground it in what the person actually wrote.]

DRIFT_SIGNAL:
[If STATUS is On track: None detected. Otherwise: name the specific behavior pattern causing drift.]

ENCOURAGEMENT:
[2-3 sentences. Acknowledge what IS working. Speak to where the person actually is. Reference what they actually wrote.]

ADJUSTED_PLAN:
[Only if STATUS is Drifting or Off track. 2-3 specific small adjustments for the next 7 days.]`

async function anthropicCall(apiKey, messages, system, maxTokens) {
  const body = { model: 'claude-sonnet-4-5', max_tokens: maxTokens, messages };
  if (system) body.system = system;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Anthropic API error ${res.status}`);
  }

  const data = await res.json();
  return data.content[0].text;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server' });

  const { type, input } = req.body || {};
  if (!input) return res.status(400).json({ error: 'input is required' });

  try {
    if (type === 'product') {
      const result = await anthropicCall(
        apiKey,
        [{ role: 'user', content: `Analyze these product inputs and return your structured analysis:\n\n${input}` }],
        PRODUCT_SYSTEM_PROMPT,
        2048,
      );
      const tldr = await anthropicCall(
        apiKey,
        [{ role: 'user', content: `Given this product analysis:\n\n${result}\n\nRespond with one sentence only. Start with a verb. No bold markers. No hedging.` }],
        null,
        128,
      );
      return res.status(200).json({ result, tldr: tldr.trim() });
    }

    if (type === 'momentum') {
      const result = await anthropicCall(
        apiKey,
        [{ role: 'user', content: input }],
        MOMENTUM_SYSTEM_PROMPT,
        1024,
      );
      return res.status(200).json({ result });
    }

    return res.status(400).json({ error: `Unknown type: ${JSON.stringify(type)}` });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
