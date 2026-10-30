# Copyright (c) 2026, Azim Premji Foundation and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import get_time

from ms_calendar.api import enablers_panel
from ms_calendar.api.ms_enablers import ERF, SCHEDULABLE_FROM, feedback_link
from ms_calendar.api.ms_finance import FELLOWSHIP_SUB_UNIT
from ms_calendar.ms_calendar.doctype.enablers_settings.enablers_settings import get_settings
from ms_calendar.ms_calendar.doctype.finance_fellowship_settings.finance_fellowship_settings import (
	feedback_link as fellowship_feedback_link,
)
from ms_calendar.ms_calendar.doctype.finance_fellowship_settings.finance_fellowship_settings import (
	get_settings as get_fellowship_settings,
)

# The one interview form for both flows. The round comes from the
# applicant's status (it is not picked by hand).
# Enablers: Rounds 1 and 2 on MS Teams, Round 3 an in-person panel.
# Finance Fellowship: Round 1 on MS Teams, Round 2 in person (+ assignment).
ROUND_MODE = {"Round 1": "Online (MS Teams)", "Round 2": "Online (MS Teams)", "Round 3": "In-person"}
FELLOWSHIP_ROUND_MODE = {"Round 1": "Online (MS Teams)", "Round 2": "In-person"}
FELLOWSHIP_SCHEDULABLE_FROM = {
	"Round 1": ("Shortlist - CV", "On hold - CV", "Round 1 Scheduled"),
	"Round 2": ("Shortlist - R1", "On hold - R1", "Application Form Received", "Round 2 Scheduled"),
}


def round_for(application_id):
	"""(round, mode, is_fellowship, status) for the applicant's current
	status; round is None when they are not at an interview stage."""
	status, sub_unit = frappe.db.get_value(ERF, application_id, ["application_status", "department"]) or (None, None)
	fellowship = sub_unit == FELLOWSHIP_SUB_UNIT
	rounds = FELLOWSHIP_SCHEDULABLE_FROM if fellowship else SCHEDULABLE_FROM
	modes = FELLOWSHIP_ROUND_MODE if fellowship else ROUND_MODE
	for interview_round, statuses in rounds.items():
		if status in statuses:
			return interview_round, modes[interview_round], fellowship, status
	return None, None, fellowship, status


@frappe.whitelist()
def get_round_for_applicant(application_id):
	"""The form fills Interview Round + Mode as soon as the applicant is picked."""
	frappe.has_permission(ERF, "read", application_id, throw=True)
	interview_round, mode, fellowship, status = round_for(application_id)
	return {"interview_round": interview_round, "interview_mode": mode, "fellowship": fellowship, "status": status}


class EnablersInterviewSchedule(Document):
	def validate(self):
		fellowship = self.set_round()
		if not self.organizer_email:
			settings = get_fellowship_settings() if fellowship else get_settings()
			self.organizer_email = settings.default_organizer_email
		if not (fellowship and self.interview_round == "Round 2"):
			self.assignment_round = 0
		if get_time(self.end_time) <= get_time(self.start_time):
			frappe.throw(_("End Time must be after Start Time."))
		if not self.meeting_room:
			self.room_email = None
		if self.interview_mode != enablers_panel.HYBRID:
			self.online_panel = []
		elif not self.online_panel:
			frappe.throw(_("Hybrid: add the interviewers joining online (MS Teams)."))
		self.set_interviewer_names()
		# Each flow has its own feedback form; ONE link for the whole panel
		# (the form asks "Who is filling this feedback?").
		base = fellowship_feedback_link(self) if fellowship else feedback_link(self)
		self.feedback_link = enablers_panel.panel_feedback_link(base, self)

	def set_round(self):
		"""New interview (or a different applicant): the round is read off the
		applicant's status. A saved interview keeps its round."""
		if not (self.is_new() or self.has_value_changed("application_id")) and self.interview_round:
			return self.is_fellowship()
		interview_round, mode, fellowship, status = round_for(self.application_id)
		if not interview_round:
			expected = FELLOWSHIP_SCHEDULABLE_FROM if fellowship else SCHEDULABLE_FROM
			frappe.throw(
				_("{0} is at <b>{1}</b>, which is not an interview stage. Interviews are scheduled at: {2}.").format(
					self.application_id,
					status or _("no status"),
					"; ".join(f"{r} — {', '.join(s)}" for r, s in expected.items()),
				),
				title=_("Not at an interview stage"),
			)
		if self.interview_round != interview_round or not self.interview_mode:
			self.interview_mode = mode
		self.interview_round = interview_round
		return fellowship

	def is_fellowship(self):
		sub_unit = self.sub_unit or frappe.db.get_value(ERF, self.application_id, "department")
		return sub_unit == FELLOWSHIP_SUB_UNIT

	def set_interviewer_names(self):
		emails = [row.interviewer_email for row in (self.interviewer_email or []) + (self.online_panel or [])]
		names = dict(
			frappe.get_all(
				"Interviewer Email List",
				filters={"name": ["in", emails]},
				fields=["name", "interviewer_name"],
				as_list=True,
			)
		)
		self.interviewer_names = ", ".join(names.get(e) or e for e in emails)
