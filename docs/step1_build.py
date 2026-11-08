"""
Razorpay Campus AI Build-a-thon | Problem 3 | STEP 1: RULES ENGINE
Author: Vipin Syam

What this script does
---------------------
Reads the Data Pack and writes an Excel workbook in which every decision is an
Excel formula. Nothing here is AI. The six "stations":

  1. Filter        keep only applications that are not Activated
  2. Diagnose      code present -> catalog lookup; no code + no message -> R13 abandoned;
                   no code + message -> needs reading (AI in Step 2), with a keyword
                   safety net that forces R10 / R12 if danger words appear
  3. Route         R10 -> close politely; R12 -> Compliance; everything else -> nudge
  4. Recoverable   nudge cases: inactive <= 30 days AND attempts < 4
  5. Priority      expected TPV / (1 + days inactive / 15), ranked among nudge cases
  6. Channel       WhatsApp if opted in, else Email + SMS;
                   human call if TPV >= 25L AND (support contacts >= 3 OR attempts >= 4)

All thresholds live on the Assumptions sheet, so changing a number there
re-computes the whole workbook.

Usage: python step1_build.py <data_pack.xlsx> <output.xlsx>
"""
import sys
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.formatting.rule import FormulaRule
from openpyxl.comments import Comment

SRC, OUT = sys.argv[1], sys.argv[2]

# ---------------------------------------------------------------- styles
F = "Arial"
BASE = Font(name=F, size=10)
BOLD = Font(name=F, size=10, bold=True)
TITLE = Font(name=F, size=14, bold=True)
H_WHITE = Font(name=F, size=10, bold=True, color="FFFFFF")
FILL_DATA = PatternFill("solid", fgColor="595959")     # header: raw data columns
FILL_RULE = PatternFill("solid", fgColor="1F4E79")     # header: rule-computed columns
FILL_INPUT = PatternFill("solid", fgColor="FFFF00")    # editable assumption
FILL_SECTION = PatternFill("solid", fgColor="D9E1F2")
FILL_CLOSE = PatternFill("solid", fgColor="F8CBAD")
FILL_COMPL = PatternFill("solid", fgColor="FFE699")
FILL_HUMAN = PatternFill("solid", fgColor="C6E0B4")
FILL_PASS = PatternFill("solid", fgColor="C6EFCE")
FILL_FAIL = PatternFill("solid", fgColor="FFC7CE")
THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WRAP = Alignment(wrap_text=True, vertical="top")
INPUT_BLUE = Font(name=F, size=10, color="0000FF", bold=True)


def style_range(ws, min_row, max_row, min_col, max_col, font=BASE, wrap=False):
    for row in ws.iter_rows(min_row=min_row, max_row=max_row, min_col=min_col, max_col=max_col):
        for c in row:
            c.font = font
            c.border = BOX
            if wrap:
                c.alignment = WRAP


# ---------------------------------------------------------------- data
raw = pd.read_excel(SRC, sheet_name="P3_Applications")
cat = pd.read_excel(SRC, sheet_name="P3_RejectionCatalog")

# Our own grouping of the 13 codes into themes, for the "top systemic causes" summary.
THEME = {
    "R01": "Name / identity mismatch", "R02": "Name / identity mismatch", "R03": "Name / identity mismatch",
    "R04": "Bank details entered wrongly", "R05": "Document quality / missing document",
    "R08": "Document quality / missing document", "R09": "Document quality / missing document",
    "R06": "Website not ready", "R07": "Website not ready", "R11": "Website not ready",
    "R10": "Not fixable (restricted business)", "R12": "Compliance review",
    "R13": "Abandoned (no rejection)",
}

work = raw[raw["application_status"] != "Activated"].copy()

# Row order: a stable, readable order (by application id). Ranking is a formula column.
work = work.sort_values("application_id").reset_index(drop=True)
N = len(work)
LAST = N + 1  # last data row on Output

wb = Workbook()

# ================================================================ README
rd = wb.active
rd.title = "README"
readme = [
    ("Razorpay Campus AI Build-a-thon | Problem 3: Onboarding & KYC drop-off recovery", TITLE),
    ("Step 1 output: the rules engine (no AI used in this file)", BOLD),
    ("", BASE),
    ("What this workbook is", BOLD),
    ("Every stalled or rejected application from the Data Pack (75 of 100; the 25 already Activated are excluded) "
     "passes through six fixed rules. Every decision column on the Output sheet is an Excel formula, so you can "
     "click any cell to see the rule, and changing a yellow cell on the Assumptions sheet re-computes everything.", BASE),
    ("", BASE),
    ("The six stations", BOLD),
    ("1. Filter: keep applications whose status is not Activated.", BASE),
    ("2. Diagnose: rejection code present -> look it up in the Catalog. No code and no reviewer message -> R13 "
     "(abandoned, merchant just stopped). No code but a reviewer message -> needs reading by AI in Step 2; "
     "a keyword safety net forces R10 / R12 if restricted or compliance words appear, so the most dangerous "
     "mistake never depends on AI alone.", BASE),
    ("3. Route: R10 -> close politely (no workarounds). R12 -> Compliance team (merchant is only told it is under "
     "review). Everything else -> nudge the merchant to fix.", BASE),
    ("4. Recoverable (nudge cases only): inactive <= 30 days AND fewer than 4 attempts. Otherwise 'Low probability' "
     "(one final reminder, then stop).", BASE),
    ("5. Priority (nudge cases only): expected monthly TPV / (1 + days inactive / 15). A lead loses about half its "
     "value after 15 days of silence. Rank 1 = contact first.", BASE),
    ("6. Channel: WhatsApp if the merchant opted in, otherwise Email + SMS. Human call instead of an automated "
     "message if expected TPV >= Rs 25 lakh AND (support contacts >= 3 OR attempts >= 4).", BASE),
    ("", BASE),
    ("Sheets", BOLD),
    ("Assumptions: the five thresholds (yellow cells are editable).", BASE),
    ("Output: one row per application. Grey headers = raw data from the Data Pack. Blue headers = rule results.", BASE),
    ("Summary: counts, expected TPV at stake, and causes.", BASE),
    ("Checks: automatic working tests (PASS / FAIL).", BASE),
    ("Catalog: the 13 rejection codes from the Data Pack, plus our own 'theme' grouping.", BASE),
    ("Raw Data: the untouched P3_Applications tab (all 100 rows).", BASE),
    ("", BASE),
    ("Not in this step", BOLD),
    ("3 applications show 'PENDING-AI': they have no code, only reviewer free text with no danger words. "
     "Step 2 (AI) reads that text and assigns the code. Nudge messages are also written in Step 2.", BASE),
    ("", BASE),
    ("Data", BOLD),
    ("All data is synthetic, from the Razorpay Build-a-thon Data Pack (snapshot 30 Sep 2026). "
     "Policies follow the Data Pack's catalog as the source of truth.", BASE),
]
for i, (txt, fnt) in enumerate(readme, start=1):
    c = rd.cell(row=i, column=1, value=txt)
    c.font = fnt
    c.alignment = Alignment(wrap_text=True, vertical="top")
rd.column_dimensions["A"].width = 120

# ================================================================ ASSUMPTIONS
asm = wb.create_sheet("Assumptions")
asm["A1"] = "Assumptions (edit the yellow cells; every rule on the Output sheet reads from here)"
asm["A1"].font = TITLE
asm.append([])
asm.append(["Assumption", "Value", "Unit", "Used in", "Why / source"])
rows = [
    ("Max days inactive to count as recoverable", 30, "days", "Station 4",
     "Our assumption (agreed with Vipin). Beyond ~1 month a stalled lead is cold; the Data Pack gives no rule."),
    ("Attempts at which a case is no longer 'recoverable' / triggers human call", 4, "attempts", "Stations 4 and 6",
     "Our assumption. 4 is the maximum seen in the data: repeated failure signals frustration."),
    ("Priority decay: days after which a lead is worth half", 15, "days", "Station 5",
     "Our assumption. Priority = TPV / (1 + days / this value)."),
    ("Human call: minimum expected monthly TPV", 25, "Rs lakh / month", "Station 6",
     "Our assumption. High-value merchants justify an onboarding executive's time."),
    ("Human call: minimum support contacts", 3, "contacts", "Station 6",
     "Our assumption. 3 is the maximum seen in the data: repeated support contact signals frustration."),
]
for r in rows:
    asm.append(list(r))
style_range(asm, 3, 8, 1, 5, wrap=True)
for c in asm[3]:
    c.font = H_WHITE
    c.fill = FILL_RULE
for r in range(4, 9):
    asm.cell(row=r, column=2).fill = FILL_INPUT
    asm.cell(row=r, column=2).font = INPUT_BLUE
asm.append([])
asm.append(["Channel rule: WhatsApp only if whatsapp_opted_in = Yes (Data Pack rule). Otherwise Email + SMS "
            "(our assumption: the Data Pack names no other channel)."])
asm.cell(row=asm.max_row, column=1).font = BASE
for col, w in zip("ABCDE", [52, 10, 16, 18, 80]):
    asm.column_dimensions[col].width = w
A_DAYS, A_ATT, A_DECAY, A_TPV, A_CONT = ("Assumptions!$B$4", "Assumptions!$B$5", "Assumptions!$B$6",
                                         "Assumptions!$B$7", "Assumptions!$B$8")

# ================================================================ CATALOG
cs = wb.create_sheet("Catalog")
cs.append(["code", "reviewer_reason", "plain_language_meaning", "fixable", "standard_fix",
           "typical_days_to_fix", "theme (our grouping)"])
for _, r in cat.iterrows():
    cs.append([r["code"], r["reviewer_reason"], r["plain_language_meaning"], r["fixable"],
               r["standard_fix"], r["typical_days_to_fix"], THEME[r["code"]]])
style_range(cs, 1, cs.max_row, 1, 7, wrap=True)
for c in cs[1]:
    c.font = H_WHITE
    c.fill = FILL_DATA
cs.cell(row=1, column=7).fill = FILL_RULE
cs.cell(row=1, column=7).comment = Comment("Our own grouping of codes into themes; not part of the Data Pack.", "Vipin")
for col, w in zip("ABCDEFG", [7, 34, 48, 14, 60, 10, 32]):
    cs.column_dimensions[col].width = w
CAT_LAST = cs.max_row  # 14
CAT = lambda col: f"Catalog!${col}$2:${col}${CAT_LAST}"

# ================================================================ RAW DATA
rw = wb.create_sheet("Raw Data")
rw.append(list(raw.columns))
for _, r in raw.iterrows():
    rw.append([None if pd.isna(v) else v for v in r.tolist()])
style_range(rw, 1, rw.max_row, 1, rw.max_column)
for c in rw[1]:
    c.font = H_WHITE
    c.fill = FILL_DATA
rw.freeze_panes = "B2"
RAW_LAST = rw.max_row
RAW_STATUS = f"'Raw Data'!$J$2:$J${RAW_LAST}"
RAW_TPV = f"'Raw Data'!$G$2:$G${RAW_LAST}"
assert rw["J1"].value == "application_status" and rw["G1"].value == "expected_monthly_tpv_inr_lakh"

# ================================================================ OUTPUT
out = wb.create_sheet("Output", 1)
raw_cols = ["application_id", "business_type", "industry", "city", "preferred_language", "whatsapp_opted_in",
            "step_reached", "application_status", "days_since_last_activity", "attempts", "support_contacts",
            "expected_monthly_tpv_inr_lakh", "rejection_code", "rejection_message"]          # A..N
rule_cols = ["diagnosis_source", "keyword_safety_net", "diagnosed_code", "theme", "plain_meaning", "fixable",
             "route", "recoverable", "priority_score", "priority_rank", "human_call", "channel",
             "next_action", "resume_at_step", "standard_fix", "typical_days_to_fix"]          # O..AD
out.append(raw_cols + rule_cols)

for i, r in work.iterrows():
    x = i + 2
    vals = [None if pd.isna(r[c]) else r[c] for c in raw_cols]
    formulas = [
        # O diagnosis_source
        f'=IF(M{x}<>"","Reviewer code",IF(N{x}="","No rejection: merchant stopped","Free text only: needs reading"))',
        # P keyword_safety_net
        f'=IF(O{x}<>"Free text only: needs reading","n/a",'
        f'IF(OR(ISNUMBER(SEARCH("not supported",N{x})),ISNUMBER(SEARCH("restricted",N{x})),'
        f'ISNUMBER(SEARCH("support nahi",N{x})),ISNUMBER(SEARCH("prohibited",N{x}))),"Restricted words found",'
        f'IF(OR(ISNUMBER(SEARCH("screening",N{x})),ISNUMBER(SEARCH("compliance",N{x})),'
        f'ISNUMBER(SEARCH("sanction",N{x}))),"Compliance words found","No danger words")))',
        # Q diagnosed_code
        f'=IF(M{x}<>"",M{x},IF(N{x}="","R13",IF(P{x}="Restricted words found","R10",'
        f'IF(P{x}="Compliance words found","R12","PENDING-AI"))))',
        # R theme
        f'=IFERROR(INDEX({CAT("G")},MATCH(Q{x},{CAT("A")},0)),"Pending AI diagnosis")',
        # S plain_meaning
        f'=IFERROR(INDEX({CAT("C")},MATCH(Q{x},{CAT("A")},0)),"Pending AI diagnosis (Step 2)")',
        # T fixable
        f'=IFERROR(INDEX({CAT("D")},MATCH(Q{x},{CAT("A")},0)),"Pending")',
        # U route
        f'=IF(Q{x}="R10","Close politely",IF(Q{x}="R12","Route to Compliance","Nudge to fix"))',
        # V recoverable
        f'=IF(U{x}<>"Nudge to fix","Not applicable",IF(AND(I{x}<={A_DAYS},J{x}<{A_ATT}),"Recoverable","Low probability"))',
        # W priority_score
        f'=IF(U{x}="Nudge to fix",ROUND(L{x}/(1+I{x}/{A_DECAY}),2),"-")',
        # X priority_rank
        f'=IF(U{x}="Nudge to fix",COUNTIFS($U$2:$U${LAST},"Nudge to fix",$W$2:$W${LAST},">"&W{x})+1,"-")',
        # Y human_call
        f'=IF(AND(U{x}="Nudge to fix",L{x}>={A_TPV},OR(K{x}>={A_CONT},J{x}>={A_ATT})),"Yes","No")',
        # Z channel
        f'=IF(F{x}="Yes","WhatsApp","Email + SMS")',
        # AA next_action
        f'=IF(U{x}="Close politely","Onboarding team sends a polite closure. No workaround.",'
        f'IF(U{x}="Route to Compliance","Compliance team reviews. Merchant is told only that it is under review.",'
        f'IF(Y{x}="Yes","Human call by an onboarding executive",'
        f'IF(V{x}="Recoverable","Automated nudge","One final reminder, then stop"))))',
        # AB resume_at_step
        f'=IF(U{x}="Nudge to fix",G{x},"-")',
        # AC standard_fix
        f'=IFERROR(INDEX({CAT("E")},MATCH(Q{x},{CAT("A")},0)),"Pending AI diagnosis (Step 2)")',
        # AD typical_days_to_fix
        f'=IFERROR(INDEX({CAT("F")},MATCH(Q{x},{CAT("A")},0)),"-")',
    ]
    out.append(vals + formulas)

ncols = len(raw_cols) + len(rule_cols)
style_range(out, 1, LAST, 1, ncols)
for j, c in enumerate(out[1], start=1):
    c.font = H_WHITE
    c.fill = FILL_DATA if j <= len(raw_cols) else FILL_RULE
    c.alignment = Alignment(wrap_text=True, vertical="center")
out.row_dimensions[1].height = 32
out.freeze_panes = "B2"
out.auto_filter.ref = f"A1:AD{LAST}"
widths = dict(A=11, B=14, C=18, D=11, E=11, F=9, G=16, H=10, I=9, J=8, K=8, L=10, M=8, N=40,
              O=24, P=20, Q=10, R=26, S=42, T=12, U=18, V=15, W=9, X=8, Y=8, Z=12, AA=44, AB=16,
              AC=60, AD=8)
for col, w in widths.items():
    out.column_dimensions[col].width = w
# Conditional colours (they update if assumptions change)
rng = f"A2:AD{LAST}"
out.conditional_formatting.add(rng, FormulaRule(formula=['$U2="Close politely"'], fill=FILL_CLOSE))
out.conditional_formatting.add(rng, FormulaRule(formula=['$U2="Route to Compliance"'], fill=FILL_COMPL))
out.conditional_formatting.add(f"Y2:Y{LAST}", FormulaRule(formula=['$Y2="Yes"'], fill=FILL_HUMAN))
out.conditional_formatting.add(f"Q2:Q{LAST}", FormulaRule(formula=['$Q2="PENDING-AI"'],
                               fill=PatternFill("solid", fgColor="D9D2E9")))
out.cell(row=1, column=16).comment = Comment(
    "Only checked when there is no code but there is reviewer text. If restricted or compliance words appear, "
    "the case is forced to R10 / R12 regardless of what AI later says.", "Vipin")
out.cell(row=1, column=23).comment = Comment("Expected monthly TPV / (1 + days inactive / decay). Nudge cases only.", "Vipin")

O = lambda col: f"Output!${col}$2:${col}${LAST}"

# ================================================================ SUMMARY
sm = wb.create_sheet("Summary", 2)
sm["A1"] = "Summary (all formulas; updates if assumptions change)"
sm["A1"].font = TITLE
r0 = 3


def section(ws, row, title, headers):
    ws.cell(row=row, column=1, value=title).font = BOLD
    ws.cell(row=row, column=1).fill = FILL_SECTION
    for k, h in enumerate(headers, start=1):
        c = ws.cell(row=row + 1, column=k, value=h)
        c.font = H_WHITE
        c.fill = FILL_RULE
        c.border = BOX
    return row + 2


row = section(sm, r0, "A. Funnel", ["Item", "Applications", "Expected TPV (Rs lakh / month)"])
funnel = [
    ("All applications in the Data Pack", f"=COUNTA('Raw Data'!$A$2:$A${RAW_LAST})", f"=SUM({RAW_TPV})"),
    ("Already activated (excluded)", f'=COUNTIF({RAW_STATUS},"Activated")', f'=SUMIF({RAW_STATUS},"Activated",{RAW_TPV})'),
    ("Need action (on Output sheet)", f"=COUNTA({O('A')})", f"=SUM({O('L')})"),
    ("  Route: nudge to fix", f'=COUNTIF({O("U")},"Nudge to fix")', f'=SUMIF({O("U")},"Nudge to fix",{O("L")})'),
    ("     of which recoverable", f'=COUNTIF({O("V")},"Recoverable")', f'=SUMIF({O("V")},"Recoverable",{O("L")})'),
    ("     of which low probability", f'=COUNTIF({O("V")},"Low probability")', f'=SUMIF({O("V")},"Low probability",{O("L")})'),
    ("     of which flagged for a human call", f'=COUNTIF({O("Y")},"Yes")', f'=SUMIF({O("Y")},"Yes",{O("L")})'),
    ("  Route: close politely (R10)", f'=COUNTIF({O("U")},"Close politely")', f'=SUMIF({O("U")},"Close politely",{O("L")})'),
    ("  Route: Compliance (R12)", f'=COUNTIF({O("U")},"Route to Compliance")', f'=SUMIF({O("U")},"Route to Compliance",{O("L")})'),
    ("Diagnosis pending AI (Step 2)", f'=COUNTIF({O("Q")},"PENDING-AI")', f'=SUMIF({O("Q")},"PENDING-AI",{O("L")})'),
    ("Channel: WhatsApp", f'=COUNTIF({O("Z")},"WhatsApp")', f'=SUMIF({O("Z")},"WhatsApp",{O("L")})'),
    ("Channel: Email + SMS", f'=COUNTIF({O("Z")},"Email + SMS")', f'=SUMIF({O("Z")},"Email + SMS",{O("L")})'),
]
start = row
for f in funnel:
    for k, v in enumerate(f, start=1):
        sm.cell(row=row, column=k, value=v)
    row += 1
style_range(sm, start, row - 1, 1, 3)
for rr in range(start, row):
    sm.cell(row=rr, column=3).number_format = "#,##0.0"

row += 1
row = section(sm, row, "B. Causes among 'nudge to fix' cases (by diagnosed code)",
              ["Code", "Applications", "Expected TPV (Rs lakh / month)", "Plain meaning", "Theme"])
start = row
codes = [c for c in cat["code"] if c not in ("R10", "R12")] + ["PENDING-AI"]
for code in codes:
    sm.cell(row=row, column=1, value=code)
    sm.cell(row=row, column=2, value=f'=COUNTIFS({O("U")},"Nudge to fix",{O("Q")},A{row})')
    sm.cell(row=row, column=3, value=f'=SUMIFS({O("L")},{O("U")},"Nudge to fix",{O("Q")},A{row})')
    sm.cell(row=row, column=4, value=f'=IFERROR(INDEX({CAT("C")},MATCH(A{row},{CAT("A")},0)),"Awaiting AI reading of reviewer text")')
    sm.cell(row=row, column=5, value=f'=IFERROR(INDEX({CAT("G")},MATCH(A{row},{CAT("A")},0)),"Pending")')
    row += 1
sm.cell(row=row, column=1, value="Total")
sm.cell(row=row, column=2, value=f"=SUM(B{start}:B{row-1})")
sm.cell(row=row, column=3, value=f"=SUM(C{start}:C{row-1})")
style_range(sm, start, row, 1, 5, wrap=True)
sm.cell(row=row, column=1).font = BOLD
for rr in range(start, row + 1):
    sm.cell(row=rr, column=3).number_format = "#,##0.0"
row += 2

row = section(sm, row, "C. Causes among 'nudge to fix' cases (by theme)",
              ["Theme", "Applications", "Expected TPV (Rs lakh / month)"])
start = row
themes = ["Abandoned (no rejection)", "Name / identity mismatch", "Website not ready",
          "Document quality / missing document", "Bank details entered wrongly"]
for t in themes:
    sm.cell(row=row, column=1, value=t)
    sm.cell(row=row, column=2, value=f'=COUNTIFS({O("U")},"Nudge to fix",{O("R")},A{row})')
    sm.cell(row=row, column=3, value=f'=SUMIFS({O("L")},{O("U")},"Nudge to fix",{O("R")},A{row})')
    row += 1
sm.cell(row=row, column=1, value="Pending AI diagnosis")
sm.cell(row=row, column=2, value=f'=COUNTIFS({O("U")},"Nudge to fix",{O("R")},"Pending AI diagnosis")')
sm.cell(row=row, column=3, value=f'=SUMIFS({O("L")},{O("U")},"Nudge to fix",{O("R")},"Pending AI diagnosis")')
row += 1
style_range(sm, start, row - 1, 1, 3)
for rr in range(start, row):
    sm.cell(row=rr, column=3).number_format = "#,##0.0"
sm.cell(row=row + 1, column=1,
        value="Note: themes are our own grouping of the catalog codes (see Catalog sheet, column G). "
              "Counts will shift slightly after Step 2 assigns codes to the PENDING-AI rows.").font = Font(name=F, size=9, italic=True)
for col, w in zip("ABCDE", [44, 14, 30, 60, 34]):
    sm.column_dimensions[col].width = w

# ================================================================ CHECKS
ck = wb.create_sheet("Checks", 3)
ck["A1"] = "Working checks (does the machine run properly?)"
ck["A1"].font = TITLE
ck.append([])
ck.append(["#", "Check", "Expected", "Actual", "Result"])
OUT_ID = O("A")


def look(app, col):
    return f'INDEX({O(col)},MATCH("{app}",{OUT_ID},0))'


checks = [
    ("Rows out = non-activated rows in the Data Pack", f'=COUNTIF({RAW_STATUS},"<>Activated")', f"=COUNTA({OUT_ID})"),
    ("Activated applications on Output (must be 0)", 0, f'=COUNTIF({O("H")},"Activated")'),
    ("Duplicate application IDs on Output (must be 0)", 0, f"=SUMPRODUCT((COUNTIF({OUT_ID},{OUT_ID})>1)*1)"),
    ("Empty cells in rule columns O:AD (must be 0)", 0, f"=COUNTBLANK(Output!$O$2:$AD${LAST})"),
    ("Routes add up: nudge + close + Compliance", f"=COUNTA({OUT_ID})",
     f'=COUNTIF({O("U")},"Nudge to fix")+COUNTIF({O("U")},"Close politely")+COUNTIF({O("U")},"Route to Compliance")'),
    ("Recoverable + low probability = nudge cases", f'=COUNTIF({O("U")},"Nudge to fix")',
     f'=COUNTIF({O("V")},"Recoverable")+COUNTIF({O("V")},"Low probability")'),
    ("Channels add up: WhatsApp + Email/SMS", f"=COUNTA({OUT_ID})",
     f'=COUNTIF({O("Z")},"WhatsApp")+COUNTIF({O("Z")},"Email + SMS")'),
    ("WhatsApp used only where opted in (violations, must be 0)", 0,
     f'=COUNTIFS({O("Z")},"WhatsApp",{O("F")},"<>Yes")'),
    ("Total expected TPV on Output = Data Pack non-activated TPV",
     f'=ROUND(SUMIF({RAW_STATUS},"<>Activated",{RAW_TPV}),1)', f"=ROUND(SUM({O('L')}),1)"),
    ("Every nudge case has a priority rank", f'=COUNTIF({O("U")},"Nudge to fix")', f"=COUNT({O('X')})"),
    ("Exactly one application ranked #1", 1, f"=COUNTIF({O('X')},1)"),
    ("Checkpoint A3051 (blank code, 'not supported' text): route", "Close politely", "=" + look("A3051", "U")),
    ("Checkpoint A3096 (R12): route", "Route to Compliance", "=" + look("A3096", "U")),
    ("Checkpoint A3004 (R01, Hindi, WhatsApp): code", "R01", "=" + look("A3004", "Q")),
    ("Checkpoint A3004: language", "Hindi", "=" + look("A3004", "E")),
    ("Checkpoint A3004: channel", "WhatsApp", "=" + look("A3004", "Z")),
    ("Checkpoint A3031 (Rs 43.3L, 4 days, no WhatsApp): priority rank", 1, "=" + look("A3031", "X")),
    ("Checkpoint A3031: channel", "Email + SMS", "=" + look("A3031", "Z")),
    ("Checkpoint A3023 (Rs 59.9L, 3 attempts, 3 contacts): human call", "Yes", "=" + look("A3023", "Y")),
    ("Checkpoint A3005 (blank code, no text): code", "R13", "=" + look("A3005", "Q")),
    ("Checkpoint A3005: resume at step", "KYC docs", "=" + look("A3005", "AB")),
]
start = 4
for k, (name, exp, act) in enumerate(checks, start=1):
    rr = start + k - 1
    ck.cell(row=rr, column=1, value=k)
    ck.cell(row=rr, column=2, value=name)
    ck.cell(row=rr, column=3, value=exp)
    ck.cell(row=rr, column=4, value=act)
    ck.cell(row=rr, column=5, value=f'=IF(C{rr}=D{rr},"PASS","FAIL")')
end = start + len(checks) - 1
ck.cell(row=end + 2, column=2, value="Checks passed").font = BOLD
ck.cell(row=end + 2, column=4, value=f'=COUNTIF(E{start}:E{end},"PASS")&" of "&COUNTA(E{start}:E{end})')
ck.cell(row=end + 2, column=4).font = BOLD
style_range(ck, 3, end, 1, 5, wrap=True)
for c in ck[3]:
    c.font = H_WHITE
    c.fill = FILL_RULE
ck.conditional_formatting.add(f"E{start}:E{end}", FormulaRule(formula=[f'E{start}="PASS"'], fill=FILL_PASS))
ck.conditional_formatting.add(f"E{start}:E{end}", FormulaRule(formula=[f'E{start}="FAIL"'], fill=FILL_FAIL))
ck.cell(row=end + 4, column=2, value="Independent cross-check (written by the verification script)").font = BOLD
for col, w in zip("ABCDE", [5, 62, 22, 22, 10]):
    ck.column_dimensions[col].width = w

wb.save(OUT)
print(f"Saved {OUT}: {N} applications on Output, {len(checks)} checks")
