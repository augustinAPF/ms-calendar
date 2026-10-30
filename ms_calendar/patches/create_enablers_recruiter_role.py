import frappe

ROLE = "Enablers Recruiter"


def execute():
	"""The Enablers workflow doctypes give this role full access; it must
	exist before they're synced."""
	if not frappe.db.exists("Role", ROLE):
		frappe.get_doc({"doctype": "Role", "role_name": ROLE, "desk_access": 1}).insert(ignore_permissions=True)
