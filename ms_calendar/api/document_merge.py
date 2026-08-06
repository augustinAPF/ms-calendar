"""
Merge every Attach/Attach Image field on a document into a single
downloadable PDF — e.g. all the certificates/ID proofs on a Document
Collection record, combined into one file instead of downloading each
attachment separately.

Attached PDFs are copied in page-for-page; attached images (JPG/PNG/etc.)
are converted to a single PDF page each via Pillow, then merged in with
pypdf — both libraries are already available in this bench, no new
dependency needed.
"""

import base64
import io
import os

import frappe
from frappe import _
from PIL import Image
from pypdf import PdfReader, PdfWriter

_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".gif", ".webp"}


def _attach_fieldnames(doctype):
    """Every Attach/Attach Image field on this doctype, in form order."""
    meta = frappe.get_meta(doctype)
    return [df.fieldname for df in meta.fields if df.fieldtype in ("Attach", "Attach Image")]


def _read_file_content(file_url):
    """Bytes for an attached file (private or public), or None if missing."""
    if not file_url:
        return None
    file_docs = frappe.get_all("File", filters={"file_url": file_url}, fields=["name"], limit=1)
    if not file_docs:
        return None
    return frappe.get_doc("File", file_docs[0]["name"]).get_content()


def _append_pages(writer, content, ext):
    """Append `content` to `writer` as PDF pages. Returns False if the
    extension isn't something this can turn into PDF pages at all."""
    ext = ext.lower()
    if ext == ".pdf":
        for page in PdfReader(io.BytesIO(content)).pages:
            writer.add_page(page)
        return True

    if ext in _IMAGE_EXTENSIONS:
        image = Image.open(io.BytesIO(content))
        if image.mode != "RGB":
            image = image.convert("RGB")
        buf = io.BytesIO()
        image.save(buf, format="PDF")
        buf.seek(0)
        for page in PdfReader(buf).pages:
            writer.add_page(page)
        return True

    return False


@frappe.whitelist()
def download_merged_pdf(doctype, name):
    doc = frappe.get_doc(doctype, name)
    doc.check_permission("read")

    writer = PdfWriter()
    skipped = []

    for fieldname in _attach_fieldnames(doctype):
        file_url = doc.get(fieldname)
        if not file_url:
            continue

        content = _read_file_content(file_url)
        if not content:
            skipped.append(fieldname)
            continue

        ext = os.path.splitext(file_url)[-1]
        try:
            ok = _append_pages(writer, content, ext)
        except Exception:
            frappe.log_error(
                frappe.get_traceback(),
                f"Merge PDF failed for {doctype} {name}, field {fieldname}",
            )
            ok = False

        if not ok:
            skipped.append(fieldname)

    if len(writer.pages) == 0:
        frappe.throw(_("No PDF or image attachments found on this record to merge."))

    buf = io.BytesIO()
    writer.write(buf)

    # Returned as base64 (rather than streamed as a raw download response)
    # so the caller is a normal frappe.call() — that's what lets the
    # button show a freeze/loading state and surface `skipped` to the
    # user via frappe.msgprint, neither of which a plain browser
    # navigation to this URL could do.
    return {
        "filename": f"{name}_merged.pdf",
        "filedata": base64.b64encode(buf.getvalue()).decode("ascii"),
        "skipped": skipped,
    }
