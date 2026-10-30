# Copyright (c) 2026, Azim Premji Foundation and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import escape_html, formatdate, get_url_to_form
from frappe.utils.file_manager import save_file
from frappe.utils.pdf import get_pdf

from ms_calendar.api import enablers_panel
from ms_calendar.ms_calendar.doctype.finance_fellowship_settings.finance_fellowship_settings import (
	REGISTRATION_DOCTYPE,
	get_settings,
	notify_recruiter,
)

SCHEDULE_DOCTYPE = "Enablers Interview Schedule"

ROUND_PDF_FIELD = {
	"Round 1": "round_1_feedback_pdf",
	"Round 2": "round_2_feedback_pdf",
}

RATING_FIELDS = (
	"accounting_knowledge",
	"taxation_compliance",
	"analytical_skills",
	"communication",
	"motivation",
	"travel_fit",
	"assignment_performance",
)
TEXT_FIELDS = ("strengths", "concerns", "summary")


class FinanceFellowshipFeedbackForm(Document):
	def validate(self):
		self.panelist_email = (self.panelist_email or "").strip().lower()
		if self.interview_schedule:
			self.check_schedule()
		elif frappe.session.user == "Guest":
			frappe.throw(
				_("Please open the feedback form from the link in your interview invite."),
				frappe.PermissionError,
			)
		if self.is_new() and self.interview_schedule and frappe.db.exists(
			self.doctype,
			{"interview_schedule": self.interview_schedule, "panelist_email": self.panelist_email},
		):
			frappe.throw(_("You have already submitted feedback for this discussion."))

	def check_schedule(self):
		schedule = frappe.get_doc(SCHEDULE_DOCTYPE, self.interview_schedule)
		if schedule.application_id != self.application_id:
			frappe.throw(_("This feedback link does not match the applicant."))
		self.interview_round = schedule.interview_round
		self.interview_date = self.interview_date or schedule.interview_date
		if frappe.session.user != "Guest":
			return
		if not enablers_panel.check_feedback_panel(schedule, self.panelist_email):
			frappe.throw(
				_("{0} is not on the panel for this discussion. Please use the email address the invite was sent to.").format(
					self.panelist_email
				)
			)

	def after_insert(self):
		if self.interview_schedule:
			frappe.db.set_value(SCHEDULE_DOCTYPE, self.interview_schedule, "status", "Completed")
		if self.interview_schedule:
			# Round PDF + "feedback submitted" email to the panel, in the background.
			enablers_panel.enqueue_feedback_submitted(self)
		else:
			frappe.enqueue(
				build_round_feedback_pdf,
				queue="short",
				enqueue_after_commit=True,
				application_id=self.application_id,
				interview_round=self.interview_round,
			)
		notify_recruiter(
			get_settings(),
			_("Feedback submitted – {0} – {1}").format(self.applicant_name, self.interview_round),
			_("<p>{0} submitted {1} feedback for {2} ({3}): <b>{4}</b>.</p><p><a href=\"{5}\">Open the feedback</a></p>").format(
				escape_html(self.panelist_name),
				self.interview_round,
				self.applicant_name,
				self.application_id,
				self.recommendation,
				get_url_to_form(self.doctype, self.name),
			),
			self.doctype,
			self.name,
		)


def feedback_html(application_id, interview_round):
	"""One section per panel member's feedback for that round."""
	meta = frappe.get_meta("Finance Fellowship Feedback Form")
	names = frappe.get_all(
		"Finance Fellowship Feedback Form",
		filters={"application_id": application_id, "interview_round": interview_round},
		pluck="name",
		order_by="creation asc",
	)
	if not names:
		return ""
	applicant = frappe.db.get_value(REGISTRATION_DOCTYPE, application_id, "full_name")
	parts = [
		f"<h2 style='font-family:sans-serif'>{escape_html(applicant)} ({application_id}) — "
		f"{interview_round} feedback</h2>"
	]
	for name in names:
		fb = frappe.get_doc("Finance Fellowship Feedback Form", name)
		rows = "".join(
			f"<tr><td style='padding:4px 8px;border:1px solid #ccc'>{_(meta.get_label(f))}</td>"
			f"<td style='padding:4px 8px;border:1px solid #ccc'>{escape_html(fb.get(f) or '')}</td></tr>"
			for f in RATING_FIELDS + TEXT_FIELDS + ("recommendation", "recommended_category")
			if fb.get(f)
		)
		parts.append(
			f"<h3 style='font-family:sans-serif;margin-top:24px'>{escape_html(fb.panelist_name)}"
			f" &lt;{escape_html(fb.panelist_email)}&gt; — {formatdate(fb.interview_date) if fb.interview_date else ''}</h3>"
			f"<table style='border-collapse:collapse;font-family:sans-serif;font-size:12px;width:100%'>{rows}</table>"
		)
	return "".join(parts)


def build_round_feedback_pdf(application_id, interview_round):
	"""(Re)build the merged feedback PDF for a round and attach it to the
	applicant (Round 1's goes into the Round 2 panel invite)."""
	fieldname = ROUND_PDF_FIELD.get(interview_round)
	html = feedback_html(application_id, interview_round)
	if not (fieldname and html):
		return None

	for old in frappe.get_all(
		"File",
		filters={
			"attached_to_doctype": REGISTRATION_DOCTYPE,
			"attached_to_name": application_id,
			"attached_to_field": fieldname,
		},
		pluck="name",
	):
		frappe.delete_doc("File", old, ignore_permissions=True)

	file_doc = save_file(
		f"{application_id}_{interview_round.replace(' ', '_')}_Feedback.pdf",
		get_pdf(html),
		REGISTRATION_DOCTYPE,
		application_id,
		df=fieldname,
		is_private=1,
	)
	frappe.db.set_value(REGISTRATION_DOCTYPE, application_id, fieldname, file_doc.file_url)
	return file_doc.file_url
