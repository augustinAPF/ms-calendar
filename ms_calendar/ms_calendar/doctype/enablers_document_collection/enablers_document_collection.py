# Copyright (c) 2026, Azim Premji Foundation and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, now_datetime

from ms_calendar.api.ms_enablers import ERF, form_link, notify_recruiters, request_documents

REQUIRED = ("pan_card", "aadhaar_card", "class_x", "class_xii", "degree")
EMPLOYMENT = ("experience_letters", "offer_or_revision_letter", "payslips")
ALL_FILES = REQUIRED + ("post_graduation", "phd") + EMPLOYMENT


class EnablersDocumentCollection(Document):
	def validate(self):
		if self.is_new():
			self.check_access_key()
		self.access_key = None
		self.validate_uploads()
		self.track_verification()

	def check_access_key(self):
		"""Applicants upload from the emailed link (it carries their key);
		recruiters on Desk don't need it."""
		if frappe.session.user != "Guest":
			return
		key = frappe.db.get_value(ERF, self.application_id, "access_key")
		if not self.access_key or self.access_key != key:
			frappe.throw(
				_("This upload link is not valid. Please use the link in the email we sent you."),
				frappe.PermissionError,
			)

	def validate_uploads(self):
		needed = REQUIRED + (() if cint(self.is_fresher) else EMPLOYMENT)
		missing = [_(self.meta.get_label(f)) for f in needed if not self.get(f)]
		if missing:
			frappe.throw(_("Please upload:") + "<br>• " + "<br>• ".join(missing), title=_("Documents missing"))
		for fieldname in ALL_FILES:
			url = (self.get(fieldname) or "").split("?")[0].lower()
			if url and not url.endswith(".pdf"):
				frappe.throw(_("{0} must be a PDF file.").format(_(self.meta.get_label(fieldname))))

	def track_verification(self):
		if self.is_new() or not self.has_value_changed("verification_status"):
			return
		if self.verification_status == "Verified":
			self.verified_by = frappe.session.user
			self.verified_on = now_datetime()
		elif self.verification_status == "Re-submission requested" and not self.verification_remarks:
			frappe.throw(_("Add remarks telling the applicant what to re-submit."))

	def after_insert(self):
		values = {"documents_received_on": now_datetime()}
		if frappe.db.get_value(ERF, self.application_id, "application_status") == "Document Collection":
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

	def on_update(self):
		if self.flags.in_insert or not self.has_value_changed("verification_status"):
			return
		if self.verification_status == "Re-submission requested":
			request_documents(frappe.get_doc(ERF, self.application_id), remarks=self.verification_remarks)
