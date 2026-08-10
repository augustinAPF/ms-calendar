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

"Any logged-in staff member" is Frappe's own SYSTEM_USER_ROLE constant —
in this Frappe version that's the built-in "Desk User" role, auto-assigned
to every account with user_type "System User" (i.e. not Guest, and not a
portal-only "Website User" account). It's imported from frappe.permissions
rather than hardcoded so this stays correct even if a future Frappe
version renames it again (it used to be "System User" pre-rename).
"""

import frappe
from frappe.permissions import SYSTEM_USER_ROLE

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


class RelaxedAttachmentAccessMixin:
    def is_downloadable(self):
        user = frappe.session.user
        if (
            self.attached_to_doctype in RELAXED_ATTACH_DOCTYPES
            and user != "Guest"
            and SYSTEM_USER_ROLE in frappe.get_roles(user)
        ):
            return True
        return super().is_downloadable()
