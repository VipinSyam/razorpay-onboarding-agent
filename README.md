# Onboarding Recovery Agent (Razorpay Campus AI Build-a-thon, Problem 3)

Built by Vipin Syam. All data is synthetic, from the Build-a-thon Data Pack (snapshot 30 Sep 2026). This is a prototype, not a Razorpay product.

## What it does

For every merchant application that stalled or was rejected during onboarding (75 of 100), the agent:

1. **Diagnoses** why it stalled. Rules read the reviewer's code. For notes without a code, AI reads the text, and a keyword safety net catches restricted and compliance cases first.
2. **Decides** what is safe to do. Rules only: close politely (restricted business), send to Compliance (never revealing why), or nudge to fix. Rules also decide whether the merchant is still recoverable, their priority, their channel and whether a human should call.
3. **Drafts** the right message in the merchant's language (English, Hinglish, Hindi, Tamil, Kannada, Marathi) and channel (WhatsApp only if opted in, otherwise email + SMS), with a day 3 / day 7 follow-up plan and stop rules.
4. **Checks itself.** Up to 11 automatic safety checks: no promised dates, no compliance reasons, no workarounds for restricted businesses, right script, resume link present, right fix mentioned, and so on. A failed draft is rewritten once; if it fails again it is **blocked** for a human.
5. **Waits for a human.** Nothing is sent. A person approves each message.

| Who decides | What |
|---|---|
| **Rules** (`lib/rules.js`) | Diagnosis from codes, keyword safety net, route, recoverable, priority, channel, human call, follow-up plan, all safety checks |
| **AI** (`lib/prompts.js`) | Reading 4 unclear reviewer notes; writing messages and English back-translations |
| **Humans** | Approving every message; any escalated, blocked, closure or Compliance case |

## Files

```
index.html             The web page (dashboard, table, agent trace, approve buttons, run-all, downloads)
api/agent.js           The only server code. Calls Claude. Holds the API key (never sent to the browser)
lib/rules.js           The rulebook + safety checker (used by both the page and the server)
lib/agent-core.js      The agent's fixed playbook: diagnose -> decide -> write -> check -> rewrite -> hand over
lib/prompts.js         The exact AI instructions (also printed in PROMPTS.md)
data/applications.json The 100 applications from the Data Pack
data/catalog.json      The 13 rejection codes from the Data Pack (+ our theme grouping)
saved_run.json         A saved run of the agent, shown to anyone who opens the site (empty until you run it)
tests/                 Automated tests using a fake AI (run: npm test)
docs/                  Step 1 Excel rules engine + its build/verify scripts
vercel.json            Gives the agent function up to 60 seconds per application
```

## Two modes

* **Demo mode** (default, for judges): shows the saved run. Free, instant, no AI called.
* **Live mode** (for you): click **Unlock live mode**, enter your passcode, and the agent runs live on any application, or on all of them.

---

# Deploy guide (about 30–45 minutes the first time)

You need three free accounts. Do them in this order.

## Step A: Get an Anthropic API key

1. Go to **console.anthropic.com** and sign up. This is separate from your claude.ai chat subscription.
2. Open **Billing** and add a small amount of credit. You only pay for what the agent uses; you can watch usage in the console.
3. Open **API Keys** → **Create Key**. Name it `razorpay-agent`. **Copy the key** (it starts with `sk-ant-`) and keep it somewhere safe. You will not be able to see it again.
4. Set a **monthly spend limit** in the Anthropic console (in its limits / billing settings), so the API can never cost more than you choose, even if someone guesses your passcode.

> Never paste this key into the code, into GitHub, or into a chat. It only goes into Vercel (Step C).

## Step B: Put the code on GitHub

1. Go to **github.com** and sign up (or log in).
2. Click **+** (top right) → **New repository**. Name: `razorpay-onboarding-agent`. Choose **Public** if you want to share the repository link with judges (there are no secrets in the code), or **Private**. Click **Create repository**.
3. On the new empty repository page, click **uploading an existing file**.
4. Unzip `razorpay-onboarding-agent.zip` on your computer. Open the folder, select **everything inside it** (all files and folders: `api`, `data`, `lib`, `tests`, `docs`, `index.html`, …) and drag them into the GitHub upload box.
5. Check the list shows `index.html` at the top level (not inside another folder). Click **Commit changes**.

## Step C: Deploy on Vercel

1. Go to **vercel.com** → **Sign Up** → **Continue with GitHub**. Choose the free **Hobby** plan.
2. Click **Add New…** → **Project** → find `razorpay-onboarding-agent` → **Import**.
3. **Framework Preset:** choose **Other**. Leave the build settings empty.
4. Open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your key from Step A |
   | `DEMO_PASSCODE` | a long passcode of your own: at least 12 characters, and not shared anywhere public (not in GitHub, slides or chats) |
   | `ANTHROPIC_MODEL` | *(optional)* leave it out to use `claude-sonnet-5-5` |

5. Click **Deploy**. After about a minute you get a link like `https://razorpay-onboarding-agent.vercel.app`.

## Step D: Test it (2 minutes)

1. Open `https://YOUR-LINK.vercel.app/api/agent` in your browser. You should see something like:
   `{"ok":true,"has_api_key":true,"live_mode_configured":true,"model":"claude-sonnet-5-5"}`
   If `has_api_key` or `live_mode_configured` is `false`, recheck Step C4, then go to **Deployments → ⋯ → Redeploy** (environment variable changes need a redeploy).
2. Open `https://YOUR-LINK.vercel.app`. Click **Unlock live mode** and enter your passcode. You should see "Live mode on. Connected to …".
3. Click **A3031** (rank #1) → **Run agent**. In about 10–30 seconds you should see the trace, the Hinglish SMS and email, the back-translation and 11 safety checks.
4. Try **A3051**: the agent should close it politely and never nudge it.

## Step E: Run all 75 and save the results for the public demo

1. In live mode, click **Run agent on all**. It processes two applications at a time; expect roughly 10–20 minutes. Keep the tab open.
2. Click **Download table (Excel CSV)**. This is your output table for the submission (opens in Excel).
3. Click **Export run (saved_run.json)**.
4. In GitHub, open your repository → **Add file → Upload files** → drag in the downloaded `saved_run.json` (it replaces the empty one) → **Commit changes**.
5. Vercel redeploys automatically in about a minute. Now anyone opening your link sees all 75 results in demo mode, with no passcode and no cost.

## Troubleshooting

| Message | Fix |
|---|---|
| `Wrong passcode.` | Type the exact `DEMO_PASSCODE` from Vercel |
| `Live mode is off: DEMO_PASSCODE is not set` | Add it in Vercel, then Redeploy |
| `ANTHROPIC_API_KEY is not set` | Add it in Vercel, then Redeploy |
| `Anthropic API error 401` | The key is wrong or was deleted: create a new key and update Vercel |
| `Anthropic API error 400 … credit balance` | Add credit in the Anthropic console |
| `... is deprecated for this model` | A request setting is no longer supported by the model; remove it from `api/agent.js` |
| `Anthropic API error 404 … model` | Set `ANTHROPIC_MODEL` to a model your account can use (see the models page in the Anthropic docs), then Redeploy |
| An application shows "Blocked" with an error | Open it and click **Re-run agent**; occasional timeouts happen |
| The page says it could not load the data files | You opened `index.html` straight from your computer. Use the Vercel link instead |

## Tests

`npm test` runs the automated tests with a fake AI: the agent loop (rewrite after a failed check, blocking, escalation when the AI disagrees with the safety net, low-confidence readings), every safety check, the server's passcode and error handling, and a check that Compliance notes are never sent to the AI. The JavaScript rules were also compared with the Step 1 Excel rules engine: 900 decision cells, 0 differences.
