// api/cron-checkin.js
// Vercel Cron Job — proactive accountability agent for Momentum.
//
// Three cron triggers (set in vercel.json):
//   9am UTC  — morning check-in prompt (personalized to last entry)
//   12pm UTC — escalation nudge if no check-in yet today
//   6pm UTC  — streak at risk alert if streak active but no check-in today
//
// Required env vars:
//   ANTHROPIC_API_KEY, RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, CRON_SECRET

const SUPABASE_URL  = process.env.SUPABASE_URL || 'https://knedestzrnprdfqwjtow.supabase.co';
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const CRON_SECRET   = process.env.CRON_SECRET;

// ─── Prompts ────────────────────────────────────────────────────────────────

const MORNING_PROMPT = `You are a proactive accountability partner sending a morning check-in prompt.

User's last check-in: {last_checkin}

Current streak: {current_streak} consecutive On Track days. Longest streak ever: {longest_streak} days. Last check-in was {hours_since} hours ago.

Write a short, personal morning message (2-3 sentences max) that:
- Opens with one specific detail from their last check-in (weight, what they did, or their note)
- Sets up today with one concrete focus
- Feels like a message from someone who was paying attention, not a template

Respond in JSON only — no markdown fences:
{
  "subject": "email subject line — conversational, specific, never generic",
  "message": "2-3 sentence email body"
}

Rules:
- Reference their actual numbers or activities from the last check-in
- Never say 'Great job' or 'Keep it up' or any hollow phrase
- Subject line should feel like it came from a person, not an app
- Tone: warm, direct, like a coach who remembers everything`;

const ESCALATION_PROMPT = `You are a proactive accountability partner. The user has not checked in today.

Their recent history: {last_checkin}

Current streak: {current_streak} days on track. It is now midday. They haven't checked in yet.

Write a short midday nudge (1-2 sentences) that creates mild urgency without shaming. Reference their streak if it's 2 or more days.

Respond in JSON only — no markdown fences:
{
  "subject": "email subject line",
  "message": "1-2 sentence nudge"
}

Rules:
- Short and direct — this is a nudge, not a coaching session
- Never shame or guilt trip
- If streak >= 2, mention it specifically
- Tone: like a training partner checking in, not a notification`;

const STREAK_AT_RISK_PROMPT = `You are a proactive accountability partner. It is late in the day and the user has not checked in.

Current streak: {current_streak} consecutive On Track days. Longest streak ever: {longest_streak} days. Last check-in: {last_checkin_summary}

Write a streak protection message (2 sentences max). Be direct about the streak being at risk. Make it feel urgent but not dramatic.

Respond in JSON only — no markdown fences:
{
  "subject": "email subject line",
  "message": "2 sentence message"
}

Rules:
- Name the streak number explicitly
- One sentence on what's at stake, one sentence on what to do right now
- Never say 'don't forget' or 'just a reminder'
- Tone: direct, caring, zero fluff`;

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

function checkedInToday(checkins) {
  const today = new Date().toISOString().split('T')[0];
  return checkins.some(c => c.date === today);
}

function formatLastCheckin(c) {
  return `Date: ${c.date} | Status: ${c.status || 'unknown'} | Weight: ${c.current_weight_lbs}lb | ` +
    `Adherence: ${c.adherence_pct}% | Motivation: ${c.motivation_level}/10 | Notes: "${c.notes}"`;
}

function hoursSince(isoTimestamp) {
  return Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 36e5);
}

// ─── Detect cron trigger type from current UTC hour ─────────────────────────

function getTriggerType() {
  const hour = new Date().getUTCHours();
  if (hour >= 8 && hour < 11)  return 'morning';
  if (hour >= 11 && hour < 15) return 'escalation';
  if (hour >= 17)              return 'streak_at_risk';
  return 'morning'; // fallback
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

function parseClaudeJson(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

function streakFooter(currentStreak, longestStreak) {
  if (currentStreak === 0) return '';
  const pb = longestStreak > currentStreak
    ? ` | Personal best: ${longestStreak} days`
    : ' — new personal best!';
  return `\n\n---\nStreak: ${currentStreak} day${currentStreak === 1 ? '' : 's'} on track${pb}`;
}

// ─── Per-trigger logic ──────────────────────────────────────────────────────

async function handleMorning(checkins, currentStreak, longestStreak) {
  // Always send morning email — it's personalized to last check-in
  const latest = checkins[0];
  const hours  = hoursSince(latest.created_at);

  const prompt = MORNING_PROMPT
    .replace('{last_checkin}',    formatLastCheckin(latest))
    .replace('{current_streak}',  String(currentStreak))
    .replace('{longest_streak}',  String(longestStreak))
    .replace('{hours_since}',     String(hours));

  const raw      = await askClaude(prompt);
  const decision = parseClaudeJson(raw);
  return { should_send: true, ...decision };
}

async function handleEscalation(checkins, currentStreak) {
  // Only send if no check-in today
  if (checkedInToday(checkins)) {
    return { should_send: false, reason: 'already checked in today' };
  }
  const latest = checkins[0];
  const prompt = ESCALATION_PROMPT
    .replace('{last_checkin}',   formatLastCheckin(latest))
    .replace('{current_streak}', String(currentStreak));

  const raw      = await askClaude(prompt);
  const decision = parseClaudeJson(raw);
  return { should_send: true, ...decision };
}

async function handleStreakAtRisk(checkins, currentStreak, longestStreak) {
  // Only send if streak is active (2+ days) and no check-in today
  if (currentStreak < 2) {
    return { should_send: false, reason: 'streak too short to protect' };
  }
  if (checkedInToday(checkins)) {
    return { should_send: false, reason: 'already checked in today' };
  }

  const latest  = checkins[0];
  const summary = `${latest.current_weight_lbs}lb on ${latest.date}, status: ${latest.status}`;

  const prompt = STREAK_AT_RISK_PROMPT
    .replace('{current_streak}',      String(currentStreak))
    .replace('{longest_streak}',      String(longestStreak))
    .replace('{last_checkin_summary}', summary);

  const raw      = await askClaude(prompt);
  const decision = parseClaudeJson(raw);
  return { should_send: true, ...decision };
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

  // Allow manual override of trigger type via query param for testing
  // e.g. /api/cron-checkin?trigger=escalation
  const triggerOverride = req.query?.trigger;
  const triggerType     = triggerOverride || getTriggerType();

  const results = [];

  try {
    const users = await getDistinctUsers();

    for (const user of users) {
      const ctx = { user_id: user.user_id, trigger: triggerType };
      try {
        const checkins = await getLastCheckins(user.user_id, 20);
        if (checkins.length === 0) {
          results.push({ ...ctx, skipped: 'no check-ins found' });
          continue;
        }

        const email         = await getUserEmail(user.user_id);
        const currentStreak = computeCurrentStreak(checkins);
        const longestStreak = computeLongestStreak(checkins);

        let decision;
        if (triggerType === 'morning') {
          decision = await handleMorning(checkins, currentStreak, longestStreak);
        } else if (triggerType === 'escalation') {
          decision = await handleEscalation(checkins, currentStreak);
        } else if (triggerType === 'streak_at_risk') {
          decision = await handleStreakAtRisk(checkins, currentStreak, longestStreak);
        } else {
          decision = await handleMorning(checkins, currentStreak, longestStreak);
        }

        if (decision.should_send && email) {
          const footer = streakFooter(currentStreak, longestStreak);
          await sendEmail('cliffbarrett@gmail.com', decision.subject, decision.message + footer);
          results.push({
            ...ctx,
            sent:           true,
            subject:        decision.subject,
            current_streak: currentStreak,
            longest_streak: longestStreak,
          });
        } else {
          results.push({
            ...ctx,
            sent:   false,
            reason: decision.reason || 'no intervention needed',
          });
        }
      } catch (err) {
        results.push({ ...ctx, error: err.message });
      }
    }

    return res.status(200).json({ trigger: triggerType, processed: users.length, results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
