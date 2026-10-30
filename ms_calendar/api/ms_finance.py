"""Finance Fellowship — the applicant rules, Outlook interview invites, the
applicant's public pages (status / upload / offer / feedback context) and
the regret job.

Fellowship applicants are Enablers Registration Forms (the one Desk form)
with sub-unit "Finance Fellowship". That form is a custom DocType with no
controller, so ms_enablers' hooks hand Fellowship applicants to the
fellowship_* functions below; the other Finance doctypes keep their own
controllers. Graph helpers are shared with ms_health / ms_enablers.
"""

import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import frappe
import requests
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import (
	add_days,
	cint,
	date_diff,
	formatdate,
	get_datetime,
	getdate,
	now_datetime,
	validate_email_address,
)

from ms_calendar.api import enablers_panel
from ms_calendar.api.ms_health import (
	_attach_files_to_event,
	_cancel_graph_event,
	_graph_headers,
	_health_teams_info,
)
from ms_calendar.ms_calendar.doctype.finance_fellowship_feedback_form.finance_fellowship_feedback_form import (
	ROUND_PDF_FIELD,
	build_round_feedback_pdf,
)
from ms_calendar.ms_calendar.doctype.finance_fellowship_settings.finance_fellowship_settings import (
	REGISTRATION_DOCTYPE,
	STAGE_APPLICATION_FORM,
	STAGE_DOCUMENTS,
	email_context,
	get_settings,
	offer_link,
	render_template,
	send_templated_email,
	sender_kwargs,
	upload_link,
)

FELLOWSHIP_UNIT = "Enablers"
FELLOWSHIP_SUB_UNIT = "Finance Fellowship"
FELLOWSHIP_ROLE = "Azim Premji Finance Fellowship"
FELLOWSHIP_WEB_FORM = "finance-fellowship-registration-form"

# Status list for Fellowship applicants (Process Flow – Finance Fellowship).
FELLOWSHIP_STATUSES = [
	"New Applicant",
	"Shortlist - CV", "On hold - CV", "Regret - CV",
	"Round 1 Scheduled", "Shortlist - R1", "On hold - R1", "Regret - R1",
	"Application Form Received",
	"Round 2 Scheduled", "Shortlist - R2", "On hold - R2", "Regret - R2",
	"Documents Received", "Documents Verified",
	"Salary Fitment Done",
	"Offer Released", "Offer Accepted", "Offer Declined",
]
REGRET_STATUSES = ("Regret - CV", "Regret - R1", "Regret - R2")

LANGUAGE_FIELDS = (
	"lang_english", "lang_bengali", "lang_chhattisgarhi", "lang_gujarati", "lang_hindi",
	"lang_kannada", "lang_malayalam", "lang_marathi", "lang_odia", "lang_tamil",
)
# (follow-up field, controlling field, value that makes it mandatory) — the
# "Other" boxes; mandatory_depends_on is only checked in the browser.
CONDITIONAL_REQUIRED = (
	("previous_application_details", "foundation_selection", "Yes"),
	("association_details", "foundation_association", "Yes"),
	("ug_degree_other", "ug_degree", "Others"),
	("ug_year_other", "ug_year", "Other"),
	("ug_state_other", "ug_state", "Other"),
	("pg_degree_other", "pg_degree", "Others"),
	("pg_duration_other", "pg_duration", "Other"),
	("pg_year_other", "pg_year", "Other"),
	("pg_state_other", "pg_state", "Other"),
	("professional_qualification_other", "professional_qualification", "Others"),
	("professional_year_other", "professional_year", "Other"),
	("professional_duration_other", "professional_duration", "Other"),
	("professional_state_other", "professional_state", "Other"),
	("referral_details", "opportunity_source", "Referral from employee of Azim Premji Foundation"),
	("source_other", "opportunity_source", "Others"),
)
YEAR_OTHER_FIELDS = ("ug_year_other", "pg_year_other", "professional_year_other")
RESUME_EXTENSIONS = (".pdf", ".doc", ".docx")
ASSOCIATE_EXPERIENCE = ("Fresher", "1 year", "2 years")
ASSOCIATE_FELLOW = "Associate Fellow (0-2 years)"
FELLOW = "Fellow (more than 2 years)"

# The one interview form for Enablers and Finance Fellowship interviews.
SCHEDULE_DOCTYPE = "Enablers Interview Schedule"
IST = ZoneInfo("Asia/Kolkata")
GRAPH = "https://graph.microsoft.com/v1.0"

ROUND_STATUS = {"Round 1": "Round 1 Scheduled", "Round 2": "Round 2 Scheduled"}
# Statuses that are already past a round — scheduling never moves them back.
PAST_ROUND_1 = (
	"Shortlist - R1", "On hold - R1", "Application Form Received", "Round 2 Scheduled",
	"Shortlist - R2", "On hold - R2", "Documents Received", "Documents Verified",
	"Salary Fitment Done", "Offer Released", "Offer Accepted", "Offer Declined",
)


# ---------------------------------------------------------------- Fellowship applicant (Enablers Registration Form)
def is_fellowship(doc):
	"""A Fellowship applicant — sub-unit Finance Fellowship, or a new one
	coming in through the Finance Fellowship web form."""
	if doc.get("department") == FELLOWSHIP_SUB_UNIT:
		return True
	if not doc.is_new():
		return False
	return frappe.form_dict.get("web_form") == FELLOWSHIP_WEB_FORM or bool(doc.get("professional_qualification"))


def fellowship_validate(doc):
	if doc.is_new():
		doc.unit = FELLOWSHIP_UNIT
		doc.department = FELLOWSHIP_SUB_UNIT
		doc.role = FELLOWSHIP_ROLE
	_clean_contact_details(doc)
	_set_age(doc)
	_validate_resume(doc)
	_validate_conditional_fields(doc)
	if sum(cint(doc.get(f)) for f in LANGUAGE_FIELDS) < 2:
		frappe.throw(_("Please choose at least two languages you can speak."), title=_("Languages"))
	if doc.is_new():
		_validate_new_application(doc)
	_suggest_fitment(doc)
	_track_status_change(doc)


def _clean_contact_details(doc):
	digits = re.sub(r"\D", "", doc.phone_number or "")
	if len(digits) == 12 and digits.startswith("91"):
		digits = digits[2:]
	if len(digits) != 10:
		frappe.throw(_("Please enter a valid 10-digit phone number."), title=_("Phone number"))
	doc.phone_number = digits
	doc.email_address = (doc.email_address or "").strip().lower()
	if not validate_email_address(doc.email_address):
		frappe.throw(_("Please enter a valid email address."), title=_("Email address"))


def _set_age(doc):
	if not doc.date_of_birth:
		return
	on = getdate(doc.get("application_date") or now_datetime())
	dob = getdate(doc.date_of_birth)
	if dob >= on:
		frappe.throw(_("Date of birth must be in the past."))
	# The shared "age" field is Data on the Enablers form.
	doc.age = str(on.year - dob.year - ((on.month, on.day) < (dob.month, dob.day)))


def _validate_resume(doc):
	url = (doc.resume or "").split("?")[0].lower()
	if url and not url.endswith(RESUME_EXTENSIONS):
		frappe.throw(_("Please upload your resume as a PDF, DOC or DOCX file."), title=_("Resume"))


def _validate_conditional_fields(doc):
	missing = [
		_(doc.meta.get_label(field))
		for field, controller, value in CONDITIONAL_REQUIRED
		if doc.get(controller) == value and not doc.get(field)
	]
	if missing:
		frappe.throw(_("Please fill in:") + "<br>• " + "<br>• ".join(missing), title=_("Missing details"))
	this_year = getdate().year
	for field in YEAR_OTHER_FIELDS:
		year = cint(doc.get(field))
		if year and not 1960 <= year <= this_year:
			frappe.throw(
				_("{0}: please enter a year between 1960 and {1}.").format(_(doc.meta.get_label(field)), this_year)
			)


def _validate_new_application(doc):
	from ms_calendar.api.otp import enforce_otp_verification

	enforce_otp_verification(doc)
	if not cint(doc.get("authorisation")):
		frappe.throw(_("Please tick the authorisation to submit your application."))
	fellows = {"department": FELLOWSHIP_SUB_UNIT}
	existing = frappe.db.get_value(
		REGISTRATION_DOCTYPE, dict(fellows, email_address=doc.email_address), "name"
	) or frappe.db.get_value(REGISTRATION_DOCTYPE, dict(fellows, phone_number=doc.phone_number), "name")
	if existing:
		frappe.throw(
			_(
				"An application with this email address or phone number already exists ({0}). "
				"Please use the Track Application page to see its status."
			).format(existing),
			title=_("Already applied"),
		)
	doc.application_status = doc.get("application_status") or "New Applicant"
	doc.application_date = doc.get("application_date") or now_datetime()
	doc.access_key = frappe.generate_hash(length=24)


def _suggest_fitment(doc):
	if not doc.get("fellow_category") and doc.get("work_experience"):
		doc.fellow_category = ASSOCIATE_FELLOW if doc.work_experience in ASSOCIATE_EXPERIENCE else FELLOW
	if doc.get("fellow_category") and not doc.get("monthly_stipend"):
		settings = get_settings()
		doc.monthly_stipend = (
			settings.associate_fellow_stipend if doc.fellow_category == ASSOCIATE_FELLOW else settings.fellow_stipend
		)


def _track_status_change(doc):
	if doc.is_new() or not doc.has_value_changed("application_status"):
		return
	status = doc.application_status
	if status in REGRET_STATUSES:
		doc.regret_marked_on = now_datetime()
		doc.regret_email_sent_on = None
	elif status == "Salary Fitment Done":
		if not (doc.get("fellow_category") and doc.get("monthly_stipend")):
			frappe.throw(_("Fill in the Fellow category and Monthly stipend before marking the fitment done."))
		doc.fitment_done_by = frappe.session.user
		doc.fitment_done_on = now_datetime()
	elif status == "Offer Released":
		if not doc.get("offer_letter"):
			frappe.throw(_("Attach the Offer letter before releasing the offer."))
		doc.offer_released_on = now_datetime()
		doc.offer_response = None
		doc.offer_response_on = None
	elif status in ("Offer Accepted", "Offer Declined") and not doc.get("offer_response"):
		doc.offer_response = "Accepted" if status == "Offer Accepted" else "Declined"
		doc.offer_response_on = now_datetime()


def fellowship_after_insert(doc):
	send_email(doc, "application_received")
	doc.db_set("acknowledgement_sent_on", now_datetime(), update_modified=False)


def fellowship_on_update(doc):
	if doc.flags.in_insert or not doc.has_value_changed("application_status"):
		return
	status = doc.application_status
	if status == "Shortlist - R1":
		request_application_form(doc)
	elif status == "Shortlist - R2":
		request_documents(doc)
	elif status == "Offer Released":
		send_offer(doc)


def send_email(doc, template, attachments=None, **extra):
	settings = get_settings()
	send_templated_email(
		settings, template, doc.email_address, email_context(settings, doc, **extra), doc.doctype, doc.name,
		attachments=attachments,
	)


def request_application_form(doc, remarks=None):
	send_email(doc, "application_form_request", upload_link=upload_link(doc, STAGE_APPLICATION_FORM), remarks=remarks)
	doc.db_set("application_form_requested_on", now_datetime(), update_modified=False)


def request_documents(doc, remarks=None):
	send_email(doc, "document_request", upload_link=upload_link(doc, STAGE_DOCUMENTS), remarks=remarks)
	doc.db_set("documents_requested_on", now_datetime(), update_modified=False)


def send_offer(doc):
	send_email(doc, "offer_released", attachments=[{"file_url": doc.offer_letter}], offer_link=offer_link(doc))


def send_regret(doc):
	send_email(doc, "regret")
	doc.db_set("regret_email_sent_on", now_datetime(), update_modified=False)


def record_offer_response(doc, response, reason=None):
	"""From the applicant's offer page (and the recruiter's button)."""
	if doc.application_status != "Offer Released":
		frappe.throw(_("This offer is no longer open for a response."))
	if response not in ("Accepted", "Declined"):
		frappe.throw(_("Invalid response."))
	doc.offer_response = response
	doc.offer_response_on = now_datetime()
	doc.offer_decline_reason = reason if response == "Declined" else None
	doc.application_status = "Offer Accepted" if response == "Accepted" else "Offer Declined"
	doc.flags.ignore_permissions = True
	doc.save()


def _fellowship_doc(application_id):
	doc = frappe.get_doc(REGISTRATION_DOCTYPE, application_id)
	doc.check_permission("write")
	if doc.get("department") != FELLOWSHIP_SUB_UNIT:
		frappe.throw(_("{0} is not a Finance Fellowship applicant.").format(application_id))
	return doc


@frappe.whitelist()
def resend_email(application_id, kind):
	"""Desk buttons: send a Fellowship applicant email again."""
	doc = _fellowship_doc(application_id)
	actions = {
		"application_received": lambda: send_email(doc, "application_received"),
		"application_form": lambda: request_application_form(doc),
		"documents": lambda: request_documents(doc),
		"offer": lambda: send_offer(doc),
	}
	if kind not in actions:
		frappe.throw(_("Unknown email."))
	if kind == "offer" and not doc.get("offer_letter"):
		frappe.throw(_("Attach the Offer letter first."))
	actions[kind]()
	return _("Email queued to {0}.").format(doc.email_address)


@frappe.whitelist()
def release_offer(application_id):
	doc = _fellowship_doc(application_id)
	if doc.application_status != "Salary Fitment Done":
		frappe.throw(_("Mark the salary fitment done before releasing the offer."))
	doc.application_status = "Offer Released"
	doc.save()
	return _("Offer emailed to {0}.").format(doc.email_address)


@frappe.whitelist()
def record_offer_response_by_recruiter(application_id, response, reason=None):
	record_offer_response(_fellowship_doc(application_id), response, reason)


def regret_is_due(doc, delay_days):
	return (
		doc.application_status in REGRET_STATUSES
		and doc.regret_marked_on
		and not doc.regret_email_sent_on
		and date_diff(now_datetime(), doc.regret_marked_on) >= delay_days
	)


# ---------------------------------------------------------------- interview invites
def _slot(schedule):
	start = get_datetime(f"{schedule.interview_date} {schedule.start_time}")
	end = get_datetime(f"{schedule.interview_date} {schedule.end_time}")
	return start, end


def _is_online(schedule):
	"""A Teams meeting is needed (Online, or Hybrid's online panel)."""
	return enablers_panel.modes(schedule)[0]


def _is_in_person(schedule):
	return enablers_panel.modes(schedule)[1]


def _invite_context(schedule, registration, settings, teams=("", "", ""), documents=()):
	start, end = _slot(schedule)
	join_url, meeting_id, passcode = teams
	return email_context(
		settings,
		registration,
		panel_name=schedule.interviewer_names or "Panel member",
		interview_round=schedule.interview_round,
		interview_date=start.strftime("%A, %d %b %Y"),
		interview_time=f"{start.strftime('%I:%M %p')} – {end.strftime('%I:%M %p')}",
		mode=enablers_panel.mode_label(schedule),
		meeting_link=join_url,
		meeting_id=meeting_id,
		passcode=passcode,
		venue=(schedule.venue or "") if _is_in_person(schedule) else "",
		map_link=(schedule.google_map_link or "") if _is_in_person(schedule) else "",
		meeting_room=schedule.meeting_room or "",
		assignment=(schedule.assignment_details or "Yes") if cint(schedule.assignment_round) else "",
		message=schedule.message_to_the_interviewer or "",
		feedback_link=schedule.feedback_link,
		earlier_feedback=schedule.interview_round == "Round 2",
		**enablers_panel.invite_extras(schedule, list(documents)),
	)


def _event_payload(schedule, body_html, subject=None, online=None, in_person=None):
	"""Outlook event body. subject / online / in_person default to Finance's
	rules; ms_enablers passes its own (its Round 3 can be in person + Teams)."""
	start, end = _slot(schedule)
	online = _is_online(schedule) if online is None else online
	in_person = _is_in_person(schedule) if in_person is None else in_person
	payload = {
		"subject": subject or f"Finance Fellowship – {schedule.interview_round} – {schedule.applicant_name}",
		"start": {"dateTime": start.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "Asia/Kolkata"},
		"end": {"dateTime": end.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "Asia/Kolkata"},
		"showAs": "busy",
		"isOnlineMeeting": online,
		"body": {"contentType": "HTML", "content": body_html},
	}
	if online:
		payload["onlineMeetingProvider"] = "teamsForBusiness"
	location = schedule.meeting_room or (schedule.venue or "").split("\n")[0]
	if location and in_person:
		payload["location"] = {"displayName": location}
	return payload


def _panel_attendees(schedule):
	"""Interviewers (+ Hybrid's online panel) required, CC optional. The
	panel invite carries the feedback link — never the applicant."""
	required = enablers_panel.panel_members(schedule)
	taken = {e.lower() for e in required}
	optional = [e for e in enablers_panel.panel_members(schedule, cc=True) if e.lower() not in taken]
	return [{"emailAddress": {"address": e}, "type": "required"} for e in required] + [
		{"emailAddress": {"address": e}, "type": "optional"} for e in optional
	]


def _panel_and_room(schedule):
	"""Panel + the meeting room picked with "Find a free meeting room" (booked)."""
	attendees = _panel_attendees(schedule)
	if schedule.get("room_email"):
		attendees.append({"emailAddress": {"address": schedule.room_email}, "type": "resource"})
	return attendees


def _application_pdf_url(registration):
	"""The filled registration form as a clean PDF, attached to the panel invite."""
	return enablers_panel.registration_pdf_url(registration)


def print_format_for(doctype):
	"""The DocType's default print format only if it really exists (the
	Enablers form's default "Application" exists on no site) — else frappe
	pops "Print Format … not found" and falls back to Standard anyway."""
	default = frappe.get_meta(doctype).default_print_format
	if default and frappe.db.exists("Print Format", {"name": default, "disabled": 0}):
		return default
	return "Standard"


def _invite_attachments(schedule, registration):
	"""[(label, file url)] for the panel invite: resume, registration form,
	and for Round 2 the Round 1 feedback + the filled Application Form."""
	files = [("Resume", registration.resume), ("Registration form", _application_pdf_url(registration))]
	if schedule.interview_round == "Round 2":
		files.append((
			"Round 1 feedback",
			registration.get(ROUND_PDF_FIELD["Round 1"]) or build_round_feedback_pdf(registration.name, "Round 1"),
		))
		files.append((
			"Application form",
			frappe.db.get_value(
				"Finance Fellowship Document Collection",
				{"application_id": registration.name, "stage": STAGE_APPLICATION_FORM},
				"application_form",
				order_by="creation desc",
			),
		))
	return [(label, url) for label, url in files if url]


def _ics(schedule, registration, settings, ctx, method="PUBLISH", sequence=0, summary=None, title=None):
	"""Calendar file for the applicant's email. summary / title default to
	Finance's; ms_enablers passes the role it is hiring for."""
	start, end = _slot(schedule)
	summary = summary or "Discussion - Finance Fellowship"
	title = title or settings.fellowship_name

	def utc(dt):
		return dt.replace(tzinfo=IST).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

	def esc(text):
		return (text or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")

	location = ctx.get("meeting_link") or ctx.get("venue") or ""
	description = f"{title} – {schedule.interview_round}"
	if ctx.get("meeting_link"):
		description += f"\nJoin: {ctx['meeting_link']}"
	lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Azim Premji Foundation//Pathways//EN",
		f"METHOD:{method}",
		"BEGIN:VEVENT",
		f"UID:{schedule.name}@pathways.azimpremjifoundation.org",
		f"SEQUENCE:{sequence}",
		f"DTSTAMP:{utc(datetime.now(IST).replace(tzinfo=None))}",
		f"DTSTART:{utc(start)}",
		f"DTEND:{utc(end)}",
		f"SUMMARY:{esc(summary)}",
		f"LOCATION:{esc(location)}",
		f"DESCRIPTION:{esc(description)}",
		"STATUS:CANCELLED" if method == "CANCEL" else "STATUS:CONFIRMED",
		"END:VEVENT",
		"END:VCALENDAR",
	]
	return "\r\n".join(lines)


def _email_candidate(schedule, registration, settings, ctx, subject_prefix="", sequence=0):
	ctx = enablers_panel.candidate_context(schedule, ctx)
	subject, message = render_template(settings, "candidate_invite", ctx)
	frappe.sendmail(
		recipients=[registration.email_address],
		subject=subject_prefix + subject,
		message=message,
		reference_doctype=SCHEDULE_DOCTYPE,
		reference_name=schedule.name,
		attachments=[
			{"fname": "Finance_Fellowship_Discussion.ics", "fcontent": _ics(schedule, registration, settings, ctx, sequence=sequence)}
		],
		**sender_kwargs(settings),
	)


def _move_applicant_status(registration, interview_round):
	# Fresh copy: the one passed in went through frappe.get_print for the
	# application PDF, which sets flags.in_print — and save() silently skips
	# a doc flagged in_print.
	registration = frappe.get_doc(REGISTRATION_DOCTYPE, registration.name)
	target = ROUND_STATUS[interview_round]
	current = registration.application_status
	if current == target or (interview_round == "Round 1" and current in PAST_ROUND_1):
		return
	if interview_round == "Round 2" and current in PAST_ROUND_1[4:]:
		return
	registration.application_status = target
	registration.save()


def _load(name):
	schedule = frappe.get_doc(SCHEDULE_DOCTYPE, name)
	schedule.check_permission("write")
	registration = frappe.get_doc(REGISTRATION_DOCTYPE, schedule.application_id)
	return schedule, registration, get_settings()


@frappe.whitelist()
def schedule_interview(name):
	"""Creates the Outlook event for the panel (template 5, with resume /
	application form / earlier feedback attached) and emails the applicant
	(template 6 + calendar file). Moves the applicant to "Round N Scheduled"."""
	schedule, registration, settings = _load(name)
	if schedule.event_id and schedule.status == "Scheduled":
		frappe.throw(_("This interview is already scheduled. Use Reschedule to change it."))
	if not schedule.organizer_email:
		frappe.throw(_("Organizer Email is required to send the invite."))

	headers = _graph_headers()
	organizer = schedule.organizer_email.strip()

	# 1) Create the event first (Graph adds the Teams link to it), then
	#    write our own body with the meeting details.
	draft = _event_payload(schedule, "<p>Interview scheduled.</p>")
	res = requests.post(f"{GRAPH}/users/{organizer}/events", headers=headers, json=draft, timeout=30)
	if res.status_code not in (200, 201):
		frappe.log_error(title="FINANCE_INTERVIEW_CREATE", message=res.text[:2000])
		frappe.throw(_("Outlook did not accept the invite ({0}). Please try again.").format(res.status_code))
	event = res.json()
	event_id = event["id"]

	teams = ("", "", "")
	if _is_online(schedule):
		teams = _health_teams_info(organizer, event_id, headers, event_json=event)

	# 2) Files go on BEFORE the panel is added: Outlook sends the invite when
	#    the attendees are set, and files added after that never reach them.
	files = _invite_attachments(schedule, registration)
	_attach_files_to_event(headers, organizer, event_id, None, [url for _label, url in files], new_event=True)

	# 3) Body + panel (this sends the invite).
	ctx = _invite_context(schedule, registration, settings, teams, documents=[label for label, _url in files])
	_, panel_body = render_template(settings, "panel_invite", ctx)
	patch = requests.patch(
		f"{GRAPH}/users/{organizer}/events/{event_id}",
		headers=headers,
		json={
			"subject": render_template(settings, "panel_invite", ctx)[0],
			"attendees": _panel_and_room(schedule),
			"body": {"contentType": "HTML", "content": panel_body},
		},
		timeout=30,
	)
	if patch.status_code not in (200, 201):
		frappe.log_error(title="FINANCE_INTERVIEW_PATCH", message=patch.text[:2000])

	schedule.db_set(
		{
			"event_id": event_id,
			"status": "Scheduled",
			"scheduled_on": now_datetime(),
			"teams_join_url": teams[0],
			"teams_meeting_id": teams[1],
			"teams_passcode": teams[2],
			"cancel_reason": None,
		}
	)
	_email_candidate(schedule, registration, settings, ctx)
	_move_applicant_status(registration, schedule.interview_round)
	return {"event_id": event_id, "join_url": teams[0]}


@frappe.whitelist()
def reschedule_interview(name):
	"""Moves the existing Outlook event to the saved date/time/venue and
	emails the applicant the new details."""
	schedule, registration, settings = _load(name)
	if not schedule.event_id or schedule.status != "Scheduled":
		frappe.throw(_("Only a scheduled interview can be rescheduled."))

	headers = _graph_headers()
	organizer = schedule.organizer_email.strip()
	teams = (schedule.teams_join_url or "", schedule.teams_meeting_id or "", schedule.teams_passcode or "")
	# Anything new (e.g. Round 1 feedback that came in since) goes on before
	# the update is sent; files already on the event are skipped.
	files = _invite_attachments(schedule, registration)
	_attach_files_to_event(headers, organizer, schedule.event_id, None, [url for _label, url in files])
	ctx = _invite_context(schedule, registration, settings, teams, documents=[label for label, _url in files])
	subject, panel_body = render_template(settings, "panel_invite", ctx)

	payload = _event_payload(schedule, panel_body)
	payload["subject"] = subject
	payload["attendees"] = _panel_and_room(schedule)
	payload.pop("isOnlineMeeting", None)
	payload.pop("onlineMeetingProvider", None)
	res = requests.patch(
		f"{GRAPH}/users/{organizer}/events/{schedule.event_id}", headers=headers, json=payload, timeout=30
	)
	if res.status_code not in (200, 201):
		frappe.log_error(title="FINANCE_INTERVIEW_RESCHEDULE", message=res.text[:2000])
		frappe.throw(_("Outlook did not accept the change ({0}).").format(res.status_code))

	schedule.db_set("scheduled_on", now_datetime())
	_email_candidate(schedule, registration, settings, ctx, subject_prefix="Rescheduled: ", sequence=1)
	return {"event_id": schedule.event_id}


@frappe.whitelist()
def cancel_interview(name, reason):
	schedule, registration, settings = _load(name)
	if not (reason or "").strip():
		frappe.throw(_("Please give a reason for cancelling."))
	if schedule.event_id:
		_cancel_graph_event(_graph_headers(), schedule.organizer_email.strip(), schedule.event_id, reason)
	schedule.db_set({"status": "Cancelled", "cancel_reason": reason, "event_id": None})

	ctx = _invite_context(schedule, registration, settings)
	frappe.sendmail(
		recipients=[registration.email_address],
		subject=f"Cancelled: Discussion - Finance Fellowship ({ctx['interview_date']})",
		message=(
			f"<p>Dear {frappe.utils.escape_html(registration.full_name)},</p>"
			f"<p>The discussion scheduled on <b>{ctx['interview_date']}, {ctx['interview_time']}</b> "
			"has been cancelled. We will get in touch with you with the next steps.</p>"
			"<p>Regards,<br>People Function<br>Azim Premji Foundation</p>"
		),
		reference_doctype=SCHEDULE_DOCTYPE,
		reference_name=schedule.name,
		attachments=[
			{
				"fname": "Finance_Fellowship_Discussion.ics",
				"fcontent": _ics(schedule, registration, settings, ctx, method="CANCEL", sequence=2),
			}
		],
		**sender_kwargs(settings),
	)
	return "Cancelled"


# ---------------------------------------------------------------- scheduler
def send_due_regret_emails():
	"""Hourly: the regret email goes out N days (Settings, default 3) after
	the applicant was marked Regret — and only if they still are."""
	settings = get_settings()
	cutoff = add_days(now_datetime(), -cint(settings.regret_delay_days))
	for name in frappe.get_all(
		REGISTRATION_DOCTYPE,
		filters={
			"application_status": ["in", REGRET_STATUSES],
			"regret_marked_on": ["<=", cutoff],
			"regret_email_sent_on": ["is", "not set"],
		},
		pluck="name",
	):
		try:
			send_regret(frappe.get_doc(REGISTRATION_DOCTYPE, name))
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			frappe.log_error(title="FINANCE_REGRET_EMAIL", message=frappe.get_traceback())


# ---------------------------------------------------------------- applicant pages (guest)
# Applicant-facing stage, per status. Regret shows only once the regret
# email has gone out (until then the applicant still sees "under review").
STATUS_STAGES = (
	("Application received", ("New Applicant", "On hold - CV")),
	("Round 1 discussion", ("Shortlist - CV", "Round 1 Scheduled")),
	("Round 2 discussion", ("Shortlist - R1", "On hold - R1", "Application Form Received", "Round 2 Scheduled")),
	("Document verification", ("Shortlist - R2", "On hold - R2", "Documents Received", "Documents Verified", "Salary Fitment Done")),
	("Offer", ("Offer Released", "Offer Accepted", "Offer Declined")),
)
STAGE_MESSAGES = {
	"New Applicant": "We have received your application and are reviewing it.",
	"On hold - CV": "We have received your application and are reviewing it.",
	"Shortlist - CV": "You are shortlisted for the Round 1 discussion. We will email you the details.",
	"Round 1 Scheduled": "Your Round 1 discussion is scheduled. Please check your email for the details.",
	"Shortlist - R1": "Please upload your Application Form using the link we emailed you.",
	"On hold - R1": "Your Round 1 discussion is complete. We will contact you with an update.",
	"Application Form Received": "We have received your Application Form. We will email you the Round 2 details.",
	"Round 2 Scheduled": "Your Round 2 discussion is scheduled. Please check your email for the details.",
	"Shortlist - R2": "Please upload your documents using the link we emailed you.",
	"On hold - R2": "Your Round 2 discussion is complete. We will contact you with an update.",
	"Documents Received": "We have received your documents and are verifying them.",
	"Documents Verified": "Your documents are verified. Your offer is being prepared.",
	"Salary Fitment Done": "Your offer is being prepared.",
	"Offer Released": "Your offer letter has been emailed to you. Please accept or decline it.",
	"Offer Accepted": "You have accepted the offer. Welcome to the Fellowship!",
	"Offer Declined": "You have declined the offer.",
}


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=20, seconds=60 * 10)
def get_application_status(application_id, email):
	application_id = (application_id or "").strip().upper()
	email = (email or "").strip().lower()
	row = frappe.db.get_value(
		REGISTRATION_DOCTYPE,
		{"name": application_id, "email_address": email},
		["name", "full_name", "application_status", "application_date", "regret_email_sent_on", "department"],
		as_dict=True,
	)
	if not row or row.department != FELLOWSHIP_SUB_UNIT:
		return {"found": False}

	status = row.application_status
	if status in REGRET_STATUSES:
		if row.regret_email_sent_on:
			return {
				"found": True,
				"name": row.name,
				"full_name": row.full_name,
				"applied_on": formatdate(row.application_date, "dd MMM yyyy"),
				"closed": True,
				"message": "Thank you for your interest. We are unable to proceed with your application at the moment.",
				"stages": [s for s, _ in STATUS_STAGES],
				"current": -1,
			}
		status = "New Applicant"

	current = next((i for i, (_s, statuses) in enumerate(STATUS_STAGES) if status in statuses), 0)
	return {
		"found": True,
		"name": row.name,
		"full_name": row.full_name,
		"applied_on": formatdate(row.application_date, "dd MMM yyyy"),
		"closed": False,
		"message": STAGE_MESSAGES.get(status, ""),
		"stages": [s for s, _ in STATUS_STAGES],
		"current": current,
	}


def _registration_for_key(application_id, key):
	registration = frappe.db.get_value(
		REGISTRATION_DOCTYPE,
		application_id,
		["name", "full_name", "access_key", "work_experience", "application_status"],
		as_dict=True,
	)
	if not registration or not key or registration.access_key != key:
		frappe.throw(_("This link is not valid. Please use the link in the email we sent you."), frappe.PermissionError)
	return registration


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=30, seconds=60 * 10)
def get_upload_context(application_id, key, stage):
	registration = _registration_for_key(application_id, key)
	if stage not in (STAGE_APPLICATION_FORM, STAGE_DOCUMENTS):
		frappe.throw(_("This link is not valid."))
	blank_form = get_settings().blank_application_form
	return {
		"applicant_name": registration.full_name,
		"experienced": registration.work_experience != "Fresher",
		"blank_form_link": frappe.utils.get_url(blank_form) if blank_form else "",
	}


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=30, seconds=60 * 10)
def get_feedback_context(schedule):
	row = frappe.db.get_value(
		SCHEDULE_DOCTYPE,
		schedule,
		["application_id", "applicant_name", "interview_round", "interview_date", "status", "sub_unit"],
		as_dict=True,
	)
	# The interview form is shared with Enablers — only Fellowship interviews here.
	if not row or row.status == "Cancelled" or row.sub_unit != FELLOWSHIP_SUB_UNIT:
		frappe.throw(_("This feedback link is not valid."))
	return {
		"application_id": row.application_id,
		"applicant_name": row.applicant_name,
		"interview_round": row.interview_round,
		"interview_date": str(row.interview_date) if row.interview_date else "",
	}


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=30, seconds=60 * 10)
def get_offer(application_id, key):
	registration = _registration_for_key(application_id, key)
	doc = frappe.get_doc(REGISTRATION_DOCTYPE, registration.name)
	return {
		"applicant_name": doc.full_name,
		"fellowship_name": get_settings().fellowship_name,
		"fellow_category": doc.fellow_category,
		"status": doc.application_status,
		"open": doc.application_status == "Offer Released",
		"response": doc.offer_response,
		"responded_on": formatdate(doc.offer_response_on, "dd MMM yyyy") if doc.offer_response_on else "",
	}


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=10, seconds=60 * 10)
def respond_to_offer(application_id, key, response, reason=None):
	registration = _registration_for_key(application_id, key)
	doc = frappe.get_doc(REGISTRATION_DOCTYPE, registration.name)
	if response == "Declined" and not (reason or "").strip():
		frappe.throw(_("Please tell us why you are declining the offer."))
	record_offer_response(doc, response, (reason or "").strip()[:1000] or None)
	return get_offer(application_id, key)
