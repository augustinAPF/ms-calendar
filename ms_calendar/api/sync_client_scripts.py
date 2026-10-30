"""
Custom DocTypes (custom=1) never load `hooks.py`'s `doctype_js` — Frappe's
own `FormMeta.add_code()` hard-skips it for any doctype with `custom=1`
(see frappe/desk/form/meta.py), before it even looks at the hook. The only
way to attach form JS to a Custom DocType is a "Client Script" record
(FormMeta.add_custom_script() reads those instead).

"Philanthropy Interview Schedule", "Health Document Collection",
"Philanthrophy Document Collection" and "Field Interview Schedule" are all
Custom DocTypes with real form JS tracked in git (edited like normal source
files) — but none of that ever reaches the browser unless a matching Client
Script record's `script` field has the same content. This keeps those
records in sync with their .js files automatically on every `bench
migrate`, so editing the file is enough — no manual DB sync step, and no
risk of a stale duplicate Client Script record silently drifting out of
sync and double-declaring the same top-level consts/functions as the
current one (which is exactly what happened to "Field Interview Schedule":
an old "Working" record and a newer, current one both stayed enabled at
once, and the browser evaluating both threw
"Identifier '...' has already been declared").
"""

import os

import frappe

# doctype name -> its form JS file, relative to this app's root folder
# (frappe.get_app_path("ms_calendar") - the ms_calendar/ms_calendar module
# dir, not frappe16-bench/apps/ms_calendar).
CUSTOM_DOCTYPE_CLIENT_SCRIPTS = {
    "Philanthropy Interview Schedule": "public/js/philanthropy_interview_schedule.js",
    "Health Document Collection": "public/js/health_document_collection.js",
    "Philanthrophy Document Collection": "public/js/philanthrophy_document_collection.js",
    "Field Interview Schedule": "ms_calendar/doctype/field_interview_schedule/field_interview_schedule.js",
    "Health Interview Schedule": "public/js/health_interview_schedule.js",
}

# Further scripts of Custom DocTypes — list view JS (FormMeta.add_code()
# skips doctype_list_js for them too) and extra form JS kept in its own file.
# (doctype, view, Client Script name, file). Matched by name (not dt + view)
# so they never overwrite another script someone added for the same doctype.
CUSTOM_DOCTYPE_NAMED_CLIENT_SCRIPTS = [
    ("Field Interview Schedule", "List", "Field Interview Schedule List View",
     "public/js/field_interview_schedule_list.js"),
    ("Philanthropy Interview Schedule", "List", "Philanthropy Interview Schedule List View",
     "public/js/philanthropy_interview_schedule_list.js"),
    ("Health Interview Schedule", "List", "Health Interview Schedule List View",
     "public/js/health_interview_schedule_list.js"),
    ("Health Interview Schedule", "Form", "Health Interview Schedule Theme",
     "public/js/health_interview_schedule_theme.js"),
    # The one Desk form for Enablers + Finance Fellowship applicants (custom
    # on production): next-step buttons + each flow's own status list.
    ("Enablers Registration Form", "Form", "Enablers Registration Form Workflow",
     "public/js/enablers_registration_form.js"),
    # Its list in the Field Registration Form list design (the form's header /
    # card layout comes from applicant_profile.js, app-wide).
    ("Enablers Registration Form", "List", "Enablers Registration Form List View",
     "public/js/enablers_registration_form_list.js"),
    # Not a Custom DocType, but live keeps all its list add-ons as List
    # Client Scripts, so this one is loaded the same way everywhere.
    ("Field Registration Form", "List", "Field Registration Form Bulk Another Job",
     "public/js/frf_bulk_another_job.js"),
    ("Field Registration Form", "List", "Field Registration Form Bulk Interview Schedule",
     "public/js/frf_bulk_interview_schedule.js"),
    ("Field Registration Form", "List", "Field Registration Form Bulk Actions Menu",
     "public/js/frf_bulk_actions_menu.js"),
]


# Form JS that production keeps in its own, newer Client Scripts
# ("Interview Schedule Meeting", "Health Interview Schedule", edited live):
# the files here are older copies, so they only sync on a developer_mode site
# (ms.local). On production a migrate would otherwise overwrite those live
# scripts — or, for Field, whichever of its many Form scripts came first.
DEV_ONLY_FORM_DOCTYPES = {"Field Interview Schedule", "Health Interview Schedule"}


def sync_custom_doctype_client_scripts():
    app_root_path = frappe.get_app_path("ms_calendar")

    dev = bool(frappe.conf.get("developer_mode"))
    scripts = [(doctype, "Form", None, path) for doctype, path in CUSTOM_DOCTYPE_CLIENT_SCRIPTS.items()
               if dev or doctype not in DEV_ONLY_FORM_DOCTYPES]
    scripts += CUSTOM_DOCTYPE_NAMED_CLIENT_SCRIPTS

    for doctype, view, script_name, relative_path in scripts:
        file_path = os.path.join(app_root_path, relative_path)
        if not os.path.exists(file_path):
            frappe.log_error(
                title="sync_custom_doctype_client_scripts",
                message=f"{doctype}: expected JS file not found at {file_path}",
            )
            continue

        with open(file_path) as f:
            script = f.read()

        if script_name:
            existing = frappe.db.exists("Client Script", script_name)
        else:
            # Never one of the named scripts above (e.g. "… Theme").
            named = [name for _, _, name, _ in CUSTOM_DOCTYPE_NAMED_CLIENT_SCRIPTS] or [""]
            existing = frappe.db.get_value(
                "Client Script", {"dt": doctype, "view": "Form", "name": ["not in", named]}, "name"
            )
        if existing:
            client_script = frappe.get_doc("Client Script", existing)
            if client_script.script == script and client_script.enabled:
                continue
            client_script.script = script
            client_script.enabled = 1
            client_script.save(ignore_permissions=True)
        else:
            # Client Script's autoname is "Prompt" — the name has to be
            # set explicitly or insert() raises "Please set the document
            # name". Using the doctype name itself matches the existing
            # "Philanthropy Interview Schedule" record's own naming.
            frappe.get_doc(
                {
                    "doctype": "Client Script",
                    "name": script_name or doctype,
                    "dt": doctype,
                    "view": view,
                    "enabled": 1,
                    "script": script,
                }
            ).insert(ignore_permissions=True)

    frappe.db.commit()
