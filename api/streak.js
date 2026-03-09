// api/streak.js
// Returns streak data for a user based on Supabase check-in history.
// GET /api/streak
//
// Response:
// {
//   current_streak: number,
//   longest_streak: number,
//   last_7: array,
//   streak_message: string | null,
//   total_checkins: number
// }

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://knedestzrnprdfqwjtow.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function getCheckins() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/checkins?select=*&order=created_at.desc`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

function computeCurrentStreak(checkins) {
  // Deduplicate by date — take the last entry per day
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

function getStreakMessage(streak) {
  if (streak === 0) return null;
  if (streak === 3) return "3 days straight. The habit is forming.";
  if (streak === 7) return "One full week. This is real now.";
  if (streak === 14) return "Two weeks. You're not the same person who started.";
  if (streak === 21) return "21 days. This is who you are now.";
  if (streak === 30) return "30 days. Exceptional.";
  if (streak > 30 && streak % 10 === 0) return `${streak} days. Rare territory.`;
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_KEY) {
    return res.status(500).json({ error: 'Missing SUPABASE_SERVICE_KEY' });
  }

  try {
    const checkins = await getCheckins();
    const last7 = checkins.slice(0, 7);
    const currentStreak = computeCurrentStreak(checkins);
    const longestStreak = computeLongestStreak(checkins);
    const streakMessage = getStreakMessage(currentStreak);

    return res.status(200).json({
      current_streak: currentStreak,
      longest_streak: longestStreak,
      last_7: last7,
      streak_message: streakMessage,
      total_checkins: checkins.length,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
