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


def _detail_fields():
	"""Every real, per-applicant field on Field Registration Form — layout
	fields (Section/Column/Tab Break, HTML, Button) and child tables
	excluded, since those aren't values that belong in one flat row.
	Built from the doctype's own meta rather than a hand-maintained list,
	so a field added/renamed there shows up in the Details sheet
	automatically without this file needing a matching edit — "whole data"
	is meant literally here (2026-09-07 request), not a curated subset.
	Returns [(fieldname, label), ...] in form order; a fieldname repeated
	more than once in the doctype (confirmed: "zayam_id" is on this one)
	is only included the first time.
	"""
	skip_types = {
		"Section Break", "Column Break", "Tab Break", "HTML", "Button", "Fold",
		"Table", "Table MultiSelect",
	}
	meta = frappe.get_meta("Field Registration Form")
	seen = set()
	out = []
	for f in meta.fields:
		if f.fieldtype in skip_types or f.fieldname in seen:
			continue
		seen.add(f.fieldname)
		out.append((f.fieldname, f.label or f.fieldname))
	return out


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
def download_st_district_funnel(from_date=None, to_date=None, native_state=None, school=None):
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

	# "name" and "creation" are the two fields the Details sheet needs that
	# aren't in _detail_fields() (they're the docname/ID and a standard
	# system field, not real meta fields on the doctype) — everything else
	# comes straight from the doctype's own field list, so the Details
	# sheet always has "whole data", not a hand-picked subset.
	detail_fields = _detail_fields()
	rows = frappe.get_all(
		"Field Registration Form",
		filters=filters,
		fields=["name", "creation"] + [fn for fn, _label in detail_fields],
		limit_page_length=0,
	)
	st_rows = [r for r in rows if _get_col(r.role) == "ST"]

	# Same State/School dropdown filters as the on-screen table
	# (reports.js's applySTFFilters) — passed through as querystring params
	# from the Download Excel button so the file matches whatever's
	# currently filtered on screen, instead of always exporting every
	# School Teacher record in the date range.
	if native_state:
		st_rows = [r for r in st_rows if (r.get("native_state") or "").strip() == native_state]
	if school:
		st_rows = [r for r in st_rows if _district_of(r) == school]

	districts = sorted({_district_of(r) for r in st_rows})

	from openpyxl import Workbook
	from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
	from openpyxl.utils import get_column_letter
	from openpyxl.worksheet.hyperlink import Hyperlink

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

	# "Details" sheet — the Excel equivalent of clicking a number cell on
	# the on-screen report (reports.js's stf-cell click handler, which
	# opens a dialog of the matching records). Excel cells can't pop up a
	# dialog on click, so instead every non-zero count cell on the summary
	# sheet becomes a hyperlink that jumps straight to that exact block of
	# matching records here, and the sheet has AutoFilter turned on so it
	# can be narrowed further by hand. Built in the same School x Stage
	# loop as the summary counts below, so a block's row range and its
	# cell's hyperlink target can never drift out of sync.
	hyperlink_font = Font(color="0563C1", underline="single")
	details_ws = wb.create_sheet("Details")
	# School/Stage (this report's own grouping, not on the doctype) +
	# Applicant ID (the docname) up front, then literally every field
	# _detail_fields() found on Field Registration Form, in form order —
	# "whole data" per applicant, not a hand-picked subset.
	details_headers = ["School", "Stage", "Applicant ID"] + [label for _fn, label in detail_fields] + ["Date"]
	last_col_letter = get_column_letter(len(details_headers))

	# Row 1: a plain-language instruction banner, not just column headers.
	# A hyperlink can jump here but can't apply a filter on its own (no
	# code runs on click in a static .xlsx, and OnlyOffice doesn't
	# reliably support the macro event that would need). The AutoFilter
	# buttons on the School/Stage columns below already do the "show only
	# this, hide everything else" job by hand in two clicks — this banner
	# spells that out right in the file instead of assuming it's obvious.
	details_ws.merge_cells(f"A1:{last_col_letter}1")
	banner = details_ws.cell(
		row=1, column=1,
		value=(
			"To see ONLY one group and hide everything else: click the ▼ on the "
			"School column below, tick just that School — then click the ▼ on "
			"Stage and tick just that Stage. Clear both filters (▼ → Clear Filter) "
			"to see everything again."
		),
	)
	banner.font = Font(bold=True, color="7D4F00")
	banner.fill = PatternFill(start_color="FFF3D6", end_color="FFF3D6", fill_type="solid")
	banner.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
	details_ws.row_dimensions[1].height = 30

	for ci, h in enumerate(details_headers, start=1):
		c = details_ws.cell(row=2, column=ci, value=h)
		c.fill = header_fill
		c.font = header_font
	details_ws.freeze_panes = "A3"
	details_ws.auto_filter.ref = f"A2:{last_col_letter}2"
	details_row = 3  # next free row on the Details sheet

	# A real click-driven filter isn't possible in a static .xlsx (that
	# needs a macro, and OnlyOffice doesn't reliably support the
	# FollowHyperlink event a macro would need). Every hyperlink already
	# jumps to a block that is ONLY that School+Stage's matching rows,
	# nothing else mixed in — this banding just makes that block boundary
	# obvious at a glance instead of requiring the reader to notice the
	# School/Stage columns changed.
	# Both tints, not white — a white block is indistinguishable from the
	# sheet's own blank background (confirmed 2026-09-07: it just looked
	# unshaded), which defeated the point of banding every other block.
	# Same pastel pair as STATE_COLORS in reports.js, so this reads as the
	# same visual language as the rest of the report.
	block_fills = [
		PatternFill(start_color="DDEBF7", end_color="DDEBF7", fill_type="solid"),
		PatternFill(start_color="FFF2CC", end_color="FFF2CC", fill_type="solid"),
	]
	block_top = Side(style="medium", color="404040")
	block_bottom = Side(style="medium", color="404040")
	block_side = Side(style="thin", color="BFBFBF")
	block_parity = 0  # alternates 0/1 so consecutive blocks never share a fill

	grand = {key: 0 for (_label, key, _statuses) in STF_COLS}
	row_idx = 2
	for d in districts:
		recs = [r for r in st_rows if _district_of(r) == d]
		name_cell = ws.cell(row=row_idx, column=1, value=d)
		name_cell.fill = school_fill
		name_cell.font = Font(bold=True)

		for ci, (label, key, statuses) in enumerate(STF_COLS, start=2):
			if statuses is None:
				matched = recs
			else:
				matched = [r for r in recs if (r.application_status or "").strip() in statuses]
			cnt = len(matched)
			grand[key] += cnt

			cell = ws.cell(row=row_idx, column=ci, value=cnt or None)
			if matched:
				block_start = details_row
				block_end = details_row + len(matched) - 1
				fill = block_fills[block_parity]
				block_parity = 1 - block_parity
				for i, r in enumerate(matched):
					is_first = (details_row == block_start)
					is_last = (details_row == block_end)
					border = Border(
						top=block_top if is_first else None,
						bottom=block_bottom if is_last else None,
						left=block_side, right=block_side,
					)
					row_values = (
						[d, label, r.name]
						+ [r.get(fn) for fn, _label in detail_fields]
						+ [str(r.creation).split(" ")[0] if r.creation else ""]
					)
					for col, val in enumerate(row_values, start=1):
						dc = details_ws.cell(row=details_row, column=col, value=val)
						dc.fill = fill
						dc.border = border
					details_row += 1
				# location= (not a "#..." string on cell.hyperlink directly)
				# is what makes openpyxl write a plain internal `location`
				# attribute with no relationship at all. Assigning a bare
				# "#'Details'!A1" string instead makes openpyxl create an
				# actual external hyperlink relationship whose Target
				# literally is that "#..." text with TargetMode="External"
				# — which is exactly what was making OnlyOffice (and Excel)
				# show a "this link may be unsafe" warning on every click,
				# despite the link only ever pointing inside this same file.
				cell.hyperlink = Hyperlink(ref=cell.coordinate, location=f"'Details'!A{block_start}")
				cell.font = hyperlink_font
		row_idx += 1

	total_name = ws.cell(row=row_idx, column=1, value="Total")
	total_name.fill = total_fill
	total_name.font = total_font
	for ci, (_label, key, _statuses) in enumerate(STF_COLS, start=2):
		c = ws.cell(row=row_idx, column=ci, value=grand[key] or None)
		c.fill = total_fill
		c.font = total_font

	# details_headers now runs to ~55 columns ("whole data" per applicant,
	# not a hand-picked subset — see _detail_fields()), so fixed per-letter
	# widths aren't practical to hand-maintain. Size each one off its own
	# header text length instead — short ones (Age, DOB) stay narrow, long
	# ones (the various "If Yes, please mention..." labels) get more room,
	# capped so one very long label can't blow out the whole sheet.
	for ci, h in enumerate(details_headers, start=1):
		details_ws.column_dimensions[get_column_letter(ci)].width = min(40, max(12, len(h) + 4))

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
