import frappe


def execute():
    # preferred_location_form is a Select field with no static options — its
    # choices are generated per-job at runtime by the web form's client
    # script (see field_registration_form.json's after_load handler), so the
    # Desk form's <select> never has a matching <option> for whatever value
    # was actually saved and renders blank even though the value is stored
    # correctly. Data displays whatever string is there, same as the
    # sibling "location" field.
    if not frappe.db.exists("DocField", {"parent": "Field Registration Form", "fieldname": "preferred_location_form"}):
        return

    frappe.db.set_value(
        "DocField",
        {"parent": "Field Registration Form", "fieldname": "preferred_location_form"},
        {"fieldtype": "Data", "options": ""},
    )
    frappe.clear_cache(doctype="Field Registration Form")
    frappe.db.commit()
