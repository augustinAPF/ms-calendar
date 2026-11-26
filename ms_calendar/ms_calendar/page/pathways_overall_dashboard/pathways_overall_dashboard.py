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
        # Only these roles see this unit on the dashboard (see _can_prog).
        "roles": ["Field Recruiter"],
        "title": "full_name_aadhaar", "email": "email_address", "phone": "phone_number",
        "role": "role", "status": "application_status",
        "unit": "units", "subunit": "department", "location": "location", "job_code": "job_code",
        "jo_link": "job_title",   # Link → Job Opening (Job Opening filter)
        "app_date": "application_date",
        # Latest round first — the first one filled is when the current round started.
        "round_dates": ["date_of_final_round", "date_of_functional_round", "date_of_recruiter_round"],
        "app": ("Field Application Form", "applicant_id"),
        "gender": "gender", "source": "opportunity",
        # Analytics tab dimensions (None / missing = the form doesn't capture it).
        "education": "highest_education", "home_state": "native_state", "dob": "dob", "age": "age",
        "referrer": "employee_referral", "decline_reason": "reason_decline", "reject_reason": "reasons_for_reject",
        "interview": "Field Interview Schedule", "mode": "interview_mode",
        "feedback": sorted({d for dts in FIELD_FEEDBACK_ROUND_MAP.values() for d in dts}),
        "extra_forms": ["Field Self Declaration", "Field MeritTrac Test Result"],
        "status_log": "Field Application Status Log",
    },
    {
        "key": "Health", "unit_label": "Health",
        "reg": "Health Registration Form",
        "roles": ["Health Recruiter"],
        "title": "full_name", "email": "email_address", "phone": "phone_number",
        "role": "role", "status": "application_status",
        "unit": "unit", "subunit": "department", "location": "location", "job_code": "job_code",
        "app_date": None,
        "app": None,
        "gender": "gender", "source": "opportunity",
        "education": "education_qualification", "home_state": "state__union_territory", "dob": "date_of_birth",
        "age": "age", "reject_reason": "reasons_for_reject",
        "interview": "Health Interview Schedule", "mode": "interview_type",
        "feedback": list(MBBS_FEEDBACK_ROUND_DOCTYPES),
        "extra_forms": ["Health Document Collection"],
    },
    {
        "key": "Philanthropy", "unit_label": "Grants",
        "reg": "Phil Registration Form",
        "roles": ["Philanthropy Recruiter"],
        "title": "name1", "email": "email", "phone": "phone",
        "role": "role", "status": "application_status",
        "unit": "unit", "subunit": None, "location": "location", "job_code": "job_code",
        "app_date": None,
        "app": None,
        "gender": None, "source": "source",
        "education": "highest_level_of_education", "dob": "date_of_birth", "age": "age",
        "interview": "Philanthropy Interview Schedule", "mode": "interview_mode",
        "feedback": ["Philanthrophy Feedback Form"],
        "extra_forms": ["Philanthrophy Document Collection"],
    },
    {
        "key": "Scholarship", "unit_label": "Azim Premji Scholarship",
        "reg": "Scholarship Recruitment Form",
        "roles": ["Scholarship Recruiter", "Scholarship CV Recruiter", "Scholarship Admin"],
        "title": "full_name_as_per_aadhar", "email": "email", "phone": "phone_number",
        "role": "role", "status": "application_status",
        "unit": "unit", "subunit": "department", "location": "location", "job_code": None,
        "app_date": None,
        "app": None,
        "gender": "gender", "source": "opportunity",
        "education": "highest_level_of_education", "home_state": "state_of_residence", "dob": "date_of_birth",
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
           "blocklist", "duplicated", "addendum declined", "not joined",
           # cloud check 2026-11-26: these end the journey too (Field / Health options)
           "application withdrawn", "offer revoked"}


# Select / Reject views (2026-11-24). Every applicant in the top card falls in
# exactly one step, so the steps add up to Total Select / Total Reject.
# Section "result" = the Select / Reject outcome of each round (CV, test,
# recruiter, functional = every round before the final round, final = leader
# rounds / calibration / final round), for every unit. Section "process" = the
# rest (still waiting for a result, later stages, hold, other).
# (key, card name, one-line explanation on the card, full meaning for the (i), section)
REJECT_GROUPS = [
    ("cv", "CV Reject", "Not shortlisted at CV screening",
     "Rejected / regretted at CV screening or application review.", "result"),
    ("test", "Test Reject", "Did not pass the written / online test",
     "Did not pass the written / online test.", "result"),
    ("recruiter", "Recruiter Round Reject", "Rejected in the recruiter round",
     "Rejected in the recruiter round (all units).", "result"),
    ("round1", "Functional Round Reject", "Rejected in a round before the final round",
     "Rejected in a round before the final round: Field functional / subject / education capacity / technical / "
     "demo round; Health R1; Philanthropy round 1; Scholarship round 1.", "result"),
    ("leader", "Final Round Reject", "Rejected in a leader / final round",
     "Rejected in the final rounds: Field leader rounds 1-3 and calibration; Health R2-R3; "
     "Philanthropy rounds 2-4 and final round; Scholarship round 2.", "result"),
    ("noshow", "No Show", "Did not attend the test or interview",
     "Did not turn up for the test or an interview.", "process"),
    ("docs", "Documents / Fitment Reject", "Failed documents or fitment",
     "Failed document verification or rejected at fitment.", "process"),
    ("offer", "Offer Declined", "Candidate declined the offer", "The candidate declined the offer.", "process"),
    ("joining", "Addendum Declined / Not Joined", "Declined the addendum or did not join",
     "Declined the addendum or did not join.", "process"),
    ("other", "Other Reject", "Not selected, duplicate or blocklisted",
     "Not selected, duplicate, blocklisted or any other closing status.", "process"),
]

SELECT_GROUPS = [
    ("cv_sel", "CV Shortlist", "Cleared CV screening, test not started",
     "Shortlisted at CV screening and not moved on yet.", "result"),
    ("test_sel", "Test Select", "Passed the test, next round not started",
     "Passed the written / online test and not moved on yet.", "result"),
    ("rec_sel", "Recruiter Round Select", "Cleared the recruiter round",
     "Selected in the recruiter round (all units), next round not started yet.", "result"),
    ("fun_sel", "Functional Round Select", "Cleared a round before the final round",
     "Selected in a round before the final round: Field functional / subject / education capacity / technical / "
     "demo round (and the same rounds of any other unit).", "result"),
    ("fin_sel", "Final Round Select", "Cleared a leader / final round",
     "Selected in the final rounds: Field leader rounds 1-3 and calibration; Philanthropy round 4 and final round.",
     "result"),
    ("test", "Test In Progress", "Test initiated or in process",
     "Test initiated / in process, or marks being corrected — no result yet.", "process"),
    ("recruiter", "In Recruiter Round", "Scheduled or in progress, no result yet",
     "In the recruiter round (scheduled or in progress), no result yet.", "process"),
    ("round1", "In Functional Round", "Before the final round, no result yet",
     "In a round before the final round, no result yet: Field functional / subject / education capacity / "
     "technical / demo; Health R1; Philanthropy / Scholarship round one.", "process"),
    ("leader", "In Final Round", "Leader / final round, no result yet",
     "In a final round, no result yet: Field leader rounds and calibration; Health R2-R3; Philanthropy rounds "
     "2-4 / final; Scholarship round two.", "process"),
    ("docs", "Documents & Fitment", "Documents collected or in fitment",
     "Document collection / verification passed, or in fitment.", "process"),
    ("comp", "Compensation", "Approved or waiting for approval", "Compensation approved or awaiting approval.",
     "process"),
    ("offer", "Offer Stage", "Offer sent, not sent yet or accepted", "Offer sent, not sent yet or accepted.",
     "process"),
    ("onboarding", "Onboarding", "Addendum, pre-joining or IT email",
     "Addendum accepted, pre-joining, or the IT email stage.", "process"),
    ("joined", "Joined", "Joined or ERP ID stage", "Joined, or the ERP ID stage.", "process"),
    ("hold", "On Hold", "Kept on hold at any step", "Kept on hold at any step.", "process"),
    ("other", "Other Open", "Talent pool, visit or other open status",
     "Any other open status (e.g. Talent Pool, Visit, PI Edited).", "process"),
]

_ROUND_LEADER = ("leader", "calibration", "final round", "r2", "r3", "round 2", "round 3", "round 4",
                 "round two", "round three", "round four", "round-2", "round-3")
_ROUND_ONE = ("functional", "subject", "education capacity", "technical", "demo", "r1", "round 1",
              "round one", "round-1", "interview")


def _select_group(status):
    """Which step an open (not rejected, not new) status belongs to (keyword rules, like _stage)."""
    s = (status or "").strip().lower()
    # Health says "Shortlist - CV / R1 / R2 / R3" for a Select result (cloud check 2026-11-26).
    sel = "select" in s or "shortlist" in s
    if "hold" in s:
        return "hold"
    if "cv" in s.split() or s.startswith("cv ") or "pre shortlist" in s:
        return "cv_sel"
    if "test" in s or "correction" in s:
        return "test_sel" if sel else "test"
    if "recruiter" in s:
        return "rec_sel" if sel else "recruiter"
    if "document" in s or "fitment" in s:
        return "docs"
    if "compensation" in s:
        return "comp"
    if any(k in s for k in ("addendum", "pre join", "pre-join", "it team", "it email")):
        return "onboarding"
    if s == "joined" or "erp id" in s:
        return "joined"
    if "offer" in s:
        return "offer"
    if any(k in s for k in _ROUND_LEADER):
        return "fin_sel" if sel else "leader"
    if any(k in s for k in _ROUND_ONE):
        return "fun_sel" if sel else "round1"
    return "other"


def _reject_group(status):
    """Which rejection step a "Not selected" status belongs to (keyword rules, like _stage)."""
    s = (status or "").strip().lower()
    if "no show" in s or "no-show" in s:
        return "noshow"
    if "cv" in s.split() or "- cv" in s or "application reject" in s or s.startswith("cv "):
        return "cv"
    if "test" in s:
        return "test"
    if "recruiter" in s:
        return "recruiter"
    if "document" in s or "fitment" in s:
        return "docs"
    if "offer" in s:
        return "offer"
    if "addendum" in s or "join" in s:
        return "joining"
    if any(k in s for k in _ROUND_LEADER):
        return "leader"
    if any(k in s for k in _ROUND_ONE):
        return "round1"
    return "other"


def _status_options(doctype, fieldname):
    """The Select options of a form's status field (as configured on this site)."""
    df = frappe.get_meta(doctype).get_field(fieldname)
    return [o.strip() for o in (df.options or "").split("\n") if o.strip()] if df else []


def _step_source(pg, key, classify, stages, seen):
    """One unit's row of the "How each card is counted" table for step `key`."""
    counts = dict(seen)
    have = {_status_key(x) for x in counts}
    for o in _status_options(pg.cfg["reg"], pg.cfg["status"]):
        if _stage(o) in stages and classify(o) == key and _status_key(o) not in have:
            counts[o] = 0
            have.add(_status_key(o))
    return {"program": pg.key, "unit": pg.cfg["unit_label"], "doctype": pg.cfg["reg"], "field": pg.cfg["status"],
            "statuses": sorted(counts.items(), key=lambda x: (-x[1], x[0]))}


# Step sets the top cards open: (steps, classifier, stages it covers).
STEP_SETS = {
    "reject": (REJECT_GROUPS, _reject_group, ("Not selected",)),
    "select": (SELECT_GROUPS, _select_group, ("In process", "On hold", "Offer / Selected")),
}


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
    "recruiter": {"Field": ["Recruiter Round", "Recruiter Round Scheduled", "Recruiter Round Select"], "Health": ["Recruiter Round"],
                  "Philanthropy": ["Recruiter Round"], "Scholarship": ["Recruiter Round"]},
    "functional": {
        "Field": ["Functional Round", "Functional Round Scheduled", "Functional Round Select", "Subject Round",
                  "Subject Round Scheduled", "Subject Round Select", "Education Capacity Round",
                  "Education Capacity Round Scheduled", "Education Capacity Select", "Technical Round",
                  "Technical Round Scheduled", "Technical Round Select", "Demo Round", "Demo Round Scheduled",
                  "Demo Round Select"],
        "Health": ["Shortlist - R1"], "Philanthropy": ["Round One"], "Scholarship": ["Round One"]},
    "leadership": {
        "Field": ["Leader Round-1", "Leader Round-1 Scheduled", "Leader Round-1 Select", "Leader Round-2",
                  "Leader Round-2 Scheduled", "Leader Round-2 Select", "Leader Round-3", "Leader Round-3 Scheduled",
                  "Leader Round-3 Select", "Calibration Process", "Calibration Process Scheduled", "Calibration Select"],
        "Health": ["Shortlist - R2", "Shortlist - R3"],
        "Philanthropy": ["Round Two", "Round Three", "Round Four", "Round 4 Select", "Final Round",
                         "Final Round Select"], "Scholarship": ["Round Two"]},
    # Feedback, from the status alone: still in a round (no result yet) = pending;
    # the round has a result (Select / Reject / Regret / On hold) = completed.
    "fb_pending": {
        "Field": ["Recruiter Round", "Education Capacity Round", "Subject Round", "Technical Round",
                  "Functional Round", "Demo Round", "Leader Round-1", "Leader Round-2", "Leader Round-3",
                  "Calibration Process", "Recruiter Round Scheduled", "Education Capacity Round Scheduled",
                  "Subject Round Scheduled", "Technical Round Scheduled", "Functional Round Scheduled",
                  "Demo Round Scheduled", "Leader Round-1 Scheduled", "Leader Round-2 Scheduled",
                  "Leader Round-3 Scheduled", "Calibration Process Scheduled"],
        "Health": ["Recruiter Round", "Shortlist - R1", "Shortlist - R2", "Shortlist - R3"],
        "Philanthropy": ["Recruiter Round", "Round One", "Round Two", "Round Three", "Round Four", "Final Round"],
        "Scholarship": ["Recruiter Round", "Round One", "Round Two"]},
    "fb_done": {
        "Field": ["Recruiter Round Select", "Recruiter Round Reject", "Education Capacity Select",
                  "Education Capacity Reject", "Subject Round Select", "Subject Round Reject",
                  "Technical Round Select", "Technical Round Reject", "Functional Round Select",
                  "Functional Round Reject", "Demo Round Select", "Demo Round Reject", "Leader Round-1 Select",
                  "Leader Round-1 Reject", "Leader Round-2 Select", "Leader Round-2 Reject",
                  "Leader Round-3 Select", "Leader Round-3 Reject", "Calibration Select", "Calibration Reject"],
        "Health": ["Regret - R1", "Regret - R2", "Regret - R3", "On hold - R1", "On hold - R2", "On hold - R3"],
        "Philanthropy": ["Recruiter Reject", "Round 1 Reject", "Round 2 Reject", "Round 3 Reject", "Round 4 Reject",
                         "Round 4 Select", "Final Round Select", "Final Round Reject"],
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
    "Philanthropy": ["Round 2 Reject", "Round 3 Reject", "Round 4 Reject", "Final Round Reject"],
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
# Top-row "Total Offer process" (2026-11-24): everyone in documents → offer →
# onboarding right now, not yet joined and not declined.
STATUS["offer_process"] = _statuses(
    "doc_collection", "fitment", "comp_approved", "comp_due", "offer_sent", "offer_not_sent", "offer_accepted",
    "addendum_accepted", "prejoin_done", "prejoin_pending", "it_sent", "it_not_sent")
TOP_CARDS = FUNNEL_CARDS + ["offer_process"]

# Top-row tally (2026-11-26): every applicant sits in exactly ONE of
# New / In process / Offer process / Joined / Reject, so the five cards add up
# to Total Applicants (100%). Offer process / Joined use the same status lists
# as the Offer process / Joined cards; "In process" is every other open status
# (screening done, test, interview rounds, on hold, …).
_TALLY_JOINED = {_status_key(x) for v in STATUS["reach_joined"].values() for x in v}
_TALLY_OFFER = {_status_key(x) for v in STATUS["offer_process"].values() for x in v} - _TALLY_JOINED


_SELECT_SECTION = {g[0]: g[4] for g in SELECT_GROUPS}


def _tally(status):
    st = _stage(status)
    if st == "New":
        return "new"
    if st == "Not selected":
        return "reject"
    k = _status_key(status)
    if k in _TALLY_JOINED:
        return "joined"
    if k in _TALLY_OFFER:
        return "offer"
    # Statuses on the offer path that a unit's STATUS lists don't name (e.g. Field
    # "Pre-join Form" / "Pre-join Pending") still belong to Offer process / Joined.
    g = _select_group(status)
    if g == "joined":
        return "joined"
    if g in ("docs", "comp", "onboarding", "offer"):
        return "offer"
    # Open, before the offer: "select" = cleared a round (a Select result), "process" = no result yet.
    return "select" if _SELECT_SECTION.get(_select_group(status)) == "result" else "process"


# Order of the top row (user, 2026-11-26): Total, New, Select, Reject, In Process, Offer Process, Joined.
TALLY_GROUPS = [
    ("new", "New Applicants", "awaiting CV screening", "Registered; nobody has screened the CV yet.", "result"),
    ("select", "Select", "cleared a round, next not started",
     "Selected at a round and not moved on yet: CV Shortlist, Test Select, Recruiter / Functional / Final Round Select.",
     "result"),
    ("reject", "Reject", "journey ended without selection",
     "Any Reject / Regret / No Show status, Not Selected, Offer declined, Not joined, Duplicated or Blocklisted.", "result"),
    ("process", "In Process", "in a round, no result yet",
     "In a test or interview round with no result yet, on hold, talent pool or another open status before the offer.",
     "result"),
    ("offer", "Offer Process", "documents → offer → onboarding",
     "Document collection, fitment, compensation, offer sent / accepted, addendum, pre-joining or IT email — not joined yet.",
     "result"),
    ("joined", "Joined", "joined or ERP ID stage", "Joined, or at the ERP ID stage.", "result"),
]
STEP_SETS["tally"] = (TALLY_GROUPS, _tally, tuple(STAGES))
# The Select and In Process cards open their steps: only the statuses the tally puts in that
# card (offer process / joined have their own cards), so the steps add up to the card.
_SEL_STAGES = STEP_SETS["select"][2]
STEP_SETS["select"] = ([g for g in SELECT_GROUPS if g[4] == "result"],
                       lambda st: _select_group(st) if _tally(st) == "select" else None, _SEL_STAGES)
STEP_SETS["process"] = ([g for g in SELECT_GROUPS if g[4] == "process"],
                        lambda st: _select_group(st) if _tally(st) == "process" else None, _SEL_STAGES)

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
    "offer_process": dict(label="Total Offer process", tone="info", funnel=True),
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
    "offer_process": "In the offer process right now: document collection, fitment, compensation, offer letter, "
                     "offer accepted, addendum, pre-joining or IT email. Not yet joined; declines are not counted.",
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


def _job_openings(names):
    """The chosen Job Openings (name, job_code, designation, unit, department), once per request."""
    key = tuple(sorted(set(names)))
    cache = getattr(frappe.local, "pod_job_openings", None)
    if cache is None:
        cache = frappe.local.pod_job_openings = {}
    if key not in cache:
        cache[key] = frappe.get_all("Job Opening", filters={"name": ["in", list(key)]},
                                    fields=["name", "job_code", "designation", "unit", "department"]) if key else []
    return cache[key]


def _can_read(doctype):
    return bool(doctype) and frappe.db.exists("DocType", doctype) and frappe.has_permission(doctype, "read")


# These roles see every unit; everyone else sees only the units in their
# programme's "roles" list (Field Recruiter → Field only). Read permission
# alone is not enough: Field / Health registrations are readable by Guest,
# so every logged-in user would otherwise see them.
SEE_ALL_ROLES = {"Administrator", "System Manager"}


def _can_prog(cfg):
    roles = set(frappe.get_roles())
    if not (roles & SEE_ALL_ROLES or roles & set(cfg.get("roles") or [])):
        return False
    return _can_read(cfg["reg"])


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


FILTER_KEYS = ("roles", "units", "subunits", "locations", "job_codes", "job_openings")
# Analytics dimensions a drilldown may narrow to (one value, e.g. source = LinkedIn).
DIMS = ("source", "gender", "education", "age_band", "referrer", "decline_reason", "reject_reason")


def _parse_filters(programs=None, from_date=None, to_date=None, stages=None, dim=None, dim_value=None, **lists):
    f = frappe._dict(
        programs=[p for p in _list(programs) if p in PROGRAM_KEYS] or PROGRAM_KEYS,
        stages=[s for s in _list(stages) if s in STAGES],
        fd=str(getdate(from_date)) if from_date else None,
        td=str(getdate(to_date)) if to_date else None,
        dim=dim if dim in DIMS else None,
    )
    f.dim_value = str(dim_value if dim_value is not None else "")[:200] if f.dim else None
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
        self.rej_statuses = None          # one step of the Select / Reject view
        self.card_key = None
        self.panel_from = self.panel_to = None
        self.pipe = None                  # "open" / "ended" (Timeline tab)
        self.dmin = self.dmax = None      # days-in-pipeline range (Timeline tab)
        self.hc_cond = None               # one Headcount Plan line (headcount.apply_hc): (sql, params)
        self.key = cfg["key"]
        self.stages = f.stages
        fields = ["name", "creation", "modified", cfg["title"], cfg["email"], cfg["phone"], cfg["status"],
                  cfg["role"], cfg["unit"], cfg["subunit"], cfg["location"], cfg["job_code"], cfg["app_date"]]
        fields += cfg.get("round_dates") or []
        fields += [cfg.get("gender"), cfg.get("source")]   # offer update charts
        fields += [cfg.get("jo_link")]                     # Job Opening filter
        fields += [cfg.get(k) for k in ("education", "home_state", "dob", "age", "referrer", "decline_reason",
                                        "reject_reason")]  # analytics tab
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
        if f.get("job_openings"):
            cond, jp = self.job_opening_cond(f.job_openings)
            conds.append(cond)
            params.update(jp)
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
        if self.hc_cond:
            # Applicants counted under one Headcount Plan line (department / role rule in headcount.py).
            conds.append(self.hc_cond[0])
            params.update(self.hc_cond[1])
        if f.get("dim"):
            # One analytics value (source / gender / …); a form that doesn't capture it has no rows.
            expr = self.dim_expr(f.dim)
            if expr is None:
                conds.append("1=0")
            else:
                conds.append(f"{expr} = %({pf}dimv)s")
                params[f"{pf}dimv"] = f.dim_value
        if include_stage and self.stages:
            sts = self.allowed_statuses or []
            if not sts:
                conds.append("1=0")
            else:
                conds.append(f"IFNULL({self.st}, '') IN %({pf}sts)s")
                params[f"{pf}sts"] = tuple(sts)
        if include_stage and self.rej_statuses is not None:
            if not self.rej_statuses:
                conds.append("1=0")
            else:
                conds.append(f"IFNULL({self.st}, '') IN %({pf}rej)s")
                params[f"{pf}rej"] = tuple(self.rej_statuses)
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

    def dim_expr(self, dim):
        """
        SQL for one analytics dimension on `r` ('' = not filled in), or None
        when this programme's form doesn't capture it. The Analytics tab
        groups by exactly this expression and drilldowns filter on it, so a
        bar and its list always agree.
        """
        if dim == "age_band":
            parts = []
            age = _col("r", self.cfg.get("age"), self.reg_fields)
            dob = _col("r", self.cfg.get("dob"), self.reg_fields)
            # Placeholder values (age 0, DOB 1900-01-01 or a future date) fall outside 18–75 → "not given".
            if age != "NULL":
                parts.append(f"IF(CAST({age} AS SIGNED) BETWEEN 18 AND 75, CAST({age} AS SIGNED), NULL)")
            if dob != "NULL":
                yrs = f"TIMESTAMPDIFF(YEAR, {dob}, {self.adate})"
                parts.append(f"IF({yrs} BETWEEN 18 AND 75, {yrs}, NULL)")
            if not parts:
                return None
            a = f"COALESCE({', '.join(parts)})" if len(parts) > 1 else parts[0]
            return (f"CASE WHEN {a} IS NULL THEN '' WHEN {a} < 25 THEN '18-24' WHEN {a} < 30 THEN '25-29' "
                    f"WHEN {a} < 35 THEN '30-34' WHEN {a} < 40 THEN '35-39' WHEN {a} < 50 THEN '40-49' ELSE '50+' END")
        col = _col("r", self.cfg.get(dim), self.reg_fields)
        if col == "NULL":
            return None
        if dim == "gender":
            return (f"CASE WHEN LOWER(TRIM({col})) IN ('other', 'others') THEN 'Other' "
                    f"WHEN LOWER(TRIM({col})) = 'male' THEN 'Male' WHEN LOWER(TRIM({col})) = 'female' THEN 'Female' "
                    f"ELSE IFNULL(TRIM({col}), '') END")
        return f"IFNULL(TRIM({col}), '')"

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

    def job_opening_cond(self, names):
        """
        Applicants of the chosen Job Openings, on this form (2026-11-24). A
        registration belongs to an opening when (1) its Job Opening link points
        at it (Field: job_title), or (2) its job code equals the opening's job
        code, or (3) on forms without that link, its role + unit (+ sub-unit
        when the opening has one) equal the opening's designation + unit.
        """
        pf, conds, params = self.pfx, [], {}
        jos = _job_openings(names)
        if not jos:
            return "1=0", {}
        link = _col("r", self.cfg.get("jo_link"), self.reg_fields)
        if link != "NULL":
            conds.append(f"{link} IN %({pf}jo)s")
            params[f"{pf}jo"] = tuple(j.name for j in jos)
        jc = _col("r", self.cfg["job_code"], self.reg_fields)
        codes = tuple(sorted({j.job_code.strip() for j in jos if (j.job_code or "").strip()}))
        if jc != "NULL" and codes:
            conds.append(f"{jc} IN %({pf}jojc)s")
            params[f"{pf}jojc"] = codes
        if link == "NULL":
            unit = _col("r", self.cfg["unit"], self.reg_fields)
            sub = _col("r", self.cfg["subunit"], self.reg_fields)
            for i, j in enumerate(jos):
                if not (j.designation and j.unit) or self.rl == "NULL" or unit == "NULL":
                    continue
                c = f"({self.rl} = %({pf}jor{i})s AND {unit} = %({pf}jou{i})s"
                params[f"{pf}jor{i}"], params[f"{pf}jou{i}"] = j.designation, j.unit
                if j.department and sub != "NULL":
                    c += f" AND {sub} = %({pf}jod{i})s"
                    params[f"{pf}jod{i}"] = j.department
                conds.append(c + ")")
        return ("(" + " OR ".join(conds) + ")" if conds else "1=0"), params

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
        if cfg["key"] in f.programs and _can_prog(cfg):
            out.append(_Prog(cfg, f, idx=len(out)))
    return out


# ── summary ────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_dashboard_data(programs=None, from_date=None, to_date=None, stages=None, refresh=0, **kw):
    f = _parse_filters(programs, from_date, to_date, stages, **{k: kw.get(k) for k in FILTER_KEYS})
    key = "pathways_overall:v15:" + hashlib.sha1(
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
        if cfg["key"] in f.programs and _can_prog(cfg):
            sql, _ = _scoped(cfg["reg"], ["name"])
            all_time += frappe.db.sql(f"SELECT COUNT(*) FROM ({sql}) t")[0][0]

    status_rows.sort(key=lambda x: -x["count"])

    # Select / Reject views: every applicant in exactly one step (adds up to the top card).
    step_groups = {}
    for set_key, (groups, classify, stages) in STEP_SETS.items():
        rg = {k: {"value": 0, "units": {}, "statuses": {}, "prog_st": {}} for k, *_ in groups}
        for r in status_rows:
            if r["stage"] not in stages:
                continue
            gk = classify(r["raw"])
            if gk is None:          # outside this set (e.g. offer process / joined for "select")
                continue
            g = rg[gk]
            g["value"] += r["count"]
            g["units"][r["program"]] = g["units"].get(r["program"], 0) + r["count"]
            g["statuses"][r["status"]] = g["statuses"].get(r["status"], 0) + r["count"]
            ps = g["prog_st"].setdefault(r["program"], {})
            ps[r["status"]] = ps.get(r["status"], 0) + r["count"]
        step_groups[set_key] = [{
            "key": k, "label": label, "hint": hint, "desc": desc, "section": section, "value": rg[k]["value"],
            "by_unit": [{"program": pg.key, "unit": pg.cfg["unit_label"], "value": rg[k]["units"].get(pg.key, 0)}
                        for pg in progs],
            "statuses": sorted(rg[k]["statuses"].items(), key=lambda x: -x[1]),
            # Where each count comes from: unit → form + Application Status field → every status value
            # of that form that belongs to this card (0 when nobody has it). The per-round
            # "result" cards list every unit, even one whose form has no such status.
            "sources": [src for src in (_step_source(pg, k, classify, stages, rg[k]["prog_st"].get(pg.key) or {})
                                        for pg in progs) if src["statuses"] or section == "result"],
        } for k, label, hint, desc, section in groups]

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
        "programs_available": [c["key"] for c in PROGRAMS if _can_prog(c)],
        "units_in_scope": [{"program": pg.key, "unit": pg.cfg["unit_label"]} for pg in progs],
        "options": _cached_filter_options(f.programs),
        "stages": STAGES,
        "board": board,
        "funnel_cards": [{"key": k, "label": CARDS[k]["label"], "tone": CARDS[k]["tone"], "desc": _card_desc(k),
                          "value": cards[k],
                          "by_unit": [{"program": pg.key, "unit": pg.cfg["unit_label"], "value": by_unit[k][pg.key]}
                                      for pg in progs if pg.key in by_unit[k]]} for k in TOP_CARDS],
        "funnel": funnel,
        "step_groups": step_groups,
        "status_rows": status_rows,
        "trend": sorted(trend.items()),
        "has_status_log": any(c.get("status_log") and c["key"] in f.programs and _can_prog(c)
                              for c in PROGRAMS),
        "all_time_registrations": all_time,
        # 7th top card: this year's Headcount Plan total (None = no access / DocType not on this site).
        "headcount": _headcount_summary(),
        "generated_at": frappe.utils.now(),
    }
    frappe.cache.set_value(key, out, expires_in_sec=CACHE_SECONDS)
    return out


def _headcount_summary():
    try:
        from ms_calendar.ms_calendar.page.pathways_overall_dashboard.headcount import headcount_summary
        return headcount_summary()
    except Exception:
        # Never let the plan card break the dashboard (e.g. DocType not migrated yet).
        frappe.log_error(title="Pathways dashboard: headcount summary failed")
        return None


OPTIONS_CACHE_SECONDS = 600


def _cached_filter_options(programs):
    """_filter_options() cached per user + programmes for 10 minutes (Refresh bypasses the card cache, not this)."""
    key = "pathways_overall:opts:v2:" + hashlib.sha1(
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
        if cfg["key"] not in programs or not _can_prog(cfg):
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
        "job_openings": _job_opening_options(programs),
    }


def _job_opening_options(programs):
    """Job Openings for the filter: the units on this dashboard (or no unit), open ones first."""
    if not frappe.db.exists("DocType", "Job Opening") or not frappe.has_permission("Job Opening", "read"):
        return []
    units = [c["unit_label"] for c in PROGRAMS if c["key"] in programs]
    rows = frappe.get_list("Job Opening", fields=["name", "job_title", "job_code", "unit", "status", "location"],
                           filters=[["unit", "in", units + [""]]], or_filters=None,
                           order_by="status desc, posted_on desc", limit_page_length=0)
    rows += frappe.get_list("Job Opening", fields=["name", "job_title", "job_code", "unit", "status", "location"],
                            filters=[["unit", "is", "not set"]], limit_page_length=0)
    seen, out = set(), []
    for r in rows:
        if r.name in seen:
            continue
        seen.add(r.name)
        bits = [r.job_title or r.name]
        if r.job_code:
            bits.append(f"#{r.job_code}")
        label = " · ".join(bits) + (f" ({r.unit})" if r.unit else "") + (" — Closed" if r.status == "Closed" else "")
        out.append({"value": r.name, "label": label, "unit": r.unit or ""})
    return out


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
                 pipe=None, days_min=None, days_max=None, step_group=None, hc=None):
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
    if step_group:
        # One step of the Select / Reject view ("select:test"): that programme's statuses in this step.
        set_key, _, step = str(step_group).partition(":")
        if set_key not in STEP_SETS or step not in {g[0] for g in STEP_SETS[set_key][0]}:
            frappe.throw("Unknown step")
        _, classify, stages = STEP_SETS[set_key]
        for pg in progs:
            pg.rej_statuses = [r.s for r in pg.status_counts() if _stage(r.s) in stages and classify(r.s) == step]
    if hc:
        # One number of the Headcount Plan view: that unit, its financial year, its plan line, its measure.
        from ms_calendar.ms_calendar.page.pathways_overall_dashboard.headcount import apply_hc
        progs = apply_hc(progs, hc)
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
    return {k: kw.get(k) for k in ("programs", "from_date", "to_date", "stages", "dim", "dim_value") + FILTER_KEYS}


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


# ── Analytics tab ──────────────────────────────────────────────────────────
#
# The "next level" asked for in the Nov 2026 review: the same permission-
# scoped registrations (same filters as every other tab), sliced by unit,
# job description, source, referrer, gender, education, age and home state;
# how long each step takes and who it waits on (from the Application Status
# change history in Version); feedback turnaround; and outcomes per
# interviewer. One grouped scan per programme + one pass over its status
# history, cached 10 minutes per user + filters (Refresh bypasses it).

ANALYTICS_CACHE_SECONDS = 600
# "Reached at least this far" steps (Registered = everyone), nested: each ⊆ the one before.
MILESTONES = [("reach_cv", "CV shortlisted"), ("reach_leader", "Leadership round"), ("reach_offer", "Offer made"),
              ("reach_accepted", "Offer accepted"), ("reach_joined", "Joined")]
_MS_KEYS = [k for k, _ in MILESTONES]
STATUS_DECLINED = _statuses("offer_declined", "not_joined")

# Steps an applicant waits at, in order, with who the wait is on (time
# analysis). Consecutive statuses of one step (e.g. Recruiter Round →
# Recruiter Round Scheduled → Recruiter Round Select) count as one stay.
STEP_OWNERS = {"hr": "HR team", "unit": "Interview panel (unit)", "approver": "Approvers", "candidate": "Candidate"}
STEP_DEFS = [
    ("screening", "CV screening", "hr", ["new"]),
    ("test", "Shortlisted / test", "hr", ["cv_shortlist", "test_select"]),
    ("recruiter", "Recruiter round", "hr", ["recruiter"]),
    ("functional", "Functional rounds", "unit", ["functional"]),
    ("leadership", "Leadership rounds", "unit", ["leadership"]),
    ("docs", "Documents & fitment", "hr", ["doc_collection", "fitment"]),
    ("comp", "Compensation approval", "approver", ["comp_due", "comp_approved"]),
    ("offer_prep", "Offer letter to be sent", "hr", ["offer_not_sent"]),
    ("offer_reply", "Waiting for the candidate's reply", "candidate", ["offer_sent"]),
    ("onboarding", "Onboarding (addendum → IT email)", "hr",
     ["offer_accepted", "addendum_accepted", "prejoin_done", "prejoin_pending", "it_sent", "it_not_sent"]),
]
_STEP_EXTRA = {"Field": {"Test Initiated": "test", "Test Process": "test"}}


def _step_map(prog):
    """status key → step key for one programme (statuses of no step = journey ended / unknown)."""
    out = {}
    for step, _, _, cards in STEP_DEFS:
        for c in cards:
            for s in STATUS.get(c, {}).get(prog, []):
                out.setdefault(_status_key(s), step)
    for s, step in _STEP_EXTRA.get(prog, {}).items():
        out.setdefault(_status_key(s), step)
    return out


def _outcome(result):
    """A feedback form's result → Select / Reject / On hold / Not recorded."""
    s = (result or "").strip().lower()
    if not s:
        return "Not recorded"
    if "reject" in s or "regret" in s:
        return "Reject"
    if "hold" in s:
        return "On hold"
    if "select" in s:
        return "Select"
    return "Other"


def _hist_stats(hist):
    """{days: count} → (median, average, n)."""
    n = sum(hist.values())
    if not n:
        return None, None, 0
    keys = sorted(hist)

    def kth(k):     # the k-th smallest value (0-based)
        seen = 0
        for d in keys:
            seen += hist[d]
            if seen > k:
                return d
        return keys[-1]

    total = sum(d * c for d, c in hist.items())
    return (kth((n - 1) // 2) + kth(n // 2)) / 2, round(total / n, 1), n


def _hist_add(hist, days, n=1):
    hist[days] = hist.get(days, 0) + n


def _full_names(values):
    """email → full name for the values that are users' emails (others are kept as they are)."""
    emails = sorted({v for v in values if v and "@" in v})
    out = {}
    for i in range(0, len(emails), 500):
        for u in frappe.get_all("User", filters={"name": ["in", emails[i:i + 500]]}, fields=["name", "full_name"]):
            if u.full_name:
                out[u.name] = u.full_name
    return out


def _person(value, names):
    """A referrer / panelist as a name: their user's full name, else 'first.last@…' → 'First Last'."""
    v = (value or "").strip()
    if v in names:
        return names[v]
    if "@" in v:
        return " ".join(w.capitalize() for w in v.split("@")[0].replace("_", ".").split(".") if w) or v
    return v


def _status_history(pg, w, p):
    """
    {docname: [ (date, from, to), … ]} oldest first, plus {docname: application date} —
    every Application Status change recorded in Version for registrations in scope.
    """
    import re

    fld = pg.cfg["status"]
    tok = r'("(?:[^"\\]|\\.)*"|null)'
    rx = re.compile(r'\[\s*"' + re.escape(fld) + r'"\s*,\s*' + tok + r'\s*,\s*' + tok + r'\s*\]')
    hist, adates = {}, {}
    # Only a short slice of each Version's JSON (around the status change) leaves the
    # database, so even a few lakh changes stay light to fetch.
    rows = frappe.db.sql(
        f"""SELECT v.docname, {pg.adate} AS ad, v.creation,
                SUBSTRING(v.data, GREATEST(1, LOCATE(%(_vkey)s, v.data) - 1), 400) AS data
            FROM `tabVersion` v
            JOIN ({pg.reg_sql}) r ON r.name = v.docname
            WHERE v.ref_doctype = %(_vdt)s AND v.data LIKE %(_vlike)s AND {w}
            ORDER BY v.creation""",
        dict(p, _vdt=pg.cfg["reg"], _vkey=f'"{fld}"', _vlike=f'%"{fld}"%'), as_dict=True)
    for v in rows:
        m = rx.search(v.data or "")
        if not m:
            continue
        try:
            frm, to = (frappe.parse_json(x) for x in m.groups())
        except Exception:
            continue
        if (frm or "") == (to or ""):
            continue
        hist.setdefault(v.docname, []).append((getdate(v.creation), frm or "", to or ""))
        adates[v.docname] = getdate(v.ad) if v.ad else None
    return hist, adates


@frappe.whitelist()
def get_analytics(refresh=0, **kw):
    filters = _filters_from(kw)
    filters.pop("dim", None)
    filters.pop("dim_value", None)
    f = _parse_filters(**filters)
    key = "pathways_overall:analytics:v1:" + hashlib.sha1(
        frappe.as_json([frappe.session.user, f]).encode()).hexdigest()
    if not cint(refresh):
        hit = frappe.cache.get_value(key)
        if hit:
            return hit
    out = _analytics(_progs(f))
    out["generated_at"] = frappe.utils.now()
    frappe.cache.set_value(key, out, expires_in_sec=ANALYTICS_CACHE_SECONDS)
    return out


def _analytics(progs):
    today = getdate(nowdate())
    blank = lambda: {"reg": 0, **{k: 0 for k in _MS_KEYS}}  # noqa: E731

    def bump(bucket, n, flags):
        bucket["reg"] += n
        for k in flags:
            bucket[k] += n

    units, gender_units, jds = [], [], {}
    dims = {d: {} for d in ("source", "gender", "education", "age_band", "home_state", "referrer")}
    captured = {d: [] for d in list(dims) + ["decline_reason", "reject_reason"]}
    filled = {d: [0, 0] for d in captured}             # [filled, total over units that capture it]
    decline, reject = {}, {}
    steps = {s: {"all": {}, "open": 0, "units": {}} for s, _, _, _ in STEP_DEFS}
    to_ms = {k: {"all": {}, "units": {}} for k in _MS_KEYS}
    turnaround, panel, successes = [], {}, []
    history = {"docs": 0, "moved": 0}
    interviews_named = [0, 0]

    for pg in progs:
        cfg = pg.cfg
        w, p = pg.where()
        reach = {k: {_status_key(s) for s in STATUS[k].get(pg.key, [])} for k in _MS_KEYS}
        declined = {_status_key(s) for s in STATUS_DECLINED.get(pg.key, [])}
        ex = {d: pg.dim_expr(d) for d in DIMS}
        hs = _col("r", cfg.get("home_state"), pg.reg_fields)
        jc = _col("r", cfg["job_code"], pg.reg_fields)
        for d in captured:
            has = hs != "NULL" if d == "home_state" else ex.get(d) is not None
            if has:
                captured[d].append(cfg["unit_label"])

        # 1. one grouped scan: status × every dimension × JD × month
        rows = frappe.db.sql(
            f"""SELECT IFNULL({pg.st}, '') AS st, {ex['source'] or 'NULL'} AS src, {ex['gender'] or 'NULL'} AS g,
                    {ex['education'] or 'NULL'} AS edu, {ex['age_band'] or 'NULL'} AS agb,
                    {ex['referrer'] or 'NULL'} AS ref, {ex['decline_reason'] or 'NULL'} AS dcl,
                    {ex['reject_reason'] or 'NULL'} AS rej, IFNULL(TRIM({hs}), '') AS hs,
                    IFNULL(TRIM({pg.rl}), '') AS jrole, IFNULL(TRIM({jc}), '') AS jc,
                    DATE_FORMAT({pg.adate}, '%%Y-%%m') AS mon, COUNT(*) AS n
                FROM ({pg.reg_sql}) r WHERE {w}
                GROUP BY st, src, g, edu, agb, ref, dcl, rej, hs, jrole, jc, mon""", p, as_dict=True)
        u = {"program": pg.key, "unit": cfg["unit_label"], **blank()}
        gu = {}
        for r in rows:
            n = cint(r.n)
            sk = _status_key(r.st)
            flags = [k for k in _MS_KEYS if sk in reach[k]]
            bump(u, n, flags)
            for d, v in (("source", r.src), ("gender", r.g), ("education", r.edu), ("age_band", r.agb),
                         ("referrer", r.ref)):
                if v is None:
                    continue
                filled[d][1] += n
                if v:
                    filled[d][0] += n
                if d == "referrer" and not v:
                    continue   # only people who named a referrer
                bump(dims[d].setdefault(v, blank()), n, flags)
            if r.g is not None:
                bump(gu.setdefault(r.g, blank()), n, flags)
            if hs != "NULL":
                filled["home_state"][1] += n
                state = _state_of(r.hs) if r.hs else ""
                if state:
                    filled["home_state"][0] += n
                bump(dims["home_state"].setdefault(state or "", blank()), n, flags)
            # job descriptions: one row per (unit, job code, role)
            jd = jds.setdefault((pg.key, r.jc, r.jrole), {
                "program": pg.key, "unit": cfg["unit_label"], "job_code": r.jc, "role": r.jrole,
                "declined": 0, "months": {}, **blank()})
            bump(jd, n, flags)
            if sk in declined:
                jd["declined"] += n
            jd["months"][r.mon] = jd["months"].get(r.mon, 0) + n
            # reasons
            if r.dcl is not None and sk in declined:
                filled["decline_reason"][1] += n
                if r.dcl:
                    filled["decline_reason"][0] += n
                    decline[r.dcl] = decline.get(r.dcl, 0) + n
            if r.rej is not None and _stage(r.st) == "Not selected":
                filled["reject_reason"][1] += n
                if r.rej:
                    filled["reject_reason"][0] += n
                    k = (r.rej, "Declined the offer / did not join" if sk in declined else "Rejected")
                    reject[k] = reject.get(k, 0) + n
        units.append(u)
        gender_units.append({"program": pg.key, "unit": cfg["unit_label"], "captured": ex["gender"] is not None,
                             "rows": gu})

        # 2. status history → time spent per step + days to each milestone
        step_of = _step_map(pg.key)
        hist, adates = _status_history(pg, w, p)
        history["docs"] += len(hist)
        history["moved"] += sum(cint(r.n) for r in rows if _status_key(r.st) not in ("", "new applicant"))
        first = {}
        for doc, evs in hist.items():
            ad = adates.get(doc)
            cur, start = step_of.get(_status_key(evs[0][1])), ad
            reached = {}
            for when, _frm, to in evs:
                nxt = step_of.get(_status_key(to))
                if nxt != cur:
                    if cur and start:
                        days = max(0, (when - start).days)
                        _hist_add(steps[cur]["all"], days)
                        _hist_add(steps[cur]["units"].setdefault(pg.key, {}), days)
                    cur, start = nxt, when
                tk = _status_key(to)
                for k in _MS_KEYS:
                    if k not in reached and tk in reach[k]:
                        reached[k] = when
            if cur:
                steps[cur]["open"] += 1
            if ad:
                # reaching a later step means every earlier one was reached by then too
                for i, k in enumerate(_MS_KEYS):
                    later = [reached[x] for x in _MS_KEYS[i:] if x in reached]
                    if later:
                        days = max(0, (min(later) - ad).days)
                        reached.setdefault(k, min(later))
                        _hist_add(to_ms[k]["all"], days)
                        _hist_add(to_ms[k]["units"].setdefault(pg.key, {}), days)
                first[doc] = {k: max(0, (reached[k] - ad).days) for k in reached}

        # successful candidates: everyone at "offer accepted" or beyond
        acc = STATUS["reach_accepted"].get(pg.key)
        if acc:
            for r in frappe.db.sql(
                    f"""SELECT r.name AS id, IFNULL(NULLIF(TRIM({_col('r', cfg['title'], pg.reg_fields)}), ''), r.name) AS name,
                            {pg.rl} AS role, {pg.adate} AS applied, IFNULL({pg.st}, '') AS status
                        FROM ({pg.reg_sql}) r WHERE {w} AND IFNULL({pg.st}, '') IN %(_acc)s""",
                    dict(p, _acc=tuple(acc)), as_dict=True):
                d = first.get(r.id) or {}
                successes.append({"program": pg.key, "unit": cfg["unit_label"], "id": r.id, "name": r.name,
                                  "role": r.role or "", "applied": str(r.applied or ""), "status": r.status,
                                  "to_offer": d.get("reach_offer"), "to_accept": d.get("reach_accepted"),
                                  "to_join": d.get("reach_joined")})

        # 3. interviews → feedback turnaround, and outcomes per interviewer
        iv_sql, iv_f = pg.interview_sql()
        fb_union = pg.feedback_union()
        if iv_sql:
            canc = _col("i", "is_cancelled", iv_f)
            ivn = _col("i", "interviewer_name", iv_f)
            named, total = frappe.db.sql(
                f"""SELECT SUM(IFNULL(TRIM({ivn}), '') <> ''), COUNT(*) FROM ({iv_sql}) i
                    JOIN ({pg.reg_sql}) r ON r.name = i.application_id WHERE {w} AND IFNULL({canc},0)=0""", p)[0]
            interviews_named[0] += cint(named)
            interviews_named[1] += cint(total)
        if iv_sql and fb_union:
            th = {}
            pending = 0
            for d, n in frappe.db.sql(
                    f"""SELECT x.d, COUNT(*) FROM (
                            SELECT DATEDIFF(MIN(DATE(u.creation)), i.interview_date) AS d
                            FROM ({iv_sql}) i JOIN ({pg.reg_sql}) r ON r.name = i.application_id
                            LEFT JOIN ({fb_union}) u ON u.applicant_id = i.application_id
                                AND DATE(u.creation) >= i.interview_date
                            WHERE {w} AND IFNULL({canc},0)=0 AND i.interview_date <= %(_t)s
                            GROUP BY i.name) x GROUP BY x.d""", dict(p, _t=today)):
                if d is None:
                    pending += cint(n)
                else:
                    _hist_add(th, cint(d), cint(n))
            med, avg, cnt = _hist_stats(th)
            turnaround.append({"program": pg.key, "unit": cfg["unit_label"], "median": med, "avg": avg, "n": cnt,
                               "within2": sum(c for d, c in th.items() if d <= 2), "pending": pending})
        if fb_union:
            for by, res, n in frappe.db.sql(
                    f"""SELECT IFNULL(TRIM(u.by_), ''), u.result, COUNT(*) FROM ({fb_union}) u
                        JOIN ({pg.reg_sql}) r ON r.name = u.applicant_id WHERE {w} GROUP BY 1, 2""", p):
                row = panel.setdefault(by or "", {"by": by or "", "units": set(), "forms": 0, "Select": 0,
                                                  "Reject": 0, "On hold": 0, "Not recorded": 0, "Other": 0})
                row["units"].add(cfg["unit_label"])
                row["forms"] += cint(n)
                row[_outcome(res)] += cint(n)

    # ── shape for the page ──
    names = _full_names(list(dims["referrer"]) + list(panel))

    def dim_rows(d, label=None, limit=None):
        rows = [{"value": v, "label": (label(v) if label else v) or "Not given", **c} for v, c in dims[d].items()]
        rows.sort(key=lambda x: -x["reg"])
        return rows[:limit] if limit else rows

    def step_out(s, label, owner):
        st = steps[s]
        med, avg, n = _hist_stats(st["all"])
        tot = sum(d * c for d, c in st["all"].items())
        return {"key": s, "label": label, "owner": owner, "median": med, "avg": avg, "n": n, "total_days": tot,
                "open": st["open"], "units": {p: _hist_stats(h)[0] for p, h in st["units"].items()}}

    panel_rows = []
    for by, row in panel.items():
        decided = row["Select"] + row["Reject"] + row["On hold"]
        panel_rows.append(dict(row, units=sorted(row["units"]), label=_person(by, names) or "Not recorded",
                               decided=decided))
    panel_rows.sort(key=lambda x: -x["forms"])

    jd_rows = sorted(jds.values(), key=lambda x: -x["reg"])
    top_months = sorted({m for j in jd_rows for m in j["months"] if m})[-24:]
    heat = [{"program": j["program"], "unit": j["unit"], "role": j["role"], "job_code": j["job_code"],
             "cells": [j["months"].get(m, 0) for m in top_months]} for j in jd_rows[:10]]
    for j in jd_rows:
        j["active_months"] = sum(1 for m, c in j["months"].items() if c and m)
        j["first"] = min((m for m in j["months"] if m), default="")
        j["last"] = max((m for m in j["months"] if m), default="")
        del j["months"]

    return {
        "milestones": [{"key": k, "label": lbl} for k, lbl in MILESTONES],
        "units": units,
        "jds": jd_rows,
        "jd_heat": {"months": top_months, "rows": heat},
        "sources": dim_rows("source"),
        "referrers": dim_rows("referrer", label=lambda v: _person(v, names), limit=25),
        "referrer_count": len(dims["referrer"]),
        "gender": dim_rows("gender"),
        "gender_units": gender_units,
        "education": dim_rows("education"),
        "age_band": sorted(dim_rows("age_band"), key=lambda x: (x["value"] == "", x["value"])),
        "home_state": dim_rows("home_state"),
        "decline": sorted(({"value": k, "n": n} for k, n in decline.items()), key=lambda x: -x["n"])[:15],
        "reject": sorted(({"value": k[0], "phase": k[1], "n": n} for k, n in reject.items()), key=lambda x: -x["n"])[:20],
        "steps": [step_out(s, lbl, o) for s, lbl, o, _ in STEP_DEFS],
        "owners": [{"key": k, "label": v} for k, v in STEP_OWNERS.items()],
        "time_to": [{"key": k, "label": lbl, "all": _hist_stats(to_ms[k]["all"]),
                     "units": {p: _hist_stats(h) for p, h in to_ms[k]["units"].items()}} for k, lbl in MILESTONES],
        "successes": successes,
        "turnaround": turnaround,
        "interviewers": panel_rows,
        "coverage": {
            "fields": [{"key": d, "units": captured[d], "filled": filled[d][0], "total": filled[d][1]}
                       for d in captured],
            "history_docs": history["docs"], "moved": history["moved"],
            "interviews_named": interviews_named[0], "interviews": interviews_named[1],
            "all_units": [pg.cfg["unit_label"] for pg in progs],
        },
    }


@frappe.whitelist()
def get_drilldown(kind, stage=None, status=None, card=None, page=1, page_size=100, sort_by=None,
                  sort_dir=None, search=None, date_from=None, date_to=None, own_dates=0,
                  pipe=None, days_min=None, days_max=None, **kw):
    """
    One page of the rows behind any card / table number — same scoped
    queries as the summary, no cap on how many rows exist.
    """
    step_group = kw.pop("step_group", None)
    hc = kw.pop("hc", None)
    kind, parts = _drill_setup(kind, _filters_from(kw), stage, status, card, date_from, date_to, own_dates,
                               pipe, days_min, days_max, step_group, hc)
    page_size =cint(page_size) if cint(page_size) in PAGE_SIZES else 100
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
    step_group = kw.pop("step_group", None)
    hc = kw.pop("hc", None)
    kind, parts = _drill_setup(kind, _filters_from(kw), stage, status, card, date_from, date_to, own_dates,
                               pipe, days_min, days_max, step_group, hc)
    _, _, order =_order(kind, sort_by, sort_dir)
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
    if not _can_prog(cfg):
        frappe.throw("Not permitted to view this applicant", frappe.PermissionError)
    if not frappe.has_permission(cfg["reg"], "read", doc=name):
        frappe.throw("Not permitted to view this applicant", frappe.PermissionError)
    return cfg, frappe.get_doc(cfg["reg"], name)


def _slug(dt):
    return frappe.scrub(dt).replace("_", "-")


_REC_SKIP_TYPES = {"Column Break", "Tab Break", "HTML", "Button", "Image", "Fold", "Heading", "Password",
                   "Signature", "Geolocation"}
_REC_LONG = {"Small Text", "Text", "Long Text", "Text Editor", "HTML Editor", "Markdown Editor", "Code"}
_REC_FILES = {"Attach", "Attach Image"}


# Records linked to an applicant, grouped into the profile's tabs. Anything
# else that links to the registration (and isn't an interview / feedback
# form, which have their own tab) lands in "other".
_REL_ASSESSMENT = {"Field MeritTrac Test Result", "Field Meritrac Test URL", "Field Evaluator Marks",
                   "Phil Assignment", "Health Center Visit Form"}
_REL_ONBOARDING = {"Field Document Collection", "Health Document Collection", "Philanthrophy Document Collection",
                   "Field Self Declaration", "Common Offer Letter", "Common New Member Form"}
# Onboarding forms that store the applicant ID in a plain Data field.
_REL_DATA_LINKED = ("Common Offer Letter", "Common New Member Form")
# Headline numbers shown above an assessment's full content.
_REL_SUMMARY = {
    "Field MeritTrac Test Result": [("total_score", "Score"), ("max_score", "Out of"),
                                    ("overall_percentage_score", "Percentage"), ("score_percentile", "Percentile"),
                                    ("credit_score", "DQ score"), ("attempt_status", "Attempt status")],
    "Field Evaluator Marks": [("total_marks", "Total marks"), ("max_total_marks", "Out of"), ("result", "Result"),
                              ("evaluator_name", "Evaluator")],
}
_REL_NOISE = {"user_img_key", "id_img_key"}
_REL_MAX = 20


def _linked_doctypes(cfg):
    """[(doctype, link_field)] holding records for this programme's applicants."""
    reg = cfg["reg"]
    rows = frappe.get_all("DocField", filters={"fieldtype": "Link", "options": reg}, fields=["parent", "fieldname"])
    rows += frappe.get_all("Custom Field", filters={"fieldtype": "Link", "options": reg},
                           fields=["dt as parent", "fieldname"])
    skip = {cfg["interview"], reg, *cfg["feedback"]}
    out = []
    for r in rows:
        if r.parent in skip or (r.parent, r.fieldname) in out:
            continue
        if not frappe.db.exists("DocType", {"name": r.parent, "istable": 0}):
            continue
        out.append((r.parent, r.fieldname))
    for dt in _REL_DATA_LINKED:
        if dt not in {d for d, _ in out} and frappe.db.exists("DocType", dt) and frappe.get_meta(dt).has_field("applicant_id"):
            out.append((dt, "applicant_id"))
    return out


def _related_records(cfg, name, documents):
    """Every record linked to this (already permission-checked) applicant that
    the user may read, each with its full content and a headline summary."""
    app_dt = cfg["app"][0] if isinstance(cfg["app"], tuple) else None
    related = []
    for dt, link in _linked_doctypes(cfg):
        if not _can_read(dt):
            continue
        group = ("application" if dt == app_dt else "assessment" if dt in _REL_ASSESSMENT
                 else "onboarding" if dt in _REL_ONBOARDING else "other")
        for row in frappe.get_list(dt, filters={link: name}, fields=["name", "creation"],
                                   order_by="creation desc", limit_page_length=_REL_MAX):
            if not frappe.has_permission(dt, "read", doc=row.name):
                continue
            rdoc = frappe.get_doc(dt, row.name)
            summary = []
            for field, label in _REL_SUMMARY.get(dt, []):
                if rdoc.get(field) not in (None, ""):
                    summary.append({"label": label, "value": str(rdoc.get(field))})
            related.append({
                "group": group, "doctype": dt, "name": row.name, "route": _slug(dt),
                "date": str(row.creation)[:16], "summary": summary,
                "sections": _record_sections(rdoc, documents, dt),
            })
    return related


def _rec_value(df, value):
    if value in (None, ""):
        return ""
    if df.fieldtype == "Check":
        return "Yes" if cint(value) else ""
    if df.fieldtype == "Rating":
        stars = cint(df.options) or 5
        return f"{round(frappe.utils.flt(value) * stars)} / {stars}"
    if df.fieldtype == "Date":
        return frappe.utils.formatdate(value)
    if df.fieldtype == "Datetime":
        return frappe.utils.format_datetime(value)
    if df.fieldtype in ("Text Editor", "HTML Editor", "Markdown Editor"):
        return frappe.utils.strip_html(str(value)).strip()
    return str(value)


def _record_sections(doc, documents, source):
    """
    Every visible, filled-in field of one record, grouped the way its form
    is laid out (Tab / Section Break labels) — plain text only, the page
    escapes everything. Hidden fields, passwords / OTPs and signatures are
    left out. Attach fields are collected into `documents` instead.
    """
    meta = frappe.get_meta(doc.doctype)
    sections = [{"title": "", "fields": [], "tables": []}]
    tab = ""
    for df in meta.fields:
        if df.fieldtype == "Tab Break":
            tab = (df.label or "").strip()
            sections.append({"title": tab, "fields": [], "tables": []})
            continue
        if df.fieldtype == "Section Break":
            # An unlabelled section is a continuation of the one above.
            if (df.label or "").strip():
                sections.append({"title": df.label.strip(), "fields": [], "tables": []})
            continue
        if df.fieldtype in _REC_SKIP_TYPES or df.hidden or df.fieldname in _PROFILE_SKIP or df.fieldname in _REL_NOISE:
            continue
        label = (df.label or df.fieldname).strip()
        if df.fieldtype in _REC_FILES:
            if doc.get(df.fieldname):
                documents.append({"label": label, "url": doc.get(df.fieldname), "source": source})
            continue
        if df.fieldtype in ("Table", "Table MultiSelect"):
            cm = frappe.get_meta(df.options)
            cols = [c for c in cm.fields
                    if c.fieldtype not in _REC_SKIP_TYPES | {"Section Break"} and not c.hidden]
            listed = ([c for c in cols if c.in_list_view] or cols)[:8]
            rows = [[_rec_value(c, r.get(c.fieldname)) for c in listed] for r in (doc.get(df.fieldname) or [])[:100]]
            if rows:
                sections[-1]["tables"].append(
                    {"label": label, "columns": [c.label or c.fieldname for c in listed], "rows": rows})
            continue
        value = _rec_value(df, doc.get(df.fieldname))
        if value:
            sections[-1]["fields"].append({"label": label, "value": value, "long": df.fieldtype in _REC_LONG})
    return [s for s in sections if s["fields"] or s["tables"]]


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

    # The full record, every form's own content and all attached documents —
    # each form only when this user may read that exact document.
    documents = []
    sections = _record_sections(doc, documents, cfg["reg"])
    related = _related_records(cfg, name, documents)

    facts = []
    for label, key in (("Email", "email"), ("Phone", "phone"), ("Role", "role"), ("Location", "location"),
                       ("Job code", "job_code"), ("Source", "source")):
        if cfg.get(key) and doc.get(cfg[key]):
            facts.append({"label": label, "value": str(doc.get(cfg[key]))})
    applied_on = doc.get(cfg["app_date"]) if cfg["app_date"] else None
    facts.append({"label": "Applied on", "value": frappe.utils.formatdate(applied_on or doc.creation)})

    status = doc.get(cfg["status"]) or ""
    applied = any(f.get("is_application") for f in forms) if cfg["app"] else None
    return {
        "program": program, "id": name, "route": slug(cfg["reg"]), "unit": cfg["unit_label"],
        "name": doc.get(cfg["title"]) or name, "status": status, "stage": _stage(status),
        "applied": applied, "profile": profile, "forms": forms, "interviews": interviews, "feedback": feedback,
        "history": history, "milestones": milestones,
        "sections": sections, "documents": documents, "facts": facts, "related": related,
        "modified": str(doc.modified)[:16],
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
