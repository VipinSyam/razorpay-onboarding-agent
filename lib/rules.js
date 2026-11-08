/*
 * rules.js: the rulebook. Used by BOTH the web page (browser) and the agent (server).
 * Nothing in this file uses AI. Every decision here is a fixed, explainable rule.
 *
 *   1. Filter        skip applications that are already Activated
 *   2. Diagnose      code present -> catalog; no code + no message -> R13 (abandoned);
 *                    no code + message -> AI reads it, but a keyword safety net forces
 *                    R10 / R12 first if danger words appear
 *   3. Route         R10 -> close politely; R12 -> Compliance; else -> nudge
 *   4. Recoverable   inactive <= 30 days AND attempts < 4
 *   5. Priority      expected TPV / (1 + days inactive / 15)
 *   6. Channel       WhatsApp only if opted in, else Email + SMS;
 *                    human call if TPV >= 25L AND (contacts >= 3 OR attempts >= 4)
 *
 * Plus: the safety checker that every AI-written message must pass.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Rules = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULT_ASSUMPTIONS = {
    maxDays: 30,        // recoverable if inactive <= this many days
    maxAttempts: 4,     // recoverable if attempts < this; also a human-call trigger
    decayDays: 15,      // priority halves after this many days of silence
    humanTpv: 25,       // human call: minimum expected TPV (Rs lakh / month)
    humanContacts: 3,   // human call: minimum support contacts
  };

  const RESTRICTED_WORDS = ["not supported", "restricted", "support nahi", "prohibited"];
  const COMPLIANCE_WORDS = ["screening", "compliance", "sanction"];

  const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";

  // Excel-style rounding (0.525 -> 0.53), so the app matches the Step 1 workbook exactly.
  function round2(x) {
    return Math.round(Number((x * 100).toPrecision(12))) / 100;
  }

  // ---------------------------------------------------------------- stations 2-6
  function runRules(app, catalog, A, overrideCode) {
    A = Object.assign({}, DEFAULT_ASSUMPTIONS, A || {});
    const code = app.rejection_code, msg = app.rejection_message;
    const out = { application_id: app.application_id };

    // Station 2: diagnose
    if (!isBlank(code)) out.diagnosis_source = "Reviewer code";
    else if (isBlank(msg)) out.diagnosis_source = "No rejection: merchant stopped";
    else out.diagnosis_source = "Free text only: needs reading";

    out.keyword_safety_net = "n/a";
    if (out.diagnosis_source === "Free text only: needs reading") {
      const m = String(msg).toLowerCase();
      if (RESTRICTED_WORDS.some((w) => m.includes(w))) out.keyword_safety_net = "Restricted words found";
      else if (COMPLIANCE_WORDS.some((w) => m.includes(w))) out.keyword_safety_net = "Compliance words found";
      else out.keyword_safety_net = "No danger words";
    }

    let dc;
    if (!isBlank(code)) dc = code;
    else if (isBlank(msg)) dc = "R13";
    else if (out.keyword_safety_net === "Restricted words found") dc = "R10";
    else if (out.keyword_safety_net === "Compliance words found") dc = "R12";
    else dc = "PENDING-AI";
    // An AI-read code may fill in a PENDING-AI case only. It can never replace a forced R10 / R12.
    if (overrideCode && dc === "PENDING-AI") dc = overrideCode;
    out.diagnosed_code = dc;

    const c = catalog[dc];
    out.theme = c ? c.theme : "Pending AI diagnosis";
    out.plain_meaning = c ? c.plain_language_meaning : "Pending AI diagnosis";
    out.fixable = c ? c.fixable : "Pending";
    out.standard_fix = c ? c.standard_fix : "Pending AI diagnosis";
    out.typical_days_to_fix = c ? c.typical_days_to_fix : null;

    // Station 3: route
    out.route = dc === "R10" ? "Close politely" : dc === "R12" ? "Route to Compliance" : "Nudge to fix";
    const nudge = out.route === "Nudge to fix";

    // Station 4: recoverable
    const days = Number(app.days_since_last_activity), att = Number(app.attempts);
    const tpv = Number(app.expected_monthly_tpv_inr_lakh), cont = Number(app.support_contacts);
    out.recoverable = !nudge ? "Not applicable"
      : (days <= A.maxDays && att < A.maxAttempts) ? "Recoverable" : "Low probability";

    // Station 5: priority score (rank is assigned across all cases in runAll)
    out.priority_score = nudge ? round2(tpv / (1 + days / A.decayDays)) : null;
    out.priority_rank = null;

    // Station 6: channel + human call
    out.human_call = nudge && tpv >= A.humanTpv && (cont >= A.humanContacts || att >= A.maxAttempts) ? "Yes" : "No";
    out.channel = app.whatsapp_opted_in === "Yes" ? "WhatsApp" : "Email + SMS";
    out.next_action =
      out.route === "Close politely" ? "Onboarding team sends a polite closure. No workaround." :
      out.route === "Route to Compliance" ? "Compliance team reviews. Merchant is told only that it is under review." :
      out.human_call === "Yes" ? "Human call by an onboarding executive" :
      out.recoverable === "Recoverable" ? "Automated nudge" : "One final reminder, then stop";
    out.resume_at_step = nudge ? app.step_reached : null;
    out.message_type = messageType(out);
    out.follow_up_plan = followUpPlan(out.message_type);
    return out;
  }

  function messageType(r) {
    if (r.route === "Close politely") return "closure";
    if (r.route === "Route to Compliance") return "compliance_hold";
    if (r.diagnosed_code === "PENDING-AI") return "pending";
    if (r.human_call === "Yes") return "call_script";
    if (r.recoverable === "Recoverable") return "nudge";
    return "final_reminder";
  }

  // Follow-up sequence with stopping rules (rules, not AI).
  const STOP_RULES = "Stop at once if the merchant resumes or completes the step, replies STOP / opts out, " +
    "or contacts support (hand over to the support agent). Never send more than the steps listed.";
  function followUpPlan(type) {
    const plans = {
      nudge: ["Day 0: nudge", "Day 3: short reminder (only if not resumed)", "Day 7: final reminder, then stop"],
      final_reminder: ["Day 0: one final reminder, then stop"],
      call_script: ["Day 0: onboarding executive calls", "Day 2: message on the channel if not reached, then stop"],
      closure: ["Day 0: polite closure message after a human approves it. No follow-ups."],
      compliance_hold: ["Day 0: neutral 'under review' message. Any further contact comes only from the Compliance team."],
      pending: ["Waiting for the AI to read the reviewer note"],
    };
    return { steps: plans[type] || [], stop_rules: STOP_RULES };
  }

  // ---------------------------------------------------------------- station 1 + ranking
  function runAll(apps, catalog, A, overrides) {
    overrides = overrides || {};
    const rows = apps
      .filter((a) => a.application_status !== "Activated")
      .map((a) => runRules(a, catalog, A, overrides[a.application_id]));
    const scored = rows.filter((r) => r.route === "Nudge to fix");
    for (const r of scored) r.priority_rank = scored.filter((s) => s.priority_score > r.priority_score).length + 1;
    return rows;
  }

  // ---------------------------------------------------------------- merging the AI's reading
  // Decides what happens after the AI reads a free-text reviewer note. Rules have the last word.
  function mergeDiagnosis(rulesOut, ai, catalog) {
    const forced = rulesOut.keyword_safety_net === "Restricted words found" ? "R10"
      : rulesOut.keyword_safety_net === "Compliance words found" ? "R12" : null;
    const code = ai && ai.code ? String(ai.code).trim().toUpperCase() : null;
    const conf = ai && ai.confidence ? String(ai.confidence).toLowerCase() : "low";
    if (forced) {
      if (code === forced) return { decision: "confirmed", code: forced, note: `AI agrees with the safety net (${forced}).` };
      return { decision: "escalate", code: forced,
        note: `Safety net forced ${forced} but AI read it as ${code || "unknown"}. Route kept as ${forced}; a human reviews.` };
    }
    if (!code || !catalog[code]) return { decision: "escalate", code: null, note: `AI returned an unknown code (${code}). Human reviews.` };
    if (code === "R10" || code === "R12")
      return { decision: "escalate", code: null,
        note: `AI thinks this is ${code}, but closing or routing to Compliance is never decided by AI alone. Human reviews.` };
    if (conf !== "high") return { decision: "escalate", code: null, note: `AI is only ${conf}-confidence (${code}). Human reviews.` };
    return { decision: "accepted", code, note: `AI diagnosis accepted: ${code} (high confidence).` };
  }

  // ---------------------------------------------------------------- safety checker
  const SCRIPT = {
    Hindi: [/[ऀ-ॿ]/g, "Devanagari"], Marathi: [/[ऀ-ॿ]/g, "Devanagari"],
    Tamil: [/[஀-௿]/g, "Tamil"], Kannada: [/[ಀ-೿]/g, "Kannada"],
  };
  const ANY_INDIC = /[ऀ-෿]/;
  const DATE_RE = new RegExp(
    "\\b(mon|tues|wednes|thurs|fri|satur|sun)day\\b|\\btomorrow\\b|\\btoday\\b|\\btonight\\b|\\bkal\\b|" +
    "\\bwithin\\s+\\d+|\\bby\\s+(the\\s+)?(end\\s+of|next)\\b|" +
    "\\b\\d+\\s*(business\\s+|working\\s+)?(days?|hours?|hrs?|weeks?|din|ghante|ghanton)\\b|" +
    "\\b(jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s+\\d{1,2}\\b|" +
    "\\b\\d{1,2}(st|nd|rd|th)?\\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\b", "i");
  const LEAK_RE = /screening|sanction|watch\s?list|negative list|black\s?list|flagged|money laundering|\baml\b|\bpep\b|fraud|suspicious|criminal|police/i;
  const WORKAROUND_RE = /re-?apply|apply again|new application|different category|another category|change (your |the )?(business )?category|select (a )?different|workaround|try again|other (payment )?provider/i;
  const PROMISE_RE = /guarantee|definitely|surely|will be approved|will be activated|will go live|approval is certain|100\s?%/i;
  const STEP_RE = {
    "KYC docs": /kyc|document/i, "Bank verification": /bank/i,
    "Website/App review": /website|\bapp\b|site/i, "Business details": /detail|information/i,
  };
  const FIX_RE = {
    R01: /\bpan\b/i, R02: /\bgst/i, R03: /bank|account/i, R04: /ifsc|account|bank/i,
    R05: /clear|readable|blur|scan|upload|photo|copy/i, R06: /terms|privacy|refund|polic/i,
    R07: /website|live|login|open|access/i, R08: /address/i, R09: /signatory|director|\bid\b/i,
    R11: /category/i,
  };

  function safetyCheck(app, r, msg) {
    const checks = [];
    const add = (label, pass, detail) => checks.push({ label, pass: !!pass, detail: detail || "" });
    msg = msg || {};
    const wa = r.channel === "WhatsApp";
    const lang = app.preferred_language;
    const facing = ["whatsapp", "sms", "email_subject", "email_body", "reminder_day3", "final_day7"]
      .map((k) => msg[k]).filter((t) => !isBlank(t));
    const allText = facing.concat(isBlank(msg.back_translation_en) ? [] : [msg.back_translation_en]).join("\n");
    const english = lang === "English" || lang === "Hinglish"
      ? facing.join("\n") + "\n" + (msg.back_translation_en || "") : (msg.back_translation_en || "");

    // 1. required fields for this channel / type
    const need = wa ? ["whatsapp"] : ["sms", "email_subject", "email_body"];
    if (r.message_type === "nudge") need.push("reminder_day3", "final_day7");
    if (r.message_type === "call_script") need.push("call_script");
    if (lang !== "English") need.push("back_translation_en");
    const missing = need.filter((k) => isBlank(msg[k]));
    add("All required parts written", missing.length === 0, missing.length ? "Missing: " + missing.join(", ") : need.join(", "));

    // 2. channel rule
    const wrong = wa ? ["sms", "email_body"].filter((k) => !isBlank(msg[k])) : (isBlank(msg.whatsapp) ? [] : ["whatsapp"]);
    add("WhatsApp only if opted in", wrong.length === 0,
      wrong.length ? "Wrote " + wrong.join(", ") + " for a " + r.channel + " merchant" : "Channel: " + r.channel);

    // 3. script / language
    const mainTexts = ["whatsapp", "sms", "email_body"].map((k) => msg[k]).filter((t) => !isBlank(t));
    if (SCRIPT[lang]) {
      const [re, name] = SCRIPT[lang];
      const bad = mainTexts.filter((t) => (t.match(re) || []).length < 15);
      add("Written in the merchant's script", bad.length === 0, bad.length ? `Expected ${name} script` : `${name} script found`);
    } else {
      const bad = mainTexts.filter((t) => ANY_INDIC.test(t));
      add("Written in the merchant's script", bad.length === 0, bad.length ? "Expected Roman letters" : "Roman letters");
    }

    // 4. no dates or timelines promised
    const dm = allText.match(DATE_RE);
    add("No dates or timelines promised", !dm, dm ? `Found "${dm[0]}"` : "");

    // 5. no approval promises
    const pm = allText.match(PROMISE_RE);
    add("No promise of approval", !pm, pm ? `Found "${pm[0]}"` : "");

    // 6. never reveal screening / compliance reasons
    const lm = allText.match(LEAK_RE);
    add("No screening or compliance reasons revealed", !lm, lm ? `Found "${lm[0]}"` : "");

    // 7. closures: no workaround
    if (r.message_type === "closure") {
      const wm = allText.match(WORKAROUND_RE);
      add("No workaround suggested (restricted business)", !wm, wm ? `Found "${wm[0]}"` : "");
    }

    // 8. resume link: required for nudges, forbidden for closure / compliance
    const hasLink = facing.some((t) => t.includes("{resume_link}"));
    if (["closure", "compliance_hold"].includes(r.message_type))
      add("No resume link (nothing to resume)", !hasLink, hasLink ? "Contains {resume_link}" : "");
    else {
      const parts = ["whatsapp", "sms", "email_body", "reminder_day3", "final_day7"].filter((k) => !isBlank(msg[k]));
      const noLink = parts.filter((k) => !msg[k].includes("{resume_link}"));
      add("Resume link included", noLink.length === 0, noLink.length ? "Missing in: " + noLink.join(", ") : "");
    }

    // 9. names the right step and the right fix (checked on English text / back-translation)
    if (["nudge", "final_reminder", "call_script"].includes(r.message_type)) {
      const sre = STEP_RE[app.step_reached];
      if (sre) add("Names the step to resume", sre.test(english), app.step_reached);
      const fre = FIX_RE[r.diagnosed_code];
      if (fre) add("Mentions the right fix", fre.test(english), r.diagnosed_code + ": " + r.plain_meaning);
    }

    // 10. sender is identifiable
    const main = mainTexts.join("\n");
    add("Says it is from Razorpay", /razorpay|ரேசர்பே|ರೇಜರ್‌ಪೇ|रेज़रपे|रेजरपे/i.test(main), "");

    // 11. length
    const longOnes = [];
    const lim = (k, n) => { if (!isBlank(msg[k]) && msg[k].length > n) longOnes.push(`${k} ${msg[k].length}/${n}`); };
    lim("sms", SCRIPT[lang] ? 200 : 160); lim("whatsapp", 700); lim("email_body", 1500);
    lim("reminder_day3", 320); lim("final_day7", 320); lim("call_script", 1500);
    add("Length suitable for the channel", longOnes.length === 0, longOnes.join("; "));

    return { passed: checks.every((c) => c.pass), checks };
  }

  return { DEFAULT_ASSUMPTIONS, runRules, runAll, mergeDiagnosis, safetyCheck, followUpPlan, round2, isBlank };
});
