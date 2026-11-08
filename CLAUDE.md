# Project memory for Claude Code

This is Vipin Syam's submission for the Razorpay Campus AI Build-a-thon, **Problem 3: merchant onboarding and KYC drop-off recovery**. It is an individual submission; Vipin must be able to explain every choice, so keep the design simple and explain changes in plain language (he is not a developer).

## What the app is
A static web page (`index.html`) plus one Vercel serverless function (`api/agent.js`) that calls the Anthropic API. No frameworks, no npm dependencies, no build step. Deployed on Vercel (Framework Preset: Other).

- `lib/rules.js`: the rulebook and the safety checker (shared by browser and server). No AI.
- `lib/agent-core.js`: the agent's fixed playbook: rules diagnose → AI reads unclear note → rules accept/escalate → rules decide route, priority, channel → AI writes → safety check → one rewrite → blocked or ready → human approves.
- `lib/prompts.js`: the only place the AI instructions live (`PROMPTS.md` is generated from it; regenerate it if prompts change).
- `data/*.json`: the synthetic Data Pack (100 applications, 13 rejection codes). Do not add real data.
- `saved_run.json`: a saved agent run shown in demo mode.
- `docs/`: the Step 1 Excel rules engine; `lib/rules.js` must give identical decisions to it.

## Non-negotiable rules (never change these without Vipin's explicit approval)
1. Rules, not AI, decide: closing (R10), routing to Compliance (R12), recoverable, priority, channel, human call. The AI may only fill in a code for a PENDING-AI case, and never R10/R12 on its own (those escalate to a human).
2. The AI that writes messages never sees the reviewer's note for R10 or R12 cases. Notes that trigger the compliance safety net are never sent to any AI. Only for keyword-forced R10 (restricted business) cases is the note sent to the diagnosis step as a second check; that step's output never reaches the merchant.
3. Nothing is ever sent to a merchant. "Approve" only records a decision.
4. WhatsApp only if `whatsapp_opted_in` is "Yes"; otherwise Email + SMS.
5. Agreed assumptions: recoverable = inactive ≤ 30 days AND attempts < 4; priority = TPV / (1 + days/15); human call = TPV ≥ 25 lakh AND (support contacts ≥ 3 OR attempts ≥ 4).
6. The Anthropic API key exists only as the Vercel environment variable `ANTHROPIC_API_KEY`. Never write it into a file, commit it, print it, or ask Vipin to paste it into the chat. When a key must be entered, tell Vipin the exact command to type himself.
7. Live mode needs `DEMO_PASSCODE`; if it is not set, live mode stays off.
8. The page must keep saying it is a prototype using synthetic data and not a Razorpay product. Do not add Razorpay logos or brand assets.

## Before finishing any change
- Run `npm test` (uses a fake AI; must print "All agent tests passed" and "All safety + HTTP tests passed").
- If `lib/rules.js` changed, re-check it against `docs/Razorpay_P3_Step1_Rules_Engine.xlsx` (Output sheet) and report any differences.
- Summarise for Vipin in plain language: what changed, why, and what he should say about it if a judge asks.
