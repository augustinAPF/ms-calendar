import frappe


def execute():
    if not frappe.db.exists("Web Form", "field-registration-form"):
        return

    # This Web Form was flipped to is_standard=0 (see
    # make_field_registration_form_editable), so the normal migrate sync
    # skips it from here on and further edits to the module json (like the
    # phone-OTP client_script change) never reach the DB record on their own.
    # Force one reload from disk so this specific change lands.
    frappe.reload_doc("ms_calendar", "web_form", "field_registration_form", force=True)
    frappe.db.commit()
