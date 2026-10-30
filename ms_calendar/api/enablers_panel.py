"""The panel side of the Enablers Interview Schedule, shared by both flows on
that form (Enablers → ms_enablers, Finance Fellowship → ms_finance):

- who is on the panel — the Interviewers, plus the ones joining on MS Teams
  for a Hybrid interview (in person + online);
- ONE feedback link for the whole panel (?panel=…, the feedback form asks
  "Who is filling this feedback?" — public/js/feedback_form_draft.js, which
  also gives the form Save draft);
- the registration form PDF attached to the panel invite;
- "feedback pending" reminders until each panel member has submitted (5
  minutes after the interview, then daily for a week) and the "feedback
  submitted" email to the panel.

ms_enablers / ms_finance import this module, so it imports them only inside
functions.
"""

import base64
import json
from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import (
	add_days,
	escape_html,
	get_datetime,
	getdate,
	now_datetime,
	nowdate,
	strip_html,
)
from frappe.utils.file_manager import save_file
from frappe.utils.formatters import format_value
from frappe.utils.pdf import get_pdf

ERF = "Enablers Registration Form"
SCHEDULE_DOCTYPE = "Enablers Interview Schedule"
FELLOWSHIP_SUB_UNIT = "Finance Fellowship"

ONLINE = "Online (MS Teams)"
IN_PERSON = "In-person"
HYBRID = "Hybrid"
# Earlier name of Hybrid (one Teams link for everyone, panel in person).
LEGACY_HYBRID = "In-person + MS Teams"

FIRST_REMINDER_AFTER = timedelta(minutes=5)
REMINDER_DAYS = 7


# ---------------------------------------------------------------- mode + panel
def modes(schedule):
	"""(online, in_person) for the interview's mode."""
	mode = schedule.get("interview_mode") or ""
	if mode in (HYBRID, LEGACY_HYBRID):
		return True, True
	return mode == ONLINE, mode == IN_PERSON


def is_hybrid(schedule):
	return (schedule.get("interview_mode") or "") in (HYBRID, LEGACY_HYBRID)


def mode_label(schedule):
	if is_hybrid(schedule):
		return "Hybrid (in person + MS Teams)"
	return {ONLINE: "MS Teams", IN_PERSON: "In-person"}.get(schedule.get("interview_mode"), schedule.get("interview_mode") or "")


def _emails(rows):
	return [(r.interviewer_email or "").strip() for r in rows or [] if (r.interviewer_email or "").strip()]


def _unique(emails, candidate=""):
	out, seen = [], {(candidate or "").strip().lower()}
	for e in emails:
		if e.lower() not in seen:
			seen.add(e.lower())
			out.append(e)
	return out


def in_person_panel(schedule):
	return _unique(_emails(schedule.get("interviewer_email")), schedule.get("applicant_email"))


def online_panel(schedule):
	"""Hybrid only: the interviewers joining on MS Teams."""
	if (schedule.get("interview_mode") or "") != HYBRID:
		return []
	return _unique(_emails(schedule.get("online_panel")), schedule.get("applicant_email"))


def panel_members(schedule, cc=False):
	"""Everyone who gives feedback (never the applicant); cc=True adds the CC list."""
	emails = in_person_panel(schedule) + online_panel(schedule)
	if cc:
		emails += _emails(schedule.get("interviewers_cc_email"))
	return _unique(emails, schedule.get("applicant_email"))


def member_names(emails):
	"""{email (lower-case): name} from the Interviewer Email List."""
	if not emails:
		return {}
	rows = frappe.get_all(
		"Interviewer Email List",
		filters={"name": ["in", list(emails)]},
		fields=["name", "interviewer_name"],
	)
	return {r.name.lower(): r.interviewer_name or "" for r in rows}


def names_text(emails):
	names = member_names(emails)
	return ", ".join(names.get(e.lower()) or e for e in emails)


def panel_feedback_link(base_link, schedule):
	"""The invite's ONE feedback link: the panel's [[email, name], …] ride
	along (base64url JSON) so the form lets each member pick their name —
	only fills the clicker's own form, and the emails are in the invite
	anyway."""
	panel = panel_members(schedule, cc=True)
	if not panel:
		return base_link
	names = member_names(panel)
	token = base64.urlsafe_b64encode(
		json.dumps([[e, names.get(e.lower(), "")] for e in panel], separators=(",", ":")).encode()
	).decode().rstrip("=")
	return f"{base_link}{'&' if '?' in base_link else '?'}panel={token}"


def personal_feedback_link(base_link, email, name):
	from urllib.parse import urlencode

	return f"{base_link}{'&' if '?' in base_link else '?'}" + urlencode(
		{"panelist_email": email, "panelist_name": name or ""}
	)


# ---------------------------------------------------------------- the two flows
def is_fellowship_schedule(schedule):
	sub_unit = schedule.get("sub_unit") or frappe.db.get_value(ERF, schedule.get("application_id"), "department")
	return sub_unit == FELLOWSHIP_SUB_UNIT


def flow(schedule):
	"""What differs between the flows: feedback form + its panelist fields,
	feedback link, settings (sender), role label, round PDF builder."""
	if is_fellowship_schedule(schedule):
		from ms_calendar.ms_calendar.doctype.finance_fellowship_feedback_form.finance_fellowship_feedback_form import (
			build_round_feedback_pdf,
		)
		from ms_calendar.ms_calendar.doctype.finance_fellowship_settings.finance_fellowship_settings import (
			feedback_link,
			get_settings,
		)

		return frappe._dict(
			feedback_doctype="Finance Fellowship Feedback Form",
			email_field="panelist_email",
			name_field="panelist_name",
			base_link=feedback_link(schedule),
			settings=get_settings(),
			role=FELLOWSHIP_SUB_UNIT,
			word="discussion",
			build_pdf=build_round_feedback_pdf,
		)
	from ms_calendar.api.ms_enablers import feedback_link
	from ms_calendar.ms_calendar.doctype.enablers_feedback_form.enablers_feedback_form import build_round_feedback_pdf
	from ms_calendar.ms_calendar.doctype.enablers_settings.enablers_settings import get_settings

	return frappe._dict(
		feedback_doctype="Enablers Feedback Form",
		email_field="interviewer_email",
		name_field="interviewer_name",
		base_link=feedback_link(schedule),
		settings=get_settings(),
		role=schedule.get("role") or "",
		word="interview",
		build_pdf=build_round_feedback_pdf,
	)


def _sender(settings):
	from ms_calendar.ms_calendar.doctype.finance_fellowship_settings.finance_fellowship_settings import sender_kwargs

	return sender_kwargs(settings)


# ---------------------------------------------------------------- registration form PDF
# Fellowship applicants: the shared fields that sit in Enablers-only tabs go
# next to their Fellowship counterpart (same as the Desk form, see
# public/js/enablers_registration_form.js ERF_FELLOWSHIP_FIELD_MOVES).
FELLOWSHIP_FIELD_MOVES = (
	("ug_degree", "ug_degree_other", "before"),
	("ug_year", "ug_year_other", "before"),
	("ug_university", "ug_institution", "after"),
	("pg_degree", "pg_degree_other", "before"),
	("pg_year", "pg_year_other", "before"),
	("pg_university", "pg_institution", "after"),
	("medical_fitness", "authorisation", "before"),
)
PDF_SKIP_FIELDS = {"application_status", "department", "role", "unit", "full_name", "email_address", "phone_number"}
PDF_SKIP_TYPES = {
	"Attach", "Attach Image", "Button", "HTML", "Heading", "Column Break", "Fold", "Image", "Signature", "Password",
}


def _pdf_fields(registration):
	"""Ordered DocFields (Section/Tab Breaks included) the applicant filled in
	for their own flow — no workflow / system fields."""
	meta = frappe.get_meta(ERF)
	fields = list(meta.fields)
	idx = {df.fieldname: i for i, df in enumerate(fields)}

	def span(start, stop):
		a = idx.get(start, 0) if start else 0
		b = idx.get(stop, len(fields)) if stop else len(fields)
		return fields[a:b]

	first_break = next((i for i, df in enumerate(fields) if i and df.fieldtype in ("Section Break", "Tab Break")), len(fields))
	if registration.get("department") == FELLOWSHIP_SUB_UNIT:
		out = fields[:first_break] + span("fellowship_tab", "selection_tab")
		by_name = {df.fieldname: df for df in fields}
		for fieldname, anchor, where in FELLOWSHIP_FIELD_MOVES:
			names = [df.fieldname for df in out]
			if fieldname in by_name and anchor in names and fieldname not in names:
				pos = names.index(anchor) + (1 if where == "after" else 0)
				out.insert(pos, by_name[fieldname])
		return out
	return span(None, "selection_process_tab")


def _value_html(registration, df):
	value = registration.get(df.fieldname)
	if df.fieldtype in ("Table", "Table MultiSelect"):
		rows = value or []
		if not rows:
			return ""
		child = frappe.get_meta(df.options)
		cols = [c for c in child.fields if c.fieldtype not in PDF_SKIP_TYPES and c.fieldtype not in ("Section Break", "Tab Break")]
		cols = [c for c in cols if any(r.get(c.fieldname) not in (None, "", 0) for r in rows)]
		if not cols:
			return ""
		head = "".join(f"<th>{escape_html(strip_html(_(c.label or c.fieldname)))}</th>" for c in cols)
		body = "".join(
			"<tr>" + "".join(f"<td>{escape_html(format_value(r.get(c.fieldname), c) or '')}</td>" for c in cols) + "</tr>"
			for r in rows
		)
		return f"<table class='sub'><tr>{head}</tr>{body}</table>"
	if value in (None, "") or (df.fieldtype in ("Check", "Int", "Float", "Currency", "Percent") and not value):
		return ""
	if df.fieldtype == "Check":
		return "Yes"
	text = format_value(value, df, registration)
	return escape_html(strip_html(str(text))).replace("\n", "<br>")


def registration_pdf_html(registration):
	sections, current = [], None
	for df in _pdf_fields(registration):
		if df.fieldtype in ("Section Break", "Tab Break"):
			label = strip_html(_(df.label or "")).strip()
			if df.fieldtype == "Tab Break" or label or current is None:
				current = {"label": label, "rows": []}
				sections.append(current)
			continue
		if df.fieldname in PDF_SKIP_FIELDS or df.fieldtype in PDF_SKIP_TYPES or df.hidden:
			continue
		html = _value_html(registration, df)
		if html:
			if current is None:
				current = {"label": "", "rows": []}
				sections.append(current)
			current["rows"].append((strip_html(_(df.label or df.fieldname)).strip(), html))

	applied = registration.get("application_date") or registration.creation
	head = (
		f"<h1>{escape_html(registration.full_name or '')}</h1>"
		f"<p class='meta'>{escape_html(registration.name)} · {escape_html(registration.get('role') or '')}"
		f" · {escape_html(registration.get('department') or '')}"
		f"{' · Applied ' + escape_html(format_value(getdate(applied), {'fieldtype': 'Date'})) if applied else ''}<br>"
		f"{escape_html(registration.get('email_address') or '')} · {escape_html(registration.get('phone_number') or '')}</p>"
	)
	body = "".join(
		(f"<h2>{escape_html(s['label'])}</h2>" if s["label"] else "")
		+ "<table class='kv'>"
		+ "".join(f"<tr><th>{escape_html(l)}</th><td>{v}</td></tr>" for l, v in s["rows"])
		+ "</table>"
		for s in sections
		if s["rows"]
	)
	return f"""<html><head><meta charset="utf-8"><style>
body {{ font-family: sans-serif; font-size: 11.5px; color: #1A2B3C; }}
h1 {{ font-size: 19px; margin: 0 0 2px; }}
.meta {{ color: #4A5868; margin: 0 0 14px; line-height: 1.6; }}
.title {{ font-size: 11px; font-weight: bold; letter-spacing: .08em; text-transform: uppercase; color: #2C5F8A; margin-bottom: 6px; }}
h2 {{ font-size: 13px; color: #1F3A5F; border-bottom: 2px solid #DDE3EA; padding-bottom: 3px; margin: 18px 0 6px; }}
table {{ border-collapse: collapse; width: 100%; }}
table.kv th {{ text-align: left; width: 38%; font-weight: 600; color: #4A5868; padding: 4px 8px 4px 0; vertical-align: top; }}
table.kv td {{ padding: 4px 0; vertical-align: top; }}
table.kv tr {{ border-bottom: 1px solid #EEF2F6; page-break-inside: avoid; }}
table.sub th, table.sub td {{ border: 1px solid #DDE3EA; padding: 3px 6px; text-align: left; font-size: 11px; }}
table.sub th {{ background: #F3F6FA; }}
</style></head><body><div class="title">Registration form</div>{head}{body}</body></html>"""


def registration_pdf_url(registration):
	"""The applicant's registration form as a clean PDF (only what they filled
	in, for their own flow), attached to every panel invite. Rebuilt each
	time, so it shows the latest details."""
	# This PDF from earlier invites (and the old Standard-print one).
	for pattern in ("Registration_Form", "Application_Form"):
		for old in frappe.get_all(
			"File",
			filters={
				"attached_to_doctype": ERF,
				"attached_to_name": registration.name,
				"file_name": ["like", f"{registration.name}_{pattern}%.pdf"],
			},
			pluck="name",
		):
			frappe.delete_doc("File", old, ignore_permissions=True)
	pdf = get_pdf(registration_pdf_html(registration))
	return save_file(f"{registration.name}_Registration_Form.pdf", pdf, ERF, registration.name, is_private=1).file_url


# ---------------------------------------------------------------- feedback status
def submitted_emails(schedule, f=None):
	f = f or flow(schedule)
	rows = frappe.get_all(f.feedback_doctype, filters={"interview_schedule": schedule.name}, pluck=f.email_field)
	return {e.strip().lower() for row in rows for e in (row or "").split(",") if e.strip()}


def pending_panel(schedule, f=None):
	"""Panel members (not CC) who haven't submitted feedback yet."""
	done = submitted_emails(schedule, f)
	return [e for e in panel_members(schedule) if e.lower() not in done]


def _end(row):
	return get_datetime(f"{row.interview_date} {row.end_time}")


def _button(link, label):
	return (
		f'<p><a href="{escape_html(link)}" style="display:inline-block;background:#1f3a5f;color:#ffffff;'
		f'padding:10px 22px;text-decoration:none;border-radius:4px;font-weight:600;">{escape_html(label)}</a></p>'
	)


def remind_panel(name):
	"""One "feedback pending" email per panel member who hasn't submitted,
	with their own link (opens the form with their name filled in)."""
	schedule = frappe.get_doc(SCHEDULE_DOCTYPE, name)
	f = flow(schedule)
	pending = pending_panel(schedule, f)
	if not pending:
		return 0
	names = member_names(pending)
	start = get_datetime(f"{schedule.interview_date} {schedule.start_time}")
	for email in pending:
		name_ = names.get(email.lower()) or ""
		frappe.sendmail(
			recipients=[email],
			subject=f"Reminder: Interview Feedback Pending – {schedule.applicant_name} – {schedule.interview_round}",
			message=(
				f"<p>Dear {escape_html(name_ or 'Panel member')},</p>"
				f"<p>Your feedback for the {f.word} with <b>{escape_html(schedule.applicant_name or '')}</b> "
				f"({escape_html(schedule.application_id)}, {escape_html(f.role)}, {escape_html(schedule.interview_round)}) "
				f"on {start.strftime('%d %b %Y, %I:%M %p')} is still pending.</p>"
				"<p>Kindly share it using the link below. You can <b>Save</b> a draft and come back to it — "
				"it is shared with the team only when you click <b>Submit</b>.</p>"
				+ _button(personal_feedback_link(f.base_link, email, name_), "Open Feedback Form")
				+ "<p>Regards,<br>People Function<br>Azim Premji Foundation</p>"
			),
			reference_doctype=SCHEDULE_DOCTYPE,
			reference_name=schedule.name,
			**_sender(f.settings),
		)
	return len(pending)


def _reminder_candidates(**filters):
	return frappe.get_all(
		SCHEDULE_DOCTYPE,
		filters=dict({"status": ["in", ["Scheduled", "Completed"]], "event_id": ["is", "set"]}, **filters),
		fields=["name", "interview_date", "end_time", "first_reminder_sent", "last_reminder_on"],
	)


def _run(name, fn, updates):
	try:
		fn(name)
		frappe.db.set_value(SCHEDULE_DOCTYPE, name, updates, update_modified=False)
		frappe.db.commit()
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="ENABLERS_FEEDBACK_REMINDER", message=f"{name}\n{frappe.get_traceback()}")


def send_first_feedback_reminders():
	"""Every 5 minutes: first reminder 5 minutes after the interview ends.
	Interviews that ended more than a day ago are only marked (no flood of
	old reminders); the daily job takes over from day 1."""
	now = now_datetime()
	for row in _reminder_candidates(first_reminder_sent=0, interview_date=[">=", add_days(nowdate(), -2)]):
		end = _end(row)
		if now < end + FIRST_REMINDER_AFTER:
			continue
		if now - end > timedelta(days=1):
			frappe.db.set_value(SCHEDULE_DOCTYPE, row.name, "first_reminder_sent", 1, update_modified=False)
			frappe.db.commit()
			continue
		_run(row.name, remind_panel, {"first_reminder_sent": 1})


def send_daily_feedback_reminders():
	"""Daily: every panel member still pending, for interviews that ended 1–7
	days ago (stops as soon as they submit)."""
	today = getdate(nowdate())
	for row in _reminder_candidates(interview_date=["between", [add_days(today, -REMINDER_DAYS), add_days(today, -1)]]):
		if row.last_reminder_on and getdate(row.last_reminder_on) == today:
			continue
		_run(row.name, remind_panel, {"last_reminder_on": today, "first_reminder_sent": 1})


# ---------------------------------------------------------------- feedback submitted
def on_feedback_submitted(feedback_doctype, feedback_name):
	"""Background job after a panel member submits: rebuild that round's
	merged feedback PDF on the applicant (attached to the next rounds'
	invites) and tell the panel who has submitted / who is still pending."""
	fb = frappe.get_doc(feedback_doctype, feedback_name)
	if fb.get("interview_round"):
		flow_pdf = None
		if fb.get("interview_schedule") and frappe.db.exists(SCHEDULE_DOCTYPE, fb.interview_schedule):
			schedule = frappe.get_doc(SCHEDULE_DOCTYPE, fb.interview_schedule)
			f = flow(schedule)
			flow_pdf = f.build_pdf(fb.application_id, fb.interview_round)
			_email_panel_submitted(schedule, f, fb)
		return flow_pdf


def _email_panel_submitted(schedule, f, fb):
	panel = panel_members(schedule, cc=True)
	if not panel:
		return
	done = submitted_emails(schedule, f)
	main = panel_members(schedule)
	who = fb.get(f.name_field) or fb.get(f.email_field)
	pending = [e for e in main if e.lower() not in done]
	lines = [
		f"<p><b>{escape_html(who)}</b> has submitted the {escape_html(schedule.interview_round)} feedback for "
		f"<b>{escape_html(schedule.applicant_name or '')}</b> ({escape_html(schedule.application_id)}, {escape_html(f.role)}).</p>",
		f"<p><b>Submitted:</b> {escape_html(names_text([e for e in main if e.lower() in done]) or '—')}<br>"
		f"<b>Still pending:</b> {escape_html(names_text(pending) or 'None — all feedback is in')}</p>",
	]
	if pending:
		lines.append("<p>If yours is still pending, please share it here:</p>")
		lines.append(_button(panel_feedback_link(f.base_link, schedule), "Open Feedback Form"))
	frappe.sendmail(
		recipients=panel,
		subject=f"Feedback submitted – {schedule.applicant_name} – {schedule.interview_round}",
		message="".join(lines) + "<p>Regards,<br>People Function<br>Azim Premji Foundation</p>",
		reference_doctype=SCHEDULE_DOCTYPE,
		reference_name=schedule.name,
		**_sender(f.settings),
	)


def enqueue_feedback_submitted(doc):
	"""From the feedback forms' after_insert — keeps Submit fast."""
	frappe.enqueue(
		on_feedback_submitted,
		queue="short",
		enqueue_after_commit=True,
		feedback_doctype=doc.doctype,
		feedback_name=doc.name,
	)


# ---------------------------------------------------------------- invite templates
# Saved Settings templates (both flows) get the documents list / Hybrid
# panel lines the code now fills — once, only where the old text is unchanged.
TEMPLATE_UPGRADES = (
	(
		"Resume<br>\nApplication form<br>\n{% if earlier_feedback %}Feedback from earlier discussions<br>{% endif %}\n",
		"{% for d in documents %}{{ d }}<br>{% endfor %}\n",
	),
	(
		"<b>Mode:</b> {{ mode }}<br>\n",
		"<b>Mode:</b> {{ mode }}<br>\n{% if online_panel %}<b>In person:</b> {{ in_person_panel }}<br>\n"
		"<b>Online (MS Teams):</b> {{ online_panel }}<br>\n{% endif %}",
	),
)


def upgrade_text(text):
	for old, new in TEMPLATE_UPGRADES:
		if text and old in text and new not in text:
			text = text.replace(old, new)
	return text


def upgrade_invite_templates():
	"""after_migrate: idempotent."""
	for doctype in ("Enablers Settings", "Finance Fellowship Settings"):
		if not frappe.db.exists("DocType", doctype):
			continue
		value = frappe.db.get_single_value(doctype, "panel_invite_message")
		new = upgrade_text(value)
		if value and new != value:
			frappe.db.set_single_value(doctype, "panel_invite_message", new)
	frappe.db.commit()


def invite_extras(schedule, documents):
	"""Extra template values: the attached documents, Hybrid panel lists."""
	online = online_panel(schedule)
	return {
		"documents": documents,
		"in_person_panel": names_text(in_person_panel(schedule)) if online else "",
		"online_panel": names_text(online),
	}


def candidate_context(schedule, ctx):
	"""A Hybrid interview is in person for the applicant: no Teams link."""
	if not is_hybrid(schedule):
		return ctx
	return dict(ctx, mode="In-person", meeting_link="", meeting_id="", passcode="")


def check_feedback_panel(schedule, email):
	"""Guest feedback must come from someone on the panel (incl. CC)."""
	return (email or "").strip().lower() in {e.lower() for e in panel_members(schedule, cc=True)}

