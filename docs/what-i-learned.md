# What I Learned Building Momentum AI

*A personal log. First two days. March 2026.*

---

## What I Built

I built two AI agents from scratch in two days. The first is a Product Agent: you paste in raw customer signals — support tickets, survey responses, sales call notes, whatever — and it synthesizes them into KEY_THEMES, OPPORTUNITIES, a testable HYPOTHESIS, and a PRD_OUTLINE with a problem statement, target user, win condition, three specific things to build, and the one question you need to answer before you start. It also generates a one-sentence TL;DR that starts with a verb. No hedging. No "it appears that." Just the thing.

The second is a Momentum Agent — a daily weight loss check-in tool. You log your goal weight, current weight, days elapsed, planned calorie deficit, adherence, motivation (1–10), and any notes. The agent responds with a STATUS (On track / Drifting / Off track), a single concrete action for today, a DRIFT_SIGNAL if something's going wrong, genuine encouragement, and — if you're drifting — specific small behavioral adjustments for the next seven days. Both agents are live on Vercel. Both use Claude Opus. Both took less time to build than I expected by a significant margin.

---

## What Surprised Me

**How fast it reasons across sources.** I didn't expect the synthesis to feel this clean. You paste in 800 words of mixed-format signal from three different tools and it doesn't just summarize — it finds the pattern underneath. That's not search. That's something closer to judgment.

**The cross-source math moment.** I fed in support ticket data alongside survey responses, and the agent correctly inferred that 44 tickets from one source plus 67 from another pointed to the same friction point — 111 signals converging on the same theme. It didn't need me to label them. It just saw it. That was the moment I understood what "synthesis" actually means in this context.

**Drift detection is more specific than I expected.** I thought it would give me generic coaching ("try harder this week"). Instead it named a precise behavioral pattern: slippage on Thursday through Sunday, correlated with lower motivation scores those days. That's a real insight. A human coach might take weeks to spot that in the data.

**It knows when it doesn't have enough to work with.** When I gave it a sparse check-in — minimal notes, no context — it didn't hallucinate a confident answer. It flagged the missing signal and asked a clarifying question. That's harder to build than it sounds. Most AI outputs I've seen in the wild don't know what they don't know.

**The streak counter hit different than I thought it would.** I built a three-day streak celebration mostly as a UX detail. Then I hit my own three-day streak testing it and felt something. That's the part you can't fully anticipate until you use the thing you built. The numbers becoming meaningful — that's the product insight right there.

---

## What I Now Understand About AI Agents

**The system prompt is the product.** Not the UI. Not the API call. The system prompt defines what the agent is, what it cares about, how it thinks, and what it refuses to do. When I rewrote the product agent's prompt to be more opinionated — no hedging, start with a verb, max three themes — the output quality jumped immediately. The model didn't change. The instructions did.

**These are prompt pipelines, not chatbots.** A chatbot reacts. An agent executes a defined process. A pipeline is a chain of API calls where the output of one becomes the input of the next — each step reasoning on top of the previous step's work, not on the raw user input alone. The Product Agent does this concretely: the first call produces the full structured analysis (KEY_THEMES, OPPORTUNITIES, HYPOTHESIS, PRD_OUTLINE), and the second call receives that entire analysis and reasons about it to produce the TL;DR. The model isn't summarizing the original customer signals at that point — it's reasoning about its own reasoning. That's a meaningful architectural distinction. It means the TL;DR reflects the synthesis, not just the input. Take that pattern further and you get branching pipelines: intermediate outputs that route the agent down different paths depending on what they contain. If STATUS is "Off track," generate ADJUSTED_PLAN. If it's "On track," skip it. The agent is making decisions, not just generating text. That's where real agent behavior starts — when the flow is conditional, not linear. Most AI features in production today are single-call wrappers: input goes in, output comes out, done. That's useful but it's also fragile and shallow. Multi-step reasoning chains — where each call builds on the last, where the architecture enforces a thinking process — are where durable value lives. They're harder to build and harder to copy.

**Memory is a state management problem.** LocalStorage, Supabase, vector databases — they're all the same thing at different scales: making the agent remember what happened last time. The recurring theme detection I built (checking current themes against the previous analysis) is a primitive form of memory. It's enough to be useful. But per-user memory that persists across sessions and informs future outputs — that's the next layer, and it's an engineering problem, not an AI problem.

**The model is better at synthesis than at process.** It's exceptional at taking messy input and finding structure. It's less reliable at multi-step procedural tasks that require consistent state. Knowing that shapes how I design agents: give the model the messy synthesis work, handle the procedural logic in code.

**Guardrails matter more than I initially thought.** The places where AI breaks aren't random — they're predictable. Sparse input. Ambiguous context. Conflicting signals. Those are the edge cases to design for explicitly. The `DRIFT_SIGNAL: None detected.` behavior I built — where the agent explicitly names that there's nothing to flag — is a guardrail. It prevents the model from inventing problems that aren't there.

---

## What This Means for Product Leadership

The executives who will be most effective in the next five years aren't the ones who use AI the most. They're the ones who understand what it's actually doing. There's a meaningful difference between someone who types prompts into ChatGPT and someone who understands system prompts, pipeline architecture, memory design, and where the model's reasoning breaks down. That gap will compound.

For product leadership specifically: the skill isn't writing code. It's being able to specify an agent precisely enough that it can be built to your exact intent. That requires knowing what a system prompt does. It requires understanding the difference between a tool call and a conversation. It requires having a mental model of where AI synthesis is trustworthy and where it needs a human in the loop. I didn't have that mental model two weeks ago. I have the beginning of it now.

The CPO interview question that matters isn't "how are you thinking about AI?" — everyone has an answer for that. The question that separates the serious candidates is: "build me something." Not a strategy deck. Not a roadmap. A thing that works. What I'm doing with Momentum AI is building that proof of work. Two agents in two days is a data point. The next thirty days will be a track record.

---

## What I'm Building Next

**Authentication + per-user memory.** Supabase login so analyses and check-ins belong to a person, not a browser. Once I have that, every subsequent interaction can be informed by the full history of previous ones. That's when the Product Agent becomes genuinely useful — when it can tell you that you've been building features around onboarding friction for three months and it's still the top theme.

**Integrations.** Notion for product teams (pull pages, analyze, push structured output back). Intercom for customer signal ingestion. Coros for workout + recovery data feeding into Momentum. Lose It for calorie tracking sync. Each integration changes the agent from "smart text processor" to "connected system that knows what's actually happening."

**An outreach agent.** Researches a prospect, drafts a personalized first message, logs the activity. I want to build this well enough that it feels like it was written by a human who did their homework — not a mail merge. The difference is in the system prompt and the context it's given.

**A print marketing agent for Atelier Objet.** This is the one I'm most excited about. Generating direct mail copy, catalog descriptions, and campaign concepts grounded in the brand's aesthetic language and customer data. Print is not dead. Print informed by AI is something interesting.

The throughline: agents that do a specific job, do it well, and get better the longer you use them. That's the product I'm building.
