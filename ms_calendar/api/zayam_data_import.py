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

3. Import a row (import_from_excel)
   Each Excel column header is normalized and looked up in the mapping
   from step 2 to find which fieldname it should be written into.
   Unrecognized headers are collected as `unmatched_columns` and
   returned to the page instead of silently being dropped. For each
   data row, the Zayam Id column value is used to find an existing
   record (update) or create a new one; each row runs inside its own
   DB savepoint so one bad row can't roll back earlier successful rows
   in the same uncommitted batch, and commits happen every 25 rows so
   large imports survive a request timeout.

4. Attach a resume PDF (attach_application_pdf)
   The uploaded filename's leading digits are read as the Zayam Id
   (e.g. "6213236-ClariceTPaul-Copy.pdf" -> "6213236"), used to find
   the matching record, and the file is attached to that doctype's
   resume field from step 2 — again inside its own savepoint so a
   failure on one file doesn't affect the others in the same batch.
"""

import os
import re

import frappe
from openpyxl import load_workbook

_MATCH_FIELD = "zayam_id"

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

    if not meta.get_field(_MATCH_FIELD):
        frappe.throw(
            f"'{doctype}' does not have a '{_MATCH_FIELD}' field yet. "
            f"Add a Zayam Id custom field to this doctype before importing."
        )

    header_aliases = {}
    int_fields = set()
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

        if df.fieldtype == "Link" and df.options and df.options != "DocType":
            link_fields[df.fieldname] = df.options

        if display_field is None and df.fieldtype == "Data" and "name" in df.fieldname.lower():
            display_field = df.fieldname

        if resume_field is None and df.fieldtype == "Attach":
            resume_field = df.fieldname

        assignable_fields.append({"fieldname": df.fieldname, "label": df.label or df.fieldname})

    # "Zwayam Id" is a real misspelling that shows up in some exports —
    # recognise it as the same column as the actual Zayam Id field.
    header_aliases["zwayam_id"] = _MATCH_FIELD
    header_aliases["zwayamid"] = _MATCH_FIELD

    return {
        "match_field": _MATCH_FIELD,
        "display_field": display_field or _MATCH_FIELD,
        "resume_field": resume_field,
        "int_fields": int_fields,
        "header_aliases": header_aliases,
        "link_fields": link_fields,
        "assignable_fields": assignable_fields,
    }


def _ensure_link_value_exists(target_doctype, value):
    """
    If `value` isn't an existing record of target_doctype, create one on
    the fly (e.g. a new Theme/Geo/Location/Role appearing in a Zayam
    export shouldn't fail the whole row — it should just extend the
    master list). Returns True if a new record was created.
    """
    if not value or frappe.db.exists(target_doctype, value):
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
        fieldname = manual_mapping.get(str(idx)) or header_aliases.get(_normalize_header(cell.value))
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


def _cell_value(cell, fieldname, int_fields):
    value = cell.value
    if value is None:
        return None

    if fieldname in int_fields:
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

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


@frappe.whitelist()
def export_template(doctype="Phil Registration Form"):
    """
    Downloads a blank Excel template with one column per importable
    field (fieldname's actual label, so it lines up with what the doctype's
    own form shows) — the same fields _build_config would recognise on
    upload, so a template filled in from here always round-trips cleanly.
    """
    from io import BytesIO

    from openpyxl import Workbook

    meta = frappe.get_meta(doctype)
    if not meta.get_field(_MATCH_FIELD):
        frappe.throw(
            f"'{doctype}' does not have a '{_MATCH_FIELD}' field yet. "
            f"Add a Zayam Id custom field to this doctype before exporting a template."
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
def preview_excel(file_url, doctype="Phil Registration Form", limit=10, overrides=None, manual_mapping=None):
    """
    Parses the uploaded file the same way import_from_excel would, but
    only reads (never writes) — used to render a preview table before
    the user confirms the actual import. `overrides` (e.g. {"themes": "X",
    "geo": "Y"}) is force-set on every previewed row, same as the real import.
    `manual_mapping` (e.g. {"3": "location"}) assigns a field to a column
    that didn't auto-match by header text, keyed by column index.
    """
    limit = int(limit)
    overrides = _clean_overrides(overrides)
    config = _build_config(doctype)
    match_field = config["match_field"]
    header_aliases = config["header_aliases"]
    int_fields = config["int_fields"]

    file_doc = frappe.get_doc("File", {"file_url": file_url})
    workbook = load_workbook(file_doc.get_full_path())
    sheet = workbook.active

    col_field_map, raw_headers, unmatched_columns, manual_mapping = _map_headers(sheet, header_aliases, manual_mapping)

    if match_field not in col_field_map.values():
        frappe.throw(
            f"Could not find a '{match_field}' column in the uploaded file. "
            f"Headers found in row 1: {raw_headers}"
        )

    # Preserve the original left-to-right column order for the preview table.
    sorted_cols = sorted(col_field_map.items())
    ordered_columns = [
        {"header": raw_headers[idx], "fieldname": fieldname, "manual": str(idx) in manual_mapping}
        for idx, fieldname in sorted_cols
    ]

    rows = []
    total_rows = 0
    for row in sheet.iter_rows(min_row=2):
        if all(cell.value in (None, "") for cell in row):
            continue

        row_values = {}
        for idx, fieldname in sorted_cols:
            value = _cell_value(row[idx], fieldname, int_fields) if idx < len(row) else None
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
            raw_headers, col_field_map, manual_mapping, _sample_column_values(sheet, len(raw_headers))
        ),
        "assignable_fields": config["assignable_fields"],
    }


@frappe.whitelist()
def import_from_excel(file_url, doctype="Phil Registration Form", overrides=None, manual_mapping=None):
    """
    Reads an uploaded Zayam Excel export and creates/updates records of
    the given doctype, matched on that doctype's Zayam Id field. Any
    fieldname:value pair in `overrides` (e.g. {"themes": "X", "geo": "Y"})
    is force-set on every row — overriding whatever (if anything) was in
    the file's own column for that field. `manual_mapping` (e.g.
    {"3": "location"}) assigns a field to a column that didn't auto-match
    by header text, keyed by column index — same as preview_excel.
    """
    overrides = _clean_overrides(overrides)
    config = _build_config(doctype)
    match_field = config["match_field"]
    display_field = config["display_field"]
    header_aliases = config["header_aliases"]
    int_fields = config["int_fields"]
    link_fields = config["link_fields"]

    file_doc = frappe.get_doc("File", {"file_url": file_url})
    workbook = load_workbook(file_doc.get_full_path())
    sheet = workbook.active

    col_field_map, raw_headers, unmatched_columns, manual_mapping = _map_headers(sheet, header_aliases, manual_mapping)

    if match_field not in col_field_map.values():
        frappe.throw(
            f"Could not find a '{match_field}' column in the uploaded file. "
            f"Headers found in row 1: {raw_headers}"
        )

    # Preserve the original left-to-right column order, same as preview_excel,
    # so the results table lines up with what the user saw before confirming.
    ordered_columns = [
        {"header": raw_headers[idx], "fieldname": fieldname, "manual": str(idx) in manual_mapping}
        for idx, fieldname in sorted(col_field_map.items())
    ]

    created, updated, skipped, failed = [], [], [], []
    new_master_entries = {}

    for i, row in enumerate(sheet.iter_rows(min_row=2), start=1):
        row_values = {}
        for idx, fieldname in col_field_map.items():
            if idx < len(row):
                value = _cell_value(row[idx], fieldname, int_fields)
                if value is not None:
                    row_values[fieldname] = value

        match_value = row_values.get(match_field)
        if not match_value:
            skipped.append({"zayam_id": None, "name": None, "row": row[0].row, "reason": "no_zayam_id"})
            continue

        row_values.update(overrides)

        entry = {"zayam_id": match_value, "name": row_values.get(display_field), "data": row_values}
        savepoint = f"zayam_import_row_{i}"

        try:
            frappe.db.savepoint(savepoint)

            # A Geo/Theme/Location/Role (or any other Link field) value that
            # doesn't exist yet extends that master list instead of failing
            # the row — e.g. a new Theme in the export just gets added.
            for fieldname, target_doctype in link_fields.items():
                value = row_values.get(fieldname)
                if value and _ensure_link_value_exists(target_doctype, value):
                    new_master_entries.setdefault(target_doctype, set()).add(value)

            existing = frappe.db.get_value(doctype, {match_field: match_value})
            if existing:
                doc = frappe.get_doc(doctype, existing)
                doc.update(row_values)
                doc.save(ignore_permissions=True)
                updated.append(entry)
            else:
                doc = frappe.get_doc({"doctype": doctype, **row_values})
                doc.insert(ignore_permissions=True)
                created.append(entry)
        except Exception as e:
            # Roll back only this row (not the whole batch) so earlier
            # successful, not-yet-committed rows in this loop survive.
            frappe.db.rollback(save_point=savepoint)
            frappe.log_error(
                title="Zayam Data Import Error", message=f"{match_value}: {e}"
            )
            entry["error"] = frappe.utils.strip_html(str(e))
            failed.append(entry)

        # Commit periodically so progress survives a request timeout on
        # large imports instead of losing everything in one big transaction.
        if i % 25 == 0:
            frappe.db.commit()

    frappe.db.commit()

    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "failed": failed,
        "unmatched_columns": unmatched_columns,
        "columns": ordered_columns,
        "all_columns": _build_all_columns(
            raw_headers, col_field_map, manual_mapping, _sample_column_values(sheet, len(raw_headers))
        ),
        "new_master_entries": {dt: sorted(values) for dt, values in new_master_entries.items()},
        "assignable_fields": config["assignable_fields"],
    }


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
    config = _build_config(doctype)
    match_field = config["match_field"]
    display_field = config["display_field"]

    original_name = file_name or frappe.db.get_value("File", {"file_url": file_url}, "file_name") or ""
    match_value = _zayam_id_from_filename(original_name)

    docname = frappe.db.get_value(doctype, {match_field: match_value})
    display_name = frappe.db.get_value(doctype, docname, display_field) if docname else None

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
    config = _build_config(doctype)
    match_field = config["match_field"]
    display_field = config["display_field"]

    zayam_id = (zayam_id or "").strip()
    docname = frappe.db.get_value(doctype, {match_field: zayam_id}) if zayam_id else None
    display_name = frappe.db.get_value(doctype, docname, display_field) if docname else None

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
def get_zayam_enabled_doctypes(doctype, txt, searchfield, start, page_len, filters, **kwargs):
    """Query method for the doctype Link field: only list doctypes that already have a Zayam Id field."""
    names = frappe.get_all(
        "DocField", filters={"fieldname": _MATCH_FIELD}, pluck="parent"
    )
    names += frappe.get_all(
        "Custom Field", filters={"fieldname": _MATCH_FIELD}, pluck="dt"
    )
    names = sorted(set(names))
    if txt:
        names = [n for n in names if txt.lower() in n.lower()]
    return [[n] for n in names[start : start + page_len]]
