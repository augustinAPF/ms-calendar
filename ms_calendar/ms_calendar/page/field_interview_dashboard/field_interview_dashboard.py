"""
Field Interview Dashboard (desk page /app/field-interview-dashboard).

Every endpoint here is permission-scoped on the server:
- interviews are read with frappe.get_list (applies the user's DocType and
  User Permissions on "Field Interview Schedule"), never frappe.get_all;
- interviewer rows / feedback lookups are only ever made for the interview
  names / applicants that get_list already returned for this user;
- the candidate detail endpoint checks read permission on that exact
  Field Registration Form record before returning anything.
The page computes cards, tables, drilldowns and CSV exports from the rows
get_dashboard_data returns, so an export can never be wider than what the
user is allowed to see on screen.
"""

import re

import frappe
from frappe.utils import cint, getdate, nowdate

from ms_calendar.api.ms_field import FIELD_FEEDBACK_ROUND_MAP, _FRF_ATTACH_LABELS

MAX_ROWS = 5000

FIS = "Field Interview Schedule"
FRF = "Field Registration Form"


def _check_read():
    if not frappe.has_permission(FIS, "read"):
        frappe.throw("Not permitted to view Field Interview Schedules", frappe.PermissionError)


def _str_list(value):
    """Client filter → clean list of strings (anything else is dropped)."""
    if not value:
        return []
    if isinstance(value, str):
        value = frappe.parse_json(value)
    if not isinstance(value, (list, tuple)):
        return []
    return [str(v).strip() for v in value if isinstance(v, (str, int)) and str(v).strip()]


def _base_round(interview_round):
    return re.sub(r"\s+(Select|Reject)$", "", (interview_round or "").strip())


def _feedback_doctypes_available():
    """FIELD_FEEDBACK_ROUND_MAP minus doctypes this site doesn't have."""
    out = {}
    for rnd, doctypes in FIELD_FEEDBACK_ROUND_MAP.items():
        present = [dt for dt in doctypes if frappe.db.exists("DocType", dt)]
        if present:
            out[rnd] = present
    return out


# Result / "submitted by" columns differ between the Feedback Form doctypes.
# (Not application_status — that's the applicant's pipeline stage, e.g.
# "Subject Round", not this interviewer's Select / Reject / On Hold.)
_RESULT_FIELDS = ("interview_status", "interview_result")
_BY_FIELDS = ("panelist_name", "submitted_by", "panelist_email")


def _feedback_extra_fields(doctype):
    meta = frappe.get_meta(doctype)
    return [f for f in _RESULT_FIELDS + _BY_FIELDS if meta.has_field(f)]


def _feedback_row(doctype, s):
    return {
        "doctype": doctype,
        "name": s.name,
        "application_id": s.applicant_id or "",
        "applicant": s.get("applicant_name") or "",
        "date": str(getdate(s.creation)),
        "submitted_on": str(s.creation)[:16],
        "by": next((s.get(f) for f in _BY_FIELDS if s.get(f)), None) or frappe.utils.get_fullname(s.owner),
        "result": next((s.get(f) for f in _RESULT_FIELDS if s.get(f)), "") or "",
    }


def _allowed_feedback_doctypes():
    return {d for dts in _feedback_doctypes_available().values() for d in dts}


def _render_feedback_doc(doc):
    """
    A feedback submission as plain, display-ready data: sections of
    {label, value} pairs, child tables as {label, columns, rows}. HTML from
    Text Editor fields is stripped, so the page can escape everything.
    """
    meta = frappe.get_meta(doc.doctype)
    skip = {"Column Break", "Tab Break", "HTML", "Button", "Image", "Fold", "Heading"}

    def fmt(df, value):
        if value in (None, ""):
            return ""
        if df.fieldtype == "Check":
            return "Yes" if cint(value) else "No"
        if df.fieldtype == "Rating":
            stars = cint(df.options) or 5
            return f"{round(frappe.utils.flt(value) * stars)} / {stars}"
        if df.fieldtype in ("Date",):
            return frappe.utils.formatdate(value)
        if df.fieldtype in ("Datetime",):
            return frappe.utils.format_datetime(value)
        if df.fieldtype in ("Text Editor", "HTML Editor", "Markdown Editor"):
            return frappe.utils.strip_html(str(value)).strip()
        return str(value)

    sections = [{"title": "", "fields": [], "tables": []}]
    for df in meta.fields:
        if df.fieldtype == "Section Break":
            sections.append({"title": (df.label or "").strip(), "fields": [], "tables": []})
            continue
        if df.fieldtype in skip:
            continue
        if df.fieldtype in ("Table", "Table MultiSelect"):
            child_meta = frappe.get_meta(df.options)
            cols = [c for c in child_meta.fields if c.fieldtype not in skip | {"Section Break"}]
            listed = [c for c in cols if c.in_list_view] or cols
            rows = [[fmt(c, r.get(c.fieldname)) for c in listed] for r in (doc.get(df.fieldname) or [])]
            if rows:
                sections[-1]["tables"].append({
                    "label": df.label or df.fieldname,
                    "columns": [c.label or c.fieldname for c in listed],
                    "rows": rows,
                })
            continue
        value = fmt(df, doc.get(df.fieldname))
        if value:
            sections[-1]["fields"].append({
                "label": df.label or df.fieldname,
                "value": value,
                "long": df.fieldtype in ("Small Text", "Text", "Long Text", "Text Editor", "HTML Editor", "Markdown Editor"),
            })
    return [s for s in sections if s["fields"] or s["tables"]]


@frappe.whitelist()
def get_feedback_detail(doctype, name):
    """
    Full content of one feedback submission, shown inline on the dashboard.
    Only Feedback Form doctypes are allowed, and only for an applicant the
    user can already see on a Field Interview Schedule.
    """
    _check_read()
    if doctype not in _allowed_feedback_doctypes() or not frappe.db.exists(doctype, name):
        frappe.throw("Feedback not found")
    doc = frappe.get_doc(doctype, name)
    if not doc.get("applicant_id") or not frappe.get_list(
        FIS, filters={"application_id": doc.applicant_id}, pluck="name", limit_page_length=1
    ):
        frappe.throw("Not permitted to view this feedback", frappe.PermissionError)
    row = _feedback_row(doctype, doc)
    row["sections"] = _render_feedback_doc(doc)
    return row


@frappe.whitelist()
def get_dashboard_data(from_date=None, to_date=None, departments=None, rounds=None,
                       interviewers=None, modes=None):
    """
    One row per Field Interview Schedule in the date range the user can read,
    with its computed status and feedback state, plus the filter options and
    the all-time total. Cards / tables / drilldowns are all derived from
    these rows on the page.
    """
    _check_read()

    today = getdate(nowdate())
    # No dates = no date filter (every interview). Either end can be set alone.
    from_date = getdate(from_date) if from_date else None
    to_date = getdate(to_date) if to_date else None
    if from_date and to_date and from_date > to_date:
        from_date, to_date = to_date, from_date

    departments = _str_list(departments)
    rounds = _str_list(rounds)
    interviewers = _str_list(interviewers)
    modes = _str_list(modes)

    filters = []
    if from_date and to_date:
        filters.append([FIS, "interview_date", "between", [from_date, to_date]])
    elif from_date:
        filters.append([FIS, "interview_date", ">=", from_date])
    elif to_date:
        filters.append([FIS, "interview_date", "<=", to_date])
    if departments:
        filters.append([FIS, "department", "in", departments])
    if rounds:
        filters.append([FIS, "interview_round", "in", rounds])
    if modes:
        filters.append([FIS, "interview_mode", "in", modes])

    rows = frappe.get_list(
        FIS,
        filters=filters,
        fields=[
            "name", "application_id", "applicants_name", "interview_round", "role",
            "department", "interview_date", "start_time", "end_time", "interview_mode",
            "is_cancelled", "cancellation_reason", "ms_event_id", "organizer_email",
            "interviewer_name", "creation",
        ],
        order_by="interview_date desc, start_time desc",
        limit_page_length=MAX_ROWS,
    )

    # Interviewers — only for the interviews get_list returned above.
    by_parent = {}
    names = [r.name for r in rows]
    if names:
        for c in frappe.get_all(
            "Interviewer Email Child",
            filters={"parenttype": FIS, "parentfield": "interviewer_email", "parent": ["in", names]},
            fields=["parent", "interviewer_email"],
            limit_page_length=0,
        ):
            if c.interviewer_email:
                by_parent.setdefault(c.parent, []).append(c.interviewer_email.strip())

    # Reschedules ("Modify The Schedule") — update_interview_event logs an
    # "Interview Rescheduled – …" Communication on the schedule each time.
    reschedules = {}  # name -> [dates]
    if names:
        for c in frappe.get_all(
            "Communication",
            filters={
                "reference_doctype": FIS,
                "reference_name": ["in", names],
                "subject": ["like", "Interview Rescheduled%"],
            },
            fields=["reference_name", "creation"],
            limit_page_length=0,
        ):
            # One reschedule logs several emails (interviewer, candidate…)
            # within the same minute — count it once.
            reschedules.setdefault(c.reference_name, set()).add(c.creation.strftime("%Y-%m-%d %H:%M"))

    # Feedback submissions per (doctype, applicant) — only these applicants.
    fb_map = _feedback_doctypes_available()
    applicants = list({r.application_id for r in rows if r.application_id})
    submissions = {}  # (doctype, applicant) -> [(creation date, result)]
    feedback_rows = []
    if applicants:
        for dt in sorted({d for dts in fb_map.values() for d in dts}):
            extra = _feedback_extra_fields(dt)
            for s in frappe.get_all(
                dt,
                filters={"applicant_id": ["in", applicants]},
                fields=["name", "applicant_id", "applicant_name", "creation", "owner"] + extra
                if frappe.get_meta(dt).has_field("applicant_name")
                else ["name", "applicant_id", "creation", "owner"] + extra,
                limit_page_length=0,
            ):
                fr = _feedback_row(dt, s)
                submissions.setdefault((dt, s.applicant_id), []).append((getdate(s.creation), fr["result"]))
                feedback_rows.append(fr)

    out = []
    for r in rows:
        # Older (imported) schedules have no interviewer rows, only the
        # free-text interviewer_name — show that instead of a blank.
        ivs = by_parent.get(r.name) or ([r.interviewer_name.strip()] if (r.interviewer_name or "").strip() else [])
        if interviewers and not set(ivs) & set(interviewers):
            continue

        d = getdate(r.interview_date) if r.interview_date else None
        base = _base_round(r.interview_round)
        fb_doctypes = fb_map.get(base, [])

        # Feedback counts for this interview only if it was submitted on or
        # after the interview date (so Leader Round-1 feedback doesn't mark
        # the later Leader Round-2 interview as done).
        matched = []  # [(date, result)] submitted on/after the interview
        if fb_doctypes and r.application_id and d:
            for dt in fb_doctypes:
                matched += [x for x in submissions.get((dt, r.application_id), []) if x[0] >= d]
        matched.sort(key=lambda x: x[0])
        fb_count = len(matched)
        # Outcome = latest result given for this interview; turnaround =
        # days from the interview to its first feedback.
        outcome = next((res for _dt, res in reversed(matched) if res), "")
        turnaround = (matched[0][0] - d).days if matched else None

        if cint(r.is_cancelled):
            status = "Cancelled"
        elif d and d > today:
            status = "Upcoming"
        elif d and d == today:
            status = "Today"
        else:
            status = "Completed"

        if status == "Cancelled":
            feedback = "—"
        elif not fb_doctypes:
            feedback = "No form"
        elif fb_count:
            feedback = "Received"
        elif status == "Completed":
            feedback = "Pending"
        else:
            feedback = "Not due"

        out.append({
            "name": r.name,
            "application_id": r.application_id or "",
            "applicant": r.applicants_name or "",
            "round": (r.interview_round or "").strip(),
            "role": r.role or "",
            "department": r.department or "",
            "date": str(d) if d else "",
            "start": r.start_time or "",
            "end": r.end_time or "",
            "mode": r.interview_mode or "",
            "status": status,
            "feedback": feedback,
            "feedback_count": fb_count,
            "outcome": outcome if status != "Cancelled" else "",
            "turnaround_days": turnaround if status != "Cancelled" else None,
            # How long a Pending feedback has been waiting since the interview.
            "days_waiting": (today - d).days if (feedback == "Pending" and d) else None,
            "invite_sent": 1 if (r.ms_event_id or "").strip() else 0,
            "interviewers": ivs,
            "rescheduled": len(reschedules.get(r.name, ())),
            "cancel_reason": r.cancellation_reason or "",
            "organizer": r.organizer_email or "",
        })

    # Feedback list: submissions for the applicants still shown (after the
    # interviewer filter), submitted on/after the range start, newest first.
    shown_apps = {o["application_id"] for o in out}
    names_by_app = {}
    for o in out:
        names_by_app.setdefault(o["application_id"], o["applicant"])
    feedback_list = []
    for f in feedback_rows:
        if f["application_id"] in shown_apps and (not from_date or f["date"] >= str(from_date)):
            f["applicant"] = f["applicant"] or names_by_app.get(f["application_id"], "")
            feedback_list.append(f)
    feedback_list.sort(key=lambda f: f["submitted_on"], reverse=True)

    # Every schedule this user can read (all-time card + filter options).
    readable = frappe.get_list(FIS, pluck="name", limit_page_length=0)

    return {
        "rows": out,
        "feedback": feedback_list,
        "truncated": len(rows) >= MAX_ROWS,
        "from_date": str(from_date) if from_date else "",
        "to_date": str(to_date) if to_date else "",
        "today": str(today),
        "options": _filter_options(readable),
        # All-time card: ignores every filter, still permission-scoped.
        "all_time_total": len(readable),
    }


def _filter_options(readable):
    """Distinct filter values from the schedules this user can read."""
    def distinct(field):
        vals = frappe.get_list(FIS, fields=[field], distinct=True, limit_page_length=0, order_by=f"{field} asc")
        return sorted({(v.get(field) or "").strip() for v in vals if (v.get(field) or "").strip()})

    interviewers = set({
        (c or "").strip()
        for c in frappe.get_all(
            "Interviewer Email Child",
            filters={"parenttype": FIS, "parentfield": "interviewer_email", "parent": ["in", readable or [""]]},
            pluck="interviewer_email",
            limit_page_length=0,
        )
        if (c or "").strip()
    })
    interviewers |= set(distinct("interviewer_name"))
    return {
        "departments": distinct("department"),
        "rounds": distinct("interview_round"),
        "modes": distinct("interview_mode"),
        "interviewers": sorted(interviewers),
    }


@frappe.whitelist()
def get_candidate_detail(application_id):
    """
    Second-level drilldown: everything about one applicant — profile, every
    interview, every feedback submission and the PDFs on file. Checks read
    permission on this exact Field Registration Form record first.
    """
    _check_read()
    application_id = (application_id or "").strip()
    if not application_id or not frappe.db.exists(FRF, application_id):
        frappe.throw("Applicant not found")
    if not frappe.has_permission(FRF, "read", doc=application_id):
        frappe.throw("Not permitted to view this applicant", frappe.PermissionError)

    profile_fields = [
        "full_name_aadhaar", "email_address", "phone_number", "gender", "dob",
        "role", "department", "job_code", "location", "state", "district_city",
        "written_subject", "total_experience1", "date_of_applied", "application_status",
        "recruiter_round_status", "functional_round_status", "final_round_status",
    ]
    meta = frappe.get_meta(FRF)
    profile_fields = [f for f in profile_fields if meta.has_field(f)]
    pdf_fields = [f for f in _FRF_ATTACH_LABELS if meta.has_field(f)]
    frf = frappe.db.get_value(FRF, application_id, profile_fields + pdf_fields, as_dict=True) or {}

    profile = [
        {"label": meta.get_label(f), "value": str(frf.get(f)) if frf.get(f) not in (None, "") else ""}
        for f in profile_fields
    ]
    # Only real site file paths become links (never javascript:/data: etc.).
    pdfs = [
        {"label": _FRF_ATTACH_LABELS[f], "url": frf.get(f)}
        for f in pdf_fields
        if (frf.get(f) or "").startswith(("/files/", "/private/files/"))
    ]

    interviews = frappe.get_list(
        FIS,
        filters={"application_id": application_id},
        fields=["name", "interview_round", "interview_date", "start_time", "interview_mode",
                "is_cancelled", "department"],
        order_by="interview_date asc, creation asc",
        limit_page_length=200,
    )

    # Every submission with its full content, so the page can show the
    # feedback itself (not just links to it).
    feedback = []
    for dt in sorted(_allowed_feedback_doctypes()):
        for s in frappe.get_all(dt, filters={"applicant_id": application_id}, pluck="name"):
            doc = frappe.get_doc(dt, s)
            row = _feedback_row(dt, doc)
            row["sections"] = _render_feedback_doc(doc)
            feedback.append(row)
    feedback.sort(key=lambda x: x["submitted_on"])

    return {
        "application_id": application_id,
        "name": frf.get("full_name_aadhaar") or application_id,
        "profile": profile,
        "pdfs": pdfs,
        "interviews": [
            {
                "name": i.name,
                "round": i.interview_round or "",
                "date": str(i.interview_date or ""),
                "start": i.start_time or "",
                "mode": i.interview_mode or "",
                "cancelled": cint(i.is_cancelled),
                "department": i.department or "",
            }
            for i in interviews
        ],
        "feedback": feedback,
    }
