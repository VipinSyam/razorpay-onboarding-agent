/*
 * scripts/run_all.js: runs the LIVE agent on every application that is not yet Activated and
 * saves the results as saved_run.json, which the public demo page shows (no AI, no passcode).
 *
 *   Usage (from the project folder):   node scripts/run_all.js
 *
 * - The passcode is read from .env.passcode (git-ignored) and is never printed.
 * - Two applications run at a time.
 * - A failed call (network error, HTTP 5xx, or "Blocked" because of the time limit) is retried
 *   once after 3 seconds. Any other result, including a case blocked by the safety checks, is kept
 *   as it is: that is the safety system working, not a failure.
 * - Output format is exactly what index.html reads: {generated_at, model, note, results: {id: result}}.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const LIVE_URL = "https://razorpay-onboarding-agent-mu.vercel.app";
const ROOT = path.join(__dirname, "..");
const PARALLEL = 2;
const RETRY_WAIT_MS = 3000;

const passcode = fs.readFileSync(path.join(ROOT, ".env.passcode"), "utf8").trim();
const hide = (s) => String(s).split(passcode).join("[hidden]");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const apps = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "applications.json"), "utf8"));
const ids = apps.filter((a) => a.application_status !== "Activated").map((a) => a.application_id);

// One call to the live agent. Returns { ok, retryable, result, why }.
async function callAgent(id) {
  let resp, body;
  try {
    resp = await fetch(LIVE_URL + "/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json", "x-passcode": passcode },
      body: JSON.stringify({ application_id: id }),
    });
    body = await resp.json().catch(() => ({}));
  } catch (err) {
    return { ok: false, retryable: true, why: "Network error: " + hide(err.message) };
  }
  if (resp.status >= 500) return { ok: false, retryable: true, why: `HTTP ${resp.status}: ${hide(body.error || "")}` };
  if (!resp.ok) return { ok: false, retryable: false, why: `HTTP ${resp.status}: ${hide(body.error || "")}` };
  if (body.status === "Blocked: needs human" && /Time limit reached/.test(body.blocked_reason || ""))
    return { ok: false, retryable: true, result: body, why: "Time limit reached" };
  return { ok: true, result: body };
}

// The same shape the page uses when a live call fails, so the page shows it as Blocked with the reason.
function failedResult(id, why) {
  return { application_id: id, status: "Blocked: needs human", error: why, generated_at: new Date().toISOString(),
    trace: [{ step: "Agent call", actor: "Check", result: "Error", detail: why }] };
}

async function main() {
  const started = Date.now();
  const results = {};
  const queue = ids.slice();
  let done = 0, retried = 0;
  console.log(`Running the live agent on ${ids.length} applications, ${PARALLEL} at a time...`);

  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      const t0 = Date.now();
      let out = await callAgent(id);
      if (!out.ok && out.retryable) {
        retried++;
        console.log(`  ${id}: ${out.why}. Retrying once in ${RETRY_WAIT_MS / 1000} s...`);
        await sleep(RETRY_WAIT_MS);
        out = await callAgent(id);
      }
      results[id] = out.result && (out.ok || out.result.status) ? out.result : failedResult(id, out.why);
      done++;
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[${String(done).padStart(2)}/${ids.length}] ${id}  ${results[id].status}  (${secs} s)`);
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  // Keep the same order as the Data Pack, so the file is easy to read and compare.
  const ordered = {};
  for (const id of ids) ordered[id] = results[id];
  const model = Object.values(ordered).map((r) => r && r.model).find(Boolean) || null;
  const out = {
    generated_at: new Date().toISOString(),
    model,
    note: "Saved run of the onboarding recovery agent on all non-activated applications (scripts/run_all.js). Nothing was sent to any merchant.",
    results: ordered,
  };
  fs.writeFileSync(path.join(ROOT, "saved_run.json"), JSON.stringify(out, null, 1) + "\n");

  const counts = {};
  for (const r of Object.values(ordered)) counts[r.status] = (counts[r.status] || 0) + 1;
  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\nDone in ${mins} minutes. Retries used: ${retried}. Model: ${model}`);
  for (const [s, n] of Object.entries(counts)) console.log(`  ${s}: ${n}`);
  console.log("Saved to saved_run.json");
}

main().catch((e) => { console.error("Run failed:", hide(e.message)); process.exit(1); });
