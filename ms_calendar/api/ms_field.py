import frappe, requests, io, base64, time as _time
from datetime import timedelta
from frappe.utils import get_datetime

_TRANSIENT_STATUS_CODES = {429, 500, 502, 503, 504}

# Candidate-facing interview emails must always come from the field
# recruitment mailbox, regardless of which Organizer Email was picked on the
# interview schedule form (that one is used for the interviewer email only).
_CANDIDATE_SENDER_EMAIL = "field.recruitment@azimpremjifoundation.org"
_CANDIDATE_SENDER = (
    f"Field Recruitment Azim Premji Foundation <{_CANDIDATE_SENDER_EMAIL}>"
)


def _requests_with_retry(method, url, max_retries=3, backoff=2, **kwargs):
    for attempt in range(max_retries):
        resp = requests.request(method, url, **kwargs)
        if resp.status_code not in _TRANSIENT_STATUS_CODES:
            return resp
        if attempt < max_retries - 1:
            wait = backoff * (2**attempt)
            _time.sleep(wait)
    return resp


# ── Feedback URL lookup by department ──────────────────────────────────
# Education: keyed by (role_lower, round_lower)
_EDUCATION_FEEDBACK_URLS = {
    # ── School Teacher ──────────────────────────────────────────────────
    (
        "school teacher",
        "recruiter round",
    ): "https://careers.frappe.cloud/recruiter-assessment-form-feed-back-form/new?app_id={app_id}&applicant_name={applicant_name}",
    (
        "school teacher",
        "subject round",
    ): "https://careers.frappe.cloud/school-teacher-functional-feedback/new?app_id={app_id}&applicant_name={applicant_name}",
    (
        "school teacher",
        "demo round",
    ): "https://careers.frappe.cloud/demo-lesson-observation-feedback-form-feed-back-form/new?app_id={app_id}&applicant_name={applicant_name}",
    (
        "school teacher",
        "leader round-1",
    ): "https://careers.frappe.cloud/leader-final-feedback/new?app_id={app_id}&applicant_name={applicant_name}",
    (
        "school teacher",
        "leader round-2",
    ): "https://careers.frappe.cloud/leader-final-feedback/new?app_id={app_id}&applicant_name={applicant_name}",
    # ── Resource Person ─────────────────────────────────────────────────
    (
        "resource person",
        "recruiter round",
    ): "https://careers.frappe.cloud/recruiter-assessment-form-feed-back-form/new?app_id={app_id}&applicant_name={applicant_name}",
    (
        "resource person",
        "education capacity round",
    ): "https://careers.frappe.clo  ud/educational-capacity-interview---feedback-form/new?app_id={app_id}&applicant_name={applicant_name}",
    (
        "resource person",
        "leader round-1",
    ): "https://careers.frappe.cloud/leader-final-feedback/new?app_id={app_id}&applicant_name={applicant_name}",
    (
        "resource person",
        "leader round-2",
    ): "https://careers.frappe.cloud/leader-final-feedback/new?app_id={app_id}&applicant_name={applicant_name}",
    # ── Associate Resource Person ────────────────────────────────────────
    (
        "associate resource person",
        "leader round-1",
    ): "https://careers.frappe.cloud/campus-associate-feedback-form/new?app_id={app_id}&applicant_name={applicant_name}",
    (
        "associate resource person",
        "leader round-2",
    ): "https://careers.frappe.cloud/campus-associate-feedback-form/new?app_id={app_id}&applicant_name={applicant_name}",
    (
        "associate resource person",
        "calibration process",
    ): "https://careers.frappe.cloud/calibration-process/new?app_id={app_id}&applicant_name={applicant_name}",
}

# Livelihood: keyed by round_lower
_LIVELIHOOD_FEEDBACK_URLS = {
    "recruiter round": "https://careers.frappe.cloud/livelihoods-recruiter-feedback-form/new?app_id={app_id}&applicant_name={applicant_name}",
    "functional round": "https://careers.frappe.cloud/livelihoods-functional-round-feedback-form/new?app_id={app_id}&applicant_name={applicant_name}",
    "leader round-1": "https://careers.frappe.cloud/livelihoods-final-round-feedback-form/new?app_id={app_id}&applicant_name={applicant_name}",
    "leader round-2": "https://careers.frappe.cloud/livelihoods-final-round-feedback-form/new?app_id={app_id}&applicant_name={applicant_name}",
}

# Health: keyed by round_lower
_HEALTH_FEEDBACK_URLS = {
    "recruiter round": "https://careers.frappe.cloud/health-recruitment-feedback-form/new?app_id={app_id}&applicant_name={applicant_name}",
    "functional round": "https://careers.frappe.cloud/health-functional-round-feedback-form/new?app_id={app_id}&applicant_name={applicant_name}",
    "leader round-1": "https://careers.frappe.cloud/health-final-round-feedback-form/new?app_id={app_id}&applicant_name={applicant_name}",
    "leader round-2": "https://careers.frappe.cloud/health-final-round-feedback-form/new?app_id={app_id}&applicant_name={applicant_name}",
}


@frappe.whitelist()
def get_schedule_free_slots(interviewer_emails, interview_date):
    """
    Fetches busy intervals for multiple interviewers using MS Graph getSchedule endpoint.
    interviewer_emails can be a Python list or JSON string like '["a@x.com","b@x.com"]'.
    """
    if isinstance(interviewer_emails, str):
        try:
            import json

            interviewer_emails = json.loads(interviewer_emails)
        except Exception:
            interviewer_emails = [interviewer_emails]

    if not isinstance(interviewer_emails, list) or not interviewer_emails:
        frappe.throw("interviewer_emails must be a non-empty list of email IDs")

    try:
        credentials = frappe.get_single("MS Graph Credentials")
        tenant_id = credentials.tenant_id
        client_id = credentials.client_id
        try:
            client_secret = credentials.get_password("client_secret")
        except frappe.ValidationError:
            frappe.throw(
                "Could not decrypt MS Graph client_secret. "
                "⚠️ Please check that your site_config.json contains the correct encryption_key. "
                "If you recently migrated/restored this site and do not have the old encryption key, "
                "you must re-enter the client_secret in the MS Graph Credentials doctype."
            )
    except Exception as e:
        frappe.throw(f"Could not fetch MS Graph Credentials: {e}")

    start_date = get_datetime(interview_date)
    end_date = start_date + timedelta(days=1)

    # Get access token
    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    token_data = {
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": "https://graph.microsoft.com/.default",
    }

    try:
        token_resp = requests.post(token_url, data=token_data)
        token_resp.raise_for_status()
        access_token = token_resp.json().get("access_token")
        if not access_token:
            frappe.throw(f"Failed to fetch access token: {token_resp.json()}")
    except requests.exceptions.RequestException as e:
        frappe.throw(f"Token request failed: {e}")

    # Use the first interviewer as the context user for getSchedule
    context_user = interviewer_emails[0]
    url = f"https://graph.microsoft.com/v1.0/users/{context_user}/calendar/getSchedule"

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    body = {
        "schedules": interviewer_emails,
        "startTime": {"dateTime": start_date.isoformat(), "timeZone": "UTC"},
        "endTime": {"dateTime": end_date.isoformat(), "timeZone": "UTC"},
        "availabilityViewInterval": 30,
    }

    try:
        resp = requests.post(url, headers=headers, json=body, timeout=30)
    except requests.exceptions.ConnectionError:
        frappe.throw(
            "Cannot reach Microsoft Graph API. "
            "Check your network connectivity and try again."
        )
    except requests.exceptions.Timeout:
        frappe.throw(
            "Microsoft Graph API timed out while fetching schedules. "
            "Please try again."
        )
    except requests.exceptions.RequestException as e:
        frappe.throw(f"Network error calling Microsoft Graph API: {e}")

    if not resp.ok:
        try:
            err_json = resp.json().get("error", {})
            err_code = err_json.get("code", "")
            err_msg = err_json.get("message", resp.text)
        except Exception:
            err_code = ""
            err_msg = resp.text
        if resp.status_code == 403 or err_code in (
            "ErrorAccessDenied",
            "Authorization_RequestDenied",
        ):
            frappe.throw(
                f"Access denied by Microsoft Graph API (403). "
                f"The Azure AD app is missing the 'Calendars.Read' application permission. "
                f"Please grant it in Azure Portal → App registrations → API permissions. "
                f"Details: {err_msg}"
            )
        elif resp.status_code == 404:
            frappe.throw(
                f"User '{context_user}' not found in Microsoft 365 (404). "
                f"Ensure all interviewer emails belong to your organisation's M365 tenant. "
                f"Details: {err_msg}"
            )
        else:
            frappe.throw(f"Microsoft Graph API error ({resp.status_code}): {err_msg}")

    schedules = resp.json().get("value", [])
    result = {s["scheduleId"]: s.get("scheduleItems", []) for s in schedules}
    return result


import frappe, requests, uuid


@frappe.whitelist()
def create_calendar_event(
    event_title, start_datetime, end_datetime, interviewer_email, interviewee_email
):
    """
    Schedules a new calendar event using Microsoft Graph (HR as organizer),
    and sends different custom emails to interviewer and candidate.
    """
    # --- 1. Get credentials ---
    try:
        credentials = frappe.get_single("MS Graph Credentials")
        tenant_id = credentials.tenant_id.strip()
        client_id = credentials.client_id.strip()
        client_secret = credentials.get_password("client_secret")
    except Exception as e:
        frappe.throw(f"Could not fetch MS Graph Credentials: {e}")

    # --- 2. Get access token ---
    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    token_data = {
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": "https://graph.microsoft.com/.default",
    }

    try:
        token_resp = requests.post(token_url, data=token_data).json()
        access_token = token_resp.get("access_token")
        if not access_token:
            frappe.throw(f"Failed to fetch access token: {token_resp}")
    except requests.exceptions.RequestException as e:
        frappe.throw(f"Token request failed: {e}")

    # --- 3. Organizer email (HR official mailbox) ---
    organizer_email = "health.fellowship@azimpremjifoundation.org"  # 👈 replace with your official organizer email
    url = f"https://graph.microsoft.com/v1.0/users/{organizer_email}/events?sendUpdates=none"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    # --- 4. Event body (seen only by HR) ---
    event_body = {
        "subject": event_title,
        "start": {"dateTime": start_datetime, "timeZone": "Asia/Kolkata"},
        "end": {"dateTime": end_datetime, "timeZone": "Asia/Kolkata"},
        "location": {"displayName": "Microsoft Teams Meeting"},
        "attendees": [
            {
                "emailAddress": {"address": interviewer_email, "name": "Interviewer"},
                "type": "required",
            },
            {
                "emailAddress": {"address": interviewee_email, "name": "Candidate"},
                "type": "required",
            },
        ],
        "responseRequested": True,
        "allowNewTimeProposals": True,
        "isOnlineMeeting": True,
        "onlineMeetingProvider": "teamsForBusiness",
        "transactionId": str(uuid.uuid4()),
        "body": {
            "contentType": "HTML",
            "content": f"""
                <p>Dear HR,</p>
                <p>This interview has been scheduled via the system.</p>
                <p><b>Title:</b> {event_title}<br>
                <b>Start:</b> {start_datetime}<br>
                <b>End:</b> {end_datetime}<br>
                <b>Location:</b> Microsoft Teams Meeting</p>
            """,
        },
    }

    # --- 5. Create event ---
    try:
        resp = requests.post(url, headers=headers, json=event_body)
        resp.raise_for_status()
        event = resp.json()
        join_url = event.get("onlineMeeting", {}).get("joinUrl")

        # --- 6. Send custom email to Interviewer ---
        frappe.sendmail(
            recipients=[interviewer_email],
            sender="Field Recruitment Azim Premji Foundation <field.recruitment@azimpremjifoundation.org>",
            subject=f"Interview Scheduled (Interviewer) - {event_title}",
            message=f"""
                <p>Dear Interviewer,</p>
                <p>You are scheduled to conduct an interview.</p>
                <p><b>Title:</b> {event_title}<br>
                   <b>Start:</b> {start_datetime}<br>
                   <b>End:</b> {end_datetime}<br>
                   <b>Join Link:</b> <a href="{join_url}">Join Teams Meeting</a></p>
                <p>Please be on time and review the candidate details before the meeting.</p>
                <p>Best regards,<br>HR Team</p>
            """,
        )

        # --- 7. Send custom email to Candidate ---
        frappe.sendmail(
            recipients=[interviewee_email],
            sender="Field Recruitment Azim Premji Foundation <field.recruitment@azimpremjifoundation.org>",
            subject=f"Interview Invitation - {event_title}",
            message=f"""
                <p>Dear Candidate,</p>
                <p>Your interview has been scheduled.</p>
                <p><b>Title:</b> {event_title}<br>
                   <b>Start:</b> {start_datetime}<br>
                   <b>End:</b> {end_datetime}<br>
                   <b>Join Link:</b> <a href="{join_url}">Join Teams Meeting</a></p>
                <p>Please ensure you are in a quiet place with stable internet connectivity.</p>
                <p>Best regards,<br>HR Team</p>
            """,
        )

        frappe.msgprint(
            "Interview scheduled. HR notified, and custom invites sent to interviewer and candidate."
        )

        return {"event_id": event.get("id"), "join_url": join_url}

    except requests.exceptions.RequestException as e:
        frappe.throw(f"Graph API error: {resp.status_code} - {resp.text}")


@frappe.whitelist()
def get_org_rooms_and_availability(interview_date, start_time, end_time):
    import frappe
    import requests
    import time
    from frappe.utils import get_datetime
    from datetime import datetime, timezone, timedelta

    print("\n===================== DEBUG START =====================")

    creds = frappe.get_single("MS Graph Credentials")
    tenant = creds.tenant_id
    client = creds.client_id
    secret = creds.get_password("client_secret")

    # -------------------------
    # ACCESS TOKEN
    # -------------------------
    token_url = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
    token_data = {
        "grant_type": "client_credentials",
        "client_id": client,
        "client_secret": secret,
        "scope": "https://graph.microsoft.com/.default",
    }
    try:
        token_resp = requests.post(token_url, data=token_data, timeout=30)
        token_resp.raise_for_status()
        access_token = token_resp.json().get("access_token")
        if not access_token:
            frappe.throw(f"Failed to fetch MS access token: {token_resp.json()}")
    except requests.exceptions.ConnectionError:
        frappe.throw(
            "Cannot reach Microsoft login servers. Check network connectivity and try again."
        )
    except requests.exceptions.Timeout:
        frappe.throw("Microsoft login server timed out. Please try again.")
    except requests.exceptions.RequestException as e:
        frappe.throw(f"Token request failed: {e}")
    headers = {"Authorization": f"Bearer {access_token}"}

    print("DEBUG → Token OK")

    # GET ALL ROOMS (PAGINATED)
    # -------------------------
    rooms = []
    url = "https://graph.microsoft.com/v1.0/places/microsoft.graph.room"
    page = 1

    while url:
        print(f"DEBUG → Fetching rooms PAGE {page}")
        resp = requests.get(url, headers=headers)
        resp.raise_for_status()
        data = resp.json()

        page_rooms = data.get("value", [])
        print(f"DEBUG → PAGE {page} has {len(page_rooms)} rooms")
        rooms.extend(page_rooms)

        url = data.get("@odata.nextLink")
        page += 1

    print("DEBUG → TOTAL ROOMS FETCHED =", len(rooms))

    # Extract emails
    room_emails = [r.get("emailAddress") for r in rooms if r.get("emailAddress")]

    # -------------------------
    # TIME RANGE (UTC)
    # -------------------------
    offset = -time.timezone if time.localtime().tm_isdst == 0 else -time.altzone
    system_tz = timezone(timedelta(seconds=offset))

    start_local = get_datetime(f"{interview_date} {start_time}")
    end_local = get_datetime(f"{interview_date} {end_time}")

    start_utc = start_local.replace(tzinfo=system_tz).astimezone(timezone.utc)
    end_utc = end_local.replace(tzinfo=system_tz).astimezone(timezone.utc)

    # -------------------------
    # GET AVAILABILITY IN BATCHES
    # -------------------------
    # Pick context user from Organizer Email records (avoids hardcoded account)
    _org_records = frappe.get_all("Organizer Email", fields=["name"], limit=5)
    _context_user = None
    for _rec in _org_records:
        _u = (_rec.get("name") or "").strip()
        if (
            _u
            and "@" in _u
            and not any(
                _u.lower().endswith("@" + d)
                for d in ("gmail.com", "yahoo.com", "hotmail.com", "outlook.com")
            )
        ):
            _context_user = _u
            break
    if not _context_user:
        frappe.throw(
            "No valid Organizer Email found. Please add an organisation email in the Organizer Email doctype."
        )

    MAX_BATCH = 20
    schedule_url = (
        f"https://graph.microsoft.com/v1.0/users/{_context_user}/calendar/getSchedule"
    )

    schedule_map = {}

    for i in range(0, len(room_emails), MAX_BATCH):
        batch = room_emails[i : i + MAX_BATCH]
        body = {
            "schedules": batch,
            "startTime": {
                "dateTime": start_utc.strftime("%Y-%m-%dT%H:%M:%S"),
                "timeZone": "UTC",
            },
            "endTime": {
                "dateTime": end_utc.strftime("%Y-%m-%dT%H:%M:%S"),
                "timeZone": "UTC",
            },
            "availabilityViewInterval": 30,
        }

        try:
            resp = requests.post(
                schedule_url,
                headers={**headers, "Content-Type": "application/json"},
                json=body,
            )
            resp.raise_for_status()
        except requests.exceptions.HTTPError as _he:
            frappe.log_error(
                f"getSchedule failed for context user {_context_user}: {_he}",
                "Room Availability Error",
            )
            frappe.throw(
                f"Could not check room availability. The organiser account "
                f"<b>{_context_user}</b> does not have calendar access permissions in Microsoft 365. "
                "Please contact your IT administrator."
            )

        for item in resp.json().get("value", []):
            schedule_map[item["scheduleId"].lower()] = item.get("scheduleItems", [])

        time.sleep(0.1)

    # -------------------------
    # FINAL OUTPUT
    # -------------------------
    final = []

    for r in rooms:
        email = r.get("emailAddress")
        busy = schedule_map.get(email.lower(), [])

        available = True
        for slot in busy:
            s = datetime.fromisoformat(slot["start"]["dateTime"]).replace(
                tzinfo=timezone.utc
            )
            e = datetime.fromisoformat(slot["end"]["dateTime"]).replace(
                tzinfo=timezone.utc
            )

            if not (e <= start_utc or s >= end_utc):
                available = False
                break

        final.append(
            {
                "name": r.get("displayName"),
                "email": email,
                "capacity": r.get("capacity"),
                "availability": busy,
                "is_available": available,
            }
        )

    print("===================== DEBUG END =====================\n")
    return {"rooms": final}


@frappe.whitelist()
def create_interview_event(
    event_title,
    start_datetime,
    end_datetime,
    interviewer_emails,
    room_emails,
    is_online,
    Organizer_email,
    Interview_round,
    InterviewersName,
    Applicants_name,
    Applicants_Role,
    application_id,
    interviewee_email=None,
    interview_mode=None,
    Map_location=None,
    address=None,
    candidate_phone=None,
    commands_to_candidate=None,
    commands_to_interviewer=None,
    attachment_paths=None,
    demo_feed_back_form=0,
    doc_name=None,
    ms_event_id=None,
    feedback_form_link=None,
    demo_feedback_interviewers_email=None,
    department=None,
):

    import re
    import ast
    import os
    import base64
    import time
    import requests
    from datetime import datetime
    from ms_calendar.api.email_data_helper import get_salary_details

    # ----------------------------------------
    # Convert is_online → int
    # ----------------------------------------
    try:
        is_online = int(is_online)
    except:
        is_online = 0

    Organizer_email = (Organizer_email or "").strip()
    interviewee_email = (interviewee_email or "").strip()
    # If the Candidate Email field on the interview schedule was left blank,
    # fall back to the applicant's own email from their application record
    # so the candidate still gets the interview email (instead of silently
    # defaulting to an internal mailbox and never reaching the candidate).
    if not interviewee_email and application_id:
        try:
            interviewee_email = (
                frappe.db.get_value(
                    "Field Registration Form", application_id, "email_address"
                )
                or ""
            ).strip()
        except Exception:
            pass
    Applicants_name = (Applicants_name or "").strip()
    Applicants_Role = (Applicants_Role or "").strip()
    InterviewersName = (InterviewersName or "").strip()
    Map_location = Map_location or ""
    address = address or ""
    commands_to_candidate = commands_to_candidate or ""
    commands_to_interviewer = commands_to_interviewer or ""

    # If either message was not passed by JS, read it directly from the saved record.
    # This handles cases where the DocType fields are in the DB but not yet rendered
    # in the form (e.g. missing from the JS or not yet deployed to the cloud).
    if doc_name and (not commands_to_candidate or not commands_to_interviewer):
        try:
            _db_vals = frappe.db.get_value(
                "Field Interview Schedule",
                doc_name,
                ["message_for_canditate", "message_for_the_interviewer"],
                as_dict=True,
            )
            if _db_vals:
                if not commands_to_candidate:
                    commands_to_candidate = _db_vals.get("message_for_canditate") or ""
                if not commands_to_interviewer:
                    commands_to_interviewer = (
                        _db_vals.get("message_for_the_interviewer") or ""
                    )
        except Exception:
            pass

    # Validate organizer email — must be a Microsoft 365 account (not Gmail/Yahoo etc.)
    _invalid_domains = (
        "gmail.com",
        "yahoo.com",
        "hotmail.com",
        "outlook.com",
        "live.com",
    )
    if not Organizer_email:
        frappe.throw(
            "Organizer Email is required. Please select a valid organizer before saving."
        )
    if any(Organizer_email.lower().endswith("@" + d) for d in _invalid_domains):
        frappe.throw(
            f"Organizer Email <b>{Organizer_email}</b> is a personal email account. "
            "Please use an official Azim Premji Foundation email (e.g., name@azimpremjifoundation.org). "
            "Gmail and other personal accounts cannot be used to create Microsoft calendar events."
        )

    # ----------------------------------------
    # Guard against duplicate event/email creation. The JS after_save
    # handler calls this on every Save, not just the first time an
    # interview is scheduled. Once an event already exists for this
    # record, skip re-creating it and re-sending candidate/interviewer
    # emails — otherwise every retried/extra Save floods the candidate
    # with duplicate "Interview Scheduled" emails.
    # ----------------------------------------
    if doc_name and not ms_event_id:
        _existing_event_id = frappe.db.get_value(
            "Field Interview Schedule", doc_name, "ms_event_id"
        )
        if _existing_event_id:
            return {
                "status": "skipped",
                "message": "Interview already scheduled for this record; no duplicate event or email sent.",
                "event_id": _existing_event_id,
            }

    # ----------------------------------------
    # Friendly date
    # ----------------------------------------
    start_dt = datetime.fromisoformat(start_datetime)
    end_dt = datetime.fromisoformat(end_datetime)
    when_str = start_dt.strftime("%A, %d %b %Y at %I:%M %p")

    interview_date_str = start_dt.strftime("%d %B %Y")
    interview_time_str = start_dt.strftime("%I:%M %p")
    end_time_str = end_dt.strftime("%I:%M %p")
    round_label = str(Interview_round).strip()
    display_mode = (interview_mode or "").strip() or (
        "Online" if is_online == 1 else "Face-to-Face"
    )
    mode_is_online = (is_online == 1) or (display_mode.lower() == "online")
    candidate_phone = (candidate_phone or "").strip()
    # Fallback: fetch phone from application record if not passed from JS
    if not candidate_phone and application_id:
        try:
            candidate_phone = (
                frappe.db.get_value(
                    "Field Registration Form", application_id, "phone_number"
                )
                or ""
            )
        except Exception:
            candidate_phone = ""

    # Phone number HTML for interviewer email (Phone mode only)
    phone_info_html = (
        f"<b>Candidate Phone No.:</b> {candidate_phone}<br>"
        if display_mode.lower() == "phone" and candidate_phone
        else ""
    )

    round_raw = str(Interview_round).strip().lower()
    role_raw = str(Applicants_Role or "").strip().lower()

    # ── Round flags ──────────────────────────────────────────────────────────
    is_recruiter_round = "recruiter" in round_raw
    # Round-1: Subject Round (ST) | Education Capacity Round (RP) | Functional Round (Health/LH)
    is_round1 = (
        "subject round" in round_raw
        or "education capacity round" in round_raw
        or ("functional round" in round_raw and "leader" not in round_raw)
    )
    is_round2 = "demo round" in round_raw or "leader round-1" in round_raw
    is_round3 = "leader round-2" in round_raw
    # Calibration Process + Associate Resource Person → interviewer-only email
    is_calibration_arp = (
        "calibration" in round_raw and "associate resource person" in role_raw
    )

    # ── Feedback URL resolution ──────────────────────────────────────────────────
    _demo_checked = str(demo_feed_back_form or "0").strip().lower() in (
        "1",
        "true",
        "yes",
    )

    _round_norm = str(Interview_round or "").strip().lower()
    _round_norm = {
        "recruiter round select": "recruiter round",
        "recruiter round reject": "recruiter round",
    }.get(_round_norm, _round_norm)

    # --- Department-based lookup (primary) ---
    _dept_raw = str(department or "").strip().lower()
    _role_raw2 = str(Applicants_Role or "").strip().lower()

    from urllib.parse import quote as _fq

    # Determine bucket — Health/Livelihood BEFORE Education so that roles like
    # "Resource Person-Health" or "Resource Person-Livelihoods" are not
    # incorrectly caught by the Education "resource person" keyword fallback.
    _is_arp = (
        "associate resource person" in _dept_raw
        or "associate resource person" in _role_raw2
        or _role_raw2.startswith(
            "assoc"
        )  # catches "associate", "assocate" (typo), etc.
    )
    _is_health = (not _is_arp) and ("health" in _dept_raw or "health" in _role_raw2)
    _is_livelihood = (not _is_arp) and (
        any(k in _dept_raw for k in ("livelihood", "livelihoods"))
        or any(
            k in _role_raw2
            for k in ("livelihood", "livelihoods", "cluster", "market research")
        )
    )
    # Education: role-based fallback only applies when not already Health/Livelihood
    _is_education = (not _is_arp and not _is_health and not _is_livelihood) and (
        "education" in _dept_raw
        or any(k in _role_raw2 for k in ("school teacher", "resource person"))
    )

    feedback_url = ""

    if _is_arp:
        if _round_norm in ("recruiter round",):
            feedback_url = (
                "https://careers.frappe.cloud/recruiter-assessment-form-feed-back-form/new"
                f"?app_id={_fq(str(application_id or ''), safe='')}"
                f"&applicant_name={_fq(str(Applicants_name or ''), safe='')}"
            )
        elif _round_norm in (
            "education capacity round",
            "subject round",
            "functional round",
            "demo round",
            "leader round-1",
            "leader round-2",
        ):
            feedback_url = (
                "https://careers.frappe.cloud/campus-associate-feedback-form/new"
                f"?app_id={_fq(str(application_id or ''), safe='')}"
                f"&applicant_name={_fq(str(Applicants_name or ''), safe='')}"
            )
        elif "calibration" in _round_norm:
            feedback_url = (
                "https://careers.frappe.cloud/calibration-process/new"
                f"?app_id={_fq(str(application_id or ''), safe='')}"
                f"&applicant_name={_fq(str(Applicants_name or ''), safe='')}"
            )

    elif _is_health:
        _tmpl = _HEALTH_FEEDBACK_URLS.get(_round_norm, "")
        if _tmpl:
            feedback_url = _tmpl.format(
                app_id=_fq(str(application_id or ""), safe=""),
                applicant_name=_fq(str(Applicants_name or ""), safe=""),
            )

    elif _is_livelihood:
        _tmpl = _LIVELIHOOD_FEEDBACK_URLS.get(_round_norm, "")
        if _tmpl:
            feedback_url = _tmpl.format(
                app_id=_fq(str(application_id or ""), safe=""),
                applicant_name=_fq(str(Applicants_name or ""), safe=""),
            )

    elif _is_education:
        _tmpl = _EDUCATION_FEEDBACK_URLS.get((_role_raw2, _round_norm), "")
        if _tmpl:
            feedback_url = _tmpl.format(
                app_id=_fq(str(application_id or ""), safe=""),
                applicant_name=_fq(str(Applicants_name or ""), safe=""),
            )

    # Fallback to value passed from JS / stored on form
    if not feedback_url:
        feedback_url = str(feedback_form_link or "").strip()

    # Debug log
    try:
        _bucket = (
            "arp"
            if _is_arp
            else (
                "health"
                if _is_health
                else (
                    "livelihood"
                    if _is_livelihood
                    else "education" if _is_education else "none"
                )
            )
        )
        frappe.log_error(
            title="Feedback URL Debug",
            message=f"dept={repr(_dept_raw)} | role={repr(_role_raw2)} | round={repr(_round_norm)} | bucket={_bucket} | url={'SET' if feedback_url else 'EMPTY'}",
        )
    except Exception:
        pass

    # If JS failed to extract demo_feedback_interviewers_email (Table MultiSelect mapping issue),
    # fetch it directly from the saved Field Interview Schedule document in the database.
    if (
        _demo_checked
        and not str(demo_feedback_interviewers_email or "").strip()
        and doc_name
    ):
        try:
            _fis_doc = frappe.get_doc("Field Interview Schedule", doc_name)
            _db_emails = [
                row.interviewer_email
                for row in (_fis_doc.demo_feedback_interviewers_email or [])
                if row.interviewer_email
            ]
            if _db_emails:
                demo_feedback_interviewers_email = ",".join(_db_emails)
        except Exception as _dbe:
            try:
                frappe.log_error(
                    title="Demo Feedback DB Fallback", message=str(_dbe)[:2000]
                )
            except Exception:
                pass

    # Priority 2: read from Field Interview Schedule record in DB
    if not feedback_url and application_id:
        try:
            _fis = frappe.get_all(
                "Field Interview Schedule",
                filters={
                    "application_id": application_id,
                    "interview_round": Interview_round,
                },
                fields=["feedback_form_link"],
                order_by="modified desc",
                limit=1,
            )
            if _fis and _fis[0].get("feedback_form_link"):
                feedback_url = str(_fis[0]["feedback_form_link"]).strip()
        except Exception:
            pass

    # For Priority 1 & 2 URLs (manually filled), append params if not already present
    if (
        feedback_url
        and "app_id=" not in feedback_url
        and "applicant_id=" not in feedback_url
    ):
        from urllib.parse import quote as _quote

        _sep = "&" if "?" in feedback_url else "?"
        feedback_url = (
            f"{feedback_url}{_sep}"
            f"app_id={_quote(str(application_id or ''), safe='')}"
            f"&applicant_name={_quote(str(Applicants_name or ''), safe='')}"
        )

    # Ensure absolute URL so Outlook doesn't treat it as a relative path
    if feedback_url and not feedback_url.startswith("http"):
        feedback_url = "https://" + feedback_url

    # Build demo feedback URL separately when checkbox is checked
    demo_feedback_url = ""
    if _demo_checked:
        from urllib.parse import quote as _quote

        demo_feedback_url = (
            "https://careers.frappe.cloud/demo-lesson-observation-feedback-form-feed-back-form/new"
            f"?app_id={_quote(str(application_id or ''), safe='')}"
            f"&applicant_name={_quote(str(Applicants_name or ''), safe='')}"
        )
    demo_feedback_html = ""

    from urllib.parse import unquote as _unquote

    def _link_block(url, label):
        return (
            f"<p><b>{label}:</b><br>"
            f'<a href="{url}" target="_blank" '
            f'style="display:inline-block;margin-top:6px;padding:8px 18px;'
            f"background-color:#1d4ed8;color:#ffffff;text-decoration:none;"
            f'border-radius:4px;font-weight:600;font-size:13px;">'
            f"Click Here to Open Feedback Form</a></p>"
        )

    feedback_html_block = ""
    if feedback_url:
        feedback_html_block += _link_block(feedback_url, "Feedback Form Link")
    # demo_feedback_url is sent ONLY to the demo feedback interviewer via a
    # separate email — it is intentionally excluded from feedback_html_block
    # so that regular interviewers do not receive the demo link.

    if display_mode.lower() == "face-to-face" and (address or Map_location):
        from urllib.parse import quote as _qmap

        _search_text = (Map_location or address).strip()
        if _search_text.startswith("http"):
            _final_map_url = _search_text
        else:
            _final_map_url = "https://www.google.com/maps/search/?api=1&query=" + _qmap(
                _search_text
            )
        if _final_map_url:
            _map_link = (
                f' <a href="{_final_map_url}" target="_blank">View on Google Maps</a>'
            )
        else:
            _map_link = ""
        # Candidate email: address + clickable map link
        map_html = f"<p><b>Location:</b> {address}{_map_link}</p>"
        # Interviewer email: address only, no map link
        interviewer_location_html = (
            f"<p><b>Location:</b> {address}</p>" if address else ""
        )
    else:
        map_html = ""
        interviewer_location_html = ""

    note_to_candidate_html = (
        f"<p><strong>For your information:</strong> {commands_to_candidate}</p>"
        if commands_to_candidate
        else ""
    )
    note_to_interviewer_html = (
        f"<p><strong>For your information:</strong> {commands_to_interviewer}</p>"
        if commands_to_interviewer
        else ""
    )
    # ----------------------------------------
    # ROUND 2 → SALARY DETAILS
    # ----------------------------------------
    total_exp = current_ctc = expected_ctc = ""
    if is_round2:
        try:
            salary_result = get_salary_details(application_id)
            if salary_result:
                total_exp = salary_result.get("total_years_of_experience") or ""
                current_ctc = salary_result.get("current_ctc") or ""
                expected_ctc = salary_result.get("expected_ctc") or ""
        except:
            pass

    # ----------------------------------------
    # GRAPH AUTH
    # ----------------------------------------
    creds = frappe.get_single("MS Graph Credentials")
    token_url = (
        f"https://login.microsoftonline.com/{creds.tenant_id.strip()}/oauth2/v2.0/token"
    )

    try:
        tok = requests.post(
            token_url,
            data={
                "grant_type": "client_credentials",
                "client_id": creds.client_id.strip(),
                "client_secret": creds.get_password("client_secret"),
                "scope": "https://graph.microsoft.com/.default",
            },
            timeout=30,
        )
        tok.raise_for_status()
        access_token = tok.json().get("access_token")
        if not access_token:
            frappe.throw(f"Failed to fetch MS access token: {tok.json()}")
    except requests.exceptions.ConnectionError:
        frappe.throw(
            "Cannot reach Microsoft login servers. Check network connectivity and try again."
        )
    except requests.exceptions.Timeout:
        frappe.throw("Microsoft login server timed out. Please try again.")
    except requests.exceptions.RequestException as e:
        frappe.throw(f"Token request failed: {e}")

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    # --------------------------------------
    # CANCEL OLD EVENT (reschedule case)
    # --------------------------------------
    if ms_event_id:
        try:
            requests.delete(
                f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events/{ms_event_id}"
                f"?sendUpdates=all",
                headers=headers,
            )
            # Do not raise — if old event already gone, that's fine
        except Exception:
            pass

    # ----------------------------------------
    # ATTENDEES
    # ----------------------------------------
    interviewer_list = list(
        dict.fromkeys(
            [i.strip() for i in (interviewer_emails or "").split(",") if i.strip()]
        )
    )
    room_list = list(
        dict.fromkeys([r.strip() for r in (room_emails or "").split(",") if r.strip()])
    )

    _org_email_lower = Organizer_email.strip().lower()
    attendees = []
    for r in room_list:
        attendees.append({"emailAddress": {"address": r}, "type": "resource"})
    for i in interviewer_list:
        # Graph API returns 400 / silently drops the send when organizer is added as attendee
        if i.strip().lower() != _org_email_lower:
            attendees.append({"emailAddress": {"address": i}, "type": "required"})
    # NOTE: the candidate is deliberately NOT added as a calendar attendee.
    # Attendees get Microsoft's own auto-generated invite email, which uses
    # the interviewer-oriented body (feedback form link, meeting passcode,
    # "Interviewers: ..."). The candidate instead gets the separate,
    # mode-specific candidate email (phone / online / face-to-face) sent
    # further down in this function.
    # ----------------------------------------
    # ATTACHMENTS (PUBLIC + PRIVATE FIXED)
    # --------------------------------------
    final_files = []

    if attachment_paths:
        try:
            attachment_list = ast.literal_eval(attachment_paths)
        except:
            attachment_list = []
    else:
        attachment_list = []

    for web_path in attachment_list:
        _fd = frappe.get_all(
            "File",
            filters={"file_url": web_path},
            fields=["name", "file_name"],
            limit=1,
        )
        if not _fd:
            frappe.log_error(
                f"File Doc not found: {web_path}", "Interview Event File Error"
            )
            continue
        try:
            _f_obj = frappe.get_doc("File", _fd[0]["name"])
            _f_bytes = _f_obj.get_content()
            if len(_f_bytes) > 3 * 1024 * 1024:
                frappe.log_error(
                    f"File too large: {_fd[0]['file_name']}",
                    "Interview Event File Error",
                )
                continue
            final_files.append(
                (_fd[0]["file_name"], base64.b64encode(_f_bytes).decode())
            )
        except Exception as _fe:
            frappe.log_error(
                f"Could not read attachment {web_path}: {_fe}",
                "Interview Event File Error",
            )
            continue

    # ----------------------------------------
    # AUTO-ATTACH FEEDBACK FORMS FROM Field Registration Form
    # Round One   → recruiter_round_feedback_form
    # Round Two   → recruiter_round_feedback_form + round_one_feedback_from + resume
    # Round Three → recruiter_round_feedback_form + round_one_feedback_from
    #               + round_two_feedback_form + resume
    # ----------------------------------------
    if application_id:
        try:
            _frf_doctype = (
                "Field Registration Form"
                if frappe.db.exists("DocType", "Field Registration Form")
                else "Field Registration Form"
            )
            if not frappe.db.exists(_frf_doctype, application_id):
                frappe.log_error(
                    f"Skipping auto-attach: {_frf_doctype} '{application_id}' not found",
                    "Interview Auto-Attach Skip",
                )
                srf = None
            else:
                srf = frappe.get_doc(_frf_doctype, application_id)

            if not srf:
                raise Exception("srf not loaded, skipping auto-attach")

            # Determine which fields to attach based on round
            # resume_upload is NOT auto-attached — resume comes from candidate_cv__resume on the form
            # application_forms is always attached for all rounds
            if is_calibration_arp:
                auto_attach_fields = [
                    "resume_upload",
                    "application_forms",
                    "self_declaration",
                    "recruiter_round_feedback_form",
                    "round_one_feedback_from",
                    "round_two_feedback_form",
                    "round_tree_feedback_form",
                    "filed_merit_track_test",
                ]
            elif is_recruiter_round:
                auto_attach_fields = [
                    "resume_upload",
                    "application_forms",
                    "self_declaration",
                    "filed_merit_track_test",
                ]
            elif is_round1:
                if "education capacity round" in round_raw:
                    auto_attach_fields = [
                        "resume_upload",
                        "recruiter_round_feedback_form",
                        "application_forms",
                        "self_declaration",
                        "filed_merit_track_test",
                    ]
                else:
                    # Subject Round / Functional Round
                    auto_attach_fields = [
                        "resume_upload",
                        "recruiter_round_feedback_form",
                        "round_one_feedback_from",
                        "application_forms",
                        "self_declaration",
                        "filed_merit_track_test",
                    ]
            elif is_round2:
                auto_attach_fields = [
                    "resume_upload",
                    "recruiter_round_feedback_form",
                    "round_one_feedback_from",
                    "application_forms",
                    "self_declaration",
                    "filed_merit_track_test",
                ]
            elif is_round3:
                auto_attach_fields = [
                    "resume_upload",
                    "recruiter_round_feedback_form",
                    "round_one_feedback_from",
                    "round_two_feedback_form",
                    "application_forms",
                    "self_declaration",
                    "filed_merit_track_test",
                ]
            else:
                auto_attach_fields = [
                    "resume_upload",
                    "application_forms",
                    "self_declaration",
                ]

            # MeritTrac test result PDF (manually uploaded) — always attach if present,
            # regardless of round.
            auto_attach_fields = auto_attach_fields + ["filed_merit_track_test"]

            # Track filenames already added (from manual attachments) to avoid duplicates
            _already_added = {fname.lower() for fname, _ in final_files}

            for field in auto_attach_fields:
                web_path = getattr(srf, field, None)
                if not web_path:
                    continue

                _afd = frappe.get_all(
                    "File",
                    filters={"file_url": web_path},
                    fields=["name", "file_name"],
                    limit=1,
                )
                if not _afd:
                    # Fallback: derive filename from URL
                    _af_name = web_path.split("/")[-1]
                    _afd = [{"name": None, "file_name": _af_name}]

                _af_fname = _afd[0]["file_name"]

                # Skip if this file was already added (avoid duplicates)
                if _af_fname.lower() in _already_added:
                    continue

                try:
                    if _afd[0]["name"]:
                        _af_obj = frappe.get_doc("File", _afd[0]["name"])
                    else:
                        _af_obj = frappe.get_doc("File", {"file_url": web_path})
                    _af_bytes = _af_obj.get_content()
                    if len(_af_bytes) > 5 * 1024 * 1024:
                        frappe.log_error(
                            f"Auto-attach file too large: {_af_fname}",
                            "Interview Auto-Attach Error",
                        )
                        continue
                    final_files.append(
                        (_af_fname, base64.b64encode(_af_bytes).decode())
                    )
                    _already_added.add(_af_fname.lower())
                except Exception as _afe:
                    frappe.log_error(
                        f"Auto-attach failed for field={field} url={web_path}: {_afe}",
                        "Interview Auto-Attach Error",
                    )
                    continue

        except Exception as e:
            frappe.log_error(
                f"Auto-attach from SRF failed for {application_id}: {e}",
                "Interview Auto-Attach Error",
            )

    # ----------------------------------------
    # ROUND 1 TEMPLATES
    # ----------------------------------------
    # ── INTERVIEWER TEMPLATE (Round 1)
    round1_interviewer_template = """
<p>Hi,</p>

<p>An interview with <b>{Applicants_name}</b> for the role of <b>{Applicants_Role}</b> has been confirmed.
Please find the details of the interview below.</p>

<p>
<b>Date:</b> {interview_date_str}<br>
<b>Interview Mode:</b> {display_mode}<br>
{meeting_info}
{phone_info}
<b>Interview Round:</b> {round_label}<br>
<b>Interview Time:</b> {interview_time_str} – {end_time_str}<br>
<b>Interviewers:</b> {InterviewersName}
</p>

{Map_html}
{Note_to_interviewer_html}

{feedback_html_block}

{demo_feedback_html}

<p>Regards,<br>People Function</p>
"""

    # ── CANDIDATE TEMPLATE (all rounds, mode-based) ─────────────────────
    candidate_template = """
<p>Dear {Applicants_name},</p>

<p>We are pleased to inform you that your interview for the position of
<b>{Applicants_Role}</b> at Azim Premji Foundation has been scheduled
as per the details below:</p>

<p><b>Interview Details</b></p>
<table style="border-collapse:collapse; width:auto;">
  <tr>
    <td style="padding:4px 12px 4px 0;"><b>Interview Round:</b></td>
    <td style="padding:4px 0;">{round_label}</td>
  </tr>
  <tr>
    <td style="padding:4px 12px 4px 0;"><b>Date:</b></td>
    <td style="padding:4px 0;">{interview_date_str}</td>
  </tr>
  <tr>
    <td style="padding:4px 12px 4px 0;"><b>Time:</b></td>
    <td style="padding:4px 0;">{interview_time_str} – {end_time_str}</td>
  </tr>
  <tr>
    <td style="padding:4px 12px 4px 0;"><b>Interview Mode:</b></td>
    <td style="padding:4px 0;">{display_mode}</td>
  </tr>
</table>

{candidate_mode_html}

{candidate_advice_html}

{Note_to_candidate_html}

<p>We wish you all the best for your interview.</p>

<p>Warm regards,<br>Recruitment Team<br>Azim Premji Foundation</p>
"""

    # ── INTERVIEWER TEMPLATE (Round 2)
    round2_interviewer_template = """
<p>Hi,</p>

<p>An interview with <b>{Applicants_name}</b> for the role of <b>{Applicants_Role}</b> has been confirmed.
Please find the details of the interview below.</p>


<p>
<b>Date:</b> {interview_date_str}<br>
<b>Interview Mode:</b> {display_mode}<br>
{meeting_info}
{phone_info}
<b>Interview Round:</b> {round_label}<br>
<b>Interview Time:</b> {interview_time_str} – {end_time_str}<br>
<b>Interviewers:</b> {InterviewersName}
</p>

{Map_html}
{Note_to_interviewer_html}

{feedback_html_block}

<p>Regards,<br>People Function</p>
"""

    # ── INTERVIEWER TEMPLATE (Calibration Process – Associate Resource Person) ──
    calibration_arp_interviewer_template = """
<p>Dear {InterviewersName},</p>

<p>We are pleased to inform you that <b>{Applicants_name}</b> has been selected for the
<b>Associate Resource Person</b> role.</p>

<p>Please find the candidate documents attached for your reference.</p>

<p>We request you to kindly review the documents and share your
comments/recommendations for the calibration process and final selection decision.</p>

<table border="1" cellpadding="8" cellspacing="0"
       style="border-collapse:collapse; font-family:sans-serif; font-size:14px;">
  <tr>
    <th style="text-align:left; background:#f5f5f5; padding:8px 16px;">Candidate Name</th>
    <td style="padding:8px 16px;">{Applicants_name}</td>
  </tr>
  <tr>
    <th style="text-align:left; background:#f5f5f5; padding:8px 16px;">Interviewed by</th>
    <td style="padding:8px 16px;">{InterviewersName}</td>
  </tr>
  <tr>
    <th style="text-align:left; background:#f5f5f5; padding:8px 16px;">Interview Date</th>
    <td style="padding:8px 16px;">{interview_date_str}</td>
  </tr>
</table>

{feedback_html_block}

<p>Warm regards,<br>Recruitment Team<br>Azim Premji Foundation</p>
"""

    # ------------------------------------
    # INITIAL EVENT BODY
    # ------------------------------------
    if is_calibration_arp:
        calendar_subject = f"Calibration Process – for Associate Resource Person {Applicants_name} | {candidate_phone}"
        initial_body = calibration_arp_interviewer_template.format(
            Applicants_name=Applicants_name,
            InterviewersName=InterviewersName,
            interview_date_str=interview_date_str,
            feedback_html_block=feedback_html_block,
        )
    elif is_round1:
        calendar_subject = f"Interview Scheduled – {Applicants_name} | {round_label} for {Applicants_Role} {candidate_phone}"
        # initial_body = round1_interviewer_template.format(
        #     Interviewer_name=InterviewersName,
        #     when_str=when_str,
        #     meeting_info="",
        #     feedback_url=feedback_url
        # )
        initial_body = round1_interviewer_template.format(
            Applicants_name=Applicants_name,
            Applicants_Role=Applicants_Role,
            interview_date_str=interview_date_str,
            display_mode=display_mode,
            round_label=round_label,
            interview_time_str=interview_time_str,
            end_time_str=end_time_str,
            InterviewersName=InterviewersName,
            meeting_info="",
            phone_info=phone_info_html,
            Map_html=interviewer_location_html,
            feedback_html_block=feedback_html_block,
            demo_feedback_html=demo_feedback_html,
            Note_to_interviewer_html=note_to_interviewer_html,
        )

    else:
        calendar_subject = f"Interview Scheduled – {Applicants_name} | {round_label} for {Applicants_Role} {candidate_phone}"
        initial_body = round2_interviewer_template.format(
            Applicants_name=Applicants_name,
            Applicants_Role=Applicants_Role,
            total_exp=total_exp,
            current_ctc=current_ctc,
            expected_ctc=expected_ctc,
            interview_date_str=interview_date_str,
            display_mode=display_mode,
            round_label=round_label,
            interview_time_str=interview_time_str,
            end_time_str=end_time_str,
            InterviewersName=InterviewersName,
            meeting_info="",
            phone_info=phone_info_html,
            Map_html=interviewer_location_html,
            feedback_html_block=feedback_html_block,
            Note_to_interviewer_html=note_to_interviewer_html,
        )

    create_url = f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events"

    draft_payload = {
        "subject": calendar_subject,
        "isOnlineMeeting": mode_is_online,
        "onlineMeetingProvider": "teamsForBusiness" if mode_is_online else None,
        "showAs": "busy",
        "start": {"dateTime": start_datetime, "timeZone": "Asia/Kolkata"},
        "end": {"dateTime": end_datetime, "timeZone": "Asia/Kolkata"},
        "body": {"contentType": "HTML", "content": initial_body},
        # NO attendees here — adding attendees at creation triggers a first invite
        # even with sendUpdates=none. Attendees are added in the PATCH so only
        # ONE invite (with the complete final body + Teams URL) is ever sent.
    }

    # Create event without attendees so no premature invite is fired
    res = _requests_with_retry(
        "POST", create_url + "?sendUpdates=none", headers=headers, json=draft_payload
    )
    if not res.ok:
        try:
            _cr_err = res.json().get("error", {})
            _cr_code = _cr_err.get("code", "")
            _cr_msg = _cr_err.get("message", res.text)
        except Exception:
            _cr_code = ""
            _cr_msg = res.text
        if res.status_code == 404:
            frappe.throw(
                f"Organizer Email <b>{Organizer_email}</b> was not found in Microsoft 365 (404). "
                "Please check the Organizer Email field on this record — it must be a real, "
                f"active mailbox in your organisation's M365 tenant. Details: {_cr_msg}"
            )
        elif res.status_code == 403 or _cr_code in (
            "ErrorAccessDenied",
            "Authorization_RequestDenied",
        ):
            frappe.throw(
                f"Access denied by Microsoft Graph API (403) while creating the event as "
                f"<b>{Organizer_email}</b>. Details: {_cr_msg}"
            )
        else:
            frappe.throw(
                f"Microsoft Graph API error ({res.status_code}) while creating the event: {_cr_msg}"
            )
    event_id = res.json()["id"]

    # ATTACH FILES  (CV / feedback form)
    # Attached to the event so interviewers can access them from the calendar.

    attach_url = f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events/{event_id}/attachments"
    for fname, fb64 in final_files:
        try:
            attach_res = requests.post(
                attach_url,
                headers=headers,
                json={
                    "@odata.type": "#microsoft.graph.fileAttachment",
                    "name": fname,
                    "contentBytes": fb64,
                },
            )
            attach_res.raise_for_status()
        except Exception as _atte:
            frappe.log_error(
                title="INTERVIEW_ATTACHMENT_UPLOAD_FAILED",
                message=f"Failed to attach '{fname}' to event {event_id}: {_atte}",
            )

    # ----------------------------------------
    # FETCH MEETING DETAILS
    # ----------------------------------------
    event_fetch_url = (
        f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events/{event_id}"
    )

    join_web_url = ""
    online_meeting_id = ""

    for attempt in range(10):
        data = requests.get(event_fetch_url, headers=headers)
        json_data = data.json()

        if "onlineMeeting" in json_data and json_data["onlineMeeting"]:
            join_web_url = json_data["onlineMeeting"].get("joinUrl", "")
            online_meeting_id = json_data["onlineMeeting"].get("id", "")
            break

        time.sleep(1)

    join_meeting_id = ""
    join_passcode = ""

    # ---------------------------------------
    # SECONDARY (THE ORIGINAL): onlineMeetings filter (may return empty)
    # ---------------------------------------
    if mode_is_online and join_web_url:
        filter_url = (
            f"https://graph.microsoft.com/v1.0/users/{Organizer_email}"
            f"/onlineMeetings?$filter=JoinWebUrl eq '{join_web_url}'"
        )

        om_res = requests.get(filter_url, headers=headers)
        if om_res.status_code == 200:
            values = om_res.json().get("value", [])
            print("ONLINE MEETING DEBUG:", values)

            if values:
                meeting = values[0]
                join_meeting_id = meeting.get("joinMeetingId", "") or ""
                join_passcode = meeting.get("passcode", "") or ""

    # ----------------------------------------
    # PRIMARY RELIABLE FIX → Extract Meeting ID + Passcode from HTML
    # ----------------------------------------
    if mode_is_online and (not join_meeting_id or not join_passcode):
        try:
            html_body = json_data.get("body", {}).get("content", "")

            # Meeting ID
            m1 = re.search(r"Meeting ID:\s*</span><span[^>]*>([\d\s]+)<", html_body)
            if m1:
                join_meeting_id = m1.group(1).strip()
            else:
                m1b = re.search(r"Meeting ID:\s*([\d\s]+)", html_body)
                if m1b:
                    join_meeting_id = m1b.group(1).strip()

            # Passcode
            m2 = re.search(r"Passcode:\s*</span><span[^>]*>([\w\d]+)<", html_body)
            if m2:
                join_passcode = m2.group(1).strip()
            else:
                m2b = re.search(r"Passcode:\s*([\w\d]+)", html_body)
                if m2b:
                    join_passcode = m2b.group(1).strip()

        except Exception as e:
            print("MEETING HTML PARSE ERROR:", e)

    # ----------------------------------------
    # ONLINE OR OFFLINE HTML
    # ----------------------------------------
    is_valid_online = mode_is_online and join_web_url

    if is_valid_online:
        meeting_html = (
            f"<p><b>Join Teams Meeting:</b> "
            f"<a href='{join_web_url}' target='_blank'>Join Now</a><br>"
            f"<p><b>Meeting ID:</b> {join_meeting_id}<br>"
            f"<b>Passcode:</b> {join_passcode}</p>"
        )
    else:
        meeting_html = ""

    # ----------------------------------------
    # MODE-SPECIFIC CONTENT FOR CANDIDATE EMAIL
    # ----------------------------------------
    _mode_lower = display_mode.lower()
    if _mode_lower == "online":
        candidate_mode_html = meeting_html
    elif _mode_lower == "phone":
        candidate_mode_html = (
            f"<p><b>Candidate Phone No.:</b> {candidate_phone}</p>"
            if candidate_phone
            else ""
        )
    else:  # Face-to-Face (default)
        candidate_mode_html = map_html

    if _mode_lower == "online":
        candidate_advice_html = (
            "<p>For attending the interview through video conference on M S Teams, "
            "please ensure you are in a suitable environment (quiet, well-lit, and with "
            "minimal disturbance). Kindly test your internet connection, webcam, and "
            "microphone in advance.</p>"
        )
    elif _mode_lower == "phone":
        candidate_advice_html = (
            "<p>For attending the interview through phone, please ensure you are in a "
            "suitable environment (quiet, and with minimal disturbance). "
            "Be available for phone call</p>"
        )
    else:  # Face-to-Face
        candidate_advice_html = (
            "<p>Kindly reach the venue <b>15 minutes prior</b> to the assigned time.</p>"
            "<p><b>Travel Reimbursement Policy for Outstation Candidates:</b><br>"
            "(Candidates need to book tickets on their own and then submit the tickets/bills "
            "at the venue for reimbursement to their Bank Account)</p>"
            "<ul>"
            "<li>Up to a distance of 300 Km – Sleeper Class Train or Deluxe Non – AC bus</li>"
            "<li>Above 300 Km candidates – Candidate can travel by 3rd AC Train or AC Sleeper Coach Bus</li>"
            "<li>All local conveyance expenses will be reimbursed on actuals. "
            "Supporting bills are required. Public transport or sharing autos to be preferred.</li>"
            "</ul>"
            "<p>All reimbursements will be done through bank transfer. "
            "Candidates will be required to provide the following details:<br>"
            "<em>(Please bring a Photocopy of your Bank Passbook First page bearing the following)</em></p>"
            "<ul>"
            "<li>Beneficiary Name</li>"
            "<li>Beneficiary Account Number</li>"
            "<li>Beneficiary Bank Name</li>"
            "<li>Bank IFSC Code</li>"
            "</ul>"
            "<p><em>(Please note that all travel reimbursement will be made as per "
            "organization's policy. Bills are compulsory for claim settlements)</em></p>"
            "<p>If you are attending online, be in a suitable environment (quiet, well-lit, "
            "with minimal disturbance) for the interview and kindly test your internet "
            "connection, webcam, and microphone in advance.</p>"
        )

    # ----------------------------------------
    # FINAL EVENT BODY
    # ----------------------------------------
    if is_calibration_arp:
        final_body = calibration_arp_interviewer_template.format(
            Applicants_name=Applicants_name,
            InterviewersName=InterviewersName,
            interview_date_str=interview_date_str,
            feedback_html_block=feedback_html_block,
        )
    elif is_round1:
        final_body = round1_interviewer_template.format(
            Applicants_name=Applicants_name,
            Applicants_Role=Applicants_Role,
            interview_date_str=interview_date_str,
            display_mode=display_mode,
            round_label=round_label,
            interview_time_str=interview_time_str,
            end_time_str=end_time_str,
            InterviewersName=InterviewersName,
            meeting_info=meeting_html,
            phone_info=phone_info_html,
            Map_html=interviewer_location_html,
            feedback_html_block=feedback_html_block,
            demo_feedback_html=demo_feedback_html,
            Note_to_interviewer_html=note_to_interviewer_html,
        )

    elif is_round2:
        final_body = round2_interviewer_template.format(
            Applicants_name=Applicants_name,
            Applicants_Role=Applicants_Role,
            total_exp=total_exp,
            current_ctc=current_ctc,
            expected_ctc=expected_ctc,
            interview_date_str=interview_date_str,
            display_mode=display_mode,
            round_label=round_label,
            interview_time_str=interview_time_str,
            end_time_str=end_time_str,
            InterviewersName=InterviewersName,
            meeting_info=meeting_html,
            phone_info=phone_info_html,
            Map_html=interviewer_location_html,
            feedback_html_block=feedback_html_block,
            Note_to_interviewer_html=note_to_interviewer_html,
        )

    else:
        # Recruiter Round (and any other rounds not handled above).
        # Rebuild from the template now that meeting_html is available,
        # so the Teams link appears in the calendar invite body.
        final_body = round2_interviewer_template.format(
            Applicants_name=Applicants_name,
            Applicants_Role=Applicants_Role,
            total_exp=total_exp,
            current_ctc=current_ctc,
            expected_ctc=expected_ctc,
            interview_date_str=interview_date_str,
            display_mode=display_mode,
            round_label=round_label,
            interview_time_str=interview_time_str,
            end_time_str=end_time_str,
            InterviewersName=InterviewersName,
            meeting_info=meeting_html,
            phone_info=phone_info_html,
            Map_html=interviewer_location_html,
            feedback_html_block=feedback_html_block,
            Note_to_interviewer_html=note_to_interviewer_html,
        )

    # ── Single PATCH — no retry. Retrying sendUpdates sends duplicate invites.
    # 120 s timeout is generous; if Graph times out, the fallback email below covers it.
    _patch_ok = False
    try:
        patch_res = requests.patch(
            event_fetch_url + "?sendUpdates=sendToAllAndSaveCopy",
            headers=headers,
            json={
                "body": {"contentType": "HTML", "content": final_body},
                "attendees": attendees,
                "showAs": "busy",
            },
            timeout=120,
        )
        patch_res.raise_for_status()
        _patch_ok = True
    except Exception as patch_err:
        try:
            _patch_detail = (
                patch_res.text if hasattr(patch_res, "text") else str(patch_err)
            )
        except Exception:
            _patch_detail = str(patch_err)
        frappe.log_error(
            title="Attendees PATCH error",
            message=f"{patch_err} — event {event_id} — response: {_patch_detail[:2000]}",
        )

    # When organizer is also an interviewer, Graph excludes them from attendees so no
    # calendar invite is auto-sent to them. Send a plain email with interview details
    # + feedback form link. Falls back to frappe.sendmail if Graph API lacks Mail.Send permission.
    _self_interviewers = [
        i for i in interviewer_list if i.strip().lower() == _org_email_lower
    ]
    if _self_interviewers:
        _self_sent = False
        try:
            _sr = requests.post(
                f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/sendMail",
                headers=headers,
                json={
                    "message": {
                        "subject": calendar_subject,
                        "body": {"contentType": "HTML", "content": final_body},
                        "toRecipients": [
                            {"emailAddress": {"address": Organizer_email}}
                        ],
                        "attachments": [
                            {
                                "@odata.type": "#microsoft.graph.fileAttachment",
                                "name": fname,
                                "contentBytes": fb64,
                            }
                            for fname, fb64 in final_files
                        ],
                    },
                    "saveToSentItems": True,
                },
                timeout=30,
            )
            _sr.raise_for_status()
            _self_sent = True
        except Exception as _se:
            try:
                frappe.log_error(
                    title="Organizer Interview Email Error",
                    message=str(_se)[:2000],
                )
            except Exception:
                pass

        if not _self_sent:
            # Only claim Organizer_email as the From address if Frappe has a
            # matching outgoing Email Account for it. frappe.sendmail queues
            # the message and actually dispatches it later at db-commit time,
            # outside this try/except — if the SMTP account Frappe is really
            # authenticated as doesn't have Send-As rights for a mismatched
            # From address, Exchange rejects it (SendAsDenied) during commit
            # and crashes the whole request instead of being caught here.
            _org_sender_arg = {}
            if frappe.db.exists(
                "Email Account", {"email_id": Organizer_email, "enable_outgoing": 1}
            ):
                _org_sender_arg = {"sender": Organizer_email}
            try:
                frappe.sendmail(
                    recipients=[Organizer_email],
                    subject=calendar_subject,
                    message=final_body,
                    delayed=False,
                    attachments=[
                        {"fname": fname, "fcontent": base64.b64decode(fb64)}
                        for fname, fb64 in final_files
                    ],
                    **_org_sender_arg,
                )
                _self_sent = True
            except Exception as _fe:
                try:
                    frappe.log_error(
                        title="Organizer Interview Email Fallback Error",
                        message=str(_fe)[:2000],
                    )
                except Exception:
                    pass

    # If PATCH failed after all retries, fall back to a plain email to each interviewer
    # so they at least receive the interview details and feedback form link.
    if not _patch_ok and interviewer_list:
        _iv_send_url = (
            f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/sendMail"
        )
        for _iv_email in interviewer_list:
            _iv_payload = {
                "message": {
                    "subject": calendar_subject,
                    "body": {"contentType": "HTML", "content": final_body},
                    "toRecipients": [{"emailAddress": {"address": _iv_email}}],
                    "ccRecipients": [{"emailAddress": {"address": Organizer_email}}],
                    "attachments": [
                        {
                            "@odata.type": "#microsoft.graph.fileAttachment",
                            "name": fname,
                            "contentBytes": fb64,
                        }
                        for fname, fb64 in final_files
                    ],
                },
                "saveToSentItems": True,
            }
            _iv_graph_sent = False
            try:
                _iv_res = requests.post(
                    _iv_send_url, headers=headers, json=_iv_payload, timeout=30
                )
                _iv_res.raise_for_status()
                _iv_graph_sent = True
            except Exception:
                pass
            if not _iv_graph_sent:
                # See comment above: only pass sender= when a matching Email
                # Account exists, otherwise a mismatched From causes a
                # SendAsDenied crash at commit time instead of being caught.
                _iv_sender_arg = {}
                if frappe.db.exists(
                    "Email Account",
                    {"email_id": Organizer_email, "enable_outgoing": 1},
                ):
                    _iv_sender_arg = {"sender": Organizer_email}
                try:
                    frappe.sendmail(
                        recipients=[_iv_email],
                        cc=[Organizer_email],
                        subject=calendar_subject,
                        message=final_body,
                        delayed=False,
                        attachments=[
                            {"fname": fname, "fcontent": base64.b64decode(fb64)}
                            for fname, fb64 in final_files
                        ],
                        **_iv_sender_arg,
                    )
                except Exception:
                    pass

    # ----------------------------------------
    # EMAIL TO DEMO FEEDBACK INTERVIEWER(S)
    # ----------------------------------------
    # Only sent when demo checkbox is checked AND demo_feedback_interviewers_email is filled.
    # These interviewers receive ONLY the demo feedback form link (not the regular feedback).
    _demo_interviewer_list = list(
        dict.fromkeys(
            e.strip()
            for e in (demo_feedback_interviewers_email or "").split(",")
            if e.strip()
        )
    )

    if demo_feedback_url and _demo_interviewer_list:
        _demo_subject = f"Interview Scheduled \u2013 {Applicants_name} | {round_label} for {Applicants_Role} {candidate_phone}"
        _demo_link_html = _link_block(
            demo_feedback_url, "Demo Lesson Observation Feedback Form"
        )
        _demo_body = (
            "<p>Hi,</p>"
            f"<p>An interview with <b>{Applicants_name}</b> for the role of "
            f"<b>{Applicants_Role}</b> has been confirmed. "
            "Please find the details below.</p>"
            "<p>"
            f"<b>Date:</b> {interview_date_str}<br>"
            f"<b>Interview Mode:</b> {display_mode}<br>"
            f"<b>Interview Round:</b> {round_label}<br>"
            f"<b>Interview Time:</b> {interview_time_str} \u2013 {end_time_str}<br>"
            "</p>"
            + interviewer_location_html
            + _demo_link_html
            + "<p>Regards,<br>People Function</p>"
        )
        _demo_send_url = (
            f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/sendMail"
        )
        for _dmail in _demo_interviewer_list:
            _dpayload = {
                "message": {
                    "subject": _demo_subject,
                    "body": {"contentType": "HTML", "content": _demo_body},
                    "toRecipients": [{"emailAddress": {"address": _dmail}}],
                    "ccRecipients": [{"emailAddress": {"address": Organizer_email}}],
                },
                "saveToSentItems": True,
            }
            _demo_graph_sent = False
            try:
                _dr = requests.post(
                    _demo_send_url, headers=headers, json=_dpayload, timeout=30
                )
                _dr.raise_for_status()
                _demo_graph_sent = True
            except Exception as _derr:
                try:
                    frappe.log_error(
                        title="Demo Feedback Email Error", message=str(_derr)[:2000]
                    )
                except Exception:
                    pass

            # Fallback: frappe.sendmail if Graph API failed
            if not _demo_graph_sent:
                # See comment near the organizer self-email fallback above:
                # only pass sender= when a matching Email Account exists.
                _demo_sender_arg = {}
                if frappe.db.exists(
                    "Email Account",
                    {"email_id": Organizer_email, "enable_outgoing": 1},
                ):
                    _demo_sender_arg = {"sender": Organizer_email}
                try:
                    frappe.sendmail(
                        recipients=[_dmail],
                        cc=[Organizer_email],
                        subject=_demo_subject,
                        message=_demo_body,
                        delayed=False,
                        **_demo_sender_arg,
                    )
                except Exception as _dfallback_err:
                    try:
                        frappe.log_error(
                            title="Demo Feedback Email Fallback Error",
                            message=str(_dfallback_err)[:2000],
                        )
                    except Exception:
                        pass

    # ----------------------------------------
    # EMAIL TO CANDIDATE
    # Skipped for Calibration Process + Associate Resource Person
    # (only the interviewer receives an email in that scenario)
    # ----------------------------------------
    if not is_calibration_arp:
        candidate_email_subject = f"Interview Scheduled \u2013 {Applicants_name} | {round_label} for {Applicants_Role}"

        candidate_email_body = candidate_template.format(
            Applicants_name=Applicants_name,
            Applicants_Role=Applicants_Role,
            round_label=round_label,
            interview_date_str=interview_date_str,
            interview_time_str=interview_time_str,
            end_time_str=end_time_str,
            display_mode=display_mode,
            candidate_mode_html=candidate_mode_html,
            Note_to_candidate_html=note_to_candidate_html,
            candidate_advice_html=candidate_advice_html,
        )

        # Send candidate email FROM whatever address is filled into the
        # candidate-sender field on this record. Different sites have ended
        # up with different auto-generated fieldnames for the same "Candidate
        # Email Sender" label (e.g. candidate_email_sendar vs
        # candidate_email_sender), so check the doctype meta for whichever
        # one actually exists here instead of hardcoding a single name.
        # Falls back to the field recruitment mailbox if no such field
        # exists or it's left blank. The interviewer/organizer mailbox is
        # never used here — it's only for the interviewer-facing email.
        _candidate_sender_email = _CANDIDATE_SENDER_EMAIL
        if doc_name:
            try:
                _fis_meta = frappe.get_meta("Field Interview Schedule")
                _sender_fieldname = next(
                    (
                        fn
                        for fn in (
                            "candidate_email_sendar",
                            "candidate_email_sender",
                        )
                        if _fis_meta.has_field(fn)
                    ),
                    None,
                )
                if _sender_fieldname:
                    _configured_sender = (
                        frappe.db.get_value(
                            "Field Interview Schedule", doc_name, _sender_fieldname
                        )
                        or ""
                    ).strip()
                    if _configured_sender:
                        _candidate_sender_email = _configured_sender
            except Exception:
                pass
        _candidate_sender = (
            _CANDIDATE_SENDER
            if _candidate_sender_email == _CANDIDATE_SENDER_EMAIL
            else _candidate_sender_email
        )

        # Skip if candidate is the same person as the organizer or any interviewer
        # (they already received the interviewer email; sending a second one is confusing).
        _all_interviewer_emails_lower = {
            e.strip().lower() for e in interviewer_list if e.strip()
        }
        _all_interviewer_emails_lower.add(_org_email_lower)
        _is_same_person = (
            interviewee_email.strip().lower() in _all_interviewer_emails_lower
        )

        if not interviewee_email:
            frappe.log_error(
                f"Candidate email (attendees) is empty for doc {doc_name}. Skipping candidate email.",
                "Candidate Email Skipped",
            )
        elif _is_same_person:
            pass  # candidate is the interviewer/organizer — they already got the interviewer email
        else:
            _graph_cand_sent = False
            _cand_msg = {
                "subject": candidate_email_subject,
                "body": {"contentType": "HTML", "content": candidate_email_body},
                "toRecipients": [{"emailAddress": {"address": interviewee_email}}],
            }

            # Attempt 1: send directly from the candidate sender mailbox via Graph.
            _gc1_err = ""
            try:
                _gc1 = requests.post(
                    f"https://graph.microsoft.com/v1.0/users/{_candidate_sender_email}/sendMail",
                    headers=headers,
                    json={"message": _cand_msg, "saveToSentItems": True},
                    timeout=30,
                )
                _gc1_err = _gc1.text
                _gc1.raise_for_status()
                _graph_cand_sent = True
            except Exception as _gc1_exc:
                try:
                    frappe.log_error(
                        title="Candidate Email Graph Attempt 1",
                        message=(_gc1_err or str(_gc1_exc))[:2000],
                    )
                except Exception:
                    pass

            # Attempt 2: frappe.sendmail via Frappe's own outgoing Email Account.
            # IMPORTANT: only claim the candidate sender mailbox as the From
            # address if a matching Email Account has real, working outgoing
            # credentials (enable_outgoing=1). Without that, Frappe has to
            # authenticate via some OTHER account's SMTP session while
            # stamping a From header that account isn't allowed to send as —
            # the mail server then rejects it with SMTPDataError deep inside
            # the Email Queue flush, a step that runs outside this
            # try/except and crashes the entire "schedule interview" request
            # with a 500. Until the intended sender mailbox has its own
            # working outgoing Email Account (or Send-As delegation), it's
            # safer to fall back to whichever account already works, and
            # just log that fact.
            if not _graph_cand_sent:
                _cand_sender_arg = {}
                if frappe.db.exists(
                    "Email Account",
                    {"email_id": _candidate_sender_email, "enable_outgoing": 1},
                ):
                    _cand_sender_arg = {"sender": _candidate_sender}
                else:
                    try:
                        frappe.log_error(
                            title="Candidate Email Sender Fallback",
                            message=(
                                f"No working outgoing Email Account for "
                                f"{_candidate_sender_email}; candidate email for "
                                f"{interviewee_email} was sent from the site's "
                                f"default outgoing Email Account instead to avoid "
                                f"an SMTP SendAsDenied crash."
                            ),
                        )
                    except Exception:
                        pass
                try:
                    frappe.sendmail(
                        recipients=[interviewee_email],
                        subject=candidate_email_subject,
                        message=candidate_email_body,
                        delayed=False,
                        **_cand_sender_arg,
                    )
                    _graph_cand_sent = True
                except Exception as _cand_fb_err:
                    try:
                        frappe.log_error(
                            title="Candidate Email Frappe Sendmail Attempt",
                            message=str(_cand_fb_err)[:2000],
                        )
                    except Exception:
                        pass

            if not _graph_cand_sent:
                try:
                    frappe.log_error(
                        title="Candidate Email Not Sent",
                        message=f"All delivery attempts failed for {interviewee_email}",
                    )
                except Exception:
                    pass

    # Save event_id to the document so reschedule can cancel it later
    if doc_name:
        try:
            frappe.db.set_value(
                "Field Interview Schedule",
                doc_name,
                "ms_event_id",
                event_id,
                update_modified=False,
            )
        except Exception:
            pass

    # ── SMS + WhatsApp notification ───────────────────────────────────────────
    try:
        from ms_calendar.ms_calendar.sms_utils import send_sms, send_whatsapp

        _notify_phone = (candidate_phone or "").strip()
        if not _notify_phone and application_id:
            _notify_phone = (
                frappe.db.get_value(
                    "Field Registration Form", application_id, "phone_number"
                )
                or ""
            )
        _full_name = ""
        if application_id:
            _full_name = (
                frappe.db.get_value(
                    "Field Registration Form", application_id, "full_name_aadhaar"
                )
                or ""
            )
        if _notify_phone and Interview_round:
            _notify_kwargs = dict(
                phone=_notify_phone,
                status=Interview_round,
                applicant_id=application_id or "",
                applicant_name=Applicants_name or "",
                full_name_aadhaar=_full_name,
                triggered_from="Interview Schedule",
            )
            send_sms(**_notify_kwargs)
            send_whatsapp(**_notify_kwargs)
    except Exception:
        frappe.log_error(
            frappe.get_traceback(), "Interview Schedule SMS/WhatsApp Failed"
        )

    frappe.msgprint("✅ Event created successfully. Outlook invite sent.")

    return {
        "event_id": event_id,
        "join_url": join_web_url,
        "meeting_id": join_meeting_id,
        "passcode": join_passcode,
        "is_online": is_online,
    }


# ── Assessment Upload Template Download ──────────────────────────────────────
@frappe.whitelist()
def download_assessment_template():
    """Generate and return the Assessment Upload Template Excel file as base64."""
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    from openpyxl.worksheet.protection import SheetProtection

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Assessment Upload"

    headers = [
        "Candidate ID",
        "Job code",
        "Job Title",
        "Name",
        "Email ID",
        "Contact Number",
        "Applied Subject",
        "Test Subject",
        "Secured Score",
        "Total Score",
        "Percentage",
        "Remarks",
    ]
    ws.append(headers)

    # Style header row
    header_fill = PatternFill(
        start_color="4472C4", end_color="4472C4", fill_type="solid"
    )
    header_font = Font(bold=True, color="FFFFFF")
    thin_border = Border(
        left=Side(style="thin"),
        right=Side(style="thin"),
        top=Side(style="thin"),
        bottom=Side(style="thin"),
    )
    for cell in ws[1]:
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(
            horizontal="center", vertical="center", wrap_text=True
        )
        cell.border = thin_border
        # Lock header cells
        cell.protection = openpyxl.styles.Protection(locked=True)

    ws.row_dimensions[1].height = 30

    # Unlock all data rows (row 2 onwards) so users can type in them
    unlocked = openpyxl.styles.Protection(locked=False)
    for row in ws.iter_rows(min_row=2, max_row=1000, min_col=1, max_col=len(headers)):
        for cell in row:
            cell.protection = unlocked

    # Column widths
    col_widths = [15, 12, 20, 20, 25, 18, 20, 20, 15, 12, 12, 20]
    for i, width in enumerate(col_widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = width

    # Protect the sheet — header locked, data rows editable, no password needed
    ws.protection = SheetProtection(
        sheet=True, selectLockedCells=False, selectUnlockedCells=False, password=""
    )

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    file_b64 = base64.b64encode(output.read()).decode("utf-8")
    return {"file_content": file_b64, "filename": "Assessment Upload Template.xlsx"}


# ── Field Overall Dashboard ────────────────────────────────────────────────────

_FOD_STAGES = [
    {
        "stage": "Applications",
        "color": "FFF2CC",
        "rows": [
            {
                "label": "Carried forward Application from last year Before April",
                "key": "carried_forward",
            },
            {"label": "Received from April this Year", "key": "received_this_year"},
            {"label": "Total Applications", "key": "total", "is_total": True},
        ],
    },
    {
        "stage": "CV screening",
        "color": "C6E0B4",
        "rows": [
            {"label": "Shortlist", "key": "cv_shortlist"},
            {"label": "Regret", "key": "cv_regret"},
            {"label": "Pending", "key": "cv_pending"},
        ],
    },
    {
        "stage": "Written test",
        "color": "BDD7EE",
        "rows": [
            {"label": "Select", "key": "written_select"},
            {"label": "Regret", "key": "written_regret"},
        ],
    },
    {
        "stage": "Recruiter screening",
        "color": "C6E0B4",
        "rows": [
            {"label": "Select", "key": "recruiter_select"},
            {"label": "Regret", "key": "recruiter_regret"},
            {"label": "Pending", "key": "recruiter_pending"},
        ],
    },
    {
        "stage": "Functional round",
        "color": "BDD7EE",
        "rows": [
            {"label": "Select", "key": "functional_select"},
            {"label": "Regret", "key": "functional_regret"},
            {"label": "Scheduled", "key": "functional_scheduled"},
            {"label": "Feedback Pending", "key": "functional_feedback_pending"},
            {"label": "Pending", "key": "functional_pending"},
        ],
    },
    {
        "stage": "Final round",
        "color": "FCE4D6",
        "rows": [
            {"label": "Select", "key": "final_select"},
            {"label": "Regret", "key": "final_regret"},
            {"label": "Scheduled", "key": "final_scheduled"},
            {"label": "Feedback Pending", "key": "final_feedback_pending"},
            {"label": "Pending", "key": "final_pending"},
        ],
    },
    {
        "stage": "Offers",
        "color": "F4B942",
        "rows": [
            {"label": "Offer in process", "key": "offer_in_process"},
            {"label": "Offer Made", "key": "offer_made"},
            {"label": "Offer Accepted", "key": "offer_accepted"},
            {"label": "Joined", "key": "joined"},
            {"label": "Offer declined", "key": "offer_declined"},
            {"label": "Offer Revoked", "key": "offer_revoked"},
            {
                "label": "Joined in 2025-26, Offered in 2025-26",
                "key": "joined_offered_current",
            },
            {
                "label": "Joined in 2025-26, Offered in 2024-25",
                "key": "joined_offered_prev",
            },
        ],
    },
]

_FOD_STATUS_TO_KEY = {
    "Applied": "cv_pending",
    "Shortlisted": "cv_shortlist",
    "Rejected": "cv_regret",
    "Interview Scheduled": "functional_scheduled",
    "Selected": "joined",
    "On Hold": "offer_in_process",
}

_FOD_ROLE_TO_COL = {
    "School Teacher": "ST",
    "Resource Person": "RP",
    "District Resource Person": "RP",
    "Cluster Resource Person": "RP",
    "Associate Resource Person": "RP",
}

_FOD_COLS = ["RP", "ST", "HL", "LH"]

_FOD_ALL_KEYS = [
    "carried_forward",
    "received_this_year",
    "total",
    "cv_shortlist",
    "cv_regret",
    "cv_pending",
    "written_select",
    "written_regret",
    "recruiter_select",
    "recruiter_regret",
    "recruiter_pending",
    "functional_select",
    "functional_regret",
    "functional_scheduled",
    "functional_feedback_pending",
    "functional_pending",
    "final_select",
    "final_regret",
    "final_scheduled",
    "final_feedback_pending",
    "final_pending",
    "offer_in_process",
    "offer_made",
    "offer_accepted",
    "joined",
    "offer_declined",
    "offer_revoked",
    "joined_offered_current",
    "joined_offered_prev",
]


@frappe.whitelist()
def get_field_overall_dashboard():
    from datetime import date

    records = frappe.db.sql(
        """
        SELECT native_state, role, application_status, creation
        FROM `tabField Registration Form`
        WHERE docstatus != 2
        """,
        as_dict=True,
    )

    states = sorted(set(r["native_state"] for r in records if r["native_state"]))
    april_1 = date(date.today().year, 4, 1)

    all_entries = states + ["Grand Total"]
    data = {
        entry: {col: {k: 0 for k in _FOD_ALL_KEYS} for col in _FOD_COLS}
        for entry in all_entries
    }

    for record in records:
        state = record["native_state"]
        if not state:
            continue
        col = _FOD_ROLE_TO_COL.get(record["role"] or "")
        if not col:
            continue

        creation_date = (
            record["creation"].date() if record["creation"] else date.today()
        )
        status_key = _FOD_STATUS_TO_KEY.get(record["application_status"] or "")

        for entry in [state, "Grand Total"]:
            data[entry][col]["total"] += 1
            if creation_date < april_1:
                data[entry][col]["carried_forward"] += 1
            else:
                data[entry][col]["received_this_year"] += 1
            if status_key:
                data[entry][col][status_key] += 1

    return {"states": states, "data": data}


@frappe.whitelist()
def download_field_dashboard_excel():
    from datetime import date as date_cls
    import openpyxl
    from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    raw = get_field_overall_dashboard()
    states = raw["states"]
    data = raw["data"]

    all_col_groups = states + ["Grand Total"]
    SUB_COLS = _FOD_COLS + ["Total"]

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Field Dashboard"

    # ── helper styles ──
    thin = Side(style="thin", color="000000")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    def make_fill(hex_color):
        return PatternFill("solid", fgColor=hex_color)

    hdr_fill = make_fill("1F497D")
    hdr_font = Font(bold=True, color="FFFFFF", size=10)
    sub_hdr_fill = make_fill("4472C4")
    stage_font = Font(bold=True, size=9)
    data_font = Font(size=9)
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    left = Alignment(horizontal="left", vertical="center", wrap_text=True)

    STATE_FILLS = [
        "DDEBF7",
        "E2EFDA",
        "FFF2CC",
        "FCE4D6",
        "D9E1F2",
        "EAF4E2",
        "FDE9D9",
        "EBE9F3",
        "D5E8D4",
        "FFF9C4",
    ]

    def cell_style(ws_cell, fill=None, font=None, align=None, brd=border):
        if fill:
            ws_cell.fill = fill
        if font:
            ws_cell.font = font
        if align:
            ws_cell.alignment = align
        ws_cell.border = brd

    # ── Row 1: Date of Report header ──
    ws.cell(1, 1, f"Date of Report: {date_cls.today().strftime('%d-%b-%Y')}")
    ws.cell(1, 1).font = Font(bold=True, size=10)
    ws.cell(1, 1).alignment = center

    # ── Row 2: column headers - "Stages | Status | [State RP ST HL LH Total] ... | Grand Total RP ST HL LH Total" ──
    ws.cell(2, 1, "Stages")
    ws.cell(2, 2, "Status")
    for c in [ws.cell(2, 1), ws.cell(2, 2)]:
        cell_style(c, fill=make_fill("1F497D"), font=hdr_font, align=center)

    col_cursor = 3
    for gi, grp in enumerate(all_col_groups):
        fill_hex = STATE_FILLS[gi % len(STATE_FILLS)]
        grp_fill = make_fill(fill_hex)
        # Merge state header across sub-columns
        ws.merge_cells(
            start_row=2,
            start_column=col_cursor,
            end_row=2,
            end_column=col_cursor + len(SUB_COLS) - 1,
        )
        hc = ws.cell(2, col_cursor, grp)
        cell_style(hc, fill=grp_fill, font=Font(bold=True, size=9), align=center)
        col_cursor += len(SUB_COLS)

    # ── Row 3: sub-column headers (RP ST HL LH Total repeated per group) ──
    ws.cell(3, 1, "Stages")
    ws.cell(3, 2, "Status")
    for c in [ws.cell(3, 1), ws.cell(3, 2)]:
        cell_style(c, fill=make_fill("1F497D"), font=hdr_font, align=center)

    col_cursor = 3
    for gi, grp in enumerate(all_col_groups):
        fill_hex = STATE_FILLS[gi % len(STATE_FILLS)]
        sub_fill = make_fill(fill_hex)
        for sc in SUB_COLS:
            c = ws.cell(3, col_cursor, sc)
            cell_style(c, fill=sub_fill, font=Font(bold=True, size=8), align=center)
            col_cursor += 1

    # ── Data rows ──
    row_cursor = 4
    for stage_cfg in _FOD_STAGES:
        stage_fill = make_fill(stage_cfg["color"])
        stage_rows = stage_cfg["rows"]
        row_start = row_cursor

        for ri, row_cfg in enumerate(stage_rows):
            key = row_cfg["key"]
            is_total = row_cfg.get("is_total", False)
            row_fill = make_fill("D9D9D9") if is_total else stage_fill
            row_font = Font(bold=True, size=9) if is_total else data_font

            # Status label (col 2)
            sc = ws.cell(row_cursor, 2, row_cfg["label"])
            cell_style(sc, fill=row_fill, font=row_font, align=left)

            # Data columns
            col_cursor = 3
            for grp in all_col_groups:
                grp_data = data.get(grp, {})
                row_total = 0
                for sub_col in _FOD_COLS:
                    val = grp_data.get(sub_col, {}).get(key, 0)
                    dc = ws.cell(row_cursor, col_cursor, val if val else "")
                    cell_style(dc, fill=row_fill, font=row_font, align=center)
                    row_total += val
                    col_cursor += 1
                # Total column for this group
                tc = ws.cell(row_cursor, col_cursor, row_total if row_total else "")
                cell_style(
                    tc,
                    fill=make_fill("D9D9D9") if is_total else row_fill,
                    font=Font(bold=True, size=9) if is_total else row_font,
                    align=center,
                )
                col_cursor += 1

            row_cursor += 1

        # Stage label cell with rowspan (merge)
        ws.merge_cells(
            start_row=row_start, start_column=1, end_row=row_cursor - 1, end_column=1
        )
        sc = ws.cell(row_start, 1, stage_cfg["stage"])
        cell_style(sc, fill=stage_fill, font=Font(bold=True, size=9), align=center)

    # ── Column widths ──
    ws.column_dimensions["A"].width = 18
    ws.column_dimensions["B"].width = 38
    total_data_cols = len(all_col_groups) * len(SUB_COLS)
    for ci in range(3, 3 + total_data_cols):
        ws.column_dimensions[get_column_letter(ci)].width = 6

    # Freeze panes after header rows and stage/status columns
    ws.freeze_panes = "C4"

    # ── Row heights ──
    ws.row_dimensions[1].height = 20
    ws.row_dimensions[2].height = 30
    ws.row_dimensions[3].height = 20

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    frappe.local.response.filename = "Field_Overall_Dashboard.xlsx"
    frappe.local.response.filecontent = output.read()
    frappe.local.response.type = "binary"


# ── Field Overall Dashboard Excel (Field Registration Form1) ──────────────────

_FOV_STATUS_TO_KEY = {
    "New Applicant": "cv_pending",
    "CV Shortlist": "cv_shortlist",
    "CV Reject": "cv_regret",
    "Test Process": "written_select",
    "Test Select": "written_select",
    "Test Reject": "written_regret",
    "Recruiter Round": "recruiter_select",
    "Recruiter Reject": "recruiter_regret",
    "Round One": "functional_select",
    "Round 1 Reject": "functional_regret",
    "Round Two": "final_select",
    "Round 2 Reject": "final_regret",
    "Round Three": "final_select",
    "Round 3 Reject": "final_regret",
    "Document Collection": "offer_in_process",
    "Offer": "offer_made",
    "Offer Accepted": "offer_accepted",
    "Joined": "joined",
    "Offer Declined": "offer_declined",
    "Offer Revoked": "offer_revoked",
    "Applied": "cv_pending",
    "Shortlisted": "cv_shortlist",
    "Rejected": "cv_regret",
    "Interview Scheduled": "functional_scheduled",
    "Selected": "joined",
    "On Hold": "offer_in_process",
}

_FOV_STAGES = [
    (
        "Applications",
        "FFF9C4",
        [
            (
                "Carried forward Application from last year Before April",
                "carried_forward",
                False,
            ),
            ("Received from April this Year", "received_this_year", False),
            ("Total Applications", "total", True),
        ],
    ),
    (
        "CV screening",
        "DCEDC8",
        [
            ("Shortlist", "cv_shortlist", False),
            ("Regret", "cv_regret", False),
            ("Pending", "cv_pending", False),
        ],
    ),
    (
        "Written test",
        "BBDEFB",
        [
            ("Select", "written_select", False),
            ("Regret", "written_regret", False),
        ],
    ),
    (
        "Recruiter screening",
        "DCEDC8",
        [
            ("Select", "recruiter_select", False),
            ("Regret", "recruiter_regret", False),
            ("Pending", "recruiter_pending", False),
        ],
    ),
    (
        "Functional round",
        "BBDEFB",
        [
            ("Select", "functional_select", False),
            ("Regret", "functional_regret", False),
            ("Scheduled", "functional_scheduled", False),
            ("Feedback Pending", "functional_feedback_pending", False),
            ("Pending", "functional_pending", False),
        ],
    ),
    (
        "Final round",
        "FFCCBC",
        [
            ("Select", "final_select", False),
            ("Regret", "final_regret", False),
            ("Scheduled", "final_scheduled", False),
            ("Feedback Pending", "final_feedback_pending", False),
            ("Pending", "final_pending", False),
        ],
    ),
    (
        "Offers",
        "FFE0B2",
        [
            ("Offer in process", "offer_in_process", False),
            ("Offer Made", "offer_made", False),
            ("Offer Accepted", "offer_accepted", False),
            ("Joined", "joined", False),
            ("Offer declined", "offer_declined", False),
            ("Offer Revoked", "offer_revoked", False),
            ("Joined in 2025-26, Offered in 2025-26", "joined_offered_current", False),
            ("Joined in 2025-26, Offered in 2024-25", "joined_offered_prev", False),
        ],
    ),
]

_FOV_ALL_KEYS = [
    "carried_forward",
    "received_this_year",
    "total",
    "cv_shortlist",
    "cv_regret",
    "cv_pending",
    "written_select",
    "written_regret",
    "recruiter_select",
    "recruiter_regret",
    "recruiter_pending",
    "functional_select",
    "functional_regret",
    "functional_scheduled",
    "functional_feedback_pending",
    "functional_pending",
    "final_select",
    "final_regret",
    "final_scheduled",
    "final_feedback_pending",
    "final_pending",
    "offer_in_process",
    "offer_made",
    "offer_accepted",
    "joined",
    "offer_declined",
    "offer_revoked",
    "joined_offered_current",
    "joined_offered_prev",
]

DATA_COLS = ["RP", "ST", "HL", "LH"]
SUB_COLS = ["RP", "ST", "HL", "LH", "Total"]


def _fov_get_col(role, department):
    dept = (department or "").lower().strip()
    if dept == "health":
        return "HL"
    if dept in ("livelihood", "livelihoods"):
        return "LH"
    if role == "School Teacher":
        return "ST"
    if role in (
        "Resource Person",
        "District Resource Person",
        "Cluster Resource Person",
        "Associate Resource Person",
    ):
        return "RP"
    return None


@frappe.whitelist()
def download_field_overall_excel(from_date=None, to_date=None):
    from datetime import date as date_cls
    import openpyxl
    from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    # ── Query ──
    filters = [["docstatus", "!=", "2"]]
    if from_date:
        filters.append(["creation", ">=", from_date + " 00:00:00"])
    if to_date:
        filters.append(["creation", "<=", to_date + " 23:59:59"])

    try:
        records = frappe.db.sql(
            """
            SELECT native_state, role, department, location, worklocation,
                   application_status, creation
            FROM `tabField Registration Form1`
            WHERE docstatus != 2
            {date_filters}
            """.format(
                date_filters=(
                    ("AND creation >= %(fd)s" if from_date else "")
                    + (" AND creation <= %(td)s" if to_date else "")
                )
            ),
            {
                "fd": from_date + " 00:00:00" if from_date else None,
                "td": to_date + " 23:59:59" if to_date else None,
            },
            as_dict=True,
        )
    except Exception:
        # fallback to Field Registration Form if Form1 doesn't exist
        records = frappe.db.sql(
            """SELECT native_state, role, department, location, worklocation,
                      application_status, creation
               FROM `tabField Registration Form` WHERE docstatus != 2""",
            as_dict=True,
        )

    april_1 = date_cls(date_cls.today().year, 4, 1)

    states = sorted(
        set(
            (
                r.get("location")
                or r.get("worklocation")
                or r.get("native_state")
                or "Unknown"
            ).strip()
            for r in records
            if (r.get("location") or r.get("worklocation") or r.get("native_state"))
        )
    )
    all_entries = states + ["Grand Total"]

    data = {
        e: {c: {k: 0 for k in _FOV_ALL_KEYS} for c in DATA_COLS} for e in all_entries
    }

    for rec in records:
        state = (
            (rec.get("location") or "").strip()
            or (rec.get("worklocation") or "").strip()
            or (rec.get("native_state") or "").strip()
            or ""
        )
        if not state:
            continue  # skip records with no state data
        col = _fov_get_col(rec.get("role") or "", rec.get("department") or "")
        if not col:
            continue
        if state not in data:
            # add dynamically in case state wasn't in initial set
            data[state] = {c: {k: 0 for k in _FOV_ALL_KEYS} for c in DATA_COLS}
            if state not in all_entries:
                all_entries.insert(-1, state)  # insert before Grand Total

        creation_date = (
            rec["creation"].date() if rec.get("creation") else date_cls.today()
        )
        sk = _FOV_STATUS_TO_KEY.get(rec.get("application_status") or "")

        for entry in [state, "Grand Total"]:
            data[entry][col]["total"] += 1
            if creation_date < april_1:
                data[entry][col]["carried_forward"] += 1
            else:
                data[entry][col]["received_this_year"] += 1
            if sk:
                data[entry][col][sk] += 1

    # ── Build Excel ──
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Field Dashboard"

    thin = Side(style="thin", color="AAAAAA")
    bdr = Border(left=thin, right=thin, top=thin, bottom=thin)
    ctr = Alignment(horizontal="center", vertical="center", wrap_text=True)
    lft = Alignment(horizontal="left", vertical="center", wrap_text=True)

    def fill(hex_):
        return PatternFill("solid", fgColor=hex_)

    def font(bold=False, color="000000", size=9):
        return Font(bold=bold, color=color, size=size)

    def cell(ws_, r, c, val="", bg=None, fg="000000", bold=False, align=None):
        cl = ws_.cell(r, c, val)
        if bg:
            cl.fill = fill(bg)
        cl.font = font(bold=bold, color=fg, size=9)
        cl.border = bdr
        cl.alignment = align or ctr
        return cl

    HDR_BG, HDR_FG = "2C5F8A", "FFFFFF"
    TOT_BG = "E0E0E0"
    RTOT_BG = "BDBDBD"
    GRAND_BG = "1e3a5f"

    # Row 1 – date of report
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=2)
    cell(
        ws,
        1,
        1,
        f"Date of Report: {date_cls.today().strftime('%d-%b-%Y')}",
        bg="FFFFFF",
        bold=True,
        align=lft,
    )

    # Row 2 – state headers
    cell(ws, 2, 1, "Stages", bg=HDR_BG, fg=HDR_FG, bold=True)
    cell(ws, 2, 2, "Status", bg=HDR_BG, fg=HDR_FG, bold=True)
    col_cur = 3
    for gi, grp in enumerate(all_entries):
        bg = (
            GRAND_BG
            if gi == len(all_entries) - 1
            else ("DDEBF7" if gi % 2 == 0 else "EBF3FB")
        )
        fg = "FFFFFF" if gi == len(all_entries) - 1 else "1e293b"
        ws.merge_cells(
            start_row=2,
            start_column=col_cur,
            end_row=2,
            end_column=col_cur + len(SUB_COLS) - 1,
        )
        cell(ws, 2, col_cur, grp, bg=bg, fg=fg, bold=True)
        col_cur += len(SUB_COLS)

    # Row 3 – sub-column headers (RP ST HL LH Total)
    cell(ws, 3, 1, "Stages", bg=HDR_BG, fg=HDR_FG, bold=True)
    cell(ws, 3, 2, "Status", bg=HDR_BG, fg=HDR_FG, bold=True)
    col_cur = 3
    for gi in range(len(all_entries)):
        bg = (
            GRAND_BG
            if gi == len(all_entries) - 1
            else ("DDEBF7" if gi % 2 == 0 else "EBF3FB")
        )
        fg = "FFFFFF" if gi == len(all_entries) - 1 else "374151"
        for sc in SUB_COLS:
            cell(ws, 3, col_cur, sc, bg=bg, fg=fg, bold=(sc == "Total"))
            col_cur += 1

    # Data rows
    row_cur = 4
    for stage_name, stage_hex, rows in _FOV_STAGES:
        row_start = row_cur
        for row_label, key, is_total in rows:
            rbg = RTOT_BG if is_total else stage_hex
            rfg = "000000"

            cell(ws, row_cur, 2, row_label, bg=rbg, fg=rfg, align=lft)

            col_cur = 3
            for gi, grp in enumerate(all_entries):
                is_grand = gi == len(all_entries) - 1
                nbg = GRAND_BG if is_grand else rbg
                nfg = "FFFFFF" if is_grand else rfg

                row_total = 0
                for dc in DATA_COLS:
                    v = data.get(grp, {}).get(dc, {}).get(key, 0)
                    cell(ws, row_cur, col_cur, v if v else "", bg=nbg, fg=nfg)
                    row_total += v
                    col_cur += 1

                tot_bg = (
                    ("0a1d30" if is_total else "16304d")
                    if is_grand
                    else ("9E9E9E" if is_total else TOT_BG)
                )
                tot_fg = "FFFFFF" if is_grand else "000000"
                cell(
                    ws,
                    row_cur,
                    col_cur,
                    row_total if row_total else "",
                    bg=tot_bg,
                    fg=tot_fg,
                    bold=True,
                )
                col_cur += 1

            row_cur += 1

        # Stage label with rowspan
        ws.merge_cells(
            start_row=row_start, start_column=1, end_row=row_cur - 1, end_column=1
        )
        cell(ws, row_start, 1, stage_name, bg=stage_hex, bold=True)

    # Column widths
    ws.column_dimensions["A"].width = 18
    ws.column_dimensions["B"].width = 38
    for ci in range(3, 3 + len(all_entries) * len(SUB_COLS)):
        ws.column_dimensions[get_column_letter(ci)].width = 6

    ws.freeze_panes = "C4"
    ws.row_dimensions[2].height = 22
    ws.row_dimensions[3].height = 18

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    frappe.local.response.filename = "Field_Overall_Dashboard.xlsx"
    frappe.local.response.filecontent = output.read()
    frappe.local.response.type = "binary"


# ── School Teacher Dashboard Excel ────────────────────────────────────────────

_STD_STAGES = [
    {
        "stage": "Candidate Applications",
        "color": "FFF2CC",
        "rows": [
            {"label": "Total Received", "key": "total_received", "is_total": True},
            {"label": "Shortlisted", "key": "cv_shortlist"},
            {"label": "Regret", "key": "cv_regret"},
            {"label": "Pending", "key": "cv_pending"},
        ],
    },
    {
        "stage": "Written Assessment",
        "color": "BDD7EE",
        "rows": [
            {"label": "Select", "key": "written_select"},
            {"label": "Regret", "key": "written_regret"},
            {"label": "Scheduled", "key": "written_scheduled"},
            {"label": "Absent", "key": "written_absent"},
            {"label": "Pending", "key": "written_pending"},
        ],
    },
    {
        "stage": "Recruiter Round",
        "color": "C6E0B4",
        "rows": [
            {"label": "Select", "key": "recruiter_select"},
            {"label": "Regret", "key": "recruiter_regret"},
            {"label": "Scheduled", "key": "recruiter_scheduled"},
            {"label": "Pending", "key": "recruiter_pending"},
        ],
    },
    {
        "stage": "Functional Round",
        "color": "D9E8FB",
        "rows": [
            {"label": "Select", "key": "functional_select"},
            {"label": "Regret", "key": "functional_regret"},
            {"label": "Scheduled", "key": "functional_scheduled"},
            {"label": "Pending", "key": "functional_pending"},
        ],
    },
    {
        "stage": "Final Round",
        "color": "FCE4D6",
        "rows": [
            {"label": "Select", "key": "final_select"},
            {"label": "Regret", "key": "final_regret"},
            {"label": "Scheduled", "key": "final_scheduled"},
            {"label": "Pending", "key": "final_pending"},
        ],
    },
    {
        "stage": "Offer",
        "color": "F4B942",
        "rows": [
            {"label": "Offer Made", "key": "offer_made"},
            {"label": "Offer Accepted", "key": "offer_accepted"},
            {"label": "Offer Declined", "key": "offer_declined"},
            {"label": "Offer Revoked", "key": "offer_revoked"},
            {"label": "Joined", "key": "joined"},
        ],
    },
]

_STD_STATUS_TO_KEY = {
    "New Applicant": "cv_pending",
    "CV Shortlist": "cv_shortlist",
    "CV Reject": "cv_regret",
    "Test Process": "written_select",
    "Test Select": "written_select",
    "Test Reject": "written_regret",
    "Test Scheduled": "written_scheduled",
    "Test Absent": "written_absent",
    "Recruiter Round": "recruiter_select",
    "Recruiter Reject": "recruiter_regret",
    "Recruiter Scheduled": "recruiter_scheduled",
    "Round One": "functional_select",
    "Round 1 Reject": "functional_regret",
    "Round One Scheduled": "functional_scheduled",
    "Round Two": "final_select",
    "Round 2 Reject": "final_regret",
    "Round Two Scheduled": "final_scheduled",
    "Round Three": "final_select",
    "Round 3 Reject": "final_regret",
    "Document Collection": "offer_made",
    "Offer": "offer_made",
    "Offer Accepted": "offer_accepted",
    "Joined": "joined",
    "Offer Declined": "offer_declined",
    "Offer Revoked": "offer_revoked",
    "Applied": "cv_pending",
    "Shortlisted": "cv_shortlist",
    "Rejected": "cv_regret",
    "Interview Scheduled": "functional_scheduled",
    "Selected": "joined",
    "On Hold": "cv_pending",
}

_STD_ALL_KEYS = [
    "total_received",
    "cv_shortlist",
    "cv_regret",
    "cv_pending",
    "written_select",
    "written_regret",
    "written_scheduled",
    "written_absent",
    "written_pending",
    "recruiter_select",
    "recruiter_regret",
    "recruiter_scheduled",
    "recruiter_pending",
    "functional_select",
    "functional_regret",
    "functional_scheduled",
    "functional_pending",
    "final_select",
    "final_regret",
    "final_scheduled",
    "final_pending",
    "offer_made",
    "offer_accepted",
    "offer_declined",
    "offer_revoked",
    "joined",
]

_STD_DEFAULT_SUBJECTS = [
    "Early Childhood Education",
    "Primary All subjects",
    "Primary EVS",
    "Primary English",
    "Primary Hindi",
    "Primary Kannada",
    "Primary Mathematics",
    "Upper Primary English",
    "Upper Primary Sanskrit",
    "Upper Primary Bengali",
    "Upper Primary Science",
    "Upper Primary Social Science",
    "Upper Primary Maths",
    "Upper Primary Hindi",
    "Upper Primary Kannada",
    "Secondary Geography",
    "Secondary English",
    "Secondary Hindi",
]


@frappe.whitelist(allow_guest=False)
def download_school_teacher_excel(from_date=None, to_date=None, schools=None):
    import json as _json
    from openpyxl import Workbook
    from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    conditions = ["`role` LIKE %s"]
    params = ["%School Teacher%"]
    if from_date:
        conditions.append("`creation` >= %s")
        params.append(from_date + " 00:00:00")
    if to_date:
        conditions.append("`creation` <= %s")
        params.append(to_date + " 23:59:59")

    # schools: comma-separated or JSON list of test_location values
    _school_list = []
    if schools:
        try:
            _school_list = (
                _json.loads(schools)
                if schools.startswith("[")
                else [s.strip() for s in schools.split(",") if s.strip()]
            )
        except Exception:
            _school_list = [s.strip() for s in schools.split(",") if s.strip()]
    if _school_list:
        placeholders = ",".join(["%s"] * len(_school_list))
        conditions.append("`test_location` IN ({0})".format(placeholders))
        params.extend(_school_list)

    where_clause = " AND ".join(conditions)
    table = "tabField Registration Form1"
    try:
        rows = frappe.db.sql(
            "SELECT `written_subject`, `application_status` FROM `{0}` WHERE {1}".format(
                table, where_clause
            ),
            params,
            as_dict=True,
        )
    except Exception:
        table = "tabField Registration Form"
        rows = frappe.db.sql(
            "SELECT `written_subject`, `application_status` FROM `{0}` WHERE {1}".format(
                table, where_clause
            ),
            params,
            as_dict=True,
        )

    # Collect unique subjects
    subj_seen = set()
    subjects = list(_STD_DEFAULT_SUBJECTS)
    for r in rows:
        s = (r.get("written_subject") or "").strip()
        if s and s not in subj_seen:
            subj_seen.add(s)
            if s not in subjects:
                subjects.append(s)

    # Aggregate
    data = {"Total": {k: 0 for k in _STD_ALL_KEYS}}
    for s in subjects:
        data[s] = {k: 0 for k in _STD_ALL_KEYS}

    for r in rows:
        status = (r.get("application_status") or "").strip()
        subj = (r.get("written_subject") or "").strip()
        key = _STD_STATUS_TO_KEY.get(status)
        if not key:
            continue
        data["Total"]["total_received"] += 1
        data["Total"][key] += 1
        if subj and subj in data:
            data[subj]["total_received"] += 1
            data[subj][key] += 1

    # Build workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "School Teacher Dashboard"

    thin = Side(style="thin", color="AAAAAA")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    def _cell(
        r, c, val, bg="FFFFFF", fg="000000", bold=False, wrap=False, align="center"
    ):
        cell = ws.cell(row=r, column=c, value=val)
        cell.fill = PatternFill("solid", fgColor=bg)
        cell.font = Font(color=fg, bold=bold, size=10)
        cell.alignment = Alignment(horizontal=align, vertical="center", wrap_text=wrap)
        cell.border = border
        return cell

    all_cols = ["Total"] + subjects
    n_cols = len(all_cols)
    HDR_BG = "1F497D"

    # Row 1: title header
    _cell(1, 1, "Stage", bg=HDR_BG, fg="FFFFFF", bold=True)
    _cell(1, 2, "Result", bg=HDR_BG, fg="FFFFFF", bold=True)
    for ci, col_name in enumerate(all_cols):
        _cell(1, 3 + ci, col_name, bg=HDR_BG, fg="FFFFFF", bold=True, wrap=True)

    # Freeze
    ws.freeze_panes = "C2"

    # Column widths
    ws.column_dimensions["A"].width = 20
    ws.column_dimensions["B"].width = 26
    for ci in range(n_cols):
        ws.column_dimensions[get_column_letter(3 + ci)].width = 14

    # Row 1 height
    ws.row_dimensions[1].height = 36

    # Data rows
    row_cur = 2
    for stage_cfg in _STD_STAGES:
        stage_hex = stage_cfg["color"]
        stage_rows = stage_cfg["rows"]
        row_start = row_cur

        for row_cfg in stage_rows:
            key = row_cfg["key"]
            is_total = row_cfg.get("is_total", False)
            row_bg = "D9D9D9" if is_total else stage_hex

            _cell(
                row_cur,
                2,
                row_cfg["label"],
                bg=row_bg,
                bold=is_total,
                align="left",
                wrap=True,
            )

            for ci, col_name in enumerate(all_cols):
                val = data[col_name].get(key, 0)
                col_bg = (
                    "BBBBBB"
                    if (is_total and ci == 0)
                    else ("D9D9D9" if ci == 0 else row_bg)
                )
                _cell(row_cur, 3 + ci, val if val else "", bg=col_bg, bold=(ci == 0))

            row_cur += 1

        # Stage label with merge
        ws.merge_cells(
            start_row=row_start, start_column=1, end_row=row_cur - 1, end_column=1
        )
        _cell(row_start, 1, stage_cfg["stage"], bg=stage_hex, bold=True, wrap=True)

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    frappe.local.response.filename = "School_Teacher_Dashboard.xlsx"
    frappe.local.response.filecontent = output.read()
    frappe.local.response.type = "binary"


# ── BGV Document Collection ────────────────────────────────────────────────────


@frappe.whitelist()
def get_bgv_document_collection(application_id):
    """
    Return document collection status for the BGV Request linked to a Field Registration Form.
    Returns required documents, uploaded documents, and missing documents.
    """
    bgv_list = frappe.get_all(
        "BGV Request",
        filters={"job_applicant": application_id},
        fields=["name", "status", "candidate_name", "consent_received"],
        order_by="creation desc",
        limit=1,
    )
    if not bgv_list:
        return {
            "error": "No BGV Request found for this application.",
            "bgv_request": None,
        }

    bgv_doc = frappe.get_doc("BGV Request", bgv_list[0]["name"])
    required = bgv_doc.get_required_documents()
    missing = bgv_doc.get_missing_documents()

    uploaded = [
        {
            "document_type": row.document_type,
            "document_file": row.document_file,
            "uploaded_on": str(row.uploaded_on or ""),
            "uploaded_by": row.uploaded_by or "",
            "remarks": row.remarks or "",
        }
        for row in (bgv_doc.documents or [])
    ]

    return {
        "bgv_request": bgv_doc.name,
        "status": bgv_doc.status,
        "candidate_name": bgv_doc.candidate_name,
        "consent_received": bgv_doc.consent_received,
        "required_documents": required,
        "uploaded_documents": uploaded,
        "missing_documents": missing,
    }


@frappe.whitelist()
def save_bgv_document(bgv_request_name, document_type, document_file, remarks=None):
    """
    Add or update a document row in the BGV Request documents child table.
    If a row for document_type already exists it is updated; otherwise a new row is appended.
    """
    from frappe.utils import today

    doc = frappe.get_doc("BGV Request", bgv_request_name)

    for row in doc.documents:
        if row.document_type == document_type:
            row.document_file = document_file
            if remarks:
                row.remarks = remarks
            row.uploaded_on = today()
            row.uploaded_by = frappe.session.user
            doc.save(ignore_permissions=True)
            frappe.db.commit()
            return {"message": f"{document_type} updated successfully."}

    doc.append(
        "documents",
        {
            "document_type": document_type,
            "document_file": document_file,
            "remarks": remarks or "",
            "uploaded_on": today(),
            "uploaded_by": frappe.session.user,
        },
    )
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return {"message": f"{document_type} uploaded successfully."}


@frappe.whitelist()
def get_bgv_missing_documents(bgv_request_name):
    """Return required, uploaded, and missing document lists for a BGV Request."""
    doc = frappe.get_doc("BGV Request", bgv_request_name)
    return {
        "missing": doc.get_missing_documents(),
        "required": doc.get_required_documents(),
        "uploaded": doc.get_uploaded_document_types(),
    }


@frappe.whitelist(allow_guest=True)
def notify_others_on_feedback_submission(
    application_id,
    submitted_by_email,
    interview_round=None,
    feedback_data=None,
    secret=None,
):
    """
    Called by a Webhook configured on the external feedback-form site
    (careers.frappe.cloud) right after an interviewer submits their feedback.
    Emails the remaining interviewers on the matching Field Interview Schedule
    a copy of the submitted feedback, excluding whoever just submitted it.
    """
    import json

    expected_secret = frappe.conf.get("feedback_webhook_secret")
    if expected_secret and secret != expected_secret:
        frappe.throw("Invalid webhook secret", frappe.PermissionError)

    application_id = (application_id or "").strip()
    submitted_by_email = (submitted_by_email or "").strip().lower()
    if not application_id or not submitted_by_email:
        frappe.throw("application_id and submitted_by_email are required")

    if isinstance(feedback_data, str):
        try:
            feedback_data = json.loads(feedback_data)
        except Exception:
            feedback_data = {"Feedback": feedback_data}
    feedback_data = feedback_data or {}

    filters = {"application_id": application_id}
    if interview_round:
        filters["interview_round"] = interview_round

    schedules = frappe.get_all(
        "Field Interview Schedule",
        filters=filters,
        fields=["name", "applicants_name"],
        order_by="modified desc",
        limit=1,
    )
    if not schedules:
        frappe.log_error(
            f"No Field Interview Schedule found for application_id={application_id}",
            "Feedback Notify: Schedule Not Found",
        )
        return {"status": "error", "message": "Field Interview Schedule not found"}

    schedule = frappe.get_doc("Field Interview Schedule", schedules[0]["name"])
    all_emails = [
        row.interviewer_email
        for row in (schedule.interviewer_email or [])
        if row.interviewer_email
    ]
    other_emails = [e for e in all_emails if e.strip().lower() != submitted_by_email]

    if not other_emails:
        return {"status": "skipped", "message": "No other interviewers to notify"}

    rows_html = "".join(
        f"<tr><td style='padding:4px 12px;font-weight:600;vertical-align:top;'>{k}</td>"
        f"<td style='padding:4px 12px;'>{v}</td></tr>"
        for k, v in feedback_data.items()
    )
    message = f"""
        <p>Hi,</p>
        <p><b>{submitted_by_email}</b> has submitted their interview feedback for
        <b>{schedule.applicants_name or application_id}</b> (Application ID: {application_id}).</p>
        <table style="border-collapse:collapse;">{rows_html}</table>
        <p>Regards,<br>People Function</p>
    """

    frappe.sendmail(
        recipients=other_emails,
        subject=f"Feedback Submitted - {schedule.applicants_name or application_id}",
        message=message,
    )

    return {"status": "success", "notified": other_emails}


def send_leader_final_round_feedback_pdf(doc, method=None):
    """
    Hooked to "Leader Final Round Feedback Form" after_insert (see hooks.py).
    Every time an interviewer submits feedback for an applicant, this merges
    ALL submissions received so far for that applicant into a single PDF
    (one section per submission) and emails it to every interviewer on the
    matching Field Interview Schedule (Leader Round-2) — so a second/third
    submission does not fire a separate, isolated email but a combined one.
    """
    from frappe.utils.pdf import get_pdf

    applicant_id = (doc.applicant_id or "").strip()
    applicant_name = (doc.applicant_name or "").strip()

    filters = {"interview_round": "Leader Round-2"}
    if applicant_id:
        filters["application_id"] = applicant_id
    elif applicant_name:
        filters["applicants_name"] = applicant_name
    else:
        frappe.log_error(
            f"Leader Final Round Feedback Form {doc.name}: no applicant_id/applicant_name to match a schedule",
            "Leader Feedback PDF: No Applicant Info",
        )
        return

    schedules = frappe.get_all(
        "Field Interview Schedule",
        filters=filters,
        fields=["name"],
        order_by="modified desc",
        limit=1,
    )
    if not schedules:
        frappe.log_error(
            f"Leader Final Round Feedback Form {doc.name}: no matching Field Interview Schedule for {filters}",
            "Leader Feedback PDF: Schedule Not Found",
        )
        return

    schedule = frappe.get_doc("Field Interview Schedule", schedules[0]["name"])
    interviewer_emails = [
        row.interviewer_email
        for row in (schedule.interviewer_email or [])
        if row.interviewer_email
    ]
    if not interviewer_emails:
        return

    # Pull every submission received so far for this applicant, not just this one.
    match_filters = (
        {"applicant_id": applicant_id}
        if applicant_id
        else {"applicant_name": applicant_name}
    )
    submissions = frappe.get_all(
        "Leader Final Round Feedback Form",
        filters=match_filters,
        fields=["name"],
        order_by="creation asc",
    )

    meta = frappe.get_meta(doc.doctype)
    skip_fieldtypes = {"Section Break", "Column Break", "Tab Break", "HTML", "Button"}

    def _render_feedback_table(fb_doc):
        rows_html = ""
        for df in meta.fields:
            if df.fieldtype in skip_fieldtypes:
                continue
            value = fb_doc.get(df.fieldname)
            if not value:
                continue
            rows_html += (
                f"<tr><td style='padding:4px 12px;font-weight:600;vertical-align:top;'>{df.label or df.fieldname}</td>"
                f"<td style='padding:4px 12px;'>{value}</td></tr>"
            )
        return (
            f"<table style='border-collapse:collapse;width:100%;'>{rows_html}</table>"
        )

    display_name = doc.applicant_name or applicant_name or applicant_id
    sections_html = ""
    for idx, row in enumerate(submissions, start=1):
        fb_doc = (
            doc
            if row["name"] == doc.name
            else frappe.get_doc("Leader Final Round Feedback Form", row["name"])
        )
        sections_html += (
            f"<h3>Submission {idx} ({fb_doc.name})</h3>"
            f"{_render_feedback_table(fb_doc)}"
            f"<hr>"
        )

    html = f"""
        <h2>Leader Final Round Feedback</h2>
        <p><b>Applicant:</b> {display_name}</p>
        {sections_html}
    """

    pdf_content = get_pdf(html)
    filename = f"Leader-Final-Round-Feedback-{applicant_id or applicant_name}.pdf"

    frappe.sendmail(
        recipients=interviewer_emails,
        subject=f"Leader Final Round Feedback (Merged) - {display_name}",
        message=(
            f"<p>Hi,</p>"
            f"<p>Feedback for <b>{display_name}</b>'s Leader Round-2 interview has been "
            f"updated ({len(submissions)} submission(s) so far). Please find the combined "
            f"details attached as PDF.</p>"
            f"<p>Regards,<br>People Function</p>"
        ),
        attachments=[{"fname": filename, "fcontent": pdf_content}],
    )


def send_leader_final_round_feedback_pdf_to_registration_form(doc, method=None):
    """
    Hooked to "Leader Final Round Feedback Form" after_insert (see
    hooks.py), alongside send_leader_final_round_feedback_pdf. Saves the
    merged PDF into the "Round Two Feedback Form" attach field on the
    matching Field Registration Form.
    """
    _merge_feedback_submissions_to_registration_form(
        doc, "round_two_feedback_form", "Leader Final Round Feedback Form"
    )


def _merge_feedback_submissions_to_registration_form(doc, target_field, pdf_title):
    """
    Shared by every "<some> Feedback Form" doctype that should merge ALL of
    its submissions for one applicant into a single PDF (one section per
    submission) and save it into a specific attach field on the matching
    Field Registration Form — so a second/third submission for the same
    applicant replaces the attachment with a combined PDF instead of piling
    up separate ones. applicant_id on these doctypes is a Link to Field
    Registration Form and its value is that record's name, so the match is
    a direct lookup.
    """
    from frappe.utils.pdf import get_pdf

    applicant_id = (doc.applicant_id or "").strip()
    if not applicant_id:
        frappe.log_error(
            f"{doc.doctype} {doc.name}: no applicant_id to match a Field Registration Form",
            f"{doc.doctype} PDF: No Applicant ID",
        )
        return

    if not frappe.db.exists("Field Registration Form", applicant_id):
        frappe.log_error(
            f"{doc.doctype} {doc.name}: Field Registration Form {applicant_id} not found",
            f"{doc.doctype} PDF: Registration Form Not Found",
        )
        return

    try:
        # Pull every submission received so far for this applicant, not just this one.
        submissions = frappe.get_all(
            doc.doctype,
            filters={"applicant_id": applicant_id},
            fields=["name"],
            order_by="creation asc",
        )

        meta = frappe.get_meta(doc.doctype)
        skip_fieldtypes = {
            "Section Break",
            "Column Break",
            "Tab Break",
            "HTML",
            "Button",
        }

        def _render_feedback_table(fb_doc):
            rows_html = ""
            for i, df in enumerate(meta.fields):
                if df.fieldtype in skip_fieldtypes:
                    continue
                value = fb_doc.get(df.fieldname)
                if not value:
                    continue
                row_bg = "#f7f8fa" if i % 2 == 0 else "#ffffff"
                rows_html += (
                    f"<tr style='background:{row_bg};'>"
                    f"<td style='padding:8px 14px;font-weight:600;color:#333;width:38%;"
                    f"vertical-align:top;border-bottom:1px solid #e5e7eb;'>{df.label or df.fieldname}</td>"
                    f"<td style='padding:8px 14px;color:#111;vertical-align:top;"
                    f"border-bottom:1px solid #e5e7eb;'>{value}</td></tr>"
                )
            return (
                "<table style='border-collapse:collapse;width:100%;"
                "border:1px solid #e5e7eb;font-size:12px;'>" + rows_html + "</table>"
            )

        display_name = doc.applicant_name or applicant_id
        sections_html = ""
        for idx, row in enumerate(submissions, start=1):
            fb_doc = (
                doc
                if row["name"] == doc.name
                else frappe.get_doc(doc.doctype, row["name"])
            )
            submitted_on = frappe.utils.format_datetime(
                fb_doc.creation, "d MMM yyyy, h:mm a"
            )
            sections_html += f"""
                <div style="margin-top:22px;">
                    <div style="background:#1d4ed8;color:#ffffff;padding:8px 14px;
                                border-radius:4px 4px 0 0;font-size:13px;font-weight:600;">
                        Submission {idx} &middot; {fb_doc.name} &middot; {submitted_on}
                    </div>
                    {_render_feedback_table(fb_doc)}
                </div>
            """

        html = f"""
            <html>
            <head>
                <style>
                    body {{ font-family: 'Helvetica', 'Arial', sans-serif; color:#1a1a1a; }}
                </style>
            </head>
            <body>
                <div style="border-bottom:3px solid #1d4ed8;padding-bottom:14px;margin-bottom:18px;">
                    <div style="font-size:11px;letter-spacing:1px;color:#6b7280;text-transform:uppercase;">
                        Azim Premji Foundation
                    </div>
                    <h1 style="margin:4px 0 10px 0;font-size:20px;color:#111827;">{pdf_title}</h1>
                    <table style="font-size:12px;color:#374151;">
                        <tr>
                            <td style="padding:2px 10px 2px 0;font-weight:600;">Applicant</td>
                            <td style="padding:2px 0;">{display_name}</td>
                        </tr>
                        <tr>
                            <td style="padding:2px 10px 2px 0;font-weight:600;">Applicant ID</td>
                            <td style="padding:2px 0;">{applicant_id}</td>
                        </tr>
                        <tr>
                            <td style="padding:2px 10px 2px 0;font-weight:600;">Submissions</td>
                            <td style="padding:2px 0;">{len(submissions)}</td>
                        </tr>
                    </table>
                </div>
                {sections_html}
            </body>
            </html>
        """

        pdf_content = get_pdf(html)
        filename = f"{pdf_title.replace(' ', '-')}-{applicant_id}.pdf"

        # Remove any previously attached PDF for this field so re-submissions
        # don't pile up multiple stale files against the same record.
        old_files = frappe.get_all(
            "File",
            filters={
                "attached_to_doctype": "Field Registration Form",
                "attached_to_name": applicant_id,
                "attached_to_field": target_field,
            },
            fields=["name"],
        )
        for old_file in old_files:
            frappe.delete_doc(
                "File", old_file["name"], ignore_permissions=True, force=True
            )

        file_doc = frappe.get_doc(
            {
                "doctype": "File",
                "file_name": filename,
                "attached_to_doctype": "Field Registration Form",
                "attached_to_name": applicant_id,
                "attached_to_field": target_field,
                "content": pdf_content,
                "is_private": 0,
            }
        )
        file_doc.insert(ignore_permissions=True)

        frappe.db.set_value(
            "Field Registration Form",
            applicant_id,
            target_field,
            file_doc.file_url,
            update_modified=False,
        )
    except Exception as e:
        frappe.log_error(
            title=f"{doc.doctype} PDF: Generation Failed",
            message=f"{doc.doctype} {doc.name}, applicant {applicant_id}: {e}",
        )


def send_recruiter_feedback_pdf_to_registration_form(doc, method=None):
    """Hooked to "Recruiter Feedback Form" after_insert (see hooks.py)."""
    _merge_feedback_submissions_to_registration_form(
        doc, "recruiter_round_feedback_form", "Recruiter Feedback Form"
    )


def send_educational_capacity_feedback_pdf_to_registration_form(doc, method=None):
    """
    Hooked to "Educational Capacity Interview - Feedback Form" after_insert
    (see hooks.py). Saves into the same "Round One Feedback Form" attach
    field used by the Subject Round feedback for other roles.
    """
    _merge_feedback_submissions_to_registration_form(
        doc, "round_one_feedback_from", "Educational Capacity Interview Feedback Form"
    )


def send_school_teacher_feedback_pdf_to_registration_form(doc, method=None):
    """
    Hooked to "School Teacher Feedback Form" after_insert (see hooks.py).
    Saves into the same "Round One Feedback Form" attach field used by the
    Educational Capacity Round feedback for other roles.
    """
    _merge_feedback_submissions_to_registration_form(
        doc, "round_one_feedback_from", "School Teacher Feedback Form"
    )


def send_demo_lesson_observation_feedback_pdf_to_registration_form(doc, method=None):
    """
    Hooked to "Demo Lesson Observation Feedback Form" after_insert (see
    hooks.py). Saves into the "Round Two Feedback Form" attach field on the
    matching Field Registration Form.
    """
    _merge_feedback_submissions_to_registration_form(
        doc, "round_two_feedback_form", "Demo Lesson Observation Feedback Form"
    )


def send_arp_feedback_pdf_to_registration_form(doc, method=None):
    """
    Hooked to "Feedback Form - Associate Resource Person" after_insert (see
    hooks.py). Saves into the same "Recruiter Round Feedback Form" attach
    field used by the Recruiter Feedback Form for other roles.
    """
    _merge_feedback_submissions_to_registration_form(
        doc,
        "recruiter_round_feedback_form",
        "Feedback Form - Associate Resource Person",
    )


def send_recruiter_assessment_pdf_to_registration_form(doc, method=None):
    """
    Hooked to "Recruiter Assessment Form" after_insert (see hooks.py).
    Saves into the same "Recruiter Round Feedback Form" attach field used
    by the Recruiter Feedback Form for other roles.
    """
    _merge_feedback_submissions_to_registration_form(
        doc, "recruiter_round_feedback_form", "Recruiter Assessment Form"
    )


def send_functional_round_feedback_pdf_to_registration_form(doc, method=None):
    """
    Hooked to "Functional Round Feedback Form" after_insert (see hooks.py).
    Saves into the same "Round One Feedback Form" attach field used by the
    Subject Round / Educational Capacity Round feedback for other roles
    (this is the Round-1 equivalent for Health/Livelihood applicants).
    """
    _merge_feedback_submissions_to_registration_form(
        doc, "round_one_feedback_from", "Functional Round Feedback Form"
    )


def send_final_round_feedback_pdf_to_registration_form(doc, method=None):
    """
    Hooked to "Final Round Feedback Form" after_insert (see hooks.py).
    Saves into the same "Round Two Feedback Form" attach field used by the
    Leader Final Round / Demo Lesson Observation feedback for other roles.
    """
    _merge_feedback_submissions_to_registration_form(
        doc, "round_two_feedback_form", "Final Round Feedback Form"
    )
