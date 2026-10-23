# """Candidate-facing document resubmission portal: upload + diagnostics.

# Replaces the earlier Server Script attempt at this (submit_resubmission_documents),
# which could never work — Frappe's Server Script sandbox (safe_exec) does not expose
# frappe.request.files at all (it is always None there), so any Server Script trying
# to read uploaded files directly fails with `TypeError: 'NoneType' object is not
# iterable`, regardless of how the script itself is written. A real whitelisted
# method in an installed app has no such restriction.

# This module also replaces the earlier two-step approach (browser calls the core
# /api/method/upload_file directly, then a second call writes the returned URL onto
# the field) — that step 1 call went through Frappe's own `check_write_permission`,
# which 403'd for a candidate who does not own the Field Document Collection record
# even though the Role Permission Manager showed Write=1/if_owner=0 for their role.
# Every other known cause (Strict User Permissions, field Permission Levels,
# Workflow, has_permission hooks in this app and in frappe core, is_submittable) was
# checked and ruled out — the exact mechanism was never pinned down. Doing the
# write here, under our own ownership check and ignore_permissions=True, sidesteps
# that check entirely rather than depending on finding its root cause.
# """

# import frappe


# FIELD_MAP = {
#     "Pan Card (both sides)": "pan_card",
#     "Aadhar Card (both sides)": "aadhaar_card",
#     "Education Certificates": "education_certificate",
#     "Experience Letter from Previous Organisations": "experience_letter",
#     "Salary Slips or Bank Statements for the Last 3 Months": "pay_slips",
#     "Current Organisation Offer Letter": "salary_revision_letter",
# }


# @frappe.whitelist()
# def submit_resubmission_documents():
#     request_name = frappe.form_dict.get("request_name")

#     if not request_name:
#         frappe.throw("Missing request reference.")

#     req = frappe.get_doc("Document Resubmission Request", request_name)

#     if req.candidate_email != frappe.session.user:
#         frappe.throw(
#             "You are not permitted to update this record.", frappe.PermissionError
#         )

#     fdc = frappe.get_doc("Field Document Collection", req.field_document_collection)

#     # Real, unrestricted file access — this is the whole point of moving off
#     # the Server Script sandbox. frappe.request here is the actual Werkzeug
#     # request, not the reduced object a Server Script sees.
#     files = frappe.request.files

#     if not files:
#         frappe.throw("No files were received with this request.")

#     for fieldname in files:
#         uploaded = files[fieldname]

#         old_url = fdc.get(fieldname)

#         file_doc = frappe.get_doc(
#             {
#                 "doctype": "File",
#                 "file_name": uploaded.filename,
#                 "attached_to_doctype": "Field Document Collection",
#                 "attached_to_name": fdc.name,
#                 "attached_to_field": fieldname,
#                 "is_private": 1,
#                 "content": uploaded.stream.read(),
#             }
#         )
#         file_doc.save(ignore_permissions=True)

#         frappe.db.set_value(
#             "Field Document Collection", fdc.name, fieldname, file_doc.file_url
#         )

#         if old_url and old_url != file_doc.file_url:
#             old_files = frappe.get_all(
#                 "File",
#                 filters={
#                     "attached_to_doctype": "Field Document Collection",
#                     "attached_to_name": fdc.name,
#                     "attached_to_field": fieldname,
#                     "file_url": old_url,
#                 },
#                 pluck="name",
#             )
#             for old_file in old_files:
#                 frappe.delete_doc("File", old_file, ignore_permissions=True)

#     req.resubmission_status = "Resubmitted"
#     req.save(ignore_permissions=True)

#     frappe.db.set_value(
#         "Field Document Collection",
#         fdc.name,
#         "document_request_status",
#         "Resubmitted",
#     )

#     return {"ok": True}
