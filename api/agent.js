/*
 * api/agent.js: the only server code. Runs on Vercel as a serverless function.
 * The Anthropic API key lives here (as an environment variable) and never reaches the browser.
 *
 *   GET  /api/agent                          -> health check (no AI call)
 *   POST /api/agent {action:"test"}          -> one tiny AI call to prove the key works
 *   POST /api/agent {application_id:"A3031"} -> run the agent on one application from the Data Pack
 *   POST /api/agent {application:{...}}      -> run the agent on a custom (test) application
 *   All POSTs need the header  x-passcode: <DEMO_PASSCODE>
 *
 * Environment variables (set in Vercel > Project > Settings > Environment Variables):
 *   ANTHROPIC_API_KEY  (required)   your key from console.anthropic.com
 *   DEMO_PASSCODE      (required)   a long secret passcode; live mode stays OFF if this is not set
 *   ANTHROPIC_MODEL    (optional)   defaults to claude-sonnet-5-5
 *
 * Time limits: Vercel stops this function after 120 seconds (vercel.json; the Hobby plan with
 * Fluid compute allows up to 300). We stop ourselves earlier, at 110 seconds, so the page always
 * gets a clear answer instead of a crash. One AI call may take up to 45 seconds, so a case that
 * needs a short note reading, a draft AND a rewrite (about 5 + 45 + 45 = 95 s) still fits.
 */
"use strict";
const crypto = require("crypto");
const apps = require("../data/applications.json");
const catalog = require("../data/catalog.json");
const { runAgent } = require("../lib/agent-core.js");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_TOKENS = 4000; // Kannada / Tamil text uses many tokens; 2000 cut long replies off

// Kept in one object so the tests can shrink them (they cannot wait 45 seconds).
const LIMITS = {
  callTimeoutMs: 45000,        // the longest we wait for one AI reply
  budgetMs: 110000,            // total time allowed for one request (vercel.json maxDuration 120 - 10 spare)
  wrongPasscodeDelayMs: 1500,  // pause before answering a wrong passcode (slows down guessing)
};
const TIME_LIMIT_REASON = "Time limit reached, re-run this application";
const MAX_NOTE_CHARS = 300;
const VALID_CODE = /^R(0[1-9]|1[0-3])$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString("utf8");
  return s ? JSON.parse(s) : {};
}

// Compares two passcodes in constant time, so the reply time gives no hint about how close a guess was.
// Both are hashed first, which makes them the same length (timingSafeEqual needs equal lengths).
function samePasscode(given, expected) {
  const a = crypto.createHash("sha256").update(String(given)).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function timeLimitError() {
  const e = new Error(TIME_LIMIT_REASON);
  e.budgetStop = true; // agent-core.js turns this into "Blocked: needs human"
  return e;
}

// The AI stopped because it reached MAX_TOKENS: the reply is incomplete. agent-core.js logs this clearly
// and asks for a shorter rewrite.
function cutOffError(partialText) {
  const e = new Error("AI reply was cut off (too long)");
  e.cutOff = true;
  e.partial = partialText;
  return e;
}

// Makes the AI caller for ONE request. Every call and every retry must fit in what is left of the budget.
function makeCallModel(startedAt) {
  const left = () => LIMITS.budgetMs - (Date.now() - startedAt);
  const fits = (waitFirstMs) => left() - (waitFirstMs || 0) >= LIMITS.callTimeoutMs;

  return async function callModel(system, messages) {
    let busyRetries = 0;    // up to 2 retries when the AI service is busy (429) or has an error (5xx)
    let timeoutRetries = 0; // up to 1 retry when the AI does not reply in time
    for (;;) {
      if (!fits()) throw timeLimitError();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), LIMITS.callTimeoutMs);
      let resp, data = null, errText = "";
      try {
        resp = await fetch(API_URL, {
          method: "POST",
          signal: ctrl.signal,
          headers: {
            "content-type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, messages }),
        });
        if (resp.ok) data = await resp.json();
        else errText = await resp.text();
      } catch (err) {
        if (err && err.name === "AbortError") {
          if (timeoutRetries < 1) { timeoutRetries++; continue; } // the budget is checked again at the top
          throw new Error(`The AI did not reply within ${LIMITS.callTimeoutMs / 1000} seconds (tried twice)`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
      if (resp.ok) {
        const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
        if (data.stop_reason === "max_tokens") throw cutOffError(text);
        return text;
      }
      if ((resp.status === 429 || resp.status >= 500) && busyRetries < 2) {
        const wait = 1500 * (busyRetries + 1);
        if (!fits(wait)) throw timeLimitError();
        busyRetries++;
        await sleep(wait);
        continue;
      }
      throw new Error(`Anthropic API error ${resp.status}: ${errText.slice(0, 300)}`);
    }
  };
}

// Stress-test applications are typed by a person, so check them before anything reaches the AI.
function checkCustom(a) {
  const note = a.rejection_message;
  if (note !== null && note !== undefined && typeof note !== "string") return "The reviewer note must be text.";
  if (typeof note === "string" && note.length > MAX_NOTE_CHARS)
    return `The reviewer note is too long: ${note.length} characters (maximum ${MAX_NOTE_CHARS}).`;
  const code = a.rejection_code;
  if (code !== null && code !== undefined && String(code).trim() !== "" &&
      !VALID_CODE.test(String(code).trim().toUpperCase()))
    return `Rejection code "${String(code).slice(0, 20)}" is not valid. Use R01 to R13, or leave it blank.`;
  return null;
}

async function handler(req, res) {
  const startedAt = Date.now();
  try {
    const hasKey = !!process.env.ANTHROPIC_API_KEY;
    const passcode = process.env.DEMO_PASSCODE;

    if (req.method === "GET") {
      return send(res, 200, { ok: true, has_api_key: hasKey, live_mode_configured: hasKey && !!passcode, model: MODEL });
    }
    if (req.method !== "POST") return send(res, 405, { error: "Use GET or POST" });

    if (!passcode) return send(res, 403, { error: "Live mode is off: DEMO_PASSCODE is not set in Vercel." });
    if (!samePasscode(req.headers["x-passcode"] || "", passcode)) {
      await sleep(LIMITS.wrongPasscodeDelayMs);
      return send(res, 401, { error: "Wrong passcode." });
    }
    if (!hasKey) return send(res, 500, { error: "ANTHROPIC_API_KEY is not set in Vercel." });

    const body = await readBody(req);
    const callModel = makeCallModel(startedAt);

    if (body.action === "test") {
      const text = await callModel("Reply with exactly: OK", [{ role: "user", content: "Say OK" }]);
      return send(res, 200, { ok: true, model: MODEL, reply: text.trim() });
    }

    let app = null;
    if (body.application_id) app = apps.find((a) => a.application_id === body.application_id);
    else if (body.application && typeof body.application === "object") {
      const problem = checkCustom(body.application);
      if (problem) return send(res, 400, { error: problem });
      app = Object.assign(
        { application_status: "Stalled", attempts: 1, support_contacts: 0,
          days_since_last_activity: 1, expected_monthly_tpv_inr_lakh: 5, whatsapp_opted_in: "Yes",
          preferred_language: "English", step_reached: "KYC docs", business_type: "Proprietorship" },
        body.application,
        { application_id: "CUSTOM" });
      const code = app.rejection_code;
      app.rejection_code = code === null || code === undefined || String(code).trim() === "" ? null : String(code).trim().toUpperCase();
    }
    if (!app) return send(res, 404, { error: "Application not found." });

    const result = await runAgent({
      app,
      apps: app.application_id === "CUSTOM" ? null : apps,
      catalog,
      assumptions: body.assumptions || undefined,
      callModel,
    });
    result.model = MODEL;
    return send(res, 200, result);
  } catch (err) {
    return send(res, 500, { error: String(err && err.message ? err.message : err) });
  }
}

module.exports = handler;
module.exports.LIMITS = LIMITS;               // for tests only
module.exports.TIME_LIMIT_REASON = TIME_LIMIT_REASON;
