import io

import frappe
from frappe.utils import today


# Same role/column mapping as the "School Teacher — District Funnel" report
# in ms_calendar/ms_calendar/page/reports/reports.js (STF_COLS there) — keep
# these two in sync if either changes. Duplicated rather than shared because
# one side is JS running in the browser and this side is Python running on
# the server; there's no natural single source of truth to point both at
# without a bigger refactor of that page.
#
# application_status on Field Registration Form carries two overlapping
# naming eras for the same stage at once (confirmed 2026-09-04) — every
# column below lists every real spelling variant, not just one.
STF_COLS = [
	("No. of Applications", "applications", None),
	("CV Shortlisted", "cv_shortlisted", ["CV Shortlist", "Shortlisted"]),
	("CV Screening Pending", "cv_pending", ["New Applicant", "Pending", "Correction Pending", "PI Edited"]),
	("CV Rejected", "cv_rejected", ["CV Reject", "Rejected", "Not Selected", "Duplicated", "Blacklisted", "Blocklisted"]),
	("On Hold", "on_hold", ["On Hold"]),
	("Admit Card Sent", "admit_card_sent", ["Test Process", "Admit Card Sent"]),
	("Assessment Pass", "assessment_pass", ["Test Select", "Assessment Passed"]),
	("Assessment Fail", "assessment_fail", ["Test Reject", "Assessment Failed"]),
	("Recruiter Round Scheduled", "rr_sched", ["Recruiter Round", "Recruiter Round-Interview Scheduled"]),
	("Recruiter Round Selected", "rr_sel", ["Recruiter Round Select", "Recruiter Round-Interview Selected"]),
	("Recruiter Round Rejected", "rr_rej", ["Recruiter Reject", "Recruiter Round-Interview Rejected"]),
	("Subject Round Interview Scheduled", "sr_sched",
		["Round One", "Subject Round-Interview Scheduled", "Functional Round-Interview Scheduled", "Functional Round-Interviewed"]),
	("Subject Round Interview Selected", "sr_sel", ["Round One Select", "Functional Round-Interview Selected"]),
	("Subject Round Interview Rejected", "sr_rej",
		["Round 1 Reject", "Subject Round-Interview Rejected", "Functional Round-Interview Rejected"]),
	("Demo Round Scheduled", "dr_sched",
		["Round Two", "Subject/Classroom Demo Round-Interview Scheduled", "Principal/Demo Round-Interview Scheduled"]),
	("Demo Round Selected", "dr_sel",
		["Round Two Select", "Subject/Classroom Demo Round-Interview Selected", "Principal/Demo Round-Interview Selected"]),
	("Demo Round Rejected", "dr_rej",
		["Round 2 Reject", "Subject/Classroom Demo Round-Interview Rejected", "Principal/Demo Round-Interview Rejected",
			"Demo Round-Interview Rejected", "Demo & Leader Round-Interview Rejected"]),
	("Leader Round 1 Interview Scheduled", "lr1_sched", ["Leader Round 1-Interview Scheduled", "Leader Round 1-Interviewed"]),
	("Leader Round 1 Interview Selected", "lr1_sel", ["Leader Round 1-Interview Selected", "Leader Round-Interview Selected"]),
	("Leader Round 1 Interview Rejected", "lr1_rej", ["Leader Round 1-Interview Rejected"]),
	("Leader Round 3 Interview Scheduled", "lr3_sched", ["Round Three", "Leader Round 3-Interview Scheduled", "Leader Round 3-Interviewed"]),
	("Leader Round 3 Interview Selected", "lr3_sel", ["Round Three Select", "Leader Round 3-Interview Selected"]),
	("Leader Round 3 Interview Rejected", "lr3_rej", ["Round 3 Reject", "Leader Round 3-Interview Rejected"]),
	("Pending with CBT (Offer Released)", "pending_cbt", ["Pending With CBT", "CBT Assigned", "Offer", "Offer Sent"]),
]


def _get_col(role):
	"""Same substring match as reports.js's getCol() — real role values are
	region-suffixed ("School Teacher - Barmer"), an exact match only ever
	caught the plain unsuffixed value."""
	r = (role or "").strip().lower()
	if "teacher" in r:
		return "ST"
	if "health" in r or "livelihood" in r:
		return None
	return "RP"


def _district_of(rec):
	""""School" is derived from the Role field's own text, not
	native_district/location (confirmed 2026-09-04) — see the matching
	districtOf() in reports.js for the full explanation; kept identical
	here so the Excel download and the on-screen table never disagree."""
	role = (rec.get("role") or "").strip()
	if not role:
		return "Unspecified"
	dash_idx = role.rfind(" - ")
	if dash_idx >= 0:
		return role[dash_idx + 3:].strip() or "Unspecified"
	return role


@frappe.whitelist()
def download_st_district_funnel(from_date=None, to_date=None):
	"""Server-rendered .xlsx of the "School Teacher — District Funnel"
	report, with the same header/row background colours as the on-screen
	table (reports.js) — the CSV export used elsewhere on this page has no
	concept of colour, so this needed a real spreadsheet library instead
	(openpyxl, already used for exports elsewhere in this session).
	"""
	filters = {}
	if from_date or to_date:
		filters["creation"] = [
			"between",
			[(from_date or "2000-01-01") + " 00:00:00", (to_date or today()) + " 23:59:59"],
		]

	rows = frappe.get_all(
		"Field Registration Form",
		filters=filters,
		fields=["name", "full_name_aadhaar", "application_status", "role", "department",
			"location", "native_state", "native_district", "creation"],
		limit_page_length=0,
	)
	st_rows = [r for r in rows if _get_col(r.role) == "ST"]

	districts = sorted({_district_of(r) for r in st_rows})

	from openpyxl import Workbook
	from openpyxl.styles import Alignment, Font, PatternFill
	from openpyxl.utils import get_column_letter

	wb = Workbook()
	ws = wb.active
	ws.title = "School Teacher Funnel"

	# Same palette as the on-screen table in reports.js's showSTDistrictFunnel.
	corner_fill = PatternFill(start_color="1F497D", end_color="1F497D", fill_type="solid")
	corner_font = Font(bold=True, color="FFFFFF")
	header_fill = PatternFill(start_color="F5A623", end_color="F5A623", fill_type="solid")
	header_font = Font(bold=True, color="3B2C00")
	school_fill = PatternFill(start_color="FFF3D6", end_color="FFF3D6", fill_type="solid")
	total_fill = PatternFill(start_color="D9D9D9", end_color="D9D9D9", fill_type="solid")
	total_font = Font(bold=True)
	thin_center = Alignment(horizontal="center", vertical="center", wrap_text=True)

	corner = ws.cell(row=1, column=1, value="School")
	corner.fill = corner_fill
	corner.font = corner_font
	corner.alignment = thin_center

	for ci, (label, _key, _statuses) in enumerate(STF_COLS, start=2):
		c = ws.cell(row=1, column=ci, value=label)
		c.fill = header_fill
		c.font = header_font
		c.alignment = thin_center

	grand = {key: 0 for (_label, key, _statuses) in STF_COLS}
	row_idx = 2
	for d in districts:
		recs = [r for r in st_rows if _district_of(r) == d]
		name_cell = ws.cell(row=row_idx, column=1, value=d)
		name_cell.fill = school_fill
		name_cell.font = Font(bold=True)

		for ci, (_label, key, statuses) in enumerate(STF_COLS, start=2):
			if statuses is None:
				cnt = len(recs)
			else:
				cnt = sum(1 for r in recs if (r.application_status or "").strip() in statuses)
			grand[key] += cnt
			ws.cell(row=row_idx, column=ci, value=cnt or None)
		row_idx += 1

	total_name = ws.cell(row=row_idx, column=1, value="Total")
	total_name.fill = total_fill
	total_name.font = total_font
	for ci, (_label, key, _statuses) in enumerate(STF_COLS, start=2):
		c = ws.cell(row=row_idx, column=ci, value=grand[key] or None)
		c.fill = total_fill
		c.font = total_font

	ws.freeze_panes = "B2"
	ws.column_dimensions["A"].width = 22
	for ci in range(2, len(STF_COLS) + 2):
		ws.column_dimensions[get_column_letter(ci)].width = 15
	ws.row_dimensions[1].height = 45

	buf = io.BytesIO()
	wb.save(buf)
	buf.seek(0)

	frappe.local.response.filename = "School_Teacher_District_Funnel.xlsx"
	frappe.local.response.filecontent = buf.getvalue()
	frappe.local.response.type = "binary"
