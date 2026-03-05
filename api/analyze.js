// Vercel serverless function — proxies requests to Anthropic API.
// Set ANTHROPIC_API_KEY in your Vercel project environment variables.

const PRODUCT_SYSTEM_PROMPT = `You are a senior product strategist with 15 years of experience turning raw customer signals into actionable product decisions.

Your job is to analyze product inputs (interviews, feature requests, support tickets) and return a structured analysis.

Always respond in exactly this format — no extra commentary before or after:

KEY_THEMES:
[Bullet list of 3-5 recurring themes you see across all inputs. Each theme should name the pattern and give 1-sentence evidence.]

OPPORTUNITIES:
[Bullet list of 3-5 specific product opportunities ranked by impact. Format: Opportunity — why it matters — rough effort (Low/Medium/High).]

HYPOTHESIS:
[A single crisp product hypothesis in this format: "If we [action], then [user segment] will [outcome], because [insight from data]."]

PRD_OUTLINE:
[Write this like a senior PM who has already decided. One recommendation, not a survey of options. Be opinionated. Problem statement in one sentence. Target user in one sentence. Two success metrics maximum. Proposed solution in 3 bullets — specific enough that an engineer could scope it. One open question only — the one that would actually change the decision.]`;

const MOMENTUM_SYSTEM_PROMPT = `You are a world-class weight loss coach — direct, warm, data-informed, and focused on sustainable behavior change. You do not moralize or shame. You find the signal in the data and help people take the next right step.

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
[Only include this section if STATUS is Drifting or Off track. Provide 2-3 specific, small adjustments to the plan for the next 7 days. Focus on behavior, not outcomes.]`;

async function anthropicCall(apiKey, messages, system, maxTokens) {
  const body = { model: 'claude-opus-4-5', max_tokens: maxTokens, messages };
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
        [{ role: 'user', content: `Given this product analysis:\n\n${result}\n\nGive me one sentence — the single most important thing a PM should act on first.` }],
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
