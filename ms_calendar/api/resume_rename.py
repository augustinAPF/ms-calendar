import os
import re
import frappe


def _sanitize(text):
    return re.sub(r"[^\w\s-]", "", str(text or "")).strip().replace(" ", "_")


def _rename_resume(doc, resume_field, name_field, label="Resume", extra_id_field=None):
    resume_url = doc.get(resume_field)
    candidate_name = (doc.get(name_field) or "").strip()

    if not resume_url or not candidate_name:
        return

    ext = os.path.splitext(resume_url)[-1].lower() or ".pdf"
    # Include doc name (e.g. APPRF-0101) so two "Reshma" files never clash.
    # extra_id_field additionally inserts another field's value (e.g. a
    # Document Collection record's "applicant_id", which points back at
    # the actual application form — distinct from this record's own name)
    # so the filename cross-references both IDs.
    extra_id = (doc.get(extra_id_field) or "").strip() if extra_id_field else ""
    name_parts = [_sanitize(candidate_name)]
    if extra_id:
        name_parts.append(_sanitize(extra_id))
    name_parts.append(doc.name)
    expected_filename = f"{'_'.join(name_parts)}_{label}{ext}"

    # Prefer the File record matching the field's current url — but fall
    # back to whatever's actually attached to this field/doc if that
    # lookup comes up empty. An earlier interrupted rename can leave the
    # field's stored url pointing at a File record that no longer
    # matches reality (see the doc.db_set() note below for why).
    file_docs = frappe.get_all(
        "File", filters={"file_url": resume_url}, fields=["name", "file_name"], limit=1
    )
    if not file_docs:
        file_docs = frappe.get_all(
            "File",
            filters={
                "attached_to_doctype": doc.doctype,
                "attached_to_name": doc.name,
                "attached_to_field": resume_field,
            },
            fields=["name", "file_name"],
            order_by="creation desc",
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
        elif not os.path.exists(new_path):
            # Neither the expected old location nor the target already
            # has a real file on disk — nothing to actually rename, and
            # writing metadata that points at a filename that doesn't
            # exist would recreate the exact bug this guards against.
            return

        is_private = "/private/" in resume_url
        new_url = f"/private/files/{new_filename}" if is_private else f"/files/{new_filename}"

        frappe.db.set_value(
            "File", file_doc.name, {"file_name": new_filename, "file_url": new_url}
        )
        # doc.set() alone is NOT enough here: this runs from an on_update
        # hook, which fires AFTER this save's own INSERT/UPDATE already
        # committed. doc.set() only mutates this in-memory instance —
        # discarded once the request ends — so the field's real DB value
        # never actually followed the rename, leaving it pointing at a
        # filename that stops existing the moment the physical file above
        # gets renamed away from it. Write the column directly instead.
        frappe.db.set_value(doc.doctype, doc.name, resume_field, new_url, update_modified=False)
        doc.set(resume_field, new_url)

        # Clean up any other File record still claiming this exact
        # field/doc — a leftover from an earlier interrupted rename that
        # would otherwise sit around forever pointing at nothing.
        for stale_name in frappe.get_all(
            "File",
            filters={
                "attached_to_doctype": doc.doctype,
                "attached_to_name": doc.name,
                "attached_to_field": resume_field,
                "name": ["!=", file_doc.name],
            },
            pluck="name",
        ):
            frappe.delete_doc("File", stale_name, ignore_permissions=True, force=True)

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


# Every Attach field on Philanthrophy Document Collection, paired with the
# label that goes into its renamed filename (e.g. "Mahaveer_Ram_APPDC-0007_PanCard.pdf").
_PHIL_DOC_COLLECTION_ATTACH_FIELDS = [
    ("pan_card", "PanCard"),
    ("aadhaar_card", "AadhaarCard"),
    ("class_x_certificate", "ClassXCertificate"),
    ("class_xii_certificate", "ClassXIICertificate"),
    ("degree_certificate", "UGDegreeCertificate"),
    ("pg_certificate", "PGCertificate"),
    ("phd_certificate", "PHDCertificate"),
    ("experience_letter", "ExperienceLetter"),
    ("salary_revision_letter", "SalaryRevisionLetter"),
    ("pay_slips", "PaySlips"),
]


def on_philanthropy_document_collection(doc, method=None):
    for fieldname, label in _PHIL_DOC_COLLECTION_ATTACH_FIELDS:
        _rename_resume(doc, fieldname, "applicant_name", label=label, extra_id_field="applicant_id")


# Same idea, for Health Document Collection's own Attach fields. hooks.py
# has referenced "resume_rename.on_health_document_collection" for this
# doctype's on_update event for a while, but the function itself was never
# actually written — every save was silently trying (and failing) to call
# a function that didn't exist. This is that function.
_HEALTH_DOC_COLLECTION_ATTACH_FIELDS = [
    ("pan_card", "PanCard"),
    ("aadhaar_card", "AadhaarCard"),
    ("mbbs_completion", "MBBSCompletionCertificate"),
    ("council_registration", "StateMedicalCouncilRegistration"),
    ("previous_work_experience_letters", "WorkExperienceLetters"),
]


def on_health_document_collection(doc, method=None):
    for fieldname, label in _HEALTH_DOC_COLLECTION_ATTACH_FIELDS:
        _rename_resume(doc, fieldname, "applicant_name", label=label, extra_id_field="applicant_id")
