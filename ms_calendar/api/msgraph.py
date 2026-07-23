import frappe, requests
from datetime import timedelta
from frappe.utils import get_datetime

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
        "scope": "https://graph.microsoft.com/.default"
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
        "Content-Type": "application/json"
    }
    body = {
        "schedules": interviewer_emails,
        "startTime": {
            "dateTime": start_date.isoformat(),
            "timeZone": "UTC"
        },
        "endTime": {
            "dateTime": end_date.isoformat(),
            "timeZone": "UTC"
        },
        "availabilityViewInterval": 30
    }

    try:
        resp = requests.post(url, headers=headers, json=body)
        resp.raise_for_status()
        schedules = resp.json().get("value", [])
        result = {
            s["scheduleId"]: s.get("scheduleItems", [])
            for s in schedules
        }
        return result
    except requests.exceptions.RequestException as e:
        frappe.throw(f"Graph API error: {resp.status_code} - {resp.text}")

import frappe, requests, uuid

@frappe.whitelist()
def create_calendar_event(event_title, start_datetime, end_datetime, interviewer_email, interviewee_email):
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
        "scope": "https://graph.microsoft.com/.default"
    }
    
    try:
        token_resp = requests.post(token_url, data=token_data).json()
        access_token = token_resp.get("access_token")
        if not access_token:
            frappe.throw(f"Failed to fetch access token: {token_resp}")
    except requests.exceptions.RequestException as e:
        frappe.throw(f"Token request failed: {e}")

    # --- 3. Organizer email (HR official mailbox) ---
    organizer_email = "health.fellowship@azimpremjifoundation.org"   # 👈 replace with your official organizer email
    url = f"https://graph.microsoft.com/v1.0/users/{organizer_email}/events?sendUpdates=none"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }

    # --- 4. Event body (seen only by HR) ---
    event_body = {
        "subject": event_title,
        "start": {"dateTime": start_datetime, "timeZone": "Asia/Kolkata"},
        "end": {"dateTime": end_datetime, "timeZone": "Asia/Kolkata"},
        "location": {"displayName": "Microsoft Teams Meeting"},
        "attendees": [
            {"emailAddress": {"address": interviewer_email, "name": "Interviewer"}, "type": "required"},
            {"emailAddress": {"address": interviewee_email, "name": "Candidate"}, "type": "required"}
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
            """
        }
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
            """
        )

        # --- 7. Send custom email to Candidate ---
        frappe.sendmail(
            recipients=[interviewee_email],
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
            """
        )

        frappe.msgprint("Interview scheduled. HR notified, and custom invites sent to interviewer and candidate.")

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
        "scope": "https://graph.microsoft.com/.default"
    }
    token_resp = requests.post(token_url, data=token_data)
    token_resp.raise_for_status()
    access_token = token_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {access_token}"}

    print("DEBUG → Token OK")

    # -------------------------
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
    MAX_BATCH = 20
    schedule_url = (
        "https://graph.microsoft.com/v1.0/"
        "users/health.fellowship@azimpremjifoundation.org/calendar/getSchedule"
    )

    schedule_map = {}
    total_batches = (len(room_emails) + MAX_BATCH - 1) // MAX_BATCH

    for i in range(0, len(room_emails), MAX_BATCH):
        batch = room_emails[i:i + MAX_BATCH]
        body = {
            "schedules": batch,
            "startTime": {"dateTime": start_utc.isoformat(), "timeZone": "UTC"},
            "endTime": {"dateTime": end_utc.isoformat(), "timeZone": "UTC"},
            "availabilityViewInterval": 5
        }

        resp = requests.post(
            schedule_url,
            headers={**headers, "Content-Type": "application/json"},
            json=body
        )
        resp.raise_for_status()

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
            s = datetime.fromisoformat(slot["start"]["dateTime"]).replace(tzinfo=timezone.utc)
            e = datetime.fromisoformat(slot["end"]["dateTime"]).replace(tzinfo=timezone.utc)

            if not (e <= start_utc or s >= end_utc):
                available = False
                break

        final.append({
            "name": r.get("displayName"),
            "email": email,
            "capacity": r.get("capacity"),
            "availability": busy,
            "is_available": available
        })

    print("===================== DEBUG END =====================\n")
    return {"rooms": final}


@frappe.whitelist()
def create_interview_event(event_title,
                           start_datetime,
                           end_datetime,
                           interviewer_emails,
                           interviewee_email,
                           room_emails,
                           is_online,
                           Organizer_email,
                           Interview_round,
                           InterviewersName,
                           Applicants_name,
                           Applicants_Role,
                           application_id,
                           Map_location=None,
                           address=None,
                           commands_to_candidate=None,
                           commands_to_interviewer=None,
                           attachment_paths=None):

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

    Organizer_email = Organizer_email.strip()
    Map_location = Map_location or ""
    address = address or ""
    commands_to_candidate = commands_to_candidate or ""
    commands_to_interviewer = commands_to_interviewer or ""

    # ----------------------------------------
    # Friendly date
    # ----------------------------------------
    start_dt = datetime.fromisoformat(start_datetime)
    end_dt = datetime.fromisoformat(end_datetime)
    when_str = start_dt.strftime("%A, %d %b %Y at %I:%M %p")
    round_raw = str(Interview_round).strip().lower()

    # Normalize
    round_clean = (
        round_raw.replace(" ", "")
                .replace("-", "")
                .replace("–", "")
    )

    # New FRONTEND values:
    is_round1 = "roundone" in round_clean
    is_round2 = "roundtwo" in round_clean

    form_key = "one" if is_round1 else "two"

    feedback_url = (
        f"https://careers.frappe.cloud/feedback-form-{form_key}/new"
        f"?app_id={application_id}&applicant_name={Applicants_name}"
    )
    if is_online == 0 and (address or Map_location):
        Map_location_html = ""
        if address:
            Map_location_html += f'<p style="margin:6px 0;"><strong>Venue:</strong> {address}</p>'
        if Map_location:
            Map_location_html += (
                f'<p style="margin:6px 0;"><strong>Google Map Link:</strong> '
                f'<a href="{Map_location}" target="_blank">Click here</a></p>'
            )
        map_html = Map_location_html
    else:
        map_html = ""

    note_to_candidate_html = (
        f'<p><strong>For your information:</strong> {commands_to_candidate}</p>'
        if commands_to_candidate else ""
    )
    note_to_interviewer_html = (
        f'<p><strong>For your information:</strong> {commands_to_interviewer}</p>'
        if commands_to_interviewer else ""
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
    token_url = f"https://login.microsoftonline.com/{creds.tenant_id.strip()}/oauth2/v2.0/token"

    tok = requests.post(token_url, data={
        "grant_type": "client_credentials",
        "client_id": creds.client_id.strip(),
        "client_secret": creds.get_password("client_secret"),
        "scope": "https://graph.microsoft.com/.default"
    })
    tok.raise_for_status()
    access_token = tok.json()["access_token"]

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }

    # ----------------------------------------
    # ATTENDEES
    # ----------------------------------------
    interviewer_list = [i.strip() for i in (interviewer_emails or "").split(",") if i.strip()]
    room_list = [r.strip() for r in (room_emails or "").split(",") if r.strip()]

    attendees = []
    for r in room_list:
        attendees.append({"emailAddress": {"address": r}, "type": "resource"})
    for i in interviewer_list:
        attendees.append({"emailAddress": {"address": i}, "type": "required"})
    # ----------------------------------------
    # ATTACHMENTS (PUBLIC + PRIVATE FIXED)
    # ----------------------------------------
    final_files = []

    if attachment_paths:
        try:
            attachment_list = ast.literal_eval(attachment_paths)
        except:
            attachment_list = []
    else:
        attachment_list = []

    for web_path in attachment_list:
        file_doc = frappe.get_all(
            "File",
            filters={"file_url": web_path},
            fields=["file_url", "file_name", "is_private"]
        )

        if not file_doc:
            frappe.log_error(f"File Doc not found: {web_path}", "Interview Event File Error")
            continue

        file_doc = file_doc[0]
        file_name = file_doc.file_name

        if file_doc.is_private:
            file_path = frappe.get_site_path("private", "files", file_name)
        else:
            file_path = frappe.get_site_path("public", "files", file_name)

        if not os.path.isfile(file_path):
            # The File doc's `is_private` flag can be stale (e.g. after a bulk
            # import or a reused "library file" attachment) while the bytes
            # actually sit in the other folder — check there before giving up,
            # so the attachment isn't silently dropped from the invite.
            alt_folder = "public" if file_doc.is_private else "private"
            alt_path = frappe.get_site_path(alt_folder, "files", file_name)
            if os.path.isfile(alt_path):
                file_path = alt_path
            else:
                frappe.log_error(f"File missing on disk: {file_path}", "Interview Event File Error")
                continue

        if os.path.getsize(file_path) > 3 * 1024 * 1024:
            frappe.log_error(f"File too large: {file_name}", "Interview Event File Error")
            continue

        with open(file_path, "rb") as f:
            file_content = base64.b64encode(f.read()).decode()

        final_files.append((file_name, file_content))
    # ----------------------------------------
    # ROUND 1 TEMPLATES
    # ----------------------------------------
    round1_interviewer_template = """
<p>Dear {Interviewer_name},</p>

<p>Blocking your calendar for the Scholarship interview.</p>

<p>This will be for <b>{Applicants_Role}</b> role.</p>

<p><b>When:</b> {when_str}</p>

{meeting_info}<br>
{Note_to_interviewer_html}
<p><b>Feedback form link:</b> 
<a href="{feedback_url}" target="_blank">Click here</a></p>

<p>Regards,<br>
People Function</p>
"""

    round1_candidate_template = """
<p>Dear {Applicants_name},</p>

<p>Please find the schedule to your discussion.</p>

<p><b>When:</b> {when_str}</p>

{meeting_info}
{Map_html}
<p><b>Panel:</b> {InterviewersName}</p>
{Note_to_candidate_html}
<p>Please acknowledge this email as confirmation to the interview.</p>

<p>Regards,<br>
People Function<br>
Azim Premji Foundation</p>
"""

    # ----------------------------------------
    # ROUND 2 TEMPLATES
    # ----------------------------------------
    round2_interviewer_template = """
<p>Dear {Interviewer_name},</p>

<p>Blocking your calendar for the Scholarship interview.</p>
<p>This will be for <b>{Applicants_Role}</b> role.</p>

<p>Please find attached CV, feedback and details.</p>

<p><b>Total Experience:</b> {total_exp}<br>
<b>Current CTC:</b> {current_ctc}<br>
<b>Expected CTC:</b> {expected_ctc}</p>

<p><b>When:</b> {when_str}</p>
{meeting_info}<br>
{Note_to_interviewer_html}
<p><b>Feedback form link:</b> 
<a href="{feedback_url}" target="_blank">Click here</a></p>

<p>Regards,<br>
People Function</p>
"""

    round2_candidate_template = """
<p>Dear {Applicants_name},</p>

<p>Please find the schedule to your next discussion.</p>

<p><b>When:</b> {when_str}</p>

{meeting_info}
{Map_html}<br>
{Note_to_candidate_html}
<p><b>Panel:</b> {InterviewersName}</p>

<p>Please acknowledge this email as confirmation to the interview.</p>

<p>Regards,<br>
People Function<br>
Azim Premji Foundation</p>
"""

    # ----------------------------------------
    # INITIAL EVENT BODY
    # ----------------------------------------
    if is_round1:
        calendar_subject = f"Discussion With - {Applicants_name} ({Applicants_Role} Role), Azim Premji Scholarship"
        # initial_body = round1_interviewer_template.format(
        #     Interviewer_name=InterviewersName,
        #     when_str=when_str,
        #     meeting_info="",
        #     feedback_url=feedback_url
        # )
        initial_body = round1_interviewer_template.format(
            Interviewer_name=InterviewersName,
            Applicants_Role=Applicants_Role,     
            when_str=when_str,
            meeting_info="",
            feedback_url=feedback_url,
            Note_to_interviewer_html=note_to_interviewer_html

        )


    elif is_round2:
        calendar_subject = f"Discussion With- {Applicants_name} ({Applicants_Role} Role), Azim Premji Scholarship"
        initial_body = round2_interviewer_template.format(
            Interviewer_name=InterviewersName,
            Applicants_Role=Applicants_Role,    
            when_str=when_str,
            meeting_info="",
            feedback_url=feedback_url,
            total_exp=total_exp,
            current_ctc=current_ctc,
            expected_ctc=expected_ctc,
            Note_to_interviewer_html=note_to_interviewer_html
        )

    else:
        calendar_subject = event_title
        initial_body = f"<p>Interview for {Applicants_name}</p><p>When: {when_str}</p>"

    # ----------------------------------------
    # CREATE EVENT
    # ----------------------------------------
    create_url = f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events"

    draft_payload = {
        "subject": calendar_subject,
        "isOnlineMeeting": True if is_online == 1 else False,
        "onlineMeetingProvider": "teamsForBusiness" if is_online == 1 else None,
        "showAs": "busy",
        "start": {"dateTime": start_datetime, "timeZone": "Asia/Kolkata"},
        "end": {"dateTime": end_datetime, "timeZone": "Asia/Kolkata"},
        "body": {"contentType": "HTML", "content": initial_body}
    }

    res = requests.post(create_url, headers=headers, json=draft_payload)
    res.raise_for_status()
    event_id = res.json()["id"]

    # ----------------------------------------
    # ATTACH FILES
    # ----------------------------------------
    attach_url = f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events/{event_id}/attachments"
    for fname, fb64 in final_files:
        requests.post(
            attach_url,
            headers=headers,
            json={
                "@odata.type": "#microsoft.graph.fileAttachment",
                "name": fname,
                "contentBytes": fb64
            }
        ).raise_for_status()

    # ----------------------------------------
    # FETCH MEETING DETAILS
    # ----------------------------------------
    event_fetch_url = f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events/{event_id}"

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

    # ----------------------------------------
    # SECONDARY (THE ORIGINAL): onlineMeetings filter (may return empty)
    # ----------------------------------------
    if is_online == 1 and join_web_url:
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
    if is_online == 1 and (not join_meeting_id or not join_passcode):
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
    is_valid_online = (is_online == 1 and join_web_url)

    if is_valid_online:
        meeting_html = (
            f"<p><b>Join Teams Meeting:</b> "
            f"<a href='{join_web_url}' target='_blank'>Join Now</a><br>"
            f"<p><b>Meeting ID:</b> {join_meeting_id}<br>"
            f"<b>Passcode:</b> {join_passcode}</p>"
        )
    else:
        meeting_html = "<p><b>Mode:</b> Offline Interview</p>"

    # ----------------------------------------
    # FINAL EVENT BODY
    # ----------------------------------------
    if is_round1:
        final_body = round1_interviewer_template.format(
            Interviewer_name=InterviewersName,
            Applicants_Role=Applicants_Role,     # ← ADD THIS LINE
            when_str=when_str,
            meeting_info=meeting_html,
            feedback_url=feedback_url,
            Note_to_interviewer_html=note_to_interviewer_html
        )


    elif is_round2:
        final_body = round2_interviewer_template.format(
            Interviewer_name=InterviewersName,
            when_str=when_str,
            Applicants_Role=Applicants_Role,     # ← ADD THIS LINE
            meeting_info=meeting_html,
            feedback_url=feedback_url,
            total_exp=total_exp,
            current_ctc=current_ctc,
            expected_ctc=expected_ctc,
            Note_to_interviewer_html=note_to_interviewer_html
        )

    else:
        final_body = initial_body

    requests.patch(
        event_fetch_url,
        headers=headers,
        json={
            "attendees": attendees,
            "body": {"contentType": "HTML", "content": final_body},
            "showAs": "busy"
        }
    ).raise_for_status()

    # ----------------------------------------
    # EMAIL TO CANDIDATE
    # ----------------------------------------
    if is_round1:
        email_subject = f"Discussion With - {Applicants_name} ({Applicants_Role} Role), Azim Premji Scholarship"
        email_body = round1_candidate_template.format(
            Applicants_name=Applicants_name,
            when_str=when_str,
            meeting_info=meeting_html,
            InterviewersName=InterviewersName,
            Map_html=map_html,
            Note_to_candidate_html=note_to_candidate_html,
        )

    elif is_round2:
        email_subject =f"Discussion With - {Applicants_name} ({Applicants_Role} Role), Azim Premji Scholarship"
        email_body = round2_candidate_template.format(
            Applicants_name=Applicants_name,
            when_str=when_str,
            meeting_info=meeting_html,
            InterviewersName=InterviewersName,
            Map_html=map_html,
            Note_to_candidate_html=note_to_candidate_html,
        )

    else:
        email_subject = f"Interview Scheduled - {event_title}"
        email_body = f"<p>Hi {Applicants_name},</p><p>Your interview is scheduled on {when_str}.</p>"

    frappe.sendmail(
        recipients=[interviewee_email],
        sender=Organizer_email,
        subject=email_subject,
        message=email_body,
        delayed=False
    )

    frappe.msgprint("✅ Event created successfully. Outlook invite sent.")

    return {
        "event_id": event_id,
        "join_url": join_web_url,
        "meeting_id": join_meeting_id,
        "passcode": join_passcode,
        "is_online": is_online
    }
