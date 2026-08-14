"""Relaxes attachment-download permission for the resume/CV-bearing forms.

Frappe's own File.is_downloadable() (frappe/core/doctype/file/file.py) falls
back, for a private file with attached_to_doctype/attached_to_name set, to
`ref_doc.has_permission("read")` on the owning record — i.e. whatever the
fine-grained Role Permission Manager setup on the owning doctype happens to
grant. Many recruiter-type roles either have no read permission configured
on these forms at all, or only a restricted/if_owner grant, so clicking a
CV's own attachment link gets a 403 for perfectly legitimate staff who can
already see the applicant in the list.

This mixin (wired via hooks.py's extend_doctype_class) says: for the CV/
attachment fields on these specific forms, any logged-in staff member may
open the file, full stop. Everything else (unrelated doctypes' private
attachments elsewhere in the system) keeps Frappe's normal, stricter
behaviour via super().
"""

import base64
import io
import json
import os
import zipfile

import frappe

# The same set of doctypes resume_rename.py already treats as "the
# resume/CV forms" — kept in sync with that module rather than duplicated
# field-by-field, since this only cares about the doctype, not which
# specific Attach field the file sits in.
RELAXED_ATTACH_DOCTYPES = {
    "Phil Registration Form",
    "Field Registration Form",
    "Health Registration Form",
    "Scholarship Recruitment Form",
    "Philanthrophy Document Collection",
    "Health Document Collection",
}

# Attach fieldname holding the resume/CV url on each of the four
# registration forms above (see resume_rename.py — same fields it renames).
# Used only as a fallback lookup, below, for files whose own File record
# never got a proper attached_to_doctype/attached_to_name at all.
_RESUME_FIELD_BY_DOCTYPE = {
    "Phil Registration Form": "cv_attach",
    "Field Registration Form": "resume_upload",
    "Health Registration Form": "resume",
    "Scholarship Recruitment Form": "resume__cv",
}


def _is_relaxed_attachment(file_doc):
    if file_doc.attached_to_doctype in RELAXED_ATTACH_DOCTYPES:
        return True

    # Fallback for a File record that never got a proper attached_to_*
    # link at all — e.g. a resume uploaded through the public registration
    # webform, where there's no logged-in session at insert time to stamp
    # the reference the normal way. Only kicks in when BOTH are genuinely
    # blank, so a file legitimately attached to some OTHER doctype/record
    # is never second-guessed here — just reverse-looked-up by checking
    # whether this exact url is still the live value of a resume field on
    # one of the four forms.
    if file_doc.attached_to_doctype or file_doc.attached_to_name:
        return False
    if not file_doc.file_url:
        return False

    return any(
        frappe.db.exists(doctype, {fieldname: file_doc.file_url})
        for doctype, fieldname in _RESUME_FIELD_BY_DOCTYPE.items()
    )


class RelaxedAttachmentAccessMixin:
    def is_downloadable(self):
        user = frappe.session.user
        if user != "Guest" and _is_desk_user(user) and _is_relaxed_attachment(self):
            return True
        return super().is_downloadable()


@frappe.whitelist()
def download_cvs_as_zip(doctype, names):
    """Bulk-downloads every checked record's resume/CV (from
    _RESUME_FIELD_BY_DOCTYPE above) as one zip — backs the "Download All
    CVs" list-view action added for Scholarship Recruitment Form (works
    for any of the other doctypes in that map too, list-view wiring
    permitting).

    Called via frappe.call() (POST), not a raw window.open() GET —
    unlike a normal file download, this needs frappe.call()'s error
    handling: a raw browser navigation to a whitelisted method that
    throws just renders the bare error response in a blank tab (no
    frappe.msgprint, nothing actionable), which is exactly how a genuine
    permission/setup problem here would otherwise look like an
    unexplained "Forbidden" page. Returns the zip as base64 in the
    response `message`; the client decodes it into a Blob and triggers
    the actual save itself.
    """
    if not _is_desk_user(frappe.session.user):
        frappe.throw("You don't have permission to download these files.", frappe.PermissionError)

    if doctype not in _RESUME_FIELD_BY_DOCTYPE:
        frappe.throw(f"Bulk CV download isn't set up for {doctype}.")

    if isinstance(names, str):
        names = json.loads(names)

    fieldname = _RESUME_FIELD_BY_DOCTYPE[doctype]
    buffer = io.BytesIO()
    added = 0
    skipped = []

    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in names:
            file_url = frappe.db.get_value(doctype, name, fieldname)
            if not file_url:
                skipped.append(name)
                continue

            file_rows = frappe.get_all(
                "File", filters={"file_url": file_url}, fields=["file_name", "is_private"], limit=1
            )
            if not file_rows:
                skipped.append(name)
                continue
            file_row = file_rows[0]

            file_path = frappe.get_site_path(
                "private" if file_row.is_private else "public", "files", file_row.file_name
            )
            if not os.path.isfile(file_path):
                # `is_private` can be stale vs. where the bytes actually
                # live (same fallback used elsewhere in this codebase for
                # attachment lookups) — check the other folder before
                # silently dropping this candidate's CV from the zip.
                alt_path = frappe.get_site_path(
                    "public" if file_row.is_private else "private", "files", file_row.file_name
                )
                if os.path.isfile(alt_path):
                    file_path = alt_path
                else:
                    skipped.append(name)
                    continue

            # Prefix with the record's own name so two candidates who both
            # uploaded a file literally named "Resume.pdf" don't collide
            # inside the zip.
            zf.write(file_path, arcname=f"{name}_{file_row.file_name}")
            added += 1

    if not added:
        frappe.throw("None of the selected records have a CV attached.")

    return {
        "filename": f"{frappe.scrub(doctype)}_cvs.zip",
        "filecontent_base64": base64.b64encode(buffer.getvalue()).decode(),
        "added": added,
        "skipped": skipped,
    }


def _is_desk_user(user):
    """True for any real, non-portal staff account (Frappe's own
    SYSTEM_USER_ROLE — "Desk User" in this version — is derived from
    exactly this same user_type field; see frappe.permissions.is_system_user).

    Reads the column directly with frappe.db.get_value rather than going
    through frappe.get_roles()/is_system_user() (both cached — via a
    roles-specific Redis hash and the document cache respectively) so this
    can never see a stale answer if a account's user_type or roles were
    set through a path that skipped the usual cache invalidation (bulk
    import, a direct DB write, etc.).
    """
    return frappe.db.get_value("User", user, "user_type") == "System User"
