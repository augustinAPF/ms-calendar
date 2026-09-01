import os
import re
import shutil
import frappe


# Strips anything not a word char/space/hyphen, then turns spaces into underscores.
def _sanitize(text):
    return re.sub(r"[^\w\s-]", "", str(text or "")).strip().replace(" ", "_")


# Returns base_filename, or a _01/_02/... suffixed version if that name is already taken.
def _resolve_available_filename(base_filename, ext, exclude_file_name, new_dir):
    stem = base_filename[: -len(ext)] if ext and base_filename.endswith(ext) else base_filename

    candidate = base_filename
    suffix = 0
    while True:
        taken_in_db = frappe.db.exists(
            "File", {"file_name": candidate, "name": ["!=", exclude_file_name]}
        )
        taken_on_disk = os.path.exists(os.path.join(new_dir, candidate))
        if not taken_in_db and not taken_on_disk:
            return candidate
        suffix += 1
        candidate = f"{stem}_{suffix:02d}{ext}"


# Copies source_file_doc's bytes into a new File owned by doc/resume_field,
# for when doc's resume field ended up pointing at a File attached to a
# different record (Frappe's content-hash upload dedup can do this — see
# the call site). Leaves source_file_doc and its real owner untouched.
def _fork_file_for_doc(source_file_doc, doc, resume_field, expected_filename):
    ext = os.path.splitext(expected_filename)[-1]
    source_path = source_file_doc.get_full_path()
    if not os.path.exists(source_path):
        frappe.log_error(
            title="Resume Rename Fork Failed",
            message=(
                f"{doc.doctype} '{doc.name}' field '{resume_field}': source File "
                f"'{source_file_doc.name}' has no physical file at '{source_path}'. Skipping."
            ),
        )
        return

    new_dir = os.path.dirname(source_path)
    new_filename = _resolve_available_filename(
        expected_filename, ext, exclude_file_name=None, new_dir=new_dir
    )
    new_path = os.path.join(new_dir, new_filename)

    try:
        shutil.copy2(source_path, new_path)
    except Exception as e:
        frappe.log_error(
            title="Resume Rename Fork Failed",
            message=f"{doc.doctype} '{doc.name}': copy '{source_path}' -> '{new_path}' failed: {e}",
        )
        return

    if not os.path.exists(new_path):
        frappe.log_error(
            title="Resume Rename Fork Failed",
            message=f"{doc.doctype} '{doc.name}': copy to '{new_path}' did not produce a file.",
        )
        return

    is_private = "/private/" in (source_file_doc.file_url or "")
    new_url = f"/private/files/{new_filename}" if is_private else f"/files/{new_filename}"

    new_file_doc = frappe.get_doc(
        {
            "doctype": "File",
            "file_name": new_filename,
            "file_url": new_url,
            "is_private": 1 if is_private else 0,
            "attached_to_doctype": doc.doctype,
            "attached_to_name": doc.name,
            "attached_to_field": resume_field,
        }
    )
    # Skips File's own save_file()/content-hash dedup — otherwise it would
    # just match this copy back to source_file_doc and undo the fork.
    new_file_doc.flags.copy_from_existing_file = True
    new_file_doc.insert(ignore_permissions=True)

    frappe.db.set_value(doc.doctype, doc.name, resume_field, new_url, update_modified=False)
    doc.set(resume_field, new_url)


# Core rename engine: finds the File attached to `resume_field` on `doc`,
# renames it (on disk + File.file_name/file_url) to
# "<candidate_name>[_<extra_id>]_<doc.name>_<label><ext>", and points
# `doc[resume_field]` at the new URL. Every on_*_registration/on_*_document_
# collection function below is just this, called with that doctype's
# specific field names.
def _rename_resume(doc, resume_field, name_field, label="Resume", extra_id_field=None):
    resume_url = doc.get(resume_field)
    candidate_name = (doc.get(name_field) or "").strip()

    if not resume_url or not candidate_name:
        return

    ext = os.path.splitext(resume_url)[-1].lower() or ".pdf"
    # doc.name included so two candidates with the same name never clash.
    extra_id = (doc.get(extra_id_field) or "").strip() if extra_id_field else ""
    name_parts = [_sanitize(candidate_name)]
    if extra_id:
        name_parts.append(_sanitize(extra_id))
    name_parts.append(doc.name)
    expected_filename = f"{'_'.join(name_parts)}_{label}{ext}"

    # Look up the File by the field's current url; fall back to whatever's
    # attached to this doc/field if that comes up empty.
    file_docs = frappe.get_all(
        "File", filters={"file_url": resume_url}, fields=["name", "file_name"], limit=1
    )
    if not file_docs:
        fallback_docs = frappe.get_all(
            "File",
            filters={
                "attached_to_doctype": doc.doctype,
                "attached_to_name": doc.name,
                "attached_to_field": resume_field,
            },
            fields=["name", "file_name"],
            order_by="creation desc",
        )
        # More than one candidate with no url match to pick between them —
        # don't guess, log and leave everything as-is.
        if len(fallback_docs) > 1:
            frappe.log_error(
                title="Resume Rename Ambiguous",
                message=(
                    f"{doc.doctype} '{doc.name}' field '{resume_field}': {len(fallback_docs)} "
                    f"File records attached with no url match to disambiguate: "
                    f"{[d['name'] for d in fallback_docs]}. Skipping rename."
                ),
            )
            return
        file_docs = fallback_docs
    if not file_docs:
        return

    file_doc = frappe.get_doc("File", file_docs[0]["name"])
    if file_doc.file_name == expected_filename:
        return

    # Frappe's own upload dedup can attach this doc's resume field to a
    # File that actually belongs to a different record (same file
    # content). Renaming it here would steal it from its real owner —
    # fork an independent copy for this doc instead.
    if (
        file_doc.attached_to_doctype != doc.doctype
        or file_doc.attached_to_name != doc.name
        or file_doc.attached_to_field != resume_field
    ):
        _fork_file_for_doc(file_doc, doc, resume_field, expected_filename)
        return

    try:
        old_path = file_doc.get_full_path()
        new_dir = os.path.dirname(old_path)
        # Don't overwrite a different File already using this filename —
        # suffix instead so both files are kept.
        new_filename = _resolve_available_filename(
            expected_filename, ext, exclude_file_name=file_doc.name, new_dir=new_dir
        )
        new_path = os.path.join(new_dir, new_filename)

        if os.path.exists(old_path):
            os.rename(old_path, new_path)
        elif not os.path.exists(new_path):
            # Nothing to rename at either location — don't write a URL that points nowhere.
            return

        # Confirm the rename actually left a file behind before touching the DB.
        if not os.path.exists(new_path):
            frappe.log_error(
                title="Resume Rename Verification Failed",
                message=(
                    f"{doc.doctype} '{doc.name}' field '{resume_field}': renamed "
                    f"'{old_path}' -> '{new_path}' but destination is missing. Skipping DB update."
                ),
            )
            return

        # Private/public prefix taken from file_doc.file_url (matches where the
        # rename actually put the bytes), not from the possibly-stale resume_url.
        is_private = "/private/" in (file_doc.file_url or "")
        new_url = f"/private/files/{new_filename}" if is_private else f"/files/{new_filename}"

        frappe.db.set_value(
            "File", file_doc.name, {"file_name": new_filename, "file_url": new_url}
        )
        # Written via db.set_value from on_update (not validate) so this is the
        # last write in the request and can't be clobbered by the doc's own save.
        frappe.db.set_value(doc.doctype, doc.name, resume_field, new_url, update_modified=False)
        doc.set(resume_field, new_url)

        # Any other File still attached to this doc/field is left alone —
        # it's a file the candidate actually uploaded, not deleted automatically.

    except Exception as e:
        frappe.log_error(
            title="Resume Rename Error",
            message=f"{doc.doctype} '{doc.name}': {e}",
        )


# Renames Phil Registration Form's cv_attach using its name1 field. Hooked to on_update.
def on_phil_registration(doc, method):
    _rename_resume(doc, "cv_attach", "name1")


# Renames Field Registration Form's resume_upload using its full_name_aadhaar field. Hooked to on_update.
def on_field_registration(doc, method):
    _rename_resume(doc, "resume_upload", "full_name_aadhaar")


# Renames Health Registration Form's resume using its full_name field. Hooked to on_update.
def on_health_registration(doc, method):
    _rename_resume(doc, "resume", "full_name")


# Renames Scholarship Recruitment Form's resume__cv using its full_name_as_per_aadhar field. Hooked to on_update.
def on_scholarship_registration(doc, method):
    _rename_resume(doc, "resume__cv", "full_name_as_per_aadhar")


# Attach fields on Philanthrophy Document Collection, paired with each one's filename label.
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


# Renames every attach field listed in _PHIL_DOC_COLLECTION_ATTACH_FIELDS
# on a Philanthrophy Document Collection record. Hooked to on_update.
def on_philanthropy_document_collection(doc, method=None):
    for fieldname, label in _PHIL_DOC_COLLECTION_ATTACH_FIELDS:
        _rename_resume(doc, fieldname, "applicant_name", label=label, extra_id_field="applicant_id")


# Attach fields on Health Document Collection, paired with each one's filename label.
_HEALTH_DOC_COLLECTION_ATTACH_FIELDS = [
    ("pan_card", "PanCard"),
    ("aadhaar_card", "AadhaarCard"),
    ("mbbs_completion", "MBBSCompletionCertificate"),
    ("council_registration", "StateMedicalCouncilRegistration"),
    ("previous_work_experience_letters", "WorkExperienceLetters"),
]


# Renames every attach field listed in _HEALTH_DOC_COLLECTION_ATTACH_FIELDS
# on a Health Document Collection record. Hooked to on_update.
def on_health_document_collection(doc, method=None):
    for fieldname, label in _HEALTH_DOC_COLLECTION_ATTACH_FIELDS:
        _rename_resume(doc, fieldname, "applicant_name", label=label, extra_id_field="applicant_id")
