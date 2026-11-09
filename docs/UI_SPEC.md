# UI upgrade spec: Onboarding Recovery Agent (Problem 3)

Goal: make the page tell Vipin's story in a 90-second demo and make his judgment visible. This is a **presentation upgrade only**. Do not change `lib/rules.js` decisions, `lib/agent-core.js`, `lib/prompts.js`, `api/agent.js`, the assumptions, or the `saved_run.json` format. Follow CLAUDE.md.

## Design direction
- A calm, professional **operations console** for an onboarding team: white cards on a light grey background, navy header, one accent blue, generous spacing, clear type hierarchy. Feels like a real internal tool, not a student dashboard.
- Colours carry meaning consistently everywhere: **Rule = blue, AI = violet, Check = green, Human = orange**; status: ready = blue, approved = green, blocked = red, escalated / human call = amber, closure = red-soft, compliance = amber-soft.
- No Razorpay logo or brand assets. Keep the footer: prototype, synthetic data, not a Razorpay product, nothing is sent.
- Must work well at 390 px wide (phone) and at 1440 px (laptop). Tables become cards on phones.
- Keep it one self-contained `index.html` (inline CSS/JS), loading `lib/rules.js` and the JSON files as now. No frameworks, no external fonts or CDNs.

## Structure: tabs across the top (keep Demo / Live mode pill and Unlock button in the header)

### Tab 1: Overview (default)
- One-line headline: "75 merchants are stuck in onboarding. Rs 934 lakh / month of expected payments is waiting on fixable problems."
- KPI cards (as now): needs action, recoverable, low probability, human calls, not nudged (closed / compliance), messages ready.
- **Money card**, clearly labelled as an assumption: "At ~1% net revenue on TPV (assumption borrowed from the Data Pack's Problem 2 tab), recoverable merchants are worth about Rs X lakh / month to Razorpay." Compute X from the recoverable TPV.
- "How the agent works" flow strip (Rule → AI → Rule → AI → Check → AI rewrite → Human), with one sentence: "Rules make every decision that can harm a merchant. AI only reads messy notes and writes messages. Nothing is sent without a human."
- A small "Start the demo" box with three buttons that open the three showcase cases directly: **A3031** (top priority, Hinglish), **A3051** (blank code, restricted business: closed, never nudged), **A3023** (Rs 59.9L, frustrated, human call).

### Tab 2: Work queues
- Four queues as sub-tabs or columns, each with a count: **Automated nudges** (Ready for approval, nudge + final reminder, sorted by priority rank), **Human calls**, **Closures (R10)**, **Compliance (R12)**. Plus a small "Blocked / escalated" queue that shows "0. Nothing needs fixing" when empty.
- Each row/card: rank, ID, language, channel, TPV, days quiet, diagnosis (code + theme), status. Keep filters (language, search) and sorting.
- Keep "Run agent on all" (live mode only), "Download table (Excel CSV)" and "Export run (saved_run.json)".
- **Batch approve** for the Automated nudges queue only: checkboxes plus "Approve selected sequences", with a note: "Pilot policy: a person reviews every message. Closures, Compliance and human calls are always approved one by one." Batch approve must never be offered for closures, compliance or calls.

### Detail drawer (opens from any row)
- Header: ID, business type, city, route badge, status badge.
- **Before → After** at the top: left "What the reviewer wrote" (code + note, or "No note: the merchant just stopped"); right "What the merchant receives" (first lines of the main message).
- **Phone-style preview**: WhatsApp bubble inside a simple phone frame for WhatsApp merchants; an SMS bubble plus an email card (subject + body) for Email + SMS merchants. Tabs or stacked cards for **Day 0 / Day 3 / Day 7**, and **Call script** for human calls.
- A **"Show English"** toggle that shows the back-translation next to (or under) the message.
- Facts, decision (diagnosis, fixable / recoverable, priority, standard fix), the **agent trace** timeline (coloured by actor), the **safety checks** grid, the **follow-up plan** with stop rules: all as now, but tidier.
- If the case needed a second draft, show a clear amber note: "Draft 1 was rejected by the safety check: <failed checks from the trace>. The AI rewrote it and draft 2 passed."
- Human decision buttons: for nudges "Approve sequence"; for everything else "Approve message"; plus "Send back to a human", "Undo", "Re-run agent" (live mode only). Line under them: "Approving sends Day 0 now and schedules the listed follow-ups. Follow-ups go out only if the stop rules have not triggered. In this prototype nothing is actually sent; the decision is only recorded." Recorded status for nudges: "Approved: sequence scheduled (not sent)".

### Tab 3: Safety record
- Headline numbers computed from saved_run.json: safety checks run (sum of checks across all results), drafts rejected by the checker and rewritten (count + list of IDs with the failed check), messages blocked (0), escalated (0), compliance notes sent to any AI (0).
- "What the checker caught in this run" table: ID, language, what was wrong in draft 1, outcome.
- A static "Earlier run" box: "Run 1: 3 replies in long Kannada/Tamil messages were cut off by a length limit. They were blocked, never marked ready. Fixed by raising the limit and detecting cut-offs; run 2 had 0." (Use `submission/run_log.md` as the source if present.)
- **"What AI is never allowed to decide"** list: closing an application; routing to Compliance; who is recoverable; priority; channel; who gets a human call; sending anything. And "What AI does": read 4 unclear notes; write messages in 6 languages.
- The 11 checks listed with a one-line plain-language explanation each.

### Tab 4: Product insight
- **Where merchants stop**: a simple horizontal funnel or bar chart of stalled applications by `step_reached` (Business details → KYC docs → Bank verification → Website/App review), with count and TPV for each.
- **Why they are stuck**: the root-cause bars (as now), counts and TPV.
- **The one fix I would ship**: "Check that the names on PAN, GST and the bank account match the application while the merchant is typing, before they submit." Show why: 21 applications / Rs 232 L per month blocked by name or identity mismatches, the largest fixable rejection cause. Second idea: a resume link plus a step reminder for the 22 merchants who just stopped.
- Language mix of stuck merchants (small bar list), to show why multilingual nudges matter.

### Tab 5: Assumptions & stress test
- The existing what-if assumptions panel and the stress-test form (live mode), moved here and tidied.

## Must keep working
- Demo mode with no passcode; live mode unlock; run one / run all; approvals stored in the browser (try/catch); CSV and JSON export (same columns / format as now); stress test.
- No JavaScript errors in the console. All text from data is HTML-escaped as now.

## How to deliver
1. Build it. Run `npm test` (must still pass).
2. Open the page locally in the browser pane (serve the folder with a simple local server so the JSON files load) and check every tab, the three showcase cases, the drawer, the "Show English" toggle, batch approve, the CSV export, and the layout at 390 px and 1440 px. Take screenshots and show them to Vipin.
3. Deploy a **Vercel preview** (not production) and give Vipin the preview link. Do not touch production until Vipin says "ship it".
4. After "ship it": commit, push, confirm production shows the new UI and still serves all 75 saved results without a passcode.
