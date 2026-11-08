// A fake AI used ONLY for testing the plumbing. It returns fixed, rule-following text.
"use strict";
const SAMPLE = {
  Hindi: "रेज़रपे: आपका आवेदन अधूरा है। कृपया दस्तावेज़ ठीक करके आगे बढ़ें",
  Marathi: "रेजरपे: तुमचा अर्ज अपूर्ण आहे. कृपया कागदपत्रे दुरुस्त करा",
  Tamil: "ரேசர்பே: உங்கள் விண்ணப்பம் முழுமையாகவில்லை. ஆவணங்களை சரிசெய்யவும்",
  Kannada: "ರೇಜರ್‌ಪೇ: ನಿಮ್ಮ ಅರ್ಜಿ ಅಪೂರ್ಣವಾಗಿದೆ. ದಯವಿಟ್ಟು ದಾಖಲೆಗಳನ್ನು ಸರಿಪಡಿಸಿ",
  Hinglish: "Razorpay: Aapka application adhoora hai. Kripya details theek karein",
  English: "Razorpay: Your application is incomplete. Please fix the details",
};
const FIXWORD = { R01: "PAN", R02: "GST", R03: "bank account", R04: "bank account and IFSC", R05: "clear upload",
  R06: "terms, privacy and refund policy pages", R07: "website live", R08: "address proof", R09: "signatory ID",
  R11: "category", R13: "details" };

function makeMessages(facts, opts) {
  const lang = facts.language, base = SAMPLE[lang], wa = facts.channel === "WhatsApp";
  const t = facts.message_type;
  const link = ["closure", "compliance_hold"].includes(t) ? "" : " {resume_link}";
  const fix = facts._fixword || "details";
  const main = ["closure", "compliance_hold"].includes(t) ? base + " - Razorpay Onboarding Team" : base + link;
  const m = { whatsapp: null, sms: null, email_subject: null, email_body: null, reminder_day3: null, final_day7: null,
    call_script: null, back_translation_en: null };
  if (wa) m.whatsapp = main; else { m.sms = main.slice(0, 140); m.email_subject = "Razorpay application"; m.email_body = main; }
  if (t === "nudge") { m.reminder_day3 = "Reminder" + link; m.final_day7 = "Last reminder" + link; }
  if (t === "call_script") m.call_script = "Greet the merchant, explain the issue, walk through the fix.";
  const step = facts.step_where_they_stopped || "";
  const en = t === "closure" ? "Razorpay cannot support this business under its policy. Thank you."
    : t === "compliance_hold" ? "Your application is under review. We will contact you if anything is needed."
    : `Your application stopped at ${step} (${step.toLowerCase().includes("kyc") ? "documents" : step}). Please fix: ${fix}. ${t}`;
  if (lang !== "English") m.back_translation_en = en;
  else { for (const k of ["whatsapp", "email_body"]) if (m[k]) m[k] = m[k] + " " + en; if (m.sms) m.sms = (m.sms + " " + fix).slice(0, 150); }
  if (opts && opts.bad) { const k = wa ? "whatsapp" : "email_body"; m[k] = m[k] + " You will be live within 24 hours."; }
  return m;
}

function createMock(options) {
  options = options || {};
  const calls = [];
  async function callModel(system, messages) {
    calls.push({ system: system.slice(0, 30), n: messages.length });
    const last = messages[messages.length - 1].content;
    if (system.startsWith("You help Razorpay")) {
      const note = last.match(/Reviewer note: "(.*)"/)[1].toLowerCase();
      if (options.disagree && note.includes("not supported")) return '{"code":"R07","confidence":"high","reason":"mock disagree"}';
      const code = note.includes("blur") ? "R05" : note.includes("pan") ? "R01" : note.includes("signatory") ? "R09" :
        note.includes("not supported") ? "R10" : "R13";
      const conf = options.lowConfidence ? "low" : "high";
      return JSON.stringify({ code, confidence: conf, reason: "mock" });
    }
    const first = messages[0].content;
    const facts = JSON.parse(first.slice(first.indexOf("{")));
    const fixText = (facts.fix_to_explain || "").toLowerCase();
    facts._fixword = /pan/.test(fixText) ? "PAN" : /gst/.test(fixText) ? "GST" : /ifsc/.test(fixText) ? "bank account IFSC" :
      /bank letter|current account/.test(fixText) ? "bank account" : /scan/.test(fixText) ? "clear upload" :
      /four pages/.test(fixText) ? "terms privacy refund policy" : /publicly/.test(fixText) ? "website live" :
      /address/.test(fixText) ? "address" : /signatory/.test(fixText) ? "signatory ID" : /category/.test(fixText) ? "category" : "details";
    const bad = options.badFirstDraft && messages.length === 1;
    const alwaysBad = options.alwaysBad;
    if (options.garbage && messages.length === 1) return "Sorry, I cannot do that.";
    return JSON.stringify(makeMessages(facts, { bad: bad || alwaysBad }));
  }
  return { callModel, calls };
}
module.exports = { createMock };
