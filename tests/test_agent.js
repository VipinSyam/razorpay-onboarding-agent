"use strict";
const path = require("path").join(__dirname, "..") + "/";
const apps = require(path + "data/applications.json"), catalog = require(path + "data/catalog.json");
const { runAgent } = require(path + "lib/agent-core.js");
const { createMock } = require("./mock_model.js");
const get = (id) => apps.find((a) => a.application_id === id);
let fails = 0;
const expect = (name, cond, extra) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  -> " + JSON.stringify(extra))); if (!cond) fails++; };

(async () => {
  // 1. Full run of all non-activated with a well-behaved mock
  const m = createMock();
  const results = [];
  for (const a of apps.filter((x) => x.application_status !== "Activated"))
    results.push(await runAgent({ app: a, apps, catalog, callModel: m.callModel }));
  const by = Object.fromEntries(results.map((r) => [r.application_id, r]));
  const counts = {}; results.forEach((r) => (counts[r.status] = (counts[r.status] || 0) + 1));
  console.log("Status counts (good mock):", counts, "AI calls:", m.calls.length);
  expect("75 results", results.length === 75);
  expect("No blocked messages with a rule-following AI", !counts["Blocked: needs human"], results.filter(r=>r.status.startsWith("Blocked")).map(r=>[r.application_id, r.safety.checks.filter(c=>!c.pass)]));
  expect("A3051 stays Close politely", by.A3051.rules.route === "Close politely");
  expect("A3051 AI confirms safety net", by.A3051.diagnosis_decision.decision === "confirmed");
  expect("A3022 diagnosed R05 by AI", by.A3022.rules.diagnosed_code === "R05");
  expect("A3028 diagnosed R01 by AI", by.A3028.rules.diagnosed_code === "R01");
  expect("A3081 diagnosed R09 + human call", by.A3081.rules.diagnosed_code === "R09" && by.A3081.status === "Ready: human call");
  expect("A3096 compliance hold", by.A3096.rules.message_type === "compliance_hold");
  expect("A3031 rank 1", by.A3031.rules.priority_rank === 1, by.A3031.rules.priority_rank);
  expect("Coded rows make 1 AI call each", m.calls.length === 75 + 4, m.calls.length);

  // 2. Compliance case: AI never sees the screening note
  const spy = createMock(); let seen = "";
  const orig = spy.callModel; const wrapped = async (s, msgs) => { seen += JSON.stringify(msgs); return orig(s, msgs); };
  await runAgent({ app: get("A3094"), apps, catalog, callModel: wrapped });
  expect("Compliance note 'Screening hit' never sent to AI", !/screening/i.test(seen), seen.slice(0, 200));

  // 3. Bad first draft -> rewrite -> pass
  const bad = createMock({ badFirstDraft: true });
  const r3 = await runAgent({ app: get("A3031"), apps, catalog, callModel: bad.callModel });
  expect("Bad draft caught, rewritten, then ready", r3.drafts === 2 && r3.status === "Ready for approval", r3.trace.map(t=>t.step+": "+t.result));

  // 4. Always bad -> blocked
  const worse = createMock({ alwaysBad: true });
  const r4 = await runAgent({ app: get("A3031"), apps, catalog, callModel: worse.callModel });
  expect("Draft that keeps failing is BLOCKED", r4.status === "Blocked: needs human", r4.status);

  // 5. AI disagrees with the keyword safety net on A3051
  const dis = createMock({ disagree: true });
  const r5 = await runAgent({ app: get("A3051"), apps, catalog, callModel: dis.callModel });
  expect("AI disagreeing with safety net -> route kept, escalated", r5.rules.route === "Close politely" && r5.status === "Escalated: human review", [r5.rules.route, r5.status]);

  // 6. Low confidence reading -> escalate, no message drafted
  const low = createMock({ lowConfidence: true });
  const r6 = await runAgent({ app: get("A3022"), apps, catalog, callModel: low.callModel });
  expect("Low-confidence reading -> escalated, no draft", r6.status === "Escalated: human review" && !r6.message, r6.status);

  // 7. Garbage AI reply -> rewrite path
  const g = createMock({ garbage: true });
  const r7 = await runAgent({ app: get("A3004"), apps, catalog, callModel: g.callModel });
  expect("Unreadable AI reply handled (retry then ready)", r7.status === "Ready for approval", r7.trace.map(t=>t.result));

  // 8. Custom stress test: restricted phrased differently, no code
  const r8 = await runAgent({ app: Object.assign({}, get("A3005"), { application_id: "CUSTOM", rejection_message: "Declared business is prohibited under policy" }), apps: null, catalog, callModel: createMock().callModel });
  expect("Custom 'prohibited' note forced to R10", r8.rules.diagnosed_code === "R10", r8.rules.diagnosed_code);

  // 9. Note with compliance words and no code: never sent to ANY AI, R12 kept, a human reviews
  const note9 = "Owner name matched during compliance check, hold";
  const spy9 = createMock(); let seen9 = "", diagnoseCalls = 0;
  const wrapped9 = async (s, msgs) => { seen9 += JSON.stringify(msgs); if (s === require(path + "lib/prompts.js").DIAGNOSE_SYSTEM) diagnoseCalls++; return spy9.callModel(s, msgs); };
  const r9 = await runAgent({ app: Object.assign({}, get("A3005"), { application_id: "CUSTOM", rejection_code: null, rejection_message: note9 }), apps: null, catalog, callModel: wrapped9 });
  expect("Compliance-keyword note: AI never asked to read it", diagnoseCalls === 0, diagnoseCalls);
  expect("Compliance-keyword note: text never sent to any AI", !seen9.includes("Owner name matched") && !/compliance check/i.test(seen9), seen9.slice(0, 300));
  expect("Compliance-keyword note: R12 route kept", r9.rules.diagnosed_code === "R12" && r9.rules.route === "Route to Compliance", r9.rules.route);
  expect("Compliance-keyword note: trace says not sent, human reviews",
    r9.trace.some((t) => t.result === "Not sent to AI: possible compliance case, human reviews") && r9.status === "Escalated: human review", r9.status);

  // 10. Keyword-forced R10 (A3051) still gets the AI second check
  const spy10 = createMock(); let diag10 = 0;
  const P10 = require(path + "lib/prompts.js");
  await runAgent({ app: get("A3051"), apps, catalog, callModel: async (s, msgs) => { if (s === P10.DIAGNOSE_SYSTEM) diag10++; return spy10.callModel(s, msgs); } });
  expect("Keyword-forced R10 still gets the AI second check", diag10 === 1, diag10);


  console.log(fails ? `\n${fails} FAILED` : "\nAll agent tests passed");
})();
