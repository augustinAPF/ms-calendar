import frappe
import json
from frappe.utils import get_datetime, nowdate, add_days, escape_html

# Field MeritTrac results are received by merit_trac.py (test_result_api ->
# process_field_result). This file no longer fetches or stores results — its
# old webhook (test_result_api / field_assessment_result_api) and the
# get-candidates-results pull (pull_pending_merittrac_results /
# trigger_merittrac_results_pull_on_finish) were removed 2026-10-08.

# ============================================================
# ✅ NEW CODE — Scheduled emails for Field Meritrac Test URL
# ============================================================
# Add this to your hooks.py scheduler_events:
#
#   scheduler_events = {
#       "daily": [
#           "your_app.your_module.field_merit_trac.send_meritrac_scheduled_emails"
#       ]
#   }
# ============================================================


def send_meritrac_scheduled_emails():
    """
    Runs daily via scheduler.
    Sends 3 emails based on days remaining until start_time:
      • 5 days before → Admit Card email
      • 3 days before → Instructions & System Check email
      • 1 day before  → Login Credentials email
    """
    today = nowdate()  # "YYYY-MM-DD"

    # Dates we care about: test is in 5, 3, or 1 day(s) from today
    target_dates = {
        5: "admit_card",
        3: "instructions",
        1: "login_credentials",
    }

    for days_before, email_type in target_dates.items():
        # The test date that, when today is subtracted, equals days_before
        test_date = add_days(today, days_before)  # today + days_before = test_date

        # Fetch all records whose start_time falls on that date
        records = frappe.get_all(
            "Field Meritrac Test URL",
            filters={
                "start_time": ["like", f"{test_date}%"]  # matches "YYYY-MM-DD HH:MM:SS"
            },
            fields=[
                "name",
                "applicant_id",
                "applicant_email",
                "applicant_name",
                "start_time",
                "end_time",
                "test_url",
            ],
        )

        for rec in records:
            try:
                _send_email_for_type(email_type, rec)
            except Exception as e:
                frappe.log_error(
                    title="MERITRAC_SCHEDULED_EMAIL_ERROR",
                    message=f"Email error ({email_type}) for {rec.get('name')}: {e}",
                )

    frappe.db.commit()


@frappe.whitelist()
def test_send_all_emails(record_name):
    """
    TEST ONLY — sends all 3 emails immediately for a given
    'Field Meritrac Test URL' record name, regardless of start_time.
    Remove / disable this after testing.
    """
    frappe.only_for("System Manager")
    rec = frappe.get_doc("Field Meritrac Test URL", record_name)

    # Format start_time as plain string "YYYY-MM-DD HH:MM:SS"
    if rec.start_time:
        from frappe.utils import get_datetime

        st = get_datetime(rec.start_time)
        start_time_str = st.strftime("%Y-%m-%d %H:%M:%S")
    else:
        start_time_str = ""

    rec_dict = {
        "name": rec.name,
        "applicant_id": rec.applicant_id,
        "applicant_email": rec.applicant_email,
        "applicant_name": rec.applicant_name,
        "start_time": start_time_str,
        "end_time": rec.end_time or "",
        "test_url": rec.test_url or "",
    }

    if not rec_dict["applicant_email"]:
        return ["ERROR: No applicant_email set on this record."]

    results = []
    for email_type in ["admit_card", "instructions", "login_credentials"]:
        try:
            _send_email_for_type(email_type, rec_dict, delayed=False)
            results.append(f"{email_type}: sent to {rec_dict['applicant_email']}")
        except Exception as e:
            frappe.log_error(
                title=f"TEST_EMAIL_{email_type.upper()}", message=frappe.get_traceback()
            )
            results.append(f"{email_type}: FAILED — {e}")

    frappe.db.commit()
    return results


def _send_email_for_type(email_type, rec, delayed=True):
    """Build and send the correct email template for the given record."""

    applicant_name = rec.get("applicant_name") or "Candidate"
    applicant_email = rec.get("applicant_email")

    if not applicant_email:
        return  # No email address — skip silently

    # Format start / end time for display
    # end_time is a Data field (plain text) — use as-is
    start_dt = get_datetime(rec.get("start_time")) if rec.get("start_time") else None

    start_str = start_dt.strftime("%I:%M %p") if start_dt else "TBD"
    test_date_str = start_dt.strftime("%A, %d %B %Y") if start_dt else "TBD"
    end_str = rec.get("end_time") or "TBD"
    test_url = rec.get("test_url") or "https://applicant.talent-next.com/auth/login"

    SENDER = "tech4socialsector@azimpremjifoundation.org"

    # ------------------------------------------------------------------
    # EMAIL 1 — Admit Card (5 days before)
    # ------------------------------------------------------------------
    if email_type == "admit_card":
        subject = (
            f"Admit Card – Written Test for School Teacher / Resource Person Position"
        )
        message = f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:20px;background:#ffffff;font-family:'Segoe UI',sans-serif;color:#333;line-height:1.6;">

<p>Dear {applicant_name},</p>

<p>Thank you for your application for the position of <strong>School Teacher / Resource Person</strong> at Azim Premji Foundation.</p>

<p>We are pleased to invite you to appear for the <strong>Computer-Based Written Test</strong> scheduled as part of our recruitment process.
Please treat this email as your official <strong>Admit Card</strong> for the test.</p>

<p><strong>Test Details:</strong><br>
Date: {test_date_str}<br>
Reporting Time: {start_str}<br>
Test Duration: {start_str} – {end_str}<br>
Position Applied For: School Teacher / Resource Person</p>

<p><strong>Important Instructions:</strong></p>
<ul>
  <li><strong>Eligibility:</strong> If you have already appeared for a test or interview with Azim Premji Foundation in the past one year,
  you are not eligible to reapply at this time. Kindly disregard this email in such cases.</li>
  <li><strong>Mode of Test:</strong> The test is to be taken remotely from your location and will be monitored through a virtual remote proctoring system.</li>
  <li><strong>System Requirements:</strong> You must take the test using a laptop or desktop only (tablets or mobile phones are not supported).</li>
  <li>Stable internet connection, Google Chrome / Mozilla Firefox / Microsoft Edge browser, a functional webcam and microphone, and required permissions enabled (camera and mic access).</li>
  <li>Headphones, earphones, mobile phones, calculators, or any other electronic gadgets are strictly prohibited. Use of such devices will lead to disqualification.</li>
</ul>

<p><strong>Test Platform Communication:</strong><br>
You will receive two emails from MeritTrac (our online test platform partner):<br>
• A preparatory email with test requirements (2–3 days before the test)<br>
• An email on the day of the test with your Login ID and Password<br>
Please check your inbox and SPAM folder carefully for both emails.</p>

<p><strong>System Compatibility Check:</strong><br>
To ensure your device is compatible with the test platform, please perform a system check:
<a href="https://systemcheck.talent-next.com">🔗 System Check – MeritTrac</a><br>
Request you to click "allow" the prompts of Microphone &amp; Camera required.</p>

<p>For any queries, feel free to write to us at:
<a href="mailto:recruitment@azimpremjifoundation.org">recruitment@azimpremjifoundation.org</a><br>
🌐 <a href="https://www.azimpremjifoundation.org">www.azimpremjifoundation.org</a></p>

<p>We look forward to your participation and wish you all the best!</p>

<p>Warm regards,<br>
<strong>Recruitment Team</strong><br>
Azim Premji Foundation</p>
</body>
</html>"""

    # ------------------------------------------------------------------
    # EMAIL 2 — Important Instructions & System Check (3 days before)
    # ------------------------------------------------------------------
    elif email_type == "instructions":
        subject = f"Important Instructions and System Check for Written Test on {test_date_str} – Azim Premji Foundation"
        message = f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:20px;background:#ffffff;font-family:'Segoe UI',sans-serif;color:#333;line-height:1.6;">

<p>Dear {applicant_name},</p>

<p>Greetings from Azim Premji Foundation!</p>

<p>This is in reference to your upcoming <strong>Computer-Based Written Test</strong> scheduled on <strong>{test_date_str}</strong>.
The exam will begin at <strong>{start_str}</strong> and end at <strong>{end_str}</strong>.
You are required to log in at least 30 minutes prior to the start time for verification and setup.</p>

<p>🔐 <strong>Test Login Details</strong><br>
You will receive your login credentials on the day of the test, before 2:00 PM.<br>
The email will be sent from: <strong>ams-notifications@merittrac.com</strong><br>
Please monitor your inbox and spam/junk folders for this email.</p>

<p>🛠️ <strong>System Requirements &amp; Compatibility Check</strong><br>
The test must be taken only on a desktop or laptop (tablets and mobile phones are not supported).<br>
Check your system compatibility: <a href="https://systemcheck.talent-next.com">🔗 System Check Tool</a><br>
The test platform requires access to your webcam and microphone. Please allow these permissions when prompted.</p>

<p>📄 <strong>Identification Requirement</strong><br>
You will need to present a valid government-issued photo ID for verification
(e.g., Aadhar Card, PAN Card, Voter ID, Passport, Driving License, etc.).</p>

<p>🔗 <strong>Test Portal Access</strong><br>
On the day of the test, use the following portal to log in:
<a href="{test_url}">🔗 Candidate Login Portal</a></p>

<p>📞 <strong>Technical Support</strong><br>
Contact Number: +91 7259365044<br>
Support Hours:<br>
• Day Before Test: 10:00 AM – 5:00 PM<br>
• Test Day: 2:00 PM – 5:00 PM<br>
When calling, please mention that you are appearing for the <strong>Azim Premji Foundation Computer Based Test</strong>.</p>

<p>📘 <strong>Additional Information</strong><br>
For further details about our selection process, please visit:<br>
🌐 <a href="https://azimpremjifoundation.org/opportunities/selection-process">https://azimpremjifoundation.org/opportunities/selection-process</a></p>

<p>We wish you the very best for your test. Please read all instructions carefully and ensure your system is ready well in advance.</p>

<p>Warm regards,<br>
<strong>Recruitment Team</strong><br>
Azim Premji Foundation</p>
</body>
</html>"""

    # ------------------------------------------------------------------
    # EMAIL 3 — Login Credentials (1 day before)
    # ------------------------------------------------------------------
    elif email_type == "login_credentials":
        subject = f"Login Credentials for Online Test – Azim Premji Foundation"
        message = f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:20px;background:#ffffff;font-family:'Segoe UI',sans-serif;color:#333;line-height:1.6;">

<p>Dear {applicant_name},</p>

<p>Greetings from Azim Premji Foundation!</p>

<p>You are invited to appear for the online assessment for the position of
<strong>School Teacher / Resource Person</strong> at Azim Premji Foundation.
Please find your login credentials and test details below:</p>

<p>🖥 <strong>Candidate Login Details:</strong><br>
Candidate Portal URL: <a href="{test_url}">{test_url}</a><br>
<em>Your Login ID and Password will be shared on the day of the test before 2:00 PM
from ams-notifications@merittrac.com</em></p>

<p>🕒 <strong>Test Schedule:</strong><br>
Test Date: {test_date_str}<br>
Test Window: {start_str} to {end_str}<br>
Please log in at least 15–30 minutes before the start time to avoid last-minute issues.</p>

<p>🔒 <strong>Important Instructions:</strong><br>
• The test must be taken on a laptop or desktop only. Mobile phones and tablets are not supported.<br>
• Ensure a quiet, well-lit space with uninterrupted power and internet connectivity.<br>
• Use Google Chrome, Microsoft Edge, or Mozilla Firefox (version 126 or above) for best performance.<br>
• Do not use mobile hotspots or USB tethering. Prefer broadband LAN/Wi-Fi or cable fibernet.<br>
• Allow access to your webcam and microphone when prompted.</p>

<p>✅ <strong>Minimum System Requirements:</strong><br>
Browser: Chrome / Firefox (v126 or above)<br>
OS: Windows 10 or higher<br>
Processor/RAM: Minimum 4 cores / 4 GB RAM<br>
Web Camera: 640x480 resolution, 15 fps<br>
Microphone: Inbuilt (preferred)<br>
Screen Resolution: 1024 x 768 or higher<br>
Internet Speed: Minimum 2 Mbps (broadband recommended)<br>
System check: <a href="https://systemcheck.talent-next.com">https://systemcheck.talent-next.com</a></p>

<p>📞 <strong>Technical Support:</strong><br>
Contact Number: +91 7259365044<br>
Availability on Test Day: 2:00 PM – 5:00 PM<br>
When contacting support, please mention that you are appearing for the <strong>Azim Premji Foundation online test</strong>.</p>

<p>We hope you've completed the system check and are fully prepared. Wishing you the very best for your test!</p>

<p>Warm regards,<br>
<strong>Recruitment Team</strong><br>
Azim Premji Foundation</p>
</body>
</html>"""

    else:
        return  # Unknown type — skip

    # ------------------------------------------------------------------
    # Send the email
    # ------------------------------------------------------------------
    frappe.sendmail(
        sender=SENDER,
        recipients=[applicant_email],
        subject=subject,
        message=message,
        delayed=delayed,
        reference_doctype="Field Meritrac Test URL",
        reference_name=rec.get("name"),
    )


# ============================================================
# ✅ Save MeritTrac tickets — called from list view JS after
#    the browser receives the API 2 response.
# ============================================================


@frappe.whitelist()
def save_field_merittrac_tickets(
    tickets, start_datetime, end_datetime, applicant_ids=None, test_date=None
):
    """
    1. Saves a Field MeritTrac Test Creation Log record.
    2. Inserts one "Field Meritrac Test URL" record per ticket.

    tickets        : JSON string — list of {candidate_id, attemptId, lpurl}
    start_datetime : "YYYY-MM-DD HH:mm:ss"  (Datetime field)
    end_datetime   : display string          (Data field)
    applicant_ids  : JSON string of candidate id list (for creation log)
    test_date      : "YYYY-MM-DD"            (for creation log)
    """
    if not frappe.has_permission("Field Registration Form", "write"):
        frappe.throw(
            "You don't have permission to send MeritTrac test tickets.",
            frappe.PermissionError,
        )

    import json as _json

    if isinstance(tickets, str):
        tickets = _json.loads(tickets)

    # ── 1. Save creation log ─────────────────────────────────────────
    try:
        log = frappe.get_doc(
            {
                "doctype": "Field MeritTrac Test Creation Log",
                "test_date": test_date or nowdate(),
                "start_datetime": start_datetime,
                "end_datetime": end_datetime,
                "applicant_ids": applicant_ids or "[]",
            }
        )
        log.insert(ignore_permissions=True)
    except Exception as e:
        frappe.log_error(
            title="FIELD_MERITTRAC_LOG_ERROR",
            message=f"Creation log insert failed: {e}",
        )

    # ── 2. Save ticket records + send admit card email immediately ───────
    # Hardcoded rather than existence-detected: a stale, orphaned "Field
    # Registration Form1" doctype coexists with the real one on some sites.
    _frf_doctype = "Field Registration Form"

    today = nowdate()
    saved = []

    for row in tickets:
        candidate_id = row.get("candidate_id") or row.get("candidateId")
        if not candidate_id:
            continue

        # Look up applicant name and email
        applicant_info = (
            frappe.db.get_value(
                _frf_doctype,
                candidate_id,
                ["full_name_aadhaar", "email_address"],
                as_dict=True,
            )
            or {}
        )

        applicant_name = applicant_info.get("full_name_aadhaar") or "Candidate"
        applicant_email = applicant_info.get("email_address") or ""

        doc = frappe.get_doc(
            {
                "doctype": "Field Meritrac Test URL",
                "applicant_id": candidate_id,
                "applicant_name": applicant_name,
                "applicant_email": applicant_email,
                "attempt_id": row.get("attemptId"),
                "test_url": row.get("lpurl"),
                "current_date": today,
                "start_time": start_datetime,
                "end_time": end_datetime,
            }
        )
        doc.insert(ignore_permissions=True)
        saved.append(doc.name)

        # Send admit card email immediately on save
        if applicant_email:
            try:
                rec_dict = {
                    "name": doc.name,
                    "applicant_id": candidate_id,
                    "applicant_name": applicant_name,
                    "applicant_email": applicant_email,
                    "start_time": start_datetime,
                    "end_time": end_datetime,
                    "test_url": row.get("lpurl") or "",
                }
                _send_email_for_type("admit_card", rec_dict, delayed=False)
            except Exception as e:
                frappe.log_error(
                    title="FIELD_MERITTRAC_ADMIT_CARD_ERROR",
                    message=f"Admit card email failed for {candidate_id}: {e}",
                )

    frappe.db.commit()
    return {"saved": len(saved), "names": saved}


# ---------------------------------------------------------------------------
# MeritTrac — backend proxy for online test initiation
# ---------------------------------------------------------------------------
import frappe

# MeritTrac's servers occasionally take longer than a single 30s window to
# respond to get-landing-page-url / get-assessment-tickets (observed: a
# ReadTimeout on initiate_merittrac_online_test during real usage, even
# though the endpoint itself responds quickly to ordinary requests — i.e.
# vendor-side slowness under real load, not a connectivity problem here).
# A bare timeout crash gives the recruiter no idea whether the test was
# actually created on MeritTrac's side, so both proxy calls now get a longer
# timeout plus a couple of short retries before failing with a clear message.
_MERITTRAC_TIMEOUT = 45
_MERITTRAC_RETRIES = 2
_MERITTRAC_RETRY_BACKOFF = 3


def _merittrac_post_with_retry(url, headers, payload):
    import time
    import requests as _req

    last_exc = None
    for attempt in range(_MERITTRAC_RETRIES + 1):
        try:
            return _req.post(
                url, headers=headers, json=payload, timeout=_MERITTRAC_TIMEOUT
            )
        except (_req.exceptions.ReadTimeout, _req.exceptions.ConnectionError) as exc:
            last_exc = exc
            frappe.log_error(
                title="MERITTRAC_API_RETRY",
                message=(
                    f"Attempt {attempt + 1}/{_MERITTRAC_RETRIES + 1} failed "
                    f"for {url}: {exc}"
                ),
            )
            if attempt < _MERITTRAC_RETRIES:
                time.sleep(_MERITTRAC_RETRY_BACKOFF * (attempt + 1))
    raise last_exc


@frappe.whitelist()
def initiate_merittrac_online_test(
    candidate_ids, assessment_number, start_utc, end_utc, enable_rp=0
):
    """
    Proxy for MeritTrac API 1 — POST /hrms/get-landing-page-url.
    Runs server-side so credentials never leave the backend and CORS is not an issue.
    """
    import json as _json
    import requests as _req

    if isinstance(candidate_ids, str):
        candidate_ids = _json.loads(candidate_ids)

    cred = frappe.get_doc("MeritTrac Credentials")

    payload = {
        "assessmentNumber": assessment_number,
        "candidateId": candidate_ids,
        "returnUrl": "https://careers.frappe.cloud/assessment-finished-field",
        "enableRP": bool(int(enable_rp)),
        "startDate": start_utc,
        "endDate": end_utc,
    }

    headers = {
        "partnerid": cred.merittrac_partner_id,
        "secretkey": cred.merittrac_secret_key,
        "Content-Type": "application/json",
    }

    try:
        resp = _merittrac_post_with_retry(
            "https://www.talent-next.com/hrms/get-landing-page-url", headers, payload
        )
    except (_req.exceptions.ReadTimeout, _req.exceptions.ConnectionError) as exc:
        frappe.log_error(
            title="MERITTRAC_API_1_TIMEOUT",
            message=f"Gave up after {_MERITTRAC_RETRIES + 1} attempts: {exc}",
        )
        frappe.throw(
            "MeritTrac did not respond in time after multiple attempts. "
            "This is usually a temporary issue on their end — please try "
            "Initiate Test again in a minute. If it keeps failing, check "
            "with MeritTrac support before retrying, since a test may "
            "already have been created on their side.",
            title="MeritTrac API 1 Timed Out",
        )

    frappe.log_error(
        title="MERITTRAC_API_1",
        message=f"MeritTrac API-1 | status={resp.status_code} | body={resp.text[:800]}",
    )

    if not resp.ok:
        frappe.throw(
            f"MeritTrac API error ({resp.status_code}): {resp.text[:300]}",
            title="MeritTrac API 1 Failed",
        )

    return resp.json()


@frappe.whitelist()
def get_merittrac_tickets(candidate_ids, start_utc, end_utc):
    """
    Proxy for MeritTrac API 2 — POST /hrms/get-assessment-tickets.
    Returns ticket data (attemptId, lpurl, candidate_id) for each candidate.
    """
    import json as _json
    import requests as _req

    if isinstance(candidate_ids, str):
        candidate_ids = _json.loads(candidate_ids)

    cred = frappe.get_doc("MeritTrac Credentials")

    payload = {
        "candidateIds": candidate_ids,
        "startDate": start_utc,
        "endDate": end_utc,
    }

    headers = {
        "partnerid": cred.merittrac_partner_id,
        "secretkey": cred.merittrac_secret_key,
        "Content-Type": "application/json",
    }

    try:
        resp = _merittrac_post_with_retry(
            "https://www.talent-next.com/hrms/get-assessment-tickets",
            headers,
            payload,
        )
    except (_req.exceptions.ReadTimeout, _req.exceptions.ConnectionError) as exc:
        frappe.log_error(
            title="MERITTRAC_API_2_TIMEOUT",
            message=f"Gave up after {_MERITTRAC_RETRIES + 1} attempts: {exc}",
        )
        frappe.throw(
            "MeritTrac did not respond in time after multiple attempts while "
            "fetching test tickets. Please try again in a minute.",
            title="MeritTrac API 2 Timed Out",
        )

    frappe.log_error(
        title="MERITTRAC_API_2",
        message=f"MeritTrac API-2 | status={resp.status_code} | body={resp.text[:800]}",
    )

    if not resp.ok:
        frappe.throw(
            f"MeritTrac Tickets API error ({resp.status_code}): {resp.text[:300]}",
            title="MeritTrac API 2 Failed",
        )

    return resp.json()


@frappe.whitelist()
def save_field_meritrac_test_urls(tickets, assessment_id, start_time, end_time):
    """
    Bulk-saves one "Field Meritrac Test URL" per MeritTrac ticket, for the
    Initiate Test dialog (frf_list.js).

    Replaces the dialog's old per-candidate loop (one frappe.db.get_value +
    one frappe.client.insert request EACH — ~1000 browser round-trips for a
    500-candidate batch, slow and liable to hit the site's rate limit
    partway through, after MeritTrac had already created the tests). Here
    it's one request: applicant details fetched in a single query, all rows
    inserted, one commit.

    Safe to call again with the same tickets — a candidate already saved for
    this same test + start time is skipped, not duplicated. A row that fails to insert doesn't
    stop the rest; it's logged and returned in `failed`.

    tickets    : JSON list of {candidate_id|candidateId, attemptId|attempt_id, lpurl|url}
    start_time / end_time : display strings ("DD MMM YYYY hh:mm A")
    """
    import json as _json

    if not frappe.has_permission("Field Meritrac Test URL", "create"):
        frappe.throw(
            "You don't have permission to save MeritTrac test URLs.",
            frappe.PermissionError,
        )

    if isinstance(tickets, str):
        tickets = _json.loads(tickets)

    rows = []
    for t in tickets or []:
        cid = t.get("candidate_id") or t.get("candidateId")
        if cid:
            rows.append(
                {
                    "candidate_id": cid,
                    "attempt_id": t.get("attemptId") or t.get("attempt_id") or "",
                    "test_url": t.get("lpurl") or t.get("url") or "",
                }
            )
    if not rows:
        return {"saved": 0, "skipped_existing": 0, "failed": []}

    candidate_ids = list({r["candidate_id"] for r in rows})
    info_by_id = {
        f.name: f
        for f in frappe.get_all(
            "Field Registration Form",
            filters={"name": ["in", candidate_ids]},
            fields=["name", "full_name_aadhaar", "email_address", "role", "written_subject"],
            limit_page_length=0,
        )
    }

    # Duplicate check keys on (applicant, test, start time), NOT attempt_id:
    # on both ms.local and the cloud site, attempt_id's field definition has
    # fetch_from = applicant_id.full_name_aadhaar (confirmed 2026-09-29 —
    # every existing row's attempt_id is the candidate's name), so whatever
    # attempt_id is passed in gets overwritten on insert and can't be
    # matched on afterwards.
    existing = set(
        (e.applicant_id, e.assessment_id, e.start_time)
        for e in frappe.get_all(
            "Field Meritrac Test URL",
            filters={
                "applicant_id": ["in", candidate_ids],
                "assessment_id": assessment_id,
                "start_time": start_time,
            },
            fields=["applicant_id", "assessment_id", "start_time"],
            limit_page_length=0,
        )
    )

    today = nowdate()
    saved, skipped_existing, failed = 0, 0, []
    for r in rows:
        dedupe_key = (r["candidate_id"], assessment_id, start_time)
        if dedupe_key in existing:
            skipped_existing += 1
            continue
        info = info_by_id.get(r["candidate_id"]) or {}
        frappe.db.savepoint("fmt_url_row")
        try:
            frappe.get_doc(
                {
                    "doctype": "Field Meritrac Test URL",
                    "applicant_id": r["candidate_id"],
                    "applicant_name": info.get("full_name_aadhaar") or "",
                    "applicant_email": info.get("email_address") or "",
                    "applicant_role": info.get("role") or "",
                    "subject": info.get("written_subject") or "",
                    "attempt_id": r["attempt_id"],
                    "assessment_id": assessment_id,
                    "test_url": r["test_url"],
                    "current_date": today,
                    "start_time": start_time,
                    "end_time": end_time,
                }
            ).insert()
            saved += 1
            existing.add(dedupe_key)
        except Exception as e:
            frappe.db.rollback(save_point="fmt_url_row")
            failed.append({"candidate_id": r["candidate_id"], "error": str(e)[:200]})
            frappe.log_error(
                title="FIELD_MERITTRAC_TEST_URL_SAVE_ERROR",
                message=f"{r['candidate_id']} / {assessment_id}: {frappe.get_traceback()}",
            )

    frappe.db.commit()
    return {"saved": saved, "skipped_existing": skipped_existing, "failed": failed}


# ---------------------------------------------------------------------------
# Email the subject's evaluator when a Field MeritTrac result arrives
# ---------------------------------------------------------------------------
# Some subjects (Music, Physical Education, Visual Art, Special Education,
# ...) can't be judged on the MeritTrac score alone — Question Paper Master's
# evaluator_email marks the question papers whose written answers must be
# reviewed by a named evaluator. hooks.py fires this after_insert of every
# "Field MeritTrac Test Result" (inserted by merit_trac.py's
# process_field_result when MeritTrac posts a result).
_EVALUATOR_EMAIL_SENDER = (
    "Field Recruitment Azim Premji Foundation "
    "<field.recruitment@azimpremjifoundation.org>"
)

# Web Form (cloud: "evaluator-marks-form") where the evaluator enters the
# question-wise marks + Select/Regret into "Field Evaluator Marks". Any
# fieldname passed as a query param is pre-filled by the web form.
_EVALUATOR_MARKS_FORM_ROUTE = "/field-evaluator-marks/new"


def on_field_merittrac_result_insert(doc, method=None):
    # enqueue_after_commit: only email for results that were actually saved
    # (merit_trac.py rolls back on errors). PDF + send is done off the
    # request. The job runs as whoever inserted the result — Guest for
    # MeritTrac's webhook — so it calls the unchecked _send_result_to_evaluator,
    # not the System Manager-only whitelisted wrapper.
    frappe.enqueue(
        "ms_calendar.api.field_merit_trac._send_result_to_evaluator",
        queue="short",
        enqueue_after_commit=True,
        result_name=doc.name,
    )


def _normalize_subject(subject):
    # Master has e.g. "Primary  Kannada" (double space).
    return " ".join((subject or "").lower().split())


def _get_evaluator_qp_row(applicant_id):
    """Question Paper Master row (with an evaluator_email) for the test this
    applicant was sent, or None.

    Field MeritTrac Test Result.assessment_id is MeritTrac's internal UUID,
    not the SA code the master is keyed on — the SA code and the candidate's
    subject come from the applicant's "Field Meritrac Test URL" instead.
    """
    test_url = frappe.get_all(
        "Field Meritrac Test URL",
        filters={"applicant_id": applicant_id},
        fields=["assessment_id", "subject"],
        order_by="creation desc",
        limit=1,
    )
    if not test_url or not test_url[0].assessment_id:
        return None
    sa_code = test_url[0].assessment_id
    subject = test_url[0].subject or frappe.db.get_value(
        "Field Registration Form", applicant_id, "written_subject"
    )

    qp_rows = frappe.get_all(
        "Question Paper Master",
        or_filters={"qp_hindi_english": sa_code, "qp_kannada_english": sa_code},
        fields=["test_subject", "evaluator_name", "evaluator_email"],
        limit_page_length=0,
    )

    # One SA code can be shared by several subjects (SA08005 is both
    # Secondary/High School English and Sr.Secondary/PU English) with
    # different evaluators, so the candidate's own subject decides.
    same_subject = [
        r for r in qp_rows
        if _normalize_subject(r.test_subject) == _normalize_subject(subject)
    ]
    if same_subject:
        row = same_subject[0] if same_subject[0].evaluator_email else None
    else:
        # Subject didn't match any row (blank / overridden subject): only
        # safe if every row for this paper points to the same evaluator.
        with_evaluator = [r for r in qp_rows if r.evaluator_email]
        row = (
            with_evaluator[0]
            if len({r.evaluator_email for r in with_evaluator}) == 1
            else None
        )

    if row:
        # The SA code the candidate actually sat — pre-filled on the marks
        # form (a master row can hold both a Hindi and a Kannada code).
        row.sa_code = sa_code
    return row


def _build_test_paper_pdf(result, test_subject, test_date):
    from frappe.utils.html_utils import sanitize_html
    from frappe.utils.pdf import get_pdf

    # MeritTrac may send answers as HTML (rich-text editor) or plain text —
    # sanitize keeps formatting but drops scripts; pre-wrap keeps plain
    # text's line breaks.
    answers = "".join(
        f"""
        <div style="margin-bottom:18px; page-break-inside:avoid;">
            <p style="font-weight:bold; margin:0 0 6px 0;">Q{i}.</p>
            <div style="margin:0 0 8px 0; white-space:pre-wrap;">{sanitize_html(row.question_text or "")}</div>
            <p style="font-weight:bold; margin:0 0 6px 0;">Candidate's Answer:</p>
            <div style="border:1px solid #ccc; padding:8px; white-space:pre-wrap;">{sanitize_html(row.candidate_response or "") or "<i>Not answered</i>"}</div>
        </div>
        """
        for i, row in enumerate(result.descriptive_responses or [], start=1)
    ) or "<p><i>No written answers were recorded for this test.</i></p>"

    html = f"""
        <div style="font-family:Arial, sans-serif; font-size:12px; color:#222;">
            <h2 style="margin:0 0 12px 0;">{escape_html(test_subject)} — Test Paper</h2>
            <table style="border-collapse:collapse; margin-bottom:20px;">
                <tr><td style="padding:3px 12px 3px 0;"><b>Applicant ID</b></td><td>{escape_html(result.applicant_id or "")}</td></tr>
                <tr><td style="padding:3px 12px 3px 0;"><b>Applicant Name</b></td><td>{escape_html(result.applicant_name or "")}</td></tr>
                <tr><td style="padding:3px 12px 3px 0;"><b>Test Date</b></td><td>{escape_html(test_date)}</td></tr>
            </table>
            {answers}
        </div>
    """
    return get_pdf(html)


@frappe.whitelist()
def send_result_to_evaluator(result_name):
    """Email the result's written answers (as a PDF) to the evaluator set on
    its Question Paper Master row. No-op if that row has no evaluator.

    Whitelisted (System Manager) so a result can be re-sent by hand:
    frappe.call("ms_calendar.api.field_merit_trac.send_result_to_evaluator",
    {result_name: "FAPMTR-0001"})
    """
    frappe.only_for("System Manager")
    return _send_result_to_evaluator(result_name)


def _send_result_to_evaluator(result_name):
    result = frappe.get_doc("Field MeritTrac Test Result", result_name)
    qp_row = _get_evaluator_qp_row(result.applicant_id)
    if not qp_row:
        return {"sent": False, "reason": "No evaluator for this question paper"}

    try:
        from urllib.parse import quote, urlencode

        test_datetime = get_datetime(result.created_at or result.creation)
        test_date = test_datetime.strftime("%d %B %Y")
        test_subject = qp_row.test_subject
        evaluator_name = qp_row.evaluator_name or "Evaluator"

        # quote (not urlencode's default quote_plus): the web form reads
        # these with decodeURIComponent, which would leave "+" for spaces.
        marks_form_url = (
            frappe.utils.get_url(_EVALUATOR_MARKS_FORM_ROUTE)
            + "?"
            + urlencode(
                {
                    "applicant_id": result.applicant_id or "",
                    "applicant_name": result.applicant_name or "",
                    "test_subject": test_subject or "",
                    "question_paper": qp_row.sa_code or "",
                    "test_date": test_datetime.strftime("%Y-%m-%d"),
                    "evaluator_name": qp_row.evaluator_name or "",
                    "evaluator_email": qp_row.evaluator_email or "",
                },
                quote_via=quote,
            )
        )

        message = f"""
            <p>Dear {escape_html(evaluator_name)},</p>
            <p>Please find attached the {escape_html(test_subject)} test papers for evaluation. The written test was conducted on {test_date}. Kindly evaluate the test papers and update the marks in the portal and Select or Reject from the dropdown provided.</p>
            <p style="margin:20px 0;">
                <a href="{escape_html(marks_form_url)}" style="background:#2490ef; color:#ffffff; padding:10px 18px; border-radius:6px; text-decoration:none; font-weight:bold;">Enter Marks</a>
            </p>
            <p style="font-size:12px; color:#666;">If the button doesn't open, copy this link into your browser:<br>{escape_html(marks_form_url)}</p>
            <p>If you have any additional feedback/comments about the candidate, please write the comments section provided in the portal.</p>
            <p>Warm Regards,<br>Recruitment Team<br>Azim Premji Foundation</p>
        """

        frappe.sendmail(
            sender=_EVALUATOR_EMAIL_SENDER,
            recipients=[qp_row.evaluator_email],
            subject=f"{test_subject} Test Paper for Evaluation – {result.applicant_id}",
            message=message,
            attachments=[
                {
                    "fname": f"{result.applicant_id} - {test_subject} Test Paper.pdf".replace("/", "-"),
                    "fcontent": _build_test_paper_pdf(result, test_subject, test_date),
                }
            ],
            reference_doctype="Field MeritTrac Test Result",
            reference_name=result.name,
        )
    except Exception:
        frappe.log_error(
            title="FIELD_MERITTRAC_EVALUATOR_EMAIL_ERROR",
            message=f"{result_name}: {frappe.get_traceback()}",
        )
        raise

    return {"sent": True, "evaluator_email": qp_row.evaluator_email}


# ---------------------------------------------------------------------------
# Auto-suggest the Field Meritrac Assessment matching a candidate's subject
# ---------------------------------------------------------------------------

# "written_subject" values on Field Registration Form are "<Level> <Subject>"
# (e.g. "Secondary/High School Political Science"); assessment_set values on
# Field Meritrac Assessment mix level/subject/language in free text, so we
# match on word overlap rather than an exact string.
_WRITTEN_SUBJECT_LEVEL_PREFIXES = [
    "Sr.Secondary/PU Lecturer",
    "Secondary/High School",
    "Upper Primary",
    "Primary",
]

_ASSESSMENT_TOKEN_STOPWORDS = {"foundation", "azim", "premji", "set"}

# Field Role (candidate) -> Field Meritrac Assessment.role values it can match.
# Ordered by preference (e.g. latest Associates batch first) for tie-breaking.
_CANDIDATE_ROLE_TO_ASSESSMENT_ROLES = {
    "School Teacher": ["School Teacher"],
    "Resource Person": ["Resource Person"],
    "Associate Resource Person": [
        "Associates | 2024",
        "Associates | 2022",
        "Associates | 2020",
    ],
}


def _tokenize(text):
    import re

    words = re.findall(r"[a-zA-Z]+", (text or "").lower())
    return {w for w in words if w not in _ASSESSMENT_TOKEN_STOPWORDS and len(w) > 1}


def _split_written_subject(written_subject):
    written_subject = (written_subject or "").strip()
    for prefix in _WRITTEN_SUBJECT_LEVEL_PREFIXES:
        if written_subject.lower().startswith(prefix.lower()):
            remainder = written_subject[len(prefix):].strip()
            return prefix, (remainder or written_subject)
    return "", written_subject


@frappe.whitelist()
def suggest_meritrac_assessment(candidate_ids):
    """
    Best-effort auto-match for the "Initiate Test" dialog's Assignment ID field.

    Only suggests a match when every selected candidate shares the same role
    and written_subject (a mixed batch is left for manual selection, since one
    Assignment ID applies to the whole batch). The match itself is a word
    overlap between the candidate's written_subject and each Field Meritrac
    Assessment's assessment_set text, scoped to assessment records whose role
    corresponds to the candidate's role where that mapping is known.

    Always a suggestion, never authoritative — the caller keeps the field
    editable so a recruiter can override it.
    """
    if isinstance(candidate_ids, str):
        candidate_ids = json.loads(candidate_ids)

    if not candidate_ids:
        return {"matched": False, "reason": "no_candidates"}

    rows = frappe.get_all(
        "Field Registration Form",
        filters={"name": ["in", candidate_ids]},
        fields=["name", "role", "written_subject"],
    )

    subjects = {r.written_subject for r in rows if r.written_subject}
    if len(subjects) != 1:
        return {"matched": False, "reason": "mixed_or_missing_subject"}
    written_subject = subjects.pop()

    # Strip region suffixes ("School Teacher - Barmer" -> "School Teacher")
    # before comparing — every key in the role-map table above is the bare
    # category, so a suffixed role missed all of them and the scorer
    # searched every role's tests unfiltered (e.g. a "Resource Person -
    # Rajasthan" batch tied onto an unrelated ARP test).
    roles = {r.role.split(" - ")[0].strip() for r in rows if r.role}
    role = roles.pop() if len(roles) == 1 else None

    level, subject_text = _split_written_subject(written_subject)
    subject_tokens = _tokenize(subject_text)
    level_tokens = _tokenize(level)
    wanted_tokens = subject_tokens | level_tokens

    assessment_filters = {}
    preferred_roles = _CANDIDATE_ROLE_TO_ASSESSMENT_ROLES.get(role)
    if preferred_roles:
        assessment_filters["role"] = ["in", preferred_roles]

    records = frappe.get_all(
        "Field Meritrac Assessment",
        filters=assessment_filters,
        fields=["name", "assessment_set", "role"],
    )
    if not records:
        return {"matched": False, "reason": "no_assessments_for_role"}

    role_rank = {r: i for i, r in enumerate(preferred_roles)} if preferred_roles else {}

    # Score = 2x per matched subject word + 1x per matched level word, minus
    # 1x per *unrelated* word the assessment_set carries. The subject-word
    # requirement and the penalty both matter: without them, a generic level
    # word like "primary" ties every Primary-level record regardless of
    # subject, and a loose subject match (e.g. "Hindi") ties every
    # "Hindi <anything>" record instead of preferring the bare "Hindi" one.
    scored = []
    for rec in records:
        rec_tokens = _tokenize(rec.assessment_set)
        subject_overlap = len(rec_tokens & subject_tokens)
        if not subject_overlap:
            continue
        level_overlap = len(rec_tokens & level_tokens)
        extra = len(rec_tokens - wanted_tokens)
        score = 2 * subject_overlap + level_overlap - extra
        scored.append((score, -role_rank.get(rec.role, 0), rec))

    if not scored:
        return {"matched": False, "reason": "no_token_overlap"}

    scored.sort(key=lambda triple: (triple[0], triple[1]), reverse=True)
    top_score = scored[0][0]
    top_matches = [rec for score, _, rec in scored if score == top_score]

    best = top_matches[0]
    return {
        "matched": True,
        "assessment": best.name,
        "assessment_set": best.assessment_set,
        "ambiguous": len(top_matches) > 1,
        "alternatives": [
            {"name": m.name, "assessment_set": m.assessment_set}
            for m in top_matches[1:]
        ],
    }


# testing
