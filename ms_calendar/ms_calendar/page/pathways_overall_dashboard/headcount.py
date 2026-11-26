"""
"Headcount" tab of the Pathways Overall Dashboard (2026-11-26).

Plans are DEPARTMENT-wise (Headcount Plan: one per financial year + unit,
one row per department). For the chosen financial year (April–March), units
and departments:
    HC Plan       from the Headcount Plan rows
    Offers YTD    applicants who reached the offer stage   (STATUS["reach_offer"])
    Declines YTD  offer declined / did not join            (STATUS_DECLINED)
    Joining YTD   joined                                   (STATUS["reach_joined"])
    Open          HC Plan − Joining (never below 0 per department)
Actuals count applicants whose application date falls in that financial year,
by the Application Status they have now — through the same permission-scoped
registration query as every other card (_Prog).

Which department an applicant counts under (Matcher; hc_condition writes the
same rule in SQL, so every number and its drilldown list agree):
  1. the department on the registration, when it is one of the plan's departments;
     a department that is not in the plan → "Not in the plan";
  2. no department on the registration (or the form has none, e.g. Philanthropy):
     the plan's only department when it has one, else the department whose
     plan row lists the applicant's role, else the one it is used under on
     the unit's Job Openings;
  3. otherwise → "Not in the plan".
Units with no registration form on this dashboard (Azim Premji University,
Enablers) show the plan only.

"Applicants by department" (same matching): Total Applicants of the year per
department, split into the dashboard's six top-row cards by _tally (New, Select,
Reject, In Process, Offer Process, Joined) — the six always add up to Total.
"""

import hashlib
from collections import Counter

import frappe
from frappe.utils import cint

from ms_calendar.ms_calendar.doctype.headcount_plan.headcount_plan import (
    HC_UNITS,
    _key,
    _unit_roles,
    current_fy,
    fy_dates,
    split_roles,
)
from ms_calendar.ms_calendar.page.pathways_overall_dashboard.pathways_overall_dashboard import (
    PROGRAMS,
    SEE_ALL_ROLES,
    STATUS,
    STATUS_DECLINED,
    TALLY_GROUPS,
    _can_prog,
    _tally,
    _col,
    _list,
    _parse_filters,
    _Prog,
)

CACHE_SECONDS = 90

# Unit → its programme on this dashboard (Grants → Philanthropy, …).
UNIT_PROG = {cfg["unit_label"]: cfg for cfg in PROGRAMS}
# Units with no programme here: who may see their plan (besides SEE_ALL_ROLES).
UNIT_ROLES = {
    "Enablers": ["Enablers Recruiter", "Finance Fellowship Recruiter"],
    "Azim Premji University": ["University Recruiter"],
}

MEASURES = [
    ("offers", "Offers YTD", STATUS["reach_offer"]),
    ("declines", "Declines YTD", STATUS_DECLINED),
    ("joined", "Joining YTD", STATUS["reach_joined"]),
]
MEASURE_KEYS = [m[0] for m in MEASURES]

# "Applicants by department" table (2026-11-26): every applicant of the year once,
# split like the dashboard's top row (same _tally rule), so the six add up to Total.
TALLY_COLS = [("t_" + k, "Total " + label) for k, label, *_ in TALLY_GROUPS]
TALLY_KEYS = [k for k, _ in TALLY_COLS]
COUNT_KEYS = MEASURE_KEYS + ["applicants"] + TALLY_KEYS


def _available():
    return frappe.db.exists("DocType", "Headcount Plan") and frappe.has_permission("Headcount Plan", "read")


def visible_units():
    """The plan units this user may see: all six for SEE_ALL_ROLES, else the units of their own programmes."""
    if not _available():
        return []
    roles = set(frappe.get_roles())
    if roles & SEE_ALL_ROLES:
        return list(HC_UNITS)
    return [u for u in HC_UNITS
            if (UNIT_PROG.get(u) and _can_prog(UNIT_PROG[u])) or roles & set(UNIT_ROLES.get(u) or [])]


def _years():
    opts = frappe.get_meta("Headcount Plan").get_field("financial_year").options or ""
    return [o for o in opts.split("\n") if o.strip()]


def _plans(fy, units):
    """unit → {name, rows: [{department, headcount, remarks}]} for that year."""
    if not units:
        return {}
    plans = frappe.get_all("Headcount Plan", filters={"financial_year": fy, "unit": ["in", units]},
                           fields=["name", "unit", "total_headcount", "modified"])
    out = {p.unit: {"name": p.name, "total": cint(p.total_headcount), "modified": str(p.modified), "rows": []}
           for p in plans}
    if plans:
        by_name = {p.name: p.unit for p in plans}
        for r in frappe.get_all("Headcount Plan Detail",
                                filters={"parent": ["in", list(by_name)], "parenttype": "Headcount Plan"},
                                fields=["parent", "department", "roles", "headcount", "remarks"], order_by="parent, idx"):
            out[by_name[r.parent]]["rows"].append(r)
    return out


def default_fy(units):
    """The current financial year when it has a plan, else the latest year that has one (else the current year)."""
    cur = current_fy()
    years = frappe.get_all("Headcount Plan", filters={"unit": ["in", units]}, pluck="financial_year",
                           distinct=True) if units else []
    if not years or cur in years:
        return cur
    return max(years)


def headcount_summary():
    """Small summary (no applicant scans) — decides whether the Headcount tab shows at all."""
    units = visible_units()
    if not units:
        return None
    fy = default_fy(units)
    plans = _plans(fy, units)
    return {"fy": fy, "total": sum(p["total"] for p in plans.values()), "units_planned": len(plans),
            "units": len(units)}


def _role_map(unit, plan_depts, rows=()):
    """
    role key → plan department key: the roles listed on the plan's own rows
    first, then the unit's Job Openings (most used department wins).
    """
    out = {}
    for r in rows:
        for role in split_roles(r.roles):
            out.setdefault(_key(role), _key(r.department))
    pairs = Counter()
    for jo in frappe.get_all("Job Opening", filters={"unit": unit, "designation": ["is", "set"],
                                                     "department": ["is", "set"]},
                             fields=["designation", "department"]):
        kd = _key(jo.department)
        if kd in plan_depts:
            pairs[(_key(jo.designation), kd)] += 1
    for (kr, kd), _ in pairs.most_common():
        out.setdefault(kr, kd)
    return out


class Matcher:
    """Which plan department an applicant (department, role) counts under — see the module docstring."""

    def __init__(self, unit, rows, has_dept):
        self.has_dept = has_dept
        self.depts = {}
        for r in rows:
            self.depts.setdefault(_key(r.department), r.department)
        self.single = next(iter(self.depts)) if len(self.depts) == 1 else None
        self.role_map = _role_map(unit, self.depts, rows) if self.depts else {}

    def match(self, dept, role):
        """Plan department key, or None (= not in the plan)."""
        kd = _key(dept)
        if self.has_dept and kd:
            return kd if kd in self.depts else None
        if self.single:
            return self.single
        return self.role_map.get(_key(role))


def _exprs(pg):
    """(department expr, role expr, has_dept) on the registration derived table `r`."""
    d = _col("r", pg.cfg.get("subunit"), pg.reg_fields)
    r = _col("r", pg.cfg.get("role"), pg.reg_fields)
    return (f"IFNULL(TRIM({d}), '')" if d != "NULL" else "''", f"IFNULL(TRIM({r}), '')" if r != "NULL" else "''",
            d != "NULL")


def _prog_for(unit, fy):
    """The unit's programme scoped to this user, with only the financial-year date filter."""
    cfg = UNIT_PROG.get(unit)
    if not cfg or not _can_prog(cfg):
        return None
    start, end = fy_dates(fy)
    return _Prog(cfg, _parse_filters(programs=[cfg["key"]], from_date=str(start), to_date=str(end)))


def _status(d, tracked):
    """One word for a department line: what to do about it."""
    if not tracked:
        return "plan_only"
    if not d["hc"]:
        return "unplanned" if (d["offers"] or d["joined"]) else "zero"
    if d["joined"] > d["hc"]:
        return "over"
    if d["joined"] >= d["hc"]:
        return "filled"
    if not d["offers"]:
        return "not_started"
    return "in_progress"


@frappe.whitelist()
def get_headcount(fy=None, units=None, depts=None, refresh=0):
    if not _available():
        frappe.throw("Headcount Plan is not set up on this site", frappe.PermissionError)
    allowed = visible_units()
    fy = fy if fy in _years() else default_fy(allowed)
    want_units = [u for u in _list(units) if u in allowed] or allowed
    want_depts = {_key(d) for d in _list(depts)}
    key = "pathways_overall:headcount:v5:" + hashlib.sha1(frappe.as_json(
        [frappe.session.user, fy, want_units, sorted(want_depts)]).encode()).hexdigest()
    if not cint(refresh):
        hit = frappe.cache.get_value(key)
        if hit:
            return hit

    all_plans = _plans(fy, allowed)
    start, end = fy_dates(fy)
    out_units = []
    for unit in want_units:
        plan = all_plans.get(unit) or {"name": None, "rows": [], "modified": None}
        rows = plan["rows"]
        live = _unit_roles(unit)         # roles on Job Openings now — new ones show at once
        dmap = {}
        for r in rows:
            kd = _key(r.department)
            if kd not in dmap:
                dmap[kd] = {"dept": r.department, "hc": 0, "remarks": r.remarks or "", "roles": split_roles("\n".join([r.roles or ""] + live.get(kd, []))),
                             **{m: 0 for m in COUNT_KEYS}}
            dmap[kd]["hc"] += cint(r.headcount)
        none = {m: 0 for m in COUNT_KEYS}

        pg = _prog_for(unit, fy)
        if pg:
            de, re_, has_dept = _exprs(pg)
            w, p = pg.where(include_stage=False)
            sums = []
            for i, (m, _, statuses) in enumerate(MEASURES):
                sts = statuses.get(pg.key) or []
                if sts:
                    p[f"hcm{i}"] = tuple(sts)
                    sums.append(f"SUM(IFNULL({pg.st}, '') IN %(hcm{i})s) AS {m}")
                else:
                    sums.append(f"0 AS {m}")
            matcher = Matcher(unit, rows, has_dept)
            # One row per (department, role, status): the measures, plus every applicant
            # once (applicants) split into the top-row cards by its status (t_*).
            for g in frappe.db.sql(
                    f"SELECT {de} AS hcd, {re_} AS hcr, IFNULL({pg.st}, '') AS hcs, COUNT(*) AS n, {', '.join(sums)} "
                    f"FROM ({pg.reg_sql}) r WHERE {w} GROUP BY hcd, hcr, hcs", p, as_dict=True):
                kd = matcher.match(g.hcd, g.hcr)
                target = dmap[kd] if kd else none
                for m in MEASURE_KEYS:
                    target[m] += cint(g[m])
                target["applicants"] += cint(g.n)
                target["t_" + _tally(g.hcs)] += cint(g.n)

        dept_list = [d for k, d in dmap.items() if not want_depts or k in want_depts]
        dept_list.sort(key=lambda d: _key(d["dept"]))
        for d in dept_list:
            d["open"] = max(0, d["hc"] - d["joined"]) if pg else None
            # "Applicants by department": still to hire = plan − Total Joined (the card column), never below 0
            d["pending"] = max(0, d["hc"] - d["t_joined"]) if pg else None
            d["status"] = _status(d, bool(pg))
        if want_depts and not dept_list:
            continue      # department filter: units with none of those departments drop out
        show_none = bool(pg) and not want_depts
        tot = {m: sum(d[m] for d in dept_list) + (none[m] if show_none else 0) for m in COUNT_KEYS}
        out_units.append({
            "unit": unit, "program": pg.key if pg else None, "tracked": bool(pg),
            "plan": plan["name"], "plan_modified": plan["modified"],
            "hc": sum(d["hc"] for d in dept_list), **tot,
            "open": sum(d["open"] for d in dept_list) if pg else None,
            "pending": sum(d["pending"] for d in dept_list) if pg else None,
            "depts": dept_list, "none": none if show_none else None,
        })

    tracked = [u for u in out_units if u["tracked"]]
    all_depts = [d for u in out_units for d in u["depts"]]
    out = {
        "fy": fy, "years": _years(), "from_date": str(start), "to_date": str(end),
        "filters": {"units": [u for u in _list(units) if u in allowed], "depts": sorted(_list(depts))},
        # Filter options (the whole year, not narrowed by the filters): units and plan departments.
        "options": {"units": allowed,
                    "depts": sorted({(r.department, u) for u, pl in all_plans.items() for r in pl["rows"]},
                                    key=lambda x: (_key(x[1]), _key(x[0])))},
        "units": out_units,
        "total": {
            "hc": sum(u["hc"] for u in out_units),
            "hc_tracked": sum(u["hc"] for u in tracked),
            **{m: sum(u[m] for u in tracked) for m in COUNT_KEYS},
            "open": sum(u["open"] or 0 for u in tracked),
            "pending": sum(u["pending"] or 0 for u in tracked),
            "depts": len(all_depts),
            "not_started": sum(1 for d in all_depts if d["status"] == "not_started"),
            "units_planned": sum(1 for u in out_units if u["plan"]),
            "units_no_plan": [u["unit"] for u in out_units if not u["plan"]],
            "plan_only_units": [u["unit"] for u in out_units if not u["tracked"]],
        },
        "can_create": bool(frappe.has_permission("Headcount Plan", "create")),
        "measures": [{"key": k, "label": label} for k, label, _ in MEASURES],
        "tally_cols": [{"key": k, "label": label, "desc": g[3]} for (k, label), g in zip(TALLY_COLS, TALLY_GROUPS)],
        "generated_at": frappe.utils.now(),
    }
    frappe.cache.set_value(key, out, expires_in_sec=CACHE_SECONDS)
    return out


# ── drilldowns ─────────────────────────────────────────────────────────────

def apply_hc(progs, hc):
    """
    Narrow a drilldown to one headcount number. `hc` (JSON from the page) =
    {fy, measure, part, units, depts, dept}:
      part "all"  — the chosen units (and departments, if any): a top card;
      part "dept" — one department of one unit (units = [that unit]);
      part "none" — one unit's "Not in the plan" line.
    The plans are read again here, never taken from the browser. Returns the programmes kept.
    """
    hc = frappe.parse_json(hc) if isinstance(hc, str) else (hc or {})
    fy, part, measure = hc.get("fy"), hc.get("part"), hc.get("measure")
    allowed = visible_units()
    units = [u for u in _list(hc.get("units")) if u in allowed] or allowed
    if fy not in _years() or part not in ("all", "dept", "none") or measure not in COUNT_KEYS:
        frappe.throw("Unknown headcount number")
    if part in ("dept", "none") and len(units) != 1:
        frappe.throw("Unknown headcount number")
    want = {_key(d) for d in _list(hc.get("depts"))}
    if part == "dept":
        want = {_key(hc.get("dept"))}
    statuses = dict((k, s) for k, _, s in MEASURES).get(measure)
    plans = _plans(fy, units)
    start, end = fy_dates(fy)
    by_prog = {UNIT_PROG[u]["key"]: u for u in units if u in UNIT_PROG}
    keep = []
    for pg in progs:
        unit = by_prog.get(pg.key)
        if not unit:
            continue
        rows = (plans.get(unit) or {}).get("rows") or []
        if part == "none":
            cond = hc_condition(pg, unit, rows, None)
        elif want:
            mine = {_key(r.department) for r in rows} & want
            if not mine:
                continue
            cond = hc_condition(pg, unit, rows, mine)
        else:
            cond = ("1=1", {})
        # Only the financial year — the page's own filters don't apply to the headcount numbers.
        pg.f = _parse_filters(programs=[pg.key], from_date=str(start), to_date=str(end))
        pg.stages = []
        pg.hc_cond = cond
        if statuses is not None:          # offers / declines / joined
            pg.rej_statuses = list(statuses.get(pg.key) or [])
        elif measure == "applicants":     # everyone on this line
            pg.rej_statuses = None
        else:                             # one top-row card (t_select, …): the statuses _tally puts there
            pg.rej_statuses = [r.s for r in pg.status_counts() if "t_" + _tally(r.s) == measure]
        keep.append(pg)
    return keep


def hc_condition(pg, unit, rows, dept_keys):
    """
    SQL (+ params) for the applicants the Matcher puts under `dept_keys`
    (a set of plan department keys), or under "Not in the plan" when None.
    """
    de, re_, has_dept = _exprs(pg)
    m = Matcher(unit, rows, has_dept)
    pf, params = pg.pfx + "hc_", {}

    def in_list(expr, name, values, negate=False):
        values = tuple(sorted(values))
        if not values:
            return "1=1" if negate else "1=0"
        params[pf + name] = values
        return f"{expr} {'NOT IN' if negate else 'IN'} %({pf}{name})s"

    if dept_keys is None:      # not in the plan
        blank = "1=0" if m.single else in_list(re_, "ar", set(m.role_map), negate=True)
        if not has_dept:
            return blank, params
        return (f"(({de} <> '' AND {in_list(de, 'ad', set(m.depts), negate=True)}) "
                f"OR ({de} = '' AND {blank}))"), params

    dept_keys = set(dept_keys) & set(m.depts)
    if m.single:
        blank = "1=1" if m.single in dept_keys else "1=0"
    else:
        blank = in_list(re_, "rr", {r for r, d in m.role_map.items() if d in dept_keys})
    if not has_dept:
        return blank, params
    return f"({in_list(de, 'dd', dept_keys)} OR ({de} = '' AND {blank}))", params


# ── Excel download (2026-11-26) ────────────────────────────────────────────
# The "Plan by unit and department" table as an .xlsx in the layout of the
# team's "Summary and Fulfillment Offers" sheet: blue title band, bold italic
# headers, numbered unit rows with bold blue totals (SUM formulas over their
# departments), italic department rows, a Grand Total row and a note.
# Same data, filters and permission scope as get_headcount(). openpyxl only
# (the cloud bench has no xlsxwriter).

STATUS_LABELS = {"not_started": "Not started", "in_progress": "In progress", "filled": "Filled",
                 "over": "Over plan", "unplanned": "Not planned", "zero": "No number", "plan_only": "Plan only"}


@frappe.whitelist()
def download_headcount_xlsx(fy=None, units=None, depts=None, sheet=None):
    from io import BytesIO

    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    h = get_headcount(fy, units, depts)
    fy = h["fy"]
    wb = Workbook()
    ws = wb.active
    ws.title = f"Summary {fy}"[:31]

    thin = Side(style="thin", color="8C8C8C")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    blue = "4472C4"
    f_plain = Font(name="Calibri", size=10)
    f_bold = Font(name="Calibri", size=10, bold=True)
    f_head = Font(name="Calibri", size=10, bold=True, italic=True)
    f_ital = Font(name="Calibri", size=10, italic=True)
    f_blue = Font(name="Calibri", size=10, bold=True, color=blue)
    f_note = Font(name="Calibri", size=9, italic=True, color="595959")
    wrap = Alignment(wrap_text=True, vertical="top")
    right = Alignment(horizontal="right", vertical="top")
    unit_fill = PatternFill("solid", fgColor="F2F6FC")

    cols = ["", "Unit / Department", f"HC Plan {fy}", "Offers YTD", "Declines YTD", "Joining YTD *", "Open",
            "% Filled", "Status", "Roles", "Remarks"]
    last = get_column_letter(len(cols))
    ws.merge_cells(f"A1:{last}1")
    ws["A1"] = f"Summary of {fy}"
    ws["A1"].font = f_bold
    ws["A1"].fill = PatternFill("solid", fgColor="9BC2E6")
    ws["A1"].alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 20
    for c, label in enumerate(cols, 1):
        cell = ws.cell(2, c, label)
        cell.font, cell.alignment, cell.border = f_head, Alignment(wrap_text=True, vertical="bottom"), border
    ws.row_dimensions[2].height = 28

    def put(r, c, value, font=f_plain, align=None, fill=None, fmt=None):
        cell = ws.cell(r, c, value)
        cell.font, cell.border = font, border
        cell.alignment = align or (right if c >= 3 and c <= 8 else wrap)
        if fill:
            cell.fill = fill
        if fmt:
            cell.number_format = fmt
        return cell

    def fill_pct(r, font):
        put(r, 8, f'=IF(C{r}>0,F{r}/C{r},"")', font, right, fmt="0%")

    r = 3
    unit_rows = []
    for n, u in enumerate(h["units"], 1):
        ur = r
        unit_rows.append(ur)
        tracked = u["tracked"]
        lines = [(d["dept"], d, True) for d in u["depts"]]
        if u.get("none") and any(u["none"].get(m) for m in MEASURE_KEYS):
            lines.append(("Not in the plan", u["none"], False))
        first, last_row = ur + 1, ur + len(lines)
        put(ur, 1, n, f_bold, right, unit_fill)
        put(ur, 2, u["unit"] + ("" if u["plan"] else "  (no plan yet)"), f_bold, fill=unit_fill)
        for c, col in ((3, "C"), (4, "D"), (5, "E"), (6, "F"), (7, "G")):
            if c > 3 and not tracked:
                put(ur, c, None, f_blue, fill=unit_fill)
            else:
                put(ur, c, f"=SUM({col}{first}:{col}{last_row})" if lines else 0, f_blue, right, unit_fill)
        if tracked and u["plan"]:
            fill_pct(ur, f_blue)
            ws.cell(ur, 8).fill = unit_fill
        else:
            put(ur, 8, None, f_blue, fill=unit_fill)
        put(ur, 9, "" if (u["plan"] and tracked) else ("No plan" if not u["plan"] else "Plan only"), f_bold, fill=unit_fill)
        put(ur, 10, None, fill=unit_fill)
        put(ur, 11, None, fill=unit_fill)
        r += 1
        for name, d, planned in lines:
            put(r, 1, None)
            put(r, 2, name, f_ital)
            put(r, 3, d.get("hc", 0) if planned else None)
            for c, m in ((4, "offers"), (5, "declines"), (6, "joined")):
                put(r, c, d.get(m, 0) if tracked else None)
            put(r, 7, d.get("open") if (tracked and planned) else None)
            if tracked and planned:
                fill_pct(r, f_plain)
            else:
                put(r, 8, None)
            put(r, 9, STATUS_LABELS.get(d.get("status"), "") if planned else "Not in the plan")
            put(r, 10, ", ".join(d.get("roles") or []) if planned else "")
            put(r, 11, d.get("remarks") or "" if planned else
                "Applicants whose department is not in this unit's plan (or empty and not placed by role)")
            r += 1

    # Grand total (same SUM-of-units style as the team's sheet)
    put(r, 1, None)
    put(r, 2, "Grand Total", f_bold)
    for c, col in ((3, "C"), (4, "D"), (5, "E"), (6, "F"), (7, "G")):
        put(r, c, "=SUM(" + ",".join(f"{col}{x}" for x in unit_rows) + ")" if unit_rows else 0, f_blue, right)
    fill_pct(r, f_blue)
    for c in (9, 10, 11):
        put(r, c, None)
    r += 2

    flt = []
    if h["filters"]["units"]:
        flt.append("Units: " + ", ".join(h["filters"]["units"]))
    if h["filters"]["depts"]:
        flt.append("Departments: " + ", ".join(h["filters"]["depts"]))
    notes = [
        f"* Offers / Declines / Joining YTD = applicants whose application date is between "
        f"{frappe.utils.formatdate(h['from_date'], 'dd-MM-yyyy')} and {frappe.utils.formatdate(h['to_date'], 'dd-MM-yyyy')}, "
        "by their Application Status today. Offers = reached the offer stage; Declines = declined the offer or did not "
        "join; Joining = joined.",
        "HC Plan comes from the Headcount Plan of each unit (one number per department). Open = HC Plan − Joining per "
        "department (never below 0). % Filled = Joining ÷ HC Plan.",
        "Units marked 'Plan only' have no applicant data on the Pathways dashboard yet, so their actuals are blank.",
        ("Filters: " + "; ".join(flt)) if flt else "Filters: all units and departments.",
        f"Downloaded from the Pathways Overall Dashboard (Headcount tab) on "
        f"{frappe.utils.format_datetime(frappe.utils.now_datetime(), 'dd-MM-yyyy HH:mm')} by {frappe.session.user}.",
    ]
    for t in notes:
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=len(cols))
        c = ws.cell(r, 1, t)
        c.font, c.alignment = f_note, Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[r].height = 26
        r += 1

    for c, w in enumerate([5, 38, 11, 11, 11, 11, 9, 9, 13, 60, 40], 1):
        ws.column_dimensions[get_column_letter(c)].width = w
    ws.freeze_panes = "C3"
    ws.sheet_view.zoomScale = 100
    ws.print_title_rows = "1:2"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True

    # ── Sheet 2: Applicants by department ──────────────────────────────────
    # Department | Roles | HC Plan | Total Applicants | the six top-row cards (they add up to Total) | Pending.
    ws2 = wb.create_sheet(f"Applicants {fy}"[:31])
    C0 = 4                                            # first number column (D = HC Plan)
    hcol = get_column_letter(C0)
    cols2 = (["", "Unit / Department", "Roles", f"HC Plan {fy}", "Total Applicants"] + [label for _, label in TALLY_COLS]
             + ["Pending (HC Plan − Joined)"])
    pc = len(cols2)                                   # Pending column (last)
    pcol, jcol = get_column_letter(pc), get_column_letter(pc - 1)
    nc = len(cols2)
    last2 = get_column_letter(nc)
    ws2.merge_cells(f"A1:{last2}1")
    ws2["A1"] = f"Applicants by department — {fy}"
    ws2["A1"].font = f_bold
    ws2["A1"].fill = PatternFill("solid", fgColor="9BC2E6")
    ws2["A1"].alignment = Alignment(horizontal="center", vertical="center")
    ws2.row_dimensions[1].height = 20
    for c, label in enumerate(cols2, 1):
        cell = ws2.cell(2, c, label)
        cell.font, cell.alignment, cell.border = f_head, Alignment(wrap_text=True, vertical="bottom"), border
    ws2.row_dimensions[2].height = 30

    def put2(r, c, value, font=f_plain, fill=None):
        cell = ws2.cell(r, c, value)
        cell.font, cell.border = font, border
        cell.alignment = right if c >= C0 else wrap
        if fill:
            cell.fill = fill
        return cell

    keys2 = ["hc", "applicants"] + TALLY_KEYS        # columns D …
    r = 3
    unit_rows2 = []
    for n, u in enumerate(h["units"], 1):
        ur = r
        unit_rows2.append(ur)
        tracked = u["tracked"]
        lines = [(d["dept"], d, True) for d in u["depts"]]
        if u.get("none") and u["none"].get("applicants"):
            lines.append(("Not in the plan", u["none"], False))
        first, last_row = ur + 1, ur + len(lines)
        put2(ur, 1, n, f_bold, unit_fill).alignment = right
        put2(ur, 2, u["unit"] + ("" if u["plan"] else "  (no plan yet)")
             + ("" if tracked else "  — plan only"), f_bold, unit_fill)
        n_roles = len({x for d in u["depts"] for x in (d.get("roles") or [])})
        put2(ur, 3, (f"{n_roles} role" + ("" if n_roles == 1 else "s")) if n_roles else None, f_note, unit_fill)
        for i, k in enumerate(keys2):
            c = C0 + i
            col = get_column_letter(c)
            if k != "hc" and not tracked:
                put2(ur, c, None, f_blue, unit_fill)
            else:
                put2(ur, c, f"=SUM({col}{first}:{col}{last_row})" if lines else 0, f_blue, unit_fill)
        # Pending: sum of the department lines (each never below 0), not unit plan − unit joined
        put2(ur, pc, (f"=SUM({pcol}{first}:{pcol}{last_row})" if lines else 0) if tracked else None, f_blue, unit_fill)
        r += 1
        for name, d, planned in lines:
            put2(r, 1, None)
            put2(r, 2, name, f_ital)
            put2(r, 3, ", ".join(d.get("roles") or []) if planned else None)
            for i, k in enumerate(keys2):
                if k == "hc":
                    put2(r, C0 + i, d.get("hc", 0) if planned else None)
                else:
                    put2(r, C0 + i, d.get(k, 0) if tracked else None)
            put2(r, pc, f"=MAX({hcol}{r}-{jcol}{r},0)" if (tracked and planned) else None, f_bold)
            r += 1

    put2(r, 1, None)
    put2(r, 2, "Grand Total", f_bold)
    put2(r, 3, None)
    for i in range(len(keys2) + 1):                  # … and the Pending column
        col = get_column_letter(C0 + i)
        put2(r, C0 + i, "=SUM(" + ",".join(f"{col}{x}" for x in unit_rows2) + ")" if unit_rows2 else 0, f_blue)
    r += 2
    notes2 = [
        f"Total Applicants = applicants whose application date is between "
        f"{frappe.utils.formatdate(h['from_date'], 'dd-MM-yyyy')} and {frappe.utils.formatdate(h['to_date'], 'dd-MM-yyyy')}, "
        "counted once, under their department (same rule as the Summary sheet).",
        "The six card columns split Total Applicants by Application Status today, exactly like the top cards of the "
        "Pathways Overall Dashboard — so New + Select + Reject + In Process + Offer Process + Joined = Total Applicants.",
    ] + [f"{label}: {g[3]}" for (_, label), g in zip(TALLY_COLS, TALLY_GROUPS)] + [
        "Pending = HC Plan − Total Joined for each department (never below 0), so a department that joined more "
        "than planned does not hide another one's gap. A unit's Pending is the sum of its departments.",
        "Roles = the roles under each department, from its Headcount Plan row and the unit's Job Openings.",
        "Units marked 'plan only' have no applicant data on the dashboard yet. " + notes[3],
    ]
    for t in notes2:
        ws2.merge_cells(start_row=r, start_column=1, end_row=r, end_column=nc)
        c = ws2.cell(r, 1, t)
        c.font, c.alignment = f_note, Alignment(wrap_text=True, vertical="top")
        ws2.row_dimensions[r].height = 24
        r += 1
    for c, w in enumerate([5, 34, 44, 11, 12] + [13] * len(TALLY_KEYS) + [14], 1):
        ws2.column_dimensions[get_column_letter(c)].width = w
    ws2.freeze_panes = "C3"
    ws2.print_title_rows = "1:2"
    ws2.page_setup.orientation = "landscape"
    ws2.page_setup.fitToWidth = 1
    ws2.page_setup.fitToHeight = 0
    ws2.sheet_properties.pageSetUpPr.fitToPage = True
    if sheet == "applicants":         # opened from the "Applicants by department" table
        wb.active = 1
        ws.sheet_view.tabSelected = False
        ws2.sheet_view.tabSelected = True

    buf = BytesIO()
    wb.save(buf)
    frappe.response["filename"] = f"Headcount Summary {fy}.xlsx"
    frappe.response["filecontent"] = buf.getvalue()
    frappe.response["type"] = "binary"
