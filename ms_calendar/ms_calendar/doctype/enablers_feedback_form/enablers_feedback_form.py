# Copyright (c) 2026, Azim Premji Foundation and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import escape_html, formatdate
from frappe.utils.file_manager import save_file
from frappe.utils.pdf import get_pdf

from ms_calendar.api import enablers_panel
from ms_calendar.api.ms_enablers import ERF, ROUND_PDF_FIELD, SCHEDULE_DOCTYPE, form_link, notify_recruiters


class EnablersFeedbackForm(Document):
	def validate(self):
		self.interviewer_email = (self.interviewer_email or "").strip().lower()
		if self.interview_schedule:
			self.check_schedule()
		elif frappe.session.user == "Guest":
			frappe.throw(
				_("Please open the feedback form from the link in your interview invite."), frappe.PermissionError
			)
		if self.is_new() and self.interview_schedule and frappe.db.exists(
			self.doctype, {"interview_schedule": self.interview_schedule, "interviewer_email": self.interviewer_email}
		):
			frappe.throw(_("You have already submitted feedback for this interview."))

	def check_schedule(self):
		schedule = frappe.get_doc(SCHEDULE_DOCTYPE, self.interview_schedule)
		if schedule.application_id != self.application_id:
			frappe.throw(_("This feedback link does not match the applicant."))
		self.interview_round = schedule.interview_round
		self.interview_date = self.interview_date or schedule.interview_date
		if frappe.session.user != "Guest":
			return
		if not enablers_panel.check_feedback_panel(schedule, self.interviewer_email):
			frappe.throw(
				_("{0} is not an interviewer for this interview. Please use the email address the invite was sent to.").format(
					self.interviewer_email
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
		notify_recruiters(
			self.application_id,
			_("Feedback submitted – {0} – {1}").format(self.applicant_name, self.interview_round),
			_("<p>{0} submitted {1} feedback for {2} ({3}, {4}): <b>{5}</b>.</p><p><a href=\"{6}\">Open the feedback</a></p>").format(
				escape_html(self.interviewer_name), self.interview_round, self.applicant_name, self.application_id,
				self.role or "", self.recommendation, form_link(self.doctype, self.name),
			),
			self.doctype,
			self.name,
		)


def feedback_html(application_id, interview_round):
	names = frappe.get_all(
		"Enablers Feedback Form",
		filters={"application_id": application_id, "interview_round": interview_round},
		pluck="name",
		order_by="creation asc",
	)
	if not names:
		return ""
	applicant, role = frappe.db.get_value(ERF, application_id, ["full_name", "role"])
	parts = [
		f"<h2 style='font-family:sans-serif'>{escape_html(applicant or '')} ({application_id}) — "
		f"{escape_html(role or '')} — {interview_round} feedback</h2>"
	]
	for name in names:
		fb = frappe.get_doc("Enablers Feedback Form", name)
		parts.append(
			f"<h3 style='font-family:sans-serif;margin-top:24px'>{escape_html(fb.interviewer_name)} "
			f"&lt;{escape_html(fb.interviewer_email)}&gt; — {formatdate(fb.interview_date) if fb.interview_date else ''}</h3>"
			f"<p style='font-family:sans-serif;font-size:12px'><b>Recommendation:</b> {escape_html(fb.recommendation)}</p>"
			f"<p style='font-family:sans-serif;font-size:12px;white-space:pre-wrap'>{escape_html(fb.feedback)}</p>"
		)
	return "".join(parts)


def build_round_feedback_pdf(application_id, interview_round):
	"""(Re)build one round's feedback PDF on the applicant — attached to the
	next rounds' invites."""
	fieldname = ROUND_PDF_FIELD.get(interview_round)
	html = feedback_html(application_id, interview_round)
	if not (fieldname and html):
		return None
	for old in frappe.get_all(
		"File",
		filters={"attached_to_doctype": ERF, "attached_to_name": application_id, "attached_to_field": fieldname},
		pluck="name",
	):
		frappe.delete_doc("File", old, ignore_permissions=True)
	file_doc = save_file(
		f"{application_id}_{interview_round.replace(' ', '_')}_Feedback.pdf",
		get_pdf(html),
		ERF,
		application_id,
		df=fieldname,
		is_private=1,
	)
	frappe.db.set_value(ERF, application_id, fieldname, file_doc.file_url, update_modified=False)
	return file_doc.file_url
