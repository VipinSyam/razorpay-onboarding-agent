# Run log: Onboarding Recovery Agent (Problem 3)

What happened when the live agent was run on all 75 applications that need action, and what changed in between. All data is synthetic (Build-a-thon Data Pack). Nothing was sent to any merchant: every message waits for a human to approve it.

- Live site (demo mode, shows Run 2): https://razorpay-onboarding-agent-mu.vercel.app
- Code: https://github.com/VipinSyam/razorpay-onboarding-agent
- Script used for both runs: `scripts/run_all.js` (two applications at a time, one retry on a network error)

## At a glance

| | Run 1 (first full run) | Run 2 (final, shown on the site) |
|---|---|---|
| Date | 8 Nov 2026 (about 19:15 IST) | 8 Nov 2026 (about 19:40 IST) |
| Model | claude-sonnet-5-5 | claude-sonnet-5-5 |
| Run time | 7.4 minutes | 7.4 minutes |
| Cost (Anthropic console) | about $1.29 | about $1.20 |
| Ready for approval | 71 | **73** |
| Ready: human call | 1 | **2** |
| Escalated: human review | 0 | **0** |
| Blocked: needs human | 3 | **0** |
| Needed a second draft | 9 | 6 |

**Cost:** total for the two full runs about **$2.49** ($1.29 + $1.20). In Run 2 that is about **1.6 cents per application** ($1.20 / 75).

## Run 1: first full run

**Results:** 71 ready for approval, 1 human call, 3 blocked.

**The 3 blocked cases (A3020, A3023, A3040):** the AI's reply was cut off in the middle, because each reply was limited to 2,000 tokens and long Kannada and Tamil messages need more. With half a reply, there was nothing to check, so the safety checks failed and the case went to a human, which is the right outcome. A3023 was a human-call case, so its call script was missing.

**9 second drafts:**
- 6 because the first reply was cut off (Kannada, Tamil and Marathi);
- 2 because Hinglish was written in Devanagari script instead of Roman letters;
- 1 because the English back-translation was missing.

## Fixes between the runs

1. **Longer replies allowed:** the AI may now write up to 4,000 tokens (was 2,000).
2. **Cut-off detection:** if a reply still hits the limit, the trace says "AI reply was cut off (too long)" and the rewrite asks for a shorter reply, instead of showing a confusing technical error.
3. **Time limits:** the Vercel function may run up to 120 seconds; the agent stops itself at 110 seconds (10 seconds spare); one AI call may take up to 45 seconds. A case that is out of time is blocked with "Time limit reached, re-run this application".
4. **Prompts tightened:** "Razorpay" in every merchant-facing message (including the SMS and both reminders); no claims about the application's status or outcome that are not in the facts; in call scripts, the executive sends the resume link during the call (the channel message is only for when the merchant cannot be reached).
5. **Safety check extended:** "Says it is from Razorpay" now checks every message on its own, including both reminders and the SMS.

The rules that make the decisions did not change: they still match the Step 1 Excel rules engine (600 decision cells, 0 differences). All 57 automated tests pass.

## Run 2: final run (shown on the site)

**Results:** 73 ready for approval, 2 human calls, 0 blocked, 0 escalated. No reply was cut off.

**6 second drafts:** all Hinglish, all because the first draft left out the English back-translation. The safety check caught each one and the rewrite fixed it. This is kept as evidence that the checker works.

## The 4 AI diagnoses (notes with no reviewer code)

| Application | Reviewer note | AI reading | Confidence | Rules |
|---|---|---|---|---|
| A3022 | "Doc blurred and cropped, cannot verify" | R05 (document unreadable) | high | accepted |
| A3028 | "PAN ka naam aur application ka naam match nahi kar raha" | R01 (PAN name mismatch) | high | accepted |
| A3051 | "Business category not supported by policy" | R10 (restricted business) | high | confirmed (the keyword safety net had already forced R10) |
| A3081 | "Signatory ka ID proof upload nahi hua" | R09 (signatory ID) | high | accepted (leads to a human call) |

Same result in both runs.

## Network note

In each run, 9 calls failed on my computer with "fetch failed" (a network error between my computer and Vercel). Each one was retried after 3 seconds and succeeded. Some of the first attempts may still have been completed by the server, so a few AI calls may have been made twice; this is included in the console costs above.

## Known limitations

- **Back-translations are not independent:** the English back-translation is written by the same AI that wrote the message, so it cannot prove the translation is right.
- **Not yet checked by native speakers:** the Tamil, Kannada and Marathi messages have not been reviewed by a native speaker.
- **Approvals stay in one browser:** clicking Approve saves the decision only in that browser; other viewers do not see it.
