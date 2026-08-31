import os
import re
import frappe


# Strips anything not a word char/space/hyphen, then turns spaces into underscores.
def _sanitize(text):
    return re.sub(r"[^\w\s-]", "", str(text or "")).strip().replace(" ", "_")


def _resolve_available_filename(base_filename, ext, exclude_file_name, new_dir):
    """
    Returns a filename guaranteed not to collide with any OTHER File's
    file_name (DB) or a real file already on disk, so a duplicate upload
    never overwrites/replaces a file that's still in use.

    base_filename is the full expected name INCLUDING ext, e.g.
    "Nishanth_APFFRF-001_Resume.pdf". If that name is already taken by
    some other File record (or unexpectedly already exists on disk) this
    tries "..._Resume_01.pdf", "..._Resume_02.pdf", etc. until it finds a
    free one. exclude_file_name lets the caller's own File record (which
    may already be sitting at base_filename, e.g. a re-run) not count as
    a collision against itself.
    """
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
        # More than one File claims this exact doc/field with no url match
        # to disambiguate which one is actually live — picking "most
        # recent" here would be a guess, and guessing wrong renames the
        # wrong physical file while writing the right-looking URL into the
        # DB, which is exactly how a File ends up 404ing despite the
        # database looking correct. Abort instead of guessing; the
        # existing resume_upload/File.file_url stay untouched and the
        # currently-live file (whichever it is) remains accessible.
        if len(fallback_docs) > 1:
            frappe.log_error(
                title="Resume Rename Ambiguous",
                message=(
                    f"{doc.doctype} '{doc.name}' field '{resume_field}': resume_url "
                    f"'{resume_url}' did not match any File.file_url, and {len(fallback_docs)} "
                    f"File records are attached to this doc/field with no way to tell which "
                    f"is live: {[d['name'] for d in fallback_docs]}. Skipping rename."
                ),
            )
            return
        file_docs = fallback_docs
    if not file_docs:
        return

    file_doc = frappe.get_doc("File", file_docs[0]["name"])
    if file_doc.file_name == expected_filename:
        return

    try:
        old_path = file_doc.get_full_path()
        new_dir = os.path.dirname(old_path)
        # If expected_filename is already taken by a DIFFERENT File (e.g.
        # this candidate's earlier resume, still attached and still
        # wanted), don't overwrite/replace it — fall back to a
        # Name_ID_Resume_01.pdf, _02.pdf, ... suffix so both files are
        # kept and stay individually accessible.
        new_filename = _resolve_available_filename(
            expected_filename, ext, exclude_file_name=file_doc.name, new_dir=new_dir
        )
        new_path = os.path.join(new_dir, new_filename)

        if os.path.exists(old_path):
            os.rename(old_path, new_path)
        elif not os.path.exists(new_path):
            # Neither the expected old location nor the target already
            # has a real file on disk — nothing to actually rename, and
            # writing metadata that points at a filename that doesn't
            # exist would recreate the exact bug this guards against.
            return

        # Verify the rename actually left a real file at new_path before
        # writing anything to the DB — belt-and-braces alongside the
        # exists()/rename() above, in case of a filesystem edge case
        # (e.g. a symlink or permissions quirk) where rename() returns
        # without raising but the destination still isn't a real file.
        if not os.path.exists(new_path):
            frappe.log_error(
                title="Resume Rename Verification Failed",
                message=(
                    f"{doc.doctype} '{doc.name}' field '{resume_field}': renamed "
                    f"'{old_path}' -> '{new_path}' but the destination does not exist "
                    f"afterwards. Skipping DB update to avoid pointing resume_upload "
                    f"at a missing file."
                ),
            )
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

        # Any OTHER File record still attached to this exact doc/field is
        # left alone, deliberately — it's a file the candidate actually
        # uploaded (a duplicate/earlier submission), not proven-safe-to-
        # delete debris. Auto-deleting it risks removing a file someone
        # still needs; the _resolve_available_filename() call above already
        # keeps this rename from colliding with/overwriting it on disk.

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


# Renames every attach field listed in _PHIL_DOC_COLLECTION_ATTACH_FIELDS
# on a Philanthrophy Document Collection record. Hooked to on_update.
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


# Renames every attach field listed in _HEALTH_DOC_COLLECTION_ATTACH_FIELDS
# on a Health Document Collection record. Hooked to on_update.
def on_health_document_collection(doc, method=None):
    for fieldname, label in _HEALTH_DOC_COLLECTION_ATTACH_FIELDS:
        _rename_resume(doc, fieldname, "applicant_name", label=label, extra_id_field="applicant_id")
