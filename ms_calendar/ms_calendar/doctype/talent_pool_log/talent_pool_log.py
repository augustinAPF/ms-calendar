# Copyright (c) 2026, Azim Premji Foundation and contributors
# For license information, please see license.txt

# Rows are written by ms_calendar.api.talent_pool (on_status_change), never
# typed in by hand — see that file for the whole Talent Pool flow.
from frappe.model.document import Document


class TalentPoolLog(Document):
	pass
