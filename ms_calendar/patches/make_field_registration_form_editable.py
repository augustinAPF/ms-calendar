import frappe


def execute():
    if frappe.db.exists("Web Form", "field-registration-form"):
        frappe.db.set_value("Web Form", "field-registration-form", "is_standard", 0)
        frappe.db.commit()
