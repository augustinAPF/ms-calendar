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
