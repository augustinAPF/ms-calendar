import os
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
    from datetime import datetime, timezone
    from zoneinfo import ZoneInfo

    # Interviews are always entered in India time regardless of where this
    # code happens to run — deriving the offset from the host machine's OS
    # timezone (as this used to) silently produces wrong busy/available
    # results on any server not itself configured for Asia/Kolkata (e.g. a
    # cloud box defaulting to UTC), which shows up as "sometimes wrong"
    # rather than a clear error. Hardcode it instead.
    IST = ZoneInfo("Asia/Kolkata")

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
    try:
        token_resp = requests.post(token_url, data=token_data, timeout=15)
        token_resp.raise_for_status()
    except requests.exceptions.RequestException as e:
        frappe.log_error(frappe.get_traceback(), "Room availability: token fetch failed")
        frappe.throw(f"Could not authenticate with Microsoft Graph — try again in a moment. ({e})")
    access_token = token_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {access_token}"}

    # -------------------------
    # GET ALL ROOMS (PAGINATED)
    # -------------------------
    rooms = []
    url = "https://graph.microsoft.com/v1.0/places/microsoft.graph.room"

    try:
        while url:
            resp = requests.get(url, headers=headers, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            rooms.extend(data.get("value", []))
            url = data.get("@odata.nextLink")
    except requests.exceptions.RequestException as e:
        frappe.log_error(frappe.get_traceback(), "Room availability: room list fetch failed")
        frappe.throw(f"Could not fetch the room list from Microsoft Graph — try again in a moment. ({e})")

    # Extract emails
    room_emails = [r.get("emailAddress") for r in rooms if r.get("emailAddress")]

    # -------------------------
    # TIME RANGE (UTC)
    # -------------------------
    start_local = get_datetime(f"{interview_date} {start_time}")
    end_local = get_datetime(f"{interview_date} {end_time}")

    start_utc = start_local.replace(tzinfo=IST).astimezone(timezone.utc)
    end_utc = end_local.replace(tzinfo=IST).astimezone(timezone.utc)

    # -------------------------
    # GET AVAILABILITY IN BATCHES
    # -------------------------
    MAX_BATCH = 20
    schedule_url = (
        "https://graph.microsoft.com/v1.0/"
        "users/health.fellowship@azimpremjifoundation.org/calendar/getSchedule"
    )

    schedule_map = {}
    availability_view_map = {}

    for i in range(0, len(room_emails), MAX_BATCH):
        batch = room_emails[i:i + MAX_BATCH]
        body = {
            "schedules": batch,
            "startTime": {"dateTime": start_utc.isoformat(), "timeZone": "UTC"},
            "endTime": {"dateTime": end_utc.isoformat(), "timeZone": "UTC"},
            "availabilityViewInterval": 5
        }

        try:
            resp = requests.post(
                schedule_url,
                headers={**headers, "Content-Type": "application/json"},
                json=body,
                timeout=20,
            )
            resp.raise_for_status()
        except requests.exceptions.RequestException as e:
            # Don't fail the whole check because one batch of ~20 rooms
            # timed out/errored — log it and treat those rooms as unknown
            # (excluded below) rather than silently marking them available.
            frappe.log_error(
                frappe.get_traceback(),
                f"Room availability: getSchedule batch failed for {batch}",
            )
            continue

        for item in resp.json().get("value", []):
            key = item["scheduleId"].lower()
            schedule_map[key] = item.get("scheduleItems", [])
            # scheduleItems can come back EMPTY for a room that is genuinely
            # busy — Graph only includes item-level detail when the calling
            # app has full calendar detail visibility into that mailbox
            # (blocked by the room's sharing/privacy settings or an Exchange
            # Application Access Policy scoping the app to a subset of
            # mailboxes). The aggregated availabilityView code string is
            # still populated even then, so keep it as a second signal
            # rather than trusting scheduleItems alone.
            availability_view_map[key] = item.get("availabilityView", "")

        time.sleep(0.1)

    # -------------------------
    # FINAL OUTPUT
    # -------------------------
    final = []

    for r in rooms:
        email = r.get("emailAddress")
        if not email:
            continue
        key = email.lower()

        # A room whose batch request failed above has no entry in
        # schedule_map at all — treat that as "unknown", not silently
        # available, since we genuinely don't know its status.
        if key not in schedule_map:
            final.append({
                "name": r.get("displayName"),
                "email": email,
                "capacity": r.get("capacity"),
                "availability": [],
                "is_available": False,
                "status_unknown": True,
            })
            continue

        busy = schedule_map[key]
        available = True
        for slot in busy:
            s = datetime.fromisoformat(slot["start"]["dateTime"]).replace(tzinfo=timezone.utc)
            e = datetime.fromisoformat(slot["end"]["dateTime"]).replace(tzinfo=timezone.utc)

            if not (e <= start_utc or s >= end_utc):
                available = False
                break

        # Cross-check against availabilityView even when scheduleItems came
        # back empty/clean — each character covers one availabilityViewInterval
        # (5 min) of the requested window; '0' is free, anything else
        # (tentative/busy/OOF/working-elsewhere) means the room isn't clear
        # for the full slot even though no individual item was visible.
        view = availability_view_map.get(key, "")
        if available and view and any(c != "0" for c in view):
            available = False

        final.append({
            "name": r.get("displayName"),
            "email": email,
            "capacity": r.get("capacity"),
            "availability": busy,
            "is_available": available
        })

    return {"rooms": final}


def _graph_headers():
    """Client-credentials OAuth against MS Graph — shared by
    create/update/cancel_interview_event below. Mirrors
    ms_philanthropy.py's own _graph_headers() (kept as a separate copy
    here, not a cross-module import, so this file's Scholarship-specific
    Graph functions don't depend on an unrelated module staying stable).
    """
    creds = frappe.get_single("MS Graph Credentials")
    token = requests.post(
        f"https://login.microsoftonline.com/{creds.tenant_id.strip()}/oauth2/v2.0/token",
        data={
            "grant_type": "client_credentials",
            "client_id": creds.client_id.strip(),
            "client_secret": creds.get_password("client_secret"),
            "scope": "https://graph.microsoft.com/.default",
        },
    )
    token.raise_for_status()
    return {
        "Authorization": f"Bearer {token.json()['access_token']}",
        "Content-Type": "application/json",
    }


def _attach_files_to_event(headers, organizer_email, event_id, attachment_paths):
    """Resolve each url in `attachment_paths` (a JSON-encoded list of
    Attach-field urls — frappe.call() JSON.stringify()s array args before
    sending) to a real File record and POST it onto the given Graph event
    as an attachment.

    Mirrors ms_philanthropy.py's _attach_files_to_event, including the two
    bugs found and fixed there:
      - more than one File row can share the exact same file_url (drift
        from an interrupted rename); every candidate is checked for one
        that actually resolves to a real file on disk, rather than trusting
        whichever the DB happens to return first.
      - Graph's attachments endpoint has no dedupe of its own, and this now
        runs on every reschedule (see update_interview_event) — so an
        unchanged CV still in attachment_paths from a previous save would
        otherwise get re-added as a duplicate copy each time. Existing
        attachment names are fetched first and skipped.
    """
    import ast
    import base64

    attachment_files = []
    if attachment_paths:
        try:
            paths = ast.literal_eval(attachment_paths)
        except Exception:
            paths = []
    else:
        paths = []

    for web_path in paths:
        candidates = frappe.get_all(
            "File",
            filters={"file_url": web_path},
            fields=["file_url", "file_name", "is_private"],
        )
        if not candidates:
            frappe.log_error(
                title="SCHOLARSHIP_INTERVIEW_ATTACH_NO_FILE_RECORD",
                message=f"No File record at all matches url={web_path!r} for event {event_id} — nothing to attach.",
            )
            continue

        resolved_path = None
        file_name = None
        for candidate in candidates:
            file_name = candidate.file_name
            file_path = frappe.get_site_path(
                "private" if candidate.is_private else "public", "files", file_name
            )
            if os.path.isfile(file_path):
                resolved_path = file_path
                break
            alt_path = frappe.get_site_path(
                "public" if candidate.is_private else "private", "files", file_name
            )
            if os.path.isfile(alt_path):
                resolved_path = alt_path
                break

        if not resolved_path:
            frappe.log_error(
                title="SCHOLARSHIP_INTERVIEW_ATTACH_FILE_MISSING",
                message=(
                    f"url={web_path!r} for event {event_id} matched {len(candidates)} "
                    f"File record(s), but none resolve to a real file on disk in "
                    f"either public or private folders — nothing to attach."
                ),
            )
            continue

        if os.path.getsize(resolved_path) > 3 * 1024 * 1024:
            frappe.log_error(
                title="SCHOLARSHIP_INTERVIEW_ATTACH_TOO_LARGE",
                message=f"{file_name!r} for event {event_id} exceeds Graph's 3MB simple-attachment limit — skipped.",
            )
            continue

        with open(resolved_path, "rb") as f:
            fb64 = base64.b64encode(f.read()).decode()

        attachment_files.append((file_name, fb64))

    attach_url = f"https://graph.microsoft.com/v1.0/users/{organizer_email}/events/{event_id}/attachments"

    existing_names = set()
    try:
        existing = requests.get(attach_url, headers=headers, params={"$select": "name"}, timeout=30)
        if existing.status_code == 200:
            existing_names = {a.get("name") for a in existing.json().get("value", [])}
    except Exception:
        frappe.log_error(
            title="SCHOLARSHIP_INTERVIEW_ATTACH_LIST_ERROR",
            message=f"Could not list existing attachments on event {event_id}: {frappe.get_traceback()}",
        )

    for fname, fb64 in attachment_files:
        if fname in existing_names:
            continue
        try:
            res = requests.post(
                attach_url,
                headers=headers,
                json={
                    "@odata.type": "#microsoft.graph.fileAttachment",
                    "name": fname,
                    "contentBytes": fb64,
                },
                timeout=60,
            )
            if res.status_code not in (200, 201):
                frappe.log_error(
                    title="SCHOLARSHIP_INTERVIEW_ATTACH_FAILED",
                    message=(
                        f"Attaching {fname!r} to event {event_id} failed | "
                        f"status={res.status_code} | body={res.text[:800]}"
                    ),
                )
        except Exception:
            frappe.log_error(
                title="SCHOLARSHIP_INTERVIEW_ATTACH_ERROR",
                message=f"Attaching {fname!r} to event {event_id}: {frappe.get_traceback()}",
            )


def _attendee_emails_for(interviewer_emails, room_emails):
    emails = set()
    for i in (interviewer_emails or "").split(","):
        i = i.strip()
        if i:
            emails.add(i)
    for r in (room_emails or "").split(","):
        r = r.strip()
        if r:
            emails.add(r)
    return emails


def _remove_event_from_attendee_calendars(headers, ical_uid, attendee_emails):
    """Best-effort: delete this meeting off each attendee's own calendar
    directly, instead of leaving Graph's /cancel notice for them to
    manually act on. Mirrors ms_philanthropy.py's helper of the same name
    — see its docstring for why a plain /cancel alone leaves a "Canceled:
    ..." entry sitting in each attendee's calendar until they click
    "Remove event" themselves. This app's application-level Graph
    credentials (client-credentials flow) reach any mailbox in the tenant,
    not just the organizer's, so it can go remove each attendee's own copy
    directly rather than waiting on them.
    """
    if not ical_uid:
        return
    for attendee_email in attendee_emails:
        try:
            lookup = requests.get(
                f"https://graph.microsoft.com/v1.0/users/{attendee_email}/events",
                headers=headers,
                params={"$filter": f"iCalUId eq '{ical_uid}'", "$select": "id"},
            )
            if lookup.status_code != 200:
                # Previously silent — a permission problem (e.g. an Exchange
                # Application Access Policy scoping this app away from an
                # attendee's mailbox) looked identical to "nothing to clean
                # up", with zero trace either way.
                frappe.log_error(
                    title="SCHOLARSHIP_INTERVIEW_CANCEL_ATTENDEE_LOOKUP_FAILED",
                    message=(
                        f"Looking up {attendee_email}'s copy of iCalUId={ical_uid!r} "
                        f"failed | status={lookup.status_code} | body={lookup.text[:500]}"
                    ),
                )
                continue
            for item in lookup.json().get("value", []):
                del_res = requests.delete(
                    f"https://graph.microsoft.com/v1.0/users/{attendee_email}/events/{item['id']}",
                    headers=headers,
                )
                # Also previously unchecked — a DELETE that Graph rejected
                # left the "Canceled: ..." placeholder sitting in the
                # attendee's calendar exactly as if this function had never
                # run at all, with nothing logged to tell the two cases apart.
                if del_res.status_code not in (200, 202, 204, 404):
                    frappe.log_error(
                        title="SCHOLARSHIP_INTERVIEW_CANCEL_ATTENDEE_DELETE_FAILED",
                        message=(
                            f"Deleting {attendee_email}'s copy (event {item['id']}) of "
                            f"iCalUId={ical_uid!r} failed | status={del_res.status_code} | "
                            f"body={del_res.text[:500]}"
                        ),
                    )
        except Exception:
            frappe.log_error(
                title="SCHOLARSHIP_INTERVIEW_CANCEL_ATTENDEE_CLEANUP",
                message=f"Failed to remove cancelled event from {attendee_email}'s calendar: {frappe.get_traceback()}",
            )


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
                           attachment_paths=None,
                           name=None):

    import re
    import time
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
    headers = _graph_headers()

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
    _attach_files_to_event(headers, Organizer_email, event_id, attachment_paths)

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

    # Persist the new Outlook event id (and clear any stale cancelled flag)
    # onto the Schedule interview record this was created for, so a later
    # "Modify The Schedule"/"Cancel The Schedule" call has something to act
    # on — mirrors ms_philanthropy.py's create_interview_event, and is also
    # what lets update_interview_event's 404-stale-event recovery delegate
    # back to this function and still end up with a usable event_id.
    if name:
        frappe.db.set_value(
            "Schedule interview",
            name,
            {"event_id": event_id, "is_cancelled": 0},
            update_modified=False,
        )

    return {
        "event_id": event_id,
        "join_url": join_web_url,
        "meeting_id": join_meeting_id,
        "passcode": join_passcode,
        "is_online": is_online
    }


@frappe.whitelist()
def update_interview_event(
    name,
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
    attachment_paths=None,
):
    """
    Reschedules an already-created Scholarship interview: PATCHes the
    existing Outlook event's time/room/attendees instead of creating a
    duplicate, (re-)attaches any files passed in before that PATCH fires
    (same attach-before-notify ordering fixed in ms_philanthropy.py's
    update_interview_event — PATCHing start/end/attendees is what makes
    Exchange send its own "meeting updated" notification, and that
    notification reflects whatever is on the event at that exact moment),
    then emails the candidate and interviewer(s) about the change.

    Mirrors create_interview_event's parameter names (Map_location, address,
    commands_to_candidate, commands_to_interviewer, Interview_round) so the
    same field values collected for create can be reused for a reschedule.
    """
    import time
    from datetime import datetime

    doc = frappe.get_doc("Schedule interview", name)
    if not doc.event_id:
        frappe.throw(
            "No Outlook event exists yet for this record — save it once with "
            "Interviewer's Email, Candidate Email, Interview Date, Start Time "
            "and End Time filled in to schedule it first."
        )
    if doc.is_cancelled:
        frappe.throw(
            "This interview was cancelled — it needs to be scheduled fresh, not rescheduled."
        )

    try:
        is_online = int(is_online)
    except:
        is_online = 0

    Organizer_email = Organizer_email.strip()
    Applicants_Role = Applicants_Role or ""
    Map_location = Map_location or ""
    address = address or ""
    commands_to_candidate = commands_to_candidate or ""
    commands_to_interviewer = commands_to_interviewer or ""

    start_dt = datetime.fromisoformat(start_datetime)
    end_dt = datetime.fromisoformat(end_datetime)
    when_str = start_dt.strftime("%A, %d %b %Y at %I:%M %p")
    mode_label = "Teams Meeting" if is_online == 1 else "In-Person"

    round_clean = str(Interview_round).strip().lower().replace(" ", "").replace("-", "").replace("–", "")
    is_round2 = "roundtwo" in round_clean

    headers = _graph_headers()
    event_url = f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events/{doc.event_id}"

    interviewer_list = [i.strip() for i in (interviewer_emails or "").split(",") if i.strip()]
    room_list = [r.strip() for r in (room_emails or "").split(",") if r.strip()]
    attendees = (
        [{"emailAddress": {"address": r}, "type": "resource"} for r in room_list]
        + [{"emailAddress": {"address": i}, "type": "required"} for i in interviewer_list]
    )

    # Attach BEFORE the time/attendees PATCH below, not after — see
    # ms_philanthropy.py's update_interview_event for why: PATCHing here is
    # what triggers Exchange's own "meeting updated" notification, and a
    # freshly-attached file only shows up in it if it's already on the
    # event by the time this PATCH fires.
    _attach_files_to_event(headers, Organizer_email, doc.event_id, attachment_paths)

    res = requests.patch(
        event_url,
        headers=headers,
        json={
            "start": {"dateTime": start_datetime, "timeZone": "Asia/Kolkata"},
            "end": {"dateTime": end_datetime, "timeZone": "Asia/Kolkata"},
            "attendees": attendees,
            "showAs": "busy",
        },
    )
    if res.status_code == 404:
        # The Outlook event this record's event_id points at is gone —
        # most likely deleted directly in Outlook rather than through this
        # app. Rather than fail the whole reschedule, recreate a fresh event
        # in its place; create_interview_event already knows how to persist
        # the new event_id back onto this record via the `name` parameter.
        frappe.log_error(
            title="SCHOLARSHIP_INTERVIEW_RESCHEDULE_STALE_EVENT",
            message=(
                f"Reschedule target Outlook event {doc.event_id} for {name} "
                f"returned 404 (likely deleted directly in Outlook) — "
                f"recreating a fresh event instead of failing the reschedule."
            ),
        )
        return create_interview_event(
            event_title=doc.event_title or f"Interview - {Applicants_name}",
            start_datetime=start_datetime,
            end_datetime=end_datetime,
            interviewer_emails=interviewer_emails,
            interviewee_email=interviewee_email,
            room_emails=room_emails,
            is_online=is_online,
            Organizer_email=Organizer_email,
            Interview_round=Interview_round,
            InterviewersName=InterviewersName,
            Applicants_name=Applicants_name,
            Applicants_Role=Applicants_Role,
            application_id=application_id,
            Map_location=Map_location,
            address=address,
            commands_to_candidate=commands_to_candidate,
            commands_to_interviewer=commands_to_interviewer,
            attachment_paths=attachment_paths,
            name=name,
        )
    res.raise_for_status()

    join_web_url = ""
    if is_online == 1:
        ev = requests.get(event_url, headers=headers).json()
        if ev.get("onlineMeeting"):
            join_web_url = ev["onlineMeeting"].get("joinUrl", "")

    meeting_html = (
        f'<p><b>Join Teams Meeting:</b> <a href="{join_web_url}" target="_blank">Join Now</a></p>'
        if is_online == 1 and join_web_url
        else "<p><b>Mode:</b> Offline Interview</p>"
    )

    # Same fix as create_interview_event's map_html — only render a venue /
    # map link when there's actually something to show, instead of a dead
    # "Google Map Link: Click here" pointing at href="".
    if is_online == 0 and (address or Map_location):
        map_html = ""
        if address:
            map_html += f'<p style="margin:6px 0;"><strong>Venue:</strong> {address}</p>'
        if Map_location:
            map_html += (
                f'<p style="margin:6px 0;"><strong>Google Map Link:</strong> '
                f'<a href="{Map_location}" target="_blank">Click here</a></p>'
            )
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

    form_key = "two" if is_round2 else "one"
    feedback_url = (
        f"https://careers.frappe.cloud/feedback-form-{form_key}/new"
        f"?app_id={application_id}&applicant_name={Applicants_name}"
    )

    interviewer_body = f"""
<p>Dear {InterviewersName},</p>
<p>The Scholarship interview below has been <strong>rescheduled</strong>:</p>
<p><b>Applicant:</b> {Applicants_name} ({Applicants_Role})</p>
<p><b>New When:</b> {when_str}</p>
<p><b>Mode:</b> {mode_label}</p>
{map_html}
{meeting_html}
{note_to_interviewer_html}
<p><b>Feedback form link:</b> <a href="{feedback_url}" target="_blank">Click here</a></p>
<p>Regards,<br>People Function</p>
"""

    candidate_body = f"""
<p>Dear {Applicants_name},</p>
<p>Your interview has been <strong>rescheduled</strong>:</p>
<p><b>New When:</b> {when_str}</p>
<p><b>Mode:</b> {mode_label}</p>
{map_html}
{meeting_html}
<p><b>Panel:</b> {InterviewersName}</p>
{note_to_candidate_html}
<p>Please acknowledge this email as confirmation to the interview.</p>
<p>Regards,<br>People Function<br>Azim Premji Foundation</p>
"""

    frappe.sendmail(
        recipients=[interviewee_email],
        sender=Organizer_email,
        subject=f"Interview Rescheduled - {Applicants_name} ({Applicants_Role} Role), Azim Premji Scholarship",
        message=candidate_body,
        delayed=False,
    )

    # Interviewers are Graph attendees on this event, and the PATCH above
    # already makes Exchange send them a native "meeting updated" notice in
    # the same invite thread — a separate frappe.sendmail here would be a
    # redundant second email for the same reschedule (same reasoning as
    # ms_philanthropy.py's update_interview_event/cancel_interview_event).

    frappe.db.set_value("Schedule interview", name, "event_id", doc.event_id, update_modified=False)

    frappe.msgprint("✅ Interview rescheduled — candidate and interviewer(s) notified.")

    return {"event_id": doc.event_id, "rescheduled": True}


@frappe.whitelist()
def cancel_interview_event(name):
    """
    Cancels an already-scheduled Scholarship interview: cancels the Outlook
    event via Graph (notifying attendees), then actively deletes it off each
    attendee's own calendar too rather than leaving that to Outlook's manual
    "Remove event" prompt, emails the candidate directly (they were never a
    Graph attendee, only invited by email), and clears event_id so the same
    record can be freely rescheduled later. Mirrors ms_philanthropy.py's
    cancel_interview_event.
    """
    doc = frappe.get_doc("Schedule interview", name)

    if doc.is_cancelled:
        frappe.throw("This interview is already cancelled.")

    if doc.event_id and doc.organizer_email:
        headers = _graph_headers()
        event_url = (
            f"https://graph.microsoft.com/v1.0/users/{doc.organizer_email}"
            f"/events/{doc.event_id}"
        )

        # Needed before cancelling to find each attendee's own copy of this
        # meeting afterwards — see _remove_event_from_attendee_calendars.
        ical_uid = None
        try:
            ev = requests.get(event_url, headers=headers, params={"$select": "iCalUId"})
            if ev.status_code == 200:
                ical_uid = ev.json().get("iCalUId")
        except Exception:
            frappe.log_error(
                title="SCHOLARSHIP_INTERVIEW_CANCEL_ICALUID",
                message=frappe.get_traceback(),
            )

        res = requests.post(
            f"{event_url}/cancel",
            headers=headers,
            json={"comment": "This interview has been cancelled."},
        )
        if res.status_code not in (202, 204, 404):
            frappe.log_error(
                title="SCHOLARSHIP_INTERVIEW_CANCEL",
                message=f"Graph cancel failed | status={res.status_code} | body={res.text[:800]}",
            )

        interviewer_emails_str = ", ".join(
            row.interviewer_email for row in (doc.interviewer_email or []) if row.interviewer_email
        )
        _remove_event_from_attendee_calendars(
            headers, ical_uid, _attendee_emails_for(interviewer_emails_str, doc.room_email)
        )

    from frappe.utils import formatdate, format_time

    interview_date = formatdate(doc.interview_date, "dd MMMM yyyy") if doc.interview_date else ""
    start_time = format_time(doc.start_time) if doc.start_time else ""
    end_time = format_time(doc.end_time) if doc.end_time else ""

    if doc.attendees:
        candidate_body = f"""
<p>Hi {doc.applicants_name or "there"},</p>
<p>This is to inform you that your interview scheduled on
<strong>{interview_date}</strong> ({start_time} – {end_time}) has been
<strong>cancelled</strong>.</p>
<p>We will reach out separately if the interview needs to be rescheduled.</p>
<p>Regards,<br>People Function<br>Azim Premji Foundation</p>
"""
        frappe.sendmail(
            recipients=[doc.attendees],
            sender=doc.organizer_email,
            subject=f"Interview Cancelled - Azim Premji Foundation ({interview_date})",
            message=candidate_body,
            delayed=False,
        )

    # Interviewers are Graph attendees on this event, and Graph's
    # /events/{id}/cancel action above already sends them a native
    # cancellation notice in the same meeting thread — a separate
    # frappe.sendmail here would be a redundant second email.

    doc.db_set("is_cancelled", 1, update_modified=False)
    doc.db_set("event_id", "", update_modified=False)

    frappe.msgprint("✅ Interview cancelled — candidate and interviewer(s) notified.")

    return {"cancelled": True}
