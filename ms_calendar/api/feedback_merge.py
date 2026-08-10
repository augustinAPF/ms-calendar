import frappe
from frappe.utils.file_manager import save_file
from frappe.utils.pdf import get_pdf


def _build_feedback_pdf(applicant_id):
    """Core PDF-merge logic, shared by the whitelisted, permission-checked
    entrypoint below and on_feedback_form_submitted's automated hook — the
    hook runs as whoever just submitted feedback (often not someone with
    write access to Phil Registration Form), so it calls this directly
    rather than through generate_feedback_pdf()'s permission gate.
    """
    feedbacks = frappe.get_all(
        "Philanthrophy Feedback Form",
        filters={"applicant_id": applicant_id},
        fields=[
            "name",
            "application_status",
            "interviewer_name",
            "phil_feedback",
            "feedback_date",
            "interview_status",
        ],
        order_by="creation asc",
    )

    if not feedbacks:
        return {"status": "error", "message": "No feedback found"}

    # `applicant_id` here IS the Phil Registration Form's own docname —
    # Philanthrophy Feedback Form.applicant_id is a Link field pointing
    # straight at it (see its DocField "options": "Phil Registration
    # Form"), not a separate identifier to look up. The previous version of
    # this function queried Phil Registration Form for a column named
    # "applicant_id", which doesn't exist there at all — an "Unknown
    # column" SQL error on every single call, meaning this had never
    # actually produced a PDF for anyone.
    reg_name = applicant_id
    if not frappe.db.exists("Phil Registration Form", reg_name):
        return {"status": "error", "message": "Registration not found"}

    health_reg = frappe.get_doc("Phil Registration Form", reg_name)

    applicant_name = health_reg.name1 or applicant_id
    role = health_reg.role or "N/A"

    html = f"""
    <h1>Interview Feedback Summary</h1>
    <p><b>Applicant ID:</b> {applicant_id}</p>
    <p><b>Applicant Name:</b> {applicant_name}</p>
    <p><b>Role:</b> {role}</p>
    <hr>
    """

    for fb in feedbacks:
        html += f"""
        <p><b>Round:</b> {fb.application_status}</p>
        <p><b>Interviewer:</b> {fb.interviewer_name}</p>
        <p><b>Date:</b> {fb.feedback_date or ''}</p>
        <p><b>Status:</b> {fb.interview_status}</p>
        <p><b>Feedback:</b> {fb.phil_feedback}</p>
        <hr>
        """

    pdf = get_pdf(html)
    filename = f"feedback_{applicant_id}.pdf"

    # Regenerating replaces the previous combined PDF rather than piling up
    # a new file every time another round's feedback comes in. Matched by
    # attached_to_doctype/name/field, NOT by file_name — save_file() below
    # appends a random suffix to dodge an on-disk name collision the very
    # first time this runs, so the file that's actually sitting there is
    # never named exactly "feedback_<id>.pdf" to begin with; matching on
    # the bare name (as this used to) never found anything to delete.
    old_files = frappe.get_all(
        "File",
        filters={
            "attached_to_doctype": "Phil Registration Form",
            "attached_to_name": reg_name,
            "attached_to_field": "feedback_form",
        },
        pluck="name",
    )
    for f in old_files:
        frappe.delete_doc("File", f, force=True, ignore_permissions=True)

    file_doc = save_file(
        fname=filename,
        content=pdf,
        dt="Phil Registration Form",
        dn=reg_name,
        df="feedback_form",
        is_private=1,
    )
    file_url = file_doc.file_url

    health_reg.feedback_form = file_url
    health_reg.save(ignore_permissions=True)

    return {
        "status": "success",
        "file_url": file_url,
        "message": "PDF generated and attached successfully",
    }


@frappe.whitelist()
def generate_feedback_pdf(applicant_id):
    if not applicant_id:
        return {"status": "error", "message": "Applicant ID required"}

    if not frappe.has_permission("Phil Registration Form", "write"):
        frappe.throw(
            "You don't have permission to generate feedback PDFs.",
            frappe.PermissionError,
        )

    try:
        result = _build_feedback_pdf(applicant_id)
        # Explicit commit here (not inside the shared helper): this runs as
        # its own standalone request, unlike on_feedback_form_submitted's
        # call below, which happens mid-transaction inside another doc's
        # insert — frappe.db.commit() there is a silently-ignored no-op
        # anyway, since Frappe disables manual commits during doc events.
        frappe.db.commit()
        return result
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Feedback PDF Error")
        return {"status": "error", "message": str(e)}


def on_feedback_form_submitted(doc, method=None):
    """doc_events hook: after_insert of Philanthrophy Feedback Form.

    Keeps the candidate's combined feedback PDF (Phil Registration Form's
    "feedback_form" field — the one the interview-scheduling flow attaches
    to the next round's calendar invite, see
    philanthropy_interview_schedule.js's get_feedback_files()) up to date
    the moment a new round's feedback is submitted, instead of relying on
    generate_feedback_pdf() ever being triggered by hand — nothing in the
    app called it before this.

    Best-effort: never blocks the feedback submission itself. Whoever just
    submitted feedback through the public web form is very often not
    someone with write access to Phil Registration Form, so this calls the
    permission-free core builder directly rather than the whitelisted,
    permission-checked generate_feedback_pdf().
    """
    if not doc.applicant_id:
        return
    try:
        _build_feedback_pdf(doc.applicant_id)
    except Exception:
        frappe.log_error(
            title="Feedback PDF Auto-Generate Error",
            message=f"Philanthrophy Feedback Form {doc.name} ({doc.applicant_id}): {frappe.get_traceback()}",
        )
