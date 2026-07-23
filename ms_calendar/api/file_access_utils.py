import os

import frappe


def get_file_bytes_resilient(file_doc):
    """Read a File doc's bytes, tolerating a stale/mismatched `is_private`
    flag — i.e. the DB record says private/public but the bytes actually
    live in the other folder (common after bulk imports or reused "library
    file" attachments). Without this, `File.get_content()` raises
    FileNotFoundError and the caller silently drops the attachment
    (e.g. a candidate's resume/feedback form never reaches the interviewer's
    scheduling email).
    """
    try:
        return file_doc.get_content()
    except FileNotFoundError:
        alt_folder = "public" if file_doc.is_private else "private"
        alt_path = frappe.get_site_path(alt_folder, "files", file_doc.file_name)
        if os.path.isfile(alt_path):
            with open(alt_path, "rb") as f:
                return f.read()
        raise
