import frappe
import hmac
import json
from frappe.utils import get_datetime, nowdate, add_days
from frappe.rate_limiter import rate_limit
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
        # Secret now lives only in site_config.json (field_merit_trac_partner_key),
        # never in source — a hardcoded fallback here would defeat the point
        # of moving it out, and would keep working even after rotating the key.
        EXPECTED_KEY = frappe.conf.get("field_merit_trac_partner_key")
        if (
            not EXPECTED_KEY
            or not api_key
            or not hmac.compare_digest(api_key, EXPECTED_KEY)
        ):
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
        # 5️⃣ Route to the right result + registration doctypes by
        # candidate ID prefix
        # ------------------------------------------------------------
        # This webhook is shared across programs — MeritTrac sends results
        # for both Field candidates (APFFRF-...) and Scholarship candidates
        # (APSRF-...) to the same URL. Each program stores its registration
        # data under a different doctype/fieldnames, and "Field MeritTrac
        # Test Result" has a fuller schema (proctoring images, section-wise/
        # descriptive breakdown) than "MeritTrac Test Result" (Scholarship),
        # which doesn't have those fields at all.
        #
        # NOTE: "Field Registration Form1" is a stale, orphaned leftover
        # doctype (not used by the Desk UI, the Zwayam importer, or anything
        # else) that happens to coexist with the real "Field Registration
        # Form" on this site. Detecting via existence-of-Form1 is wrong —
        # both can and do exist at the same time — so this is hardcoded to
        # the doctype every other part of the app actually uses.
        if "APFFRF" in candidate_id:
            result_doctype = "Field MeritTrac Test Result"
            reg_doctype = "Field Registration Form"
            name_field, email_field, sender_field = (
                "full_name_aadhaar",
                "email_address",
                "field_mail",
            )
        elif "APSRF" in candidate_id:
            result_doctype = "MeritTrac Test Result"
            reg_doctype = "Scholarship Recruitment Form"
            name_field, email_field, sender_field = (
                "full_name_as_per_aadhar",
                "email",
                "srt_mail",
            )
        else:
            frappe.local.response.http_status_code = 400
            return {
                "status": "error",
                "http_status": 400,
                "message": f"Unknown candidate ID prefix: {candidate_id}",
            }

        _applicant_name = (
            frappe.db.get_value(reg_doctype, candidate_id, name_field) or ""
        )

        # ------------------------------------------------------------
        # 6️⃣ INSERT test result
        # ------------------------------------------------------------
        if result_doctype == "Field MeritTrac Test Result":
            test_doc = frappe.get_doc(
                {
                    "doctype": result_doctype,
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
                    "section_wise_score": frappe.as_json([
                        {
                            "section_name": section.get("name"),
                            "score": section.get("score"),
                            "max_score": section.get("maxScore"),
                        }
                        for section in section_wise_score
                        if isinstance(section, dict)
                    ]),
                    "descriptive_response": frappe.as_json([
                        {
                            "question_text": resp.get("questionText"),
                            "candidate_response": resp.get("candidateResponse"),
                        }
                        for resp in descriptive_response
                        if isinstance(resp, dict)
                    ]),
                }
            )
        else:
            # "MeritTrac Test Result" (Scholarship) — no proctoring or
            # section-wise/descriptive fields on this doctype.
            test_doc = frappe.get_doc(
                {
                    "doctype": result_doctype,
                    "applicant_id": candidate_id,
                    "applicant_name": _applicant_name,
                    "score_percentile": percentage,
                    "attempt_id": attempt_id,
                    "assessment_id": assessment_id,
                    "attempt_status": attempt_status,
                    "score_report": report_url,
                    "total_score": score,
                    "max_score": max_score,
                    "total_questions": total_questions,
                    "total_attempted": total_attempted,
                    "updated_at": updated_at,
                    "created_at": created_at,
                }
            )
        test_doc.insert(ignore_permissions=True, ignore_links=True)

        # ------------------------------------------------------------
        # 7️⃣ UPDATE the source registration form + notify candidate
        # ------------------------------------------------------------
        # reg_doctype / name_field / email_field / sender_field were
        # already picked in step 5️⃣ above, based on the same candidate ID
        # prefix — reused here so both programs get the same status-update
        # + email treatment, just pointed at the right doctype/fields.
        srf = frappe.db.get_value(
            reg_doctype,
            {"name": candidate_id},
            ["name", name_field, email_field, sender_field],
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
        srf_doc = frappe.get_doc(reg_doctype, srf_name)
        srf_doc.application_status = status
        srf_doc.save(ignore_permissions=True)

        applicant_name = srf.get(name_field) or "Applicant"
        applicant_email = srf.get(email_field)
        SenderEmail = (
            srf.get(sender_field)
            if srf.get(sender_field)
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
                        reference_doctype=reg_doctype,
                        reference_name=candidate_id,
                    )
            except Exception as mail_exc:
                frappe.log_error(
                    title="MERIT_TRAC_MAIL_ERROR", message=f"Mail error: {mail_exc}"
                )

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
        # No hardcoded fallback — must come from site_config.json.
        EXPECTED_KEY = frappe.conf.get("field_assessment_partner_key")
        if (
            not EXPECTED_KEY
            or not api_key
            or not hmac.compare_digest(api_key, EXPECTED_KEY)
        ):
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
        # 4️⃣ Registration form doctype — see the NOTE in test_result_api
        # above on why this is hardcoded rather than existence-detected.
        # ------------------------------------------------------------
        _frf_doctype = "Field Registration Form"
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
        frappe.log_error(
            title="FIELD_ASSESSMENT_RESULT_API_ERROR", message=frappe.get_traceback()
        )
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
def test_save_result(candidate_id="APFFRF-0002"):
    """TEST ONLY — simulates a MeritTrac result webhook for a given candidate."""
    frappe.only_for("System Manager")
    _frf_doctype = "Field Registration Form"
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
    # Registration form doctype — see the NOTE in test_result_api on why
    # this is hardcoded rather than existence-detected.
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


# ---------------------------------------------------------------------------
# Pull pending Field MeritTrac results
# ---------------------------------------------------------------------------
# MeritTrac's integration for the Field program is pull-only — there is no
# push webhook that MeritTrac actually calls for Field candidates.
# (Confirmed 2026-08-31: "Field MeritTrac Test Result" had 0 records despite
# tests going back to Aug 14, while this same account's Scholarship results
# DO arrive automatically via a separate push webhook — that's a different
# program's integration, not this one.) MeritTrac's own API docs
# (talent-next.com/hrms/api-docs) show the real integration point:
# POST /hrms/get-candidates-results. This scheduled job calls that for
# every candidate who was ever sent an online test, and records any newly
# SUBMITTED attempt. Safe to run repeatedly — skips any attempt_id already
# recorded, so nothing gets duplicated across runs.
#
# Also live on the cloud site right now as a "Scheduler Event" Server
# Script ("Pull Pending Field MeritTrac Results", cron * * * * * — every
# minute, per a 2026-08-31 request for fast same-day-demo turnaround; dial
# back once that urgency passes) —
# created there directly since deploying this .py file isn't possible from
# here (no SSH/git access to that server). Keep both in sync if this
# changes; the Server Script is the one actually running in production
# until an app deploy picks this file up instead.
def pull_pending_merittrac_results():
    import requests as _req

    candidate_ids = frappe.get_all(
        "Field Meritrac Test URL", pluck="applicant_id", distinct=True
    )
    if not candidate_ids:
        return {"checked": 0, "inserted": 0}

    already_have = set(
        frappe.get_all("Field MeritTrac Test Result", pluck="attempt_id")
    )

    cred = frappe.get_doc("MeritTrac Credentials")
    headers = {
        "partnerid": cred.merittrac_partner_id,
        "secretkey": cred.merittrac_secret_key,
        "Content-Type": "application/json",
    }

    try:
        resp = _merittrac_post_with_retry(
            "https://www.talent-next.com/hrms/get-candidates-results",
            headers,
            {"candidateIds": candidate_ids},
        )
    except (_req.exceptions.ReadTimeout, _req.exceptions.ConnectionError) as exc:
        frappe.log_error(
            title="MERITTRAC_RESULTS_PULL_TIMEOUT",
            message=f"Gave up after {_MERITTRAC_RETRIES + 1} attempts: {exc}",
        )
        return {"checked": len(candidate_ids), "inserted": 0, "error": "timeout"}

    if not resp.ok:
        frappe.log_error(
            title="MERITTRAC_RESULTS_PULL_ERROR",
            message=f"status={resp.status_code} body={resp.text[:800]}",
        )
        return {
            "checked": len(candidate_ids),
            "inserted": 0,
            "error": f"http_{resp.status_code}",
        }

    rows = (resp.json() or {}).get("data") or []

    def fix_dt(iso):
        if not iso:
            return None
        return iso.replace("T", " ").split(".")[0]

    inserted = 0
    for row in rows:
        if not isinstance(row, dict) or row.get("attempt_status") != "SUBMITTED":
            continue

        attempt_id = row.get("attemptId")
        if not attempt_id or attempt_id in already_have:
            continue

        candidate_id = row.get("candidateId")
        applicant_name = (
            frappe.db.get_value(
                "Field Registration Form", candidate_id, "full_name_aadhaar"
            )
            or ""
        )
        percentage = row.get("overAllPercentageScore")

        result_doc = frappe.get_doc(
            {
                "doctype": "Field MeritTrac Test Result",
                "applicant_id": candidate_id,
                "applicant_name": applicant_name,
                "score_percentile": percentage,
                "overall_percentage_score": percentage,
                "attempt_id": attempt_id,
                "assessment_id": row.get("assessmentId"),
                "attempt_status": row.get("attempt_status"),
                "score_report": row.get("TnReport"),
                "tn_report": row.get("TnReport"),
                "total_score": row.get("score"),
                "max_score": row.get("maxScore"),
                "total_questions": row.get("totalQuestion"),
                "total_attempted": row.get("totalAttempted"),
                "user_img_key": row.get("userImgKey"),
                "id_img_key": row.get("idImgKey"),
                "credit_score": row.get("creditScore"),
                "proctor_comment": row.get("proctorComment"),
                "updated_at": fix_dt(row.get("updatedAt")),
                "created_at": fix_dt(row.get("createdAt")),
                # Proper child tables (Field MeritTrac Section Score /
                # Field MeritTrac Descriptive Response) — replaced the old
                # section_wise_score/descriptive_response Long Text JSON
                # blob fields on 2026-09-01, per a request for the
                # descriptive Q&A to render as separate, readable rows
                # instead of raw JSON text on the form. Those two Long
                # Text fields are left in the doctype (unused going
                # forward) rather than deleted, since 5 earlier records'
                # data was migrated out of them but nothing needs them
                # removed.
                "section_wise_scores": [
                    {
                        "section_name": s.get("name"),
                        "score": s.get("score"),
                        "max_score": s.get("maxScore"),
                    }
                    for s in (row.get("sectionWiseScore") or [])
                    if isinstance(s, dict)
                ],
                "descriptive_responses": [
                    {
                        "question_text": r.get("questionText"),
                        "candidate_response": r.get("candidateResponse"),
                    }
                    for r in (row.get("descriptiveResponse") or [])
                    if isinstance(r, dict)
                ],
            }
        )
        try:
            result_doc.insert(ignore_permissions=True, ignore_links=True)
        except frappe.DuplicateEntryError:
            # attempt_id is a unique field — this only fires if another
            # run (the scheduled poll and the finish-page trigger can
            # legitimately overlap) already inserted this exact attempt
            # between our dedup check above and this insert. Not an
            # error, just lost a race; move on to the next row.
            frappe.db.rollback()
            already_have.add(attempt_id)
            continue
        already_have.add(attempt_id)
        inserted += 1

    frappe.db.commit()
    return {"checked": len(candidate_ids), "fetched": len(rows), "inserted": inserted}


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=1, seconds=15, ip_based=False)
def trigger_merittrac_results_pull_on_finish():
    """
    Fired by a tiny script on the "Thank You for Attending the Test" page
    (Web Page "test-completed-field", route assessment-finished-field) the
    moment a candidate lands there right after submitting — gets the
    result recorded far faster than waiting for the next scheduled poll,
    without needing MeritTrac to actually push (see the long comment on
    pull_pending_merittrac_results above — that has still never happened
    for the Field program).

    Public/guest page hits this, so it's rate-limited globally (not per
    IP — many different candidates finishing around the same time should
    still only trigger one pull, not one each) rather than trusting every
    visitor to be well-behaved. Runs the pull in the background so a
    slow/failed MeritTrac call never blocks or errors the candidate's
    page — the fetch() that calls this is fire-and-forget from the page's
    side regardless.
    """
    frappe.enqueue(
        "ms_calendar.api.field_merit_trac.pull_pending_merittrac_results",
        queue="short",
        job_name="merittrac_results_pull_on_finish",
    )
    return {"queued": True}


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

# Explicit overrides for (candidate role, written_subject) pairs where the
# generic word-overlap scorer below is known to misfire — either because the
# Field Meritrac Assessment label uses different wording than the picklist
# ("Mathematics" vs "Maths"), a shared/reused SA number is stored under an
# unrelated-looking label (the Social Science paper is filed under a
# "History" assessment_set), or two live records still tie on score alone
# (e.g. Upper Primary Hindi's Set 1/Set 2 both remaining active). Checked
# before the generic scorer runs; verified against live Field Meritrac
# Assessment data as of 2026-08-17.
_WRITTEN_SUBJECT_OVERRIDES = {
    ("School Teacher", "Primary Mathematics"): "SA08072",
    ("School Teacher", "Upper Primary Maths"): "SA08073",
    ("School Teacher", "Secondary/High School Maths"): "SA07733",
    ("School Teacher", "Upper Primary Social Science"): "SA07746",
    ("School Teacher", "Upper Primary Kannada"): "SA07730",
    ("School Teacher", "Upper Primary Hindi"): "SA07744",
    # "Upper Primary English" was losing the tie-break to "Primary English"
    # (SA07690) because the UP record's label says "UP", not "Upper"/"Primary",
    # so it doesn't even earn the level-word point the Primary record gets.
    # Confirmed live via the Initiate Test dialog on 2026-08-18.
    ("School Teacher", "Upper Primary English"): "SA07741",
}

# Subjects with more than one genuinely valid SA number, where the form has
# no field to disambiguate (e.g. no language selector) — unlike
# _WRITTEN_SUBJECT_OVERRIDES, we return all valid options as "ambiguous"
# rather than picking one, since guessing wrong here would assign the wrong
# paper outright. Discovered because the generic scorer was ignoring both
# genuine ECE records (their DB label uses "ECE", which shares no word with
# the picklist's "Early Childhood Education") and instead tying on an
# unrelated record ("Special Education") by accident.
_WRITTEN_SUBJECT_AMBIGUOUS_OVERRIDES = {
    ("School Teacher", "Early Childhood Education"): ["SA07671", "SA07948"],  # Hindi / Kannada
    # Was falling through to "no_token_overlap" — "EVS" doesn't appear in
    # either assessment_set's text, so the generic scorer found nothing at
    # all. Shares the same Hindi/Kannada Set 2 pair as "Primary All
    # subjects" per the 2026-08-31 subject-mapping sheet.
    ("School Teacher", "Primary EVS"): ["SA07692", "SA07694"],  # Hindi / Kannada
}

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

    roles = {r.role for r in rows if r.role}
    role = roles.pop() if len(roles) == 1 else None

    override_name = _WRITTEN_SUBJECT_OVERRIDES.get((role, written_subject))
    if override_name:
        override_set = frappe.db.get_value(
            "Field Meritrac Assessment", override_name, "assessment_set"
        )
        if override_set:
            return {
                "matched": True,
                "assessment": override_name,
                "assessment_set": override_set,
                "ambiguous": False,
                "alternatives": [],
            }

    ambiguous_names = _WRITTEN_SUBJECT_AMBIGUOUS_OVERRIDES.get((role, written_subject))
    if ambiguous_names:
        ambiguous_records = [
            {"name": n, "assessment_set": frappe.db.get_value("Field Meritrac Assessment", n, "assessment_set")}
            for n in ambiguous_names
        ]
        ambiguous_records = [r for r in ambiguous_records if r["assessment_set"]]
        if ambiguous_records:
            best = ambiguous_records[0]
            return {
                "matched": True,
                "assessment": best["name"],
                "assessment_set": best["assessment_set"],
                "ambiguous": True,
                "alternatives": ambiguous_records[1:],
            }

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
