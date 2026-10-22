"""
Master Data (desk page /app/master-data).

The Field recruitment "Data or Master Tracker" Excel, filled from the
system: one row per Field Registration Form, with every column of the
recruitment team's template in the same order and groups —

  Master Tracker: Application data → Written test → Interviews → Offer details
  Offer Tracker:  the offer / joining view of the same applicants

Column headings are the template's, spell-corrected (Expereince →
Experience, Screenig → Screening, Recruter → Recruiter, …), and the four
"Date of Feedback received" columns now say which round they belong to.

Each value is the first one filled of (see _row):
  - the registration form's own field (round dates, panel names, statuses);
  - the linked forms — Field Meritrac Test URL (admit cards), Field
    MeritTrac Test Result (scores), Field Interview Schedule, the round
    feedback forms, Common Offer Letter, Field Document Collection,
    Pre Joining documents;
  - the Application Status log / the current Application Status.
Columns nothing in the system captures (Employee ID, previous org type,
University-only rounds) stay blank.

Permissions (server side, never in the browser):
- registrations are read through frappe.get_list(..., run=0) — the exact
  query Frappe runs for this user (roles + User Permissions);
- every linked form is read with frappe.get_list as this user, and only
  for registrations already in scope; a form the user can't read is skipped;
- client filter values are only ever bound as SQL parameters;
- the Excel download goes through the same query as the table.
No row cap: the table pages in SQL, and the download builds the workbook
in batches with xlsxwriter's constant-memory mode.
"""

import hashlib
import re

import frappe
from frappe.utils import cint, flt, getdate

from ms_calendar.ms_calendar.page.pathways_overall_dashboard.pathways_overall_dashboard import (
    _BY_FIELDS,
    _RESULT_FIELDS,
    CARD_DESC,
    STATUS,
    _can_read,
    _col,
    _list,
    _scoped,
    _state_of,
    _status_key,
)

REG = "Field Registration Form"
STATUS_LOG = "Field Application Status Log"
CACHE_SECONDS = 90
OPTIONS_CACHE_SECONDS = 600
BATCH = 1000
PAGE_SIZES = (25, 50, 100, 250, 500)

# ── columns (template order) ───────────────────────────────────────────────

GROUPS = [
    ("app", "Application Data (all information given by the candidate at registration)"),
    ("test", "Written Test Data"),
    ("iv", "Interviews"),
    ("offer", "Offer Details"),
]

MASTER_COLS = [
    ("app", "name", "Application / Registration Number"),
    ("app", "job_code", "Job Code"),
    ("app", "job_title", "Job Title"),
    ("app", "application_status", "Application Status"),
    ("app", "app_date", "Date of Application"),
    ("app", "full_name", "Full Name as per Aadhaar"),
    ("app", "email", "Email Address"),
    ("app", "phone", "Phone Number"),
    ("app", "alt_phone", "Alternate Contact Number"),
    ("app", "dob", "Date of Birth"),
    ("app", "gender", "Gender"),
    ("app", "native_state", "Native State"),
    ("app", "native_district", "Native District"),
    ("app", "highest_education", "Highest Educational Qualification"),
    ("app", "teaching_degrees", "Teaching Degrees"),
    ("app", "exp_years", "Total Teaching Experience (Full-Time only, in Years)"),
    ("app", "exp_months", "Total Teaching Experience (Full-Time only, in Months)"),
    ("app", "apf_associated", "Are you a former employee of, or in any way associated with, Azim Premji Foundation?"),
    ("app", "source", "How did you come to know about this opportunity?"),
    ("app", "written_subject", "Choose your subject for the written test"),
    ("app", "test_location_choice", "Choose your test location"),
    ("app", "ctet", "Did you qualify for CTET?"),
    ("app", "english", "Are you fluent in both spoken and written English?"),
    ("app", "outside_location", "Are you open to working outside your preferred location?"),
    ("app", "family", "Do any of your family members work in the Organisation?"),
    ("app", "cv_date", "CV Screening Date"),
    ("app", "cv_status", "CV Screening Status"),
    ("test", "admit_date", "Date of Admit Card Sent"),
    ("test", "admit_offline", "Count of Admit Cards Sent for Offline Test"),
    ("test", "admit_online", "Count of Admit Cards Sent for Online Test"),
    ("test", "test_mode", "Test Mode"),
    ("test", "test_center", "Test Centre"),
    ("test", "test_date", "Date of Written Test"),
    ("test", "test_subject", "Test Subject"),
    ("test", "total_score", "Total Score"),
    ("test", "secured_score", "Secured Score"),
    ("test", "score_pct", "Test Score (%)"),
    ("test", "test_status", "Test Status"),
    ("iv", "rec_date", "Date of Recruiter Round"),
    ("iv", "rec_name", "Name of Recruiter"),
    ("iv", "rec_status", "Recruiter Round Status"),
    ("iv", "rec_fb", "Date of Recruiter Round Feedback Received"),
    ("iv", "fn_type", "Type of Functional Round"),
    ("iv", "fn_date", "Date of Functional Round"),
    ("iv", "fn_p1", "Name of Functional Round Panel Member-1"),
    ("iv", "fn_p2", "Name of Functional Round Panel Member-2"),
    ("iv", "fn_status", "Functional Round Status"),
    ("iv", "fn_fb", "Date of Functional Round Feedback Received"),
    ("iv", "demo_mode", "Demo Mode"),
    ("iv", "demo_date", "Date of Principal / Demo Round"),
    ("iv", "demo_name", "Name of Principal"),
    ("iv", "demo_status", "Principal / Demo Round Status"),
    ("iv", "demo_fb", "Date of Principal / Demo Round Feedback Received"),
    ("iv", "fin_date", "Date of Final Round"),
    ("iv", "fin_p1", "Name of Final (Leader) Round Panel Member-1"),
    ("iv", "fin_p2", "Name of Final (Leader) Round Panel Member-2"),
    ("iv", "fin_status", "Final Round Status"),
    ("iv", "fin_fb", "Date of Final Round Feedback Received"),
    ("offer", "fitment_date", "Fitment Creation Date"),
    ("offer", "offer_date", "Date of Offer Release"),
    ("offer", "offer_status", "Offer Status"),
    ("offer", "doj", "Joining Date"),
    ("offer", "join_status", "Joining Status"),
    ("offer", "join_state", "Joining Location State"),
    ("offer", "join_district", "Joining Location District"),
    ("offer", "join_block", "Joining Location Block"),
    ("offer", "supervisor", "Supervisor"),
]

OFFER_COLS = [
    ("name", "Candidate Application Number (from Recruitment Portal: Zwayam / eSparch / Frappe)"),
    ("full_name", "Candidate Name (as per Aadhaar)"),
    ("email", "Candidate Email ID"),
    ("phone", "Candidate Contact Number"),
    ("gender", "Gender"),
    ("source", "Source of Information (where the candidate learnt about us)"),
    ("source_specific", "Specific Source of Information"),
    ("referred_by", "Name of the Employee who Referred"),
    ("agency", "Name of the Recruitment Consultant Agency"),
    ("prev_org_type", "Applicant's Previous Organisation Type"),
    ("prev_org", "Name of the Organisation"),
    ("app_date", "Date of Application"),
    ("test_date", "Date of Written Test (applicable for Education Domain only)"),
    ("exploratory_date", "Date of Exploratory Round (applicable for University Domain only)"),
    ("rec_date", "Date of Recruiter Round Interview"),
    ("panel_date", "Date of Panel Round (applicable for University Domain only)"),
    ("fn_date", "Date of Functional Round Interview"),
    ("fin_date", "Date of Final Round Interview"),
    ("fitment_date", "Date of Fitment Sharing"),
    ("hiring_type", "Type of Hiring"),
    ("recruiter", "Recruiter"),
    ("unit", "Unit"),
    ("domain", "Domain"),
    ("role", "Role / Position"),
    ("join_state", "Posting Location (State)"),
    ("join_district", "Posting Location (District)"),
    ("join_block", "Posting Location (Block)"),
    ("remarks", "Any Specific Remarks on the Candidate"),
    ("offer_date", "Date of Offer Release"),
    ("offer_status", "Offer Status"),
    ("doj", "Date of Joining"),
    ("join_status", "Joining Status"),
    ("employee_id", "Employee ID"),
    ("employee_email", "Employee Email ID"),
    ("pj_remarks", "Remarks"),
    ("d_app_test", "Days: Application to Written Test"),
    ("d_test_rec", "Days: Written Test to Recruiter Screening"),
    ("d_rec_fn", "Days: Recruiter Screening to Functional Round"),
    ("d_fn_fin", "Days: Functional Round to Final Round"),
    ("d_fin_fit", "Days: Final Round to Fitment"),
    ("d_fit_offer", "Days: Fitment to Offer"),
    ("d_app_offer", "Days: Application to Offer"),
]

DATE_KEYS = {"app_date", "dob", "cv_date", "admit_date", "test_date", "rec_date", "rec_fb", "fn_date", "fn_fb",
             "demo_date", "demo_fb", "fin_date", "fin_fb", "fitment_date", "offer_date", "doj"}
NUMBER_KEYS = {"admit_offline", "admit_online", "total_score", "secured_score", "score_pct",
               "d_app_test", "d_test_rec", "d_rec_fn", "d_fn_fin", "d_fin_fit", "d_fit_offer", "d_app_offer"}

# Columns that are plain registration fields — these sort in SQL.
DIRECT = {
    "name": "name", "job_code": "job_code", "application_status": "application_status",
    "full_name": "full_name_aadhaar", "email": "email_address", "phone": "phone_number", "alt_phone": "alternate_no",
    "dob": "dob", "gender": "gender", "native_state": "native_state", "native_district": "native_district",
    "highest_education": "highest_education", "teaching_degrees": "teaching_degrees", "exp_years": "teaching_year",
    "exp_months": "teachingexp_month", "source": "opportunity", "written_subject": "written_subject",
    "test_location_choice": "test_location", "ctet": "ctet_qualify", "english": "english_fluent",
    "outside_location": "worklocation", "family": "apf_family", "unit": "units", "domain": "department",
    "role": "role", "prev_org": "current_organisation1", "remarks": "remarks",
}
SORTABLE = set(DIRECT) | {"app_date"}

REG_FIELDS = list(dict.fromkeys([
    "name", "creation", "application_status", "job_title", "location", "date_of_applied", "application_date",
    "former_employee", "apf_associated", "then_other", "if_email_invite", "employee_referral", "ex_emplyee_name",
    "preferred_test_mode", "online_test_attempts", "offline_test_attempts",
    "date_of_recruiter_round", "recruiter_round_name", "recruiter_round_status",
    "date_of_functional_round", "functional_panel1", "functional_panel2", "functional_round_status",
    "date_of_final_round", "final_panel1", "final_panel2", "final_round_status",
    "offer", "date_offer", *DIRECT.values(),
]))

# Filters: client key → registration field.
FILTER_FIELDS = {"units": "units", "subunits": "department", "locations": "location", "job_codes": "job_code",
                 "roles": "role", "statuses": "application_status"}

# Cards (same definitions as the Pathways dashboard's headline funnel).
CARDS = [
    ("all", "Applicants", "Every registration matching the filters."),
    ("reach_cv", "CV Shortlisted", CARD_DESC["reach_cv"]),
    ("reach_leader", "Reached Leader Round", CARD_DESC["reach_leader"]),
    ("reach_offer", "Offers Made", CARD_DESC["reach_offer"]),
    ("reach_joined", "Joined", CARD_DESC["reach_joined"]),
]
CARD_KEYS = {k for k, _, _ in CARDS}

# ── interview rounds ───────────────────────────────────────────────────────
#
# Template groups: rec = Recruiter, fn = Functional (Education Capacity /
# Subject / Functional / Technical), demo = Principal / Demo, fin = Final
# (Leader rounds, calibration). (base round, status prefix for Select/Reject).
_ROUNDS = [
    ("rec", "Recruiter Round", "Recruiter Round"),
    ("fn", "Education Capacity Round", "Education Capacity"),
    ("fn", "Subject Round", "Subject Round"),
    ("fn", "Functional Round", "Functional Round"),
    ("fn", "Technical Round", "Technical Round"),
    ("demo", "Demo Round", "Demo Round"),
    ("fin", "Leader Round-1", "Leader Round-1"),
    ("fin", "Leader Round-2", "Leader Round-2"),
    ("fin", "Leader Round-3", "Leader Round-3"),
    ("fin", "Calibration Process", "Calibration"),
]
ROUND_GROUP = {base.lower(): g for g, base, _ in _ROUNDS}
# Application Status → (group, result, base round)
STATUS_ROUND = {}
for _g, _base, _pfx in _ROUNDS:
    STATUS_ROUND[_base.lower()] = (_g, None, _base)
    STATUS_ROUND[f"{_pfx} select".lower()] = (_g, "Select", _base)
    STATUS_ROUND[f"{_pfx} reject".lower()] = (_g, "Reject", _base)

# Feedback form → template group (the rounds of FIELD_FEEDBACK_ROUND_MAP;
# the demo form is filed under Demo even though leader rounds may use it).
FEEDBACK_GROUP = {
    "Recruiter Feedback Form": "rec",
    "Recruiter Assessment Form": "rec",
    "Feedback Form - Associate Resource Person": "rec",
    "Educational Capacity Interview - Feedback Form": "fn",
    "School Teacher Feedback Form": "fn",
    "Functional Round Feedback Form": "fn",
    "Functional Feedback Field Enabler": "fn",
    "Technical Round Feedback Form": "fn",
    "Demo Lesson Observation Feedback Form": "demo",
    "Leader Final Round Feedback Form": "fin",
    "Final Round Feedback Form": "fin",
    "Final Feedback Field Enabler": "fin",
}

TEST_STATUS = {"test select": "Select", "test reject": "Reject", "test hold": "Hold", "test no show": "No Show",
               "test process": "In Progress", "test initiated": "In Progress",
               "pending for correction": "Pending for Correction", "correction pending": "Pending for Correction"}

_REACH = {k: {_status_key(s) for s in STATUS[k].get("Field", [])}
          for k in ("reach_cv", "reach_leader", "reach_accepted", "reach_offer", "reach_joined")}


# ── helpers ────────────────────────────────────────────────────────────────

def _d(v):
    """Date / datetime / date-like text → date; unparsable text stays as text; blank → None."""
    if v in (None, ""):
        return None
    try:
        return getdate(v)
    except Exception:
        return str(v).strip() or None


def _days(a, b):
    a, b = _d(a), _d(b)
    if not a or not b or isinstance(a, str) or isinstance(b, str):
        return None
    return (b - a).days


def _num(v):
    if v in (None, ""):
        return None
    n = flt(v)
    return int(n) if n == int(n) else round(n, 2)


def _result(v):
    """'Interview Select' → 'Select' (feedback forms' wording → the template's)."""
    v = (v or "").strip()
    return re.sub(r"^Interview\s+", "", v) or None


def _names(text):
    return [x.strip() for x in re.split(r"[,;\n]", text or "") if x.strip()]


def _first(*vals):
    for v in vals:
        if v not in (None, "", []):
            return v
    return None


def _parse_filters(from_date=None, to_date=None, **kw):
    f = frappe._dict(fd=str(getdate(from_date)) if from_date else None,
                     td=str(getdate(to_date)) if to_date else None)
    for k in FILTER_FIELDS:
        f[k] = _list(kw.get(k))
    return f


class _Base:
    """The user's scoped registrations + the active filters, as SQL on derived table `r`."""

    def __init__(self, f, card=None, search=None):
        self.sql, self.present = _scoped(REG, REG_FIELDS)
        c = self.c
        self.adate = f"DATE(COALESCE({c('date_of_applied')}, {c('application_date')}, r.creation))"
        conds, params = ["1=1"], {}
        if f.fd:
            conds.append(f"{self.adate} >= %(fd)s")
            params["fd"] = f.fd
        if f.td:
            conds.append(f"{self.adate} <= %(td)s")
            params["td"] = f.td
        for key, field in FILTER_FIELDS.items():
            vals = f[key]
            if not vals:
                continue
            col = c(field)
            if col == "NULL":
                conds.append("1=0")
                continue
            if key == "statuses":
                conds.append(f"IFNULL({col}, '') IN %({key})s")
                params[key] = tuple("" if v == "(blank)" else v for v in vals)
            else:
                conds.append(f"{col} IN %({key})s")
                params[key] = tuple(vals)
        self.where_filters, self.params_filters = " AND ".join(conds), dict(params)
        if card and card != "all" and card in CARD_KEYS:
            sts = STATUS[card].get("Field") or []
            conds.append(f"IFNULL({c('application_status')}, '') IN %(card)s" if sts else "1=0")
            params["card"] = tuple(sts) or ("",)
        search = (search or "").strip()
        if search:
            like = [f"r.name LIKE %(q)s"] + [f"{c(x)} LIKE %(q)s" for x in
                                              ("full_name_aadhaar", "email_address", "phone_number", "job_code")
                                              if c(x) != "NULL"]
            conds.append("(" + " OR ".join(like) + ")")
            params["q"] = f"%{search[:100]}%"
        self.where, self.params = " AND ".join(conds), params

    def c(self, field):
        return _col("r", field, self.present)

    def order(self, sort_by=None, sort_dir=None):
        d = "ASC" if (sort_dir or "").lower() == "asc" else "DESC"
        if sort_by == "app_date" or sort_by not in SORTABLE:
            return f"{self.adate} {d}, r.creation {d}"
        col = self.c(DIRECT[sort_by])
        return f"{col if col != 'NULL' else self.adate} {d}, r.creation DESC"

    def count(self):
        return frappe.db.sql(f"SELECT COUNT(*) FROM ({self.sql}) r WHERE {self.where}", self.params)[0][0]

    def names(self, order, limit=None, offset=0):
        q = f"SELECT r.name FROM ({self.sql}) r WHERE {self.where} ORDER BY {order}"
        if limit:
            q += f" LIMIT {cint(limit)} OFFSET {cint(offset)}"
        return [n for (n,) in frappe.db.sql(q, self.params)]

    def rows(self, names):
        """Full registration rows for `names` (already in scope), in the order given."""
        if not names:
            return []
        fields = ", ".join(f"r.`{x}`" for x in REG_FIELDS if x in self.present)
        got = {r.name: r for r in frappe.db.sql(
            f"SELECT {fields}, {self.adate} AS _adate FROM ({self.sql}) r WHERE r.name IN %(names)s",
            {"names": tuple(names)}, as_dict=True)}
        return [got[n] for n in names if n in got]


# ── linked forms, read per batch of registrations ─────────────────────────

def _by_applicant(doctype, link, fields, names, order_by="creation asc"):
    """{registration: [rows]} for `names`, read as this user; {} when the form can't be read."""
    if not names or not _can_read(doctype):
        return {}
    # Real table columns, not meta: some DocTypes list a field the table never got.
    columns = set(frappe.db.get_table_columns(doctype))
    if link not in columns:
        return {}
    fields = [f for f in dict.fromkeys([link, "name", "creation", "owner", *fields]) if f in columns]
    out = {}
    for r in frappe.get_list(doctype, filters={link: ["in", list(names)]}, fields=fields,
                             order_by=order_by, limit_page_length=0):
        out.setdefault(r.get(link), []).append(r)
    return out


def _jobs():
    """Job Opening → (title, employment type), by record name and by job code (labels only; once per request)."""
    if getattr(frappe.local, "master_data_jobs", None) is None:
        by_name, by_code = {}, {}
        for j in frappe.get_all("Job Opening", fields=["name", "job_title", "job_code", "employment_type"]):
            by_name[j.name] = j
            if j.job_code:
                by_code.setdefault(j.job_code, j)
        frappe.local.master_data_jobs = (by_name, by_code)
    return frappe.local.master_data_jobs


def _linked(names):
    names = list(names)
    L = frappe._dict()
    L.log = {}
    if names and frappe.db.table_exists(STATUS_LOG):
        for r in frappe.db.sql(
                f"SELECT parent, application_status, changed_on FROM `tab{STATUS_LOG}` "
                f"WHERE parenttype = %(dt)s AND parent IN %(names)s ORDER BY changed_on, idx",
                {"dt": REG, "names": tuple(names)}, as_dict=True):
            L.log.setdefault(r.parent, []).append(r)
    L.urls = _by_applicant("Field Meritrac Test URL", "applicant_id", ["current_date", "subject"], names)
    L.results = _by_applicant("Field MeritTrac Test Result", "applicant_id",
                              ["created_at", "max_score", "total_score", "overall_percentage_score"], names)
    L.ivs = _by_applicant("Field Interview Schedule", "application_id",
                          ["interview_round", "interview_date", "interviewer_name", "interview_mode", "is_cancelled"],
                          names, order_by="interview_date asc, creation asc")
    L.fb = {}
    for dt, g in FEEDBACK_GROUP.items():
        if not frappe.db.exists("DocType", dt):
            continue
        meta = frappe.get_meta(dt)
        res = next((x for x in _RESULT_FIELDS if meta.has_field(x)), None)
        by = next((x for x in _BY_FIELDS if meta.has_field(x)), None)
        for app, rows in _by_applicant(dt, "applicant_id", [x for x in (res, by) if x], names).items():
            for r in rows:
                L.fb.setdefault(app, []).append(frappe._dict(
                    group=g, creation=r.creation, result=_result(r.get(res)) if res else None,
                    by=(r.get(by) or "").strip() if by else ""))
    L.col = _by_applicant("Common Offer Letter", "applicant_id",
                          ["offer_date", "offer_status", "doj", "mention_the_finalised_doj", "work_location",
                           "job_location", "reporting_manager", "employment_type", "recruiter_email"], names)
    L.fdc = _by_applicant("Field Document Collection", "applicant_id",
                          ["offer_sent_on", "offer_status", "location", "recruiter_email"], names)
    L.pj = _by_applicant("Pre Joining documents", "candidate_id",
                         ["joining_status", "date_of_joining", "supervisor_name", "location",
                          "email_id_to_be_created", "mention_comments"], names)
    return L


def _location_parts(loc):
    """'Itki, Ranchi, Jharkhand, India' → ('Jharkhand', 'Ranchi', 'Itki'); best effort."""
    loc = (loc or "").strip()
    if not loc:
        return None, None, None
    state = _state_of(loc)
    state = None if state in ("Other", "All states") else state
    parts = [p.strip() for p in loc.split(",") if p.strip() and p.strip().lower() != "india"]
    low = [p.lower() for p in parts]
    if state and state.lower() in low:
        i = low.index(state.lower())
        return state, parts[i - 1] if i >= 1 else None, parts[i - 2] if i >= 2 else None
    return state, (parts[-1] if parts else loc), None


# ── one applicant → one row (both sheets' keys) ───────────────────────────

def _rounds(r, ivs, fbs, logs):
    o = {g: frappe._dict(date=None, type=None, mode=None, iv_names=[], log_start=None, log_res=None,
                         fb=None, fb_res=None, fb_by=[]) for g in ("rec", "fn", "demo", "fin")}
    for i in ivs:
        if cint(i.get("is_cancelled")):
            continue
        base = re.sub(r"\s+(Select|Reject)$", "", (i.interview_round or "").strip())
        g = ROUND_GROUP.get(base.lower())
        if not g:
            continue
        x = o[g]
        x.date, x.type, x.mode = i.interview_date or x.date, base, i.get("interview_mode") or x.mode
        x.iv_names = _names(i.get("interviewer_name")) or x.iv_names
    for lg in logs:
        hit = STATUS_ROUND.get(_status_key(lg.application_status))
        if hit:
            g, res, base = hit
            x = o[g]
            x.log_start = x.log_start or _d(lg.changed_on)
            x.type = x.type or base
            if res:
                x.log_res = res
    hit = STATUS_ROUND.get(_status_key(r.application_status))
    if hit:  # the current status is newer than any log entry
        g, res, base = hit
        o[g].type = o[g].type or base
        if res:
            o[g].log_res = res
    for fb in fbs:   # oldest first → the latest wins
        x = o[fb.group]
        x.fb, x.fb_res = _d(fb.creation), fb.result or x.fb_res
        if fb.by and fb.by not in x.fb_by:
            x.fb_by.append(fb.by)
    return o


def _row(r, L):
    name = r.name
    st = _status_key(r.application_status)
    logs = L.log.get(name, [])
    log_keys = [(_status_key(lg.application_status), _d(lg.changed_on)) for lg in logs]

    def first_log(*statuses):
        return next((d for s, d in log_keys if s in statuses), None)

    by_name, by_code = _jobs()
    job = by_name.get(r.get("job_title")) or by_code.get(r.get("job_code")) or {}

    # CV screening
    cv_log = [s for s, _ in log_keys if s in ("cv shortlist", "cv reject")]
    if cv_log:
        cv_status = "Shortlist" if cv_log[-1] == "cv shortlist" else "Reject"
    elif st == "cv reject":
        cv_status = "Reject"
    elif st in _REACH["reach_cv"] or st == "cv shortlist":
        cv_status = "Shortlist"
    else:
        cv_status = None

    # written test
    urls = L.urls.get(name, [])
    res = (L.results.get(name) or [None])[-1]
    mode = r.get("preferred_test_mode") or ("Online" if urls or res else None)
    test_log = [TEST_STATUS[s] for s, _ in log_keys if s in TEST_STATUS]
    test_status = TEST_STATUS.get(st) or (test_log[-1] if test_log else None)
    if not test_status and res and st in _REACH["reach_cv"] and st != "cv shortlist":
        test_status = "Select"   # has a score and has moved past the test

    rd = _rounds(r, L.ivs.get(name, []), L.fb.get(name, []), logs)
    rec, fn, demo, fin = rd["rec"], rd["fn"], rd["demo"], rd["fin"]
    fn_names = fn.iv_names or fn.fb_by
    fin_names = fin.iv_names or fin.fb_by

    # offer / joining
    col = (L.col.get(name) or [{}])[-1]
    fdc = (L.fdc.get(name) or [{}])[-1]
    pj = (L.pj.get(name) or [{}])[-1]
    fitment_date = first_log("fitment stage")
    offer_date = _first(_d(col.get("offer_date")), _d(fdc.get("offer_sent_on")), first_log("offer sent", "offer"),
                        _d(r.get("date_offer")))
    status_offer = ("Offer Accepted" if st in _REACH["reach_accepted"] else
                    "Offer Declined" if st == "offer declined" else
                    "Offer Sent" if st in ("offer sent", "offer") else None)
    location = _first(col.get("work_location"), col.get("job_location"), pj.get("location"), fdc.get("location"))
    j_state, j_district, j_block = _location_parts(location)
    join_status = _first(pj.get("joining_status"),
                         "Joined" if st in _REACH["reach_joined"] else None,
                         "Not Joined" if st == "not joined" else None)
    source = r.get("opportunity")
    other = _first(r.get("then_other"), r.get("if_email_invite"))
    rec_name = _first(r.get("recruiter_round_name"), rec.iv_names[0] if rec.iv_names else None,
                      rec.fb_by[0] if rec.fb_by else None)

    row = {k: r.get(f) for k, f in DIRECT.items()}
    row.update(
        job_title=_first(job.get("job_title"), r.get("role")),
        app_date=r._adate,
        dob=_d(r.get("dob")),
        apf_associated=("Yes" if "yes" in {(r.get("former_employee") or "").lower(),
                                           (r.get("apf_associated") or "").lower()}
                        else _first(r.get("former_employee"), r.get("apf_associated"))),
        cv_date=first_log("cv shortlist", "cv reject"),
        cv_status=cv_status,
        admit_date=_d(urls[-1].creation) if urls else None,
        admit_offline=cint(r.get("offline_test_attempts")) or None,
        admit_online=cint(r.get("online_test_attempts")) or len(urls) or None,
        test_mode=mode,
        test_center=(r.get("test_location") if (mode or "").lower() != "online" else "Online"),
        test_date=_first(_d(res.get("created_at")) if res else None,
                         _d(urls[-1].get("current_date")) if urls else None),
        test_subject=_first(urls[-1].get("subject") if urls else None, r.get("written_subject")),
        total_score=_num(res.get("max_score")) if res else None,
        secured_score=_num(res.get("total_score")) if res else None,
        score_pct=_num(res.get("overall_percentage_score")) if res else None,
        test_status=test_status,
        rec_date=_first(_d(r.get("date_of_recruiter_round")), _d(rec.date), rec.log_start),
        rec_name=rec_name,
        rec_status=_first(r.get("recruiter_round_status"), rec.fb_res, rec.log_res),
        rec_fb=rec.fb,
        fn_type=("Education Capacity" if (fn.type or "") == "Education Capacity Round" else fn.type),
        fn_date=_first(_d(r.get("date_of_functional_round")), _d(fn.date), fn.log_start),
        fn_p1=_first(r.get("functional_panel1"), fn_names[0] if fn_names else None),
        fn_p2=_first(r.get("functional_panel2"), fn_names[1] if len(fn_names) > 1 else None),
        fn_status=_first(r.get("functional_round_status"), fn.fb_res, fn.log_res),
        fn_fb=fn.fb,
        demo_mode=demo.mode,
        demo_date=_first(_d(demo.date), demo.log_start),
        demo_name=_first(demo.iv_names[0] if demo.iv_names else None, demo.fb_by[0] if demo.fb_by else None),
        demo_status=_first(demo.fb_res, demo.log_res),
        demo_fb=demo.fb,
        fin_date=_first(_d(r.get("date_of_final_round")), _d(fin.date), fin.log_start),
        fin_p1=_first(r.get("final_panel1"), fin_names[0] if fin_names else None),
        fin_p2=_first(r.get("final_panel2"), fin_names[1] if len(fin_names) > 1 else None),
        fin_status=_first(r.get("final_round_status"), fin.fb_res, fin.log_res),
        fin_fb=fin.fb,
        fitment_date=fitment_date,
        offer_date=offer_date,
        offer_status=_first(col.get("offer_status"), fdc.get("offer_status"), r.get("offer"), status_offer),
        doj=_first(_d(pj.get("date_of_joining")), _d(col.get("mention_the_finalised_doj")), _d(col.get("doj"))),
        join_status=join_status,
        join_state=j_state, join_district=j_district, join_block=j_block,
        supervisor=_first(pj.get("supervisor_name"), col.get("reporting_manager")),
        # Offer Tracker only
        source_specific=other,
        referred_by=_first(r.get("employee_referral"), r.get("ex_emplyee_name")),
        agency=other if re.search(r"consult|agency|placement", source or "", re.I) else None,
        prev_org_type=None, exploratory_date=None, panel_date=None, employee_id=None,
        hiring_type=_first(col.get("employment_type"), job.get("employment_type")),
        recruiter=_first(rec_name, col.get("recruiter_email"), fdc.get("recruiter_email")),
        employee_email=pj.get("email_id_to_be_created"),
        pj_remarks=pj.get("mention_comments"),
    )
    row.update(
        d_app_test=_days(row["app_date"], row["test_date"]),
        d_test_rec=_days(row["test_date"], row["rec_date"]),
        d_rec_fn=_days(row["rec_date"], row["fn_date"]),
        d_fn_fin=_days(row["fn_date"], row["fin_date"]),
        d_fin_fit=_days(row["fin_date"], row["fitment_date"]),
        d_fit_offer=_days(row["fitment_date"], row["offer_date"]),
        d_app_offer=_days(row["app_date"], row["offer_date"]),
    )
    return row


def _build_rows(base, names):
    regs = base.rows(names)
    L = _linked([r.name for r in regs])
    return [_row(r, L) for r in regs]


# ── page data ──────────────────────────────────────────────────────────────

def _summary(f):
    key = "master_data:v1:" + hashlib.sha1(frappe.as_json([frappe.session.user, f]).encode()).hexdigest()
    hit = frappe.cache.get_value(key)
    if hit:
        return hit
    base = _Base(f)
    counts = {}
    for s, n in frappe.db.sql(
            f"SELECT IFNULL({base.c('application_status')}, '') s, COUNT(*) FROM ({base.sql}) r "
            f"WHERE {base.where_filters} GROUP BY s", base.params_filters):
        counts[_status_key(s)] = counts.get(_status_key(s), 0) + n
    total = sum(counts.values())
    cards = []
    for k, label, desc in CARDS:
        if k == "all":
            v = total
        else:
            v = sum(counts.get(s, 0) for s in {_status_key(x) for x in STATUS[k].get("Field", [])})
        cards.append({"key": k, "label": label, "value": v, "desc": desc,
                      "pct": round(v * 100.0 / total, 1) if total and k != "all" else None})
    out = {"cards": cards, "total": total}
    frappe.cache.set_value(key, out, expires_in_sec=CACHE_SECONDS)
    return out


def _options():
    key = "master_data:opts:v1:" + hashlib.sha1(frappe.session.user.encode()).hexdigest()
    hit = frappe.cache.get_value(key)
    if hit:
        return hit
    sql, present = _scoped(REG, ["name", "units", "department", "job_code", "role", "location"])
    c = lambda x: _col("t", x, present)  # noqa: E731
    combos = sorted({(u or "", s or "", j or "") for u, s, j in
                     frappe.db.sql(f"SELECT DISTINCT {c('units')}, {c('department')}, {c('job_code')} FROM ({sql}) t")})
    distinct = lambda x: sorted(v for (v,) in frappe.db.sql(f"SELECT DISTINCT {c(x)} FROM ({sql}) t") if v)  # noqa: E731
    statuses = [s for s in (frappe.get_meta(REG).get_field("application_status").options or "").split("\n") if s]
    out = {"units": sorted({u for u, _, _ in combos if u}), "combos": combos, "roles": distinct("role"),
           "locations": distinct("location"), "statuses": ["(blank)"] + statuses}
    frappe.cache.set_value(key, out, expires_in_sec=OPTIONS_CACHE_SECONDS)
    return out


def _col_meta():
    def meta(k, label, group=None):
        return {"key": k, "label": label, "group": group, "sortable": k in SORTABLE,
                "type": "date" if k in DATE_KEYS else "number" if k in NUMBER_KEYS else "text"}
    return {"groups": [{"key": k, "label": label} for k, label in GROUPS],
            "master": [meta(k, label, g) for g, k, label in MASTER_COLS],
            "offer": [meta(k, label) for k, label in OFFER_COLS]}


@frappe.whitelist()
def get_master_data(page=1, page_size=50, sort_by=None, sort_dir=None, search=None, card=None,
                    from_date=None, to_date=None, **kw):
    frappe.has_permission(REG, "read", throw=True)
    f = _parse_filters(from_date, to_date, **kw)
    page_size = cint(page_size) if cint(page_size) in PAGE_SIZES else 50
    base = _Base(f, card=card, search=search)
    total = base.count()
    pages = max(1, -(-total // page_size))
    page = min(max(1, cint(page)), pages)
    names = base.names(base.order(sort_by, sort_dir), limit=page_size, offset=(page - 1) * page_size)
    return {
        "filters": {"from_date": f.fd, "to_date": f.td, **{k: f[k] for k in FILTER_FIELDS}},
        "options": _options(),
        "summary": _summary(f),
        "columns": _col_meta(),
        "rows": _build_rows(base, names),
        "total": total, "page": page, "pages": pages, "page_size": page_size,
        "generated_at": frappe.utils.now(),
    }


# ── Excel download (both sheets, template layout) ─────────────────────────

@frappe.whitelist()
def download_excel(sort_by=None, sort_dir=None, search=None, card=None, from_date=None, to_date=None, **kw):
    """
    Every matching row (no cap) as an .xlsx with the template's two sheets —
    same permission-scoped query as the table. Built in batches into a temp
    file with xlsxwriter's constant-memory mode, so memory stays flat.
    """
    import tempfile

    import xlsxwriter
    from werkzeug.wrappers import Response
    from werkzeug.wsgi import wrap_file

    frappe.has_permission(REG, "read", throw=True)
    f = _parse_filters(from_date, to_date, **kw)
    base = _Base(f, card=card, search=search)
    names = base.names(base.order(sort_by, sort_dir))

    tmp = tempfile.NamedTemporaryFile(suffix=".xlsx")
    wb = xlsxwriter.Workbook(tmp.name, {"constant_memory": True, "strings_to_formulas": False,
                                        "strings_to_urls": False})
    fmt = {
        "group": {g: wb.add_format({"bold": True, "font_color": "#FFFFFF", "bg_color": c, "align": "center",
                                    "valign": "vcenter", "border": 1, "text_wrap": True})
                  for g, c in (("app", "#1F4E79"), ("test", "#7A4E12"), ("iv", "#1F5C4A"), ("offer", "#5B3A7A"))},
        "head": wb.add_format({"bold": True, "bg_color": "#DCE6F1", "border": 1, "text_wrap": True,
                               "valign": "top", "font_size": 10}),
        "date": wb.add_format({"num_format": "dd-mm-yyyy"}),
    }

    def sheet(title, cols, grouped):
        ws = wb.add_worksheet(title)
        for i, (k, _) in enumerate(cols):
            ws.set_column(i, i, 13 if k in DATE_KEYS else 10 if k in NUMBER_KEYS else 22)
        r0 = 0
        if grouped:
            ws.set_row(0, 30)
            start = 0
            for g, label in GROUPS:
                n = sum(1 for gg, _, _ in MASTER_COLS if gg == g)
                ws.merge_range(0, start, 0, start + n - 1, label, fmt["group"][g])
                start += n
            r0 = 1
        ws.set_row(r0, 48)
        for i, (_, label) in enumerate(cols):
            ws.write_string(r0, i, label, fmt["head"])
        ws.freeze_panes(r0 + 1, 1)
        ws.autofilter(r0, 0, r0 + max(len(names), 1), len(cols) - 1)
        return ws, r0 + 1

    # constant_memory only needs rows in order within each sheet, so every
    # batch is built once and written to both sheets.
    sheets = [(*sheet("Master Tracker", [(k, label) for _, k, label in MASTER_COLS], True),
               [k for _, k, _ in MASTER_COLS]),
              (*sheet("Offer Tracker", OFFER_COLS, False), [k for k, _ in OFFER_COLS])]
    for i in range(0, len(names), BATCH):
        for row in _build_rows(base, names[i:i + BATCH]):
            for si, (ws, row_i, keys) in enumerate(sheets):
                for ci, k in enumerate(keys):
                    v = row.get(k)
                    if v in (None, ""):
                        continue
                    if k in DATE_KEYS and hasattr(v, "year"):
                        ws.write_datetime(row_i, ci, frappe.utils.get_datetime(v), fmt["date"])
                    elif isinstance(v, (int, float)) and not isinstance(v, bool):
                        ws.write_number(row_i, ci, v)
                    else:
                        ws.write_string(row_i, ci, str(v))
                sheets[si] = (ws, row_i + 1, keys)
    wb.close()

    tmp.seek(0, 2)
    size = tmp.tell()
    tmp.seek(0)
    fname = f"Master_Tracker_{frappe.utils.nowdate()}.xlsx"
    resp = Response(wrap_file(frappe.local.request.environ, tmp), direct_passthrough=True,
                    mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    resp.headers["Content-Disposition"] = f'attachment; filename="{fname}"'
    resp.headers["Content-Length"] = str(size)
    return resp
