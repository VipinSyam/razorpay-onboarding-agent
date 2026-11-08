/*
 * agent-core.js: the agent's playbook for ONE application.
 *
 *   Rules diagnose -> (AI reads unclear note -> rules accept / escalate) -> rules decide route,
 *   priority, channel -> AI writes -> safety check -> AI rewrites once if needed -> still failing?
 *   BLOCKED for a human. Nothing is ever sent: the result waits for a human to approve.
 *
 * The playbook is fixed on purpose: the AI cannot skip the safety check or change a route.
 * callModel(system, messages) is passed in, so this file can be tested without a real AI.
 *
 * If callModel says the time budget is used up (err.budgetStop), the agent stops at once and
 * the case is "Blocked: needs human" with a clear reason, so a person can simply re-run it.
 */
"use strict";
const Rules = require("./rules.js");
const P = require("./prompts.js");

function parseJson(text) {
  if (!text) throw new Error("Empty AI reply");
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e < s) throw new Error("AI reply was not JSON");
  return JSON.parse(text.slice(s, e + 1));
}

const isBudgetStop = (err) => !!(err && err.budgetStop);

async function runAgent({ app, apps, catalog, assumptions, callModel }) {
  const trace = [];
  const log = (step, actor, result, detail) => trace.push({ step, actor, result, detail: detail || "" });
  const result = { application_id: app.application_id, trace, generated_at: new Date().toISOString() };

  // Station 1: filter
  if (app.application_status === "Activated") {
    log("Filter", "Rule", "Already activated: no action needed");
    result.status = "No action (activated)";
    return result;
  }
  log("Filter", "Rule", `Status '${app.application_status}': needs action`);

  try {
    await runSteps({ app, apps, catalog, assumptions, callModel, result, log });
  } catch (err) {
    if (!isBudgetStop(err)) throw err;
    result.status = "Blocked: needs human";
    result.blocked_reason = String(err.message);
    log("Stop", "Check", "Blocked: needs human", result.blocked_reason);
  }
  return result;
}

async function runSteps({ app, apps, catalog, assumptions, callModel, result, log }) {
  // Station 2: diagnose with rules
  let r = Rules.runRules(app, catalog, assumptions);
  log("Diagnose", "Rule", `${r.diagnosis_source} -> ${r.diagnosed_code}`,
    r.keyword_safety_net !== "n/a" ? "Keyword safety net: " + r.keyword_safety_net : r.plain_meaning);

  let escalated = false;
  if (r.diagnosis_source === "Free text only: needs reading" && r.keyword_safety_net === "Compliance words found") {
    // Possible compliance case: the note is never sent to any AI. The R12 route stays; a human reviews.
    result.ai_diagnosis = null;
    result.diagnosis_decision = { decision: "escalate", code: "R12",
      note: "Compliance words found. The note was not sent to the AI. Route kept as R12; a human reviews." };
    log("Read reviewer note", "Rule", "Not sent to AI: possible compliance case, human reviews");
    escalated = true;
  } else if (r.diagnosis_source === "Free text only: needs reading") {
    let ai;
    try {
      ai = parseJson(await callModel(P.DIAGNOSE_SYSTEM, [{ role: "user", content: P.diagnoseUserMessage(app.rejection_message, catalog) }]));
      log("Read reviewer note", "AI", `${ai.code} (${ai.confidence} confidence)`, ai.reason);
    } catch (err) {
      if (isBudgetStop(err)) throw err;
      ai = null;
      log("Read reviewer note", "AI", "Failed to read", String(err.message || err));
    }
    result.ai_diagnosis = ai;
    const m = Rules.mergeDiagnosis(r, ai, catalog);
    result.diagnosis_decision = m;
    log("Accept or escalate AI reading", "Rule", m.decision, m.note);
    if (m.decision === "escalate") escalated = true;
    if (m.decision === "accepted") r = Rules.runRules(app, catalog, assumptions, m.code);
    if (m.decision === "escalate" && !m.code) {
      result.rules = r;
      result.status = "Escalated: human review";
      log("Stop", "Rule", "No message drafted. A human decides the diagnosis.");
      return;
    }
  }

  // Priority rank across the full list (needs all applications)
  if (apps && r.route === "Nudge to fix") {
    const overrides = {}; overrides[app.application_id] = r.diagnosed_code;
    const all = Rules.runAll(apps, catalog, assumptions, overrides);
    const me = all.find((x) => x.application_id === app.application_id);
    if (me) r.priority_rank = me.priority_rank;
  }
  result.rules = r;
  log("Route", "Rule", r.route, r.route === "Nudge to fix" ? `Fixable: ${r.fixable}` : r.next_action);
  if (r.route === "Nudge to fix")
    log("Recoverable and priority", "Rule", `${r.recoverable}; score ${r.priority_score}${r.priority_rank ? ", rank #" + r.priority_rank : ""}`,
      `${app.days_since_last_activity} days inactive, ${app.attempts} attempts, Rs ${app.expected_monthly_tpv_inr_lakh}L expected TPV`);
  log("Channel and handling", "Rule", `${r.channel}; ${r.next_action}`, `Message type: ${r.message_type}`);

  // Write -> check -> rewrite once
  const convo = [{ role: "user", content: P.writeUserMessage(app, r) }];
  let msg = null, check = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let raw = "";
    try {
      raw = await callModel(P.WRITE_SYSTEM, convo);
      msg = parseJson(raw);
      log(attempt === 1 ? "Write messages" : "Rewrite messages", "AI", `Draft ${attempt} written (${app.preferred_language}, ${r.channel})`);
    } catch (err) {
      if (isBudgetStop(err)) throw err;
      msg = {};
      log(attempt === 1 ? "Write messages" : "Rewrite messages", "AI", "Reply could not be read", String(err.message || err));
    }
    check = Rules.safetyCheck(app, r, msg);
    const failed = check.checks.filter((c) => !c.pass);
    log(`Safety check (draft ${attempt})`, "Check", check.passed ? `All ${check.checks.length} checks passed` : `${failed.length} failed`,
      failed.map((c) => c.label + (c.detail ? ": " + c.detail : "")).join(" | "));
    if (check.passed) break;
    if (attempt === 1) {
      convo.push({ role: "assistant", content: raw || "{}" });
      convo.push({ role: "user", content: P.reviseUserMessage(failed) });
    }
  }
  result.message = msg;
  result.safety = check;
  result.drafts = convo.length > 1 ? 2 : 1;

  if (!check.passed) result.status = "Blocked: needs human";
  else if (escalated) result.status = "Escalated: human review";
  else if (r.message_type === "call_script") result.status = "Ready: human call";
  else result.status = "Ready for approval";
  log("Hand over", "Human", result.status, "Nothing is sent until a person approves it.");
}

module.exports = { runAgent, parseJson };
