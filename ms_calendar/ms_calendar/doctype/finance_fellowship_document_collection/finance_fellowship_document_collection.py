# Copyright (c) 2026, Azim Premji Foundation and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import get_url_to_form, now_datetime

from ms_calendar.ms_calendar.doctype.finance_fellowship_settings.finance_fellowship_settings import (
	REGISTRATION_DOCTYPE,
	STAGE_APPLICATION_FORM,
	STAGE_DOCUMENTS,
	get_settings,
	notify_recruiter,
)

# Fields needed per stage; the experienced-only ones are added for anyone
# who is not a Fresher.
STAGE_FIELDS = {
	STAGE_APPLICATION_FORM: ("application_form",),
	STAGE_DOCUMENTS: ("pan_card", "aadhaar_card", "education_certificates"),
}
EXPERIENCED_FIELDS = ("work_experience_letters", "payslips")
DOCUMENT_FIELDS = STAGE_FIELDS[STAGE_DOCUMENTS] + EXPERIENCED_FIELDS

# Status the applicant moves to once the upload arrives.
RECEIVED_STATUS = {
	STAGE_APPLICATION_FORM: ("Application Form Received", "application_form_received_on"),
	STAGE_DOCUMENTS: ("Documents Received", "documents_received_on"),
}


class FinanceFellowshipDocumentCollection(Document):
	def validate(self):
		registration = frappe.get_doc(REGISTRATION_DOCTYPE, self.application_id)
		if self.is_new():
			self.check_access_key(registration)
		self.access_key = None
		self.validate_uploads(registration)
		self.track_verification()

	def check_access_key(self, registration):
		"""Uploads come from the public page via the emailed link, which
		carries the applicant's access key. Recruiters on Desk don't need it."""
		if frappe.session.user != "Guest":
			return
		if not self.access_key or self.access_key != registration.access_key:
			frappe.throw(
				_("This upload link is not valid. Please use the link in the email we sent you."),
				frappe.PermissionError,
			)

	def required_fields(self, registration):
		fields = STAGE_FIELDS.get(self.stage, ())
		if self.stage == STAGE_DOCUMENTS and registration.work_experience != "Fresher":
			fields += EXPERIENCED_FIELDS
		return fields

	def validate_uploads(self, registration):
		missing = [_(self.meta.get_label(f)) for f in self.required_fields(registration) if not self.get(f)]
		if missing:
			frappe.throw(_("Please upload:") + "<br>• " + "<br>• ".join(missing), title=_("Documents missing"))

		allowed = (".pdf", ".doc", ".docx") if self.stage == STAGE_APPLICATION_FORM else (".pdf",)
		fields = ("application_form",) if self.stage == STAGE_APPLICATION_FORM else DOCUMENT_FIELDS
		for fieldname in fields:
			url = (self.get(fieldname) or "").split("?")[0].lower()
			if url and not url.endswith(allowed):
				frappe.throw(
					_("{0} must be a {1} file.").format(
						_(self.meta.get_label(fieldname)), " / ".join(e[1:].upper() for e in allowed)
					)
				)

	def track_verification(self):
		if self.is_new() or not self.has_value_changed("verification_status"):
			return
		if self.verification_status == "Verified":
			self.verified_by = frappe.session.user
			self.verified_on = now_datetime()
		elif self.verification_status == "Re-submission requested" and not self.verification_remarks:
			frappe.throw(_("Add remarks telling the applicant what to re-submit."))

	def after_insert(self):
		status, stamp = RECEIVED_STATUS[self.stage]
		frappe.db.set_value(
			REGISTRATION_DOCTYPE,
			self.application_id,
			{"application_status": status, stamp: now_datetime()},
		)
		settings = get_settings()
		notify_recruiter(
			settings,
			_("{0} received – {1} ({2})").format(self.stage.split(" (")[0], self.applicant_name, self.application_id),
			_("<p>{0} uploaded by {1} ({2}).</p><p><a href=\"{3}\">Open the upload to verify it</a></p>").format(
				self.stage, self.applicant_name, self.application_id, get_url_to_form(self.doctype, self.name)
			),
			self.doctype,
			self.name,
		)

	def on_update(self):
		if self.flags.in_insert or not self.has_value_changed("verification_status"):
			return
		registration = frappe.get_doc(REGISTRATION_DOCTYPE, self.application_id)
		if self.verification_status == "Verified" and self.stage == STAGE_DOCUMENTS:
			if registration.application_status == "Documents Received":
				registration.application_status = "Documents Verified"
				registration.save()
		elif self.verification_status == "Re-submission requested":
			from ms_calendar.api.ms_finance import request_application_form, request_documents

			if self.stage == STAGE_APPLICATION_FORM:
				request_application_form(registration, remarks=self.verification_remarks)
			else:
				request_documents(registration, remarks=self.verification_remarks)
