"""Talent Pool — the same for every unit: Field, Philanthropy, Health,
Scholarship and Enablers (incl. Finance Fellowship, which lives in the
Enablers Registration Form).

* A recruiter can move an application to the Talent Pool at ANY stage
  (form button, or list Actions ▾ for many at once). Its Application
  Status becomes "Talent Pool" and the candidate gets the Talent Pool
  email (Email Template "Talent Pool - Candidate", sent as "Pathways").
* "Resume from Talent Pool" puts it back to the status it had before (or
  any status the recruiter picks) so processing continues from there.
* Every stay is one "Talent Pool Log" row: moved on / by, status before,
  resumed on / by, status resumed to, days in pool.
* The Cycle Time report leaves the days between Moved On and Resumed On out
  of every stage-to-stage gap (pool_periods), so after a resume the clock
  restarts from the resumed date.

The log is written by on_status_change (on_update hook of each unit's form
in hooks.py), not by the buttons, so it stays right even when someone just
picks "Talent Pool" (or another status) in the Application Status dropdown.
"""

from email.utils import formataddr

import frappe
from frappe import _
from frappe.utils import cint, date_diff, getdate, now_datetime, strip_html, today

TALENT_POOL = "Talent Pool"
LOG = "Talent Pool Log"
EMAIL_TEMPLATE = "Talent Pool - Candidate"
SENDER_NAME = "Pathways"
STATUS_FIELD = "application_status"
# The resume dialog's "go back to where it was" choice.
BEFORE = "__before__"
# More than this many ticked applications run as a background job (each
# save runs the unit's own hooks, so a long list could time out the request).
SYNC_LIMIT = 50

# Each unit's registration form: unit label and the fields that hold the
# candidate's name / email / job (first non-empty one wins).
UNITS = {
	"Field Registration Form": {
		"unit": "Field", "name": ["full_name_aadhaar"], "email": ["email_address"], "job": ["job_title", "role"],
	},
	"Phil Registration Form": {
		"unit": "Philanthropy", "name": ["name1", "full_name"], "email": ["email"], "job": ["position", "role"],
	},
	"Health Registration Form": {
		"unit": "Health", "name": ["full_name"], "email": ["email_address"],
		"job": ["role", "designation__role", "role_designtion"],
	},
	"Scholarship Recruitment Form": {
		"unit": "Scholarship", "name": ["full_name_as_per_aadhar"], "email": ["email"], "job": ["role_apply", "role"],
	},
	"Enablers Registration Form": {
		"unit": "Enablers", "name": ["full_name"], "email": ["email_address"], "job": ["role", "process_role"],
	},
}

EMAIL_SUBJECT = "Update on Your Application – Future Opportunities – {{ job_title }}"
EMAIL_BODY = """<p>Dear {{ candidate_name }},</p>

<p>Thank you for your interest in the position of {{ job_title }} at Azim Premji Foundation.</p>

<p>We would like to inform you that, at this stage, we do not have any openings matching your profile. However, we find your profile relevant and would like to retain it in our Talent Pool for consideration for suitable future opportunities. If a relevant opportunity becomes available, we may contact you regarding the next steps in the recruitment process.</p>

<p>Please note that being part of our Talent Pool does not guarantee selection for any future position. Any future opportunity will be subject to the role requirements and the recruitment process applicable at that time.</p>

<p>We appreciate your interest and look forward to staying connected.</p>

<p>Warm regards,<br>
Recruitment Team<br>
Azim Premji Foundation</p>
"""


# ------------------------------------------------------------------ setup
def ensure_talent_pool_schema():
	"""after_migrate, idempotent: adds "Talent Pool" to each unit form's
	Application Status options and creates the email template. The unit
	forms are Custom (DB-only) DocTypes, so this is how the status reaches
	every site. Sites without a unit's DocType are skipped."""
	for doctype in UNITS:
		if not frappe.db.exists("DocType", doctype):
			continue
		row = frappe.db.get_value(
			"DocField", {"parent": doctype, "fieldname": STATUS_FIELD}, ["name", "options"], as_dict=True
		)
		if not row:
			continue
		options = [o.strip() for o in (row.options or "").split("\n")]
		if TALENT_POOL in options:
			continue
		# Only the Select's option list changes (no column change), so a
		# direct update is enough — a full DocType save would re-validate
		# these very large custom forms for nothing.
		frappe.db.set_value("DocField", row.name, "options", (row.options or "").rstrip("\n") + "\n" + TALENT_POOL)
		frappe.db.set_value("DocType", doctype, "modified", now_datetime())
		frappe.clear_cache(doctype=doctype)

	if not frappe.db.exists("Email Template", EMAIL_TEMPLATE):
		frappe.get_doc({
			"doctype": "Email Template",
			"name": EMAIL_TEMPLATE,
			"subject": EMAIL_SUBJECT,
			"use_html": 1,
			"response_html": EMAIL_BODY,
		}).insert(ignore_permissions=True)
	frappe.db.commit()


# ------------------------------------------------------- helpers per doc
def _check_doctype(doctype):
	if doctype not in UNITS:
		frappe.throw(_("Talent Pool is not set up for {0}.").format(doctype))


def _first(doc, fields):
	for f in fields:
		if doc.get(f):
			return doc.get(f)
	return ""


def _job_title(doc):
	for f in UNITS[doc.doctype]["job"]:
		value = doc.get(f)
		if not value:
			continue
		df = doc.meta.get_field(f)
		# Field's job_title links to a Job Opening (name like HR-OPN-…).
		if df and df.fieldtype == "Link" and df.options == "Job Opening":
			value = frappe.db.get_value("Job Opening", value, "job_title") or value
		return value
	return ""


def _unit(doc):
	if doc.doctype == "Enablers Registration Form" and doc.get("department") == "Finance Fellowship":
		return "Finance Fellowship"
	return UNITS[doc.doctype]["unit"]


def _open_log_name(doctype, name):
	return frappe.db.get_value(
		LOG, {"reference_doctype": doctype, "reference_name": name, "status": "In Talent Pool"}, "name",
		order_by="creation desc",
	)


def _status_options(doctype):
	df = frappe.get_meta(doctype).get_field(STATUS_FIELD)
	return [o.strip() for o in ((df and df.options) or "").split("\n") if o.strip()]


# ------------------------------------------------------- on_update hook
def on_status_change(doc, method=None):
	"""on_update of every unit form: open a log row when the status moves
	into Talent Pool, close it when it moves out."""
	if doc.doctype not in UNITS or not doc.meta.get_field(STATUS_FIELD):
		return
	before = doc.get_doc_before_save()
	old = before.get(STATUS_FIELD) if before else None
	new = doc.get(STATUS_FIELD)
	if old == new:
		return
	if new == TALENT_POOL:
		_open_log(doc, old)
	elif old == TALENT_POOL:
		_close_log(doc, new)


def _open_log(doc, old_status):
	if _open_log_name(doc.doctype, doc.name):
		return
	cfg = UNITS[doc.doctype]
	log = frappe.get_doc({
		"doctype": LOG,
		"status": "In Talent Pool",
		"unit": _unit(doc),
		"reference_doctype": doc.doctype,
		"reference_name": doc.name,
		"candidate_name": _first(doc, cfg["name"]),
		"email": _first(doc, cfg["email"]),
		"job_title": _job_title(doc),
		"moved_on": now_datetime(),
		"moved_by": frappe.session.user,
		"status_before": old_status or "",
		"remarks": doc.flags.talent_pool_remarks or "",
	})
	log.insert(ignore_permissions=True)

	note = ""
	# A brand-new record created straight into the pool (import) gets no email.
	if doc.flags.talent_pool_no_email or doc.flags.in_insert:
		note = _("Email not sent (switched off when moving).")
	else:
		note = _send_talent_pool_email(doc, log)
		if not note:
			log.db_set("email_sent_on", now_datetime(), update_modified=False)
	if note:
		log.db_set("email_note", note, update_modified=False)

	text = _("Moved to Talent Pool (status before: {0}).").format(old_status or _("blank"))
	if log.remarks:
		text += " " + _("Remarks: {0}").format(log.remarks)
	doc.add_comment("Info", text)


def _close_log(doc, new_status):
	name = _open_log_name(doc.doctype, doc.name)
	if not name:
		return
	log = frappe.get_doc(LOG, name)
	now = now_datetime()
	log.status = "Resumed"
	log.resumed_on = now
	log.resumed_by = frappe.session.user
	log.resumed_to_status = new_status or ""
	log.days_in_pool = max(date_diff(now, log.moved_on), 0)
	log.resume_remarks = doc.flags.talent_pool_remarks or ""
	log.save(ignore_permissions=True)

	text = _("Resumed from Talent Pool to {0} after {1} day(s).").format(new_status or _("blank"), log.days_in_pool)
	if log.resume_remarks:
		text += " " + _("Remarks: {0}").format(log.resume_remarks)
	doc.add_comment("Info", text)


def _send_talent_pool_email(doc, log):
	"""Queues the candidate email. Returns "" when queued, else why not
	(stored on the log; the status change itself still goes through)."""
	if not log.email:
		return _("Email not sent: no email address on the application.")
	try:
		tpl = frappe.get_doc("Email Template", EMAIL_TEMPLATE)
		ctx = {
			"doc": doc,
			"candidate_name": log.candidate_name or _("Candidate"),
			"job_title": log.job_title or _("the position you applied for"),
			"application_id": doc.name,
			"unit": log.unit,
		}
		subject = frappe.render_template(tpl.subject, ctx)
		message = frappe.render_template(tpl.response_html if tpl.use_html else tpl.response, ctx)
		frappe.sendmail(
			recipients=[log.email],
			sender=_sender(),
			subject=subject,
			message=message,
			reference_doctype=doc.doctype,
			reference_name=doc.name,
		)
		return ""
	except Exception:
		frappe.log_error(title=f"Talent Pool email failed: {doc.doctype} {doc.name}")
		return _("Email not sent: error while queuing it (see Error Log).")


def _sender():
	"""From: "Pathways <default outgoing mailbox>"."""
	email = frappe.db.get_value(
		"Email Account", {"default_outgoing": 1, "enable_outgoing": 1}, "email_id"
	)
	return formataddr((SENDER_NAME, email)) if email else None


# ------------------------------------------------------------- actions
def _names(names):
	if isinstance(names, str):
		names = frappe.parse_json(names) if names.strip().startswith("[") else [names]
	return [n for n in dict.fromkeys(names or []) if n]


@frappe.whitelist()
def move_to_talent_pool(doctype, names, remarks=None, send_email=1):
	"""Moves the given applications to the Talent Pool."""
	_check_doctype(doctype)
	names = _names(names)
	frappe.has_permission(doctype, "write", throw=True)
	kwargs = {"remarks": remarks, "send_email": cint(send_email)}
	return _run_or_enqueue("move", doctype, names, kwargs)


@frappe.whitelist()
def resume_from_talent_pool(doctype, names, resume_status=None, remarks=None):
	"""Takes the given applications out of the Talent Pool. resume_status
	empty / "__before__" = each one's status before it was moved."""
	_check_doctype(doctype)
	names = _names(names)
	frappe.has_permission(doctype, "write", throw=True)
	if resume_status and resume_status != BEFORE:
		if resume_status == TALENT_POOL or resume_status not in _status_options(doctype):
			frappe.throw(_("{0} is not an Application Status of {1}.").format(resume_status, doctype))
	kwargs = {"resume_status": resume_status if resume_status != BEFORE else None, "remarks": remarks}
	return _run_or_enqueue("resume", doctype, names, kwargs)


def _run_or_enqueue(action, doctype, names, kwargs):
	if not names:
		frappe.throw(_("No applications selected."))
	if len(names) <= SYNC_LIMIT:
		return _run(action, doctype, names, kwargs)
	frappe.enqueue(
		"ms_calendar.api.talent_pool._run_job",
		queue="long",
		timeout=3600,
		action=action,
		doctype=doctype,
		names=names,
		kwargs=kwargs,
		user=frappe.session.user,
	)
	return {"queued": True, "count": len(names)}


def _run_job(action, doctype, names, kwargs, user):
	result = _run(action, doctype, names, kwargs)
	frappe.publish_realtime(
		"msgprint",
		{"title": _("Talent Pool"), "message": _summary_html(action, result), "indicator": "green"},
		user=user,
	)


def _run(action, doctype, names, kwargs):
	done, skipped, failed = [], [], []
	for name in names:
		try:
			doc = frappe.get_doc(doctype, name)
			doc.check_permission("write")
			current = doc.get(STATUS_FIELD)
			if action == "move":
				if current == TALENT_POOL:
					skipped.append({"name": name, "reason": _("already in Talent Pool")})
					continue
				doc.flags.talent_pool_no_email = not kwargs.get("send_email")
				target = TALENT_POOL
			else:
				if current != TALENT_POOL:
					skipped.append({"name": name, "reason": _("not in Talent Pool ({0})").format(current or _("blank"))})
					continue
				target = kwargs.get("resume_status")
				if not target:
					log = _open_log_name(doctype, name)
					target = frappe.db.get_value(LOG, log, "status_before") if log else None
				if not target or target == TALENT_POOL or target not in _status_options(doctype):
					skipped.append({"name": name, "reason": _("status before Talent Pool not known — pick a status")})
					continue
			doc.flags.talent_pool_remarks = kwargs.get("remarks")
			# Old records may miss fields that became mandatory later, or
			# link to a Unit / Role / Location that was renamed since; only
			# the status changes here, so neither should block it.
			doc.flags.ignore_mandatory = True
			doc.flags.ignore_links = True
			doc.set(STATUS_FIELD, target)
			doc.save()
			frappe.db.commit()
			done.append({"name": name, "status": target})
		except Exception as e:
			frappe.db.rollback()
			frappe.clear_messages()
			failed.append({"name": name, "error": strip_html(str(e))[:300] or e.__class__.__name__})
	return {"done": done, "skipped": skipped, "failed": failed}


def _summary_html(action, result):
	verb = _("moved to Talent Pool") if action == "move" else _("resumed from Talent Pool")
	parts = [f"<p><b>{len(result['done'])}</b> {verb}.</p>"]
	for key, label in (("skipped", _("Skipped")), ("failed", _("Failed"))):
		rows = result.get(key) or []
		if rows:
			items = "".join(
				f"<li>{frappe.utils.escape_html(r['name'])}: {frappe.utils.escape_html(r.get('reason') or r.get('error') or '')}</li>"
				for r in rows[:100]
			)
			parts.append(f"<p>{label} ({len(rows)}):</p><ul>{items}</ul>")
	return "".join(parts)


# --------------------------------------------------------- form + report
@frappe.whitelist()
def get_talent_pool_info(doctype, name):
	"""Form banner: the open stay (if any) and all past stays."""
	_check_doctype(doctype)
	frappe.has_permission(doctype, "read", doc=name, throw=True)
	logs = frappe.get_all(
		LOG,
		filters={"reference_doctype": doctype, "reference_name": name},
		fields=["name", "status", "moved_on", "moved_by", "status_before", "remarks", "email_sent_on",
			"email_note", "resumed_on", "resumed_by", "resumed_to_status", "days_in_pool"],
		order_by="moved_on desc",
		ignore_permissions=True,
	)
	open_log = next((l for l in logs if l.status == "In Talent Pool"), None)
	if open_log:
		open_log.days_so_far = max(date_diff(today(), open_log.moved_on), 0)
		open_log.moved_by_name = frappe.utils.get_fullname(open_log.moved_by)
	return {
		"open": open_log,
		"history": [l for l in logs if l.status == "Resumed"],
		"total_days": sum(cint(l.days_in_pool) for l in logs if l.status == "Resumed"),
		"statuses": [s for s in _status_options(doctype) if s != TALENT_POOL],
	}


def pool_periods(doctype, names=None):
	"""{application name: [[moved 'YYYY-MM-DD', resumed or today], …]} —
	the Talent Pool stays the Cycle Time report leaves out."""
	filters = {"reference_doctype": doctype}
	if names is not None:
		if not names:
			return {}
		filters["reference_name"] = ["in", list(names)]
	out = {}
	end_today = str(getdate(today()))
	for l in frappe.get_all(
		LOG, filters=filters, fields=["reference_name", "moved_on", "resumed_on"], ignore_permissions=True
	):
		if not l.moved_on:
			continue
		out.setdefault(l.reference_name, []).append(
			[str(l.moved_on)[:10], str(l.resumed_on)[:10] if l.resumed_on else end_today]
		)
	return out
