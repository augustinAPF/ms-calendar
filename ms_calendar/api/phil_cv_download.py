"""Bulk CV download for the Phil Registration Form list view.

Recruiters shortlist a batch of applicants from the list, tick their
checkboxes and want every attached CV in one go instead of opening each
application and downloading `cv_attach` one file at a time.

Two endpoints, deliberately split:

  * get_cv_download_summary() — a cheap JSON pre-check so the list view can
    tell the recruiter up front how many of the ticked applicants actually
    have a CV attached (and which don't) *before* a download starts. Once
    the browser is navigating to a file download there is no longer any
    way to show them a message.
  * download_cvs() — streams the actual zip back as a file response.
"""

import io
import os
import re
import zipfile

import frappe
from frappe import _

DOCTYPE = "Phil Registration Form"
CV_FIELD = "cv_attach"
NAME_FIELD = "name1"

# A zip is built entirely in memory before it is handed to the response, so
# both the file count and the total payload need a ceiling — a recruiter can
# tick "2500" in the list view paging and select every applicant on site.
MAX_APPLICANTS = 500
MAX_TOTAL_BYTES = 500 * 1024 * 1024


def _sanitize(text):
    return re.sub(r"[^\w\s-]", "", str(text or "")).strip().replace(" ", "_")


def _selected_rows(names):
    """Fetch the ticked applicants, newest selection order irrelevant.

    frappe.get_all applies the current user's read/user permissions, so an
    applicant the user cannot see simply never comes back here.
    """
    if isinstance(names, str):
        names = frappe.parse_json(names)

    names = [n for n in (names or []) if n]
    if not names:
        frappe.throw(_("Select at least one applicant to download CVs for."))

    if len(names) > MAX_APPLICANTS:
        frappe.throw(
            _("Please select at most {0} applicants at a time — {1} were selected.").format(
                MAX_APPLICANTS, len(names)
            )
        )

    if not frappe.has_permission(DOCTYPE, "read"):
        frappe.throw(_("Not permitted to read {0}.").format(DOCTYPE), frappe.PermissionError)

    return frappe.get_all(
        DOCTYPE,
        filters={"name": ["in", names]},
        fields=["name", NAME_FIELD, CV_FIELD],
        limit_page_length=0,
        order_by="name asc",
    )


def _cv_file_doc(row):
    """Resolve an applicant's cv_attach url to its File record.

    Falls back to whatever File is actually attached to this doc/field when
    the url lookup misses — the same defensive pairing resume_rename.py
    uses, since an interrupted rename can leave cv_attach pointing at a
    file_url no File record carries any more.
    """
    url = row.get(CV_FIELD)
    if not url:
        return None

    file_name = frappe.db.get_value("File", {"file_url": url}, "name")
    if not file_name:
        file_name = frappe.db.get_value(
            "File",
            {
                "attached_to_doctype": DOCTYPE,
                "attached_to_name": row["name"],
                "attached_to_field": CV_FIELD,
            },
            "name",
            order_by="creation desc",
        )
    if not file_name:
        return None

    return frappe.get_doc("File", file_name)


def _read_cv(row):
    """Return (filename, bytes) for this applicant's CV, or None if the
    attachment can't be read off disk (deleted file, external url, ...)."""
    file_doc = _cv_file_doc(row)
    if not file_doc or file_doc.is_folder:
        return None

    try:
        path = file_doc.get_full_path()
        # Read the raw bytes rather than File.get_content(), which tries to
        # decode the file to text first and would hand back a str for any
        # CV that happens to decode cleanly.
        with open(path, "rb") as f:
            content = f.read()
    except OSError:
        return None

    ext = os.path.splitext(file_doc.file_name or path)[-1].lower() or ".pdf"
    # Applicant name + application id: the id keeps two "Priya Jain" CVs
    # from colliding inside the zip, and lets a recruiter match a file back
    # to the row they ticked.
    label = _sanitize(row.get(NAME_FIELD)) or "Applicant"
    return f"{label}_{row['name']}{ext}", content


@frappe.whitelist()
def get_cv_download_summary(names):
    """Report how many of the selected applicants have a downloadable CV.

    Called before download_cvs() so the list view can warn about the ones
    that will be missing from the zip.
    """
    rows = _selected_rows(names)

    with_cv = 0
    total_bytes = 0
    missing = []

    for row in rows:
        file_doc = _cv_file_doc(row)
        if not file_doc:
            missing.append({"name": row["name"], "applicant": row.get(NAME_FIELD) or ""})
            continue
        with_cv += 1
        total_bytes += file_doc.file_size or 0

    return {
        "total": len(rows),
        "with_cv": with_cv,
        "missing": missing,
        # Reported so the caller can stop an over-sized batch *before* the
        # browser navigates off to the download — once it does, a throw from
        # download_cvs() lands as a raw error page instead of a message.
        "total_size_mb": round(total_bytes / (1024 * 1024), 1),
        "size_limit_mb": MAX_TOTAL_BYTES // (1024 * 1024),
        "too_large": total_bytes > MAX_TOTAL_BYTES,
    }


# Cap on how many application IDs get spelled out in the zip's own
# filename — past this it collapses to "...and_N_more" instead, so a
# 300-applicant batch doesn't try to name the download with 300 ids.
MAX_IDS_IN_ZIP_NAME = 6


def _zip_filename(ids):
    """Build "Phil_CVs_APPRF-0109_APPRF-0111.zip" from the application ids
    actually written into the zip — not just a bare count — so the
    recruiter can tell which batch a download was from their filesystem
    without opening it."""
    if len(ids) <= MAX_IDS_IN_ZIP_NAME:
        id_part = "_".join(ids)
    else:
        shown = ids[:MAX_IDS_IN_ZIP_NAME]
        id_part = "_".join(shown) + f"_and_{len(ids) - len(shown)}_more"
    return f"Phil_CVs_{id_part}.zip"


@frappe.whitelist()
def download_cvs(names):
    """Zip up the CVs of every selected applicant and stream it back.

    Invoked as a form POST (see phil_registration_form_list.js) rather than
    frappe.call, both because the selection can be hundreds of ids — too
    long for a GET query string — and because the browser has to navigate
    to the response for it to land as a file download.
    """
    rows = _selected_rows(names)

    buf = io.BytesIO()
    written_ids = []
    total_bytes = 0

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for row in rows:
            cv = _read_cv(row)
            if not cv:
                continue

            filename, content = cv
            total_bytes += len(content)
            if total_bytes > MAX_TOTAL_BYTES:
                frappe.throw(
                    _(
                        "The selected CVs add up to more than {0} MB. Please download them in smaller batches."
                    ).format(MAX_TOTAL_BYTES // (1024 * 1024))
                )

            zf.writestr(filename, content)
            written_ids.append(row["name"])

    if not written_ids:
        frappe.throw(_("None of the selected applicants have a CV attached."))

    frappe.response["filename"] = _zip_filename(written_ids)
    frappe.response["filecontent"] = buf.getvalue()
    frappe.response["type"] = "download"
