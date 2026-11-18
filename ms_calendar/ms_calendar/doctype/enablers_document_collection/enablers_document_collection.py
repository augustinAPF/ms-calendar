# Copyright (c) 2026, Azim Premji Foundation and contributors
# For license information, please see license.txt

# One Document Collection for Enablers AND Finance Fellowship applicants
# (both live in the Enablers Registration Form). The applicant's sub unit
# decides the flow:
# - Enablers: one upload (identity, education, employment), stage empty.
# - Finance Fellowship: two uploads, told apart by `stage` —
#   "Application Form (after Round 1)" and "Documents (after Round 2)".
# (Was two DocTypes until 2026-11-18; Finance Fellowship Document Collection
# was merged in here — see patches/merge_finance_document_collection.py.)

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, now_datetime

from ms_calendar.api.ms_enablers import ERF, form_link, notify_recruiters, request_documents
from ms_calendar.ms_calendar.doctype.finance_fellowship_settings.finance_fellowship_settings import (
	STAGE_APPLICATION_FORM,
	STAGE_DOCUMENTS,
	get_settings as get_fellowship_settings,
	notify_recruiter as notify_fellowship_recruiter,
)

FELLOWSHIP_SUB_UNIT = "Finance Fellowship"

# Enablers: always needed, plus the employment ones unless a fresher.
REQUIRED = ("pan_card", "aadhaar_card", "class_x", "class_xii", "degree")
EMPLOYMENT = ("experience_letters", "offer_or_revision_letter", "payslips")

# Finance Fellowship: needed per stage, plus the experienced-only ones for
# anyone whose registration says they are not a Fresher.
FELLOWSHIP_STAGE_FIELDS = {
	STAGE_APPLICATION_FORM: ("application_form",),
	STAGE_DOCUMENTS: ("pan_card", "aadhaar_card", "education_certificates"),
}
FELLOWSHIP_EXPERIENCED = ("experience_letters", "payslips")

# Status (and ERF timestamp field) a Fellowship applicant moves to once the upload arrives.
FELLOWSHIP_RECEIVED_STATUS = {
	STAGE_APPLICATION_FORM: ("Application Form Received", "application_form_received_on"),
	STAGE_DOCUMENTS: ("Documents Received", "documents_received_on"),
}

ALL_FILES = (
	"application_form",
	"pan_card",
	"aadhaar_card",
	"class_x",
	"class_xii",
	"degree",
	"post_graduation",
	"phd",
	"education_certificates",
	"experience_letters",
	"offer_or_revision_letter",
	"payslips",
)
# The filled Application Form may be a Word file; everything else is PDF only.
WORD_ALLOWED = ("application_form",)


class EnablersDocumentCollection(Document):
	def validate(self):
		registration = self.get_registration()
		if self.is_new():
			self.check_access_key(registration)
		self.access_key = None
		if self.is_fellowship(registration):
			if self.stage not in FELLOWSHIP_STAGE_FIELDS:
				frappe.throw(_("Select the Stage: Application Form (after Round 1) or Documents (after Round 2)."))
		else:
			self.stage = None
		self.validate_uploads(registration)
		self.track_verification()

	def get_registration(self):
		return (
			frappe.db.get_value(
				ERF,
				self.application_id,
				["department", "access_key", "work_experience", "application_status"],
				as_dict=True,
			)
			or frappe._dict()
		)

	@staticmethod
	def is_fellowship(registration):
		return registration.get("department") == FELLOWSHIP_SUB_UNIT

	def check_access_key(self, registration):
		"""Applicants upload from the emailed link (it carries their key);
		recruiters on Desk don't need it."""
		if frappe.session.user != "Guest":
			return
		if not self.access_key or self.access_key != registration.get("access_key"):
			frappe.throw(
				_("This upload link is not valid. Please use the link in the email we sent you."),
				frappe.PermissionError,
			)

	def required_fields(self, registration):
		if not self.is_fellowship(registration):
			return REQUIRED + (() if cint(self.is_fresher) else EMPLOYMENT)
		fields = FELLOWSHIP_STAGE_FIELDS[self.stage]
		if self.stage == STAGE_DOCUMENTS and registration.get("work_experience") != "Fresher":
			fields += FELLOWSHIP_EXPERIENCED
		return fields

	def validate_uploads(self, registration):
		missing = [_(self.meta.get_label(f)) for f in self.required_fields(registration) if not self.get(f)]
		if missing:
			frappe.throw(_("Please upload:") + "<br>• " + "<br>• ".join(missing), title=_("Documents missing"))
		for fieldname in ALL_FILES:
			url = (self.get(fieldname) or "").split("?")[0].lower()
			if not url:
				continue
			allowed = (".pdf", ".doc", ".docx") if fieldname in WORD_ALLOWED else (".pdf",)
			if not url.endswith(allowed):
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
		registration = self.get_registration()
		if self.is_fellowship(registration):
			self.fellowship_received()
		else:
			self.enablers_received(registration)

	def enablers_received(self, registration):
		values = {"documents_received_on": now_datetime()}
		if registration.get("application_status") == "Document Collection":
			values["application_status"] = "Documents Received"
		frappe.db.set_value(ERF, self.application_id, values)
		notify_recruiters(
			self.application_id,
			_("Documents received – {0} ({1})").format(self.applicant_name, self.application_id),
			_("<p>{0} ({1}, {2}) uploaded their documents.</p><p><a href=\"{3}\">Open the upload to verify it</a></p>").format(
				self.applicant_name, self.application_id, self.role or "", form_link(self.doctype, self.name)
			),
			self.doctype,
			self.name,
		)

	def fellowship_received(self):
		status, stamp = FELLOWSHIP_RECEIVED_STATUS[self.stage]
		frappe.db.set_value(ERF, self.application_id, {"application_status": status, stamp: now_datetime()})
		notify_fellowship_recruiter(
			get_fellowship_settings(),
			_("{0} received – {1} ({2})").format(self.stage.split(" (")[0], self.applicant_name, self.application_id),
			_("<p>{0} uploaded by {1} ({2}).</p><p><a href=\"{3}\">Open the upload to verify it</a></p>").format(
				self.stage, self.applicant_name, self.application_id, form_link(self.doctype, self.name)
			),
			self.doctype,
			self.name,
		)

	def on_update(self):
		if self.flags.in_insert or not self.has_value_changed("verification_status"):
			return
		registration = frappe.get_doc(ERF, self.application_id)
		if not self.is_fellowship(registration):
			if self.verification_status == "Re-submission requested":
				request_documents(registration, remarks=self.verification_remarks)
			return

		if self.verification_status == "Verified" and self.stage == STAGE_DOCUMENTS:
			if registration.application_status == "Documents Received":
				registration.application_status = "Documents Verified"
				registration.save()
		elif self.verification_status == "Re-submission requested":
			from ms_calendar.api.ms_finance import request_application_form
			from ms_calendar.api.ms_finance import request_documents as request_fellowship_documents

			if self.stage == STAGE_APPLICATION_FORM:
				request_application_form(registration, remarks=self.verification_remarks)
			else:
				request_fellowship_documents(registration, remarks=self.verification_remarks)
