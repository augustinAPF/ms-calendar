# Copyright (c) 2026, Augustin Moses and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from ms_calendar.ms_calendar.sms_utils import send_sms, send_whatsapp


class FieldInterviewSchedule(Document):

	def after_insert(self):
		self._send_schedule_notifications()

	def on_update(self):
		if (
			self.has_value_changed("interview_round")
			or self.has_value_changed("interview_date")
			or self.has_value_changed("start_time")
		):
			self._send_schedule_notifications()

	def _send_schedule_notifications(self):
		phone = (self.phone_no or "").strip() or self._fetch_phone()
		round_ = (self.interview_round or "").strip()
		if not phone or not round_:
			return

		full_name = frappe.db.get_value(
			"Field Registration Form", self.application_id, "full_name_aadhaar"
		) if self.application_id else None

		_kwargs = dict(
			phone=phone,
			status=round_,
			applicant_id=self.application_id,
			applicant_name=self.applicants_name,
			full_name_aadhaar=full_name,
			triggered_from="Interview Schedule",
		)
		send_sms(**_kwargs)
		send_whatsapp(**_kwargs)

	def _fetch_phone(self):
		if not self.application_id:
			return None
		return frappe.db.get_value(
			"Field Registration Form", self.application_id, "phone_number"
		)
