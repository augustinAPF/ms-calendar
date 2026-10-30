# Copyright (c) 2026, Azim Premji Foundation and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import validate_email_address

SETTINGS_DOCTYPE = "Enablers Settings"

_SIGNATURE = "<p>Regards,<br>People Function<br>Azim Premji Foundation</p>"
_BUTTON = "display:inline-block;background:#1f3a5f;color:#ffffff;padding:10px 22px;text-decoration:none;border-radius:4px;font-weight:600;"

# Standard values used whenever a Settings field is left blank. Texts are
# the ones in "Pathway workflow.docx" (Workflow for Enablers).
DEFAULTS = {
	"regret_delay_days": 0,
	"application_received_subject": "Application received - Azim Premji Foundation",
	"application_received_message": """<p>Hi {{ applicant_name }},</p>
<p>Thank you for applying for {{ requirement_name }}.</p>
<p>We will review your application and contact you with an update.</p>
<p>Your application ID is <b>{{ application_id }}</b>.<br>
Please use this ID to track the status of your application on the portal.</p>
<p><a href="{{ track_url }}" style=\"""" + _BUTTON + """\">Track Application</a></p>
<p>If you have any questions, please reply to this email. We're happy to help!</p>
""" + _SIGNATURE,
	"regret_subject": "Application status – Azim Premji Foundation",
	"regret_message": """<p>Hi {{ applicant_name }},</p>
<p>We hope this message finds you well. Thank you for your interest in opportunities with Azim Premji Foundation.</p>
<p>After careful consideration, we regret to inform you that we will not be moving forward with your application <b>{{ application_id }}</b> at this time. However, we will retain your profile in our database and we will reach out when the opportunity aligns more closely with your experience and interest.</p>
<p>We truly appreciate your time and cooperation in the process and we wish you every success in your future endeavours.</p>
""" + _SIGNATURE,
	"panel_invite_subject": "Interview - {{ applicant_name }} – {{ requirement_name }}",
	"panel_invite_message": """<p>Hi {{ interviewer_name }},</p>
<p>Kindly find the details of the interview scheduled:</p>
<p><b>Applicant name:</b> {{ applicant_name }}<br>
<b>Role:</b> {{ requirement_name }}<br>
<b>Round:</b> {{ interview_round }}<br>
<b>Date:</b> {{ interview_date }}<br>
<b>Time:</b> {{ interview_time }}<br>
<b>Mode:</b> {{ mode }}<br>
{% if online_panel %}<b>In person:</b> {{ in_person_panel }}<br>
<b>Online (MS Teams):</b> {{ online_panel }}<br>
{% endif %}{% if meeting_link %}<b>MS Teams:</b> <a href="{{ meeting_link }}">Join the meeting</a><br>{% endif %}
{% if meeting_id %}<b>Meeting ID:</b> {{ meeting_id }}{% if passcode %} · <b>Passcode:</b> {{ passcode }}{% endif %}<br>{% endif %}
{% if meeting_room %}<b>Meeting room:</b> {{ meeting_room }}<br>{% endif %}
{% if venue %}<b>Venue:</b> {{ venue }}{% if map_link %} (<a href="{{ map_link }}">Google Maps</a>){% endif %}<br>{% endif %}
</p>
{% if message %}<p><b>Note from the recruitment team:</b> {{ message }}</p>{% endif %}
<p><b>Documents</b> (attached to this invite):<br>
{% for d in documents %}{{ d }}<br>{% endfor %}
</p>
<p><b>Feedback form to share your views:</b> <a href="{{ feedback_link }}">Open the feedback form</a></p>
<p>Kindly reach out to us if you have any questions.</p>
""" + _SIGNATURE,
	"candidate_invite_subject": "Interview - {{ requirement_name }}",
	"candidate_invite_message": """<p>Hi {{ applicant_name }},</p>
<p>Kindly find the details of the interview scheduled:</p>
<p><b>Role:</b> {{ requirement_name }}<br>
<b>Date:</b> {{ interview_date }}<br>
<b>Time:</b> {{ interview_time }}<br>
<b>Mode:</b> {{ mode }}<br>
{% if meeting_link and not venue %}<b>MS Teams:</b> <a href="{{ meeting_link }}">Join the meeting</a><br>{% endif %}
{% if meeting_id and not venue %}<b>Meeting ID:</b> {{ meeting_id }}{% if passcode %} · <b>Passcode:</b> {{ passcode }}{% endif %}<br>{% endif %}
{% if meeting_room %}<b>Meeting room:</b> {{ meeting_room }}<br>{% endif %}
{% if venue %}<b>Venue:</b> {{ venue }}{% if map_link %} (<a href="{{ map_link }}">Google Maps</a>){% endif %}<br>{% endif %}
</p>
<p>A calendar invite is attached to this email.</p>
<p>Kindly reach out to us if you have any questions.</p>
""" + _SIGNATURE,
	# The doc's subject says "Azim Premji Health Equity Fellowship" (copied
	# from Health) — the Foundation's name is used instead.
	"document_request_subject": "Documents needed – Azim Premji Foundation",
	"document_request_message": """<p>Hi {{ applicant_name }},</p>
<p>We are glad you could participate in the discussions for {{ requirement_name }}.</p>
<p>Kindly share the documents requested to proceed with the next steps.</p>
<p><b>List of documents to be collected:</b></p>
<ul>
<li>PAN Card and Aadhaar Card (both sides)</li>
<li>Education Certificates: Class X, XII, Degree and Post-Graduation, PhD — mark sheets and degree certificates. It is mandatory that we receive the completion certificates (not provisional) for all the education courses you've done.</li>
<li>Experience letter from previous organisations</li>
<li>Latest offer or salary revision letter</li>
<li>Pay slips (of the last three months worked)</li>
</ul>
{% if remarks %}<p><b>Note:</b> {{ remarks }}</p>{% endif %}
<p><a href="{{ upload_link }}" style=\"""" + _BUTTON + """\">Upload Documents</a></p>
<p>Kindly reach out to us if you have any questions.</p>
""" + _SIGNATURE,
}


class EnablersSettings(Document):
	def onload(self):
		fill_defaults(self)

	def validate(self):
		fill_defaults(self)
		for fieldname in ("sender_email", "recruiter_email"):
			value = (self.get(fieldname) or "").strip()
			if value and not validate_email_address(value):
				frappe.throw(_("{0} is not a valid email address.").format(value))
		if self.regret_delay_days < 0:
			frappe.throw(_("Send regret email after (days) can't be negative."))
		seen = set()
		for row in self.sub_unit_recruiters:
			if row.sub_unit in seen:
				frappe.throw(_("Sub Unit {0} is listed twice.").format(row.sub_unit))
			seen.add(row.sub_unit)


def fill_defaults(doc):
	for fieldname, value in DEFAULTS.items():
		if doc.get(fieldname) in (None, ""):
			doc.set(fieldname, value)


def get_settings():
	doc = frappe.get_single(SETTINGS_DOCTYPE)
	fill_defaults(doc)
	return doc


def round_1_approvers(settings):
	return {row.user for row in settings.round_1_approvers if row.user}


def sub_unit_recruiter(settings, sub_unit):
	"""(recruiter user, recruiter email) for a sub-unit, or (None, None)."""
	for row in settings.sub_unit_recruiters:
		if row.sub_unit == sub_unit:
			return row.recruiter, row.recruiter_email
	return None, None
