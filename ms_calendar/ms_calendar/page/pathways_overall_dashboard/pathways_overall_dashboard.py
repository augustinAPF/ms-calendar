"""
Pathways Overall Dashboard (desk page /app/pathways-overall-dashboard).

One view across the four hiring programmes — Field, Health, Philanthropy
and Scholarship — following the hiring pipeline end to end:
registration → screening → test → interview rounds → feedback → document
collection / fitment → compensation → offer → addendum → pre-joining →
IT email → joining → ERP ID.

Filters: application date (from–to), programme, units, sub-units,
location, job code, role, stage.

Speed: nothing is shipped row-by-row to the browser. Each programme's
registrations are aggregated in SQL (one SUM(...) pass for every pipeline
card) and the summary is cached per user + filters for CACHE_SECONDS.

Permissions (enforced here, never in the browser):
- every table is read through frappe.get_list(..., run=0), i.e. the exact
  query Frappe would run for this user (role + User Permissions + if-owner),
  and only that query is aggregated — as a derived table;
- a programme / feedback form the user can't read is skipped entirely;
- client values (statuses, roles, units, …) are only ever bound as SQL
  parameters, never put into query text;
- drilldowns, the paged tables, the CSV export, the status log and the
  candidate detail go through the same scoped queries; the candidate
  detail also checks read permission on that exact record.
No row cap anywhere: tables page / sort / search in SQL, and the CSV export
streams every matching row, so a 10-lakh list stays fast and complete.
"""

import hashlib

import frappe
from frappe.utils import add_days, cint, getdate, nowdate

from ms_calendar.api.ms_field import FIELD_FEEDBACK_ROUND_MAP
from ms_calendar.api.ms_health import MBBS_FEEDBACK_ROUND_DOCTYPES
from ms_calendar.ms_calendar.page.field_interview_dashboard.field_interview_dashboard import (
    _render_feedback_doc,
)

CACHE_SECONDS = 90

STAGES = ["New", "In process", "On hold", "Offer / Selected", "Not selected"]

# key → how each programme's doctypes and fields are wired.
# `app` is the application form linked back to the registration (None when
# the programme has none). unit / subunit / location / job_code / app_date
# are the registration fields behind those filters (None = not captured).
PROGRAMS = [
    {
        "key": "Field", "unit_label": "Field",
        "reg": "Field Registration Form",
        "title": "full_name_aadhaar", "email": "email_address", "phone": "phone_number",
        "role": "role", "status": "application_status",
        "unit": "units", "subunit": "department", "location": "location", "job_code": "job_code",
        "app_date": "application_date",
        # Latest round first — the first one filled is when the current round started.
        "round_dates": ["date_of_final_round", "date_of_functional_round", "date_of_recruiter_round"],
        "app": ("Field Application Form", "applicant_id"),
        "gender": "gender", "source": "opportunity",
        "interview": "Field Interview Schedule", "mode": "interview_mode",
        "feedback": sorted({d for dts in FIELD_FEEDBACK_ROUND_MAP.values() for d in dts}),
        "extra_forms": ["Field Self Declaration", "Field MeritTrac Test Result"],
        "status_log": "Field Application Status Log",
    },
    {
        "key": "Health", "unit_label": "Health",
        "reg": "Health Registration Form",
        "title": "full_name", "email": "email_address", "phone": "phone_number",
        "role": "role", "status": "application_status",
        "unit": "unit", "subunit": "department", "location": "location", "job_code": "job_code",
        "app_date": None,
        "app": None,
        "gender": "gender", "source": "opportunity",
        "interview": "Health Interview Schedule", "mode": "interview_type",
        "feedback": list(MBBS_FEEDBACK_ROUND_DOCTYPES),
        "extra_forms": ["Health Document Collection"],
    },
    {
        "key": "Philanthropy", "unit_label": "Grants",
        "reg": "Phil Registration Form",
        "title": "name1", "email": "email", "phone": "phone",
        "role": "role", "status": "application_status",
        "unit": "unit", "subunit": None, "location": "location", "job_code": "job_code",
        "app_date": None,
        "app": None,
        "gender": None, "source": "source",
        "interview": "Philanthropy Interview Schedule", "mode": "interview_mode",
        "feedback": ["Philanthrophy Feedback Form"],
        "extra_forms": ["Philanthrophy Document Collection"],
    },
    {
        "key": "Scholarship", "unit_label": "Azim Premji Scholarship",
        "reg": "Scholarship Recruitment Form",
        "title": "full_name_as_per_aadhar", "email": "email", "phone": "phone_number",
        "role": "role", "status": "application_status",
        "unit": "unit", "subunit": "department", "location": "location", "job_code": None,
        "app_date": None,
        "app": None,
        "gender": "gender", "source": "opportunity",
        "interview": "Interview Schedule", "mode": "interview_mode",
        "feedback": ["Feedback Form One"],
    },
]
PROGRAM_KEYS = [p["key"] for p in PROGRAMS]

# Feedback forms don't agree on field names — first one present wins.
_RESULT_FIELDS = ("interview_status", "interview_result", "recommendation", "select_regret", "status")
_BY_FIELDS = ("panelist_name", "panal_name", "panelist_names", "interviewer_name", "panelist_email")

_OFFER = {"offer", "offered", "offer accepted", "joined", "pre joining", "document collection",
          "document verification pass", "it team", "compensation due", "compensation approved",
          "offer sent", "offer not sent", "addendum accepted", "pre-join form submitted", "it email sent",
          "it email not sent",
          "erp id created", "erp id not created"}
_CLOSED = {"not selected", "offer declined", "document verification fail", "blocklisted",
           "blocklist", "duplicated", "addendum declined", "not joined"}


def _status_key(status):
    """How MariaDB compares statuses (utf8mb4 *_ci, PAD SPACE): case-insensitive, trailing spaces ignored."""
    return (status or "").rstrip().lower()


def _stage(status):
    s = (status or "").strip().lower()
    if not s or s == "new applicant":
        return "New"
    if s in _CLOSED or "reject" in s or "regret" in s or "no show" in s or "no-show" in s:
        return "Not selected"
    if s in _OFFER:
        return "Offer / Selected"
    if "hold" in s:
        return "On hold"
    return "In process"


# ── pipeline cards (the whiteboard) ────────────────────────────────────────
#
# Every registration card is driven ONLY by the registration form's
# Application Status: a card counts applicants whose status is *currently*
# one of the statuses below. Status names differ per programme, so STATUS
# maps card → programme → statuses; a programme without such a status is
# left out of that card. To move an applicant on the board, change their
# Application Status.

# Statuses only Health / Phil / Scholarship got locally (2026-10-15), named as
# on Field so one card means the same thing in every unit.
_ONB = ["Compensation Approved", "Compensation Due", "Offer Not Sent", "Addendum Accepted", "Addendum Declined",
        "Pre-join Form Submitted", "IT Email Sent", "IT Email Not Sent", "Joined", "Not Joined",
        "ERP ID Created", "ERP ID Not Created"]

STATUS = {
    "new": {p: ["", "New Applicant"] for p in PROGRAM_KEYS},
    "cv_shortlist": {"Field": ["CV Shortlist"], "Health": ["Shortlist - CV"],
                     "Philanthropy": ["CV Shortlist", "Pre Shortlist"], "Scholarship": ["CV Shortlist"]},
    "cv_reject": {"Field": ["CV Reject"], "Health": ["Regret - CV"], "Philanthropy": ["CV Reject"],
                  "Scholarship": ["Application Reject"]},
    "test_select": {"Field": ["Test Select"], "Health": ["Test Select"], "Philanthropy": ["Test Select"],
                    "Scholarship": ["Test Select"]},
    "test_reject": {"Field": ["Test Reject"], "Health": ["Test Reject"], "Philanthropy": ["Test Reject"],
                    "Scholarship": ["Test Reject"]},
    "recruiter": {"Field": ["Recruiter Round", "Recruiter Round Select"], "Health": ["Recruiter Round"],
                  "Philanthropy": ["Recruiter Round"], "Scholarship": ["Recruiter Round"]},
    "functional": {
        "Field": ["Functional Round", "Functional Round Select", "Subject Round", "Subject Round Select",
                  "Education Capacity Round", "Education Capacity Select", "Technical Round",
                  "Technical Round Select", "Demo Round", "Demo Round Select"],
        "Health": ["Shortlist - R1"], "Philanthropy": ["Round One"], "Scholarship": ["Round One"]},
    "leadership": {
        "Field": ["Leader Round-1", "Leader Round-1 Select", "Leader Round-2", "Leader Round-2 Select",
                  "Leader Round-3", "Leader Round-3 Select", "Calibration Process", "Calibration Select"],
        "Health": ["Shortlist - R2", "Shortlist - R3"],
        "Philanthropy": ["Round Two", "Round Three", "Round Four"], "Scholarship": ["Round Two"]},
    # Feedback, from the status alone: still in a round (no result yet) = pending;
    # the round has a result (Select / Reject / Regret / On hold) = completed.
    "fb_pending": {
        "Field": ["Recruiter Round", "Education Capacity Round", "Subject Round", "Technical Round",
                  "Functional Round", "Demo Round", "Leader Round-1", "Leader Round-2", "Leader Round-3",
                  "Calibration Process"],
        "Health": ["Recruiter Round", "Shortlist - R1", "Shortlist - R2", "Shortlist - R3"],
        "Philanthropy": ["Recruiter Round", "Round One", "Round Two", "Round Three", "Round Four"],
        "Scholarship": ["Recruiter Round", "Round One", "Round Two"]},
    "fb_done": {
        "Field": ["Recruiter Round Select", "Recruiter Round Reject", "Education Capacity Select",
                  "Education Capacity Reject", "Subject Round Select", "Subject Round Reject",
                  "Technical Round Select", "Technical Round Reject", "Functional Round Select",
                  "Functional Round Reject", "Demo Round Select", "Demo Round Reject", "Leader Round-1 Select",
                  "Leader Round-1 Reject", "Leader Round-2 Select", "Leader Round-2 Reject",
                  "Leader Round-3 Select", "Leader Round-3 Reject", "Calibration Select", "Calibration Reject"],
        "Health": ["Regret - R1", "Regret - R2", "Regret - R3", "On hold - R1", "On hold - R2", "On hold - R3"],
        "Philanthropy": ["Recruiter Reject", "Round 1 Reject", "Round 2 Reject", "Round 3 Reject", "Round 4 Reject"],
        "Scholarship": ["Recruiter Reject", "Reject - Round 1", "Reject - Round 2"]},
    "doc_collection": {"Field": ["Document Collection", "Document Verification Pass"],
                       "Health": ["Document Collection"], "Philanthropy": ["Document Collection"],
                       "Scholarship": ["Document Collection"]},
    "fitment": {p: ["Fitment Stage"] for p in PROGRAM_KEYS},
    "comp_approved": {p: ["Compensation Approved"] for p in PROGRAM_KEYS},
    "comp_due": {p: ["Compensation Due"] for p in PROGRAM_KEYS},
    "offer_sent": {"Field": ["Offer Sent", "Offer"], "Health": ["Offered"], "Philanthropy": ["Offer"],
                   "Scholarship": ["Offer"]},
    "offer_not_sent": {p: ["Offer Not Sent"] for p in PROGRAM_KEYS},
    "offer_accepted": {"Field": ["Offer Accepted"], "Health": ["Offer accepted"], "Philanthropy": ["Offer Accepted"],
                       "Scholarship": ["Offer Accepted"]},
    "offer_declined": {"Field": ["Offer Declined"], "Health": ["Offer declined"], "Philanthropy": ["Offer Declined"],
                       "Scholarship": ["Offer Declined"]},
    "addendum_accepted": {p: ["Addendum Accepted"] for p in PROGRAM_KEYS},
    "addendum_declined": {p: ["Addendum Declined"] for p in PROGRAM_KEYS},
    # Field: no "form submitted" status on the cloud list, so Field is left out.
    "prejoin_done": {"Health": ["Pre-join Form Submitted"], "Philanthropy": ["Pre-join Form Submitted"],
                     "Scholarship": ["Pre-join Form Submitted"]},
    "prejoin_pending": {"Field": ["Pre joining"], "Health": ["Pre Joining"], "Philanthropy": ["Pre joining"],
                        "Scholarship": ["Pre joining"]},
    "it_sent": {"Field": ["IT Email Sent", "IT Team"], "Health": ["IT Email Sent", "IT Team"],
                "Philanthropy": ["IT Email Sent"], "Scholarship": ["IT Email Sent"]},
    "it_not_sent": {p: ["IT Email Not Sent"] for p in PROGRAM_KEYS},
    "joined": {p: ["Joined"] for p in PROGRAM_KEYS},
    "not_joined": {p: ["Not Joined"] for p in PROGRAM_KEYS},
    "erp_created": {p: ["ERP ID Created"] for p in PROGRAM_KEYS},
    "erp_not_created": {p: ["ERP ID Not Created"] for p in PROGRAM_KEYS},
}


# ── headline funnel: "reached this step or beyond" ─────────────────────────
#
# The board counts who is at a step *right now*; the headline row counts who
# has *got at least this far*, so it only ever narrows: CV shortlisted ⊇
# leadership ⊇ offer accepted ⊇ joined. Built from the board's own status
# lists plus the reject / no-show results of each step (someone rejected in a
# leader round still reached the leader round).

def _statuses(*keys, extra=None):
    out = {}
    for p in PROGRAM_KEYS:
        vals = [s for k in keys for s in STATUS.get(k, {}).get(p, [])] + list((extra or {}).get(p, []))
        if vals:
            out[p] = list(dict.fromkeys(vals))
    return out


_JOINED = ("joined", "erp_created", "erp_not_created")
_ACCEPTED = ("offer_accepted", "addendum_accepted", "addendum_declined", "prejoin_done", "prejoin_pending",
             "it_sent", "it_not_sent", "not_joined") + _JOINED
_PAST_LEADER = ("doc_collection", "fitment", "comp_approved", "comp_due", "offer_sent", "offer_not_sent",
                "offer_declined") + _ACCEPTED
# Results of the leader rounds / later checks that the board's lists don't hold.
_LEADER_DONE = {
    "Field": ["Leader Round-1 Reject", "Leader Round-2 Reject", "Leader Round-3 Reject", "Calibration Reject",
              "Fitment Reject", "Document Verification Fail"],
    "Health": ["Regret - R2", "Regret - R3", "On hold - R2", "On hold - R3"],
    "Philanthropy": ["Round 2 Reject", "Round 3 Reject", "Round 4 Reject"],
    "Scholarship": ["Reject - Round 2"],
}
# Past CV screening but not in any board list (test in progress / no-show).
_CV_DONE = {
    "Field": ["Test Initiated", "Test Process", "No Show", "Interview No Show", "Interview-No Show"],
    "Health": ["Regret - R1", "On hold - R1"],
}
STATUS["reach_cv"] = _statuses(
    "cv_shortlist", "test_select", "test_reject", "recruiter", "functional", "leadership", "fb_done", *_PAST_LEADER,
    extra={p: _CV_DONE.get(p, []) + _LEADER_DONE.get(p, []) for p in PROGRAM_KEYS})
STATUS["reach_leader"] = _statuses("leadership", *_PAST_LEADER, extra=_LEADER_DONE)
STATUS["reach_accepted"] = _statuses(*_ACCEPTED)
STATUS["reach_joined"] = _statuses(*_JOINED)
FUNNEL_CARDS = ["reach_cv", "reach_leader", "reach_accepted", "reach_joined"]

# Offer update charts (Timeline tab): everyone who has been made an offer,
# split by where that offer stands now. The four groups don't overlap.
STATUS["reach_offer"] = _statuses("offer_sent", "offer_accepted", "offer_declined", *_ACCEPTED)
OFFER_GROUPS = [
    ("joined", "Joined", _statuses(*_JOINED)),
    ("awaiting", "Awaiting reply", _statuses("offer_sent")),
    ("accepted", "Accepted", _statuses("offer_accepted", "addendum_accepted", "addendum_declined", "prejoin_done",
                                       "prejoin_pending", "it_sent", "it_not_sent")),
    ("declined", "Declined / did not join", _statuses("offer_declined", "not_joined")),
]

# What each local reg form must offer so every card applies (added on ms.local only).
LOCAL_STATUS_ADDITIONS = {
    "Health Registration Form": ["Recruiter Round"] + _ONB,
    "Phil Registration Form": ["Test Select", "Test Reject", "Fitment Stage", "Offer Accepted", "Offer Declined",
                               "Pre joining"] + _ONB,
    "Scholarship Recruitment Form": ["CV Shortlist", "Test Select", "Fitment Stage", "Pre joining"] + _ONB,
}

# key → label, tone (colour meaning), kind (which rows the drilldown shows;
# none = registrations with that status) and an optional hint line.
CARDS = {
    "new": dict(label="New Applicant", tone="neutral", hint="awaiting CV screening"),
    "cv_shortlist": dict(label="CV Shortlist", tone="good"),
    "cv_reject": dict(label="CV Regret", tone="bad"),
    "test_select": dict(label="Test Select", tone="good"),
    "test_reject": dict(label="Test Reject", tone="bad"),
    "recruiter": dict(label="Recruiter Round", tone="info", hint="in recruiter round"),
    "functional": dict(label="Functional Round", tone="info", hint="functional / subject / demo"),
    "leadership": dict(label="Leadership Round", tone="info", hint="leader rounds & calibration"),
    "iv_today": dict(label="Interviews Today", tone="time", kind="today", hint="scheduled for today"),
    "iv_next7": dict(label="Next 7 Days", tone="info", kind="upcoming", hint="interviews coming up"),
    "fb_done": dict(label="Feedback Completed", tone="good", hint="round has a result"),
    "fb_pending": dict(label="Feedback Pending", tone="action", hint="in a round, no result yet"),
    "doc_collection": dict(label="Document Collection", tone="info"),
    "fitment": dict(label="Fitment", tone="info"),
    "comp_approved": dict(label="Compensation Approved", tone="good"),
    "comp_due": dict(label="Compensation Due", tone="action", hint="approval pending"),
    "offer_sent": dict(label="Offer Sent", tone="good", hint="awaiting reply"),
    "offer_not_sent": dict(label="Offer Not Sent", tone="action"),
    "offer_accepted": dict(label="Offer Accepted", tone="good"),
    "offer_declined": dict(label="Offer Declined", tone="bad"),
    "addendum_accepted": dict(label="Addendum Accepted", tone="good"),
    "addendum_declined": dict(label="Addendum Declined", tone="bad"),
    "prejoin_done": dict(label="Pre-join Form", tone="good", hint="form submitted"),
    "prejoin_pending": dict(label="Pre-join Pending", tone="action", hint="form not submitted"),
    "it_sent": dict(label="IT Email Sent", tone="good"),
    "it_not_sent": dict(label="IT Email Not Sent", tone="action"),
    "joined": dict(label="Joined", tone="good"),
    "not_joined": dict(label="Not Joined", tone="bad"),
    "erp_created": dict(label="ERP ID Created", tone="good"),
    "erp_not_created": dict(label="ERP ID Not Created", tone="action"),
    # headline funnel (not on the board)
    "reach_cv": dict(label="CV Shortlisted", tone="info", funnel=True),
    "reach_leader": dict(label="Leadership Round", tone="info", funnel=True),
    "reach_accepted": dict(label="Offer Accepted", tone="good", funnel=True),
    "reach_joined": dict(label="Joined", tone="good", funnel=True),
    # Offer update charts (Hiring Funnel tab) → "Offers · <unit>" list
    "reach_offer": dict(label="Offers made", tone="info", funnel=True),
}

# Plain-language definition of every card — shown on the card's (i) and in
# the page's "Card guide", so everyone reads the numbers the same way.
CARD_DESC = {
    "new": "Nobody has screened the CV yet.",
    "cv_shortlist": "Shortlisted at CV screening and not moved on yet (their status is still CV Shortlist).",
    "cv_reject": "Not taken forward at CV screening (CV Reject / Regret - CV / Application Reject).",
    "test_select": "Passed the written / online test.",
    "test_reject": "Did not pass the test.",
    "recruiter": "In the Recruiter Round (Select = cleared, waiting for the next round).",
    "functional": "In a functional, subject, education capacity, technical or demo round.",
    "leadership": "In a leader round or calibration.",
    "iv_today": "Interviews scheduled for today that are not cancelled (from the Interview Schedules).",
    "iv_next7": "Interviews scheduled from today up to 7 days ahead, not cancelled (from the Interview Schedules).",
    "fb_done": "The interview round has a result in the Application Status (Select / Reject / Regret / On hold).",
    "fb_pending": "The applicant is in an interview round and the Application Status has no result yet. "
                  "Next step: get the interviewer's feedback.",
    "doc_collection": "Collecting / verifying documents.",
    "fitment": "In the fitment discussion.",
    "comp_approved": "Compensation approved; the offer is next.",
    "comp_due": "Compensation sent for approval and not approved yet. Next step: get it approved.",
    "offer_sent": "Offer letter sent; waiting for the candidate's answer.",
    "offer_not_sent": "Offer not sent yet. Next step: send the offer letter.",
    "offer_accepted": "Candidate accepted the offer.",
    "offer_declined": "Candidate declined the offer.",
    "addendum_accepted": "Candidate accepted the addendum.",
    "addendum_declined": "Candidate declined the addendum.",
    "prejoin_done": "Pre-joining form submitted.",
    "prejoin_pending": "In pre-joining; the form is not submitted yet. Next step: follow up with the candidate.",
    "it_sent": "IT email sent / handed to the IT team.",
    "it_not_sent": "IT email not sent yet. Next step: email IT for laptop and access.",
    "joined": "Candidate joined.",
    "not_joined": "Candidate did not join.",
    "erp_created": "ERP ID created.",
    "erp_not_created": "ERP ID not created yet. Next step: create the ERP ID.",
    "reach_cv": "Cleared CV screening — includes everyone who went on to the test, the interview rounds, "
                "the offer or joining, even if rejected later.",
    "reach_leader": "Reached a leader round / calibration (Health: round 2+) or went further "
                    "(documents, fitment, compensation, offer, joining), even if rejected there.",
    "reach_accepted": "Accepted the offer, including everyone now in addendum, pre-joining, IT email, "
                      "joined / not joined or ERP ID.",
    "reach_joined": "Joined the Foundation (Joined or ERP ID stage).",
    "reach_offer": "Made an offer: offer sent, accepted, declined, onboarding, joined or not joined.",
}


def _card_desc(key):
    """The card's meaning plus exactly which Application Status values it counts."""
    text = CARD_DESC.get(key, "")
    st = STATUS.get(key)
    if st:
        unit = {c["key"]: c["unit_label"] for c in PROGRAMS}
        lines = [f"{unit.get(p, p)}: " + ", ".join(v or "(blank)" for v in vals) for p, vals in st.items() if vals]
        text += "\nCounts Application Status:\n" + "\n".join(lines)
    return text


# The board, in pipeline order: (group key, title, [(layout, [card keys])]).
BOARD = [
    ("screening", "Screening & test", [
        # CV Shortlist | CV Regret — the user asked for it back (2026-10-16): who is
        # at CV screening right now (the top row's CV Shortlisted counts everyone
        # who ever got past CV).
        ("single", ["new"]), ("pair", ["cv_shortlist", "cv_reject"]), ("pair", ["test_select", "test_reject"])]),
    ("interviews", "Interviews", [
        ("single", ["recruiter"]), ("single", ["functional"]), ("single", ["leadership"]),
        ("single", ["iv_today"]), ("single", ["iv_next7"])]),
    ("selection", "Feedback & selection", [
        ("pair", ["fb_done", "fb_pending"]), ("single", ["doc_collection"]), ("single", ["fitment"])]),
    ("offer", "Compensation & offer", [
        ("pair", ["comp_approved", "comp_due"]), ("pair", ["offer_sent", "offer_not_sent"]),
        ("pair", ["offer_accepted", "offer_declined"])]),
    ("onboarding", "Onboarding", [
        ("pair", ["addendum_accepted", "addendum_declined"]), ("pair", ["prejoin_done", "prejoin_pending"]),
        ("pair", ["it_sent", "it_not_sent"]), ("pair", ["joined", "not_joined"]),
        ("pair", ["erp_created", "erp_not_created"])]),
]
REG_CARDS = [k for k, c in CARDS.items() if not c.get("kind")]
# Pipeline chips in the candidate detail: the board's cards, not the cumulative funnel.
MILESTONE_CARDS = [k for k in REG_CARDS if not CARDS[k].get("funnel")]


def _q(v):
    return frappe.db.escape(v)


class _Cond:
    """One card's SQL condition for one programme: its Application Status list (None = n/a there)."""

    def __init__(self, pg):
        self.pg = pg
        self.params = {}
        self.n = 0

    def card(self, key):
        statuses = STATUS.get(key, {}).get(self.pg.key)
        if not statuses:
            return None
        self.n += 1
        name = f"{self.pg.pfx}s{self.n}"
        self.params[name] = tuple(statuses)
        return f"IFNULL({self.pg.st}, '') IN %({name})s"


# ── helpers ────────────────────────────────────────────────────────────────

def _list(value):
    """Client filter → clean list of strings (anything else dropped)."""
    if not value:
        return []
    if isinstance(value, str):
        try:
            value = frappe.parse_json(value)
        except Exception:
            return []
    if not isinstance(value, (list, tuple)):
        return []
    return [str(v).strip() for v in value if isinstance(v, (str, int)) and str(v).strip()][:500]


def _can_read(doctype):
    return bool(doctype) and frappe.db.exists("DocType", doctype) and frappe.has_permission(doctype, "read")


def _scoped(doctype, fields, filters=None):
    """
    The user's permission-scoped SELECT for `doctype` as SQL text, to be used
    as a derived table. `filters` must only ever contain server-built values
    — client strings go in as bound parameters outside.
    """
    meta = frappe.get_meta(doctype)
    fields = list(dict.fromkeys(f for f in fields
                                if f and (f in ("name", "creation", "modified", "owner") or meta.has_field(f))))
    q = frappe.get_list(doctype, fields=fields, filters=filters or [], order_by=None,
                        limit_page_length=0, run=0)
    return str(q), set(fields)


def _col(alias, field, present):
    """`alias`.`field` if the derived table has it, else NULL."""
    return f"{alias}.`{field}`" if field and field in present else "NULL"


FILTER_KEYS = ("roles", "units", "subunits", "locations", "job_codes")


def _parse_filters(programs=None, from_date=None, to_date=None, stages=None, **lists):
    f = frappe._dict(
        programs=[p for p in _list(programs) if p in PROGRAM_KEYS] or PROGRAM_KEYS,
        stages=[s for s in _list(stages) if s in STAGES],
        fd=str(getdate(from_date)) if from_date else None,
        td=str(getdate(to_date)) if to_date else None,
    )
    for k in FILTER_KEYS:
        f[k] = _list(lists.get(k))
    return f


class _Prog:
    """One programme, scoped to this user + the active filters."""

    def __init__(self, cfg, f, idx=0):
        self.cfg = cfg
        self.f = f
        # Every bound parameter is prefixed per programme, so several
        # programmes can share one UNION ALL query.
        self.pfx = f"p{idx}_"
        self.one_status = None
        self.card_key = None
        self.panel_from = self.panel_to = None
        self.pipe = None                  # "open" / "ended" (Timeline tab)
        self.dmin = self.dmax = None      # days-in-pipeline range (Timeline tab)
        self.key = cfg["key"]
        self.stages = f.stages
        fields = ["name", "creation", "modified", cfg["title"], cfg["email"], cfg["phone"], cfg["status"],
                  cfg["role"], cfg["unit"], cfg["subunit"], cfg["location"], cfg["job_code"], cfg["app_date"]]
        fields += cfg.get("round_dates") or []
        fields += [cfg.get("gender"), cfg.get("source")]   # offer update charts
        self.reg_sql, self.reg_fields = _scoped(cfg["reg"], fields)
        self.st = _col("r", cfg["status"], self.reg_fields)
        self.rl = _col("r", cfg["role"], self.reg_fields)
        # Application date: the form's own date where captured, else created on.
        ad = _col("r", cfg["app_date"], self.reg_fields)
        self.adate = f"DATE(COALESCE({ad}, r.creation))" if ad != "NULL" else "DATE(r.creation)"
        self.allowed_statuses = None  # set by status_counts() when a stage filter is on

    # WHERE on the registration derived table `r`, parameterised.
    def where(self, include_stage=True):
        pf, f = self.pfx, self.f
        conds, params = ["1=1"], {}
        if f.fd:
            conds.append(f"{self.adate} >= %({pf}fd)s")
            params[f"{pf}fd"] = f.fd
        if f.td:
            conds.append(f"{self.adate} <= %({pf}td)s")
            params[f"{pf}td"] = f.td
        for fkey, cfg_key in (("roles", "role"), ("units", "unit"), ("subunits", "subunit"),
                              ("locations", "location"), ("job_codes", "job_code")):
            vals = f[fkey]
            if not vals:
                continue
            col = _col("r", self.cfg[cfg_key], self.reg_fields)
            if col == "NULL":
                conds.append("1=0")
            else:
                conds.append(f"{col} IN %({pf}{fkey})s")
                params[f"{pf}{fkey}"] = tuple(vals)
        if include_stage and self.stages:
            sts = self.allowed_statuses or []
            if not sts:
                conds.append("1=0")
            else:
                conds.append(f"IFNULL({self.st}, '') IN %({pf}sts)s")
                params[f"{pf}sts"] = tuple(sts)
        if include_stage and self.one_status is not None:
            conds.append(f"IFNULL({self.st}, '') = %({pf}one)s")
            params[f"{pf}one"] = self.one_status
        if include_stage and self.card_key:
            cb = _Cond(self)
            cond = cb.card(self.card_key)
            conds.append(cond or "1=0")
            params.update(cb.params)
        if include_stage and (self.pipe or self.dmin is not None or self.dmax is not None):
            days, ended, pp = self.pipeline()
            params.update(pp)
            if self.pipe == "open":
                conds.append(f"NOT {ended}")
            elif self.pipe == "ended":
                conds.append(ended)
            if self.dmin is not None:
                conds.append(f"{days} >= %({pf}dmin)s")
                params[f"{pf}dmin"] = self.dmin
            if self.dmax is not None:
                conds.append(f"{days} <= %({pf}dmax)s")
                params[f"{pf}dmax"] = self.dmax
        return " AND ".join(conds), params

    def pipeline(self):
        """
        (days_expr, ended_expr, params) for "days in pipeline".
        Ended = the journey is over: not selected (same rule as _stage) or
        joined. Days run from the application date to today, or — once
        ended — to the day the registration was last updated.
        """
        pf = self.pfx
        s = f"LOWER(IFNULL({self.st}, ''))"
        ended = (f"({s} IN %({pf}endset)s OR {s} LIKE %({pf}e1)s OR {s} LIKE %({pf}e2)s "
                 f"OR {s} LIKE %({pf}e3)s OR {s} LIKE %({pf}e4)s)")
        mod = _col("r", "modified", self.reg_fields)
        end_day = f"DATE({mod if mod != 'NULL' else 'r.creation'})"
        days = f"GREATEST(0, DATEDIFF(IF({ended}, {end_day}, %({pf}today)s), {self.adate}))"
        joined = {v.lower() for v in STATUS["reach_joined"].get(self.key, [])}
        return days, ended, {
            f"{pf}endset": tuple(sorted(_CLOSED | joined)),
            f"{pf}e1": "%reject%", f"{pf}e2": "%regret%", f"{pf}e3": "%no show%", f"{pf}e4": "%no-show%",
            f"{pf}today": str(getdate(nowdate())),
        }

    def status_counts(self):
        w, p = self.where(include_stage=False)
        rows = frappe.db.sql(
            f"SELECT IFNULL({self.st}, '') AS s, COUNT(*) AS n FROM ({self.reg_sql}) r WHERE {w} GROUP BY s",
            p, as_dict=True)
        if self.stages:
            self.allowed_statuses = [r.s for r in rows if _stage(r.s) in self.stages]
            rows = [r for r in rows if _stage(r.s) in self.stages]
        return rows

    # Application forms (linked) — distinct applicants in scope.
    def app_sql(self):
        app = self.cfg["app"]
        if not app or not _can_read(app[0]):
            return None
        sql, _ = _scoped(app[0], ["name", "creation", app[1]])
        return sql, app[1]

    def interview_sql(self):
        dt = self.cfg["interview"]
        if not _can_read(dt):
            return None, set()
        return _scoped(dt, ["name", "creation", "application_id", "applicants_name", "interview_date",
                            "start_time", "interview_round", self.cfg["mode"], "interviewer_name",
                            "is_cancelled", "role"])

    def feedback_union(self):
        """UNION ALL of every readable feedback form → (dt, name, applicant_id, creation, result, by_)."""
        parts = []
        for dt in self.cfg["feedback"]:
            if not _can_read(dt):
                continue
            meta = frappe.get_meta(dt)
            if not meta.has_field("applicant_id"):
                continue
            res = next((f for f in _RESULT_FIELDS if meta.has_field(f)), None)
            by = next((f for f in _BY_FIELDS if meta.has_field(f)), None)
            sql, present = _scoped(dt, ["name", "creation", "owner", "applicant_id", res, by])
            parts.append(
                f"SELECT {_q(dt)} AS dt, x.name, x.applicant_id, x.creation, "
                f"{_col('x', res, present)} AS result, IFNULL({_col('x', by, present)}, x.owner) AS by_ "
                f"FROM ({sql}) x")
        return " UNION ALL ".join(parts) if parts else None

    def last_feedback_join(self, fb_union):
        return (f" LEFT JOIN (SELECT u.applicant_id, MAX(DATE(u.creation)) last_fb FROM ({fb_union}) u "
                f"GROUP BY u.applicant_id) f ON f.applicant_id = i.application_id")


def _progs(f):
    out = []
    for cfg in PROGRAMS:
        if cfg["key"] in f.programs and _can_read(cfg["reg"]):
            out.append(_Prog(cfg, f, idx=len(out)))
    return out


# ── summary ────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_dashboard_data(programs=None, from_date=None, to_date=None, stages=None, refresh=0, **kw):
    f = _parse_filters(programs, from_date, to_date, stages, **{k: kw.get(k) for k in FILTER_KEYS})
    key = "pathways_overall:v5:" + hashlib.sha1(
        frappe.as_json([frappe.session.user, f]).encode()).hexdigest()
    if not cint(refresh):
        hit = frappe.cache.get_value(key)
        if hit:
            return hit

    today = getdate(nowdate())
    in7 = add_days(today, 7)
    funnel, status_rows, trend = [], [], {}
    cards = {k: None for k in CARDS}
    by_unit = {k: {} for k in CARDS}   # card → programme → count (programmes where the card applies)
    cur = {"prog": None}

    def add(k, v):
        if v is None:
            return
        cards[k] = (cards[k] or 0) + cint(v)
        by_unit[k][cur["prog"]] = by_unit[k].get(cur["prog"], 0) + cint(v)

    progs = _progs(f)
    for pg in progs:
        cfg = pg.cfg
        cur["prog"] = pg.key
        counts = pg.status_counts()
        w, p = pg.where()
        stage_n = {s: 0 for s in STAGES}
        for r in counts:
            stage_n[_stage(r.s)] += r.n
            status_rows.append({"program": pg.key, "status": r.s or "(blank)", "raw": r.s,
                                "stage": _stage(r.s), "count": r.n})
        regs = sum(r.n for r in counts)

        # Every registration-based card = "people whose Application Status is
        # one of these", so its count is the sum of those statuses' counts
        # from the GROUP BY above (one quick pass) — no second scan of the
        # registrations. Keys are compared the way MariaDB compares them
        # (case-insensitive, trailing spaces ignored), so the numbers match
        # the old per-card SQL exactly.
        by_status = {}
        for r in counts:
            key = _status_key(r.s)
            by_status[key] = by_status.get(key, 0) + cint(r.n)
        for k in REG_CARDS:
            statuses = STATUS.get(k, {}).get(pg.key)
            if statuses:
                add(k, sum(by_status.get(x, 0) for x in {_status_key(v) for v in statuses}))

        # weekly registrations (by application date)
        for wk, n in frappe.db.sql(
                f"SELECT DATE_SUB({pg.adate}, INTERVAL WEEKDAY({pg.adate}) DAY) wk, COUNT(*) "
                f"FROM ({pg.reg_sql}) r WHERE {w} GROUP BY wk", p):
            trend[str(wk)] = trend.get(str(wk), 0) + n

        # application forms
        apps = None
        a = pg.app_sql()
        if a:
            apps = frappe.db.sql(
                f"SELECT COUNT(DISTINCT a.`{a[1]}`) FROM ({a[0]}) a JOIN ({pg.reg_sql}) r ON r.name = a.`{a[1]}` WHERE {w}",
                p)[0][0]

        # interviews + feedback
        iv = {"interviews": None, "interviewed": None, "upcoming": None, "cancelled": None, "pending": None}
        iv_sql, iv_f = pg.interview_sql()
        fb_union = pg.feedback_union()
        if iv_sql:
            canc = _col("i", "is_cancelled", iv_f)
            row = frappe.db.sql(
                f"""SELECT SUM(IFNULL({canc},0)=0), COUNT(DISTINCT IF(IFNULL({canc},0)=0, i.application_id, NULL)),
                        SUM(IFNULL({canc},0)=0 AND i.interview_date BETWEEN %(t)s AND %(t7)s),
                        SUM(IFNULL({canc},0)=1),
                        SUM(IFNULL({canc},0)=0 AND i.interview_date = %(t)s)
                    FROM ({iv_sql}) i JOIN ({pg.reg_sql}) r ON r.name = i.application_id WHERE {w}""",
                dict(p, t=today, t7=in7))[0]
            iv.update(interviews=cint(row[0]), interviewed=cint(row[1]), upcoming=cint(row[2]), cancelled=cint(row[3]))
            add("iv_next7", row[2] or 0)
            add("iv_today", row[4] or 0)

            if fb_union:
                held, pend, oldest, over2 = frappe.db.sql(
                    f"""SELECT COUNT(*),
                            SUM(f.last_fb IS NULL OR f.last_fb < i.interview_date),
                            MAX(IF(f.last_fb IS NULL OR f.last_fb < i.interview_date, DATEDIFF(%(t)s, i.interview_date), NULL)),
                            SUM((f.last_fb IS NULL OR f.last_fb < i.interview_date) AND DATEDIFF(%(t)s, i.interview_date) > 2)
                        FROM ({iv_sql}) i JOIN ({pg.reg_sql}) r ON r.name = i.application_id
                        {pg.last_feedback_join(fb_union)}
                        WHERE {w} AND IFNULL({canc},0)=0 AND i.interview_date < %(t)s""",
                    dict(p, t=today))[0]
                iv["pending"] = cint(pend)     # programme funnel column (forms-based)

        fb_n = fb_people = None
        if fb_union:
            fb_n, fb_people = frappe.db.sql(
                f"SELECT COUNT(*), COUNT(DISTINCT u.applicant_id) FROM ({fb_union}) u "
                f"JOIN ({pg.reg_sql}) r ON r.name = u.applicant_id WHERE {w}", p)[0]

        funnel.append({
            "program": pg.key,
            "registrations": regs,
            "applications": apps,
            "interviewed": iv["interviewed"],
            "interviews": iv["interviews"],
            "upcoming": iv["upcoming"],
            "cancelled": iv["cancelled"],
            "feedback": cint(fb_n) if fb_n is not None else None,
            "feedback_people": cint(fb_people) if fb_people is not None else None,
            "pending": iv["pending"],
            "stages": stage_n,
        })

    # all-time registrations (ignores every filter except programme + permissions)
    all_time = 0
    for cfg in PROGRAMS:
        if cfg["key"] in f.programs and _can_read(cfg["reg"]):
            sql, _ = _scoped(cfg["reg"], ["name"])
            all_time += frappe.db.sql(f"SELECT COUNT(*) FROM ({sql}) t")[0][0]

    status_rows.sort(key=lambda x: -x["count"])

    # hints that carry an extra, actionable number
    hints = {}

    board = []
    for gkey, title, items in BOARD:
        board.append({"key": gkey, "title": title, "items": [{
            "layout": layout,
            "cards": [{"key": k, "label": CARDS[k]["label"], "tone": CARDS[k]["tone"],
                       "kind": CARDS[k].get("kind") or "card", "date_label": CARDS[k].get("date_label") or "",
                       "desc": _card_desc(k),
                       "by_unit": [{"program": pg.key, "unit": pg.cfg["unit_label"], "value": by_unit[k][pg.key]}
                                   for pg in progs if pg.key in by_unit[k]],
                       "value": cards[k], "hint": hints.get(k) or CARDS[k].get("hint") or ""} for k in keys],
        } for layout, keys in items]})

    out = {
        "filters": {"programs": f.programs, "from_date": f.fd, "to_date": f.td, "stages": f.stages,
                    **{k: f[k] for k in FILTER_KEYS}},
        "programs_available": [c["key"] for c in PROGRAMS if _can_read(c["reg"])],
        "units_in_scope": [{"program": pg.key, "unit": pg.cfg["unit_label"]} for pg in progs],
        "options": _cached_filter_options(f.programs),
        "stages": STAGES,
        "board": board,
        "funnel_cards": [{"key": k, "label": CARDS[k]["label"], "tone": CARDS[k]["tone"], "desc": _card_desc(k),
                          "value": cards[k],
                          "by_unit": [{"program": pg.key, "unit": pg.cfg["unit_label"], "value": by_unit[k][pg.key]}
                                      for pg in progs if pg.key in by_unit[k]]} for k in FUNNEL_CARDS],
        "funnel": funnel,
        "status_rows": status_rows,
        "trend": sorted(trend.items()),
        "has_status_log": any(c.get("status_log") and c["key"] in f.programs and _can_read(c["reg"])
                              for c in PROGRAMS),
        "all_time_registrations": all_time,
        "generated_at": frappe.utils.now(),
    }
    frappe.cache.set_value(key, out, expires_in_sec=CACHE_SECONDS)
    return out


OPTIONS_CACHE_SECONDS = 600


def _cached_filter_options(programs):
    """_filter_options() cached per user + programmes for 10 minutes (Refresh bypasses the card cache, not this)."""
    key = "pathways_overall:opts:v1:" + hashlib.sha1(
        frappe.as_json([frappe.session.user, sorted(programs)]).encode()).hexdigest()
    hit = frappe.cache.get_value(key)
    if hit:
        return hit
    out = _filter_options(programs)
    frappe.cache.set_value(key, out, expires_in_sec=OPTIONS_CACHE_SECONDS)
    return out


def _filter_options(programs):
    """
    Filter choices from the data the user can see. `combos` lets the page
    narrow Sub-units and Job codes to the chosen Units (cascade options).
    """
    roles, locations, combos = set(), set(), set()
    for cfg in PROGRAMS:
        if cfg["key"] not in programs or not _can_read(cfg["reg"]):
            continue
        sql, present = _scoped(cfg["reg"], ["name", cfg["role"], cfg["location"], cfg["unit"],
                                            cfg["subunit"], cfg["job_code"]])
        role, loc = _col("t", cfg["role"], present), _col("t", cfg["location"], present)
        unit, sub, jc = (_col("t", cfg["unit"], present), _col("t", cfg["subunit"], present),
                         _col("t", cfg["job_code"], present))
        if role != "NULL":
            roles.update(v for (v,) in frappe.db.sql(f"SELECT DISTINCT {role} FROM ({sql}) t") if v)
        if loc != "NULL":
            locations.update(v for (v,) in frappe.db.sql(f"SELECT DISTINCT {loc} FROM ({sql}) t") if v)
        for u, s, j in frappe.db.sql(f"SELECT DISTINCT {unit}, {sub}, {jc} FROM ({sql}) t"):
            combos.add((u or "", s or "", j or ""))
    return {
        "roles": sorted(roles),
        "locations": sorted(locations),
        "units": sorted({u for u, _, _ in combos if u}),
        "combos": sorted(combos),
    }


# ── drilldowns: every row, paged / sorted / searched in SQL ───────────────
#
# No row cap: one UNION ALL across the programmes, ordered and paged by the
# database, so page 1 and page 5,000 of a 10-lakh list both come back in
# well under a second and the browser only ever holds one page. The CSV
# export streams every matching row to a temp file (unbuffered cursor →
# O(1) memory) and sends that file.

DRILL_KINDS = ("registrations", "card", "applications", "interviews", "all_interviews", "upcoming", "today",
               "cancelled", "pending", "fb_done", "feedback", "status_log")
_IV_KINDS = ("interviews", "all_interviews", "upcoming", "today", "cancelled", "pending", "fb_done")
PAGE_SIZES = (50, 100, 250, 500, 1000)

_REG_COLS = ["program", "doctype", "id", "name", "email", "phone", "role", "subunit", "location", "job_code",
             "status", "created", "key_date", "pending_since", "since_src", "days"]
_APP_COLS = _REG_COLS + ["form", "form_doctype", "form_date"]
# Only these cards fill pending_since / since_src / days (see _pending_since).
_PENDING_CARDS = ("fb_pending",)
_IV_COLS = ["program", "doctype", "interview", "id", "name", "date", "time", "round", "mode", "interviewer",
            "days", "cancelled", "status"]
_FB_COLS = ["program", "doctype", "feedback", "id", "name", "submitted_on", "result", "by_", "status"]
_LOG_COLS = ["program", "id", "name", "changed_on", "previous_status", "new_status", "changed_by", "reason",
             "status"]

# Default order per kind: (column, direction).
_DEFAULT_SORT = {
    "registrations": ("created", "desc"), "card": ("created", "desc"), "applications": ("form_date", "desc"),
    "interviews": ("date", "desc"), "all_interviews": ("date", "desc"), "upcoming": ("date", "asc"), "today": ("time", "asc"),
    "cancelled": ("date", "desc"), "pending": ("days", "desc"), "fb_done": ("date", "desc"),
    "feedback": ("submitted_on", "desc"), "status_log": ("changed_on", "desc"),
}
# Card drilldowns that open on a different default order (longest-waiting first).
_CARD_SORT = {"fb_pending": ("days", "desc")}


def _pending_since(pg, today, params):
    """
    For a "pending" card: (since_expr, source_expr, extra_join, params) —
    when the applicant started waiting, and what that date is based on.
    First one present wins:
      1. Interview  — their latest interview held so far (not cancelled);
      2. Round date — the form's own latest round date (Field only);
      3. Last updated — when the registration was last changed (always set).
    """
    pf = pg.pfx
    params = dict(params, **{f"{pf}t": today})
    cands, join = [], ""
    iv_sql, iv_f = pg.interview_sql()
    if iv_sql:
        canc = _col("i", "is_cancelled", iv_f)
        join = (f" LEFT JOIN (SELECT i.application_id, MAX(i.interview_date) d FROM ({iv_sql}) i "
                f"WHERE IFNULL({canc},0)=0 AND i.interview_date <= %({pf}t)s GROUP BY i.application_id) piv "
                f"ON piv.application_id = r.name")
        cands.append(("piv.d", "Interview"))
    rd = [x for x in (_col("r", f, pg.reg_fields) for f in pg.cfg.get("round_dates") or []) if x != "NULL"]
    if rd:
        cands.append((f"DATE(COALESCE({', '.join(rd)}))", "Round date"))
    mod = _col("r", "modified", pg.reg_fields)
    cands.append((f"DATE({mod if mod != 'NULL' else 'r.creation'})", "Last updated"))
    since = f"COALESCE({', '.join(e for e, _ in cands)})"
    src = "CASE " + " ".join(f"WHEN {e} IS NOT NULL THEN {_q(s)}" for e, s in cands[:-1]) + f" ELSE {_q(cands[-1][1])} END"
    return since, src, join, params


def _kind_cols(kind):
    if kind in ("registrations", "card"):
        return _REG_COLS
    if kind == "applications":
        return _APP_COLS
    if kind == "feedback":
        return _FB_COLS
    if kind == "status_log":
        return _LOG_COLS
    return _IV_COLS


def _drill_parts(kind, pg, today, card=None):
    """
    This programme's part of the union: (select_list, from_where, params),
    columns in _kind_cols(kind) order, or None when it doesn't apply.
    """
    cfg = pg.cfg
    w, p = pg.where()
    prog = _q(pg.key)
    c = lambda fld: _col("r", fld, pg.reg_fields)  # noqa: E731
    key_date = c((CARDS.get(card) or {}).get("date_field")) if card else "NULL"
    since, src, days, pjoin = "NULL", "NULL", "NULL", ""
    if kind == "card" and card in _PENDING_CARDS:
        since, src, pjoin, p = _pending_since(pg, today, p)
        days = f"DATEDIFF(%({pg.pfx}t)s, {since})"
    elif kind == "registrations":
        # the registrations list's "days" = days in pipeline (Timeline tab column)
        days, _, pp = pg.pipeline()
        p = dict(p, **pp)
    reg_cols = (f"{prog} AS program, {_q(cfg['reg'])} AS doctype, r.name AS id, "
                f"IFNULL(NULLIF(TRIM({c(cfg['title'])}), ''), r.name) AS name, "
                f"{c(cfg['email'])} AS email, {c(cfg['phone'])} AS phone, {pg.rl} AS role, "
                f"{c(cfg['subunit'])} AS subunit, {c(cfg['location'])} AS location, {c(cfg['job_code'])} AS job_code, "
                f"{pg.st} AS status, {pg.adate} AS created, {key_date} AS key_date, "
                f"{since} AS pending_since, {src} AS since_src, {days} AS days")

    if kind in ("registrations", "card"):
        return reg_cols, f"FROM ({pg.reg_sql}) r{pjoin} WHERE {w}", p

    if kind == "applications":
        a = pg.app_sql()
        if not a:
            return None
        return (f"{reg_cols}, a.name AS form, {_q(cfg['app'][0])} AS form_doctype, a.creation AS form_date",
                f"FROM ({a[0]}) a JOIN ({pg.reg_sql}) r ON r.name = a.`{a[1]}` WHERE {w}", p)

    if kind == "feedback":
        fb_union = pg.feedback_union()
        if not fb_union:
            return None
        return (f"{prog} AS program, u.dt AS doctype, u.name AS feedback, u.applicant_id AS id, "
                f"IFNULL(NULLIF(TRIM({c(cfg['title'])}), ''), u.applicant_id) AS name, "
                f"u.creation AS submitted_on, u.result AS result, u.by_ AS by_, {pg.st} AS status",
                f"FROM ({fb_union}) u JOIN ({pg.reg_sql}) r ON r.name = u.applicant_id WHERE {w}"
                + _panel_dates(pg, "DATE(u.creation)", p), p)

    if kind == "status_log":
        log = cfg.get("status_log")
        if not log or not frappe.db.table_exists(log):
            return None
        # Child rows of registrations this user can read (joined to the scoped parent query).
        return (f"{prog} AS program, r.name AS id, IFNULL(NULLIF(TRIM({c(cfg['title'])}), ''), r.name) AS name, "
                f"l.changed_on AS changed_on, l.previous_status AS previous_status, "
                f"l.application_status AS new_status, l.changed_by AS changed_by, l.reason AS reason, "
                f"{pg.st} AS status",
                f"FROM `tab{log}` l JOIN ({pg.reg_sql}) r ON r.name = l.parent "
                f"WHERE l.parenttype = {_q(cfg['reg'])} AND {w}", p)

    iv_sql, iv_f = pg.interview_sql()
    if not iv_sql:
        return None
    canc = _col("i", "is_cancelled", iv_f)
    pf = pg.pfx
    join, days = "", "NULL"
    if kind == "interviews":
        extra = f" AND IFNULL({canc},0)=0"
    elif kind == "all_interviews":     # past, upcoming and cancelled
        extra = ""
    elif kind == "upcoming":
        extra = f" AND IFNULL({canc},0)=0 AND i.interview_date BETWEEN %({pf}t)s AND %({pf}t7)s"
    elif kind == "today":
        extra = f" AND IFNULL({canc},0)=0 AND i.interview_date = %({pf}t)s"
    elif kind == "cancelled":
        extra = f" AND IFNULL({canc},0)=1"
    else:  # pending / fb_done: interviews already held
        fb_union = pg.feedback_union()
        if not fb_union:
            return None
        join = pg.last_feedback_join(fb_union)
        no_fb = "(f.last_fb IS NULL OR f.last_fb < i.interview_date)"
        extra = (f" AND IFNULL({canc},0)=0 AND i.interview_date < %({pf}t)s AND "
                 f"{no_fb if kind == 'pending' else 'NOT ' + no_fb}")
        if kind == "pending":
            days = f"DATEDIFF(%({pf}t)s, i.interview_date)"
    p = dict(p, **{f"{pf}t": today, f"{pf}t7": add_days(today, 7)})
    extra += _panel_dates(pg, "i.interview_date", p)
    return (f"{prog} AS program, {_q(cfg['interview'])} AS doctype, i.name AS interview, "
            f"i.application_id AS id, IFNULL(NULLIF(TRIM(i.applicants_name), ''), i.application_id) AS name, "
            f"i.interview_date AS date, {_col('i', 'start_time', iv_f)} AS time, "
            f"{_col('i', 'interview_round', iv_f)} AS round, {_col('i', cfg['mode'], iv_f)} AS mode, "
            f"{_col('i', 'interviewer_name', iv_f)} AS interviewer, {days} AS days, "
            f"IF(IFNULL({canc},0)=1, 'Cancelled', '') AS cancelled, {pg.st} AS status",
            f"FROM ({iv_sql}) i JOIN ({pg.reg_sql}) r ON r.name = i.application_id{join} WHERE {w}{extra}", p)


def _panel_dates(pg, expr, params):
    """A table's own date range (interview date / feedback submitted date), bound as params."""
    sql = ""
    if pg.panel_from:
        sql += f" AND {expr} >= %({pg.pfx}pfrom)s"
        params[f"{pg.pfx}pfrom"] = pg.panel_from
    if pg.panel_to:
        sql += f" AND {expr} <= %({pg.pfx}pto)s"
        params[f"{pg.pfx}pto"] = pg.panel_to
    return sql


def _setup_progs(filters, stage=None, status=None, pipe=None, days_min=None, days_max=None):
    """
    The programmes in scope with every row-narrowing option applied: the
    page filters, plus one stage / one status / open-or-ended / a range of
    days in pipeline. All values are validated here and only ever bound
    as SQL parameters.
    """
    f = _parse_filters(**filters)
    if stage and stage in STAGES:
        f.stages = [s for s in f.stages if s == stage] if f.stages else [stage]
        if not f.stages:
            return f, []
    pipe = pipe if pipe in ("open", "ended") else None
    dmin = max(0, cint(days_min)) if days_min not in (None, "") else None
    dmax = max(0, cint(days_max)) if days_max not in (None, "") else None
    progs = _progs(f)
    for pg in progs:
        if pg.stages:
            pg.status_counts()
        if status is not None:
            pg.one_status = "" if status == "(blank)" else str(status)
        pg.pipe, pg.dmin, pg.dmax = pipe, dmin, dmax
    return f, progs


def _drill_setup(kind, filters, stage=None, status=None, card=None, date_from=None, date_to=None, own_dates=0,
                 pipe=None, days_min=None, days_max=None):
    if kind not in DRILL_KINDS:
        frappe.throw("Unknown drilldown")
    if cint(own_dates):
        # The Interviews / Feedback tables filter on their own date (interview
        # date / submitted date) instead of the application date.
        filters = dict(filters, from_date=None, to_date=None)
    panel_from = str(getdate(date_from)) if date_from else None
    panel_to = str(getdate(date_to)) if date_to else None
    if kind == "card":
        if card not in CARDS:
            frappe.throw("Unknown card")
        if CARDS[card].get("kind"):           # interview / feedback cards
            kind, card = CARDS[card]["kind"], None
    _, progs = _setup_progs(filters, stage, status, pipe, days_min, days_max)
    today = getdate(nowdate())
    parts = []
    for pg in progs:
        if kind == "card":
            pg.card_key = card
        pg.panel_from, pg.panel_to = panel_from, panel_to
        part = _drill_parts(kind, pg, today, card if kind == "card" else None)
        if part:
            parts.append(part)
    return kind, parts


# ── Timeline tab charts: days in pipeline ──────────────────────────────────

PIPE_BUCKETS = [(0, 7, "0–7 days"), (8, 15, "8–15 days"), (16, 30, "16–30 days"), (31, 60, "31–60 days"),
                (61, 90, "61–90 days"), (91, None, "90+ days")]


@frappe.whitelist()
def get_pipeline_stats(stage=None, status=None, pipe=None, days_min=None, days_max=None, **kw):
    """
    The Timeline tab's charts, for exactly the applicants its list shows
    (same permission-scoped query, same filters): how long people have been
    in the pipeline (buckets, still-open vs ended) and the average days per
    current stage. One grouped query per programme.
    """
    _, progs = _setup_progs(_filters_from(kw), stage, status, pipe, days_min, days_max)
    buckets = [{"label": lbl, "min": a, "max": b, "open": 0, "ended": 0} for a, b, lbl in PIPE_BUCKETS]
    stages = {s: {"stage": s, "count": 0, "days": 0} for s in STAGES}
    tot = {"open": 0, "ended": 0, "days": 0, "open_days": 0, "open_over30": 0}
    case = ("CASE " + " ".join(f"WHEN x.d <= {b} THEN {i}" for i, (_, b, _) in enumerate(PIPE_BUCKETS) if b is not None)
            + f" ELSE {len(PIPE_BUCKETS) - 1} END")
    for pg in progs:
        w, p = pg.where()
        days, ended, pp = pg.pipeline()
        rows = frappe.db.sql(
            f"""SELECT x.s, x.e, {case} AS b, COUNT(*) AS n, SUM(x.d) AS sd, SUM(x.d > 30) AS o30
                FROM (SELECT IFNULL({pg.st}, '') AS s, IF({ended}, 1, 0) AS e, {days} AS d
                      FROM ({pg.reg_sql}) r WHERE {w}) x
                GROUP BY x.s, x.e, b""", dict(p, **pp), as_dict=True)
        for r in rows:
            k = "ended" if cint(r.e) else "open"
            n, sd = cint(r.n), cint(r.sd)
            buckets[cint(r.b)][k] += n
            st = stages[_stage(r.s)]
            st["count"] += n
            st["days"] += sd
            tot[k] += n
            tot["days"] += sd
            if k == "open":
                tot["open_days"] += sd
                tot["open_over30"] += cint(r.o30)
    total = tot["open"] + tot["ended"]
    return {
        "buckets": buckets,
        "stages": [dict(s, avg=round(s["days"] / s["count"], 1) if s["count"] else None) for s in stages.values()],
        "total": total, "open": tot["open"], "ended": tot["ended"], "open_over30": tot["open_over30"],
        "avg_days": round(tot["days"] / total, 1) if total else None,
        "avg_open_days": round(tot["open_days"] / tot["open"], 1) if tot["open"] else None,
    }


def _search_where(kind, search):
    search = (search or "").strip()[:100]
    if not search:
        return "", {}
    cols = ", ".join(f"t.`{c}`" for c in _kind_cols(kind) if c not in ("doctype", "form_doctype", "days"))
    return f" WHERE CONCAT_WS(' ', {cols}) LIKE %(q)s", {"q": f"%{search}%"}


def _order(kind, sort_by, sort_dir, card=None):
    col, d = _CARD_SORT.get(card) if kind == "card" and card in _CARD_SORT else _DEFAULT_SORT[kind]
    if sort_by == "stage":
        sort_by = "status"
    if sort_by in _kind_cols(kind):
        col = sort_by
        d = "asc" if str(sort_dir).lower() == "asc" else "desc"
    tie = "id" if col != "id" else "name"
    return col, d, f"`{col}` {d.upper()}, `{tie}` {d.upper()}"


def _shape(kind, r):
    r = dict(r)
    r["stage"] = _stage(r.get("status"))
    for k in ("form_date", "submitted_on", "changed_on"):
        if r.get(k):
            r[k] = str(r[k])[:16]
    for k in ("created", "key_date", "date", "pending_since"):
        if k in r:
            r[k] = str(r[k] or "")[:10]
    if "time" in r:
        r["time"] = _hhmm(r["time"])
    if "by_" in r:
        r["by"] = r.pop("by_") or ""
    for k, v in r.items():
        if v is None:
            r[k] = ""
    return r


def _hhmm(t):
    """'9:00:00' / '09:00' / timedelta → '09:00' ('' when unset)."""
    parts = str(t or "").split(":")
    if len(parts) < 2 or not parts[0].strip().isdigit():
        return ""
    return f"{int(parts[0]):02d}:{parts[1][:2]}"


def _filters_from(kw):
    return {k: kw.get(k) for k in ("programs", "from_date", "to_date", "stages") + FILTER_KEYS}


# ── Timeline tab: offer update charts ──────────────────────────────────────

INDIA_STATES = [
    "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh",
    "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana",
    "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep",
    "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry",
    "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
    "West Bengal",
]
# Location values that name only a city (the Recruitment Location list) or a short form.
_CITY_STATE = {
    "bangalore": "Karnataka", "bengaluru": "Karnataka", "kalaburagi": "Karnataka", "yadgir": "Karnataka",
    "kolkata": "West Bengal", "pune": "Maharashtra", "mumbai": "Maharashtra", "nagpur": "Maharashtra",
    "bhubaneswar": "Odisha", "bhopal": "Madhya Pradesh", "indore": "Madhya Pradesh", "vadodara": "Gujarat",
    "ahmedabad": "Gujarat", "surat": "Gujarat", "jaipur": "Rajasthan", "udaipur": "Rajasthan",
    "lucknow": "Uttar Pradesh", "varanasi": "Uttar Pradesh", "hyderabad": "Telangana", "chennai": "Tamil Nadu",
    "coimbatore": "Tamil Nadu", "ranchi": "Jharkhand", "dhanbad": "Jharkhand", "jamshedpur": "Jharkhand",
    "kochi": "Kerala", "delhi ncr": "Delhi", "new delhi": "Delhi", "orissa": "Odisha", "pondicherry": "Puducherry",
}


def _state_of(location):
    """'Itki, Ranchi, Jharkhand, India' → 'Jharkhand'; 'Bangalore' → 'Karnataka'; '' → None."""
    text = (location or "").strip()
    if not text:
        return None
    low = text.lower()
    if "all states" in low:
        return "All states"
    hits = [(low.find(s.lower()), s) for s in INDIA_STATES if s.lower() in low]
    if hits:
        return min(hits)[1]   # the first state named (multi-state postings count once)
    for city, state in _CITY_STATE.items():
        if city in low:
            return state
    return "Other"


def _median(vals):
    vals = sorted(vals)
    n = len(vals)
    if not n:
        return None
    return float(vals[n // 2]) if n % 2 else (vals[n // 2 - 1] + vals[n // 2]) / 2


@frappe.whitelist()
def get_offer_stats(stage=None, status=None, pipe=None, days_min=None, days_max=None, **kw):
    """
    "Offer update" charts on the Timeline tab, for applicants who have been
    made an offer, within exactly the filters the Timeline list uses (same
    permission-scoped query): offers per unit, where each offer stands,
    gender, median days from application to offer, how they heard about
    the opening and the state of the posting location.
    """
    _, progs = _setup_progs(_filters_from(kw), stage, status, pipe, days_min, days_max)
    units, sources, states = [], {}, {}
    for pg in progs:
        cfg = pg.cfg
        offer_st = STATUS["reach_offer"].get(pg.key) or []
        row = {"program": pg.key, "unit": cfg["unit_label"], "offers": 0, "gender": {}, "median_days": None,
               "has_gender": bool(cfg.get("gender") and cfg["gender"] in pg.reg_fields),
               **{g: 0 for g, _, _ in OFFER_GROUPS}}
        units.append(row)
        if not offer_st:
            continue
        w, p = pg.where()
        p[f"{pg.pfx}offer"] = tuple(offer_st)
        g, src, loc = (_col("r", cfg.get(k), pg.reg_fields) for k in ("gender", "source", "location"))
        mod = _col("r", "modified", pg.reg_fields)
        recs = frappe.db.sql(
            f"""SELECT r.name, IFNULL({pg.st}, '') AS st, {pg.adate} AS ad, {g} AS g, {src} AS src, {loc} AS loc,
                    DATE({mod if mod != 'NULL' else 'r.creation'}) AS md
                FROM ({pg.reg_sql}) r WHERE {w} AND IFNULL({pg.st}, '') IN %({pg.pfx}offer)s""", p, as_dict=True)
        if not recs:
            continue

        # when each applicant first moved into an offer status (change history);
        # without a recorded change, the day the record was last updated
        offered_on = {}
        names = [r.name for r in recs]
        offer_set = set(offer_st)
        for i in range(0, len(names), 1000):
            for v in frappe.db.sql(
                    """SELECT docname, creation, data FROM `tabVersion`
                       WHERE ref_doctype = %(dt)s AND docname IN %(names)s AND data LIKE %(like)s
                       ORDER BY creation""",
                    {"dt": cfg["reg"], "names": tuple(names[i:i + 1000]), "like": f'%"{cfg["status"]}"%'},
                    as_dict=True):
                if v.docname in offered_on:
                    continue
                try:
                    changed = (frappe.parse_json(v.data) or {}).get("changed") or []
                except Exception:
                    continue
                if any(isinstance(c, (list, tuple)) and len(c) == 3 and c[0] == cfg["status"] and c[2] in offer_set
                       for c in changed):
                    offered_on[v.docname] = getdate(v.creation)

        days = []
        for r in recs:
            row["offers"] += 1
            for key, _, groups in OFFER_GROUPS:
                if r.st in (groups.get(pg.key) or []):
                    row[key] += 1
                    break
            if row["has_gender"]:
                gk = (r.g or "").strip().capitalize() or "Not given"
                gk = "Other" if gk in ("Others", "Other") else gk
                row["gender"][gk] = row["gender"].get(gk, 0) + 1
            s = (r.src or "").strip() or "Not given"
            sources[s] = sources.get(s, 0) + 1
            stt = _state_of(r.loc) or "Not given"
            states[stt] = states.get(stt, 0) + 1
            end = offered_on.get(r.name) or (getdate(r.md) if r.md else None)
            if end and r.ad:
                days.append(max(0, (end - getdate(r.ad)).days))
        row["median_days"] = _median(days)
        row["median_n"] = len(days)
        row["median_from_history"] = sum(1 for r in recs if r.name in offered_on)

    # sources: top 4 + everything else folded into "Other"
    ranked = sorted(sources.items(), key=lambda x: -x[1])
    top = [{"label": k, "n": n} for k, n in ranked[:4]]
    rest = sum(n for _, n in ranked[4:])
    if rest:
        top.append({"label": "Other", "n": rest, "parts": [{"label": k, "n": n} for k, n in ranked[4:12]]})
    return {
        "groups": [{"key": k, "label": lbl} for k, lbl, _ in OFFER_GROUPS],
        "units": units,
        "total": sum(u["offers"] for u in units),
        "sources": top,
        "states": sorted(({"state": k, "n": n} for k, n in states.items()), key=lambda x: -x["n"]),
    }


@frappe.whitelist()
def get_drilldown(kind, stage=None, status=None, card=None, page=1, page_size=100, sort_by=None,
                  sort_dir=None, search=None, date_from=None, date_to=None, own_dates=0,
                  pipe=None, days_min=None, days_max=None, **kw):
    """
    One page of the rows behind any card / table number — same scoped
    queries as the summary, no cap on how many rows exist.
    """
    kind, parts = _drill_setup(kind, _filters_from(kw), stage, status, card, date_from, date_to, own_dates,
                               pipe, days_min, days_max)
    page_size = cint(page_size) if cint(page_size) in PAGE_SIZES else 100
    page = max(1, cint(page) or 1)
    col, d, order = _order(kind, sort_by, sort_dir, card)
    if not parts:
        return {"rows": [], "total": 0, "page": 1, "page_size": page_size, "sort_by": col, "sort_dir": d,
                "kind": kind}

    params = {}
    for _, _, p in parts:
        params.update(p)
    sw, sp = _search_where(kind, search)
    params.update(sp)
    offset = (page - 1) * page_size

    def top_union(off):
        # Without a search each programme returns only its own top rows.
        return " UNION ALL ".join(
            f"(SELECT {sel} {frm} ORDER BY {order} LIMIT {off + page_size})" for sel, frm, _ in parts)

    if sw:
        union = " UNION ALL ".join(f"SELECT {sel} {frm}" for sel, frm, _ in parts)
        total = frappe.db.sql(f"SELECT COUNT(*) FROM ({union}) t{sw}", params)[0][0]
    else:
        total = sum(frappe.db.sql(f"SELECT COUNT(*) {frm}", p)[0][0] for _, frm, p in parts)
        union = top_union(offset)

    last_page = max(1, -(-total // page_size))
    if page > last_page:
        page, offset = last_page, (last_page - 1) * page_size
        if not sw:
            union = top_union(offset)
    rows = frappe.db.sql(f"SELECT * FROM ({union}) t{sw} ORDER BY {order} LIMIT {page_size} OFFSET {offset}",
                         params, as_dict=True)
    return {"rows": [_shape(kind, r) for r in rows], "total": total, "page": page,
            "page_size": page_size, "sort_by": col, "sort_dir": d, "kind": kind}


_CSV_HEADERS = {
    "program": "Programme", "doctype": "Form", "id": "Applicant ID", "name": "Applicant", "email": "Email",
    "phone": "Phone", "role": "Role", "subunit": "Sub-unit", "location": "Location", "job_code": "Job code",
    "status": "Status", "stage": "Stage", "created": "Applied on", "key_date": "Key date",
    "form": "Application form", "form_doctype": "Application form type", "form_date": "Form submitted",
    "interview": "Interview", "date": "Date", "time": "Time", "round": "Round", "mode": "Mode",
    "interviewer": "Interviewer", "days": "Days pending", "cancelled": "Cancelled", "feedback": "Feedback record",
    "submitted_on": "Submitted", "result": "Result", "by": "By", "changed_on": "Changed on",
    "previous_status": "From status", "new_status": "To status", "changed_by": "Changed by", "reason": "Reason",
}


@frappe.whitelist()
def export_drilldown_csv(kind, stage=None, status=None, card=None, sort_by=None, sort_dir=None, search=None,
                         title=None, date_from=None, date_to=None, own_dates=0,
                         pipe=None, days_min=None, days_max=None, **kw):
    """
    Every matching row (no cap) as CSV — same permission-scoped query as
    get_drilldown. Rows stream from an unbuffered cursor into a temp file,
    so memory stays flat even for 10 lakh rows.
    """
    import csv
    import io
    import re
    import tempfile

    from werkzeug.wrappers import Response
    from werkzeug.wsgi import wrap_file

    date_label = (CARDS.get(card) or {}).get("date_label") if kind == "card" else None
    kind, parts = _drill_setup(kind, _filters_from(kw), stage, status, card, date_from, date_to, own_dates,
                               pipe, days_min, days_max)
    _, _, order = _order(kind, sort_by, sort_dir)
    cols = [c for c in _kind_cols(kind) if c != "by_"] + (["by"] if kind == "feedback" else []) + ["stage"]
    if kind == "feedback":
        cols = [c for c in cols if c != "status"] + ["status"]
    if kind == "card" and not date_label:
        cols = [c for c in cols if c != "key_date"]
    if kind in ("registrations", "applications"):
        cols = [c for c in cols if c != "key_date"]
    if kind not in ("pending", "registrations"):
        cols = [c for c in cols if c != "days"]
    if kind != "all_interviews":
        cols = [c for c in cols if c != "cancelled"]
    if "id" in cols:  # Applicant ID first, as on screen
        cols = ["id"] + [c for c in cols if c != "id"]
    headers = {**_CSV_HEADERS, **({"key_date": date_label} if date_label else {}),
               **({"days": "Days in pipeline"} if kind == "registrations" else {})}

    def safe(v):
        v = "" if v is None else str(v)
        return "'" + v if v[:1] in ("=", "+", "-", "@") else v

    tmp = tempfile.TemporaryFile(mode="w+b")
    text = io.TextIOWrapper(tmp, encoding="utf-8-sig", newline="", write_through=True)
    writer = csv.writer(text)
    writer.writerow([headers.get(c, c) for c in cols])
    if parts:
        params = {}
        for _, _, p in parts:
            params.update(p)
        sw, sp = _search_where(kind, search)
        params.update(sp)
        union = " UNION ALL ".join(f"SELECT {sel} {frm}" for sel, frm, _ in parts)
        with frappe.db.unbuffered_cursor():
            for r in frappe.db.sql(f"SELECT * FROM ({union}) t{sw} ORDER BY {order}", params,
                                   as_dict=True, as_iterator=True):
                r = _shape(kind, r)
                writer.writerow([safe(r.get(c)) for c in cols])
    text.flush()
    text.detach()
    size = tmp.tell()
    tmp.seek(0)

    fname = re.sub(r"[^\w\-]+", "_", title or f"pathways_{kind}").strip("_")[:80] or "pathways_export"
    resp = Response(wrap_file(frappe.local.request.environ, tmp), mimetype="text/csv", direct_passthrough=True)
    resp.headers["Content-Disposition"] = f'attachment; filename="{fname}.csv"'
    resp.headers["Content-Length"] = str(size)
    return resp


# ── candidate detail (second-level drilldown) ──────────────────────────────

_PROFILE_TYPES = {"Data", "Select", "Date", "Datetime", "Int", "Float", "Link", "Phone", "Small Text", "Check"}
_PROFILE_SKIP = {"verification_code", "otp", "otp_expiry", "verify_email"}


def _candidate(program, name):
    """(cfg, doc) for one applicant — only when this user may read that exact record."""
    cfg = next((c for c in PROGRAMS if c["key"] == program), None)
    if not cfg or not name or not frappe.db.exists(cfg["reg"], name):
        frappe.throw("Applicant not found")
    if not frappe.has_permission(cfg["reg"], "read", doc=name):
        frappe.throw("Not permitted to view this applicant", frappe.PermissionError)
    return cfg, frappe.get_doc(cfg["reg"], name)


def _slug(dt):
    return frappe.scrub(dt).replace("_", "-")


@frappe.whitelist()
def get_candidate_detail(program, name):
    cfg, doc = _candidate(program, name)
    meta = frappe.get_meta(cfg["reg"])
    profile = []
    for df in meta.fields:
        if df.fieldtype not in _PROFILE_TYPES or df.hidden or df.fieldname in _PROFILE_SKIP:
            continue
        v = doc.get(df.fieldname)
        if v in (None, "", 0) or (df.fieldtype == "Check" and not cint(v)):
            continue
        if df.fieldtype == "Check":
            v = "Yes"
        elif df.fieldtype == "Date":
            v = frappe.utils.formatdate(v)
        profile.append({"label": (df.label or df.fieldname).strip(), "value": str(v)})

    slug = _slug

    forms = []
    if isinstance(cfg["app"], tuple) and _can_read(cfg["app"][0]):
        for a in frappe.get_list(cfg["app"][0], filters={cfg["app"][1]: name},
                                 fields=["name", "creation"], limit_page_length=20):
            forms.append({"doctype": cfg["app"][0], "name": a.name, "route": slug(cfg["app"][0]), "is_application": 1,
                          "date": str(a.creation)[:16]})
    for extra in cfg.get("extra_forms", []):
        if _can_read(extra) and frappe.get_meta(extra).has_field("applicant_id"):
            for a in frappe.get_list(extra, filters={"applicant_id": name}, fields=["name", "creation"],
                                     limit_page_length=20):
                forms.append({"doctype": extra, "name": a.name, "route": slug(extra), "date": str(a.creation)[:16]})

    interviews = []
    if _can_read(cfg["interview"]):
        im = frappe.get_meta(cfg["interview"])
        flds = [f for f in ["name", "interview_round", "interview_date", "start_time", cfg["mode"],
                            "interviewer_name", "is_cancelled"] if f == "name" or im.has_field(f)]
        for i in frappe.get_list(cfg["interview"], filters={"application_id": name}, fields=flds,
                                 order_by="interview_date asc, creation asc", limit_page_length=100):
            interviews.append({
                "name": i.name, "route": slug(cfg["interview"]), "round": i.get("interview_round") or "",
                "date": str(i.get("interview_date") or ""), "start": _hhmm(i.get("start_time")),
                "mode": i.get(cfg["mode"]) or "", "interviewer": i.get("interviewer_name") or "",
                "cancelled": cint(i.get("is_cancelled")),
            })

    feedback = []
    for dt in cfg["feedback"]:
        if not _can_read(dt) or not frappe.get_meta(dt).has_field("applicant_id"):
            continue
        for fname in frappe.get_list(dt, filters={"applicant_id": name}, pluck="name", limit_page_length=50):
            fdoc = frappe.get_doc(dt, fname)
            fm = frappe.get_meta(dt)
            res = next((fdoc.get(f) for f in _RESULT_FIELDS if fm.has_field(f) and fdoc.get(f)), "")
            by = next((fdoc.get(f) for f in _BY_FIELDS if fm.has_field(f) and fdoc.get(f)), None)
            feedback.append({
                "doctype": dt, "name": fname, "route": slug(dt), "submitted_on": str(fdoc.creation)[:16],
                "result": res or "", "by": by or frappe.utils.get_fullname(fdoc.owner),
                "sections": _render_feedback_doc(fdoc),
            })
    feedback.sort(key=lambda x: x["submitted_on"])

    # Status history (the parent's own child table — read permission checked above).
    history = []
    log_field = next((df.fieldname for df in meta.fields
                      if df.fieldtype == "Table" and df.options == cfg.get("status_log")), None)
    if log_field:
        for row in sorted(doc.get(log_field) or [], key=lambda x: str(x.get("changed_on") or "")):
            history.append({
                "on": str(row.get("changed_on") or "")[:16], "from": row.get("previous_status") or "",
                "to": row.get("application_status") or "", "by": row.get("changed_by") or "",
                "reason": row.get("reason") or "",
            })

    # Where this applicant is on the pipeline (the board's cards that match).
    milestones = _milestones(cfg, name)

    status = doc.get(cfg["status"]) or ""
    applied = any(f.get("is_application") for f in forms) if cfg["app"] else None
    return {
        "program": program, "id": name, "route": slug(cfg["reg"]),
        "name": doc.get(cfg["title"]) or name, "status": status, "stage": _stage(status),
        "applied": applied, "profile": profile, "forms": forms, "interviews": interviews, "feedback": feedback,
        "history": history, "milestones": milestones,
    }


# ── candidate timeline (the "Timeline" tab) ────────────────────────────────

_TL_MAX = 500  # events per source; far more than any one applicant has


def _tone_of_status(status):
    return {"Offer / Selected": "good", "Not selected": "bad", "On hold": "action"}.get(_stage(status), "info")


def _tone_of_result(result):
    s = (result or "").lower()
    if "reject" in s or "regret" in s or "not " in s:
        return "bad"
    if "hold" in s:
        return "action"
    if "select" in s or "recommend" in s or "shortlist" in s:
        return "good"
    return "info"


@frappe.whitelist()
def get_candidate_timeline(program, name):
    """
    Everything that happened to one applicant, oldest first: registration,
    forms submitted, every Application Status change (from the document's
    change history and the status log), interviews and feedback. Read
    permission on that exact registration is checked first; linked forms
    are only listed when the user can read their DocType.
    """
    cfg, doc = _candidate(program, name)
    events = []
    names = {}

    def who(user):
        if not user or user in ("Guest", "Administrator"):
            return ""
        if user not in names:
            names[user] = frappe.utils.get_fullname(user)
        return names[user]

    def add(at, kind, title, detail="", by="", tone="info", doctype=None, docname=None, date_only=False, **extra):
        """extra: old / new (status change), result (feedback, interview round) — shown as coloured pills."""
        if not at:
            return
        events.append({"at": str(at)[:10] if date_only else str(at)[:19], "date_only": int(date_only),
                       "kind": kind, "title": title, "detail": detail, "by": by, "tone": tone,
                       "route": _slug(doctype) if doctype else "", "doc": docname or "", **extra})

    # 1. registration — the application date where captured (imported records
    #    carry the real date there), else when the record was created
    app_date = doc.get(cfg["app_date"]) if cfg["app_date"] else None
    detail = " · ".join(str(v) for v in (doc.get(cfg["role"]), doc.get(cfg["location"]), doc.get(cfg["job_code"])
                                         if cfg["job_code"] else None) if v)
    if app_date and getdate(app_date) != getdate(doc.creation):
        add(app_date, "registered", "Registered", detail, tone="neutral", date_only=True)
        add(doc.creation, "registered", "Record created in the system", "", by=who(doc.owner), tone="neutral")
    else:
        add(doc.creation, "registered", "Registered", detail, by=who(doc.owner), tone="neutral")

    # 2. forms submitted
    forms = []
    if isinstance(cfg["app"], tuple):
        forms.append((cfg["app"][0], cfg["app"][1], "Application form submitted"))
    forms += [(dt, "applicant_id", f"{dt} submitted") for dt in cfg.get("extra_forms", [])]
    for dt, link, title in forms:
        if not _can_read(dt) or not frappe.get_meta(dt).has_field(link):
            continue
        for a in frappe.get_list(dt, filters={link: name}, fields=["name", "creation", "owner"],
                                 order_by="creation asc", limit_page_length=_TL_MAX):
            add(a.creation, "form", title, "", by=who(a.owner), doctype=dt, docname=a.name)

    # 3. Application Status changes. Two sources can record the SAME change:
    #    the status log child table (has the reason) and the document's own
    #    change history (track changes). A history entry with the same
    #    from → to within 15 minutes of a log row is that same change, so it
    #    is merged into the log row instead of being shown twice.
    status_field = cfg["status"]
    changes = []
    meta = frappe.get_meta(cfg["reg"])
    log_field = next((df.fieldname for df in meta.fields
                      if df.fieldtype == "Table" and df.options == cfg.get("status_log")), None)
    if log_field:
        for row in doc.get(log_field) or []:
            at = frappe.utils.get_datetime(row.get("changed_on")) if row.get("changed_on") else None
            if not at:
                continue
            by = row.get("changed_by") or ""
            changes.append({"at": at, "old": row.get("previous_status") or "", "new": row.get("application_status") or "",
                            "by": who(by) or by, "reason": row.get("reason") or "", "log": True})
    for v in frappe.get_all("Version", filters={"ref_doctype": cfg["reg"], "docname": name},
                            fields=["creation", "owner", "data"], order_by="creation asc", limit_page_length=_TL_MAX):
        try:
            changed = (frappe.parse_json(v.data) or {}).get("changed") or []
        except Exception:
            continue
        vt = frappe.utils.get_datetime(v.creation)
        for ch in changed:
            if not (isinstance(ch, (list, tuple)) and len(ch) == 3 and ch[0] == status_field):
                continue
            old, new = ch[1] or "", ch[2] or ""
            same = next((c for c in changes if c.get("log") and not c.get("merged") and c["old"] == old
                         and c["new"] == new and abs((c["at"] - vt).total_seconds()) <= 900), None)
            if same:
                same["merged"] = True
                same["by"] = same["by"] or who(v.owner)
                continue
            changes.append({"at": vt, "old": old, "new": new, "by": who(v.owner), "reason": ""})
    for c in changes:
        add(c["at"], "status", f"Status → {c['new'] or '(blank)'}", c["reason"], by=c["by"],
            tone=_tone_of_status(c["new"]), old=c["old"], new=c["new"], reason=c["reason"])

    # 4. interviews — at the interview's own date / time
    if _can_read(cfg["interview"]):
        im = frappe.get_meta(cfg["interview"])
        flds = [f for f in ["name", "creation", "owner", "interview_round", "interview_date", "start_time",
                            cfg["mode"], "interviewer_name", "is_cancelled"]
                if f in ("name", "creation", "owner") or im.has_field(f)]
        for i in frappe.get_list(cfg["interview"], filters={"application_id": name}, fields=flds,
                                 order_by="interview_date asc", limit_page_length=_TL_MAX):
            when = i.get("interview_date")
            t = _hhmm(i.get("start_time"))
            at = f"{when} {t}:00" if when and t else when
            cancelled = cint(i.get("is_cancelled"))
            scheduler = who(i.owner)
            detail = " · ".join(x for x in (
                i.get(cfg["mode"]) or "",
                f"Interviewer: {i.get('interviewer_name')}" if i.get("interviewer_name") else "",
                f"Scheduled {frappe.utils.formatdate(i.creation)}" + (f" by {scheduler}" if scheduler else "")) if x)
            add(at or i.creation, "interview",
                f"{'Cancelled: ' if cancelled else ''}{i.get('interview_round') or 'Interview'}", detail,
                by="", tone="neutral" if cancelled else "info", doctype=cfg["interview"],
                docname=i.name, date_only=bool(when and not t), cancelled=cancelled)

    # 5. feedback submitted
    for dt in cfg["feedback"]:
        if not _can_read(dt):
            continue
        fm = frappe.get_meta(dt)
        if not fm.has_field("applicant_id"):
            continue
        res_f = [f for f in _RESULT_FIELDS if fm.has_field(f)]
        by_f = [f for f in _BY_FIELDS if fm.has_field(f)]
        for fb in frappe.get_list(dt, filters={"applicant_id": name},
                                  fields=["name", "creation", "owner"] + res_f + by_f,
                                  order_by="creation asc", limit_page_length=_TL_MAX):
            res = next((fb.get(f) for f in res_f if fb.get(f)), "")
            by = next((fb.get(f) for f in by_f if fb.get(f)), None) or who(fb.owner)
            add(fb.creation, "feedback", f"Feedback: {res}" if res else "Feedback submitted", dt, by=by,
                tone=_tone_of_result(res), doctype=dt, docname=fb.name, result=res, form=dt)

    # Registration always opens the journey, then everything by date / time
    # (an interview time entered as e.g. 01:15 on the registration day
    # would otherwise show before the registration).
    events.sort(key=lambda e: (0 if e["kind"] == "registered" and e["title"] == "Registered" else 1, e["at"]))
    status = doc.get(status_field) or ""
    return {
        "program": program, "id": name, "route": _slug(cfg["reg"]), "unit": cfg["unit_label"],
        "name": doc.get(cfg["title"]) or name, "status": status, "stage": _stage(status),
        "ended": status in STATUS["reach_joined"].get(program, []) or _stage(status) == "Not selected",
        "events": events, "now": frappe.utils.now()[:19],
        # the top-row funnel steps, and which of them this applicant reached
        "steps": [{"key": k, "label": CARDS[k]["label"]} for k in FUNNEL_CARDS],
        "reached": [k for k in FUNNEL_CARDS if status in STATUS[k].get(program, [])],
    }


def _milestones(cfg, name):
    """Board cards this one (already permission-checked) applicant is on — one query."""
    pg = _Prog(cfg, _parse_filters(programs=frappe.as_json([cfg["key"]])))
    cb = _Cond(pg)
    exprs = [(k, cb.card(k)) for k in MILESTONE_CARDS]
    exprs = [(k, c) for k, c in exprs if c]
    if not exprs:
        return []
    row = frappe.db.sql(
        f"SELECT {', '.join(f'({c}) AS `{k}`' for k, c in exprs)} FROM ({pg.reg_sql}) r WHERE r.name = %(nm)s",
        dict(cb.params, nm=name), as_dict=True)
    if not row:
        return []
    return [CARDS[k]["label"] for k, _ in exprs if cint(row[0].get(k))]
