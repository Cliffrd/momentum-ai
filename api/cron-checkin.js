// api/cron-checkin.js
// Vercel Cron Job — proactive accountability agent for Momentum.
// Runs on schedule defined in vercel.json. Vercel sends GET requests to cron paths.
//
// Required env vars:
//   ANTHROPIC_API_KEY     — Anthropic API key
//   RESEND_API_KEY        — Resend email API key
//   SUPABASE_URL          — https://knedestzrnprdfqwjtow.supabase.co
//   SUPABASE_SERVICE_KEY  — Supabase service role key (bypasses RLS)
//   CRON_SECRET           — Arbitrary secret; set in Vercel env and in cron auth header

const SUPABASE_URL  = process.env.SUPABASE_URL || 'https://knedestzrnprdfqwjtow.supabase.co';
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const CRON_SECRET   = process.env.CRON_SECRET;

// ─── Prompt ────────────────────────────────────────────────────────────────

const INTERVENTION_PROMPT = `You are a proactive accountability partner. Review this user's check-in history and decide if they need an intervention today.

History:
{last_7_checkins}

Last check-in was {hours_since} hours ago. Current streak: {current_streak} consecutive On Track days. Longest streak ever: {longest_streak} days.

Respond in JSON only — no markdown fences, no extra text:
{
  "should_intervene": true,
  "reason": "one sentence why",
  "intervention_type": "gentle_nudge" | "missed_checkin" | "drift_pattern" | "encouragement" | "milestone",
  "subject": "email subject line",
  "message": "personal 2-3 sentence email body"
}

Rules:
- If checked in today and status is On Track and streak < 3: should_intervene false
- If no check-in in 9+ hours: should_intervene true, type missed_checkin
- If 2 or more of the last check-ins are Drifting or Off Track: should_intervene true, type drift_pattern
- If current_streak is exactly 3, 7, 14, 21, or 30: should_intervene true, type milestone — celebrate it specifically
- If 3+ consecutive On Track check-ins and no encouragement sent this week: should_intervene true, type encouragement
- Otherwise: should_intervene false
- Message tone: warm, direct, non-shaming. Reference specific numbers from their history.
- For milestone messages: be direct and specific about the streak number. No hollow cheerleading.
- Subject line: conversational, never salesy or robotic.`;

// ─── Supabase helpers ───────────────────────────────────────────────────────

async function sbFetch(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getDistinctUsers() {
  const rows = await sbFetch('/checkins?select=user_id&order=created_at.desc');
  const seen = new Set();
  return rows.filter(r => {
    if (seen.has(r.user_id)) return false;
    seen.add(r.user_id);
    return true;
  });
}

async function getUserEmail(userId) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.email ?? null;
}

async function getLastCheckins(userId, limit = 20) {
  return sbFetch(
    `/checkins?user_id=eq.${encodeURIComponent(userId)}&select=*&order=created_at.desc&limit=${limit}`
  );
}

// ─── Streak helpers ─────────────────────────────────────────────────────────

function computeCurrentStreak(checkins) {
  const byDate = {};
  for (const c of [...checkins].reverse()) {
    byDate[c.date] = c;
  }
  const sorted = Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date));
  let streak = 0;
  for (const entry of sorted) {
    if (entry.status && entry.status.toLowerCase() === 'on track') {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function computeLongestStreak(checkins) {
  const byDate = {};
  for (const c of [...checkins].reverse()) {
    byDate[c.date] = c;
  }
  const sorted = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  let longest = 0;
  let current = 0;
  for (const entry of sorted) {
    if (entry.status && entry.status.toLowerCase() === 'on track') {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

// ─── Claude helper ──────────────────────────────────────────────────────────

async function askClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 512,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Anthropic ${res.status}`);
  }
  const data = await res.json();
  return data.content[0].text;
}

// ─── Resend helper ──────────────────────────────────────────────────────────

async function sendEmail(to, subject, text) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${RESEND_KEY}`,
    },
    body: JSON.stringify({ from: 'onboarding@resend.dev', to: [to], subject, text }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Resend ${res.status}`);
  }
  return res.json();
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function hoursSince(isoTimestamp) {
  return Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 36e5);
}

function formatHistory(checkins) {
  return checkins.map((c, i) =>
    `[${i + 1}] ${c.date} | Status: ${c.status || 'unknown'} | ` +
    `Weight: ${c.current_weight_lbs}lb | Adherence: ${c.adherence_pct}% | ` +
    `Motivation: ${c.motivation_level}/10 | Notes: "${c.notes}"`
  ).join('\n');
}

function parseClaudeJson(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

// ─── Handler ────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (CRON_SECRET && req.headers['authorization'] !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const missing = ['SUPABASE_SERVICE_KEY', 'ANTHROPIC_API_KEY', 'RESEND_API_KEY']
    .filter(k => !process.env[k]);
  if (missing.length) {
    return res.status(500).json({ error: `Missing env vars: ${missing.join(', ')}` });
  }

  const results = [];

  try {
    const users = await getDistinctUsers();

    for (const user of users) {
      const ctx = { user_id: user.user_id };
      try {
        const checkins = await getLastCheckins(user.user_id, 20);
        if (checkins.length === 0) {
          results.push({ ...ctx, skipped: 'no check-ins found' });
          continue;
        }

        const email         = await getUserEmail(user.user_id);
        const latest        = checkins[0];
        const hours         = hoursSince(latest.created_at);
        const history       = formatHistory(checkins.slice(0, 7));
        const currentStreak = computeCurrentStreak(checkins);
        const longestStreak = computeLongestStreak(checkins);

        const prompt = INTERVENTION_PROMPT
          .replace('{last_7_checkins}', history)
          .replace('{hours_since}',     String(hours))
          .replace('{current_streak}',  String(currentStreak))
          .replace('{longest_streak}',  String(longestStreak));

        const raw      = await askClaude(prompt);
        const decision = parseClaudeJson(raw);

        if (decision.should_intervene && email) {
          const streakFooter = currentStreak > 0
            ? `\n\n---\nCurrent streak: ${currentStreak} day${currentStreak === 1 ? '' : 's'} on track${longestStreak > currentStreak ? ` | Personal best: ${longestStreak} days` : ' — new personal best!'}`
            : '';

          await sendEmail('cliffbarrett@gmail.com', decision.subject, decision.message + streakFooter);
          results.push({
            ...ctx,
            sent:           true,
            type:           decision.intervention_type,
            reason:         decision.reason,
            current_streak: currentStreak,
            longest_streak: longestStreak,
          });
        } else {
          results.push({
            ...ctx,
            sent:           false,
            reason:         decision.reason,
            current_streak: currentStreak,
          });
        }
      } catch (err) {
        results.push({ ...ctx, error: err.message });
      }
    }

    return res.status(200).json({ processed: users.length, results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
