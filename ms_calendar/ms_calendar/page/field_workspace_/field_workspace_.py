# Copyright (c) 2026, Azim Premji Foundation and contributors
# For license information, please see license.txt

import re

import frappe
from frappe.utils import cint

# ---------------------------------------------------------------------------
# FIELD REGISTRATION SEARCH — backs the "Whole Data" card on this page.
# ---------------------------------------------------------------------------
# A paste-many-keywords search box (matching any of ID/Applicant Name/Email/
# Phone/Role/Job Code, like the recruiter portal's "Keywords" box) plus a
# live-count checkbox sidebar (Application Status / Role / Department).
DOCTYPE = "Field Registration Form"

KEYWORD_FIELDS = [
    "name", "full_name_aadhaar", "email_address", "phone_number", "role", "job_code",
]

LIST_FIELDS = [
    "name", "full_name_aadhaar", "email_address", "phone_number", "role",
    "department", "application_status", "job_code", "creation",
]

FACET_FIELDS = {"application_status", "role", "department", "job_code", "location"}


def _split_keywords(keywords):
    """Split a pasted blob of IDs/names/emails on space, comma, or newline."""
    if not keywords:
        return []
    tokens = re.split(r"[,\s]+", keywords.strip())
    return [t for t in tokens if t]


def _keyword_or_filters(keywords):
    """Any pasted token matching any of the searchable fields — OR'd across
    every (field, token) pair, so pasting several IDs at once finds all of
    them in a single search."""
    tokens = _split_keywords(keywords)
    if not tokens:
        return []
    return [
        [field, "like", f"%{tok}%"]
        for field in KEYWORD_FIELDS
        for tok in tokens
    ]


@frappe.whitelist()
def search_field_registration_forms(keywords=None, filters=None, start=0, page_length=20):
    """Results for the Field Registration Search page: keyword OR-search
    ANDed with whatever facet filters (Application Status/Role/Department)
    are currently checked."""
    filters = frappe.parse_json(filters) if filters else []
    or_filters = _keyword_or_filters(keywords)

    rows = frappe.get_list(
        DOCTYPE,
        fields=LIST_FIELDS,
        filters=filters,
        or_filters=or_filters,
        order_by="creation desc",
        start=cint(start),
        page_length=cint(page_length),
    )

    total = frappe.get_list(
        DOCTYPE,
        fields=[{"COUNT": "*", "as": "total"}],
        filters=filters,
        or_filters=or_filters,
    )[0].total

    return {"rows": rows, "total": total}


@frappe.whitelist()
def export_field_registration_forms(keywords=None, filters=None, limit=0):
    """CSV export for the search view — same keyword/filter logic as the
    search itself, just no row cap by default (limit=0). Runs entirely
    against the local DB so it's fast even at 100K+ rows; built server-side
    so the browser only ever handles the final CSV text, not raw row data."""
    import csv
    import io

    filters = frappe.parse_json(filters) if filters else []
    or_filters = _keyword_or_filters(keywords)
    limit = cint(limit)

    rows = frappe.get_list(
        DOCTYPE,
        fields=LIST_FIELDS,
        filters=filters,
        or_filters=or_filters,
        order_by="creation desc",
        page_length=limit or 0,
    )

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=LIST_FIELDS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)

    return buf.getvalue()


@frappe.whitelist()
def get_field_registration_facet_counts(field, keywords=None, filters=None):
    """Live checkbox counts for one sidebar facet: grouped counts for
    `field`, honoring the keyword search and every OTHER active facet's
    filter, but ignoring `field`'s own filter (so checking more boxes in the
    same group doesn't zero out the group's other options)."""
    if field not in FACET_FIELDS:
        frappe.throw(f"{field} is not a supported facet field")

    filters = frappe.parse_json(filters) if filters else []
    filters = [f for f in filters if f[0] != field]
    or_filters = _keyword_or_filters(keywords)

    data = frappe.get_list(
        DOCTYPE,
        filters=filters,
        or_filters=or_filters,
        group_by=field,
        fields=[{"COUNT": "*", "as": "count"}, f"{field} as value"],
        order_by="count desc",
        limit_page_length=50,
    )
    return [d for d in data if d.get("value")]


# ---------------------------------------------------------------------------
# FIELD OVERVIEW DASHBOARD — mirrors the cloud site's "Field" workspace:
# job-code shortcuts grouped by department (or state). Every shortcut opens
# the Field Registration Search view, scoped to that one group/job code.
# ---------------------------------------------------------------------------
SHORTCUTS_PER_GROUP = 12


def _job_code_shortcuts_by(group_field, group_key):
    """Shared implementation: [{<group_key>, total, shortcuts: [{job_code,
    job_title, count}, ...]}, ...], grouped by `group_field` (department or
    location), ordered by group size. Job codes are labelled with the
    matching Job Opening's title where we have one."""
    rows = frappe.get_list(
        DOCTYPE,
        filters=[[group_field, "is", "set"], ["job_code", "is", "set"]],
        fields=[group_field, "job_code", {"COUNT": "*", "as": "count"}],
        group_by=f"{group_field}, job_code",
        order_by=f"{group_field}, count desc",
    )

    job_titles = {
        j.job_code: j.job_title
        for j in frappe.get_all("Job Opening", fields=["job_code", "job_title"])
        if j.job_code
    }

    grouped = {}
    order = []
    for r in rows:
        group_val = (r.get(group_field) or "").strip()
        job_code = (r.job_code or "").strip()
        if not group_val or not job_code:
            continue
        if group_val not in grouped:
            grouped[group_val] = []
            order.append(group_val)
        if len(grouped[group_val]) < SHORTCUTS_PER_GROUP:
            grouped[group_val].append({
                "job_code": job_code,
                "job_title": job_titles.get(job_code),
                "count": r.count,
            })

    totals = {
        d["value"]: d["count"] for d in get_field_registration_facet_counts(group_field)
    }
    order.sort(key=lambda g: totals.get(g, 0), reverse=True)

    return [
        {group_key: group_val, "total": totals.get(group_val, 0), "shortcuts": grouped[group_val]}
        for group_val in order
    ]


@frappe.whitelist()
def get_role_shortcuts_by_department():
    """Job-code shortcuts grouped by Department — backs the "Shortcuts by
    Department" dashboard section."""
    return _job_code_shortcuts_by("department", "department")


@frappe.whitelist()
def get_job_code_shortcuts_by_state():
    """Job-code shortcuts grouped by Location — backs the "Shortcuts by
    State" dashboard section. Location (not Native State — that's only set
    on ~1,150 of 126K records; Location is set on ~90,782 and holds mostly
    clean state-level values like "Karnataka", "Rajasthan, India")."""
    return _job_code_shortcuts_by("location", "state")
