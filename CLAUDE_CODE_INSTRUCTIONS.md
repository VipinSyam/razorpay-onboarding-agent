# Claude Code instructions: Razorpay Build-a-thon, Problem 3

Paste these prompts into Claude Code **one at a time**, in order. Wait for each one to finish, read its summary, then paste the next.

---

## Before you start (5 minutes, done once)

1. **Unzip** `razorpay-onboarding-agent.zip` somewhere easy, for example `Documents/razorpay-onboarding-agent`.
2. **Open a terminal in that folder** and start Claude Code there (type `claude`).
3. Have these ready (from the README, Step A):
   - your **Anthropic API key** (from console.anthropic.com, with a little credit added). You will type it into the terminal yourself, **never into the Claude Code chat**;
   - a **passcode** for live mode: a long passcode of your own (at least 12 characters).
4. Have a **GitHub** account and a **Vercel** account (sign up to Vercel with GitHub).

The folder already contains a `CLAUDE.md` file. Claude Code reads it automatically; it holds the rules Claude Code must never break (no API key in files, AI never decides closures or Compliance, nothing is sent to merchants, and so on).

---

## Prompt 1: Understand and check the project

```
Read CLAUDE.md, README.md and every file in this project. Do not change anything yet.

Then:
1. Check that Node.js (version 18 or newer) and git are installed on this computer. If something is missing, tell me exactly how to install it on my operating system and stop.
2. Run `npm test` and show me the result.
3. Explain the project back to me in plain language, as if I am a business student who will have to defend it in an interview: what each file does, what the rules decide, what the AI does, and what the human does. Keep it under 400 words.
4. List anything that looks risky or likely to break when deployed on Vercel. Do not fix it yet, just list it.
```

---

## Prompt 2: Put the code on GitHub

```
Put this project on GitHub as a new repository called `razorpay-onboarding-agent`.

- Make it PUBLIC (I may share the link with the judges; there are no secrets in the code). Before pushing, scan every file for anything that looks like an API key or password and stop if you find one.
- Use the GitHub CLI (`gh`). If it is not installed, tell me how to install it. If I am not logged in, tell me to run `gh auth login` myself in a separate terminal and wait for me.
- Initialise git, make a first commit with a clear message, create the repo and push.
- Show me the repository link at the end.
```

---

## Prompt 3: Deploy on Vercel

```
Deploy this project to Vercel as a production deployment.

- Use the Vercel CLI (`npx vercel`). If I need to log in, tell me to run `npx vercel login` myself in a separate terminal and wait for me.
- Link it to a new Vercel project called `razorpay-onboarding-agent`, Framework Preset "Other", no build command, and connect it to the GitHub repository from the previous step so future pushes redeploy automatically.
- Environment variables (Production):
  - ANTHROPIC_API_KEY: DO NOT ask me for the key in this chat and never print it. Give me the exact command to type myself in a separate terminal (for example `npx vercel env add ANTHROPIC_API_KEY production`) and wait until I say done.
  - DEMO_PASSCODE: same, give me the command and I will type it myself.
  - ANTHROPIC_MODEL: do not set it (the code defaults to claude-sonnet-5-5).
- After the variables are set, deploy to production again so they take effect.
- Show me the live URL.
```

---

## Prompt 4: Test the live deployment

```
Test the live deployment. I will give you the passcode in the terminal environment, not in chat: tell me to run `export DEMO_PASSCODE=...` (Mac/Linux) or `$env:DEMO_PASSCODE="..."` (Windows PowerShell) myself in your terminal session, then read it from the environment.

1. Open <live URL>/api/agent with curl and check it returns has_api_key: true and live_mode_configured: true.
2. POST {"action":"test"} with the header x-passcode and check the reply is OK.
3. Run the agent on these applications, one at a time, and for each show me: status, diagnosis, route, the messages it wrote (with the English back-translation) and which safety checks passed or failed:
   - A3031 (rank #1, Hinglish, Email + SMS)
   - A3051 (blank code, restricted business: must be closed, never nudged)
   - A3094 (Compliance: the message must not reveal any reason)
   - A3022 (no code, blurred document: the AI must read the note)
   - A3006 (Tamil, merchant just stopped)
4. If anything fails (API errors, wrong model name, timeouts, messages blocked by the safety checks), explain the cause in plain language and propose a fix. Do not change lib/rules.js or the non-negotiable rules in CLAUDE.md without asking me first.
```

---

## Prompt 5: Run all 75 and save the results for the public demo

```
Write a small script `scripts/run_all.js` (Node, no dependencies) that:
- reads the live URL and DEMO_PASSCODE from environment variables (never hard-coded);
- calls POST /api/agent for every application that is not "Activated" in data/applications.json, two at a time, with one retry on an error;
- writes the results to saved_run.json in exactly the format the page already reads ({generated_at, model, note, results: {application_id: result}});
- prints progress and, at the end, a summary: how many "Ready for approval", "Ready: human call", "Escalated: human review" and "Blocked: needs human", plus the list of any blocked or escalated IDs with the reason.

Run it. Then show me the summary and every blocked or escalated case with its failed checks.
Do not commit yet. Wait for me to review.
```

*(Read the summary. Blocked or escalated cases are not failures of your project; they are the safety system working. Note them for your "results and failures" section.)*

```
Looks good. Commit saved_run.json with the message "Saved agent run of all 75 applications" and push. Confirm Vercel redeployed, and that the public link now shows the results in demo mode without a passcode.
```

---

## Prompt 6: Make the output Excel for the submission

```
Create `submission/P3_Output_Table.xlsx` from saved_run.json and data/applications.json, using Python with openpyxl (or Node if Python is not available). It needs:

1. Sheet "Output": one row per non-activated application, sorted by priority rank, with columns: application_id, priority_rank, preferred_language, channel, expected TPV (Rs lakh/month), days inactive, attempts, support contacts, step reached, rejection code, reviewer note, diagnosed code, how it was diagnosed (code / AI reading / abandoned), fixable, route, recoverable, human call, agent status, main message (WhatsApp or SMS), email subject, email body, day 3 reminder, day 7 final reminder, call script, English back-translation, safety checks passed (Yes/No), failed checks.
2. Sheet "Summary": counts and expected TPV by route, recoverable vs low probability, human calls, agent status; top 3 fixable causes by theme with counts and TPV.
3. Sheet "Messages not sent": every blocked or escalated case and why. This is my "replies I would not send" list.
Use Arial font, frozen header row, wrapped text for messages, sensible column widths. Then open the file and check that the numbers match saved_run.json.
```

---

## Prompt 7: My 25-case test (do this yourself first, then use this prompt)

First fill in your own answers, **without looking at the agent's output**, for about 25 applications: the diagnosis code, fixable (Yes/No), route, and recoverable. Include A3022, A3028, A3051, A3081, all of A3039, A3073, A3082, A3093, A3094, A3096, A3097, five abandoned ones, one of each other code, and a mix of languages. Save it as `submission/my_answer_key.csv` with columns `application_id,code,fixable,route,recoverable`.

```
Compare submission/my_answer_key.csv with saved_run.json. Show me a table of each field's accuracy (correct out of total), then every disagreement with both answers and, in plain language, who is more likely right and why (check against data/catalog.json and CLAUDE.md). Save the comparison as `submission/evaluation.xlsx`. Do not change any of my answers.
```

---

## If something goes wrong

Paste this into Claude Code:

```
Something is not working: <describe what you saw or paste the error>.
Find the cause, explain it to me in plain language, and fix it. Follow CLAUDE.md. Run `npm test` after the fix, redeploy, and confirm the live site works.
```

Or paste the error into our claude.ai chat and I will help.

---

## Appendix: if you ever want Claude Code to rebuild from scratch

Not recommended: the version in the zip is already built and tested (rules match the Excel on all 900 decision cells, 34 automated tests and a full browser test pass). A rebuild would need all of that testing again. If you still want it, give Claude Code this folder (it has `CLAUDE.md`, `README.md`, `PROMPTS.md` and the Data Pack as JSON) and say:

```
Rebuild this project from scratch following CLAUDE.md, README.md and PROMPTS.md exactly: same architecture (static index.html + one Vercel function, no frameworks), same rules and assumptions, same prompts, same safety checks, same demo/live modes. Then prove it is equivalent: compare every rule decision with docs/Razorpay_P3_Step1_Rules_Engine.xlsx, and write tests with a fake AI for the rewrite, block and escalate paths. Explain every difference from the original to me before keeping it.
```
