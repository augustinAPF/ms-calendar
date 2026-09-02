import frappe


@frappe.whitelist(allow_guest=True)
def get_subjects(school):
	"""Return the list of Subject names offered by the given School.

	Called from the Field Registration Form's client script so the Apply
	URL only needs to carry a short ?school=<name> instead of the full
	comma-separated subjects list.
	"""
	school = (school or "").strip()
	if not school or not frappe.db.exists("School", school):
		return []

	return frappe.get_all(
		"School Subject",
		filters={"parenttype": "School", "parent": school},
		fields=["subject"],
		order_by="idx",
		pluck="subject",
	)
