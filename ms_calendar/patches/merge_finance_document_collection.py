"""2026-11-18: Finance Fellowship uploads now use the Enablers Document Collection
(one DocType + one web form, enablers-document-upload, for both flows).
Remove the old Finance Fellowship Document Collection DocType, its web form
and every link to it. Safe to run more than once; there were no records."""

import frappe

OLD_DOCTYPE = "Finance Fellowship Document Collection"
NEW_DOCTYPE = "Enablers Document Collection"
OLD_WEB_FORM = "finance-fellowship-document-upload"


def execute():
	if frappe.db.exists("Web Form", OLD_WEB_FORM):
		frappe.delete_doc("Web Form", OLD_WEB_FORM, ignore_permissions=True, force=True)

	# Connections on the Enablers Registration Form + workspace links / shortcuts.
	frappe.db.delete("DocType Link", {"link_doctype": OLD_DOCTYPE})
	for table in ("Workspace Link", "Workspace Shortcut"):
		if frappe.db.table_exists(table):
			frappe.db.set_value(table, {"link_to": OLD_DOCTYPE}, "link_to", NEW_DOCTYPE)

	if frappe.db.exists("DocType", OLD_DOCTYPE):
		if frappe.db.table_exists(OLD_DOCTYPE) and frappe.db.count(OLD_DOCTYPE):
			# Never drop uploads: leave the DocType for a manual move if any exist.
			print(f"{OLD_DOCTYPE} has records - not deleted")
			return
		frappe.delete_doc("DocType", OLD_DOCTYPE, ignore_permissions=True, force=True)

	frappe.clear_cache(doctype="Enablers Registration Form")
