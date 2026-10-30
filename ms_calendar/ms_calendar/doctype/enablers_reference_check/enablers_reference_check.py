# Copyright (c) 2026, Azim Premji Foundation and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

from ms_calendar.api.ms_enablers import ERF

# The applicant moves to "Reference Check" once the first one is recorded
# after their documents were asked for / received.
MOVE_FROM = ("Round 3 Select", "Document Collection", "Documents Received")


class EnablersReferenceCheck(Document):
	def after_insert(self):
		registration = frappe.get_doc(ERF, self.application_id)
		if registration.application_status in MOVE_FROM:
			registration.application_status = "Reference Check"
			registration.save()
