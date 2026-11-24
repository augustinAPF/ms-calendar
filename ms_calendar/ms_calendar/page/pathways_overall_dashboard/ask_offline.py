"""
Free "offline" mode of the Ask chat (2026-11-24): no AI service, no API key,
no cost. The question is matched against the dashboard's own vocabulary
(card names, Select / Reject steps, Application Status values, unit names,
date phrases, analytics topics) and answered from the same permission-scoped
numbers the dashboard shows. Used whenever no Anthropic key is configured.
"""

import calendar
import re

import frappe
from frappe.utils import add_days, add_months, get_first_day, get_last_day, getdate, nowdate

from ms_calendar.ms_calendar.page.pathways_overall_dashboard import pathways_overall_dashboard as pod

UNIT_ALIASES = {
    "Field": ("field",),
    "Health": ("health",),
    "Grants": ("grants", "grant", "phil", "philanthropy"),
    "Azim Premji Scholarship": ("scholarship", "scholarships", "aps"),
}
# Words that mean the same thing for matching (after stemming).
SYNONYMS = {
    "registration": "applicant", "application": "applicant", "candidate": "applicant", "people": "applicant",
    "regret": "reject", "fail": "reject", "rejection": "reject", "leadership": "leader", "noshow": "noshow",
    "shortlist": "shortlist", "select": "select", "selection": "select", "offered": "offer", "hired": "join",
}
STOP = {"how", "many", "much", "what", "is", "are", "the", "a", "an", "of", "in", "for", "to", "and", "there",
        "show", "me", "give", "tell", "number", "count", "no", "do", "we", "have", "with", "on", "at", "by",
        "each", "per", "all", "unit", "wise", "this", "last", "year", "month", "day", "week", "today", "compare",
        "between", "list", "please", "pls", "plz", "total"}
MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_name) if m}
MONTHS.update({m.lower(): i for i, m in enumerate(calendar.month_abbr) if m})
MONTHS.pop("may", None)
MONTHS["may"] = 5


# ── entry point ───────────────────────────────────────────────────────────

def answer(question, page_filters):
    """→ (markdown, steps). page_filters is the cleaned dashboard filter dict."""
    from ms_calendar.ms_calendar.page.pathways_overall_dashboard import ai_chat

    q = _norm(question)
    f = dict(page_filters)
    units = _units(q)
    if units:
        f["units"] = units
    dates, date_label = _dates(q)
    if dates is not None:
        f.update(dates)
    kw = ai_chat._kw(f)
    scope = _scope_label(f, date_label)
    steps = [{"tool": "offline", "input": {"units": f.get("units") or "all",
                                          "from_date": f.get("from_date"), "to_date": f.get("to_date")}}]

    if re.search(r"\b(help|what can you|what do you)\b", q):
        return _help(), steps

    topic = _analytics_topic(q)
    if topic:
        return _analytics_answer(kw, topic, q, scope), steps

    d = pod.get_dashboard_data(**kw)
    if re.search(r"\b(which|what|where)\b.*\b(step|stage|round)\b", q) and re.search(r"\b(reject|lose|drop|regret)", q):
        return _top_steps(d, "reject", scope), steps
    if re.search(r"\b(breakdown|break down|split|steps|step wise|stepwise)\b", q):
        view = "reject" if re.search(r"reject|regret", q) else "select"
        return _steps_table(d, view, scope), steps

    matches = _match(q, _candidates(d))
    if not matches:
        return _not_understood(question), steps
    return "\n\n---\n\n".join(_metric_answer(m, scope, f.get("units")) for m in matches[:4]), steps


# ── understanding the question ────────────────────────────────────────────

def _norm(text):
    t = (text or "").lower().replace("no-show", "noshow").replace("no show", "noshow")
    return re.sub(r"[^a-z0-9 ]+", " ", t).strip()


def _stem(w):
    for suf in ("ings", "ing", "ed", "es", "s"):
        if len(w) > 4 and w.endswith(suf):
            w = w[: -len(suf)]
            break
    return SYNONYMS.get(w, w)


def _tokens(text):
    return [_stem(w) for w in _norm(text).split() if w]


def _units(q):
    words = set(q.split())
    found = [u for u, al in UNIT_ALIASES.items() if words & set(al)]
    if "azim premji scholarship" in q and "Azim Premji Scholarship" not in found:
        found.append("Azim Premji Scholarship")
    return found


def _dates(q):
    """(filters, label) for a date phrase in the question, or (None, None) to keep the page's dates."""
    today = getdate(nowdate())
    interview_words = re.search(r"\binterview", q)
    if re.search(r"\b(all time|overall|ever|till date|so far)\b", q):
        return {"from_date": None, "to_date": None}, "all time"
    m = re.search(r"\blast (\d{1,3}) days?\b", q)
    if m:
        n = int(m.group(1))
        return {"from_date": str(add_days(today, -n + 1)), "to_date": str(today)}, f"last {n} days"
    if re.search(r"\b(this week|last 7 days)\b", q) and not interview_words:
        return {"from_date": str(add_days(today, -6)), "to_date": str(today)}, "last 7 days"
    if re.search(r"\btoday\b", q) and not interview_words:
        return {"from_date": str(today), "to_date": str(today)}, "today"
    if re.search(r"\bthis month\b", q):
        return {"from_date": str(get_first_day(today)), "to_date": str(today)}, "this month"
    if re.search(r"\blast month\b", q):
        p = add_months(today, -1)
        return {"from_date": str(get_first_day(p)), "to_date": str(get_last_day(p))}, "last month"
    if re.search(r"\bthis year\b", q):
        return {"from_date": f"{today.year}-01-01", "to_date": str(today)}, "this year"
    if re.search(r"\blast year\b", q):
        y = today.year - 1
        return {"from_date": f"{y}-01-01", "to_date": f"{y}-12-31"}, f"{y}"
    year = re.search(r"\b(20\d\d)\b", q)
    for word in q.split():
        if word in MONTHS and not (word == "may" and not year):   # "may" alone is usually the verb
            mo = MONTHS[word]
            y = int(year.group(1)) if year else (today.year if mo <= today.month else today.year - 1)
            first = getdate(f"{y}-{mo:02d}-01")
            return {"from_date": str(first), "to_date": str(get_last_day(first))}, f"{calendar.month_name[mo]} {y}"
    if year:
        y = int(year.group(1))
        return {"from_date": f"{y}-01-01", "to_date": f"{y}-12-31"}, str(y)
    return None, None


def _scope_label(f, date_label=None):
    if date_label:
        when = date_label
    elif f.get("from_date") or f.get("to_date"):
        when = f"{_fmt_date(f.get('from_date')) or 'start'} – {_fmt_date(f.get('to_date')) or 'today'}"
    else:
        when = "all time"
    units = ", ".join(f.get("units") or []) or "all units"
    extra = [k.replace("_", " ") for k in ("subunits", "locations", "job_codes", "job_openings", "roles") if f.get(k)]
    return f"{when} · {units}" + (f" · filtered by {', '.join(extra)}" if extra else "")


def _fmt_date(v):
    return frappe.utils.formatdate(v) if v else ""


# ── what can be counted (built from the dashboard data) ──────────────────

def _candidates(d):
    unit_of = {u["program"]: u["unit"] for u in d.get("units_in_scope") or []}
    stages, per_unit_stage = {}, {}
    for fn in d.get("funnel") or []:
        u = unit_of.get(fn["program"], fn["program"])
        for k, v in (fn.get("stages") or {}).items():
            stages[k] = stages.get(k, 0) + v
            per_unit_stage.setdefault(u, {})[k] = per_unit_stage.get(u, {}).get(k, 0) + v
    regs = {unit_of.get(fn["program"], fn["program"]): fn["registrations"] for fn in d.get("funnel") or []}
    sel = ("In process", "On hold", "Offer / Selected")

    def stage_units(*st):
        return {u: sum(s.get(x, 0) for x in st) for u, s in per_unit_stage.items()}

    def card_units(rows):
        return {r["unit"]: r["value"] for r in rows or [] if r.get("value") is not None}

    fc = {c["key"]: c for c in d.get("funnel_cards") or []}
    out = [
        dict(label="Total Applicants", aliases=["total applicant", "applicant", "how many applicant"],
             value=sum(regs.values()), by_unit=regs,
             note="Every registration whose application date is in the range."),
        dict(label="Total Select", aliases=["total select", "selected applicant", "select"],
             value=sum(stages.get(x, 0) for x in sel), by_unit=stage_units(*sel),
             note="Moved past CV screening and not rejected (in a round, on hold, offer or joined)."),
        dict(label="Total Reject", aliases=["total reject", "rejected applicant", "reject"],
             value=stages.get("Not selected", 0), by_unit=stage_units("Not selected"),
             note="Any Reject / Regret / No Show / Not selected / Offer declined / Not joined status."),
        dict(label="New Applicant", aliases=["new applicant", "new", "not screened", "awaiting cv"],
             value=stages.get("New", 0), by_unit=stage_units("New"), note="Nobody has screened the CV yet."),
    ]
    if "offer_process" in fc:
        c = fc["offer_process"]
        out.append(dict(label="Total Offer process", aliases=["offer process", "in offer process"],
                        value=c["value"], by_unit=card_units(c.get("by_unit")), note=c.get("desc")))
    if "reach_joined" in fc:
        c = fc["reach_joined"]
        out.append(dict(label="Total Joined", aliases=["total join", "join", "joined"],
                        value=c["value"], by_unit=card_units(c.get("by_unit")), note=c.get("desc")))
    for view in ("select", "reject"):
        for g in (d.get("step_groups") or {}).get(view) or []:
            out.append(dict(label=g["label"], aliases=[g["label"]], value=g["value"],
                            by_unit=card_units(g.get("by_unit")), note=g.get("desc"),
                            statuses=[(s["unit"], s["statuses"]) for s in g.get("sources") or []]))
    for grp in d.get("board") or []:
        for it in grp["items"]:
            for c in it["cards"]:
                out.append(dict(label=c["label"], aliases=[c["label"]], value=c["value"],
                                by_unit=card_units(c.get("by_unit")), note=(c.get("desc") or "").split("\n")[0],
                                interviews=c.get("kind") != "card"))
    st = {}
    for r in d.get("status_rows") or []:
        e = st.setdefault(r["status"], {})
        u = unit_of.get(r["program"], r["program"])
        e[u] = e.get(u, 0) + r["count"]
    for status, by in st.items():
        out.append(dict(label=f"Status “{status}”", aliases=[status], value=sum(by.values()), by_unit=by,
                        note="Applicants whose Application Status is exactly this value.", status=True))
    for c in out:
        c["keys"] = [[t for t in _tokens(a) if t not in STOP] or _tokens(a) for a in c["aliases"]]
    return out


def _match(q, cands):
    """Candidates whose every meaningful word appears in the question; most specific first."""
    qt = set(_tokens(q))
    hits = []
    for c in cands:
        best = None
        for k in c["keys"]:
            if k and all(t in qt for t in k) and (best is None or len(k) > len(best)):
                best = k
        if best:
            hits.append((len(best), set(best), c))
    if not hits:
        return []
    hits.sort(key=lambda x: (-x[0], x[2].get("status", False)))
    top = hits[0][0]
    chosen, chosen_keys = [], []
    for n, ks, c in hits:
        if n < min(top, 2):
            continue                              # a vaguer match than the best one
        if any(ks <= o for o in chosen_keys):
            continue                              # same name (card / step / status) or a longer one covers it
        chosen.append(c)
        chosen_keys.append(ks)
    return chosen


# ── answers ───────────────────────────────────────────────────────────────

def _n(v):
    return "—" if v is None else f"{int(v):,}"


def _unit_table(by_unit, total=None):
    rows = [(u, v) for u, v in by_unit.items() if v is not None]
    if not rows:
        return ""
    total = sum(v for _, v in rows) if total is None else total
    lines = ["| Unit | Count | Share |", "|---|---:|---:|"]
    for u, v in sorted(rows, key=lambda x: -x[1]):
        share = f"{v * 100 / total:.1f}%" if total else "—"
        lines.append(f"| {u} | {_n(v)} | {share} |")
    return "\n".join(lines)


def _metric_answer(c, scope, units=None):
    what = "interviews" if c.get("interviews") else "applicants"
    by_unit = {u: v for u, v in c["by_unit"].items() if not units or u in units}
    shown = {u: v for u, v in by_unit.items() if v}
    head = f"**{c['label']}: {_n(c['value'])}** {what}"
    if len(shown) == 1 and not units:
        head += f" (all from {next(iter(shown))})"
    out = [f"{head}  \n_{scope}_"]
    if len(shown) > 1:
        out.append(_unit_table(by_unit, c["value"]))
    if c.get("note"):
        out.append(str(c["note"]).replace("\n", "  \n"))
    if c.get("statuses"):
        parts = []
        for unit, sts in c["statuses"]:
            used = [f"{s} ({_n(n)})" for s, n in sts if n]
            if used:
                parts.append(f"{unit}: " + ", ".join(used))
        if parts:
            out.append("Counted from Application Status — " + "; ".join(parts) + ".")
    return "\n\n".join(out)


def _steps_table(d, view, scope):
    groups = (d.get("step_groups") or {}).get(view) or []
    total = sum(g["value"] for g in groups)
    units = [u["unit"] for u in d.get("units_in_scope") or []]
    head = "| Step | " + " | ".join(units) + " | Total |"
    lines = [f"**Total {'Select' if view == 'select' else 'Reject'}: {_n(total)}** by step  \n_{scope}_", "",
             head, "|---|" + "---:|" * (len(units) + 1)]
    for g in groups:
        bu = {u["unit"]: u["value"] for u in g.get("by_unit") or []}
        lines.append(f"| {g['label']} | " + " | ".join(_n(bu.get(u, 0)) for u in units) + f" | **{_n(g['value'])}** |")
    return "\n".join(lines)


def _top_steps(d, view, scope):
    groups = sorted((d.get("step_groups") or {}).get(view) or [], key=lambda g: -g["value"])
    total = sum(g["value"] for g in groups) or 1
    lines = [f"**Where applicants were rejected** (Total Reject {_n(total)})  \n_{scope}_", "",
             "| Step | Rejected | Share |", "|---|---:|---:|"]
    for g in groups[:6]:
        lines.append(f"| {g['label']} | {_n(g['value'])} | {g['value'] * 100 / total:.1f}% |")
    if groups:
        lines.append(f"\n**{groups[0]['label']}** rejects the most applicants.")
    return "\n".join(lines)


ANALYTICS_TOPICS = [
    ("sources", r"\b(source|sources|come from|came from|hear about|heard about|channel)\b"),
    ("gender", r"\b(gender|male|female|women|men)\b"),
    ("education", r"\b(education|qualification|degree)\b"),
    ("age_band", r"\b(age|ages|age group|age band)\b"),
    ("home_state", r"\b(state|states|home state)\b"),
    ("decline_reasons", r"\bdecline\w* reason|\bwhy\b.*\bdecline"),
    ("reject_reasons", r"\breject\w* reason|\bwhy\b.*\breject"),
    ("feedback_turnaround", r"\bfeedback\b.*\b(time|days|turnaround|late|delay)\b"),
    ("stage_time", r"\b(how long|how many days|days in|time taken|time per|turnaround|average days|median)\b"
                   r"|\bdays?\b.*\b(step|steps|stage|stages)\b"),
    ("job_openings", r"\b(job opening|job openings|job code|job codes|jd|jds|position|positions|vacanc)"),
]


def _analytics_topic(q):
    for key, rx in ANALYTICS_TOPICS:
        if re.search(rx, q):
            return key
    if re.search(r"\b(top|most|highest)\b.*\b(role|roles|job|jobs)\b", q):
        return "job_openings"
    return None


def _funnel_rows(rows, limit=10):
    lines = ["| | Applicants | CV shortlisted | Offer made | Joined |", "|---|---:|---:|---:|---:|"]
    for r in sorted(rows or [], key=lambda r: -(r.get("reg") or 0))[:limit]:
        lines.append(f"| {r.get('label') or r.get('value') or 'Not given'} | {_n(r.get('reg'))} | "
                     f"{_n(r.get('reach_cv'))} | {_n(r.get('reach_offer'))} | {_n(r.get('reach_joined'))} |")
    return "\n".join(lines)


def _analytics_answer(kw, topic, q, scope):
    from ms_calendar.ms_calendar.page.pathways_overall_dashboard import ai_chat

    num = re.search(r"\b(?:top|first)\s+(\d{1,2})\b", q)
    limit = int(num.group(1)) if num else 10
    code = re.search(r"\b(\d{4,6})\b", q)
    res = ai_chat._analytics_section(kw, topic, code.group(1) if topic == "job_openings" and code else None)
    data = res.get("data")
    title = {"sources": "Where applicants come from", "gender": "Applicants by gender", "education": "By education",
             "age_band": "By age group", "home_state": "By home state", "decline_reasons": "Offer decline reasons",
             "reject_reasons": "Recorded rejection reasons", "feedback_turnaround": "Feedback turnaround",
             "stage_time": "Days spent at each step", "job_openings": "Job openings by applicants"}[topic]
    head = f"**{title}**  \n_{scope}_\n\n"
    if topic in ("sources", "education", "age_band", "home_state"):
        return head + _funnel_rows(data, limit)
    if topic == "gender":
        return head + _funnel_rows((data or {}).get("overall"), limit)
    if topic in ("decline_reasons", "reject_reasons"):
        rows = sorted(data or [], key=lambda r: -(r.get("n") or 0))[:limit]
        if not rows:
            return head + "No reasons are recorded for this period."
        return head + "| Reason | Applicants |\n|---|---:|\n" + "\n".join(
            f"| {r.get('value') or 'Not given'} | {_n(r.get('n'))} |" for r in rows)
    if topic == "feedback_turnaround":
        return head + "| Unit | Median days | Average days | Feedback given | Pending |\n|---|---:|---:|---:|---:|\n" + "\n".join(
            f"| {r.get('unit')} | {r.get('median') if r.get('median') is not None else '—'} | "
            f"{r.get('avg') if r.get('avg') is not None else '—'} | {_n(r.get('n'))} | {_n(r.get('pending'))} |"
            for r in data or [])
    if topic == "stage_time":
        rows = (data or {}).get("steps") or []
        return head + "| Step | Median days | Average days | Applicants |\n|---|---:|---:|---:|\n" + "\n".join(
            f"| {r.get('label')} | {r.get('median') if r.get('median') is not None else '—'} | "
            f"{r.get('avg') if r.get('avg') is not None else '—'} | {_n(r.get('n'))} |" for r in rows)
    if topic == "job_openings":
        rows = (data or {}).get("rows") or []
        if not rows:
            return head + "No job openings match."
        lim = int(num.group(1)) if num else 5
        return head + "| Job code | Role | Unit | Applicants | CV shortlisted | Offer made | Joined |\n" \
                      "|---|---|---|---:|---:|---:|---:|\n" + "\n".join(
            f"| {r.get('job_code') or '—'} | {r.get('role') or '—'} | {r.get('unit')} | {_n(r.get('reg'))} | "
            f"{_n(r.get('reach_cv'))} | {_n(r.get('reach_offer'))} | {_n(r.get('reach_joined'))} |" for r in rows[:lim])
    return head + "No data."


def _help():
    return ("I answer from the dashboard numbers (free offline mode — no AI). Ask about:\n\n"
            "- **Any card or step:** Total Select, Test Select, CV Reject, No Show, Recruiter Round Select, "
            "Feedback Pending, Offer Sent, Joined, Interviews Today…\n"
            "- **Any Application Status**, e.g. \"Leader Round-2 Select\"\n"
            "- **Units:** Field, Health, Grants (Philanthropy), Scholarship — e.g. \"Test Reject in Health\"\n"
            "- **Dates:** this month, last month, last 30 days, this year, October, 2025, all time\n"
            "- **Breakdowns:** \"select breakdown\", \"which step rejects the most\"\n"
            "- **Analytics:** sources, gender, education, age, home state, reject reasons, "
            "top 5 job openings, days at each step, feedback turnaround")


def _not_understood(question):
    return (f"I couldn't match “{frappe.utils.escape_html(question[:120])}” to a dashboard number. "
            "Try naming a card or status, e.g. **\"Test Select in Field this month\"**, "
            "**\"CV Reject by unit\"**, **\"top 5 job openings\"** or **\"help\"**.")
