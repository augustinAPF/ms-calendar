"""Talent Pool page — /desk/talent-pool

One page for every unit's Talent Pool (Field, Philanthropy, Health,
Scholarship, Enablers / Finance Fellowship): cards, a table with
In Talent Pool / Resumed / All tabs, drilldowns and CSV, Resume.

Data = Talent Pool Log rows (written by ms_calendar.api.talent_pool),
scoped on the server to what the user may read: only units whose form the
user can read, and only the applications that form's own list would show
them (frappe.get_list applies User Permissions / permission rules). The
cards, table, drilldowns and CSV all come from this one scoped result.
"""

import frappe
from frappe.utils import cint, date_diff, getdate, today

from ms_calendar.api.talent_pool import LOG, UNITS

# "Waiting long" card: still in the pool after this many days.
LONG_WAIT_DAYS = 90
FIELDS = [
	"name", "status", "unit", "reference_doctype", "reference_name", "candidate_name", "email", "job_title",
	"moved_on", "moved_by", "status_before", "remarks", "email_sent_on", "email_note",
	"resumed_on", "resumed_by", "resumed_to_status", "days_in_pool", "resume_remarks",
]


def _allowed_doctypes():
	return [dt for dt in UNITS if frappe.db.exists("DocType", dt) and frappe.has_permission(dt, "read")]


def _unit_options(allowed):
	units = []
	for dt in allowed:
		units.append(UNITS[dt]["unit"])
		if dt == "Enablers Registration Form":
			units.append("Finance Fellowship")
	return units


@frappe.whitelist()
def get_data(filters=None):
	"""filters: {units: [..], from_date, to_date (Moved On), search}.
	Returns {units, rows, cards, long_wait_days}."""
	f = frappe.parse_json(filters) if filters else {}
	allowed = _allowed_doctypes()
	unit_options = _unit_options(allowed)
	out = {"units": unit_options, "rows": [], "long_wait_days": LONG_WAIT_DAYS}
	if not allowed:
		out["cards"] = _cards([])
		return out

	db_filters = {"reference_doctype": ["in", allowed]}
	units = [u for u in (f.get("units") or []) if u in unit_options]
	if units:
		db_filters["unit"] = ["in", units]
	from_date, to_date = f.get("from_date"), f.get("to_date")
	if from_date and to_date:
		db_filters["moved_on"] = ["between", [str(getdate(from_date)), str(getdate(to_date)) + " 23:59:59"]]
	elif from_date:
		db_filters["moved_on"] = [">=", str(getdate(from_date))]
	elif to_date:
		db_filters["moved_on"] = ["<=", str(getdate(to_date)) + " 23:59:59"]

	logs = frappe.get_all(
		LOG, filters=db_filters, fields=FIELDS, order_by="moved_on desc",
		limit_page_length=0, ignore_permissions=True,
	)

	search = (f.get("search") or "").strip().lower()
	if search:
		keys = ("reference_name", "candidate_name", "email", "job_title", "status_before", "remarks")
		logs = [l for l in logs if any(search in str(l.get(k) or "").lower() for k in keys)]

	# Row-level scope + the application's current status, per unit form.
	visible = {}
	by_dt = {}
	for l in logs:
		by_dt.setdefault(l.reference_doctype, set()).add(l.reference_name)
	for dt, names in by_dt.items():
		names = list(names)
		for i in range(0, len(names), 1000):
			for r in frappe.get_list(
				dt, filters={"name": ["in", names[i:i + 1000]]}, fields=["name", "application_status"],
				limit_page_length=0,
			):
				visible[(dt, r.name)] = r.application_status

	names_cache = {}

	def full_name(user):
		if not user:
			return ""
		if user not in names_cache:
			names_cache[user] = frappe.utils.get_fullname(user)
		return names_cache[user]

	now = today()
	rows = []
	for l in logs:
		key = (l.reference_doctype, l.reference_name)
		if key not in visible:
			continue
		in_pool = l.status == "In Talent Pool"
		days = max(date_diff(now, l.moved_on), 0) if in_pool else cint(l.days_in_pool)
		rows.append({
			"log": l.name,
			"status": l.status,
			"unit": l.unit,
			"doctype": l.reference_doctype,
			"app_id": l.reference_name,
			"candidate": l.candidate_name,
			"email": l.email,
			"job_title": l.job_title,
			"status_before": l.status_before,
			"moved_on": str(l.moved_on)[:19] if l.moved_on else "",
			"moved_by": full_name(l.moved_by),
			"remarks": l.remarks,
			"email_sent_on": str(l.email_sent_on)[:19] if l.email_sent_on else "",
			"email_note": l.email_note,
			"resumed_on": str(l.resumed_on)[:19] if l.resumed_on else "",
			"resumed_by": full_name(l.resumed_by),
			"resumed_to_status": l.resumed_to_status,
			"resume_remarks": l.resume_remarks,
			"days": days,
			"current_status": visible[key],
			"long_wait": in_pool and days > LONG_WAIT_DAYS,
			"no_email": in_pool and not l.email_sent_on,
		})
	out["rows"] = rows
	out["cards"] = _cards(rows)
	return out


def _cards(rows):
	in_pool = [r for r in rows if r["status"] == "In Talent Pool"]
	resumed = [r for r in rows if r["status"] == "Resumed"]
	avg = round(sum(r["days"] for r in resumed) / len(resumed), 1) if resumed else None
	return {
		"in_pool": len(in_pool),
		"long_wait": sum(1 for r in in_pool if r["long_wait"]),
		"no_email": sum(1 for r in in_pool if r["no_email"]),
		"resumed": len(resumed),
		"avg_days": avg,
	}
