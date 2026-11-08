"use strict";
const path = require("path").join(__dirname, "..") + "/";
const R = require(path + "lib/rules.js");
const apps = require(path + "data/applications.json"), catalog = require(path + "data/catalog.json");
let fails = 0;
const expect = (n, c, x) => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : " -> " + JSON.stringify(x))); if (!c) fails++; };
const get = (id) => apps.find((a) => a.application_id === id);
const failedLabels = (app, msg) => { const r = R.runRules(app, catalog); return R.safetyCheck(app, r, msg).checks.filter(c => !c.pass).map(c => c.label); };

// A3094 compliance (Tamil, WhatsApp): leak
let f = failedLabels(get("A3094"), { whatsapp: "ரேசர்பே: உங்கள் விண்ணப்பம் மதிப்பாய்வில் உள்ளது. நன்றி ரேசர்பே குழு", back_translation_en: "Your application had a screening hit." });
expect("Compliance leak caught", f.includes("No screening or compliance reasons revealed"), f);
// A3039 closure (English, WhatsApp): workaround + link
f = failedLabels(get("A3039"), { whatsapp: "Razorpay: We can't support this category. You can re-apply with a different category: {resume_link}" });
expect("Closure workaround caught", f.includes("No workaround suggested (restricted business)"), f);
expect("Closure link caught", f.includes("No resume link (nothing to resume)"), f);
// A3031 (Hinglish, Email+SMS): wrote WhatsApp instead + date promise
f = failedLabels(get("A3031"), { whatsapp: "Razorpay: GST theek karein, kal tak live ho jaoge {resume_link}", back_translation_en: "Fix GST, you will be live by tomorrow" });
expect("Wrong channel caught", f.includes("WhatsApp only if opted in"), f);
expect("Missing email/SMS caught", f.includes("All required parts written"), f);
expect("Date promise caught", f.includes("No dates or timelines promised"), f);
// A3006 Tamil written in English
f = failedLabels(get("A3006"), { whatsapp: "Razorpay: please finish your KYC docs {resume_link}", reminder_day3: "x {resume_link}", final_day7: "y {resume_link}", back_translation_en: "finish KYC documents" });
expect("Wrong script caught (Tamil expected)", f.includes("Written in the merchant's script"), f);
// Wrong fix: A3004 R01 PAN but message talks GST
f = failedLabels(get("A3004"), { whatsapp: "रेज़रपे: कृपया अपना जीएसटी प्रमाणपत्र फिर से अपलोड करें ताकि आवेदन पूरा हो {resume_link}", reminder_day3: "याद दिलाना {resume_link}", final_day7: "अंतिम {resume_link}", back_translation_en: "Razorpay: please re-upload your GST certificate at the KYC documents step" });
expect("Wrong fix caught (PAN expected)", f.includes("Mentions the right fix"), f);
// approval promise
f = failedLabels(get("A3100"), { whatsapp: "Razorpay: add policy pages to your website and you will be approved for sure {resume_link}", reminder_day3: "a {resume_link}", final_day7: "b {resume_link}" });
expect("Approval promise caught", f.includes("No promise of approval"), f);
// A clean English nudge passes
f = failedLabels(get("A3100"), { whatsapp: "Hi! Razorpay here. Your website review is paused because the website needs Terms, Privacy, Refund policy and Contact pages. Add them and resubmit: {resume_link} - Razorpay Onboarding Team", reminder_day3: "Reminder from Razorpay: add the policy pages and resubmit {resume_link}", final_day7: "Last reminder from Razorpay: {resume_link}" });
expect("Clean message passes all checks", f.length === 0, f);

// ---- HTTP wrapper with a fake Anthropic API
(async () => {
  process.env.ANTHROPIC_API_KEY = "test-key"; process.env.DEMO_PASSCODE = "secret";
  const { createMock } = require("./mock_model.js"); const mock = createMock();
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (opts.headers["x-api-key"] !== "test-key") throw new Error("key not sent");
    const text = body.system.startsWith("Reply with exactly") ? "OK" : await mock.callModel(body.system, body.messages);
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text }] }) };
  };
  const handler = require(path + "api/agent.js");
  const call = (method, headers, body) => new Promise((resolve) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { resolve({ code: this.statusCode, body: JSON.parse(s) }); } };
    handler({ method, headers: headers || {}, body }, res);
  });
  let r = await call("GET");
  expect("GET health ok", r.code === 200 && r.body.live_mode_configured === true, r);
  r = await call("POST", {}, { application_id: "A3031" });
  expect("POST without passcode refused (401)", r.code === 401, r);
  r = await call("POST", { "x-passcode": "secret" }, { action: "test" });
  expect("Test call returns OK", r.code === 200 && r.body.reply === "OK", r);
  r = await call("POST", { "x-passcode": "secret" }, { application_id: "A3031" });
  expect("Run A3031 via HTTP", r.code === 200 && r.body.status === "Ready for approval" && r.body.rules.priority_rank === 1, r.body.status);
  r = await call("POST", { "x-passcode": "secret" }, JSON.stringify({ application_id: "A3051" }));
  expect("String body accepted; A3051 closure", r.code === 200 && r.body.rules.route === "Close politely", r.body);
  r = await call("POST", { "x-passcode": "secret" }, { application_id: "NOPE" });
  expect("Unknown id -> 404", r.code === 404, r);

  // ---- Wrong passcode: 401, but only after a 1.5 second pause
  let t0 = Date.now();
  r = await call("POST", { "x-passcode": "wrong-guess" }, { application_id: "A3031" });
  let took = Date.now() - t0;
  expect("Wrong passcode -> 401 after ~1.5 s pause", r.code === 401 && took >= 1400, { code: r.code, took });
  t0 = Date.now();
  r = await call("POST", { "x-passcode": "secret" }, { action: "test" });
  took = Date.now() - t0;
  expect("Right passcode is not delayed", r.code === 200 && took < 1000, { code: r.code, took });

  // ---- Stress test input checks
  const custom = (extra) => ({ application: Object.assign({ preferred_language: "English", whatsapp_opted_in: "Yes" }, extra) });
  r = await call("POST", { "x-passcode": "secret" }, custom({ rejection_message: "x".repeat(301) }));
  expect("Custom note over 300 characters -> 400", r.code === 400 && /too long/.test(r.body.error), r);
  r = await call("POST", { "x-passcode": "secret" }, custom({ rejection_message: "x".repeat(300), rejection_code: "R02" }));
  expect("Custom note of exactly 300 characters is accepted", r.code === 200, r.body.error || r.body.status);
  r = await call("POST", { "x-passcode": "secret" }, custom({ rejection_code: "R99" }));
  expect("Custom code R99 -> 400", r.code === 400 && /not valid/.test(r.body.error), r);
  r = await call("POST", { "x-passcode": "secret" }, custom({ rejection_code: "DROP TABLE" }));
  expect("Custom code that is not a code -> 400", r.code === 400, r);
  r = await call("POST", { "x-passcode": "secret" }, custom({ rejection_code: " r02 " }));
  expect("Custom code ' r02 ' accepted as R02", r.code === 200 && r.body.rules.diagnosed_code === "R02", r.body.error || r.body.rules);

  // ---- Timeouts and the time budget (limits shrunk so the test runs in well under a second)
  const L = handler.LIMITS, saved = Object.assign({}, L), goodFetch = global.fetch;
  const abortError = () => { const e = new Error("aborted"); e.name = "AbortError"; return e; };
  const hangingFetch = (url, opts) => new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(abortError())));
  const slowFetch = (ms) => (url, opts) => new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(goodFetch(url, opts)), ms);
    opts.signal.addEventListener("abort", () => { clearTimeout(t); reject(abortError()); });
  });

  // a) First AI call times out, the retry fits in the budget and works
  L.callTimeoutMs = 100; L.budgetMs = 1000;
  let n = 0;
  global.fetch = (url, opts) => (++n === 1 ? hangingFetch(url, opts) : goodFetch(url, opts));
  r = await call("POST", { "x-passcode": "secret" }, { application_id: "A3031" });
  expect("Timed-out AI call retried once, then ready", r.code === 200 && r.body.status === "Ready for approval" && n === 2, { status: r.body.status, calls: n });

  // b) The AI call times out and there is no time left for a retry -> blocked with the reason
  L.callTimeoutMs = 100; L.budgetMs = 150;
  n = 0;
  global.fetch = (url, opts) => { n++; return hangingFetch(url, opts); };
  r = await call("POST", { "x-passcode": "secret" }, { application_id: "A3031" });
  expect("Timeout with no budget left -> Blocked, no retry", r.code === 200 && r.body.status === "Blocked: needs human" &&
    r.body.blocked_reason === handler.TIME_LIMIT_REASON && n === 1, { status: r.body.status, reason: r.body.blocked_reason, calls: n });

  // c) A3022 needs two AI calls (read note, then write). The second does not fit -> stop before calling
  L.callTimeoutMs = 100; L.budgetMs = 150;
  n = 0;
  const slow = slowFetch(80);
  global.fetch = (url, opts) => { n++; return slow(url, opts); };
  r = await call("POST", { "x-passcode": "secret" }, { application_id: "A3022" });
  expect("Next AI call would not fit -> Blocked before calling", r.code === 200 && r.body.status === "Blocked: needs human" &&
    r.body.blocked_reason === handler.TIME_LIMIT_REASON && n === 1 && !r.body.message,
    { status: r.body.status, reason: r.body.blocked_reason, calls: n });
  expect("Blocked reason is shown in the trace", r.body.trace.some((t) => t.detail === handler.TIME_LIMIT_REASON), r.body.trace);

  Object.assign(L, saved); global.fetch = goodFetch;
  delete process.env.DEMO_PASSCODE;
  r = await call("POST", { "x-passcode": "secret" }, { application_id: "A3031" });
  expect("No passcode configured -> live mode off (403)", r.code === 403, r);
  console.log(fails ? `\n${fails} FAILED` : "\nAll safety + HTTP tests passed");
})();
