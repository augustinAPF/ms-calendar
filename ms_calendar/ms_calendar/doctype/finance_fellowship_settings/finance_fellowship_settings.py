# Copyright (c) 2026, Azim Premji Foundation and contributors
# For license information, please see license.txt

from urllib.parse import urlencode

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import get_url, validate_email_address

SETTINGS_DOCTYPE = "Finance Fellowship Settings"
# Fellowship applicants live in the one Desk form (sub-unit "Finance Fellowship").
REGISTRATION_DOCTYPE = "Enablers Registration Form"

# Public pages (web forms / www pages shipped with the app).
REGISTRATION_ROUTE = "/finance-fellowship-registration-form/new"
STATUS_ROUTE = "/finance-fellowship-application-status"
UPLOAD_ROUTE = "/finance-fellowship-document-upload/new"
FEEDBACK_ROUTE = "/finance-fellowship-feedback-form/new"
OFFER_ROUTE = "/finance-fellowship-offer"

STAGE_APPLICATION_FORM = "Application Form (after Round 1)"
STAGE_DOCUMENTS = "Documents (after Round 2)"

_SIGNATURE = "<p>Regards,<br>People Function<br>Azim Premji Foundation</p>"

# Standard values used whenever a Settings field is left blank — so the
# recruitment team can edit any of them, but nothing breaks before they do.
# Texts are the ones in "Process Flow - Finance Fellowship Program - for
# Pathways - Version 2.xlsx" (Workflow sheet).
DEFAULTS = {
	"fellowship_name": "Azim Premji Finance Fellowship",
	"sender_email": "health.fellowship@azimpremjifoundation.org",
	"regret_delay_days": 3,
	# 1. Application submission
	"application_received_subject": "Application received - {{ fellowship_name }}",
	"application_received_message": """<p>Dear {{ applicant_name }},</p>
<p>Thank you for applying to the {{ fellowship_name }}.</p>
<p>We will review your application and contact you with an update.</p>
<p>Your application ID is <b>{{ application_id }}</b>.<br>
Please use this ID to track the status of your application on the portal.</p>
<p><a href="{{ track_url }}" style="display:inline-block;background:#1f3a5f;color:#ffffff;padding:10px 22px;text-decoration:none;border-radius:4px;font-weight:600;">Track Application</a></p>
<p>If you have any questions, please reply to this email. We're happy to help!</p>
""" + _SIGNATURE,
	# 2. Application regret
	"regret_subject": "Application status – {{ fellowship_name }}",
	"regret_message": """<p>Dear {{ applicant_name }},</p>
<p>We appreciate your interest in {{ fellowship_name }}.</p>
<p>After careful consideration, we regret to inform you that we are unable to proceed with your application <b>{{ application_id }}</b> at the moment.</p>
<p>However, we will get in touch with you if any meaningful opportunities that match your profile and interests arise in the future.</p>
<p>Thank you for your time and cooperation during this process.</p>
""" + _SIGNATURE,
	# 5. Panel member
	"panel_invite_subject": "Discussion - {{ applicant_name }} – Finance Fellowship",
	"panel_invite_message": """<p>Dear {{ panel_name }},</p>
<p>Kindly find the details of the discussion scheduled:</p>
<p><b>Applicant name:</b> {{ applicant_name }}<br>
<b>Role:</b> Finance Fellowship<br>
<b>Round:</b> {{ interview_round }}<br>
<b>Date:</b> {{ interview_date }}<br>
<b>Time:</b> {{ interview_time }}<br>
<b>Mode:</b> {{ mode }}<br>
{% if online_panel %}<b>In person:</b> {{ in_person_panel }}<br>
<b>Online (MS Teams):</b> {{ online_panel }}<br>
{% endif %}{% if meeting_link %}<b>Meeting link:</b> <a href="{{ meeting_link }}">Join the MS Teams meeting</a><br>{% endif %}
{% if meeting_id %}<b>Meeting ID:</b> {{ meeting_id }}<br>{% endif %}
{% if passcode %}<b>Passcode:</b> {{ passcode }}<br>{% endif %}
{% if venue %}<b>Venue:</b> {{ venue }}{% if map_link %} (<a href="{{ map_link }}">map</a>){% endif %}<br>{% endif %}
{% if meeting_room %}<b>Meeting room:</b> {{ meeting_room }}<br>{% endif %}
{% if assignment %}<b>Assignment round:</b> {{ assignment }}<br>{% endif %}
</p>
{% if message %}<p><b>Note from the recruitment team:</b> {{ message }}</p>{% endif %}
<p><b>Documents</b> (attached to this invite):<br>
{% for d in documents %}{{ d }}<br>{% endfor %}
</p>
<p><b>Feedback form to share your views:</b> <a href="{{ feedback_link }}">Open the feedback form</a></p>
<p>Kindly reach out to us if you have any questions.</p>
""" + _SIGNATURE,
	# 6. Applicant
	"candidate_invite_subject": "Discussion - Finance Fellowship",
	"candidate_invite_message": """<p>Dear {{ applicant_name }},</p>
<p>Kindly find the details of the discussion scheduled:</p>
<p><b>Role:</b> Finance Fellowship<br>
<b>Date:</b> {{ interview_date }}<br>
<b>Time:</b> {{ interview_time }}<br>
<b>Mode:</b> {{ mode }}<br>
{% if meeting_link %}<b>Meeting link:</b> <a href="{{ meeting_link }}">Join the MS Teams meeting</a><br>{% endif %}
{% if meeting_id %}<b>Meeting ID:</b> {{ meeting_id }}<br>{% endif %}
{% if passcode %}<b>Passcode:</b> {{ passcode }}<br>{% endif %}
{% if venue %}<b>Venue:</b> {{ venue }}{% if map_link %} (<a href="{{ map_link }}">map</a>){% endif %}<br>{% endif %}
{% if assignment %}<b>Note:</b> this discussion includes an assignment round.<br>{% endif %}
</p>
<p>A calendar invite is attached to this email.</p>
<p>Kindly reach out to us if you have any questions.</p>
""" + _SIGNATURE,
	# 7. After Round 1
	"application_form_request_subject": "Documents – {{ fellowship_name }}",
	"application_form_request_message": """<p>Dear {{ applicant_name }},</p>
<p>Thank you for participating in the discussions for the {{ fellowship_name }}.</p>
<p>Kindly share the document listed below to proceed with the next steps.</p>
<ol><li>Application Form{% if blank_form_link %} — <a href="{{ blank_form_link }}">download the form</a>, fill it in and upload it{% endif %}</li></ol>
{% if remarks %}<p><b>Note:</b> {{ remarks }}</p>{% endif %}
<p><a href="{{ upload_link }}" style="display:inline-block;background:#1f3a5f;color:#ffffff;padding:10px 22px;text-decoration:none;border-radius:4px;font-weight:600;">Upload Application Form</a></p>
<p>Kindly reach out to us if you have any questions.</p>
""" + _SIGNATURE,
	# 8. After Round 2
	"document_request_subject": "Documents – {{ fellowship_name }}",
	"document_request_message": """<p>Dear {{ applicant_name }},</p>
<p>Thank you for participating in the discussions for the {{ fellowship_name }}.</p>
<p>Kindly share the documents listed below to proceed with the next steps:</p>
<ol>
<li>PAN Card (Mandatory)</li>
<li>Aadhaar Card (Mandatory)</li>
<li>Education completion certificates (Mandatory)</li>
<li>Previous work experience letters (Mandatory for Experienced Professionals)</li>
<li>Last three months of payslip (Mandatory for Experienced Professionals)</li>
</ol>
{% if remarks %}<p><b>Note:</b> {{ remarks }}</p>{% endif %}
<p><a href="{{ upload_link }}" style="display:inline-block;background:#1f3a5f;color:#ffffff;padding:10px 22px;text-decoration:none;border-radius:4px;font-weight:600;">Upload Documents</a></p>
<p>Kindly reach out to us if you have any questions.</p>
""" + _SIGNATURE,
	# Offer
	"offer_released_subject": "Offer letter – {{ fellowship_name }}",
	"offer_released_message": """<p>Dear {{ applicant_name }},</p>
<p>Congratulations! We are pleased to offer you the {{ fellowship_name }}{% if fellow_category %} as <b>{{ fellow_category }}</b>{% endif %}.</p>
<p>Your offer letter is attached to this email. Please read it and let us know your decision.</p>
<p><a href="{{ offer_link }}" style="display:inline-block;background:#1f3a5f;color:#ffffff;padding:10px 22px;text-decoration:none;border-radius:4px;font-weight:600;">Accept or Decline the Offer</a></p>
<p>Kindly reach out to us if you have any questions.</p>
""" + _SIGNATURE,
}


class FinanceFellowshipSettings(Document):
	def onload(self):
		# Show the standard values/texts on the form so they can be edited.
		fill_defaults(self)

	def validate(self):
		fill_defaults(self)
		for fieldname in ("sender_email", "recruiter_email"):
			value = (self.get(fieldname) or "").strip()
			if value and not validate_email_address(value):
				frappe.throw(_("{0} is not a valid email address.").format(value))
		if self.regret_delay_days < 0:
			frappe.throw(_("Send regret email after (days) can't be negative."))


def fill_defaults(doc):
	for fieldname, value in DEFAULTS.items():
		if doc.get(fieldname) in (None, ""):
			doc.set(fieldname, value)


def get_settings():
	"""Settings with the standard values filled in for any blank field."""
	doc = frappe.get_single(SETTINGS_DOCTYPE)
	fill_defaults(doc)
	return doc


def public_url(route, **params):
	query = urlencode({k: v for k, v in params.items() if v not in (None, "")})
	return get_url(route + (f"?{query}" if query else ""))


def upload_link(registration, stage):
	return public_url(
		UPLOAD_ROUTE,
		app_id=registration.name,
		key=registration.access_key,
		stage=stage,
	)


def offer_link(registration):
	return public_url(OFFER_ROUTE, app_id=registration.name, key=registration.access_key)


def feedback_link(schedule):
	return public_url(
		FEEDBACK_ROUTE,
		app_id=schedule.application_id,
		round=schedule.interview_round,
		schedule=schedule.name,
	)


def email_context(settings, registration, **extra):
	blank_form = settings.blank_application_form
	ctx = {
		"fellowship_name": settings.fellowship_name,
		"applicant_name": registration.full_name,
		"application_id": registration.name,
		"track_url": public_url(STATUS_ROUTE, app_id=registration.name),
		"blank_form_link": get_url(blank_form) if blank_form else "",
		"fellow_category": registration.fellow_category or "",
	}
	ctx.update(extra)
	return ctx


def sender_kwargs(settings):
	"""Send from the configured mailbox only if it's an outgoing Email Account
	here — else frappe falls back to the default outgoing account."""
	if settings.sender_email and frappe.db.exists(
		"Email Account", {"email_id": settings.sender_email, "enable_outgoing": 1}
	):
		return {"sender": settings.sender_email}
	return {}


def render_template(settings, template, context):
	"""template = field prefix, e.g. "regret" -> (subject, message)."""
	subject = frappe.render_template(settings.get(f"{template}_subject"), context)
	message = frappe.render_template(settings.get(f"{template}_message"), context)
	return subject, message


def send_templated_email(
	settings, template, recipient, context, reference_doctype, reference_name, attachments=None, now=False
):
	subject, message = render_template(settings, template, context)
	frappe.sendmail(
		recipients=[recipient],
		subject=subject,
		message=message,
		reference_doctype=reference_doctype,
		reference_name=reference_name,
		attachments=attachments,
		now=now,
		**sender_kwargs(settings),
	)


def notify_recruiter(settings, subject, message, reference_doctype, reference_name):
	if not settings.recruiter_email:
		return
	frappe.sendmail(
		recipients=[settings.recruiter_email],
		subject=subject,
		message=message,
		reference_doctype=reference_doctype,
		reference_name=reference_name,
		**sender_kwargs(settings),
	)
