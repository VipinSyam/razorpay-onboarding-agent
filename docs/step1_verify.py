"""
STEP 1 verification.
1. Recomputes every rule independently in pandas (no Excel) and compares with the
   workbook's recalculated formula values, cell by cell.
2. Compares two separate builds (reproducibility).
3. Reads the Checks sheet results.
Usage: python step1_verify.py <data_pack.xlsx> <run1.xlsx> <run2.xlsx>
"""
import os
import sys
import pandas as pd
from decimal import Decimal, ROUND_HALF_UP
from openpyxl import load_workbook

SRC, RUN1, RUN2 = sys.argv[1:4]
DAYS, ATT, DECAY, TPV, CONT = 30, 4, 15, 25, 3

raw = pd.read_excel(SRC, sheet_name="P3_Applications")
cat = pd.read_excel(SRC, sheet_name="P3_RejectionCatalog").set_index("code")
d = raw[raw.application_status != "Activated"].sort_values("application_id").reset_index(drop=True)


def diag(r):
    code, msg = r.rejection_code, r.rejection_message
    if pd.notna(code):
        return code
    if pd.isna(msg):
        return "R13"
    m = msg.lower()
    if any(k in m for k in ["not supported", "restricted", "support nahi", "prohibited"]):
        return "R10"
    if any(k in m for k in ["screening", "compliance", "sanction"]):
        return "R12"
    return "PENDING-AI"


d["diagnosed_code"] = d.apply(diag, axis=1)
d["route"] = d.diagnosed_code.map(lambda c: "Close politely" if c == "R10" else
                                  "Route to Compliance" if c == "R12" else "Nudge to fix")
nud = d.route == "Nudge to fix"
d["recoverable"] = "Not applicable"
ok = (d.days_since_last_activity <= DAYS) & (d.attempts < ATT)
d.loc[nud & ok, "recoverable"] = "Recoverable"
d.loc[nud & ~ok, "recoverable"] = "Low probability"
xround = lambda v: float(Decimal(str(round(v, 10))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))  # Excel-style rounding
d["priority_score"] = (d.expected_monthly_tpv_inr_lakh / (1 + d.days_since_last_activity / DECAY)).map(xround).where(nud, "-")
sc = pd.to_numeric(d.priority_score, errors="coerce")
d["priority_rank"] = sc.rank(method="min", ascending=False)
d["priority_rank"] = d.priority_rank.where(nud, "-")
d["human_call"] = (nud & (d.expected_monthly_tpv_inr_lakh >= TPV) &
                   ((d.support_contacts >= CONT) | (d.attempts >= ATT))).map({True: "Yes", False: "No"})
d["channel"] = d.whatsapp_opted_in.map(lambda v: "WhatsApp" if v == "Yes" else "Email + SMS")
d["fixable"] = d.diagnosed_code.map(lambda c: cat.fixable.get(c, "Pending"))

# ---- read workbook values
wb = load_workbook(RUN1, data_only=True)
ws = wb["Output"]
hdr = [c.value for c in ws[1]]
xl = pd.DataFrame([[c.value for c in row] for row in ws.iter_rows(min_row=2)], columns=hdr)

cols = ["diagnosed_code", "route", "recoverable", "priority_score", "priority_rank", "human_call", "channel", "fixable"]
mismatch = 0
compared = 0
for c in cols:
    for i in range(len(d)):
        a, b = d.loc[i, c], xl.loc[i, c]
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            same = abs(float(a) - float(b)) < 1e-6
        else:
            same = str(a) == str(b)
        compared += 1
        if not same:
            mismatch += 1
            print("MISMATCH", d.loc[i, "application_id"], c, a, b)
assert list(d.application_id) == list(xl.application_id)
print(f"Independent recomputation: {compared} cells compared, {mismatch} mismatches")

# ---- reproducibility: compare all values in all sheets
wb2 = load_workbook(RUN2, data_only=True)
diff = 0
cells = 0
for name in wb.sheetnames:
    for r1, r2 in zip(wb[name].iter_rows(values_only=True), wb2[name].iter_rows(values_only=True)):
        for v1, v2 in zip(r1, r2):
            cells += 1
            diff += v1 != v2
print(f"Reproducibility: {cells} cells compared across two builds, {diff} differences")

# ---- checks sheet
ck = wb["Checks"]
res = [(r[1], r[2], r[3], r[4]) for r in ck.iter_rows(min_row=4, values_only=True) if isinstance(r[0], int)]
for name, exp, act, out in res:
    print(f"{out:5}  {name}  | expected {exp} | actual {act}")
print("Checks passed:", sum(o == "PASS" for *_, o in res), "of", len(res))

# ---- quick summary print
sm = wb["Summary"]
for r in sm.iter_rows(min_row=5, max_row=16, values_only=True):
    print(r[:3])
print(xl.sort_values("priority_rank", key=lambda s: pd.to_numeric(s, errors="coerce"))
      [["application_id", "expected_monthly_tpv_inr_lakh", "days_since_last_activity", "diagnosed_code",
        "priority_score", "priority_rank", "human_call", "channel"]].head(10).to_string())
print(xl[xl.diagnosed_code.isin(["PENDING-AI", "R10", "R12"])][["application_id", "diagnosis_source",
      "keyword_safety_net", "diagnosed_code", "route", "rejection_message"]].to_string())

# Saved next to the workbook being checked (same folder as run1.xlsx).
with open(os.path.join(os.path.dirname(os.path.abspath(RUN1)), "verify_result.txt"), "w") as f:
    f.write(f"{compared},{mismatch},{cells},{diff}")
