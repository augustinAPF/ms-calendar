import os
import re
import frappe


def _sanitize(text):
    return re.sub(r"[^\w\s-]", "", str(text or "")).strip().replace(" ", "_")


def _rename_resume(doc, resume_field, name_field):
    resume_url = doc.get(resume_field)
    candidate_name = (doc.get(name_field) or "").strip()

    if not resume_url or not candidate_name:
        return

    ext = os.path.splitext(resume_url)[-1].lower() or ".pdf"
    # Include doc name (e.g. APPRF-0101) so two "Reshma" files never clash
    expected_filename = f"{_sanitize(candidate_name)}_{doc.name}_Resume{ext}"

    file_docs = frappe.get_all(
        "File",
        filters={"file_url": resume_url},
        fields=["name", "file_name"],
        limit=1,
    )
    if not file_docs:
        return

    file_doc = frappe.get_doc("File", file_docs[0]["name"])
    if file_doc.file_name == expected_filename:
        return

    try:
        old_path = file_doc.get_full_path()
        new_filename = expected_filename
        new_dir = os.path.dirname(old_path)
        new_path = os.path.join(new_dir, new_filename)

        if os.path.exists(old_path):
            os.rename(old_path, new_path)

        is_private = "/private/" in resume_url
        new_url = f"/private/files/{new_filename}" if is_private else f"/files/{new_filename}"

        frappe.db.set_value(
            "File", file_doc.name, {"file_name": new_filename, "file_url": new_url}
        )
        doc.set(resume_field, new_url)

    except Exception as e:
        frappe.log_error(
            title="Resume Rename Error",
            message=f"{doc.doctype} '{doc.name}': {e}",
        )


def on_phil_registration(doc, method):
    _rename_resume(doc, "cv_attach", "name1")


def on_field_registration(doc, method):
    _rename_resume(doc, "resume_upload", "full_name_aadhaar")


def on_health_registration(doc, method):
    _rename_resume(doc, "resume", "full_name")


def on_scholarship_registration(doc, method):
    _rename_resume(doc, "resume__cv", "full_name_as_per_aadhar")
