"""
"Update Feedback" for the Field interview feedback forms.

Flow:
1. Field Interview Dashboard → a feedback's "Update feedback" link →
   request_feedback_update() emails the interviewer a signed link to the SAME
   web form: /<route>/new?update_feedback=<name>&ue=<email>&ur=<requester>&uk=<sig>
2. feedback_form_draft.js sees ?update_feedback= and, instead of a blank form,
   loads that submission (get_feedback_for_update), shows every answer
   read-only and, below it, ONE "Updated feedback" text box.
3. submit_feedback_update() appends the text (date + who) to the feedback's
   "Updated Feedback" field (feedback_update), leaves a comment on it and
   emails the requester.

The text box only exists in that update view: feedback_update is not a web
form field, and in the desk it is read-only and hidden while empty.

The link is the only key a Guest gets: an HMAC of doctype + name + email +
requester with the site's encryption key, so it can't be altered to reach
another submission.
"""

import hashlib
import hmac
from urllib.parse import quote, urlencode

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field
from frappe.utils import escape_html, format_datetime, get_url, now_datetime, validate_email_address
from frappe.utils.password import get_encryption_key

from ms_calendar.api import ms_field
from ms_calendar.api.ms_field import FIELD_FEEDBACK_ROUND_MAP

UPDATE_FIELD = "feedback_update"
UPDATE_LABEL = "Updated Feedback"
MAX_TEXT = 10000


def _feedback_doctypes():
    """Every Field feedback DocType this site has (FIELD_FEEDBACK_ROUND_MAP)."""
    names = {dt for dts in FIELD_FEEDBACK_ROUND_MAP.values() for dt in dts}
    return sorted(dt for dt in names if frappe.db.exists("DocType", dt))


def _check_doctype(doctype):
    if doctype not in _feedback_doctypes():
        frappe.throw("Not a Field feedback form", frappe.PermissionError)


# ── schema ──────────────────────────────────────────────────────────────
def ensure_feedback_update_fields():
    """after_migrate, idempotent: the read-only "Updated Feedback" field on
    every Field feedback DocType (custom DocTypes, so it's a Custom Field).
    Placed at the end of the form, hidden while empty."""
    for doctype in _feedback_doctypes():
        if frappe.get_meta(doctype).has_field(UPDATE_FIELD):
            continue
        last = frappe.get_meta(doctype).fields
        insert_after = last[-1].fieldname if last else None
        try:
            cf = {
                "fieldname": UPDATE_FIELD,
                "label": UPDATE_LABEL,
                "fieldtype": "Long Text",
                "read_only": 1,
                "no_copy": 1,
                "depends_on": f"eval:doc.{UPDATE_FIELD}",
                "description": "Added by the interviewer through the \"Update feedback\" link "
                "(Field Interview Dashboard). Newest last.",
            }
            if insert_after:
                cf["insert_after"] = insert_after
            create_custom_field(doctype, cf, ignore_validate=True)
        except Exception:
            frappe.log_error(title=f"Feedback update field: {doctype}", message=frappe.get_traceback())


# ── signed link ─────────────────────────────────────────────────────────
def _sign(doctype, name, email, requester):
    msg = "|".join([doctype, name, (email or "").lower(), (requester or "").lower()]).encode()
    return hmac.new(get_encryption_key().encode(), msg, hashlib.sha256).hexdigest()[:40]


def _verify(doctype, name, email, requester, key):
    _check_doctype(doctype)
    if not key or not hmac.compare_digest(_sign(doctype, name, email, requester), str(key)):
        frappe.throw("This update link is not valid.", frappe.PermissionError)
    if not frappe.db.exists(doctype, name):
        frappe.throw("This feedback no longer exists.")


def _known_routes():
    """Web form routes the interview invites use (ms_field URL maps) —
    preferred when a DocType has several web forms (Field / Health / Enablers)."""
    routes = set()
    for m in (
        ms_field._EDUCATION_FEEDBACK_URLS,
        ms_field._LIVELIHOOD_FEEDBACK_URLS,
        ms_field._HEALTH_FEEDBACK_URLS,
        ms_field._ENABLER_FEEDBACK_URLS,
    ):
        for url in m.values():
            path = url.split("://", 1)[-1].split("/", 1)[-1]
            routes.add(path.split("/", 1)[0])
    return routes


def _web_form_route(doctype, department):
    """The published web form of this feedback DocType, matched to the
    applicant's department when there are several."""
    forms = frappe.get_all(
        "Web Form", filters={"doc_type": doctype, "published": 1}, pluck="route", order_by="creation asc"
    )
    if not forms:
        return ""
    dept = (department or "").lower()
    known = _known_routes()

    def score(route):
        r = route.lower()
        s = 0
        for word, key in (("health", "health"), ("livelihood", "livelihood"), ("enabler", "enablers")):
            if key in r:
                s += 4 if word in dept else -4
        if route in known:
            s += 2
        return s

    return max(forms, key=score)


def _applicant_department(doc):
    app = doc.get("applicant_id")
    if not app or not frappe.db.exists("Field Registration Form", app):
        return ""
    return frappe.db.get_value("Field Registration Form", app, "department") or ""


def _applicant_name(doc):
    return (doc.get("applicant_name") or "").strip() or (doc.get("applicant_id") or "")


# ── desk: send the link ─────────────────────────────────────────────────
@frappe.whitelist()
def request_feedback_update(doctype, name, email, message=None):
    """Field Interview Dashboard → "Update feedback": emails `email` (the
    interviewer) a link to their submission with one box to add to it.
    Same permission check as the dashboard's get_feedback_detail."""
    from ms_calendar.ms_calendar.page.field_interview_dashboard import field_interview_dashboard as fid

    fid._check_read()
    _check_doctype(doctype)
    if not frappe.db.exists(doctype, name):
        frappe.throw("Feedback not found")
    doc = frappe.get_doc(doctype, name)
    if not doc.get("applicant_id") or not frappe.get_list(
        fid.FIS, filters={"application_id": doc.applicant_id}, pluck="name", limit_page_length=1
    ):
        frappe.throw("Not permitted to update this feedback", frappe.PermissionError)

    email = (email or "").strip().lower()
    if not validate_email_address(email):
        frappe.throw(f"Not a valid email address: {escape_html(email)}")

    route = _web_form_route(doctype, _applicant_department(doc))
    if not route:
        frappe.throw(f"No published web form found for {escape_html(doctype)}")

    requester = frappe.session.user
    query = urlencode({
        "update_feedback": name,
        "ue": email,
        "ur": requester,
        "uk": _sign(doctype, name, email, requester),
    })
    link = f"{get_url()}/{quote(route)}/new?{query}"

    applicant = _applicant_name(doc)
    who = ms_field._field_panelist_names([email]).get(email) or email
    note = (message or "").strip()
    body = f"""
    <p>Dear {escape_html(who)},</p>
    <p>Please review the feedback you submitted for <b>{escape_html(applicant)}</b>
    ({escape_html(doctype)}, submitted on {escape_html(format_datetime(doc.creation, "dd-MM-yyyy HH:mm"))})
    and add your update.</p>
    {f'<p><b>Note:</b> {escape_html(note)}</p>' if note else ''}
    <p>Your earlier answers are shown read-only; type your update in the box at the bottom
    and click <b>Submit update</b>.</p>
    <p><a href="{link}" target="_blank"
        style="display:inline-block;padding:9px 16px;background:#1f2937;color:#fff;border-radius:6px;text-decoration:none;">
        Update feedback</a></p>
    <p style="color:#6b7280;font-size:12px;">If the button doesn't work, open: {escape_html(link)}</p>
    <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
    """
    frappe.sendmail(
        recipients=[email],
        subject=f"Please update your interview feedback – {applicant}",
        message=body,
        reference_doctype=doctype,
        reference_name=name,
        delayed=False,
    )
    doc.add_comment(
        "Info",
        f"Feedback update requested from {escape_html(email)} by {escape_html(frappe.utils.get_fullname(requester))}"
        + (f": {escape_html(note)}" if note else ""),
    )
    return {"sent_to": email, "link": link}


# ── web form (Guest): read + update ─────────────────────────────────────
_SKIP_TYPES = {"Section Break", "Column Break", "Tab Break", "HTML", "Button", "Fold", "Heading", "Image"}


@frappe.whitelist(allow_guest=True)
def get_feedback_for_update(doctype, name, ue, ur, uk):
    """The submission's answers for the read-only update view."""
    _verify(doctype, name, ue, ur, uk)
    doc = frappe.get_doc(doctype, name)
    values = {}
    for df in frappe.get_meta(doctype).fields:
        if df.fieldtype in _SKIP_TYPES or df.fieldname == UPDATE_FIELD:
            continue
        v = doc.get(df.fieldname)
        if df.fieldtype in ("Table", "Table MultiSelect"):
            v = [
                {k: val for k, val in row.as_dict().items()
                 if k not in ("name", "parent", "parenttype", "parentfield", "owner", "modified_by",
                              "creation", "modified", "docstatus")}
                for row in (v or [])
            ]
        elif v is not None and not isinstance(v, (str, int, float)):
            v = str(v)
        values[df.fieldname] = v
    return {
        "values": values,
        "applicant": _applicant_name(doc),
        "submitted_on": format_datetime(doc.creation, "dd-MM-yyyy HH:mm"),
        "previous": doc.get(UPDATE_FIELD) or "",
        "who": ms_field._field_panelist_names([ue]).get((ue or "").lower()) or ue,
    }


@frappe.whitelist(allow_guest=True, methods=["POST"])
def submit_feedback_update(doctype, name, ue, ur, uk, text):
    """Appends the interviewer's update to the "Updated Feedback" field.
    Written with db.set_value so the form's own save hooks (status change,
    PDF, emails) don't run again for an addition."""
    _verify(doctype, name, ue, ur, uk)
    text = (text or "").strip()
    if not text:
        frappe.throw("Please type your update first.")
    if len(text) > MAX_TEXT:
        frappe.throw(f"Please keep the update under {MAX_TEXT} characters.")
    if not frappe.get_meta(doctype).has_field(UPDATE_FIELD):
        ensure_feedback_update_fields()

    who = ms_field._field_panelist_names([ue]).get((ue or "").lower()) or ue
    stamp = format_datetime(now_datetime(), "dd-MM-yyyy HH:mm")
    previous = (frappe.db.get_value(doctype, name, UPDATE_FIELD) or "").rstrip()
    entry = f"[{stamp} · {who}]\n{text}"
    frappe.db.set_value(
        doctype, name, UPDATE_FIELD, (previous + "\n\n" + entry) if previous else entry, update_modified=True
    )

    doc = frappe.get_doc(doctype, name)
    doc.add_comment("Info", f"Feedback updated by {escape_html(who)}: {escape_html(text)}")

    if ur and "@" in ur:
        try:
            frappe.sendmail(
                recipients=[ur],
                subject=f"Feedback updated – {_applicant_name(doc)}",
                message=f"""<p>{escape_html(who)} added an update to their feedback for
                <b>{escape_html(_applicant_name(doc))}</b> ({escape_html(doctype)} {escape_html(name)}):</p>
                <blockquote style="border-left:3px solid #d1d5db;margin:8px 0;padding:4px 12px;">
                {escape_html(text).replace(chr(10), '<br>')}</blockquote>""",
                reference_doctype=doctype,
                reference_name=name,
            )
        except Exception:
            frappe.log_error(title="Feedback update: requester email", message=frappe.get_traceback())
    return {"ok": True, "saved_on": stamp}
