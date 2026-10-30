"""Enablers recruitment workflow ("Pathway workflow.docx" — Workflow for
Enablers) on top of the existing "Enablers Registration Form".

That form is a custom (DB-only) DocType on production, so it has no
controller: its rules are hooked here (hooks.py doc_events), and the fields
/ statuses the workflow needs are added to it by ensure_enablers_schema()
on every migrate — so UAT / production get them with a normal deploy.

Status rules (who may change the status) are per stage and sub-unit, set in
Enablers Settings. Interview invites reuse ms_finance's Outlook helpers.
"""

import frappe
import requests
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import add_days, cint, formatdate, get_url, get_url_to_form, now_datetime
from urllib.parse import urlencode

from ms_calendar.api import enablers_panel
from ms_calendar.api.finance_fellowship_fields import FELLOWSHIP_FIELDS
from ms_calendar.api.ms_finance import (
	FELLOWSHIP_ROLE,
	FELLOWSHIP_STATUSES,
	FELLOWSHIP_SUB_UNIT,
	FELLOWSHIP_UNIT,
	GRAPH,
	_attach_files_to_event,
	_cancel_graph_event,
	_event_payload,
	_graph_headers,
	_health_teams_info,
	_ics,
	_panel_attendees,
	_slot,
	fellowship_after_insert,
	fellowship_on_update,
	fellowship_validate,
	is_fellowship,
)
from ms_calendar.ms_calendar.doctype.finance_fellowship_settings.finance_fellowship_settings import (
	render_template,
	sender_kwargs,
)
from ms_calendar.ms_calendar.doctype.enablers_settings.enablers_settings import (
	get_settings,
	round_1_approvers,
	sub_unit_recruiter,
)

ERF = "Enablers Registration Form"
SCHEDULE_DOCTYPE = "Enablers Interview Schedule"
FEEDBACK_DOCTYPE = "Enablers Feedback Form"
DOCUMENTS_DOCTYPE = "Enablers Document Collection"
REFERENCE_DOCTYPE = "Enablers Reference Check"
RECRUITER_ROLE = "Enablers Recruiter"

STATUS_ROUTE = "/enablers-application-status"
UPLOAD_ROUTE = "/enablers-document-upload/new"
FEEDBACK_ROUTE = "/enablers-interview-feedback/new"

REGRET_STATUSES = (
	"CV Reject", "Recruiter Reject", "Round 1 Reject", "Round 2 Reject", "Round 3 Reject", "Round 4 Reject",
)
# Scheduling an interview moves the applicant to "<Round> Scheduled" (same
# names as the Finance Fellowship flow). The old "Round One/Two/Three"
# options stay on the form and are treated as the same stage.
ROUND_STATUS = {"Round 1": "Round 1 Scheduled", "Round 2": "Round 2 Scheduled", "Round 3": "Round 3 Scheduled"}
ROUND_PDF_FIELD = {
	"Round 1": "round_1_feedback_pdf",
	"Round 2": "round_2_feedback_pdf",
	"Round 3": "round_3_feedback_pdf",
}
# Status at which a round is scheduled: CV Shortlist → Round 1, Round 1
# Select → Round 2, Round 2 Select → Round 3 (and again from "<Round>
# Scheduled" after a cancelled interview).
SCHEDULABLE_FROM = {
	"Round 1": ("Pre Shortlist", "CV Shortlist", "On Hold", "Recruiter Round", "Round 1 Scheduled", "Round One"),
	"Round 2": ("Round 1 Select", "Round 2 Scheduled", "Round Two"),
	"Round 3": ("Round 2 Select", "Round 3 Scheduled", "Round Three"),
}
# Who may change the status, by the status it is changing FROM.
ROUND_1_STAGE = ("Round 1 Scheduled", "Round One")
RECRUITER_STAGE = (
	"Round 1 Select", "Round 2 Scheduled", "Round Two", "Round 2 Select",
	"Round 3 Scheduled", "Round Three", "Round 3 Select",
)

# Enablers status list (the form shows only these for Enablers applicants;
# Finance Fellowship ones get FELLOWSHIP_STATUSES). On the DocType they come
# first, then the Fellowship ones, then any old option (Round One/Two/Three).
STATUS_OPTIONS = [
	"New Applicant", "Pre Shortlist", "CV Shortlist", "On Hold", "CV Reject",
	"Recruiter Round", "Recruiter Reject",
	"Round 1 Scheduled", "Round 1 Select", "Round 1 Reject",
	"Round 2 Scheduled", "Round 2 Select", "Round 2 Reject",
	"Round 3 Scheduled", "Round 3 Select", "Round 3 Reject",
	"Round Four", "Round 4 Reject",
	"Document Collection", "Documents Received", "Reference Check",
	"Offer", "Blocklist",
]
LEGACY_ROUND_STATUS = {"Round One": "Round 1 Scheduled", "Round Two": "Round 2 Scheduled", "Round Three": "Round 3 Scheduled"}
STATUS_RANK = {s: i for i, s in enumerate(STATUS_OPTIONS)}
STATUS_RANK.update({old: STATUS_RANK[new] for old, new in LEGACY_ROUND_STATUS.items()})

# Fields the workflow adds to the Enablers Registration Form (after the
# last existing field), in this order.
WORKFLOW_FIELDS = [
	{"fieldname": "selection_process_tab", "fieldtype": "Tab Break", "label": "Selection Process"},
	{"fieldname": "enablers_feedback_section", "fieldtype": "Section Break", "label": "Interview feedback"},
	{"fieldname": "round_1_feedback_pdf", "fieldtype": "Attach", "label": "Round 1 Feedback (PDF)", "read_only": 1, "no_copy": 1},
	{"fieldname": "round_2_feedback_pdf", "fieldtype": "Attach", "label": "Round 2 Feedback (PDF)", "read_only": 1, "no_copy": 1},
	{"fieldname": "column_break_enablers_feedback", "fieldtype": "Column Break"},
	{"fieldname": "round_3_feedback_pdf", "fieldtype": "Attach", "label": "Round 3 Feedback (PDF)", "read_only": 1, "no_copy": 1},
	{"fieldname": "enablers_documents_section", "fieldtype": "Section Break", "label": "Documents"},
	{"fieldname": "documents_requested_on", "fieldtype": "Datetime", "label": "Documents requested on", "read_only": 1, "no_copy": 1},
	{"fieldname": "column_break_enablers_documents", "fieldtype": "Column Break"},
	{"fieldname": "documents_received_on", "fieldtype": "Datetime", "label": "Documents received on", "read_only": 1, "no_copy": 1},
	{"fieldname": "enablers_system_section", "fieldtype": "Section Break", "label": "System", "collapsible": 1},
	{"fieldname": "access_key", "fieldtype": "Data", "label": "Access key", "read_only": 1, "hidden": 1, "no_copy": 1},
	{"fieldname": "acknowledgement_sent_on", "fieldtype": "Datetime", "label": "Application received email sent on", "read_only": 1, "no_copy": 1},
	{"fieldname": "column_break_enablers_system", "fieldtype": "Column Break"},
	{"fieldname": "regret_marked_on", "fieldtype": "Datetime", "label": "Regret marked on", "read_only": 1, "no_copy": 1},
	{"fieldname": "regret_email_sent_on", "fieldtype": "Datetime", "label": "Regret email sent on", "read_only": 1, "no_copy": 1},
]
CONNECTIONS = [
	(SCHEDULE_DOCTYPE, "Selection"),
	(FEEDBACK_DOCTYPE, "Selection"),
	(DOCUMENTS_DOCTYPE, "Documents"),
	(REFERENCE_DOCTYPE, "Documents"),
	("Finance Fellowship Feedback Form", "Fellowship"),
	("Finance Fellowship Document Collection", "Fellowship"),
]
# Finance Fellowship applicants see only Details + the two Fellowship tabs:
# these Enablers-only tabs / sections are hidden for them. The few shared
# fields inside them (UG / PG degree, year, university; medical fitness) and
# the interview feedback / documents / system sections are moved into the
# Fellowship tabs by the form script (public/js/enablers_registration_form.js).
ENABLERS_ONLY_LAYOUT = (
	"section_break_eljh", "application_history_section", "section_break_cdlq",  # Address, Application History, Work with us
	"education", "experience_tab", "employment_details_tab", "languages_known_tab", "declaration_tab",
	"selection_process_tab",
)
NOT_FELLOWSHIP = 'eval:doc.department!="Finance Fellowship"'
# Fellowship applicants answer "Other" for these years (Enablers' own web
# form keeps its own list).
YEAR_FIELDS_WITH_OTHER = ("ug_year", "pg_year")


# ---------------------------------------------------------------- schema (after_migrate)
def ensure_enablers_schema():
	"""Idempotent: adds the workflow fields, statuses, connections and the
	Enablers Recruiter permission to the custom Enablers Registration Form —
	plus the Finance Fellowship fields / statuses / sub-unit, since
	Fellowship applicants live in this form too. Does nothing on a site
	without that DocType."""
	if not frappe.db.exists("DocType", ERF):
		return
	if not frappe.db.exists("Role", RECRUITER_ROLE):
		frappe.get_doc({"doctype": "Role", "role_name": RECRUITER_ROLE, "desk_access": 1}).insert(ignore_permissions=True)
	_ensure_fellowship_masters()

	dt = frappe.get_doc("DocType", ERF)
	changed = False

	status = dt.get("fields", {"fieldname": "application_status"})[0]
	current = [o for o in (status.options or "").split("\n") if o.strip()]
	wanted = STATUS_OPTIONS + [s for s in FELLOWSHIP_STATUSES if s not in STATUS_OPTIONS]
	options = wanted + [o for o in current if o not in wanted]
	if current != options:
		status.options = "\n".join(options)
		changed = True
	if not status.default:
		status.default = "New Applicant"
		changed = True
	# The list shows it as a coloured pill (enablers_registration_form_list.js).
	if not status.in_list_view:
		status.in_list_view = 1
		changed = True

	for fieldname in YEAR_FIELDS_WITH_OTHER:
		df = dt.get("fields", {"fieldname": fieldname})
		if df and "Other" not in (df[0].options or "").split("\n"):
			df[0].options = (df[0].options or "").rstrip("\n") + "\nOther"
			changed = True

	existing = {f.fieldname for f in dt.fields}
	for field in WORKFLOW_FIELDS + FELLOWSHIP_FIELDS:
		if field["fieldname"] not in existing:
			dt.append("fields", field)
			changed = True

	for fieldname in ENABLERS_ONLY_LAYOUT:
		df = dt.get("fields", {"fieldname": fieldname})
		if df and not df[0].depends_on:
			df[0].depends_on = NOT_FELLOWSHIP
			changed = True

	# Connections to forms that no longer exist (the old Finance Fellowship
	# Interview Schedule was merged into Enablers Interview Schedule).
	for link in list(dt.links):
		if not frappe.db.exists("DocType", link.link_doctype):
			dt.remove(link)
			changed = True

	linked = {(l.link_doctype, l.link_fieldname) for l in dt.links}
	for link_doctype, group in CONNECTIONS:
		if (link_doctype, "application_id") not in linked and frappe.db.exists("DocType", link_doctype):
			dt.append("links", {"link_doctype": link_doctype, "link_fieldname": "application_id", "group": group})
			changed = True

	if not any(p.role == RECRUITER_ROLE for p in dt.permissions):
		dt.append(
			"permissions",
			{"role": RECRUITER_ROLE, "read": 1, "write": 1, "create": 1, "report": 1, "export": 1, "print": 1,
			 "email": 1, "share": 1},
		)
		changed = True

	if changed:
		dt.flags.ignore_permissions = True
		dt.save()
		frappe.db.commit()


def _ensure_fellowship_masters():
	"""Sub-unit "Finance Fellowship" (unit Enablers) + its role."""
	if not frappe.db.exists("Recruitment Units", FELLOWSHIP_UNIT):
		frappe.get_doc({"doctype": "Recruitment Units", "__newname": FELLOWSHIP_UNIT}).insert(ignore_permissions=True)
	if not frappe.db.exists("Recruitment Department", FELLOWSHIP_SUB_UNIT):
		frappe.get_doc(
			{"doctype": "Recruitment Department", "__newname": FELLOWSHIP_SUB_UNIT, "unit": FELLOWSHIP_UNIT}
		).insert(ignore_permissions=True)
	if not frappe.db.exists("Recruitment Designation", FELLOWSHIP_ROLE):
		frappe.get_doc(
			{"doctype": "Recruitment Designation", "__newname": FELLOWSHIP_ROLE, "designation_name": FELLOWSHIP_ROLE}
		).insert(ignore_permissions=True)


# ---------------------------------------------------------------- registration form hooks
def validate_registration(doc, method=None):
	# Finance Fellowship applicants follow the Finance flow (ms_finance).
	if is_fellowship(doc):
		fellowship_validate(doc)
		return
	if not doc.get("application_status"):
		doc.application_status = "New Applicant"
	if doc.is_new():
		doc.access_key = frappe.generate_hash(length=24)
		return
	if not doc.has_value_changed("application_status"):
		return
	check_status_permission(doc)
	if doc.application_status in REGRET_STATUSES:
		doc.regret_marked_on = now_datetime()
		doc.regret_email_sent_on = None


def check_status_permission(doc):
	old = (doc.get_doc_before_save() or {}).get("application_status")
	assert_can_change_status(old, doc.get("department"))


def assert_can_change_status(old_status, sub_unit):
	"""Workflow for Enablers: Round 1 — only the Round 1 approvers; Rounds 2
	and 3 — only the recruiter of the applicant's sub-unit. An empty
	setting means no restriction (so nothing is locked before it's set up)."""
	user = frappe.session.user
	if user == "Administrator" or "System Manager" in frappe.get_roles(user):
		return
	settings = get_settings()
	if old_status in ROUND_1_STAGE:
		allowed = round_1_approvers(settings)
		who = _("the Round 1 approvers")
	elif old_status in RECRUITER_STAGE:
		recruiter, _email = sub_unit_recruiter(settings, sub_unit)
		allowed = {recruiter} if recruiter else set()
		who = _("the recruiter for {0}").format(sub_unit or _("this sub-unit"))
	else:
		return
	if allowed and user not in allowed:
		frappe.throw(
			_("At <b>{0}</b>, only {1} can change the status ({2}).").format(old_status, who, ", ".join(sorted(allowed))),
			frappe.PermissionError,
			title=_("Not allowed"),
		)


def after_registration_insert(doc, method=None):
	if not doc.get("email_address"):
		return
	if is_fellowship(doc):
		fellowship_after_insert(doc)
		return
	send_email(doc, "application_received")
	doc.db_set("acknowledgement_sent_on", now_datetime(), update_modified=False)


def on_registration_update(doc, method=None):
	if is_fellowship(doc):
		fellowship_on_update(doc)
		return
	if doc.flags.in_insert or not doc.has_value_changed("application_status"):
		return
	status = doc.application_status
	if status in REGRET_STATUSES and cint(get_settings().regret_delay_days) == 0:
		send_regret(doc)
	elif status == "Document Collection":
		request_documents(doc)


# ---------------------------------------------------------------- emails
def public_url(route, **params):
	query = urlencode({k: v for k, v in params.items() if v not in (None, "")})
	return get_url(route + (f"?{query}" if query else ""))


def access_key(doc):
	"""Applicants who applied before the workflow existed have no key yet."""
	if not doc.get("access_key"):
		doc.db_set("access_key", frappe.generate_hash(length=24), update_modified=False)
	return doc.access_key


def email_context(doc, **extra):
	ctx = {
		"applicant_name": doc.get("full_name") or "",
		"application_id": doc.name,
		"requirement_name": doc.get("role") or "the role",
		"track_url": public_url(STATUS_ROUTE, app_id=doc.name),
	}
	ctx.update(extra)
	return ctx


def send_email(doc, template, attachments=None, **extra):
	settings = get_settings()
	subject, message = render_template(settings, template, email_context(doc, **extra))
	frappe.sendmail(
		recipients=[doc.email_address],
		subject=subject,
		message=message,
		reference_doctype=ERF,
		reference_name=doc.name,
		attachments=attachments,
		**sender_kwargs(settings),
	)


def send_regret(doc):
	if not doc.get("email_address"):
		return
	send_email(doc, "regret")
	doc.db_set("regret_email_sent_on", now_datetime(), update_modified=False)


def request_documents(doc, remarks=None):
	if not doc.get("email_address"):
		return
	send_email(
		doc,
		"document_request",
		upload_link=public_url(UPLOAD_ROUTE, app_id=doc.name, key=access_key(doc)),
		remarks=remarks,
	)
	doc.db_set("documents_requested_on", now_datetime(), update_modified=False)


def notify_recruiters(doc_or_name, subject, message, reference_doctype, reference_name):
	"""The sub-unit's recruiter + the recruitment team email (Settings)."""
	registration = frappe.get_doc(ERF, doc_or_name) if isinstance(doc_or_name, str) else doc_or_name
	settings = get_settings()
	_recruiter, recruiter_email = sub_unit_recruiter(settings, registration.get("department"))
	recipients = [e for e in {recruiter_email, settings.recruiter_email} if e]
	if recipients:
		frappe.sendmail(
			recipients=recipients,
			subject=subject,
			message=message,
			reference_doctype=reference_doctype,
			reference_name=reference_name,
			**sender_kwargs(settings),
		)


@frappe.whitelist()
def resend_documents_email(application_id):
	doc = frappe.get_doc(ERF, application_id)
	doc.check_permission("write")
	request_documents(doc)
	return _("Email queued to {0}.").format(doc.email_address)


def send_due_regret_emails():
	"""Hourly — only matters when Settings has a regret delay (default 0
	sends straight away); also catches anything that wasn't sent."""
	if not frappe.db.exists("DocType", ERF):
		return
	settings = get_settings()
	cutoff = add_days(now_datetime(), -cint(settings.regret_delay_days))
	for name in frappe.get_all(
		ERF,
		filters={
			"application_status": ["in", REGRET_STATUSES],
			"regret_marked_on": ["<=", cutoff],
			"regret_email_sent_on": ["is", "not set"],
		},
		pluck="name",
	):
		try:
			send_regret(frappe.get_doc(ERF, name))
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			frappe.log_error(title="ENABLERS_REGRET_EMAIL", message=frappe.get_traceback())


# ---------------------------------------------------------------- interview invites
def _modes(schedule):
	return enablers_panel.modes(schedule)


def _mode_label(schedule):
	return enablers_panel.mode_label(schedule)


def _invite_context(schedule, registration, teams=("", "", ""), documents=()):
	start, end = _slot(schedule)
	online, in_person = _modes(schedule)
	return email_context(
		registration,
		interviewer_name=schedule.interviewer_names or "Interviewer",
		interview_round=schedule.interview_round,
		interview_date=start.strftime("%A, %d %b %Y"),
		interview_time=f"{start.strftime('%I:%M %p')} – {end.strftime('%I:%M %p')}",
		mode=_mode_label(schedule),
		meeting_link=teams[0] if online else "",
		meeting_id=teams[1] if online else "",
		passcode=teams[2] if online else "",
		meeting_room=schedule.meeting_room or "",
		venue=(schedule.venue or "") if in_person else "",
		map_link=(schedule.google_map_link or "") if in_person else "",
		message=schedule.message_to_the_interviewer or "",
		feedback_link=schedule.feedback_link,
		earlier_feedback=schedule.interview_round in ("Round 2", "Round 3"),
		**enablers_panel.invite_extras(schedule, list(documents)),
	)


def _attendees(schedule):
	attendees = _panel_attendees(schedule)
	if schedule.room_email:
		attendees.append({"emailAddress": {"address": schedule.room_email}, "type": "resource"})
	return attendees


def _payload(schedule, body, subject):
	online, in_person = _modes(schedule)
	return _event_payload(
		schedule, body, subject=subject, online=online, in_person=in_person or bool(schedule.meeting_room)
	)


def _application_pdf_url(registration):
	"""The registration form PDF for the panel: the site's own application PDF
	if the web form made one, else a clean one built from the record."""
	if registration.get("application_pdf"):
		return registration.application_pdf
	return enablers_panel.registration_pdf_url(registration)


def _invite_attachments(schedule, registration):
	from ms_calendar.ms_calendar.doctype.enablers_feedback_form.enablers_feedback_form import (
		build_round_feedback_pdf,
	)

	"""[(label, file url)]: resume, registration form and every earlier
	round's feedback (Round 2 gets Round 1's, Round 3 both)."""
	files = [("Resume", registration.get("resume")), ("Registration form", _application_pdf_url(registration))]
	earlier = {"Round 2": ["Round 1"], "Round 3": ["Round 1", "Round 2"]}.get(schedule.interview_round, [])
	for rnd in earlier:
		files.append((
			f"{rnd} feedback",
			registration.get(ROUND_PDF_FIELD[rnd]) or build_round_feedback_pdf(registration.name, rnd),
		))
	return [(label, url) for label, url in files if url]


def _email_candidate(schedule, registration, ctx, subject_prefix="", method="PUBLISH", sequence=0):
	ctx = enablers_panel.candidate_context(schedule, ctx)
	settings = get_settings()
	subject, message = render_template(settings, "candidate_invite", ctx)
	frappe.sendmail(
		recipients=[registration.email_address],
		subject=subject_prefix + subject,
		message=message,
		reference_doctype=SCHEDULE_DOCTYPE,
		reference_name=schedule.name,
		attachments=[{
			"fname": "Interview.ics",
			"fcontent": _ics(
				schedule, registration, settings, ctx, method=method, sequence=sequence,
				summary=f"Interview - {ctx['requirement_name']}", title=ctx["requirement_name"],
			),
		}],
		**sender_kwargs(settings),
	)


def _status_moves(current, interview_round):
	"""Scheduling never moves a rejected applicant, or one already past the round."""
	target = ROUND_STATUS[interview_round]
	return current not in REGRET_STATUSES and STATUS_RANK.get(current, -1) < STATUS_RANK[target]


def _move_applicant_status(application_id, interview_round):
	# Fresh copy (the invite's PDF went through get_print, which sets
	# flags.in_print and makes save() a no-op on that object).
	registration = frappe.get_doc(ERF, application_id)
	if not _status_moves(registration.application_status, interview_round):
		return
	registration.application_status = ROUND_STATUS[interview_round]
	registration.save()


def _load(name):
	schedule = frappe.get_doc(SCHEDULE_DOCTYPE, name)
	schedule.check_permission("write")
	return schedule, frappe.get_doc(ERF, schedule.application_id)


def _fellowship_schedule(name):
	"""Finance Fellowship interviews share this form but follow the Finance
	flow (templates, statuses, feedback form) — ms_finance handles them."""
	application_id = frappe.db.get_value(SCHEDULE_DOCTYPE, name, "application_id")
	return frappe.db.get_value(ERF, application_id, "department") == FELLOWSHIP_SUB_UNIT


@frappe.whitelist()
def schedule_interview(name):
	"""Outlook invite to the interviewers (+ meeting room), applicant email
	with a calendar file, applicant moved to "Round 1/2/3 Scheduled"."""
	if _fellowship_schedule(name):
		from ms_calendar.api import ms_finance

		return ms_finance.schedule_interview(name)
	schedule, registration = _load(name)
	if schedule.event_id and schedule.status == "Scheduled":
		frappe.throw(_("This interview is already scheduled. Use Reschedule to change it."))
	if not registration.get("email_address"):
		frappe.throw(_("The applicant has no email address."))
	# Scheduling moves the status — check that before anything is sent.
	if _status_moves(registration.application_status, schedule.interview_round):
		assert_can_change_status(registration.application_status, registration.get("department"))

	settings = get_settings()
	headers = _graph_headers()
	organizer = schedule.organizer_email.strip()
	online, _in_person = _modes(schedule)

	res = requests.post(
		f"{GRAPH}/users/{organizer}/events",
		headers=headers,
		json=_payload(schedule, "<p>Interview scheduled.</p>", f"Interview - {registration.full_name}"),
		timeout=30,
	)
	if res.status_code not in (200, 201):
		frappe.log_error(title="ENABLERS_INTERVIEW_CREATE", message=res.text[:2000])
		frappe.throw(_("Outlook did not accept the invite ({0}). Please try again.").format(res.status_code))
	event = res.json()
	event_id = event["id"]
	teams = _health_teams_info(organizer, event_id, headers, event_json=event) if online else ("", "", "")

	# Files go on BEFORE the panel is added: Outlook sends the invite when the
	# attendees are set, and files added after that never reach them.
	files = _invite_attachments(schedule, registration)
	_attach_files_to_event(headers, organizer, event_id, None, [url for _label, url in files], new_event=True)

	ctx = _invite_context(schedule, registration, teams, documents=[label for label, _url in files])
	subject, body = render_template(settings, "panel_invite", ctx)
	patch = requests.patch(
		f"{GRAPH}/users/{organizer}/events/{event_id}",
		headers=headers,
		json={"subject": subject, "attendees": _attendees(schedule), "body": {"contentType": "HTML", "content": body}},
		timeout=30,
	)
	if patch.status_code not in (200, 201):
		frappe.log_error(title="ENABLERS_INTERVIEW_PATCH", message=patch.text[:2000])

	schedule.db_set({
		"event_id": event_id, "status": "Scheduled", "scheduled_on": now_datetime(),
		"teams_join_url": teams[0], "teams_meeting_id": teams[1], "teams_passcode": teams[2], "cancel_reason": None,
	})
	_email_candidate(schedule, registration, ctx)
	_move_applicant_status(registration.name, schedule.interview_round)
	return {"event_id": event_id, "join_url": teams[0]}


@frappe.whitelist()
def reschedule_interview(name):
	if _fellowship_schedule(name):
		from ms_calendar.api import ms_finance

		return ms_finance.reschedule_interview(name)
	schedule, registration = _load(name)
	if not schedule.event_id or schedule.status != "Scheduled":
		frappe.throw(_("Only a scheduled interview can be rescheduled."))
	settings = get_settings()
	headers = _graph_headers()
	organizer = schedule.organizer_email.strip()
	teams = (schedule.teams_join_url or "", schedule.teams_meeting_id or "", schedule.teams_passcode or "")
	# Anything new (e.g. earlier-round feedback that came in since) goes on
	# before the update is sent; files already on the event are skipped.
	files = _invite_attachments(schedule, registration)
	_attach_files_to_event(headers, organizer, schedule.event_id, None, [url for _label, url in files])
	ctx = _invite_context(schedule, registration, teams, documents=[label for label, _url in files])
	subject, body = render_template(settings, "panel_invite", ctx)
	payload = _payload(schedule, body, subject)
	payload["attendees"] = _attendees(schedule)
	payload.pop("isOnlineMeeting", None)
	payload.pop("onlineMeetingProvider", None)
	res = requests.patch(f"{GRAPH}/users/{organizer}/events/{schedule.event_id}", headers=headers, json=payload, timeout=30)
	if res.status_code not in (200, 201):
		frappe.log_error(title="ENABLERS_INTERVIEW_RESCHEDULE", message=res.text[:2000])
		frappe.throw(_("Outlook did not accept the change ({0}).").format(res.status_code))
	schedule.db_set("scheduled_on", now_datetime())
	_email_candidate(schedule, registration, ctx, subject_prefix="Rescheduled: ", sequence=1)
	return {"event_id": schedule.event_id}


@frappe.whitelist()
def cancel_interview(name, reason):
	if _fellowship_schedule(name):
		from ms_calendar.api import ms_finance

		return ms_finance.cancel_interview(name, reason)
	schedule, registration = _load(name)
	if not (reason or "").strip():
		frappe.throw(_("Please give a reason for cancelling."))
	if schedule.event_id:
		_cancel_graph_event(_graph_headers(), schedule.organizer_email.strip(), schedule.event_id, reason)
	schedule.db_set({"status": "Cancelled", "cancel_reason": reason, "event_id": None})
	ctx = _invite_context(schedule, registration)
	settings = get_settings()
	frappe.sendmail(
		recipients=[registration.email_address],
		subject=f"Cancelled: Interview - {ctx['requirement_name']} ({ctx['interview_date']})",
		message=(
			f"<p>Hi {frappe.utils.escape_html(ctx['applicant_name'])},</p>"
			f"<p>The interview scheduled on <b>{ctx['interview_date']}, {ctx['interview_time']}</b> has been "
			"cancelled. We will get in touch with you with the next steps.</p>"
			"<p>Regards,<br>People Function<br>Azim Premji Foundation</p>"
		),
		reference_doctype=SCHEDULE_DOCTYPE,
		reference_name=schedule.name,
		attachments=[{
			"fname": "Interview.ics",
			"fcontent": _ics(schedule, registration, settings, ctx, method="CANCEL", sequence=2,
							 summary=f"Interview - {ctx['requirement_name']}", title=ctx["requirement_name"]),
		}],
		**sender_kwargs(settings),
	)
	return "Cancelled"


# ---------------------------------------------------------------- applicant pages (guest)
STATUS_STAGES = (
	("Application received", ("New Applicant", "Pre Shortlist", "On Hold", "Blocklist")),
	("Round 1 interview", ("CV Shortlist", "Recruiter Round", "Round 1 Scheduled", "Round One")),
	("Round 2 interview", ("Round 1 Select", "Round 2 Scheduled", "Round Two")),
	("Round 3 interview", ("Round 2 Select", "Round 3 Scheduled", "Round Three", "Round Four")),
	("Documents", ("Round 3 Select", "Document Collection", "Documents Received", "Reference Check")),
	("Offer", ("Offer",)),
)
STAGE_MESSAGES = {
	"CV Shortlist": "You are shortlisted for an interview. We will email you the details.",
	"Recruiter Round": "You are shortlisted for an interview. We will email you the details.",
	"Round 1 Scheduled": "Your Round 1 interview is scheduled. Please check your email for the details.",
	"Round One": "Your Round 1 interview is scheduled. Please check your email for the details.",
	"Round 1 Select": "You have cleared Round 1. We will email you the Round 2 details.",
	"Round 2 Scheduled": "Your Round 2 interview is scheduled. Please check your email for the details.",
	"Round Two": "Your Round 2 interview is scheduled. Please check your email for the details.",
	"Round 2 Select": "You have cleared Round 2. We will email you the Round 3 details.",
	"Round 3 Scheduled": "Your Round 3 interview is scheduled. Please check your email for the details.",
	"Round Three": "Your Round 3 interview is scheduled. Please check your email for the details.",
	"Round Four": "Your next interview is scheduled. Please check your email for the details.",
	"Round 3 Select": "You have cleared the interviews. We will email you the next steps.",
	"Document Collection": "Please upload your documents using the link we emailed you.",
	"Documents Received": "We have received your documents and are verifying them.",
	"Reference Check": "We are completing your reference checks.",
	"Offer": "Your offer is being shared with you. Please check your email.",
}
UNDER_REVIEW = "We have received your application and are reviewing it."


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=20, seconds=60 * 10)
def get_application_status(application_id, email):
	application_id = (application_id or "").strip().upper()
	email = (email or "").strip().lower()
	row = frappe.db.get_value(
		ERF,
		{"name": application_id, "email_address": email},
		["name", "full_name", "role", "application_status", "creation", "regret_email_sent_on", "department"],
		as_dict=True,
	)
	# Fellowship applicants track on the Finance Fellowship status page.
	if not row or row.department == FELLOWSHIP_SUB_UNIT:
		return {"found": False}
	base = {
		"found": True,
		"name": row.name,
		"full_name": row.full_name,
		"role": row.role or "",
		"applied_on": formatdate(row.creation, "dd MMM yyyy"),
		"stages": [s for s, _x in STATUS_STAGES],
	}
	status = row.application_status or "New Applicant"
	if status in REGRET_STATUSES:
		if row.regret_email_sent_on:
			return dict(base, closed=True, current=-1,
						message="Thank you for your interest. We will not be moving forward with your application at this time.")
		status = "New Applicant"
	current = next((i for i, (_s, statuses) in enumerate(STATUS_STAGES) if status in statuses), 0)
	return dict(base, closed=False, current=current, message=STAGE_MESSAGES.get(status, UNDER_REVIEW))


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=30, seconds=60 * 10)
def get_upload_context(application_id, key):
	row = frappe.db.get_value(ERF, application_id, ["full_name", "role", "access_key"], as_dict=True)
	if not row or not key or row.access_key != key:
		frappe.throw(_("This link is not valid. Please use the link in the email we sent you."), frappe.PermissionError)
	return {"applicant_name": row.full_name, "role": row.role}


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=30, seconds=60 * 10)
def get_feedback_context(schedule):
	row = frappe.db.get_value(
		SCHEDULE_DOCTYPE,
		schedule,
		["application_id", "applicant_name", "role", "interview_round", "interview_date", "status", "sub_unit"],
		as_dict=True,
	)
	# Fellowship interviews use the Finance Fellowship feedback form.
	if not row or row.status == "Cancelled" or row.sub_unit == FELLOWSHIP_SUB_UNIT:
		frappe.throw(_("This feedback link is not valid."))
	return {
		"application_id": row.application_id,
		"applicant_name": row.applicant_name,
		"role": row.role,
		"interview_round": row.interview_round,
		"interview_date": str(row.interview_date) if row.interview_date else "",
	}


def feedback_link(schedule):
	return public_url(FEEDBACK_ROUTE, schedule=schedule.name)


def form_link(doctype, name):
	return get_url_to_form(doctype, name)
