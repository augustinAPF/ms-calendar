"""
Analytics tab — second batch from the management review (2026-11-24):

- Interviewer comment themes: free, anonymised keyword analysis of the
  comments on feedback forms (no AI service). Only theme counts and common
  words are returned — never the comment text, applicant or interviewer.
- Home district type: metro / big-city / other districts (urban vs rural
  proxy), from the applicant's home district where the form records it.
- Diversity by unit: women's share, home states represented, share from
  smaller districts — to compare which unit reaches more widely.
"""

import hashlib
import re

import frappe
from frappe.utils import cint, strip_html

from ms_calendar.ms_calendar.page.pathways_overall_dashboard import pathways_overall_dashboard as pod

CACHE_SECONDS = 600
MAX_COMMENTS = 20000

# Comment fields on the feedback forms (whichever exist on each form).
COMMENT_FIELDS = ("comments", "overall_comments", "qualitative_comments", "qualitative_remarks", "strengths",
                  "overall", "phil_feedback", "write_your_feedback_here", "feedback", "remarks", "observations",
                  "areas_of_improvement", "areas_for_improvement", "weaknesses", "justification", "summary")
TEXT_TYPES = ("Small Text", "Text", "Long Text", "Text Editor", "Data")

# Theme → keyword stems (matched at the start of a word).
THEMES = [
    ("communication", "Communication & language",
     ("communicat", "articulat", "express", "fluen", "english", "language", "clarity", "clear", "convinc")),
    ("subject", "Subject knowledge",
     ("subject", "content", "concept", "knowledge", "understand", "math", "science", "domain", "technical")),
    ("teaching", "Teaching & classroom",
     ("teach", "pedagog", "classroom", "lesson", "demo", "children", "child", "student", "learner")),
    ("experience", "Experience & background",
     ("experien", "worked", "background", "exposure", "years", "prior", "previous")),
    ("field", "Field / rural / community understanding",
     ("rural", "village", "communit", "field", "ground", "grassroot", "government school", "tribal", "district")),
    ("attitude", "Attitude & motivation",
     ("attitude", "motivat", "passion", "commit", "interest", "willing", "eager", "sincer", "enthusias", "dedicat")),
    ("thinking", "Thinking & reflection",
     ("analy", "reason", "critical", "think", "reflect", "logic", "insight", "perspective", "articulate idea")),
    ("values", "Values, empathy & teamwork",
     ("value", "empath", "sensitiv", "respect", "collaborat", "team", "humble", "honest", "integrity")),
    ("leadership", "Leadership & planning",
     ("lead", "manag", "plan", "organi", "coordinat", "initiative", "ownership")),
    ("concern", "Concerns raised",
     ("lack", "weak", "poor", "limited", "struggl", "unable", "difficult", "gap", "not clear", "not able",
      "not suitable", "not fit", "average", "below")),
]
_THEME_RX = [(k, label, re.compile(r"\b(?:" + "|".join(re.escape(s) for s in stems) + r")", re.I))
             for k, label, stems in THEMES]

STOPWORDS = set("""
a about above after again against all also am an and any are as at be because been before being below between
both but by can could did do does doing down during each few for from further good had has have having he her
here hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or
other our out over own same she should so some such than that the their them then there these they this those
through to too under until up very was we well were what when where which while who whom why will with would
you your candidate candidates applicant applicants interview interviewed round also very much really able shown
shows showed seems seemed overall need needs given gave give having however though although still yet even
""".split())

# District names that are metros (Tier 1) or large cities (Tier 2) — a rough urban marker.
TIER1 = {"mumbai", "mumbai suburban", "delhi", "new delhi", "central delhi", "south delhi", "north delhi",
         "east delhi", "west delhi", "bengaluru urban", "bangalore urban", "bangalore", "bengaluru", "chennai",
         "kolkata", "hyderabad", "pune", "ahmadabad", "ahmedabad"}
TIER2 = {"agra", "ajmer", "aligarh", "allahabad", "prayagraj", "amravati", "amritsar", "aurangabad", "bareilly",
         "belagavi", "belgaum", "bhavnagar", "bhopal", "bhubaneswar", "khordha", "bikaner", "bilaspur", "chandigarh",
         "coimbatore", "cuttack", "dehradun", "dhanbad", "durg", "erode", "faridabad", "firozabad", "ghaziabad",
         "gorakhpur", "gautam buddha nagar", "gurugram", "gurgaon", "guntur", "gwalior", "howrah", "hubballi",
         "dharwad", "indore", "jabalpur", "jaipur", "jalandhar", "jammu", "jamnagar", "jamshedpur",
         "purbi singhbhum", "jhansi", "jodhpur", "kannur", "kanpur nagar", "kochi", "ernakulam", "kolhapur",
         "kollam", "kota", "kozhikode", "lucknow", "ludhiana", "madurai", "malappuram", "mangaluru",
         "dakshina kannada", "meerut", "moradabad", "mysuru", "mysore", "nagpur", "nanded", "nashik", "nellore",
         "noida", "patna", "puducherry", "raipur", "rajkot", "ranchi", "rourkela", "sundargarh", "salem",
         "sangli", "shimla", "siliguri", "darjeeling", "solapur", "srinagar", "surat", "thiruvananthapuram",
         "thrissur", "tiruchirappalli", "tirunelveli", "tiruppur", "ujjain", "vadodara", "varanasi", "vasai",
         "palghar", "vijayawada", "krishna", "visakhapatnam", "warangal", "thane", "navi mumbai", "goa",
         "north goa", "south goa", "guwahati", "kamrup metropolitan", "udaipur"}
TIER_LABELS = [("tier1", "Metro (Tier 1)"), ("tier2", "Large city (Tier 2)"),
               ("other", "Other districts (smaller towns / rural)"), ("", "Not given")]

# Home-district field per unit (where captured).
DISTRICT_FIELDS = {"Field": "native_district", "Health": "city__district"}
WOMEN = {"female", "woman", "women", "f"}


@frappe.whitelist()
def get_analytics_extra(refresh=0, **kw):
    filters = pod._filters_from(kw)
    filters.pop("dim", None)
    filters.pop("dim_value", None)
    f = pod._parse_filters(**filters)
    key = "pathways_overall:analytics_extra:v1:" + hashlib.sha1(
        frappe.as_json([frappe.session.user, f]).encode()).hexdigest()
    if not cint(refresh):
        hit = frappe.cache.get_value(key)
        if hit:
            return hit
    progs = pod._progs(f)
    out = {"comments": _comment_themes(progs), "districts": _districts(progs), "diversity": _diversity(progs),
           "generated_at": frappe.utils.now()}
    frappe.cache.set_value(key, out, expires_in_sec=CACHE_SECONDS)
    return out


# ── interviewer comments (anonymised keyword themes) ─────────────────────

def _comment_themes(progs):
    outcomes = ("Select", "Reject", "On hold", "Other")
    total = {o: 0 for o in outcomes}
    themes = {k: {o: 0 for o in outcomes} for k, _, _ in THEMES}
    words = {}                  # word → {"lower": n, "upper": n, outcome: n…}
    per_unit = {}
    forms_seen = 0
    for pg in progs:
        w, p = pg.where()
        for dt in pg.cfg.get("feedback") or []:
            if forms_seen >= MAX_COMMENTS or not pod._can_read(dt):
                continue
            meta = frappe.get_meta(dt)
            if not meta.has_field("applicant_id"):
                continue
            cfields = [fn for fn in COMMENT_FIELDS
                       if meta.has_field(fn) and meta.get_field(fn).fieldtype in TEXT_TYPES]
            if not cfields:
                continue
            res = next((fn for fn in pod._RESULT_FIELDS if meta.has_field(fn)), None)
            sql, present = pod._scoped(dt, ["name", "applicant_id", res] + cfields)
            cols = ", ".join(pod._col("x", fn, present) for fn in cfields)
            rows = frappe.db.sql(
                f"SELECT {pod._col('x', res, present)}, {cols} FROM ({sql}) x "
                f"JOIN ({pg.reg_sql}) r ON r.name = x.applicant_id WHERE {w} LIMIT {MAX_COMMENTS - forms_seen}", p)
            for row in rows:
                text = " ".join(strip_html(str(v)) for v in row[1:] if v and len(str(v).strip()) >= 12)
                if not text:
                    continue
                forms_seen += 1
                o = pod._outcome(row[0])
                o = o if o in total else "Other"
                total[o] += 1
                per_unit[pg.cfg["unit_label"]] = per_unit.get(pg.cfg["unit_label"], 0) + 1
                for k, _, rx in _THEME_RX:
                    if rx.search(text):
                        themes[k][o] += 1
                seen = set()
                for m in re.finditer(r"[A-Za-z][A-Za-z'-]{3,}", text):
                    tok = m.group(0)
                    low = tok.lower()
                    if low in STOPWORDS:
                        continue
                    e = words.setdefault(low, {"lower": 0, "upper": 0, **{x: 0 for x in outcomes}})
                    e["upper" if tok[0].isupper() else "lower"] += 1
                    if low not in seen:
                        e[o] += 1
                        seen.add(low)
    n = sum(total.values())
    theme_rows = []
    for k, label, _ in THEMES:
        t = themes[k]
        theme_rows.append({
            "key": k, "label": label, "n": sum(t.values()), "by_outcome": t,
            "pct_select": round(t["Select"] * 100 / total["Select"], 1) if total["Select"] else None,
            "pct_reject": round(t["Reject"] * 100 / total["Reject"], 1) if total["Reject"] else None,
        })
    # Common words, leaving out anything that looks like a name (mostly written with a capital letter).
    word_rows = [{"word": wd, "n": sum(e[o] for o in outcomes), "Select": e["Select"], "Reject": e["Reject"]}
                 for wd, e in words.items() if e["lower"] >= max(2, e["upper"] * 1.5)]
    word_rows.sort(key=lambda x: -x["n"])
    return {"total": n, "by_outcome": total, "per_unit": per_unit, "themes": theme_rows,
            "words": word_rows[:25], "capped": forms_seen >= MAX_COMMENTS}


# ── home district type (urban / rural proxy) ─────────────────────────────

def _tier(district):
    d = (district or "").strip().lower()
    if not d:
        return ""
    if d in TIER1:
        return "tier1"
    if d in TIER2:
        return "tier2"
    return "other"


def _reach_sets(pg):
    return {k: {pod._status_key(v) for v in pod.STATUS[k].get(pg.key, [])}
            for k in ("reach_cv", "reach_offer", "reach_joined")}


def _districts(progs):
    rows = {t: {"reg": 0, "reach_cv": 0, "reach_offer": 0, "reach_joined": 0, "units": {}} for t, _ in TIER_LABELS}
    captured_units, total = [], 0
    for pg in progs:
        field = DISTRICT_FIELDS.get(pg.key)
        if not field or not frappe.get_meta(pg.cfg["reg"]).has_field(field):
            continue
        sql, present = pod._scoped(pg.cfg["reg"], ["name", field])
        col = pod._col("d", field, present)
        if col == "NULL":
            continue
        captured_units.append(pg.cfg["unit_label"])
        w, p = pg.where()
        reach = _reach_sets(pg)
        for dist, st, n in frappe.db.sql(
                f"SELECT {col}, IFNULL({pg.st}, ''), COUNT(*) FROM ({pg.reg_sql}) r "
                f"JOIN ({sql}) d ON d.name = r.name WHERE {w} GROUP BY 1, 2", p):
            t = _tier(dist)
            r = rows[t]
            n = cint(n)
            total += n
            r["reg"] += n
            r["units"][pg.cfg["unit_label"]] = r["units"].get(pg.cfg["unit_label"], 0) + n
            sk = pod._status_key(st)
            for k in ("reach_cv", "reach_offer", "reach_joined"):
                if sk in reach[k]:
                    r[k] += n
    return {"captured_units": captured_units, "total": total,
            "rows": [dict(rows[t], key=t, label=label) for t, label in TIER_LABELS]}


# ── diversity by unit ─────────────────────────────────────────────────────

def _diversity(progs):
    out = []
    for pg in progs:
        cfg = pg.cfg
        w, p = pg.where()
        reach = _reach_sets(pg)
        row = {"program": pg.key, "unit": cfg["unit_label"], "reg": 0, "gender_known": 0, "women": 0,
               "offers": 0, "offers_gender_known": 0, "offers_women": 0, "states": None, "smaller_districts": None,
               "district_known": 0}
        gcol = pod._col("r", cfg.get("gender"), pg.reg_fields)
        for g, st, n in frappe.db.sql(
                f"SELECT {gcol}, IFNULL({pg.st}, ''), COUNT(*) FROM ({pg.reg_sql}) r WHERE {w} GROUP BY 1, 2", p):
            n = cint(n)
            row["reg"] += n
            offered = pod._status_key(st) in reach["reach_offer"]
            known = gcol != "NULL" and (g or "").strip() != ""
            woman = known and (g or "").strip().lower() in WOMEN
            row["offers"] += n if offered else 0
            if known:
                row["gender_known"] += n
                row["women"] += n if woman else 0
                if offered:
                    row["offers_gender_known"] += n
                    row["offers_women"] += n if woman else 0
        hs = cfg.get("home_state")
        hcol = pod._col("r", hs, pg.reg_fields)
        if hcol != "NULL":
            row["states"] = cint(frappe.db.sql(
                f"SELECT COUNT(DISTINCT {hcol}) FROM ({pg.reg_sql}) r WHERE {w} AND IFNULL({hcol}, '') != ''", p)[0][0])
        field = DISTRICT_FIELDS.get(pg.key)
        if field and frappe.get_meta(cfg["reg"]).has_field(field):
            sql, present = pod._scoped(cfg["reg"], ["name", field])
            col = pod._col("d", field, present)
            if col != "NULL":
                known = small = 0
                for dist, n in frappe.db.sql(
                        f"SELECT {col}, COUNT(*) FROM ({pg.reg_sql}) r JOIN ({sql}) d ON d.name = r.name "
                        f"WHERE {w} AND IFNULL({col}, '') != '' GROUP BY 1", p):
                    known += cint(n)
                    small += cint(n) if _tier(dist) == "other" else 0
                row["district_known"] = known
                row["smaller_districts"] = small
        out.append(row)
    return out
