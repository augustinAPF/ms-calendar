"""
Zayam Data Import — algorithm overview
=======================================

This module lets the "-zayam-data-import" desk page bulk-import Zayam
Excel exports and bulk-attach resume PDFs into ANY doctype, as long as
that doctype has a "Zayam Id" field, without needing a hand-written
mapping for every doctype. The steps:

1. Doctype eligibility (get_zayam_enabled_doctypes)
   The page's doctype picker is a Link field to "DocType" whose search
   is restricted to this whitelisted query. It looks up every doctype
   that has a field named `zayam_id` (standard DocField or Custom
   Field) and only offers those as choices.

2. Build the field mapping on the fly (_build_config)
   Instead of a static per-doctype dictionary, this reads the chosen
   doctype's live meta (frappe.get_meta) and, for every real field
   (skipping layout-only ones like Section/Column/Tab Break):
     - registers both the fieldname and the label (normalized, see
       _normalize_header) as recognised Excel header text
     - remembers Int-type fields, so their cell values get coerced
       to int instead of left as text
     - picks the first Data field with "name" in its fieldname as the
       human-readable "display field" shown in results
     - picks the first Attach field as the "resume field" used by the
       bulk PDF attach tool
   This mirrors how Frappe's own Data Import tool reads field
   definitions, so adding support for a new doctype only requires
   adding a `zayam_id` field to it — no code change needed here.

3. Import a row (enqueue_import / _run_import_job)
   Each Excel column header is normalized and looked up in the mapping
   from step 2 to find which fieldname it should be written into.
   Unrecognized headers are collected as `unmatched_columns` and
   returned to the page instead of silently being dropped. For each
   data row, the Zayam Id column value is used to find an existing
   record (update) or create a new one; each row runs inside its own
   DB savepoint so one bad row can't roll back earlier successful rows
   in the same uncommitted batch, and commits happen every 25 rows.
   The actual import runs as a background job (Zwayam exports can run
   to hundreds of thousands of rows — far more than a single web
   request is allowed to run for), with progress/results written to
   cache every _PROGRESS_EVERY rows for the page to poll via
   get_import_status, including after a reload.

4. Attach a resume PDF (attach_application_pdf)
   The uploaded filename's leading digits are read as the Zayam Id
   (e.g. "6213236-ClariceTPaul-Copy.pdf" -> "6213236"), used to find
   the matching record, and the file is attached to that doctype's
   resume field from step 2 — again inside its own savepoint so a
   failure on one file doesn't affect the others in the same batch.
"""

import csv
import datetime
import os
import re
import zipfile

import frappe
from dateutil import parser as dateutil_parser
from openpyxl import Workbook, load_workbook

# A doctype's actual match-key field isn't always literally named
# "zayam_id" — e.g. Applicant Master's field is "zwayam_id" (label
# "Zwayam ID"), by explicit design of that doctype's schema. Rather than
# require every doctype to rename its field to match this module's
# original naming, _resolve_match_field checks for either name and uses
# whichever one actually exists.
_MATCH_FIELD_CANDIDATES = ["zayam_id", "zwayam_id"]


def _resolve_match_field(doctype):
    meta = frappe.get_meta(doctype)
    for candidate in _MATCH_FIELD_CANDIDATES:
        if meta.get_field(candidate):
            return candidate
    return None


_SKIP_FIELDTYPES = {
    "Section Break",
    "Column Break",
    "Tab Break",
    "HTML",
    "Button",
    "Heading",
    "Table",
    "Table MultiSelect",
}

# Large Zwayam exports (100k+ rows) take far longer to import than a single
# web request can wait for, so the actual import runs as a background job
# (_run_import_job) instead of inline in the whitelisted method the page
# calls. Progress/results are written to cache under these keys so the page
# can poll for status — including after a reload, since the job keeps
# running whether or not anyone is watching.
_STATUS_CACHE_PREFIX = "zayam_import_status"
_STATUS_TTL = 60 * 60 * 24  # a finished job's result stays pollable for a day
_MAX_DETAIL_ENTRIES = (
    500  # cap on how many created/updated/skipped/failed rows are echoed back per job
)
_PROGRESS_EVERY = (
    100  # how often (in rows) the cached status is refreshed while running
)


def _status_cache_key(job_id):
    return f"{_STATUS_CACHE_PREFIX}:{job_id}"


def _get_status(job_id):
    return frappe.cache().get_value(_status_cache_key(job_id))


def _save_status(job_id, status):
    frappe.cache().set_value(
        _status_cache_key(job_id), status, expires_in_sec=_STATUS_TTL
    )


# Stopping a running import is a cooperative flag, not a hard kill of the
# background worker — _run_import_job holds its own in-memory `status`
# dict and only writes it to cache periodically, so it never sees anything
# written into that dict from outside. This is a SEPARATE, tiny cache key
# the running loop actively re-reads on the same cadence as its periodic
# commits, so "Stop" takes effect within ~25 rows rather than requiring a
# violent process kill (which would also risk leaving the DB mid-batch).
def _cancel_cache_key(job_id):
    return f"zayam_import_cancel:{job_id}"


def _request_cancel(job_id):
    frappe.cache().set_value(_cancel_cache_key(job_id), True, expires_in_sec=_STATUS_TTL)


def _is_cancel_requested(job_id):
    return bool(frappe.cache().get_value(_cancel_cache_key(job_id)))


def _clear_cancel_flag(job_id):
    frappe.cache().delete_value(_cancel_cache_key(job_id))


def _new_status(job_id, doctype, total_rows, columns, user):
    return {
        "job_id": job_id,
        "doctype": doctype,
        "user": user,
        "state": "running",
        "processed": 0,
        "total_rows": total_rows,
        "counts": {"created": 0, "updated": 0, "skipped": 0, "failed": 0},
        "details": {"created": [], "updated": [], "skipped": [], "failed": []},
        "truncated": {
            "created": False,
            "updated": False,
            "skipped": False,
            "failed": False,
        },
        "unmatched_columns": [],
        "new_master_entries": {},
        "columns": columns,
        "all_columns": [],
        "assignable_fields": [],
        "error": None,
    }


def _record_result(status, key, entry):
    status["counts"][key] += 1
    if len(status["details"][key]) < _MAX_DETAIL_ENTRIES:
        status["details"][key].append(entry)
    else:
        status["truncated"][key] = True


def _normalize_header(value):
    text = str(value or "").strip().lower()
    return re.sub(r"[^a-z0-9]+", "_", text).strip("_")


def _safe_identifier(text):
    """Sanitize into a valid, unquoted SQL identifier (savepoint names
    can't contain hyphens etc. — e.g. docnames like "APPRF-0106")."""
    return re.sub(r"[^0-9a-zA-Z_]", "_", str(text))


def _build_config(doctype):
    """
    Derives everything needed to import/attach for a doctype straight from
    its meta, the same way Frappe's own Data Import tool reads field
    definitions instead of relying on hand-maintained per-doctype mappings.
    """
    meta = frappe.get_meta(doctype)

    match_field = _resolve_match_field(doctype)
    if not match_field:
        candidates = "' or '".join(_MATCH_FIELD_CANDIDATES)
        frappe.throw(
            f"'{doctype}' does not have a '{candidates}' field yet. "
            f"Add one of these as a custom field to this doctype before importing."
        )

    header_aliases = {}
    int_fields = set()
    date_fields = set()
    datetime_fields = set()
    link_fields = {}
    assignable_fields = []
    display_field = None
    resume_field = None

    for df in meta.fields:
        if df.fieldtype in _SKIP_FIELDTYPES:
            continue

        for key in {_normalize_header(df.fieldname), _normalize_header(df.label)}:
            if key:
                header_aliases[key] = df.fieldname

        if df.fieldtype == "Int":
            int_fields.add(df.fieldname)

        if df.fieldtype == "Date":
            date_fields.add(df.fieldname)

        if df.fieldtype == "Datetime":
            datetime_fields.add(df.fieldname)

        if df.fieldtype == "Link" and df.options and df.options != "DocType":
            link_fields[df.fieldname] = df.options

        if (
            display_field is None
            and df.fieldtype == "Data"
            and "name" in df.fieldname.lower()
        ):
            display_field = df.fieldname

        if resume_field is None and df.fieldtype == "Attach":
            resume_field = df.fieldname

        assignable_fields.append(
            {"fieldname": df.fieldname, "label": df.label or df.fieldname}
        )

    # "Zwayam Id" is a real misspelling that shows up in some exports —
    # recognise it as the same column as the actual match field, whichever
    # of the two candidate fieldnames this doctype actually uses.
    header_aliases["zwayam_id"] = match_field
    header_aliases["zwayamid"] = match_field

    # Zwayam's own "All Unit form" export doesn't call the column "Zayam
    # Id" at all — it labels it "Application/Register Number".
    header_aliases["application_register_number"] = match_field
    header_aliases["register_number"] = match_field

    return {
        "match_field": match_field,
        "display_field": display_field or match_field,
        "resume_field": resume_field,
        "int_fields": int_fields,
        "date_fields": date_fields,
        "datetime_fields": datetime_fields,
        "header_aliases": header_aliases,
        "link_fields": link_fields,
        "assignable_fields": assignable_fields,
    }


def _ensure_link_value_exists(target_doctype, value, known_values=None):
    """
    If `value` isn't an existing record of target_doctype, create one on
    the fly (e.g. a new Theme/Geo/Location/Role appearing in a Zayam
    export shouldn't fail the whole row — it should just extend the
    master list). Returns True if a new record was created.

    `known_values`, when given, is a mutable set of every name already
    confirmed to exist for target_doctype — pre-populated in bulk ONCE per
    import job (see _run_import_job) rather than queried per row. A single
    master value (e.g. one Department) can appear on every row of a
    200,000-row file; trusting this cache instead of hitting the DB for
    every single occurrence is what turns that into one query for the
    whole job instead of 200,000.
    """
    if not value:
        return False
    exists = (value in known_values) if known_values is not None else frappe.db.exists(target_doctype, value)
    if exists:
        return False

    meta = frappe.get_meta(target_doctype)
    doc_dict = {"doctype": target_doctype}

    if meta.autoname and meta.autoname.startswith("field:"):
        doc_dict[meta.autoname.split(":", 1)[1]] = value
    else:
        doc_dict["name"] = value
        title_field = next(
            (df.fieldname for df in meta.fields if df.reqd and df.fieldtype == "Data"),
            None,
        )
        if title_field:
            doc_dict[title_field] = value

    frappe.get_doc(doc_dict).insert(ignore_permissions=True)
    if known_values is not None:
        known_values.add(value)
    return True


def _map_headers(sheet, header_aliases, manual_mapping=None):
    """
    Reads row 1 of the sheet and returns (col_field_map, raw_headers,
    unmatched_columns) — shared by both the preview and the real import
    so the two can never drift out of sync with each other.

    `manual_mapping` (e.g. {"3": "location"}) lets the user assign a
    field to a column that didn't auto-match by header text — keyed by
    column index (as a string, since it round-trips through JSON) so it
    still works even if two columns happen to share the same header text.
    """
    if sheet.max_row < 1:
        frappe.throw("The uploaded file is empty.")

    manual_mapping = manual_mapping or {}
    if isinstance(manual_mapping, str):
        manual_mapping = frappe.parse_json(manual_mapping)

    header_row = next(sheet.iter_rows(min_row=1, max_row=1))
    col_field_map = {}
    raw_headers = []
    unmatched_columns = []
    for idx, cell in enumerate(header_row):
        raw_headers.append(cell.value)
        # An explicit manual mapping (the user re-assigning a column, whether
        # it auto-matched or not) always wins over the automatic header guess.
        fieldname = manual_mapping.get(str(idx)) or header_aliases.get(
            _normalize_header(cell.value)
        )
        if fieldname:
            col_field_map[idx] = fieldname
        elif cell.value not in (None, ""):
            unmatched_columns.append({"index": idx, "header": str(cell.value)})

    return col_field_map, raw_headers, unmatched_columns, manual_mapping


def _sample_column_values(sheet, num_cols, scan_rows=15):
    """First non-empty raw value per column index, read straight off the
    sheet (not through _cell_value's field-specific coercion) — shown next
    to each column in the "Map Columns" UI so the user can see the actual
    data before deciding where it should go.
    """
    samples = [""] * num_cols
    remaining = num_cols
    for row in sheet.iter_rows(min_row=2, max_row=1 + scan_rows):
        if remaining <= 0:
            break
        for idx in range(min(num_cols, len(row))):
            if samples[idx]:
                continue
            value = row[idx].value
            if value in (None, ""):
                continue
            samples[idx] = str(value).strip()
            remaining -= 1
    return samples


def _build_all_columns(raw_headers, col_field_map, manual_mapping, samples=None):
    """
    Every real column in the file (matched or not), for the "Map Columns"
    UI — lets the user change ANY column's target field, not just the
    ones that failed to auto-match (mirrors Frappe's own Data Import tool).
    """
    samples = samples or []
    return [
        {
            "index": idx,
            "header": header,
            "fieldname": col_field_map.get(idx),
            "manual": str(idx) in manual_mapping,
            "sample": samples[idx] if idx < len(samples) else "",
        }
        for idx, header in enumerate(raw_headers)
        if header not in (None, "")
    ]


def _silent_parse_date(value, as_datetime=False):
    """
    Mirrors frappe.utils.getdate()/get_datetime()'s own parsing logic, but
    NEVER goes through frappe.throw() on failure.

    getdate() calls frappe.throw(..., title="Invalid Date") when a string
    can't be parsed as a date. frappe.throw() queues the message via
    frappe.msgprint() *before* raising the exception — so even though
    _cell_value's own try/except catches that exception fine and the row
    is safely skipped, the queued message is already sitting in
    frappe.local.message_log and gets flushed to the client regardless.
    Across a 20,000+ row file, every row with one unparseable date value
    queues one more "X is not a valid date string" message, and they all
    land on the client at once as a wall of repeated "Invalid Date"
    dialogs — even though every affected row was already handled
    correctly (the bad value just becomes None). Doing the same parsing
    with dateutil directly, with no frappe.throw() in the failure path at
    all, gets identical results with none of that side effect.
    """
    if value in (None, ""):
        return None
    # openpyxl's own quirk for a date-formatted cell holding Excel's "day
    # zero" serial value (a common stand-in for "blank" on templated
    # exports) is to hand back a bare datetime.time — there's no date
    # component here at all, so it must map to "no value", not fall
    # through to string parsing below (which would default the missing
    # date portion to *today*, silently fabricating a date that was never
    # actually in the file).
    if isinstance(value, datetime.time):
        return None
    if isinstance(value, datetime.datetime):
        return value if as_datetime else value.date()
    if isinstance(value, datetime.date):
        return datetime.datetime.combine(value, datetime.time()) if as_datetime else value
    try:
        parsed = dateutil_parser.parse(str(value))
    except (ValueError, OverflowError, TypeError, dateutil_parser.ParserError):
        return None
    return parsed if as_datetime else parsed.date()


def _cell_value(cell, fieldname, int_fields, date_fields=None, datetime_fields=None):
    value = cell.value
    if value is None:
        return None

    if fieldname in int_fields:
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    # Zwayam exports are free-text spreadsheets, not a fixed date format —
    # values like "09-24-20" (MM-DD-YY) reached the DB completely raw before
    # this check existed, and MariaDB rejects anything that isn't an
    # ISO-ish date outright ("Incorrect date value: '09-24-20' for column
    # ... date_of_application"), failing the ENTIRE row (not just that one
    # column) even though every other cell in it was fine. _silent_parse_date
    # handles this ambiguity correctly via dateutil (same as frappe.utils.
    # getdate would) without frappe.throw()'s message-queuing side effect.
    # An empty/blank cell must short-circuit to None here — parsing "" would
    # otherwise return *today's date* instead of "no value".
    if date_fields and fieldname in date_fields:
        if isinstance(value, str) and not value.strip():
            return None
        return _silent_parse_date(value)

    if datetime_fields and fieldname in datetime_fields:
        if isinstance(value, str) and not value.strip():
            return None
        return _silent_parse_date(value, as_datetime=True)

    if isinstance(value, str):
        value = value.strip()
        return value or None

    if isinstance(value, bool):
        return value

    if isinstance(value, (int, float)):
        # Excel/openpyxl reads numeric-looking columns (Zayam Id, phone
        # numbers, ...) as int/float. Frappe's field validation (e.g. the
        # Phone fieldtype's regex check) expects a string, so coerce here
        # rather than letting a raw number reach doc.save().
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return str(value)

    return value


def _load_sheet(file_doc):
    """Returns an openpyxl worksheet for the uploaded file, whether it's an
    actual .xlsx/.xls or a .csv — a CSV is read into an in-memory workbook
    first, so every downstream helper (_map_headers, _cell_value, etc.) can
    keep working off row/cell objects without caring which format this was.
    """
    path = file_doc.get_full_path()
    if path.lower().endswith(".csv"):
        wb = Workbook()
        ws = wb.active
        try:
            with open(path, newline="", encoding="utf-8-sig") as f:
                rows = list(csv.reader(f))
        except UnicodeDecodeError:
            # Excel-on-Windows CSV exports are usually cp1252, not UTF-8
            # (e.g. "smart quote" apostrophes decode as 0x92 in that codec).
            with open(path, newline="", encoding="cp1252") as f:
                rows = list(csv.reader(f))
        for row in rows:
            ws.append(row)
        return ws

    try:
        # read_only=True makes openpyxl stream rows lazily straight off the
        # underlying XML instead of parsing the entire workbook into memory
        # up front — the default mode is what was making preview_excel hang
        # the whole tab ("Pages Unresponsive") on a real ~21k-row/67-column
        # export: the file is fully loaded before a single preview row can
        # be returned, even though only `limit` rows ever get sent back.
        # data_only=True reads formula cells' last-calculated value instead
        # of the formula string itself, which is what a data import wants.
        return load_workbook(path, read_only=True, data_only=True).active
    except zipfile.BadZipFile:
        # A .xlsx is a ZIP container under the hood — this specific error
        # means the file is missing its End-Of-Central-Directory record,
        # which only happens when the upload was cut off partway through
        # (network drop, tab closed mid-upload, etc.), not from anything
        # about the data inside it. Surfacing openpyxl/zipfile's raw
        # "File is not a zip file" traceback here left the user staring at
        # a Python exception with no idea it just meant "re-upload this".
        frappe.throw(
            f"'{file_doc.file_name}' could not be read as an Excel file — it "
            f"looks like the upload was interrupted partway through (the file "
            f"is missing data a valid .xlsx must end with). Please try "
            f"uploading it again, or use a .csv export instead if this keeps "
            f"happening."
        )


@frappe.whitelist()
def export_template(doctype="Phil Registration Form"):
    """
    Downloads a blank Excel template with one column per importable
    field (fieldname's actual label, so it lines up with what the doctype's
    own form shows) — the same fields _build_config would recognise on
    upload, so a template filled in from here always round-trips cleanly.
    """
    from io import BytesIO

    meta = frappe.get_meta(doctype)
    if not _resolve_match_field(doctype):
        candidates = "' or '".join(_MATCH_FIELD_CANDIDATES)
        frappe.throw(
            f"'{doctype}' does not have a '{candidates}' field yet. "
            f"Add one of these as a custom field to this doctype before exporting a template."
        )

    headers = [
        df.label or df.fieldname
        for df in meta.fields
        if df.fieldtype not in _SKIP_FIELDTYPES and df.fieldtype != "Attach"
    ]

    wb = Workbook()
    ws = wb.active
    ws.title = "Template"
    ws.append(headers)

    buf = BytesIO()
    wb.save(buf)

    frappe.response["filename"] = frappe.scrub(doctype) + "_zayam_template.xlsx"
    frappe.response["filecontent"] = buf.getvalue()
    frappe.response["type"] = "binary"


def _clean_overrides(overrides):
    """Normalize the overrides arg (a dict, or a JSON-encoded dict from the
    client) down to just the non-empty entries that should be force-set."""
    if not overrides:
        return {}
    if isinstance(overrides, str):
        overrides = frappe.parse_json(overrides)
    return {k: v for k, v in overrides.items() if v}


@frappe.whitelist()
def preview_excel(
    file_url,
    doctype="Phil Registration Form",
    limit=200,
    overrides=None,
    manual_mapping=None,
):
    """
    Parses the uploaded file the same way enqueue_import/_run_import_job would, but
    only reads (never writes) — used to render a preview table before
    the user confirms the actual import. `overrides` (e.g. {"themes": "X",
    "geo": "Y"}) is force-set on every previewed row, same as the real import.
    `manual_mapping` (e.g. {"3": "location"}) assigns a field to a column
    that didn't auto-match by header text, keyed by column index.
    """
    frappe.only_for("System Manager")
    limit = int(limit)
    overrides = _clean_overrides(overrides)
    config = _build_config(doctype)
    match_field = config["match_field"]
    header_aliases = config["header_aliases"]
    int_fields = config["int_fields"]
    date_fields = config["date_fields"]
    datetime_fields = config["datetime_fields"]

    file_doc = frappe.get_doc("File", {"file_url": file_url})
    sheet = _load_sheet(file_doc)

    col_field_map, raw_headers, unmatched_columns, manual_mapping = _map_headers(
        sheet, header_aliases, manual_mapping
    )

    # Unlike the real import, don't hard-fail here even if match_field
    # didn't auto-match by header text (e.g. a "Application/Register
    # Number" column instead of "Zayam Id") — still render the preview so
    # the user can use "Map Columns" to assign the right column to it.
    # Preserve the original left-to-right column order for the preview table.
    sorted_cols = sorted(col_field_map.items())
    ordered_columns = [
        {
            "header": raw_headers[idx],
            "fieldname": fieldname,
            "manual": str(idx) in manual_mapping,
        }
        for idx, fieldname in sorted_cols
    ]

    rows = []
    total_rows = 0
    for row in sheet.iter_rows(min_row=2):
        if all(cell.value in (None, "") for cell in row):
            continue

        row_values = {}
        for idx, fieldname in sorted_cols:
            value = (
                _cell_value(row[idx], fieldname, int_fields, date_fields, datetime_fields)
                if idx < len(row)
                else None
            )
            # If two columns map to the same field (e.g. a manually mapped
            # column collides with an auto-matched one), don't let a blank
            # later column silently wipe out a value an earlier one set.
            if value is not None or fieldname not in row_values:
                row_values[fieldname] = value
        row_values.update(overrides)

        total_rows += 1
        if len(rows) < limit:
            rows.append([row_values.get(fieldname) for _, fieldname in sorted_cols])

    return {
        "columns": ordered_columns,
        "rows": rows,
        "total_rows": total_rows,
        "unmatched_columns": unmatched_columns,
        "all_columns": _build_all_columns(
            raw_headers,
            col_field_map,
            manual_mapping,
            _sample_column_values(sheet, len(raw_headers)),
        ),
        "assignable_fields": config["assignable_fields"],
        "match_field": match_field,
        "match_field_mapped": match_field in col_field_map.values(),
    }


@frappe.whitelist()
def enqueue_import(
    file_url, doctype="Phil Registration Form", overrides=None, manual_mapping=None
):
    """
    Validates the file and column mapping synchronously (fast, read-only —
    same checks as preview_excel), then hands the actual row-by-row import
    off to a background job (_run_import_job). A Zwayam export can run to
    hundreds of thousands of rows, which takes far longer than a single web
    request is allowed to run; doing it inline would just get silently cut
    off partway through with no error and no way to tell how far it got.
    Returns a job_id the page polls (get_import_status) for progress.
    """
    frappe.only_for("System Manager")
    overrides = _clean_overrides(overrides)
    config = _build_config(doctype)
    match_field = config["match_field"]

    file_doc = frappe.get_doc("File", {"file_url": file_url})
    sheet = _load_sheet(file_doc)

    col_field_map, raw_headers, unmatched_columns, manual_mapping = _map_headers(
        sheet, config["header_aliases"], manual_mapping
    )

    if match_field not in col_field_map.values():
        frappe.throw(
            f"Could not find a '{match_field}' column in the uploaded file. "
            f"Headers found in row 1: {raw_headers}"
        )

    # Preserve the original left-to-right column order, same as preview_excel,
    # so the results table lines up with what the user saw before confirming.
    ordered_columns = [
        {
            "header": raw_headers[idx],
            "fieldname": fieldname,
            "manual": str(idx) in manual_mapping,
        }
        for idx, fieldname in sorted(col_field_map.items())
    ]
    total_rows = max(sheet.max_row - 1, 0)

    job_id = frappe.generate_hash(length=12)
    user = frappe.session.user
    _save_status(
        job_id, _new_status(job_id, doctype, total_rows, ordered_columns, user)
    )

    frappe.enqueue(
        "ms_calendar.api.zayam_data_import._run_import_job",
        queue="long",
        timeout=6 * 60 * 60,
        # NOTE: frappe.enqueue reserves the kwarg name "job_id" for its own RQ
        # job id — passing our tracking id under that name gets swallowed by
        # frappe.enqueue itself instead of forwarded to _run_import_job, so it
        # goes through as import_job_id instead.
        import_job_id=job_id,
        file_url=file_url,
        doctype=doctype,
        overrides=overrides,
        manual_mapping=manual_mapping,
        user=user,
    )

    return {"job_id": job_id, "total_rows": total_rows}


@frappe.whitelist()
def cancel_import(job_id):
    """
    Requests that a running import stop. This doesn't kill the background
    worker outright — it flips a flag that _run_import_job checks on the
    same cadence as its periodic commits (every 25 rows), so it finishes
    whatever row it's currently on, commits normally, and stops cleanly —
    no partial/uncommitted row, no corrupt state to clean up afterward.
    Rows already processed before the stop stay exactly as they are; the
    job's results (counts, CSV download) reflect everything done up to
    that point, same as a normal completion.
    """
    frappe.only_for("System Manager")
    status = _get_status(job_id)
    if not status:
        frappe.throw(
            "This import job was not found — it may have expired or the job_id is wrong."
        )
    if status.get("state") != "running":
        return {"already_stopped": True}
    _request_cancel(job_id)
    return {"already_stopped": False}


def _results_csv_filename(job_id):
    return f"zayam_import_results_{_safe_identifier(job_id)}.csv"


def _results_csv_path(job_id):
    return frappe.utils.get_site_path("private", "files", _results_csv_filename(job_id))


def _run_import_job(import_job_id, file_url, doctype, overrides, manual_mapping, user):
    """
    The actual row-by-row import, run in the background (see enqueue_import).
    Progress and results are written to cache every _PROGRESS_EVERY rows (and
    at the end) instead of being returned directly, since a 100k+ row result
    is too large to hold in memory/redis or send to the browser in one piece
    — only the first _MAX_DETAIL_ENTRIES rows per bucket are kept for display
    on the page itself, with `truncated` flags telling the page a bucket was
    cut off. That's fine for an on-screen preview (rendering 18,000+ table
    rows in the browser would be slow to the point of freezing the tab), but
    someone reviewing a large import still needs to see EVERY row's outcome
    somewhere — so every single row (not just the first 500 per bucket) is
    also written straight to a CSV file on disk as it's processed, which the
    page offers as a "Download Full Results" link once the job finishes.
    """
    job_id = import_job_id
    status = _get_status(job_id) or _new_status(job_id, doctype, 0, [], user)

    csv_file = open(_results_csv_path(job_id), "w", newline="", encoding="utf-8-sig")
    csv_writer = csv.writer(csv_file)
    # Set immediately (not only on success) so even a run that dies partway
    # through still leaves a downloadable file covering whatever it did
    # manage to process before failing.
    status["results_filename"] = _results_csv_filename(job_id)

    try:
        frappe.set_user(user)
        config = _build_config(doctype)
        match_field = config["match_field"]
        display_field = config["display_field"]
        int_fields = config["int_fields"]
        date_fields = config["date_fields"]
        datetime_fields = config["datetime_fields"]
        link_fields = config["link_fields"]

        file_doc = frappe.get_doc("File", {"file_url": file_url})
        sheet = _load_sheet(file_doc)
        col_field_map, raw_headers, unmatched_columns, manual_mapping = _map_headers(
            sheet, config["header_aliases"], manual_mapping
        )
        status["unmatched_columns"] = unmatched_columns
        status["all_columns"] = _build_all_columns(
            raw_headers,
            col_field_map,
            manual_mapping,
            _sample_column_values(sheet, len(raw_headers)),
        )
        status["assignable_fields"] = config["assignable_fields"]
        _save_status(job_id, status)

        # Pre-fetch, once, everything the row loop would otherwise have to
        # ask the database for on EVERY row:
        #  - every existing match-field value already in this doctype, so
        #    "does this row already exist?" is a dict lookup instead of a
        #    query — the single biggest per-row cost for a large re-import
        #    where most rows already exist.
        #  - every existing name in each Link field's target doctype, so
        #    _ensure_link_value_exists never has to query for a master
        #    value (e.g. one Department) that's about to repeat across
        #    thousands of rows.
        # Both dicts/sets are kept updated as rows are created below, so a
        # duplicate value appearing later in the SAME file is still caught
        # correctly without ever going back to the database for it.
        existing_by_match_value = {
            row[match_field]: row.name
            for row in frappe.get_all(
                doctype, fields=[match_field, "name"], filters=[[match_field, "!=", ""]]
            )
        }
        link_known_values = {
            target_doctype: set(frappe.get_all(target_doctype, pluck="name"))
            for target_doctype in set(link_fields.values())
        }

        # Same left-to-right column order as the on-page preview, so the
        # downloaded CSV's columns line up with what was shown on screen.
        sorted_cols = sorted(col_field_map.items())
        csv_writer.writerow(
            ["Zayam Id", "Status", "Reason / Error"]
            + [raw_headers[idx] for idx, _ in sorted_cols]
        )

        new_master_entries = {}
        cancelled = False

        for i, row in enumerate(sheet.iter_rows(min_row=2), start=1):
            row_values = {}
            for idx, fieldname in col_field_map.items():
                if idx < len(row):
                    value = _cell_value(
                        row[idx], fieldname, int_fields, date_fields, datetime_fields
                    )
                    if value is not None:
                        row_values[fieldname] = value

            match_value = row_values.get(match_field)
            status["processed"] = i
            row_cells = [row_values.get(fieldname, "") for _, fieldname in sorted_cols]

            if not match_value:
                _record_result(
                    status,
                    "skipped",
                    {
                        "zayam_id": None,
                        "name": None,
                        "row": row[0].row,
                        "reason": "no_zayam_id",
                    },
                )
                csv_writer.writerow(["", "Skipped", "No Zayam Id"] + row_cells)
            else:
                row_values.update(overrides)
                entry = {
                    "zayam_id": match_value,
                    "name": row_values.get(display_field),
                    "data": row_values,
                }
                savepoint = f"zayam_import_row_{i}"

                try:
                    frappe.db.savepoint(savepoint)

                    # A Geo/Theme/Location/Role (or any other Link field) value that
                    # doesn't exist yet extends that master list instead of failing
                    # the row — e.g. a new Theme in the export just gets added.
                    for fieldname, target_doctype in link_fields.items():
                        value = row_values.get(fieldname)
                        if value and _ensure_link_value_exists(
                            target_doctype, value, link_known_values.get(target_doctype)
                        ):
                            new_master_entries.setdefault(target_doctype, set()).add(
                                value
                            )

                    existing = existing_by_match_value.get(match_value)
                    if existing:
                        doc = frappe.get_doc(doctype, existing)
                        doc.update(row_values)
                        # Tens of thousands of historical rows going through
                        # here, not a fresh applicant action — skips the
                        # SMS/WhatsApp send that would otherwise fire on
                        # every row (see the matching check in sms_utils.py).
                        doc.flags.in_zayam_import = True
                        doc.save(ignore_permissions=True)
                        _record_result(status, "updated", entry)
                        csv_writer.writerow([match_value, "Updated", ""] + row_cells)
                    else:
                        doc = frappe.get_doc({"doctype": doctype, **row_values})
                        doc.flags.in_zayam_import = True
                        doc.insert(ignore_permissions=True)
                        existing_by_match_value[match_value] = doc.name
                        _record_result(status, "created", entry)
                        csv_writer.writerow([match_value, "Created", ""] + row_cells)
                except Exception as e:
                    # Roll back only this row (not the whole batch) so earlier
                    # successful, not-yet-committed rows in this run survive.
                    try:
                        frappe.db.rollback(save_point=savepoint)
                    except Exception:
                        # The savepoint can be gone even though this row's own
                        # try block is what failed — e.g. a doc_event/Server
                        # Script fired off this row's insert (like
                        # field_user_creation on after_insert) did its own
                        # frappe.db.commit(), which releases every savepoint
                        # opened earlier in the transaction, including this
                        # one. Rolling back to a savepoint that no longer
                        # exists raises OperationalError 1305, and if that's
                        # allowed to escape here it aborts the whole import
                        # (every row after this one gets skipped) instead of
                        # just failing this one row. Fall back to a full
                        # rollback + fresh transaction so the run continues.
                        frappe.log_error(
                            title="Zayam Data Import Savepoint Missing",
                            message=(
                                f"Savepoint '{savepoint}' was gone by the time row "
                                f"{i} ({match_value}) failed — falling back to a "
                                f"full rollback. Rows committed earlier in this "
                                f"run are unaffected; anything staged for THIS "
                                f"row since the last periodic commit is lost."
                            ),
                        )
                        frappe.db.rollback()
                    frappe.log_error(
                        title="Zayam Data Import Error", message=f"{match_value}: {e}"
                    )
                    entry["error"] = frappe.utils.strip_html(str(e))
                    _record_result(status, "failed", entry)
                    csv_writer.writerow(
                        [match_value, "Failed", entry["error"]] + row_cells
                    )

            # Commit periodically so progress survives a worker restart instead
            # of losing everything in one big transaction. The CSV is flushed
            # on the same cadence so a crash doesn't leave rows sitting in
            # Python's write buffer, never actually reaching disk. "Stop
            # Import" is checked on this exact same cadence: whatever's been
            # committed up to here is safe to stop on cleanly, with no
            # in-flight row left half-done.
            if i % 25 == 0:
                frappe.db.commit()
                csv_file.flush()
                if _is_cancel_requested(job_id):
                    cancelled = True
                    break
            if i % _PROGRESS_EVERY == 0:
                status["new_master_entries"] = {
                    dt: sorted(v) for dt, v in new_master_entries.items()
                }
                _save_status(job_id, status)

        frappe.db.commit()
        status["state"] = "cancelled" if cancelled else "done"
        status["new_master_entries"] = {
            dt: sorted(v) for dt, v in new_master_entries.items()
        }
        _save_status(job_id, status)
        if cancelled:
            _clear_cancel_flag(job_id)
    except Exception as e:
        frappe.db.rollback()
        status["state"] = "failed"
        status["error"] = frappe.utils.strip_html(str(e))
        frappe.log_error(
            title="Zayam Data Import Job Failed", message=frappe.get_traceback()
        )
        _save_status(job_id, status)
    finally:
        csv_file.close()


@frappe.whitelist()
def get_import_status(job_id):
    """Polled by the page to render/update the progress bar and, once state
    is "done" or "failed", the final results — including after a reload,
    since the job keeps running in the background regardless of who's
    watching."""
    status = _get_status(job_id)
    if not status:
        frappe.throw(
            "This import job was not found — it may have expired or the job_id is wrong."
        )
    return status


@frappe.whitelist()
def download_import_results(job_id):
    """
    Streams back the CSV that _run_import_job wrote incrementally to disk —
    one row per record actually processed (Created/Updated/Skipped/Failed,
    with its exact reason), for ALL rows, not just the first
    _MAX_DETAIL_ENTRIES shown on the page itself. That on-page cap exists
    purely so the browser isn't asked to render tens of thousands of table
    rows at once; this endpoint has no such limit since it's just streaming
    a file that already exists on disk.
    """
    frappe.only_for("System Manager")
    status = _get_status(job_id)
    if not status:
        frappe.throw(
            "This import job was not found — it may have expired or the job_id is wrong."
        )

    path = _results_csv_path(job_id)
    if not os.path.exists(path):
        frappe.throw("No results file was found for this import job.")

    with open(path, "rb") as f:
        frappe.response["filecontent"] = f.read()
    frappe.response["filename"] = _results_csv_filename(job_id)
    frappe.response["type"] = "download"


def _zayam_id_from_filename(file_name):
    stem = os.path.splitext(file_name or "")[0].strip()
    match = re.match(r"^(\d+)", stem)
    return match.group(1) if match else stem


@frappe.whitelist()
def preview_pdf_match(file_url, file_name=None, doctype="Phil Registration Form"):
    """
    Called once per uploaded PDF before attaching (see the "Bulk Attach
    Resumes" preview step). Reads the same match_field/display_field a
    real attach would use, but never writes anything.
    """
    frappe.only_for("System Manager")
    config = _build_config(doctype)
    match_field = config["match_field"]
    display_field = config["display_field"]

    original_name = (
        file_name
        or frappe.db.get_value("File", {"file_url": file_url}, "file_name")
        or ""
    )
    match_value = _zayam_id_from_filename(original_name)

    docname = frappe.db.get_value(doctype, {match_field: match_value})
    display_name = (
        frappe.db.get_value(doctype, docname, display_field) if docname else None
    )

    return {
        "zayam_id": match_value,
        "name": display_name,
        "docname": docname,
        "found": bool(docname),
    }


@frappe.whitelist()
def lookup_zayam_record(doctype, zayam_id):
    """
    Looks up a record by an explicitly given Zayam Id — used when the
    user manually corrects a PDF's filename-derived Zayam Id that didn't
    auto-match (the "re-match" action in the Bulk Attach Resumes preview).
    """
    frappe.only_for("System Manager")
    config = _build_config(doctype)
    match_field = config["match_field"]
    display_field = config["display_field"]

    zayam_id = (zayam_id or "").strip()
    docname = (
        frappe.db.get_value(doctype, {match_field: zayam_id}) if zayam_id else None
    )
    display_name = (
        frappe.db.get_value(doctype, docname, display_field) if docname else None
    )

    return {
        "zayam_id": zayam_id,
        "name": display_name,
        "docname": docname,
        "found": bool(docname),
    }


@frappe.whitelist()
def attach_application_pdf(file_url, file_name=None, doctype="Phil Registration Form"):
    """
    Called once per confirmed PDF (see the "Bulk Attach Resumes" button).
    The match value is read off the leading digits of the filename
    (e.g. "6213236-ClariceTPaul-Copy.pdf" -> "6213236") and the file is
    attached to that record's first Attach-type field.
    """
    frappe.only_for("System Manager")
    config = _build_config(doctype)
    match_field = config["match_field"]
    display_field = config["display_field"]
    resume_field = config["resume_field"]

    if not resume_field:
        frappe.throw(f"'{doctype}' has no Attach field to store resumes in.")

    file_doc = frappe.get_doc("File", {"file_url": file_url})
    original_name = file_name or file_doc.file_name or ""
    match_value = _zayam_id_from_filename(original_name)

    docname = frappe.db.get_value(doctype, {match_field: match_value})
    if not docname:
        return {"zayam_id": match_value, "name": None, "status": "not_found"}

    display_name = frappe.db.get_value(doctype, docname, display_field)
    savepoint = f"zayam_attach_{_safe_identifier(docname)}"

    try:
        frappe.db.savepoint(savepoint)
        file_doc.attached_to_doctype = doctype
        file_doc.attached_to_name = docname
        file_doc.attached_to_field = resume_field
        file_doc.save(ignore_permissions=True)

        frappe.db.set_value(doctype, docname, resume_field, file_doc.file_url)
        frappe.db.commit()
    except Exception as e:
        frappe.db.rollback(save_point=savepoint)
        frappe.log_error(
            title="Zayam Resume Attach Error", message=f"{match_value}: {e}"
        )
        return {
            "zayam_id": match_value,
            "name": display_name,
            "status": "failed",
            "error": frappe.utils.strip_html(str(e)),
        }

    return {
        "zayam_id": match_value,
        "name": display_name,
        "status": "attached",
        "docname": docname,
    }


@frappe.whitelist()
def get_zayam_enabled_doctypes(
    doctype, txt, searchfield, start, page_len, filters, **kwargs
):
    """Query method for the doctype Link field: only list doctypes that already have a Zayam Id (or Zwayam Id) field."""
    names = frappe.get_all(
        "DocField", filters={"fieldname": ["in", _MATCH_FIELD_CANDIDATES]}, pluck="parent"
    )
    names += frappe.get_all(
        "Custom Field", filters={"fieldname": ["in", _MATCH_FIELD_CANDIDATES]}, pluck="dt"
    )
    names = sorted(set(names))
    if txt:
        names = [n for n in names if txt.lower() in n.lower()]
    return [[n] for n in names[start : start + page_len]]
