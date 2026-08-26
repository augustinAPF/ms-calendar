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

        # Sniff "/private/" from file_doc.file_url — NOT from `resume_url`
        # (this doc's own Attach-field text, captured before this rename).
        # file_doc.file_url is what get_full_path() above actually used to
        # locate old_path/new_dir, so it's the only value guaranteed to
        # match the folder the file was just renamed within. `resume_url`
        # goes stale the moment a File's privacy changes independently of
        # this doc — e.g. someone toggles "Make Private" on the File
        # record itself, which moves the physical file and updates the
        # File's own file_url but has no way to reach back and update
        # every other doc/field whose Attach text still names the old
        # public/private URL (see file_access_utils.get_file_bytes_
        # resilient's own note on this same drift). Sniffing the stale
        # doc-field text here would write a new_url whose /files/ vs
        # /private/files/ prefix doesn't match where the rename above
        # actually left the bytes, leaving the field pointing at a URL
        # that 404s despite the file existing right next to it under the
        # other prefix.
        is_private = "/private/" in (file_doc.file_url or "")
        new_url = f"/private/files/{new_filename}" if is_private else f"/files/{new_filename}"

        frappe.db.set_value(
            "File", file_doc.name, {"file_name": new_filename, "file_url": new_url}
        )
        # This must run from an on_update/after_insert hook (this doc's own
        # INSERT/UPDATE has already committed by then) so that writing the
        # column directly here is the final word — nothing later in the same
        # request overwrites it. Wiring this to `validate` instead is what
        # caused the bug this replaces: `validate` fires BEFORE the doc's own
        # save, so Frappe's trailing UPDATE at the end of that same save
        # could clobber this db.set_value with the pre-rename value the
        # in-memory doc still held, leaving the field pointing at a filename
        # that no longer exists (the physical file was already renamed away
        # from it) while the File list still showed the doc as attached.
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
