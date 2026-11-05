"""Has this panel member already submitted the interview feedback?

Called by public/js/feedback_form_draft.js when a feedback web form opens
from the interview invite (?panel=) or a personal link (?panelist_email=).
Once a panel member has submitted, their link shows "Feedback already
submitted" instead of an empty form; on the "Who is filling this feedback?"
picker their name is shown as Submitted and can't be picked. When the whole
panel is done (or a Consolidated feedback was submitted) the link is closed
for everyone. A Save (draft) is browser-only and never counts.

Only feedback for THIS interview counts: the schedule is found with each
module's own "which interview is this feedback for" helper, and only
feedback created after that schedule is looked at, so an earlier round's
feedback in the same doctype doesn't close a new round's link.

Answers only "which of these emails have submitted" (and whether the
signed-in user is one of them) for the emails the link itself carries,
nothing else. Any error → nothing counts as submitted, so
the form simply opens as before.
"""

import json
import re

import frappe

PANELIST_EMAIL_FIELDS = ("panelist_email", "panelist__email", "interviewer_email")
PANELIST_NAME_FIELDS = ("panelist_name", "panal_name", "interviewer_name")
TYPE_FIELDS = ("interview_type", "interview_feedback_type", "select_the_interview_type")
ENABLERS_DOCTYPES = ("Enablers Feedback Form", "Finance Fellowship Feedback Form")
PHIL_DOCTYPE = "Philanthrophy Feedback Form"
MAX_PANEL = 30


def _module(doctype):
    from ms_calendar.api import ms_field, ms_health, msgraph

    if doctype in ENABLERS_DOCTYPES:
        return "enablers"
    if doctype == PHIL_DOCTYPE:
        return "phil"
    if doctype in {d for docs in ms_field.FIELD_FEEDBACK_ROUND_MAP.values() for d in docs}:
        return "field"
    if doctype in set(ms_health.ROUND_TO_FEEDBACK_DOCTYPE.values()):
        return "health"
    if doctype in set(msgraph.SCHOLARSHIP_FEEDBACK_DOCTYPES.values()):
        return "scholarship"
    return None


def _find_schedule(module, doctype, link_id, emails, names):
    """The interview schedule this link is for, or None."""
    if module == "enablers":
        from ms_calendar.api.enablers_panel import SCHEDULE_DOCTYPE

        if frappe.db.exists(SCHEDULE_DOCTYPE, link_id):
            return frappe.get_doc(SCHEDULE_DOCTYPE, link_id)
        return None
    probe = frappe._dict(
        doctype=doctype,
        applicant_id=link_id,
        creation=frappe.utils.now_datetime(),
        # Field picks the schedule the panelist was on; Philanthropy matches
        # by email / name (see ms_philanthropy._feedback_panel_emails).
        panelist_email=", ".join(emails),
        email="",
        owner="Guest",
        interviewer_name=", ".join(n for n in names.values() if n),
    )
    if module == "field":
        from ms_calendar.api.ms_field import _find_field_schedule_for_feedback as find
    elif module == "health":
        from ms_calendar.api.ms_health import _find_schedule_for_feedback as find
    elif module == "scholarship":
        from ms_calendar.api.msgraph import _find_interview_schedule_for_feedback as find
    elif module == "phil":
        from ms_calendar.api.ms_philanthropy import _find_schedule_for_feedback as find
    else:
        return None
    return find(probe)


def _schedule_mode(schedule):
    """online / in_person / phone / hybrid, from whichever mode field the
    unit's schedule has (Field: Online|Face-to-Face|Phone|Hybrid, Health
    interview_type: Online|Offline|Phone|Hybrid, Phil / Scholarship:
    Online|Offline|Hybrid, Enablers: Online (MS Teams)|In-person|Hybrid).
    Older records with no mode fall back to the "virtual call" checkbox."""
    raw = ""
    for f in ("interview_mode", "interview_type"):
        value = schedule.get(f)
        if isinstance(value, str) and value.strip():
            raw = value.strip().lower()
            break
    if "hybrid" in raw:
        return "hybrid"
    if "online" in raw or "teams" in raw:
        return "online"
    if "phone" in raw:
        return "phone"
    if raw:
        return "in_person"
    return "online" if schedule.get("interview_type") in (1, "1", True) else "in_person"


def _online_panel(schedule):
    """Hybrid: the members who join online (the Hybrid / online group)."""
    if schedule.doctype == "Enablers Interview Schedule":
        from ms_calendar.api.enablers_panel import online_panel

        return [e.lower() for e in online_panel(schedule)]
    rows = list(schedule.get("hybrid_interviewers_email") or []) + list(
        schedule.get("hybrid_interview_email") or []
    )
    return [(r.interviewer_email or "").strip().lower() for r in rows if r.get("interviewer_email")]


def _schedule_info(schedule):
    """What the feedback form fills in from the interview itself."""
    if not schedule:
        return {}
    mode = _schedule_mode(schedule)
    return {
        "interview_date": str(schedule.get("interview_date") or ""),
        "mode": mode,
        "online_panel": _online_panel(schedule) if mode == "hybrid" else [],
    }


def _split(value, pattern):
    return [p.strip().lower() for p in re.split(pattern, value or "") if p.strip()]


def _covers(module, fb, emails, names):
    """Panel emails (of the ones asked about) this feedback was submitted for."""
    if module == "phil":
        from ms_calendar.api.ms_philanthropy import _feedback_panel_emails

        return _feedback_panel_emails(fb, emails, names)
    # A Consolidated feedback holds several emails / names, comma-separated.
    typed_emails = {e for f in PANELIST_EMAIL_FIELDS for e in _split(fb.get(f), r"[,;\s]+")}
    hit = {e for e in emails if e in typed_emails}
    if hit:
        return hit
    typed_names = {n for f in PANELIST_NAME_FIELDS for n in _split(fb.get(f), r"[,;]")}
    return {e for e in emails if (names.get(e) or "").strip().lower() in typed_names}


@frappe.whitelist(allow_guest=True)
def submitted_feedback(doctype, link_id, panel):
    """panel: JSON [{"email": ..., "name": ...}, ...] from the link.
    Returns {"submitted": [emails that already submitted], "consolidated": bool,
    "me": the signed-in user's email if they are on this panel, else ""}.

    "me" lets the form pick the panel member by itself: the invite is one
    Outlook meeting with the same link for everyone, so the link can't say
    who clicked it, but a signed-in session (e.g. after "Sign in with
    Microsoft") can."""
    empty = {"submitted": [], "consolidated": False, "me": "", "schedule": {}}
    try:
        module = _module(doctype)
        link_id = (link_id or "").strip()
        if not (module and link_id):
            return empty
        people = json.loads(panel) if isinstance(panel, str) else (panel or [])
        names = {}
        for p in people[:MAX_PANEL]:
            email = str((p or {}).get("email") or "").strip().lower()
            if email and "@" in email:
                names[email] = str(p.get("name") or "").strip()
        emails = list(names)
        if not emails:
            return empty
        user = (frappe.session.user or "").strip().lower()
        me = user if user in emails else ""
        empty["me"] = me

        from ms_calendar.api.ms_field import _field_panelist_names

        # The Interviewer Email List name fills in where the link had none.
        for e, n in _field_panelist_names(emails).items():
            names[e] = names.get(e) or n

        meta = frappe.get_meta(doctype)
        wanted = (
            PANELIST_EMAIL_FIELDS + PANELIST_NAME_FIELDS + TYPE_FIELDS + ("email", "owner")
        )
        fields = ["name", "owner"] + [f for f in wanted if f != "owner" and meta.has_field(f)]

        schedule = _find_schedule(module, doctype, link_id, emails, names)
        if module == "enablers":
            filters = {"interview_schedule": link_id}
        else:
            filters = {"applicant_id": link_id}
            if schedule:
                # Feedback from before this interview belongs to an earlier one.
                filters["creation"] = [">=", schedule.creation]

        done, consolidated = set(), False
        for fb in frappe.get_all(doctype, filters=filters, fields=fields, limit=200):
            covers = _covers(module, fb, emails, names)
            done |= covers
            if covers and any((fb.get(f) or "").strip() == "Consolidated" for f in TYPE_FIELDS):
                consolidated = True
        return {
            "submitted": sorted(done),
            "consolidated": consolidated,
            "me": me,
            # Interview date + mode for the form to fill in.
            "schedule": _schedule_info(schedule),
        }
    except Exception:
        frappe.log_error(title="Feedback Submitted Check Error", message=frappe.get_traceback()[:2000])
        return empty


@frappe.whitelist(allow_guest=True)
def microsoft_login_url(redirect_to):
    """Microsoft (Office 365) sign-in that comes straight back to this
    feedback form, so the form knows who is filling it. "" when the site has
    no enabled Office 365 Social Login Key (the form then only asks for the
    email). Only a path on this site is accepted as redirect_to."""
    redirect_to = (redirect_to or "").strip()
    if not redirect_to.startswith("/") or redirect_to.startswith("//") or "\\" in redirect_to:
        return ""
    try:
        if not frappe.db.get_value("Social Login Key", "office_365", "enable_social_login"):
            return ""
        from frappe.utils.oauth import get_oauth2_authorize_url

        return get_oauth2_authorize_url("office_365", redirect_to)
    except Exception:
        frappe.log_error(title="Feedback Microsoft Login URL Error", message=frappe.get_traceback()[:2000])
        return ""
