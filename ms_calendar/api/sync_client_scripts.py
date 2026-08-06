"""
Custom DocTypes (custom=1) never load `hooks.py`'s `doctype_js` — Frappe's
own `FormMeta.add_code()` hard-skips it for any doctype with `custom=1`
(see frappe/desk/form/meta.py), before it even looks at the hook. The only
way to attach form JS to a Custom DocType is a "Client Script" record
(FormMeta.add_custom_script() reads those instead).

"Philanthropy Interview Schedule", "Health Document Collection" and
"Philanthrophy Document Collection" are all Custom DocTypes with real form
JS living in ms_calendar/public/js/*.js (edited like normal source files,
tracked in git) — but none of that ever reaches the browser unless a
matching Client Script record's `script` field has the same content. This
keeps those records in sync with their .js files automatically on every
`bench migrate`, so editing the file is enough — no manual DB sync step,
no risk of the two drifting apart.
"""

import os

import frappe

# doctype name -> its form JS file, relative to this app's public/ folder.
CUSTOM_DOCTYPE_CLIENT_SCRIPTS = {
    "Philanthropy Interview Schedule": "js/philanthropy_interview_schedule.js",
    "Health Document Collection": "js/health_document_collection.js",
    "Philanthrophy Document Collection": "js/philanthrophy_document_collection.js",
}


def sync_custom_doctype_client_scripts():
    app_public_path = frappe.get_app_path("ms_calendar", "public")

    for doctype, relative_path in CUSTOM_DOCTYPE_CLIENT_SCRIPTS.items():
        file_path = os.path.join(app_public_path, relative_path)
        if not os.path.exists(file_path):
            frappe.log_error(
                title="sync_custom_doctype_client_scripts",
                message=f"{doctype}: expected JS file not found at {file_path}",
            )
            continue

        with open(file_path) as f:
            script = f.read()

        existing = frappe.db.get_value("Client Script", {"dt": doctype, "view": "Form"}, "name")
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
                    "name": doctype,
                    "dt": doctype,
                    "view": "Form",
                    "enabled": 1,
                    "script": script,
                }
            ).insert(ignore_permissions=True)

    frappe.db.commit()
