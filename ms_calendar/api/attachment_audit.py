"""Read-only audit of every attachment field resume_rename.py manages,
across all four registration forms and the two Document Collection
doctypes — for finding out how widespread "file shows as missing/404" is,
and which specific failure pattern each broken record falls into, rather
than continuing to diagnose one screenshot at a time.

Run via:
    bench --site <site> execute ms_calendar.api.attachment_audit.run

or from the desk as a System Manager via:
    frappe.call("ms_calendar.api.attachment_audit.run")
"""

import os

import frappe

# Every (doctype, fieldname) pair resume_rename.py ever renames a file
# under. Document Collection doctypes have several attach fields each —
# see resume_rename.py's own _PHIL_DOC_COLLECTION_ATTACH_FIELDS /
# _HEALTH_DOC_COLLECTION_ATTACH_FIELDS lists, mirrored here.
_SIMPLE_FIELDS = [
    ("Phil Registration Form", "cv_attach"),
    ("Field Registration Form", "resume_upload"),
    ("Health Registration Form", "resume"),
    ("Scholarship Recruitment Form", "resume__cv"),
    # The other three sources create_interview_event actually attaches to
    # a Philanthropy interview invite (see ms_philanthropy.py's "ATTACH
    # FILES" section + philanthropy_interview_schedule.js's attachments[]
    # build-up) — a prior version of this audit only covered the CV/resume
    # fields above and missed these entirely.
    ("Phil Registration Form", "phil_application_pdf"),
    ("Phil Registration Form", "feedback_form"),
    ("Phil Assignment", "assignment_submission"),
    ("Philanthropy Interview Schedule", "candidate_cv__resume"),
]

_PHIL_DOC_COLLECTION_FIELDS = [
    "pan_card",
    "aadhaar_card",
    "class_x_certificate",
    "class_xii_certificate",
    "degree_certificate",
    "pg_certificate",
    "phd_certificate",
    "experience_letter",
    "salary_revision_letter",
    "pay_slips",
]

_HEALTH_DOC_COLLECTION_FIELDS = [
    "pan_card",
    "aadhaar_card",
    "mbbs_completion",
    "council_registration",
    "previous_work_experience_letters",
]


def _physical_path(is_private, filename):
    return frappe.get_site_path("private" if is_private else "public", "files", filename)


def _classify(doctype, name, fieldname, url):
    """Return one of: ok / no_file_record / physical_file_missing /
    prefix_mismatch, plus a short detail string."""
    file_rows = frappe.get_all(
        "File", filters={"file_url": url}, fields=["name", "file_name", "is_private"], limit=1
    )
    if not file_rows:
        file_rows = frappe.get_all(
            "File",
            filters={
                "attached_to_doctype": doctype,
                "attached_to_name": name,
                "attached_to_field": fieldname,
            },
            fields=["name", "file_name", "is_private"],
            order_by="creation desc",
            limit=1,
        )
    if not file_rows:
        return "no_file_record", f"no File record matches url={url!r} or attached_to_*"

    row = file_rows[0]
    # Where the field's own url prefix says the bytes should be.
    url_says_private = "/private/" in url
    path_by_url_prefix = _physical_path(url_says_private, row.file_name)
    if os.path.isfile(path_by_url_prefix):
        # File is exactly where the field's own url prefix claims — but does
        # that agree with the File doc's is_private flag? Mismatch here is
        # latent, not yet broken (a future rename would compute the wrong
        # target prefix — see resume_rename.py's fix — but right now the
        # bytes are where the field says, so it currently loads fine).
        if bool(row.is_private) != url_says_private:
            return "prefix_mismatch_latent", (
                f"File {row.name} is_private={row.is_private} but url {url!r} "
                f"says {'private' if url_says_private else 'public'} — bytes ARE there, "
                f"but this will misfire on the next rename"
            )
        return "ok", ""

    # Not at the url-implied path — check the other folder before calling
    # it fully missing (this is exactly the same drift file_access_utils.py
    # and resume_rename.py's own fix already account for elsewhere).
    alt_path = _physical_path(not url_says_private, row.file_name)
    if os.path.isfile(alt_path):
        return "prefix_mismatch", (
            f"File {row.name}: field url {url!r} implies "
            f"{'private' if url_says_private else 'public'}, but the bytes are "
            f"actually in the {'public' if url_says_private else 'private'} folder — "
            f"this is the exact bug that causes a 404 on the field's own link"
        )

    return "physical_file_missing", (
        f"File {row.name} ({row.file_name}): no physical file in either "
        f"public or private files folder — genuinely gone"
    )


def run():
    fields_to_check = list(_SIMPLE_FIELDS)
    fields_to_check += [
        ("Philanthrophy Document Collection", f) for f in _PHIL_DOC_COLLECTION_FIELDS
    ]
    fields_to_check += [
        ("Health Document Collection", f) for f in _HEALTH_DOC_COLLECTION_FIELDS
    ]

    summary = {}
    broken_examples = []

    for doctype, fieldname in fields_to_check:
        if not frappe.db.exists("DocType", doctype):
            continue
        rows = frappe.get_all(
            doctype,
            filters={fieldname: ["is", "set"]},
            fields=["name", fieldname],
            limit_page_length=0,
        )
        counts = {"ok": 0, "no_file_record": 0, "physical_file_missing": 0,
                  "prefix_mismatch": 0, "prefix_mismatch_latent": 0}
        for row in rows:
            url = row.get(fieldname)
            if not url:
                continue
            category, detail = _classify(doctype, row["name"], fieldname, url)
            counts[category] = counts.get(category, 0) + 1
            if category != "ok":
                broken_examples.append(
                    {
                        "doctype": doctype,
                        "name": row["name"],
                        "field": fieldname,
                        "url": url,
                        "category": category,
                        "detail": detail,
                    }
                )
        summary[f"{doctype}.{fieldname}"] = {"total": len(rows), **counts}

    total_broken = sum(
        v for row in summary.values()
        for k, v in row.items()
        if k in ("no_file_record", "physical_file_missing", "prefix_mismatch", "prefix_mismatch_latent")
    )

    return {
        "summary": summary,
        "total_broken": total_broken,
        # Capped so this stays readable if the count is large — see
        # summary above for the true per-field counts either way.
        "broken_examples": broken_examples[:200],
        "broken_examples_truncated": len(broken_examples) > 200,
    }


@frappe.whitelist()
def run_as_report():
    """Same as run(), gated for System Manager — for triggering this from
    the desk (Console block, or a custom button) instead of bench execute.
    """
    frappe.only_for("System Manager")
    return run()
