import frappe

# Field/Health/Phil/Scholarship Registration Form are all Custom DocTypes
# (custom=1) — their field definitions live only in each site's database,
# not in this app's source, so there's no doctype JSON here to add
# "search_index": 1 to (unlike Applicant Master's zwayam_id — see that
# doctype's JSON). A patch calling frappe.db.add_index() is the only way to
# get an index onto these fields consistently across sites.
#
# Why this matters: the Zayam bulk importer (ms_calendar.api.zayam_data_import)
# and its Applicant Master sync (ms_calendar.api.applicant_master_sync) match
# records by this field on every single row. Without an index, each lookup
# is a full table scan — fine at a few thousand rows, increasingly slow as
# these tables grow past 1 lakh+ rows, which is exactly the scale this
# importer is meant for.
_DOCTYPE_FIELDS = [
    ("Field Registration Form", "zayam_id"),
    ("Health Registration Form", "zayam_id"),
    ("Phil Registration Form", "zayam_id"),
    ("Scholarship Recruitment Form", "zayam_id"),
]


def execute():
    for doctype, fieldname in _DOCTYPE_FIELDS:
        if not frappe.db.exists("DocType", doctype):
            continue
        # Not every site's copy of these custom doctypes necessarily has
        # this field (schema drift between sites is expected for
        # Custom DocTypes) — skip rather than error if it's missing here.
        if not frappe.get_meta(doctype).has_field(fieldname):
            continue
        frappe.db.add_index(doctype, [fieldname])
