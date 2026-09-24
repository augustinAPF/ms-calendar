# Copyright (c) 2026, Augustin Moses and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class QuestionPaperMaster(Document):
	pass


@frappe.whitelist()
def get_merittrac_matching_tables():
	"""Read-only data for frf_list.js's MeritTrac matching logic.

	Question Paper Master itself is restricted to System Manager (it's
	edited from the Desk list), but any user who can already reach the
	"Initiate Test" dialog needs to read these codes — so this uses
	frappe.db.get_all (no permission check) instead of frappe.client.get_list,
	deliberately exposing only these few read-only fields rather than
	widening the doctype's own permissions.
	"""
	qp_rows = frappe.db.get_all(
		"Question Paper Master",
		fields=["test_subject", "qp_set", "qp_hindi_english", "qp_kannada_english"],
		limit_page_length=0,
	)
	assessment_rows = frappe.db.get_all(
		"Field Meritrac Assessment",
		fields=["name", "assessment_set"],
		limit_page_length=0,
	)
	return {"qp_rows": qp_rows, "assessment_rows": assessment_rows}
