import frappe
import json
from frappe.utils import get_datetime, nowdate, add_days
from datetime import datetime, timedelta


# ============================================================
# ✅ EXISTING CODE — DO NOT TOUCH (test result webhook API)
# ============================================================


@frappe.whitelist(allow_guest=True)
def test_result_api():
    try:
        # ------------------------------------------------------------
        # 1️⃣ API KEY VALIDATION (robust)
        # ------------------------------------------------------------
        def get_request_header(name):
            try:
                headers = {
                    k.lower(): v for k, v in (frappe.request.headers or {}).items()
                }
                if name.lower() in headers:
                    return headers[name.lower()]
            except Exception:
                pass
            env_key = "HTTP_" + name.upper().replace("-", "_")
            return frappe.request.environ.get(env_key)

        api_key = get_request_header("Patner-key")
        EXPECTED_KEY = "ToNnhB5chOh23fWz"
        if not api_key or api_key != EXPECTED_KEY:
            frappe.local.response.http_status_code = 401
            return {
                "status": "error",
                "http_status": 401,
                "message": "Unauthorized: Invalid Patner Key",
            }

        # ------------------------------------------------------------
        # 2️⃣ READ JSON BODY
        # ----------------------------------------------------------
        raw = frappe.request.data
        frappe.log_error(message=f"RAW BODY: {raw}", title="FIELD_MERIT_TRAC_DEBUG")
        if not raw:
            frappe.local.response.http_status_code = 400
            return {
                "status": "error",
                "http_status": 400,
                "message": "Empty request body",
            }

        try:
            payload = json.loads(raw)
        except Exception:
            frappe.local.response.http_status_code = 400
            return {
                "status": "error",
                "http_status": 400,
                "message": "Invalid JSON body",
            }

        frappe.log_error(
            message=f"FULL PAYLOAD: {payload}", title="FIELD_MERIT_TRAC_PAYLOAD"
        )

        # ------------------------------------------------------------
        # 3️⃣ Accept either top-level object or {"data": {...}}
        # ------------------------------------------------------------
        if (
            isinstance(payload, dict)
            and "data" in payload
            and isinstance(payload.get("data"), dict)
        ):
            item = payload.get("data")
        elif isinstance(payload, dict) and payload.get("candidateId"):
            item = payload
        else:
            frappe.local.response.http_status_code = 400
            return {
                "status": "error",
                "http_status": 400,
                "message": "Request must be a JSON object with candidateId (either top-level or inside 'data')",
            }

        frappe.log_error(message=f"ITEM: {item}", title="FIELD_MERIT_TRAC_ITEM")

        # ------------------------------------------------------------
        # 4️⃣ field extractor + datetime helper
        # ------------------------------------------------------------
        def fix_datetime(dt):
            if not dt:
                return None
            try:
                return get_datetime(dt).strftime("%Y-%m-%d %H:%M:%S")
            except:
                return None

        candidate_id = item.get("candidateId")
        percentage = item.get("overAllPercentageScore")
        attempt_id = item.get("attemptId")
        assessment_id = item.get("assessmentId")
        attempt_status = item.get("attempt_status")
        report_url = item.get("TnReport")
        score = item.get("score")
        max_score = item.get("maxScore")
        total_questions = item.get("totalQuestion")
        total_attempted = item.get("totalAttempted")
        user_img_key = item.get("userImgKey")
        id_img_key = item.get("idImgKey")
        credit_score = item.get("creditScore")
        proctor_comment = item.get("proctorComment")
        section_wise_score = item.get("sectionWiseScore") or []
        descriptive_response = item.get("descriptiveResponse") or []
        updated_at = fix_datetime(item.get("updatedAt"))
        created_at = fix_datetime(item.get("createdAt"))

        frappe.log_error(
            message=(
                f"sectionWiseScore ({len(section_wise_score)} rows): {section_wise_score}\n\n"
                f"descriptiveResponse ({len(descriptive_response)} rows): {descriptive_response}"
            ),
            title="FIELD_MERIT_TRAC_SECTIONS",
        )

        if not candidate_id:
            frappe.local.response.http_status_code = 400
            return {
                "status": "error",
                "http_status": 400,
                "message": "candidateId missing",
            }

        # ------------------------------------------------------------
        # 5️⃣ Detect registration form doctype (local vs cloud)
        # ------------------------------------------------------------
        _frf_doctype = (
            "Field Registration Form1"
            if frappe.db.exists("DocType", "Field Registration Form1")
            else "Field Registration Form"
        )

        # Look up applicant name
        _applicant_name = (
            frappe.db.get_value(_frf_doctype, candidate_id, "full_name_aadhaar") or ""
        )

        # ------------------------------------------------------------
        # 6️⃣ INSERT Field MeritTrac Test Result
        # ------------------------------------------------------------
        test_doc = frappe.get_doc(
            {
                "doctype": "Field MeritTrac Test Result",
                "applicant_id": candidate_id,
                "applicant_name": _applicant_name,
                "score_percentile": percentage,
                "overall_percentage_score": percentage,
                "attempt_id": attempt_id,
                "assessment_id": assessment_id,
                "attempt_status": attempt_status,
                "score_report": report_url,
                "tn_report": report_url,
                "total_score": score,
                "max_score": max_score,
                "total_questions": total_questions,
                "total_attempted": total_attempted,
                "user_img_key": user_img_key,
                "id_img_key": id_img_key,
                "credit_score": credit_score,
                "proctor_comment": proctor_comment,
                "updated_at": updated_at,
                "created_at": created_at,
                "section_wise_score": [
                    {
                        "section_name": section.get("name"),
                        "score": section.get("score"),
                        "max_score": section.get("maxScore"),
                    }
                    for section in section_wise_score
                ],
                "descriptive_response": [
                    {
                        "question_text": resp.get("questionText"),
                        "candidate_response": resp.get("candidateResponse"),
                    }
                    for resp in descriptive_response
                ],
            }
        )
        test_doc.insert(ignore_permissions=True, ignore_links=True)

        # ------------------------------------------------------------
        # 7️⃣ UPDATE Field Registration Form
        # ------------------------------------------------------------
        srf = frappe.db.get_value(
            _frf_doctype,
            {"name": candidate_id},
            ["name", "full_name_aadhaar", "email_address", "srt_mail"],
            as_dict=True,
        )

        if not srf:
            frappe.db.commit()
            frappe.local.response.http_status_code = 200
            return {
                "status": 200,
                "http_status": 200,
                "message": "Data inserted (No SRF found for candidate)",
                "data": [],
            }

        try:
            passed = percentage is not None and float(percentage) >= 50
        except:
            passed = False
        status = "Round One" if passed else "Test Reject"

        srf_name = srf.get("name")
        srf_doc = frappe.get_doc(_frf_doctype, srf_name)
        srf_doc.application_status = status
        srf_doc.save(ignore_permissions=True)

        applicant_name = srf.get("full_name_aadhaar") or "Applicant"
        applicant_email = srf.get("email_address")
        SenderEmail = (
            srf.get("srt_mail")
            if srf.get("srt_mail")
            else "tech4socialsector@azimpremjifoundation.org"
        )

        # ------------------------------------------------------------
        # 7️⃣ EMAIL TEMPLATES
        # ------------------------------------------------------------
        fail_email_html = f"""
            <!DOCTYPE html>
            <html>
            <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="margin:0; padding:20px; background:#ffffff; font-family:'Segoe UI', sans-serif; color:#333; line-height:1.6;">
            <p style="font-size:16px; margin:0 0 20px 0;">Dear {applicant_name},</p>
            <p style="font-size:16px; margin:0 0 20px 0;">
            Thank you for your interest in the opportunities with the Azim Premji Scholarship Initiative.
            We appreciate the time and effort you have invested in exploring an opportunity with us.
            </p>
            <p style="font-size:16px; margin:0 0 20px 0;">
            After careful consideration of your candidature, unfortunately, we will not be able to
            take your application forward at this point of time.
            </p>
            <p style="font-size:16px; margin:0 0 25px 0;">
            We would like to thank you for your time, and we wish you the very best!
            </p>
            <p style="font-size:16px; margin:0 0 40px 0;">
            Regards,<br>People Function<br>Azim Premji Foundation
            </p>
            </body>
            </html>
        """

        # ------------------------------------------------------------
        # 8️⃣ SEND EMAILS
        # ------------------------------------------------------------
        if applicant_email:
            try:
                if passed:
                    print("Send")
                else:
                    frappe.sendmail(
                        sender=SenderEmail,
                        recipients=[applicant_email],
                        subject=f"Azim Premji Scholarship – Your Application, {applicant_name}",
                        message=fail_email_html,
                        delayed=False,
                        reference_doctype=_frf_doctype,
                        reference_name=candidate_id,
                    )
            except Exception as mail_exc:
                frappe.log_error(title="MERIT_TRAC_MAIL_ERROR", message=f"Mail error: {mail_exc}")

        frappe.db.commit()

        frappe.local.response.http_status_code = 200
        return {
            "status": 200,
            "http_status": 200,
            "message": "Data inserted, SRF updated, email processed",
            "data": [SenderEmail],
        }

    except Exception as e:
        frappe.log_error(title="MERIT_TRAC_API_ERROR", message=frappe.get_traceback())
        frappe.local.response.http_status_code = 500
        return {"status": 500, "http_status": 500, "message": str(e)}


# ============================================================
# ✅ NEW CODE — Field Assessment Result webhook (proctored test with
# section-wise scores + descriptive answers). Stores into
# "Field MeritTrac Assessment Result" only — does not touch
# Field Registration Form status or send any emails.
# ============================================================


@frappe.whitelist(allow_guest=True)
def field_assessment_result_api():
    try:
        # ------------------------------------------------------------
        # 1️⃣ API KEY VALIDATION
        # ------------------------------------------------------------
        def get_request_header(name):
            try:
                headers = {
                    k.lower(): v for k, v in (frappe.request.headers or {}).items()
                }
                if name.lower() in headers:
                    return headers[name.lower()]
            except Exception:
                pass
            env_key = "HTTP_" + name.upper().replace("-", "_")
            return frappe.request.environ.get(env_key)

        api_key = get_request_header("Patner-key")
        EXPECTED_KEY = frappe.conf.get(
            "field_assessment_partner_key", "ToNnhB5chOh23fWz"
        )
        if not api_key or api_key != EXPECTED_KEY:
            frappe.local.response.http_status_code = 401
            return {
                "status": "error",
                "http_status": 401,
                "message": "Unauthorized: Invalid Patner Key",
            }

        # ------------------------------------------------------------
        # 2️⃣ READ JSON BODY
        # ------------------------------------------------------------
        raw = frappe.request.data
        if not raw:
            frappe.local.response.http_status_code = 400
            return {
                "status": "error",
                "http_status": 400,
                "message": "Empty request body",
            }

        try:
            payload = json.loads(raw)
        except Exception:
            frappe.local.response.http_status_code = 400
            return {
                "status": "error",
                "http_status": 400,
                "message": "Invalid JSON body",
            }

        if (
            isinstance(payload, dict)
            and "data" in payload
            and isinstance(payload.get("data"), dict)
        ):
            item = payload.get("data")
        elif isinstance(payload, dict) and payload.get("candidateId"):
            item = payload
        else:
            frappe.local.response.http_status_code = 400
            return {
                "status": "error",
                "http_status": 400,
                "message": "Request must be a JSON object with candidateId (either top-level or inside 'data')",
            }

        # ------------------------------------------------------------
        # 3️⃣ field extractor + datetime helper
        # ------------------------------------------------------------
        def fix_datetime(dt):
            if not dt:
                return None
            try:
                return get_datetime(dt).strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                return None

        candidate_id = item.get("candidateId")
        if not candidate_id:
            frappe.local.response.http_status_code = 400
            return {
                "status": "error",
                "http_status": 400,
                "message": "candidateId missing",
            }

        # ------------------------------------------------------------
        # 4️⃣ Detect registration form doctype (local vs cloud) and
        # look up applicant name — mirrors test_result_api above.
        # ------------------------------------------------------------
        _frf_doctype = (
            "Field Registration Form1"
            if frappe.db.exists("DocType", "Field Registration Form1")
            else "Field Registration Form"
        )
        _applicant_name = (
            frappe.db.get_value(_frf_doctype, candidate_id, "full_name_aadhaar") or ""
        )

        # ------------------------------------------------------------
        # 5️⃣ INSERT Field MeritTrac Assessment Result
        # ------------------------------------------------------------
        result_doc = frappe.get_doc(
            {
                "doctype": "Field MeritTrac Assessment Result",
                "candidate_id": candidate_id,
                "applicant_name": _applicant_name,
                "attempt_id": item.get("attemptId"),
                "assessment_id": item.get("assessmentId"),
                "attempt_status": item.get("attempt_status"),
                "overall_percentage_score": item.get("overAllPercentageScore"),
                "score": item.get("score"),
                "max_score": item.get("maxScore"),
                "total_question": item.get("totalQuestion"),
                "total_attempted": item.get("totalAttempted"),
                "credit_score": item.get("creditScore"),
                "user_img_key": item.get("userImgKey"),
                "id_img_key": item.get("idImgKey"),
                "tn_report": item.get("TnReport"),
                "proctor_comment": item.get("proctorComment"),
                "created_at": fix_datetime(item.get("createdAt")),
                "updated_at": fix_datetime(item.get("updatedAt")),
                "section_wise_score": [
                    {
                        "section_name": section.get("name"),
                        "score": section.get("score"),
                        "max_score": section.get("maxScore"),
                    }
                    for section in (item.get("sectionWiseScore") or [])
                ],
                "descriptive_response": [
                    {
                        "question_text": resp.get("questionText"),
                        "candidate_response": resp.get("candidateResponse"),
                    }
                    for resp in (item.get("descriptiveResponse") or [])
                ],
            }
        )
        result_doc.insert(ignore_permissions=True, ignore_links=True)
        frappe.db.commit()

        frappe.local.response.http_status_code = 200
        return {
            "status": 200,
            "http_status": 200,
            "message": "Data inserted",
            "data": [result_doc.name],
        }

    except Exception as e:
        frappe.log_error(title="FIELD_ASSESSMENT_RESULT_API_ERROR", message=frappe.get_traceback())
        frappe.local.response.http_status_code = 500
        return {"status": 500, "http_status": 500, "message": str(e)}


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
def test_save_result(candidate_id="APFF1F-0002"):
    """TEST ONLY — simulates a MeritTrac result webhook for a given candidate."""
    _frf_doctype = (
        "Field Registration Form1"
        if frappe.db.exists("DocType", "Field Registration Form1")
        else "Field Registration Form"
    )
    _applicant_name = (
        frappe.db.get_value(_frf_doctype, candidate_id, "full_name_aadhaar") or "Test"
    )

    doc = frappe.get_doc(
        {
            "doctype": "MeritTrac Test Result",
            "applicant_id": candidate_id,
            "applicant_name": _applicant_name,
            "attempt_id": "TEST-001",
            "assessment_id": "SA07936",
            "attempt_status": "Completed",
            "score_percentile": 75,
            "total_score": 45,
            "max_score": 60,
            "total_questions": 60,
            "total_attempted": 58,
            "score_report": "https://test-report.url",
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"saved": doc.name, "applicant": _applicant_name}


@frappe.whitelist()
def test_send_all_emails(record_name):
    """
    TEST ONLY — sends all 3 emails immediately for a given
    'Field Meritrac Test URL' record name, regardless of start_time.
    Remove / disable this after testing.
    """
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
            frappe.log_error(title=f"TEST_EMAIL_{email_type.upper()}", message=frappe.get_traceback())
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
            title="FIELD_MERITTRAC_LOG_ERROR", message=f"Creation log insert failed: {e}"
        )

    # ── 2. Save ticket records + send admit card email immediately ───────
    # Detect correct doctype name (local = "Field Registration Form1", cloud = "Field Registration Form")
    _frf_doctype = (
        "Field Registration Form1"
        if frappe.db.exists("DocType", "Field Registration Form1")
        else "Field Registration Form"
    )

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


@frappe.whitelist()
def initiate_merittrac_online_test(
    candidate_ids, assessment_number, start_utc, end_utc, enable_rp=0
):
    """
    Proxy for MeritTrac API 1 — POST /hrms/get-landing-page-url.
    Runs server-side so credentials never leave the backend and CORS is not an issue.
    """
    import requests as _req
    import json as _json

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

    resp = _req.post(
        "https://www.talent-next.com/hrms/get-landing-page-url",
        headers=headers,
        json=payload,
        timeout=30,
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
    import requests as _req
    import json as _json

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

    resp = _req.post(
        "https://www.talent-next.com/hrms/get-assessment-tickets",
        headers=headers,
        json=payload,
        timeout=30,
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
