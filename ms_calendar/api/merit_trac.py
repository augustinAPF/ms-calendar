import frappe
import json
from frappe.utils import get_datetime
from datetime import datetime, timedelta


# @frappe.whitelist(allow_guest=False)
# def test_result_api():
#     try:
#         # ------------------------------------------------------------
#         # 1️⃣ API KEY VALIDATION (robust)
#         # ------------------------------------------------------------
#         def get_request_header(name):
#             try:
#                 headers = {k.lower(): v for k, v in (frappe.request.headers or {}).items()}
#                 if name.lower() in headers:
#                     return headers[name.lower()]
#             except Exception:
#                 pass
#             env_key = "HTTP_" + name.upper().replace("-", "_")
#             return frappe.request.environ.get(env_key)

#         api_key = get_request_header("Patner-key")
#         EXPECTED_KEY = "ToNnhB5chOh23fWz"
#         if not api_key or api_key != EXPECTED_KEY:
#             frappe.local.response.http_status_code = 401
#             return {
#                 "status": "error",
#                 "http_status": 401,
#                 "message": "Unauthorized: Invalid Patner Key"
#             }

#         # ------------------------------------------------------------
#         # 2️⃣ READ JSON BODY
#         # ------------------------------------------------------------
#         raw = frappe.request.data
#         if not raw:
#             frappe.local.response.http_status_code = 400
#             return {"status": "error", "http_status": 400, "message": "Empty request body"}

#         try:
#             payload = json.loads(raw)
#         except Exception:
#             frappe.local.response.http_status_code = 400
#             return {"status": "error", "http_status": 400, "message": "Invalid JSON body"}

#         # ------------------------------------------------------------
#         # 3️⃣ Accept either top-level object or {"data": {...}}
#         # ------------------------------------------------------------
#         if isinstance(payload, dict) and "data" in payload and isinstance(payload.get("data"), dict):
#             item = payload.get("data")
#         elif isinstance(payload, dict) and payload.get("candidateId"):
#             # support callers that send object directly (no "data" wrapper)
#             item = payload
#         else:
#             frappe.local.response.http_status_code = 400
#             return {
#                 "status": "error",
#                 "http_status": 400,
#                 "message": "Request must be a JSON object with candidateId (either top-level or inside 'data')"
#             }

#         # ------------------------------------------------------------
#         # 4️⃣ field extractor + datetime helper
#         # ------------------------------------------------------------
#         def fix_datetime(dt):
#             if not dt:
#                 return None
#             try:
#                 return get_datetime(dt).strftime("%Y-%m-%d %H:%M:%S")
#             except:
#                 return None

#         candidate_id     = item.get("candidateId")
#         percentage       = item.get("overAllPercentageScore")
#         attempt_id       = item.get("attemptId")
#         assessment_id    = item.get("assessmentId")
#         attempt_status   = item.get("attempt_status")
#         report_url       = item.get("TnReport")
#         score            = item.get("score")
#         max_score        = item.get("maxScore")
#         total_questions  = item.get("totalQuestion")
#         total_attempted  = item.get("totalAttempted")
#         updated_at       = fix_datetime(item.get("updatedAt"))
#         created_at       = fix_datetime(item.get("createdAt"))

#         if not candidate_id:
#             frappe.local.response.http_status_code = 400
#             return {"status": "error", "http_status": 400, "message": "candidateId missing"}

#         # ------------------------------------------------------------
#         # 5️⃣ INSERT MeritTrac Test Result
#         # ------------------------------------------------------------
#         test_doc = frappe.get_doc({
#             "doctype": "MeritTrac Test Result",
#             "applicant_id": candidate_id,
#             "score_percentile": percentage,
#             "attempt_id": attempt_id,
#             "assessment_id": assessment_id,
#             "attempt_status": attempt_status,
#             "score_report": report_url,
#             "total_score": score,
#             "max_score": max_score,
#             "total_questions": total_questions,
#             "total_attempted": total_attempted,
#             "updated_at": updated_at,
#             "created_at": created_at
#         })
#         test_doc.insert(ignore_permissions=True)

#         # if "APSRF" in candidate_id:
#         #     doctype_name = "MeritTrac Test Result"
#         # elif "APFFRF" in candidate_id:
#         #     doctype_name = "Field MeritTrac Test Result"
#         # else:
#         #     frappe.local.response.http_status_code = 400
#         #     return {
#         #         "status": "error",
#         #         "http_status": 400,
#         #         "message": f"Unknown candidate ID prefix: {candidate_id}"
#         #     }

#         # test_doc = frappe.get_doc({
#         #     "doctype": doctype_name,
#         #     "applicant_id": candidate_id,
#         #     "score_percentile": percentage,
#         #     "attempt_id": attempt_id,
#         #     "assessment_id": assessment_id,
#         #     "attempt_status": attempt_status,
#         #     "score_report": report_url,
#         #     "total_score": score,
#         #     "max_score": max_score,
#         #     "total_questions": total_questions,
#         #     "total_attempted": total_attempted,
#         #     "updated_at": updated_at,
#         #     "created_at": created_at
#         # })

#         # test_doc.insert(ignore_permissions=True)
#         # ------------------------------------------------------------
#         # 6️⃣ UPDATE SCHOLARSHIP RECRUITMENT FORM
#         # ------------------------------------------------------------
#         # Request full_name_as_per_aadhar too (fall back to applicant_name)
#         srf = frappe.db.get_value(
#             "Scholarship Recruitment Form",
#             {"name": candidate_id},
#             ["name","full_name_as_per_aadhar", "email", "srt_mail"],
#             as_dict=True
#         )

#         if not srf:
#             frappe.db.commit()
#             frappe.local.response.http_status_code = 200
#             return {
#                 "status": 200,
#                 "http_status": 200,
#                 "message": "Data inserted (No SRF found for candidate)",
#                 "data": []
#             }

#         # determine pass/fail
#         try:
#             passed = (percentage is not None and float(percentage) >=        50)
#         except:
#             passed = False
#         status = "Round One" if passed else "Test Reject"

#         # update SRF doc
#         srf_name = srf.get("name")
#         srf_doc = frappe.get_doc("Scholarship Recruitment Form", srf_name)
#         srf_doc.application_status = status
#         srf_doc.save(ignore_permissions=True)

#         # applicant details (prefer full_name_as_per_aadhar)
#         applicant_name = srf.get("full_name_as_per_aadhar") or  "Applicant"
#         applicant_email = srf.get("email")

#         # sender: safe lookup, fallback to a single fixed sender
#         SenderEmail = srf.get("srt_mail") if srf.get("srt_mail") else "tech4socialsector@azimpremjifoundation.org"

#         # ------------------------------------------------------------
#         # 7️⃣ EMAIL TEMPLATES
#         # ------------------------------------------------------------

#         fail_email_html = f"""
#                         <!DOCTYPE html>
#                         <html>
#                         <head>
#                         <meta charset="UTF-8">
#                         <meta name="viewport" content="width=device-width, initial-scale=1.0">
#                         </head>

#                         <body style="margin:0; padding:20px; background:#ffffff; font-family:'Segoe UI', sans-serif; color:#333; line-height:1.6;">

#                         <p style="font-size:16px; margin:0 0 20px 0;">
#                         Dear {applicant_name},
#                         </p>

#                         <p style="font-size:16px; margin:0 0 20px 0;">
#                         Thank you for your interest in the opportunities with the Azim Premji Scholarship Initiative.
#                         We appreciate the time and effort you have invested in exploring an opportunity with us.
#                         </p>

#                         <p style="font-size:16px; margin:0 0 20px 0;">
#                         After careful consideration of your candidature, unfortunately, we will not be able to
#                         take your application forward at this point of time.
#                         </p>

#                         <p style="font-size:16px; margin:0 0 25px 0;">
#                         We would like to thank you for your time, and we wish you the very best!
#                         </p>

#                         <p style="font-size:16px; margin:0 0 40px 0;">
#                         Regards,<br>
#                         People Function<br>
#                         Azim Premji Foundation
#                         </p>

#                         </body>
#                         </html>
# """

#         # ------------------------------------------------------------
#         # 8️⃣ SEND EMAILS (PASS immediate / FAIL immediate )
#         # ------------------------------------------------------------
#         if applicant_email:
#             try:
#                 if passed:
#                     # send now
#                     # frappe.sendmail(
#                     #     sender=SenderEmail,
#                     #     recipients=[applicant_email],
#                     #     subject=f"Azim Premji Scholarship – Your Application, {applicant_name}",
#                     #     message=pass_email_html,
#                     #     delayed=False,
#                     #     reference_doctype="Scholarship Recruitment Form",
#                     #     reference_name=candidate_id
#                     # )
#                     print("Send")
#                 else:
#                    # Send FAIL email immediately
#                     frappe.sendmail(
#                         sender=SenderEmail,
#                         recipients=[applicant_email],
#                         subject=f"Azim Premji Scholarship – Your Application, {applicant_name}",
#                         message=fail_email_html,
#                         delayed=False,
#                         reference_doctype="Scholarship Recruitment Form",
#                         reference_name=candidate_id
#                     )

#             except Exception as mail_exc:
#                 frappe.log_error(f"Mail error: {mail_exc}", "MERIT_TRAC_MAIL_ERROR")

#         frappe.db.commit()

#         # ------------------------------------------------------------
#         # SUCCESS RESPONSE
#         # ------------------------------------------------------------
#         frappe.local.response.http_status_code = 200
#         return {
#             "status": 200,
#             "http_status": 200,
#             "message": "Data inserted, SRF updated, email processed",
#             "data": [SenderEmail]
#         }

#     except Exception as e:
#         frappe.log_error(frappe.get_traceback(), "MERIT_TRAC_API_ERROR")
#         frappe.local.response.http_status_code = 500
#         return {"status": 500, "http_status": 500, "message": str(e)}


import json
import frappe
from frappe.utils import get_datetime


# @frappe.whitelist(allow_guest=False)
# def test_result_api():
#     try:
#         # ------------------------------------------------------------
#         # 1. READ REQUEST BODY
#         # ------------------------------------------------------------
#         raw = frappe.request.data

#         frappe.log_error(
#             message=f"RAW BODY: {raw}",
#             title="MERIT_TRAC_DEBUG"
#         )

#         if not raw:
#             frappe.local.response.http_status_code = 400
#             return {
#                 "status": 400,
#                 "http_status": 400,
#                 "message": "Empty request body"
#             }

#         # ------------------------------------------------------------
#         # 2. LOAD JSON
#         # ------------------------------------------------------------
#         try:
#             payload = json.loads(raw)
#         except Exception as e:
#             frappe.log_error(
#                 message=str(e),
#                 title="MERIT_TRAC_JSON_ERROR"
#             )

#             frappe.local.response.http_status_code = 400
#             return {
#                 "status": 400,
#                 "http_status": 400,
#                 "message": "Invalid JSON body",
#                 "error": str(e)
#             }

#         frappe.log_error(
#             message=f"FULL PAYLOAD: {payload}",
#             title="MERIT_TRAC_PAYLOAD"
#         )

#         # ------------------------------------------------------------
#         # 3. ACCEPT ALL POSSIBLE FORMATS
#         # ------------------------------------------------------------
#         item = None

#         if isinstance(payload, dict) and "data" in payload:
#             data_block = payload.get("data")

#             if isinstance(data_block, list) and len(data_block) > 0:
#                 item = data_block[0]

#             elif isinstance(data_block, dict):
#                 item = data_block

#         elif isinstance(payload, list) and len(payload) > 0:
#             item = payload[0]

#         elif isinstance(payload, dict):
#             item = payload

#         if not item or not isinstance(item, dict):
#             frappe.log_error(
#                 message=f"Invalid Payload: {payload}",
#                 title="MERIT_TRAC_INVALID_PAYLOAD"
#             )

#             frappe.local.response.http_status_code = 400
#             return {
#                 "status": 400,
#                 "http_status": 400,
#                 "message": "Invalid request payload format"
#             }

#         frappe.log_error(
#             message=f"ITEM: {item}",
#             title="MERIT_TRAC_ITEM"
#         )

#         # ------------------------------------------------------------
#         # 4. DATETIME FIXER
#         # ------------------------------------------------------------
#         def fix_datetime(dt):
#             if not dt:
#                 return None

#             try:
#                 return get_datetime(dt).strftime("%Y-%m-%d %H:%M:%S")
#             except Exception:
#                 return None

#         # ------------------------------------------------------------
#         # 5. GET candidate_id
#         # ------------------------------------------------------------
#         candidate_id = (
#             item.get("candidateId")
#             or item.get("candidate_id")
#             or item.get("CandidateId")
#             or item.get("candidateID")
#             or item.get("candidateid")
#         )

#         percentage = item.get("overAllPercentageScore")

#         frappe.log_error(
#             message=f"Candidate ID: {candidate_id}",
#             title="MERIT_TRAC_CANDIDATE_ID"
#         )

#         if not candidate_id:
#             frappe.local.response.http_status_code = 422
#             return {
#                 "status": 422,
#                 "http_status": 422,
#                 "message": "candidateId missing"
#             }

#         # ------------------------------------------------------------
#         # 6. CHECK DOCTYPE
#         # ------------------------------------------------------------
#         if "APSRF" in candidate_id:
#             application_doctype = "Scholarship Recruitment Form"
#             result_doctype = "MeritTrac Test Result"

#         elif "APFFRF" in candidate_id:
#             application_doctype = "Field Registration Form"
#             result_doctype = "Field MeritTrac Test Result"

#         else:
#             frappe.local.response.http_status_code = 400
#             return {
#                 "status": 400,
#                 "http_status": 400,
#                 "message": f"Unknown candidate ID prefix: {candidate_id}"
#             }

#         frappe.log_error(
#             message=f"""
# Candidate ID: {candidate_id}
# Application Doctype: {application_doctype}
# Result Doctype: {result_doctype}
#             """,
#             title="MERIT_TRAC_DOCTYPE"
#         )

#         # ------------------------------------------------------------
#         # 7. INSERT RESULT DOC
#         # ------------------------------------------------------------
#         test_doc = frappe.get_doc({
#             "doctype": result_doctype,
#             "applicant_id": candidate_id,
#             "score_percentile": item.get("overAllPercentageScore"),
#             "attempt_id": item.get("attemptId"),
#             "assessment_id": item.get("assessmentId"),
#             "attempt_status": item.get("attempt_status"),
#             "score_report": item.get("TnReport"),
#             "total_score": item.get("score"),
#             "max_score": item.get("maxScore"),
#             "total_questions": item.get("totalQuestion"),
#             "total_attempted": item.get("totalAttempted"),
#             "updated_at": fix_datetime(item.get("updatedAt")),
#             "created_at": fix_datetime(item.get("createdAt"))
#         })

#         frappe.log_error(
#             message=f"""
# Doctype: {result_doctype}
# Candidate ID: {candidate_id}
#             """,
#             title="MERIT_TRAC_BEFORE_INSERT"
#         )

#         test_doc.insert(ignore_permissions=True)
#         frappe.db.commit()

#         frappe.log_error(
#             message=f"Inserted Document Name: {test_doc.name}",
#             title="MERIT_TRAC_AFTER_INSERT"
#         )

#         # ------------------------------------------------------------
#         # SUCCESS RESPONSE
#         # ------------------------------------------------------------
#         frappe.local.response.http_status_code = 200

#         return {
#             "status": 200,
#             "http_status": 200,
#             "message": "Data inserted successfully",
#             "data": {
#                 "candidateId": candidate_id,
#                 "application_doctype": application_doctype,
#                 "result_doctype": result_doctype,
#                 "inserted_docname": test_doc.name
#             }
#         }

#     except Exception as e:
#         frappe.log_error(
#             message=frappe.get_traceback(),
#             title="TEST_RESULT_API_ERROR"
#         )

#         frappe.local.response.http_status_code = 500

#         return {
#             "status": 500,
#             "http_status": 500,
#             "message": str(e)
#         }


import json
import os
import frappe
import requests
from urllib.parse import urlparse
from frappe.utils import get_datetime
from frappe.utils.file_manager import save_file


def _attach_merittrac_report(test_doc, report_url):
    """
    Downloads the MeritTrac score report from `report_url` and attaches it as
    a real file on the `merittrac_report` field. Best-effort — a failed
    download must not block the rest of the result from being saved, since
    the report URL is a secondary detail, not the result itself.
    """
    if not report_url or report_url == "NA":
        return

    try:
        resp = requests.get(report_url, timeout=30)
        resp.raise_for_status()

        fname = os.path.basename(urlparse(report_url).path) or f"{test_doc.applicant_id}_merittrac_report"
        if "." not in fname:
            fname += ".pdf"

        file_doc = save_file(
            fname=fname,
            content=resp.content,
            dt=test_doc.doctype,
            dn=test_doc.name,
            is_private=1,
        )
        frappe.db.set_value(
            test_doc.doctype, test_doc.name, "merittrac_report", file_doc.file_url
        )
    except Exception:
        frappe.log_error(
            title="MERIT_TRAC_REPORT_DOWNLOAD_ERROR",
            message=frappe.get_traceback(),
        )


@frappe.whitelist(allow_guest=False)
def test_result_api():
    try:
        # ------------------------------------------------------------
        # 1. READ REQUEST BODY
        # ------------------------------------------------------------
        raw = frappe.request.data

        frappe.log_error(message=f"RAW BODY: {raw}", title="MERIT_TRAC_DEBUG")

        if not raw:
            frappe.local.response.http_status_code = 400
            return {"status": 400, "http_status": 400, "message": "Empty request body"}

        # ------------------------------------------------------------
        # 2. LOAD JSON
        # ------------------------------------------------------------
        try:
            payload = json.loads(raw)
        except Exception as e:
            frappe.log_error(message=str(e), title="MERIT_TRAC_JSON_ERROR")

            frappe.local.response.http_status_code = 400
            return {
                "status": 400,
                "http_status": 400,
                "message": "Invalid JSON body",
                "error": str(e),
            }

        frappe.log_error(message=f"FULL PAYLOAD: {payload}", title="MERIT_TRAC_PAYLOAD")

        # ------------------------------------------------------------
        # 3. ACCEPT ALL POSSIBLE FORMATS
        # ------------------------------------------------------------
        item = None

        if isinstance(payload, dict) and "data" in payload:
            data_block = payload.get("data")

            if isinstance(data_block, list) and len(data_block) > 0:
                item = data_block[0]

            elif isinstance(data_block, dict):
                item = data_block

        elif isinstance(payload, list) and len(payload) > 0:
            item = payload[0]

        elif isinstance(payload, dict):
            item = payload

        if not item or not isinstance(item, dict):
            frappe.log_error(
                message=f"Invalid Payload: {payload}",
                title="MERIT_TRAC_INVALID_PAYLOAD",
            )

            frappe.local.response.http_status_code = 400
            return {
                "status": 400,
                "http_status": 400,
                "message": "Invalid request payload format",
            }

        frappe.log_error(message=f"ITEM: {item}", title="MERIT_TRAC_ITEM")

        # ------------------------------------------------------------
        # 4. DATETIME FIXER
        # ------------------------------------------------------------
        def fix_datetime(dt):
            if not dt:
                return None

            try:
                return get_datetime(dt).strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                return None

        # ------------------------------------------------------------
        # 5. GET candidate_id
        # ------------------------------------------------------------
        candidate_id = (
            item.get("candidateId")
            or item.get("candidate_id")
            or item.get("CandidateId")
            or item.get("candidateID")
            or item.get("candidateid")
        )

        percentage = (
            item.get("overAllPercentageScore")
            or item.get("overallPercentageScore")
            or item.get("overall_percentage_score")
        )

        section_wise_score = item.get("sectionWiseScore") or []
        descriptive_response = item.get("descriptiveResponse") or []

        frappe.log_error(
            message=f"Candidate ID: {candidate_id}", title="MERIT_TRAC_CANDIDATE_ID"
        )

        if not candidate_id:
            frappe.local.response.http_status_code = 422
            return {"status": 422, "http_status": 422, "message": "candidateId missing"}

        # ------------------------------------------------------------
        # 6. CHECK DOCTYPE (FIXED VERSION)
        # ------------------------------------------------------------
        if str(candidate_id).startswith("APSRF"):
            application_doctype = "Scholarship Recruitment Form"
            result_doctype = "MeritTrac Test Result"
            update_application_status_and_send_mail_scholarship(
                candidate_id, percentage
            )
        elif str(candidate_id).startswith("APFFRF"):
            application_doctype = "Field Registration Form"
            result_doctype = "Field MeritTrac Test Result"

        else:
            frappe.local.response.http_status_code = 400
            return {
                "status": 400,
                "http_status": 400,
                "message": f"Unknown candidate ID prefix: {candidate_id}",
            }

        frappe.log_error(
            message=f"""
                    Candidate ID: {candidate_id}
                    Application Doctype: {application_doctype}
                    Result Doctype: {result_doctype}
                                """,
            title="MERIT_TRAC_DOCTYPE",
        )

        # ------------------------------------------------------------
        # 6b. GET applicant_name from the matching application record
        # ------------------------------------------------------------
        applicant_name = None
        if application_doctype == "Scholarship Recruitment Form":
            applicant_name = frappe.db.get_value(
                "Scholarship Recruitment Form", candidate_id, "full_name_as_per_aadhar"
            )
        elif application_doctype == "Field Registration Form":
            applicant_name = frappe.db.get_value(
                "Field Registration Form", candidate_id, "full_name_aadhaar"
            )

        # ------------------------------------------------------------
        # 7. INSERT RESULT DOC
        # ------------------------------------------------------------
        doc_fields = {
            "doctype": result_doctype,  # "MeritTrac Test Result" (APSRF) or "Field MeritTrac Test Result" (APFFRF)
            "applicant_id": candidate_id,
            "applicant_name": applicant_name,
            "score_percentile": percentage,
            "attempt_id": item.get("attemptId"),
            "assessment_id": item.get("assessmentId"),
            "attempt_status": item.get("attempt_status"),
            "score_report": item.get("TnReport"),
            "total_score": item.get("score"),
            "max_score": item.get("maxScore"),
            "total_questions": item.get("totalQuestion"),
            "total_attempted": item.get("totalAttempted"),
            "updated_at": fix_datetime(item.get("updatedAt")),
            "created_at": fix_datetime(item.get("createdAt")),
        }

        # section_wise_score / descriptive_response / overall_percentage_score
        # only exist on "Field MeritTrac Test Result" — "MeritTrac Test Result"
        # (Scholarship) has neither those fields nor a guaranteed matching
        # payload shape (its descriptiveResponse entries can be plain strings,
        # not {"questionText":..., "candidateResponse":...} objects), so
        # building these unconditionally previously crashed every Scholarship
        # insert. Also skip any non-dict rows defensively either way.
        #
        # section_wise_score/descriptive_response are Long Text fields (JSON
        # stored as text), not Table fields — frf_list.js's result dialog
        # JSON.parse()s them back into arrays before rendering.
        if result_doctype == "Field MeritTrac Test Result":
            doc_fields["overall_percentage_score"] = percentage
            doc_fields["section_wise_score"] = frappe.as_json([
                {
                    "section_name": section.get("name"),
                    "score": section.get("score"),
                    "max_score": section.get("maxScore"),
                }
                for section in section_wise_score
                if isinstance(section, dict)
            ])
            doc_fields["descriptive_response"] = frappe.as_json([
                {
                    "question_text": resp.get("questionText"),
                    "candidate_response": resp.get("candidateResponse"),
                }
                for resp in descriptive_response
                if isinstance(resp, dict)
            ])

        test_doc = frappe.get_doc(doc_fields)

        frappe.log_error(
            message=f"""
Before Insert
Doctype: {result_doctype}
Candidate ID: {candidate_id}
            """,
            title="MERIT_TRAC_BEFORE_INSERT",
        )

        test_doc.insert(ignore_permissions=True)
        frappe.db.commit()

        frappe.log_error(
            message=f"Inserted Document Name: {test_doc.name}",
            title="MERIT_TRAC_AFTER_INSERT",
        )

        if result_doctype == "Field MeritTrac Test Result":
            _attach_merittrac_report(test_doc, item.get("TnReport"))

        # ------------------------------------------------------------
        # SUCCESS RESPONSE
        # ------------------------------------------------------------
        frappe.local.response.http_status_code = 200

        return {
            "status": 200,
            "http_status": 200,
            "message": "Data inserted successfully",
            "data": {
                "candidateId": candidate_id,
                "application_doctype": application_doctype,
                "result_doctype": result_doctype,
                "inserted_docname": test_doc.name,
            },
        }

    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="TEST_RESULT_API_ERROR")

        frappe.local.response.http_status_code = 500

        return {"status": 500, "http_status": 500, "message": str(e)}


@frappe.whitelist(allow_guest=False)
def update_application_status_and_send_mail_scholarship(candidate_id, percentage):
    try:
        frappe.log_error(
            message=f"""
Candidate ID: {candidate_id}
Percentage: {percentage}
            """,
            title="MERIT_TRAC_UPDATE_START",
        )

        # ------------------------------------------------------------
        # 1. FETCH SRF DETAILS
        # ------------------------------------------------------------
        srf = frappe.db.get_value(
            "Scholarship Recruitment Form",
            {"name": candidate_id},
            ["name", "full_name_as_per_aadhar", "email", "srt_mail"],
            as_dict=True,
        )

        frappe.log_error(message=f"SRF DATA: {srf}", title="MERIT_TRAC_SRF_FETCH")

        if not srf:
            frappe.log_error(
                message=f"No SRF found for Candidate ID: {candidate_id}",
                title="MERIT_TRAC_SRF_NOT_FOUND",
            )

            return {
                "status": 200,
                "http_status": 200,
                "message": "Data inserted (No SRF found for candidate)",
                "data": [],
            }

        # ------------------------------------------------------------
        # 2. DETERMINE PASS / FAIL
        # ------------------------------------------------------------
        try:
            passed = percentage is not None and float(percentage) >= 50
        except Exception:
            passed = False

        application_status = "Round One" if passed else "Test Reject"

        frappe.log_error(
            message=f"""
Passed: {passed}
Application Status: {application_status}
            """,
            title="MERIT_TRAC_STATUS_CHECK",
        )

        # ------------------------------------------------------------
        # 3. UPDATE APPLICATION STATUS
        # ------------------------------------------------------------
        srf_name = srf.get("name")

        srf_doc = frappe.get_doc("Scholarship Recruitment Form", srf_name)

        srf_doc.application_status = application_status
        srf_doc.save(ignore_permissions=True)

        frappe.log_error(
            message=f"""
SRF Updated Successfully
SRF Name: {srf_name}
New Status: {application_status}
            """,
            title="MERIT_TRAC_SRF_UPDATED",
        )

        # ------------------------------------------------------------
        # 4. APPLICANT DETAILS
        # ------------------------------------------------------------
        applicant_name = srf.get("full_name_as_per_aadhar") or "Applicant"

        applicant_email = srf.get("email")

        sender_email = (
            srf.get("srt_mail")
            if srf.get("srt_mail")
            else "tech4socialsector@azimpremjifoundation.org"
        )

        frappe.log_error(
            message=f"""
Applicant Name: {applicant_name}
Applicant Email: {applicant_email}
Sender Email: {sender_email}
            """,
            title="MERIT_TRAC_APPLICANT_DETAILS",
        )

        # ------------------------------------------------------------
        # 5. FAIL EMAIL TEMPLATE
        # ------------------------------------------------------------
        fail_email_html = f"""
                               <!DOCTYPE html>
                        <html>
                        <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        </head>

                        <body style="margin:0; padding:20px; background:#ffffff; font-family:'Segoe UI', sans-serif; color:#333; line-height:1.6;">

                        <p style="font-size:16px; margin:0 0 20px 0;">
                        Dear {applicant_name},
                        </p>

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
                        Regards,<br>
                        People Function<br>
                        Azim Premji Foundation
                        </p>

                        </body>
                        </html>
        """

        # ------------------------------------------------------------
        # 6. SEND MAIL
        # ------------------------------------------------------------
        if applicant_email:
            try:
                if passed:
                    frappe.log_error(
                        message=f"PASS Candidate: {candidate_id}",
                        title="MERIT_TRAC_PASS_MAIL",
                    )

                else:
                    frappe.sendmail(
                        sender=sender_email,
                        recipients=[applicant_email],
                        subject=f"Azim Premji Scholarship – Your Application, {applicant_name}",
                        message=fail_email_html,
                        delayed=False,
                        reference_doctype="Scholarship Recruitment Form",
                        reference_name=candidate_id,
                    )

                    frappe.log_error(
                        message=f"FAIL Mail Sent to: {applicant_email}",
                        title="MERIT_TRAC_FAIL_MAIL_SENT",
                    )

            except Exception as mail_error:
                frappe.log_error(message=str(mail_error), title="MERIT_TRAC_MAIL_ERROR")

        frappe.db.commit()

        # ------------------------------------------------------------
        # 7. FINAL RESPONSE
        # ------------------------------------------------------------
        return {
            "status": 200,
            "http_status": 200,
            "message": "Application status updated and mail processed",
            "application_status": application_status,
        }

    except Exception as e:
        frappe.log_error(
            message=frappe.get_traceback(), title="MERIT_TRAC_UPDATE_ERROR"
        )

        return {"status": 500, "http_status": 500, "message": str(e)}


@frappe.whitelist(allow_guest=False)
def update_application_status_and_send_mail_field(candidate_id, percentage):
    try:
        frappe.log_error(
            message=f"""
Candidate ID: {candidate_id}
Percentage: {percentage}
            """,
            title="MERIT_TRAC_UPDATE_START",
        )

        # ------------------------------------------------------------
        # 1. FETCH FIELD REGISTRATION FORM DETAILS
        # ------------------------------------------------------------
        frf = frappe.db.get_value(
            "Field Registration Form",
            {"name": candidate_id},
            [
                "name",
                "full_name_aadhaar",
                "email_address",
                "field_mail",
                "native_state",
                "role",
            ],
            as_dict=True,
        )

        frappe.log_error(message=f"FRF DATA: {frf}", title="MERIT_TRAC_FRF_FETCH")

        if not frf:
            frappe.log_error(
                message=f"No FRF found for Candidate ID: {candidate_id}",
                title="MERIT_TRAC_FRF_NOT_FOUND",
            )

            return {
                "status": 200,
                "http_status": 200,
                "message": "Data inserted (No FRF found for candidate)",
                "data": [],
            }

        # ------------------------------------------------------------
        # 2. DETERMINE PASS / FAIL
        # ------------------------------------------------------------
        try:
            passed = percentage is not None and float(percentage) >= 50
        except Exception:
            passed = False

        application_status = "Round One" if passed else "Test Reject"

        frappe.log_error(
            message=f"""
Passed: {passed}
Application Status: {application_status}
            """,
            title="MERIT_TRAC_STATUS_CHECK",
        )

        # ------------------------------------------------------------
        # 3. UPDATE APPLICATION STATUS
        # ------------------------------------------------------------
        frf_name = frf.get("name")

        frf_doc = frappe.get_doc("Field Registration Form", frf_name)

        frf_doc.application_status = application_status
        frf_doc.save(ignore_permissions=True)

        frappe.log_error(
            message=f"""
FRF Updated Successfully
FRF Name: {frf_name}
New Status: {application_status}
            """,
            title="MERIT_TRAC_FRF_UPDATED",
        )

        # ------------------------------------------------------------
        # 4. APPLICANT DETAILS
        # ------------------------------------------------------------
        applicant_name = frf.get("full_name_aadhaar") or "Candidate"

        applicant_role = frf.get("role") or "Applicant"

        applicant_email = frf.get("email_address")

        sender_email = (
            frf.get("field_mail")
            if frf.get("field_mail")
            else "tech4socialsector@azimpremjifoundation.org"
        )

        applicant_state = (frf.get("native_state") or "").strip()

        frappe.log_error(
            message=f"""
Applicant Name: {applicant_name}
Applicant Role: {applicant_role}
Applicant Email: {applicant_email}
Sender Email: {sender_email}
State: {applicant_state}
            """,
            title="MERIT_TRAC_APPLICANT_DETAILS",
        )

        # ------------------------------------------------------------
        # 5. STATE EMAIL MAPPING
        # ------------------------------------------------------------
        state_email_map = {
            "Chhattisgarh": "recruitment.chhattisgarh@azimpremjifoundation.org",
            "Karnataka": "recruitment.karnataka@azimpremjifoundation.org",
            "Madhya Pradesh": "recruitment.madhyapradesh@azimpremjifoundation.org",
            "Puducherry": "recruitment.puducherry@azimpremjifoundation.org",
            "Rajasthan": "recruitment.rajasthan@azimpremjifoundation.org",
            "Telangana": "recruitment.telangana@azimpremjifoundation.org",
            "Uttarakhand": "recruitment.uttarakhand@azimpremjifoundation.org",
            "Jharkhand": "recruitment.jharkhand@azimpremjifoundation.org",
        }

        state_team_email = state_email_map.get(
            applicant_state, "recruitment.karnataka@azimpremjifoundation.org"
        )

        # ------------------------------------------------------------
        # 6. PASS EMAIL TEMPLATE
        # ------------------------------------------------------------
        pass_email_html = f"""
Dear {applicant_name},

Thank you for your interest in exploring career opportunities with Azim Premji Foundation.

We are pleased to inform you that you have successfully cleared the written test conducted recently.
Congratulations on reaching the next stage of our selection process!

A member of our recruitment team will get in touch with you via your registered email ID or contact number
within the next two weeks to share details about the next steps.

In case of any queries, please reach out to your respective State team:

State: {applicant_state}
Email ID: {state_team_email}

For more information about our work and the recruitment process, please visit:
www.azimpremjifoundation.org

We appreciate your effort and wish you the very best for the next phase.

Warm regards,

Recruitment Team
Azim Premji Foundation
        """

        # ------------------------------------------------------------
        # 7. FAIL EMAIL TEMPLATE (UPDATED)
        # ------------------------------------------------------------
        fail_email_html = f"""
Dear {applicant_name},

Thank you for taking the time to appear for the written test conducted by Azim Premji Foundation.

After a careful review of your performance, we regret to inform you that you have not been shortlisted for the next stage of the selection process.

Please note that the test results are final, and we will be unable to consider any requests for re-evaluation. However, we encourage you to reapply for relevant opportunities after a period of one year from the date of this test.

For any further queries, you may write to us at:
recruitment@azimpremjifoundation.org

We appreciate your interest in the Foundation and wish you the very best in your future endeavors.

Warm regards,

Recruitment Team
Azim Premji Foundation
        """

        # ------------------------------------------------------------
        # 8. SEND MAIL
        # ------------------------------------------------------------
        if applicant_email:
            try:
                if passed:
                    frappe.sendmail(
                        sender=sender_email,
                        recipients=[applicant_email],
                        subject=f"Congratulations – Shortlisted for Next Round at Azim Premji Foundation {applicant_role} Position",
                        message=pass_email_html,
                        delayed=False,
                        reference_doctype="Field Registration Form",
                        reference_name=candidate_id,
                    )

                    frappe.log_error(
                        message=f"PASS Mail Sent to: {applicant_email}",
                        title="MERIT_TRAC_PASS_MAIL_SENT",
                    )

                else:
                    frappe.sendmail(
                        sender=sender_email,
                        recipients=[applicant_email],
                        subject=f"Result of Written Test for {applicant_role} Position – Azim Premji Foundation",
                        message=fail_email_html,
                        delayed=False,
                        reference_doctype="Field Registration Form",
                        reference_name=candidate_id,
                    )

                    frappe.log_error(
                        message=f"FAIL Mail Sent to: {applicant_email}",
                        title="MERIT_TRAC_FAIL_MAIL_SENT",
                    )

            except Exception as mail_error:
                frappe.log_error(message=str(mail_error), title="MERIT_TRAC_MAIL_ERROR")

        frappe.db.commit()

        # ------------------------------------------------------------
        # 9. FINAL RESPONSE
        # ------------------------------------------------------------
        return {
            "status": 200,
            "http_status": 200,
            "message": "Application status updated and mail processed",
            "application_status": application_status,
        }

    except Exception as e:
        frappe.log_error(
            message=frappe.get_traceback(), title="MERIT_TRAC_UPDATE_ERROR"
        )

        return {"status": 500, "http_status": 500, "message": str(e)}
