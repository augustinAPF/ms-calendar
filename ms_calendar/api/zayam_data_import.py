import os
import re

import frappe
from openpyxl import load_workbook

# Per-doctype import configuration:
#   match_field   - field used to find an existing record for a given row
#                   (also doubles as the filename key for bulk PDF attach)
#   resume_field  - Attach field the bulk "attach resumes" tool writes to
#   header_aliases - recognised Excel header text (normalized: lowercased,
#                   non-alphanumeric collapsed to "_") mapped to the
#                   doctype fieldname it should be written to
#   int_fields    - fieldnames that must be coerced to int
_DOCTYPE_CONFIG = {
    "Phil Registration Form": {
        "match_field": "zayam_id",
        "resume_field": "cv_attach",
        "int_fields": {"age", "total_experience"},
        "header_aliases": {
            "zayam_id": "zayam_id",
            "zayamid": "zayam_id",
            "name": "name1",
            "name1": "name1",
            "full_name": "name1",
            "email": "email",
            "email_id": "email",
            "phone": "phone",
            "phone_number": "phone",
            "mobile": "phone",
            "mobile_number": "phone",
            "date_of_birth": "date_of_birth",
            "dob": "date_of_birth",
            "age": "age",
            "role": "role",
            "location": "location",
            "geo": "geo",
            "geography": "geo",
            "geographies": "geo",
            "theme": "themes",
            "themes": "themes",
            "position": "position",
            "current_location": "current_location",
            "highest_level_of_education": "highest_level_of_education",
            "education": "highest_level_of_education",
            "completion_year": "completion_year",
            "year_of_completion_of_your_highest_level_of_education": "completion_year",
            "total_experience": "total_experience",
            "total_years_of_experience": "total_experience",
            "experience": "total_experience",
            "application_status": "application_status",
        },
    },
    "Field Registration Form": {
        "match_field": "zayam_id",
        "resume_field": "resume_upload",
        "int_fields": {"age"},
        "header_aliases": {
            "zayam_id": "zayam_id",
            "zayamid": "zayam_id",
            "name": "full_name_aadhaar",
            "full_name": "full_name_aadhaar",
            "full_name_aadhaar": "full_name_aadhaar",
            "full_name_as_per_aadhaar": "full_name_aadhaar",
            "email": "email_address",
            "email_address": "email_address",
            "email_id": "email_address",
            "phone": "phone_number",
            "phone_number": "phone_number",
            "mobile": "phone_number",
            "mobile_number": "phone_number",
            "date_of_birth": "dob",
            "dob": "dob",
            "age": "age",
            "role": "role",
            "location": "location",
            "department": "department",
            "highest_level_of_education": "highest_education",
            "highest_education": "highest_education",
            "education": "highest_education",
            "application_status": "application_status",
        },
    },
}


def _get_config(doctype):
    config = _DOCTYPE_CONFIG.get(doctype)
    if not config:
        frappe.throw(f"Zayam import is not configured for doctype '{doctype}'.")
    return config


def _normalize_header(value):
    text = str(value or "").strip().lower()
    return re.sub(r"[^a-z0-9]+", "_", text).strip("_")


def _cell_value(cell, fieldname, int_fields):
    value = cell.value
    if value is None:
        return None
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return None
    if fieldname in int_fields:
        try:
            return int(value)
        except (TypeError, ValueError):
            return None
    return value


@frappe.whitelist()
def import_from_excel(file_url, doctype="Phil Registration Form"):
    """
    Reads an uploaded Zayam Excel export and creates/updates records of
    the given doctype, matched on that doctype's configured match field.
    """
    config = _get_config(doctype)
    match_field = config["match_field"]
    header_aliases = config["header_aliases"]
    int_fields = config["int_fields"]

    file_doc = frappe.get_doc("File", {"file_url": file_url})
    workbook = load_workbook(file_doc.get_full_path())
    sheet = workbook.active

    header_row = next(sheet.iter_rows(min_row=1, max_row=1))
    col_field_map = {}
    raw_headers = []
    for idx, cell in enumerate(header_row):
        raw_headers.append(cell.value)
        fieldname = header_aliases.get(_normalize_header(cell.value))
        if fieldname:
            col_field_map[idx] = fieldname

    if match_field not in col_field_map.values():
        frappe.throw(
            f"Could not find a '{match_field}' column in the uploaded file. "
            f"Headers found in row 1: {raw_headers}"
        )

    created, updated, skipped, failed = [], [], [], []

    for row in sheet.iter_rows(min_row=2):
        row_values = {}
        for idx, fieldname in col_field_map.items():
            if idx < len(row):
                value = _cell_value(row[idx], fieldname, int_fields)
                if value is not None:
                    row_values[fieldname] = value

        match_value = row_values.get(match_field)
        if not match_value:
            skipped.append(f"row {row[0].row}")
            continue

        try:
            existing = frappe.db.get_value(doctype, {match_field: match_value})
            if existing:
                doc = frappe.get_doc(doctype, existing)
                doc.update(row_values)
                doc.save(ignore_permissions=True)
                updated.append(match_value)
            else:
                doc = frappe.get_doc({"doctype": doctype, **row_values})
                doc.insert(ignore_permissions=True)
                created.append(match_value)
        except Exception as e:
            frappe.log_error(
                title="Zayam Data Import Error", message=f"{match_value}: {e}"
            )
            failed.append(match_value)

    frappe.db.commit()

    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "failed": failed,
    }


@frappe.whitelist()
def attach_application_pdf(file_url, file_name=None, doctype="Phil Registration Form"):
    """
    Called once per uploaded PDF (see the "Bulk Attach Resumes" button).
    The match value is read off the leading digits of the filename
    (e.g. "6213236-ClariceTPaul-Copy.pdf" -> "6213236") and the file is
    attached to that record's configured resume field.
    """
    config = _get_config(doctype)
    match_field = config["match_field"]
    resume_field = config["resume_field"]

    file_doc = frappe.get_doc("File", {"file_url": file_url})
    original_name = file_name or file_doc.file_name or ""
    stem = os.path.splitext(original_name)[0].strip()
    match = re.match(r"^(\d+)", stem)
    match_value = match.group(1) if match else stem

    docname = frappe.db.get_value(doctype, {match_field: match_value})
    if not docname:
        return {"zayam_id": match_value, "status": "not_found"}

    file_doc.attached_to_doctype = doctype
    file_doc.attached_to_name = docname
    file_doc.attached_to_field = resume_field
    file_doc.save(ignore_permissions=True)

    frappe.db.set_value(doctype, docname, resume_field, file_doc.file_url)
    frappe.db.commit()

    return {"zayam_id": match_value, "status": "attached", "docname": docname}


##testing
