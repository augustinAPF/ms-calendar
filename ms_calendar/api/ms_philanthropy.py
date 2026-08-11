import frappe
import os, ast, base64, time, re, requests
from datetime import datetime, timedelta, timezone
from frappe.utils import get_url, formatdate, format_time, get_datetime
from urllib.parse import quote
from zoneinfo import ZoneInfo

# @frappe.whitelist()
# def create_interview_event(
#     start_datetime,
#     end_datetime,
#     interviewer_emails,
#     interviewee_email,
#     room_emails,
#     is_online,
#     Organizer_email,
#     InterviewersName,
#     Applicants_name,
#     Applicants_Role,
#     application_id,
#     Map_location,
#     Comments_for_interviewer,
#     Location_adress,
#     attachment_paths=None
# ):

#     # -------- FLAGS --------
#     try:
#         is_online = int(is_online)
#     except:
#         is_online = 0

#     Organizer_email = Organizer_email.strip()

#     start_dt = datetime.fromisoformat(start_datetime)
#     end_dt   = datetime.fromisoformat(end_datetime)

#     interview_date = start_dt.strftime("%d/%m/%Y")
#     interview_time = start_dt.strftime("%I:%M %p")
#     # Format (example: 10:30 AM)
#     start_time = start_dt.strftime("%I:%M %p")
#     end_time   = end_dt.strftime("%I:%M %p")
#     mode_label   = "Teams Meeting" if is_online == 1 else "In-Person"
#     meeting_room = ", ".join([r.strip() for r in (room_emails or "").split(",") if r.strip()])

#     # -------- GRAPH AUTH --------
#     creds = frappe.get_single("MS Graph Credentials")

#     token = requests.post(
#         f"https://login.microsoftonline.com/{creds.tenant_id}/oauth2/v2.0/token",
#         data={
#             "grant_type": "client_credentials",
#             "client_id": creds.client_id,
#             "client_secret": creds.get_password("client_secret"),
#             "scope": "https://graph.microsoft.com/.default"
#         }
#     )
#     token.raise_for_status()
#     access_token = token.json()["access_token"]

#     headers = {
#         "Authorization": f"Bearer {access_token}",
#         "Content-Type": "application/json"
#     }

#     # -------- CREATE EVENT --------
#     create_url = f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events"

#     draft_payload = {
#         "subject": f"Discussion with {Applicants_name} - ({Applicants_Role})",
#         "isOnlineMeeting": True if is_online == 1 else False,
#         "onlineMeetingProvider": "teamsForBusiness" if is_online == 1 else None,
#         "showAs": "busy",
#         "start": {"dateTime": start_datetime, "timeZone": "Asia/Kolkata"},
#         "end": {"dateTime": end_datetime, "timeZone": "Asia/Kolkata"},
#         "body": {"contentType": "HTML", "content": "<p>Interview scheduled.</p>"}
#     }

#     res = requests.post(create_url, headers=headers, json=draft_payload)
#     res.raise_for_status()
#     event = res.json()
#     event_id = event["id"]

#     event_url = f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events/{event_id}"

#     # -------- FETCH MEETING DETAILS --------
#     join_web_url = ""
#     join_meeting_id = ""
#     join_passcode = ""

#     for _ in range(10):
#         ev = requests.get(event_url, headers=headers).json()

#         # join link
#         if ev.get("onlineMeeting"):
#             join_web_url = ev["onlineMeeting"].get("joinUrl", "") or join_web_url

#         # parse HTML body for ID + passcode
#         try:
#             html_body = ev.get("body", {}).get("content", "")

#             m1 = re.search(r"Meeting ID:\s*</span><span[^>]*>([\d\s]+)<", html_body)
#             if not m1:
#                 m1 = re.search(r"Meeting ID:\s*([\d\s]+)", html_body)
#             if m1:
#                 join_meeting_id = m1.group(1).strip()

#             m2 = re.search(r"Passcode:\s*</span><span[^>]*>([\w\d]+)<", html_body)
#             if not m2:
#                 m2 = re.search(r"Passcode:\s*([\w\d]+)", html_body)
#             if m2:
#                 join_passcode = m2.group(1).strip()

#         except Exception:
#             pass

#         if join_web_url and join_meeting_id and join_passcode:
#             break

#         time.sleep(1)

#     # -------- SECONDARY FALLBACK (onlineMeetings filter) --------
#     if is_online == 1 and join_web_url and (not join_meeting_id or not join_passcode):
#         filter_url = (
#             f"https://graph.microsoft.com/v1.0/users/{Organizer_email}"
#             f"/onlineMeetings?$filter=JoinWebUrl eq '{join_web_url}'"
#         )

#         om = requests.get(filter_url, headers=headers)
#         if om.status_code == 200:
#             values = om.json().get("value", [])
#             if values:
#                 m = values[0]
#                 join_meeting_id = m.get("joinMeetingId", "") or join_meeting_id
#                 join_passcode   = m.get("passcode", "") or join_passcode

#     # -------- MEETING HTML --------
#     if is_online == 1 and join_web_url:
#         meeting_html = f"""
#         <p><b>Join Teams Meeting:</b>
#         <a href="{join_web_url}" target="_blank">Join Now</a></p>

#         <p><b>Meeting ID:</b> {join_meeting_id}<br>
#         <b>Passcode:</b> {join_passcode}</p>
#         """
#     else:
#         meeting_html = ""

#     # -------- ATTACH FILES --------
#     attachment_files = []

#     if attachment_paths:
#         try:
#             paths = ast.literal_eval(attachment_paths)
#         except:
#             paths = []
#     else:
#         paths = []

#     for web_path in paths:
#         file_doc = frappe.get_all(
#             "File",
#             filters={"file_url": web_path},
#             fields=["file_url", "file_name", "is_private"]
#         )
#         if not file_doc:
#             continue

#         file_doc = file_doc[0]
#         file_name = file_doc.file_name

#         if file_doc.is_private:
#             file_path = frappe.get_site_path("private", "files", file_name)
#         else:
#             file_path = frappe.get_site_path("public", "files", file_name)

#         if not os.path.isfile(file_path):
#             continue

#         with open(file_path, "rb") as f:
#             fb64 = base64.b64encode(f.read()).decode()

#         attachment_files.append((file_name, fb64))

#     attach_url = f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events/{event_id}/attachments"
#     for fname, fb64 in attachment_files:
#         requests.post(
#             attach_url,
#             headers=headers,
#             json={
#                 "@odata.type": "#microsoft.graph.fileAttachment",
#                 "name": fname,
#                 "contentBytes": fb64
#             }
#         )

#     # -------- EMAIL CONTENT --------
#     # feedback_url = f"https://careers.frappe.cloud/philanthrophy-feedback-form/new?app_id={application_id}&applicant_name={Applicants_name}"
#     feedback_url = (
#             f"https://careers.frappe.cloud/philanthrophy-feedback-form/new"
#             f"?app_id={application_id}&applicant_name={Applicants_name}&role={Applicants_Role}"
#         )
#     # Show this only if meeting_room has a value
#     meeting_room_html = (
#         f'<p style="margin:6px 0;"><strong>Meeting room:</strong> {room_Name}</p>'
#         if room_Name
#         else ""
#     )
#     Map_location_html = (
#         f'<p style="margin:6px 0;"><strong>Venue:</strong> {Location_adress}</p>'
#         f'<p style="margin:6px 0;"><strong>Google Map Link:</strong>'
#         f'<a href="{Map_location}" target="_blank">Click here</a></p>'
#     )
#     map_html = Map_location_html if is_online == 0 else ""
#     note_html = (
#     f'<p><strong>For your information:</strong> {Comments_for_interviewer}</p>'

#     if Comments_for_interviewer
#     else ""
# )
#     file_path = frappe.get_site_path("public", "files", "APF logo.png")

#     with open(file_path, "rb") as f:
#         logo_base64 = base64.b64encode(f.read()).decode("utf-8")
#     interviewer_body = f"""
#     <p>Hi {InterviewersName},</p>

#     <p>Kindly find the details of the interview scheduled:</p>

#     <div style="
#     border:1px solid #e3e3e3;
#     border-radius:10px;
#     padding:14px;
#     background:#f9fafb;
#     display:inline-block;
#     max-width:100%;
#     ">
#     <p style="margin:6px 0;"><strong>Applicant name:</strong> {Applicants_name}</p>
#     <p style="margin:6px 0;"><strong>Role:</strong> {Applicants_Role}</p>
#     <p style="margin:6px 0;"><strong>Date:</strong> {interview_date}</p>
#     <p style="margin:6px 0;"><strong>Time:</strong> {start_time} – {end_time}</p>
#     <p style="margin:6px 0;"><strong>Mode:</strong> {mode_label}</p>
#     {meeting_room_html}
#     </div>

#     {meeting_html}
#     <p><strong>Feedback form:</strong>
#     <a href="{feedback_url}" target="_blank">Click here</a></p>

#     {note_html}

#     <p>Regards,<br>
#     People Function<br>
#     Azim Premji Foundation</p>
#     <p style="margin:12px 0;">
#     <img src="{logo_base64}"
#          alt="Azim Premji Foundation"
#          style="height:48px; width:auto; display:block; margin-top:6px;">
# </p>
#     """


#     candidate_body = f"""
#     <p>Hi {Applicants_name},</p>

#     <p>Kindly find the details of the interview scheduled:</p>

#     <div style="
#     border:1px solid #e3e3e3;
#     border-radius:10px;
#     padding:14px;
#     background:#f9fafb;
#     display:inline-block;
#     max-width:100%;
#     ">
#     <p style="margin:6px 0;"><strong>Role:</strong> {Applicants_Role}</p>
#     <p style="margin:6px 0;"><strong>Date:</strong> {interview_date}</p>
#     <p style="margin:6px 0;"><strong>Time:</strong> {start_time} – {end_time}</p>
#     <p style="margin:6px 0;"><strong>Mode:</strong> {mode_label}</p>
#     {map_html}
#     </div>
#     {meeting_html}

#     <p>Kindly reach out to us if you have any questions.</p>

#     <p>Regards,<br>
#     People Function<br>
#     Azim Premji Foundation</p>
#      <img src="{logo_base64}"
#          alt="Azim Premji Foundation"
#          style="height:48px; width:auto; display:block; margin-top:6px;">
# </p>
#     """


#     # -------- UPDATE EVENT BODY & ATTENDEES (Outlook will notify interviewers) --------
#     interviewer_list = [i.strip() for i in (interviewer_emails or "").split(",") if i.strip()]
#     attendees = [{"emailAddress": {"address": i}, "type": "required"} for i in interviewer_list]

#     requests.patch(
#         event_url,
#         headers=headers,
#         json={
#             "attendees": attendees,
#             "body": {"contentType": "HTML", "content": interviewer_body},
#             "showAs": "busy"
#         }
#     )

#     # -------- ONLY CANDIDATE EMAIL --------
#     frappe.sendmail(
#         recipients=[interviewee_email],
#         sender=Organizer_email,
#         subject=f"Discussion – Azim Premji Foundation ({interview_date})",
#         message=candidate_body,
#         delayed=False
#     )

#     frappe.msgprint("✅ Event created successfully — Outlook notified automatically.")


#     return {
#         "event_id": event_id,
#         "join_url": join_web_url,
#         "meeting_id": join_meeting_id,
#         "passcode": join_passcode,
#         "is_online": is_online
#     }
def _graph_headers():
    """Client-credentials OAuth against MS Graph; shared by create/update/cancel."""
    creds = frappe.get_single("MS Graph Credentials")

    token = requests.post(
        f"https://login.microsoftonline.com/{creds.tenant_id}/oauth2/v2.0/token",
        data={
            "grant_type": "client_credentials",
            "client_id": creds.client_id,
            "client_secret": creds.get_password("client_secret"),
            "scope": "https://graph.microsoft.com/.default",
        },
    )
    token.raise_for_status()
    return {
        "Authorization": f"Bearer {token.json()['access_token']}",
        "Content-Type": "application/json",
    }


def _get_room_display_name(room_email, headers):
    url = (
        "https://graph.microsoft.com/v1.0/places/microsoft.graph.room"
        f"?$filter=emailAddress eq '{room_email}'"
    )
    res = requests.get(url, headers=headers)
    if res.status_code != 200:
        return room_email

    values = res.json().get("value", [])
    if not values:
        return room_email

    return values[0].get("displayName") or room_email


def _resolve_meeting_room(room_emails, headers):
    room_list = [r.strip() for r in (room_emails or "").split(",") if r.strip()]
    return ", ".join(_get_room_display_name(r, headers) for r in room_list)


def _logo_html():
    logo_path = frappe.get_site_path("public", "files", "apf email.png")
    if not os.path.isfile(logo_path):
        return ""
    with open(logo_path, "rb") as f:
        logo_base64 = base64.b64encode(f.read()).decode("utf-8")
    return f'<img src="data:image/png;base64,{logo_base64}" style="height:48px;">'


def _theme_geo_subline(theme, geo):
    """' - (Role | Theme: X / Geo: Y)'-style segment appended to subject lines."""
    parts = []
    if theme:
        parts.append(f"Theme: {theme}")
    if geo:
        parts.append(f"Geo: {geo}")
    return f" | {' / '.join(parts)}" if parts else ""


@frappe.whitelist()
def get_org_rooms_and_availability(interview_date, start_time, end_time):
    """
    Lists every bookable room in the org and whether each is free for the
    given slot — backs the "Select Meeting Rooms" dialog on Philanthropy
    Interview Schedule. Self-contained here (uses this file's own
    _graph_headers()) rather than routing through ms_calendar.api.msgraph;
    that module's copy of this function is only kept around for the
    unrelated "Schedule interview" doctype.
    """
    IST = ZoneInfo("Asia/Kolkata")
    headers = _graph_headers()

    # -------- ALL ROOMS (PAGINATED) --------
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
        frappe.log_error(
            frappe.get_traceback(), "Philanthropy room availability: room list fetch failed"
        )
        frappe.throw(
            f"Could not fetch the room list from Microsoft Graph — try again in a moment. ({e})"
        )

    room_emails = [r.get("emailAddress") for r in rooms if r.get("emailAddress")]

    # -------- TIME RANGE --------
    # Interviews are always entered in India time regardless of where this
    # code happens to run — deriving the offset from the host machine's OS
    # timezone would silently produce wrong busy/available results on any
    # server not itself configured for Asia/Kolkata. Hardcode it instead.
    start_local = get_datetime(f"{interview_date} {start_time}")
    end_local = get_datetime(f"{interview_date} {end_time}")
    start_utc = start_local.replace(tzinfo=IST).astimezone(timezone.utc)
    end_utc = end_local.replace(tzinfo=IST).astimezone(timezone.utc)

    # -------- AVAILABILITY IN BATCHES --------
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
            "availabilityViewInterval": 5,
        }

        try:
            resp = requests.post(
                schedule_url,
                headers={**headers, "Content-Type": "application/json"},
                json=body,
                timeout=20,
            )
            resp.raise_for_status()
        except requests.exceptions.RequestException:
            # Don't fail the whole check because one batch of ~20 rooms
            # timed out/errored — log it and treat those rooms as unknown
            # (excluded below) rather than silently marking them available.
            frappe.log_error(
                frappe.get_traceback(),
                f"Philanthropy room availability: getSchedule batch failed for {batch}",
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

    # -------- FINAL OUTPUT --------
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
            "is_available": available,
        })

    return {"rooms": final}


def _attach_files_to_event(headers, organizer_email, event_id, attachment_paths, extra_paths=None):
    """Resolve each url in `attachment_paths` (a JSON-encoded list of Attach-
    field urls, as sent by philanthropy_interview_schedule.js's after_save —
    frappe.call() JSON.stringify()s array args before sending) to a real
    File record and POST it onto the given Graph event as an attachment.

    Shared by create_interview_event and update_interview_event — the
    reschedule path used to have no equivalent of this at all: its function
    signature never declared an `attachment_paths` parameter, so
    frappe.call()'s dispatcher (get_newargs — see frappe/__init__.py) simply
    dropped that argument silently on every reschedule, no error either
    side. Whatever CV/feedback/assignment file the recruiter had just
    attached before saving never reached the event; only whatever was
    attached back when the event was first created stuck around, since
    update_interview_event's PATCH never touches attachments either.
    """
    attachment_files = []
    if attachment_paths:
        try:
            paths = ast.literal_eval(attachment_paths)
        except Exception:
            paths = []
    else:
        paths = []

    for extra in extra_paths or []:
        if extra and extra not in paths:
            paths.append(extra)

    for web_path in paths:
        # More than one File row can share the exact same file_url (a
        # leftover duplicate from an earlier interrupted rename — same
        # class of drift resume_rename.py's own stale-cleanup guards
        # against). Querying without limit=1 and checking every candidate,
        # rather than blindly trusting whichever the DB happens to return
        # first, matters here specifically: a broken duplicate (wrong/
        # stale file_name, no physical file behind it) sorting before the
        # real one used to make this silently give up on an attachment
        # that was actually sitting right there under a different row.
        candidates = frappe.get_all(
            "File",
            filters={"file_url": web_path},
            fields=["file_url", "file_name", "is_private"],
        )
        if not candidates:
            frappe.log_error(
                title="PHILANTHROPY_INTERVIEW_ATTACH_NO_FILE_RECORD",
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
            # `is_private` can be stale vs. where the bytes actually live
            # (bulk imports / reused "library file" attachments) — check the
            # other folder before giving up on this candidate.
            alt_path = frappe.get_site_path(
                "public" if candidate.is_private else "private", "files", file_name
            )
            if os.path.isfile(alt_path):
                resolved_path = alt_path
                break

        if not resolved_path:
            frappe.log_error(
                title="PHILANTHROPY_INTERVIEW_ATTACH_FILE_MISSING",
                message=(
                    f"url={web_path!r} for event {event_id} matched {len(candidates)} "
                    f"File record(s), but none resolve to a real file on disk in "
                    f"either public or private folders — nothing to attach."
                ),
            )
            continue

        with open(resolved_path, "rb") as f:
            fb64 = base64.b64encode(f.read()).decode()

        attachment_files.append((file_name, fb64))

    attach_url = f"https://graph.microsoft.com/v1.0/users/{organizer_email}/events/{event_id}/attachments"

    # Graph's attachments endpoint has no dedupe of its own — POSTing the
    # same file twice just adds a second copy. update_interview_event now
    # runs this on every Modify/reschedule (see its own comment on why), so
    # an unchanged CV that's still in attachment_paths from a previous save
    # would otherwise pile up one more copy each time. Skip anything whose
    # name already matches an attachment already sitting on the event.
    existing_names = set()
    try:
        existing = requests.get(attach_url, headers=headers, params={"$select": "name"}, timeout=30)
        if existing.status_code == 200:
            existing_names = {a.get("name") for a in existing.json().get("value", [])}
    except Exception:
        frappe.log_error(
            title="PHILANTHROPY_INTERVIEW_ATTACH_LIST_ERROR",
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
            # This POST's response was never checked at all — a failure
            # here (bad permissions, a >3MB attachment tripping Graph's
            # simple-attachment size limit, a transient error) previously
            # raised nothing and logged nothing, so a file could silently
            # never reach the event with zero trace of why.
            if res.status_code not in (200, 201):
                frappe.log_error(
                    title="PHILANTHROPY_INTERVIEW_ATTACH_FAILED",
                    message=(
                        f"Attaching {fname!r} to event {event_id} failed | "
                        f"status={res.status_code} | body={res.text[:800]}"
                    ),
                )
        except Exception:
            frappe.log_error(
                title="PHILANTHROPY_INTERVIEW_ATTACH_ERROR",
                message=f"Attaching {fname!r} to event {event_id}: {frappe.get_traceback()}",
            )


@frappe.whitelist()
def create_interview_event(
    start_datetime,
    end_datetime,
    interviewer_emails,
    interviewee_email,
    room_emails,
    is_online,
    Organizer_email,
    InterviewersName,
    Applicants_name,
    application_id,
    Applicants_Role=None,
    Map_location=None,
    Comments_for_interviewer=None,
    Location_adress=None,
    cc_emails=None,
    attachment_paths=None,
    name=None,
):

    try:
        is_online = int(is_online)
    except:
        is_online = 0

    Organizer_email = Organizer_email.strip()
    Applicants_Role = Applicants_Role or ""
    Map_location = Map_location or ""
    Comments_for_interviewer = Comments_for_interviewer or ""
    Location_adress = Location_adress or ""

    start_dt = datetime.fromisoformat(start_datetime)
    end_dt = datetime.fromisoformat(end_datetime)

    interview_date = start_dt.strftime("%d %B %Y")
    start_time = start_dt.strftime("%I:%M %p")
    start_time = start_dt.strftime("%I:%M %p")
    end_time = end_dt.strftime("%I:%M %p")
    mode_label = "Teams Meeting" if is_online == 1 else "In-Person"

    headers = _graph_headers()
    meeting_room = _resolve_meeting_room(room_emails, headers)

    _theme = _geo = None
    application_pdf_url = None
    if application_id:
        _tg = frappe.db.get_value(
            "Phil Registration Form",
            application_id,
            ["themes", "geo", "phil_application_pdf"],
            as_dict=True,
        )
        if _tg:
            _theme, _geo = _tg.get("themes"), _tg.get("geo")
            application_pdf_url = _tg.get("phil_application_pdf")
    _subline = _theme_geo_subline(_theme, _geo)

    # -------- CREATE EVENT --------
    create_url = f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events"

    draft_payload = {
        "subject": f"Discussion with {Applicants_name} - ({Applicants_Role}){_subline}",
        "isOnlineMeeting": True if is_online == 1 else False,
        "onlineMeetingProvider": "teamsForBusiness" if is_online == 1 else None,
        "showAs": "busy",
        "start": {"dateTime": start_datetime, "timeZone": "Asia/Kolkata"},
        "end": {"dateTime": end_datetime, "timeZone": "Asia/Kolkata"},
        "location": {"displayName": meeting_room} if meeting_room else None,
        "locations": (
            [{"displayName": meeting_room, "locationType": "conferenceRoom"}]
            if meeting_room
            else []
        ),
        "body": {"contentType": "HTML", "content": "<p>Interview scheduled.</p>"},
    }

    res = requests.post(create_url, headers=headers, json=draft_payload)
    res.raise_for_status()
    event = res.json()
    event_id = event["id"]

    event_url = (
        f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events/{event_id}"
    )

    # -------- FETCH MEETING DETAILS --------
    # Only relevant for Teams meetings — an in-person event has no
    # onlineMeeting/join details to poll for, so skip this entirely rather
    # than burning a guaranteed ~10s (10 x 1s sleep) and 10 Graph GET
    # requests waiting for data that will never appear.
    join_web_url = ""
    join_meeting_id = ""
    join_passcode = ""

    if is_online == 1:
        for _ in range(10):
            ev = requests.get(event_url, headers=headers).json()

            if ev.get("onlineMeeting"):
                join_web_url = ev["onlineMeeting"].get("joinUrl", "") or join_web_url

            try:
                html_body = ev.get("body", {}).get("content", "")

                m1 = re.search(r"Meeting ID:\s*</span><span[^>]*>([\d\s]+)<", html_body)
                if not m1:
                    m1 = re.search(r"Meeting ID:\s*([\d\s]+)", html_body)
                if m1:
                    join_meeting_id = m1.group(1).strip()

                m2 = re.search(r"Passcode:\s*</span><span[^>]*>([\w\d]+)<", html_body)
                if not m2:
                    m2 = re.search(r"Passcode:\s*([\w\d]+)", html_body)
                if m2:
                    join_passcode = m2.group(1).strip()

            except Exception:
                pass

            if join_web_url and join_meeting_id and join_passcode:
                break

            time.sleep(1)

    if is_online == 1 and join_web_url and (not join_meeting_id or not join_passcode):
        filter_url = (
            f"https://graph.microsoft.com/v1.0/users/{Organizer_email}"
            f"/onlineMeetings?$filter=JoinWebUrl eq '{join_web_url}'"
        )
        om = requests.get(filter_url, headers=headers)
        if om.status_code == 200:
            values = om.json().get("value", [])
            if values:
                m = values[0]
                join_meeting_id = m.get("joinMeetingId", "") or join_meeting_id
                join_passcode = m.get("passcode", "") or join_passcode

    meeting_html = (
        f"""
        <p><b>Join Teams Meeting:</b>
        <a href="{join_web_url}" target="_blank">Join Now</a></p>
        <p><b>Meeting ID:</b> {join_meeting_id}<br>
        <b>Passcode:</b> {join_passcode}</p>
        """
        if is_online == 1 and join_web_url
        else ""
    )

    # -------- ATTACH FILES --------
    # Always include the candidate's Application PDF (Phil Registration Form)
    # so interviewers have it on hand for the interview — this only ever
    # reaches the Graph event's attachments below (i.e. the interviewer/room
    # calendar invite), never the candidate's own frappe.sendmail further
    # down, so the candidate is never sent their own PDF back.
    extra_paths = [application_pdf_url] if application_pdf_url else []
    _attach_files_to_event(headers, Organizer_email, event_id, attachment_paths, extra_paths)

    logo_html = _logo_html()

    # ---- EMAIL BODY PARTS ----
    feedback_url = get_url(
        f"/philanthrophy-feedback-form/new"
        f"?app_id={application_id}&applicant_name={Applicants_name}&role={Applicants_Role}"
    )

    meeting_room_html = (
        f'<p style="margin:6px 0;"><strong>Meeting room:</strong> {meeting_room}</p>'
        if meeting_room
        else ""
    )

    # The map-link line used to render unconditionally whenever the
    # interview was in-person, regardless of whether Map_location actually
    # had a value — an empty/unset google_map_link still produced
    # <a href=""> ("Click here" that goes nowhere, reads as "not
    # clickable"). Venue text is shown on its own either way; the link
    # line only appears when there's a real URL to link to.
    venue_html = (
        f'<p style="margin:6px 0;"><strong>Venue:</strong> {Location_adress}</p>'
        if Location_adress
        else ""
    )
    map_link_html = (
        f'<p style="margin:6px 0;"><strong>Google Map Link:</strong> '
        f'<a href="{Map_location}" target="_blank">Click here</a></p>'
        if Map_location
        else ""
    )
    Map_location_html = venue_html + map_link_html
    map_html = Map_location_html if is_online == 0 else ""

    note_html = (
        f"<p><strong>For your information:</strong> {Comments_for_interviewer}</p>"
        if Comments_for_interviewer
        else ""
    )

    interviewer_body = f"""
    <p>Hi {InterviewersName},</p>
    <p>Kindly find the details of the interview scheduled:</p>
    <div style="border:1px solid #e3e3e3;border-radius:10px;padding:14px;background:#f9fafb;">
    <p><strong>Applicant name:</strong> {Applicants_name}</p>
    <p><strong>Role:</strong> {Applicants_Role}</p>
    <p><strong>Date:</strong> {interview_date}</p>
    <p><strong>Time:</strong> {start_time} – {end_time}</p>
    <p><strong>Mode:</strong> {mode_label}</p>
    {meeting_room_html}
    {map_html}
    </div>
    {meeting_html}
    <p><strong>Feedback form:</strong>
    <a href="{feedback_url}" target="_blank">Click here</a></p>
    {note_html}
    <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
    {logo_html}
    """

    candidate_body = f"""
    <p>Hi {Applicants_name},</p>
    <p>Kindly find the details of the interview scheduled:</p>
    <div style="border:1px solid #e3e3e3;border-radius:10px;padding:14px;background:#f9fafb;">
    <p><strong>Role:</strong> {Applicants_Role}</p>
    <p><strong>Date:</strong> {interview_date}</p>
    <p><strong>Time:</strong> {start_time} – {end_time}</p>
    <p><strong>Mode:</strong> {mode_label}</p>
    {map_html}
    </div>
    {meeting_html}
    <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
    {logo_html}
    """

    interviewer_list = [
        i.strip() for i in (interviewer_emails or "").split(",") if i.strip()
    ]
    cc_list = [i.strip() for i in (cc_emails or "").split(",") if i.strip()]
    room_list = [r.strip() for r in (room_emails or "").split(",") if r.strip()]
    # Rooms must be added as "resource" attendees, not just written into the
    # location text — otherwise Graph never sends the room a booking request
    # and its own calendar never shows the slot as busy (the "Block Rooms"
    # picker only stores the room's email/name locally; this is what
    # actually reserves it).
    attendees = (
        [{"emailAddress": {"address": i}, "type": "required"} for i in interviewer_list]
        + [{"emailAddress": {"address": i}, "type": "optional"} for i in cc_list]
        + [{"emailAddress": {"address": r}, "type": "resource"} for r in room_list]
    )

    requests.patch(
        event_url,
        headers=headers,
        json={
            "attendees": attendees,
            "body": {"contentType": "HTML", "content": interviewer_body},
            "showAs": "busy",
        },
    )

    frappe.sendmail(
        recipients=[interviewee_email],
        sender=Organizer_email,
        subject=f"Discussion – Azim Premji Foundation ({interview_date}){_subline}",
        message=candidate_body,
        delayed=False,
    )

    # interviewer_body (with its feedback-form link) reaches the interviewer
    # only through the Outlook calendar invite's own body, via the PATCH
    # above — deliberately not also sent as a separate standalone email here.
    # An earlier attempt at adding one landed as a redundant 3rd email
    # alongside this candidate email and the auto-generated calendar invite;
    # two emails total (candidate + calendar invite) is the intended count.
    frappe.msgprint("✅ Event created successfully — Outlook notified automatically.")

    if name:
        frappe.db.set_value(
            "Philanthropy Interview Schedule",
            name,
            {"event_id": event_id, "is_cancelled": 0},
            update_modified=False,
        )

    return {
        "event_id": event_id,
        "join_url": join_web_url,
        "meeting_id": join_meeting_id,
        "passcode": join_passcode,
        "is_online": is_online,
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
    InterviewersName,
    Applicants_name,
    application_id,
    Applicants_Role=None,
    Map_location=None,
    Comments_for_interviewer=None,
    Location_adress=None,
    cc_emails=None,
    attachment_paths=None,
):
    """
    Reschedules an already-created interview: PATCHes the existing Outlook
    event's time/room/attendees instead of creating a duplicate, attaches
    any files passed in (CV, feedback PDF, assignment — same as at create
    time; PATCHing time/attendees never touches existing attachments, and
    this function previously had no attachment_paths parameter at all, so
    frappe.call() silently dropped whatever the JS side sent), then emails
    the candidate and interviewers about the change.
    """
    doc = frappe.get_doc("Philanthropy Interview Schedule", name)
    if not doc.event_id:
        frappe.throw(
            "No Outlook event exists yet for this record — save it once with "
            "Interviewer Email, Candidate Email, Date, Start Time and End Time "
            "filled in to schedule it first."
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
    Location_adress = Location_adress or ""

    start_dt = datetime.fromisoformat(start_datetime)
    end_dt = datetime.fromisoformat(end_datetime)
    interview_date = start_dt.strftime("%d %B %Y")
    start_time = start_dt.strftime("%I:%M %p")
    end_time = end_dt.strftime("%I:%M %p")
    mode_label = "Teams Meeting" if is_online == 1 else "In-Person"

    headers = _graph_headers()
    meeting_room = _resolve_meeting_room(room_emails, headers)

    event_url = f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events/{doc.event_id}"

    interviewer_list = [i.strip() for i in (interviewer_emails or "").split(",") if i.strip()]
    cc_list = [i.strip() for i in (cc_emails or "").split(",") if i.strip()]
    room_list = [r.strip() for r in (room_emails or "").split(",") if r.strip()]
    attendees = (
        [{"emailAddress": {"address": i}, "type": "required"} for i in interviewer_list]
        + [{"emailAddress": {"address": i}, "type": "optional"} for i in cc_list]
        + [{"emailAddress": {"address": r}, "type": "resource"} for r in room_list]
    )

    # Attach BEFORE the time/attendees PATCH below, not after — PATCHing
    # start/end/attendees is what makes Exchange fire its own "meeting
    # updated" notification to everyone on the invite, and that notification
    # reflects whatever's on the event AT THAT MOMENT. Attaching afterwards
    # (as this used to) meant the notification always went out before the
    # new file existed on the event — the reason a freshly-attached CV
    # never showed up after using "Modify The Schedule": it geniunely was
    # being attached, just one step too late for anyone to see it in what
    # they'd already been notified about. A failed attach here (e.g. the
    # event was deleted directly in Outlook) is harmless — it only logs,
    # the PATCH below still runs and its own 404 handling recovers the same
    # way it always did.
    _attach_files_to_event(headers, Organizer_email, doc.event_id, attachment_paths)

    res = requests.patch(
        event_url,
        headers=headers,
        json={
            "start": {"dateTime": start_datetime, "timeZone": "Asia/Kolkata"},
            "end": {"dateTime": end_datetime, "timeZone": "Asia/Kolkata"},
            "location": {"displayName": meeting_room} if meeting_room else None,
            "locations": (
                [{"displayName": meeting_room, "locationType": "conferenceRoom"}]
                if meeting_room
                else []
            ),
            "attendees": attendees,
            "showAs": "busy",
        },
    )
    if res.status_code == 404:
        # The Outlook event this record's event_id points at is gone —
        # most likely someone deleted it directly in Outlook rather than
        # through this app. PATCHing a deleted event always 404s, so
        # rather than crash the whole reschedule, recover by creating a
        # fresh event in its place. create_interview_event() already
        # knows how to update this record's event_id once the new event
        # exists (it accepts the same `name` this function was called
        # with), so delegate to it instead of duplicating that logic.
        frappe.log_error(
            title="PHILANTHROPY_INTERVIEW_RESCHEDULE_STALE_EVENT",
            message=(
                f"Reschedule target Outlook event {doc.event_id} for {name} "
                f"returned 404 (likely deleted directly in Outlook) — "
                f"recreating a fresh event instead of failing the reschedule."
            ),
        )
        return create_interview_event(
            start_datetime=start_datetime,
            end_datetime=end_datetime,
            interviewer_emails=interviewer_emails,
            interviewee_email=interviewee_email,
            room_emails=room_emails,
            is_online=is_online,
            Organizer_email=Organizer_email,
            InterviewersName=InterviewersName,
            Applicants_name=Applicants_name,
            application_id=application_id,
            Applicants_Role=Applicants_Role,
            Map_location=Map_location,
            Comments_for_interviewer=Comments_for_interviewer,
            Location_adress=Location_adress,
            cc_emails=cc_emails,
            attachment_paths=attachment_paths,
            name=name,
        )
    res.raise_for_status()

    # Online meetings keep the same Teams link across a reschedule, so just
    # read it back once — no need for create_interview_event's create-time
    # polling loop (that loop exists because the link isn't ready immediately
    # after the event is first created; here the meeting already exists).
    join_web_url = ""
    if is_online == 1:
        ev = requests.get(event_url, headers=headers).json()
        if ev.get("onlineMeeting"):
            join_web_url = ev["onlineMeeting"].get("joinUrl", "")

    meeting_html = (
        f'<p><b>Join Teams Meeting:</b> <a href="{join_web_url}" target="_blank">Join Now</a></p>'
        if is_online == 1 and join_web_url
        else ""
    )

    logo_html = _logo_html()

    # Same fix as create_interview_event's venue_html/map_link_html — don't
    # render a "Google Map Link: Click here" that points at an empty href
    # just because the interview is in-person; only when there's an actual
    # URL to link to.
    venue_html = (
        f'<p style="margin:6px 0;"><strong>Venue:</strong> {Location_adress}</p>'
        if Location_adress
        else ""
    )
    map_link_html = (
        f'<p style="margin:6px 0;"><strong>Google Map Link:</strong> '
        f'<a href="{Map_location}" target="_blank">Click here</a></p>'
        if Map_location
        else ""
    )
    map_html = (venue_html + map_link_html) if is_online == 0 else ""
    meeting_room_html = (
        f'<p><strong>Meeting room:</strong> {meeting_room}</p>' if meeting_room else ""
    )

    # Same feedback-form link create_interview_event sends the interviewer —
    # missing here was the actual bug: a reschedule replaces the interviewer's
    # only real, standalone email (the calendar invite's body isn't touched
    # by this function's PATCH, but interviewers act on this email, not on
    # re-opening the original invite) with one that never mentions feedback
    # at all, so anyone whose interview got rescheduled — which is common —
    # never received a working feedback link until the next-day reminder
    # job (send_interviewer_feedback_reminders) eventually catches it.
    feedback_url = get_url(
        f"/philanthrophy-feedback-form/new"
        f"?app_id={application_id}&applicant_name={Applicants_name}&role={Applicants_Role}"
    )

    interviewer_body = f"""
    <p>Hi {InterviewersName},</p>
    <p>The interview below has been <strong>rescheduled</strong>:</p>
    <div style="border:1px solid #e3e3e3;border-radius:10px;padding:14px;background:#f9fafb;">
    <p><strong>Applicant name:</strong> {Applicants_name}</p>
    <p><strong>Role:</strong> {Applicants_Role}</p>
    <p><strong>New Date:</strong> {interview_date}</p>
    <p><strong>New Time:</strong> {start_time} – {end_time}</p>
    <p><strong>Mode:</strong> {mode_label}</p>
    {meeting_room_html}
    {map_html}
    </div>
    {meeting_html}
    <p><strong>Feedback form:</strong>
    <a href="{feedback_url}" target="_blank">Click here</a></p>
    <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
    {logo_html}
    """

    candidate_body = f"""
    <p>Hi {Applicants_name},</p>
    <p>Your interview has been <strong>rescheduled</strong>:</p>
    <div style="border:1px solid #e3e3e3;border-radius:10px;padding:14px;background:#f9fafb;">
    <p><strong>Role:</strong> {Applicants_Role}</p>
    <p><strong>New Date:</strong> {interview_date}</p>
    <p><strong>New Time:</strong> {start_time} – {end_time}</p>
    <p><strong>Mode:</strong> {mode_label}</p>
    {map_html}
    </div>
    {meeting_html}
    <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
    {logo_html}
    """

    _subline = _theme_geo_subline(doc.get("theme"), doc.get("geo"))

    frappe.sendmail(
        recipients=[interviewee_email],
        sender=Organizer_email,
        subject=f"Interview Rescheduled – Azim Premji Foundation ({interview_date}){_subline}",
        message=candidate_body,
        delayed=False,
    )
    if interviewer_list:
        frappe.sendmail(
            recipients=interviewer_list,
            cc=cc_list or None,
            sender=Organizer_email,
            subject=f"Interview Rescheduled – {Applicants_name} ({interview_date}){_subline}",
            message=interviewer_body,
            delayed=False,
        )

    frappe.msgprint("✅ Interview rescheduled — candidate and interviewer(s) notified.")

    return {"event_id": doc.event_id, "rescheduled": True}


def _attendee_emails_for(doc):
    emails = set()
    for row in (doc.interviewer_email or []):
        if row.interviewer_email:
            emails.add(row.interviewer_email.strip())
    for row in (doc.interviewers_cc_email or []):
        if row.interviewer_email:
            emails.add(row.interviewer_email.strip())
    for email in (doc.room_email or "").split(","):
        email = email.strip()
        if email:
            emails.add(email)
    return emails


def _remove_event_from_attendee_calendars(headers, ical_uid, attendee_emails):
    """Best-effort: actually delete this meeting off each attendee's own
    calendar, instead of leaving Graph's /cancel notice for them to act on.

    Graph's /cancel action properly notifies attendees, but from their side
    that still lands as a "Canceled: ..." entry Outlook leaves in place
    until the attendee manually clicks "Remove event" (or has an Outlook-
    side auto-removal setting enabled) — Outlook's calendar model doesn't
    silently delete things from someone's calendar on the organizer's say-
    so alone. This app authenticates with application-level Graph
    credentials (client-credentials flow — see _graph_headers), the same
    ones already used to create/manage events "as" the organizer's mailbox,
    which under an app-only Calendars.ReadWrite grant reach any mailbox in
    the tenant, not just the organizer's — so it can go remove each
    attendee's own copy directly rather than waiting on them.

    Every attendee's calendar carries a different Graph event id for "the
    same" meeting, but they all share one iCalUId, which is what this
    matches on.
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
                    title="PHILANTHROPY_INTERVIEW_CANCEL_ATTENDEE_LOOKUP_FAILED",
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
                # (403/404/etc.) left the "Canceled: ..." placeholder sitting
                # in the attendee's calendar exactly as if this function had
                # never run at all, with nothing logged to tell the two
                # cases apart.
                if del_res.status_code not in (200, 202, 204, 404):
                    frappe.log_error(
                        title="PHILANTHROPY_INTERVIEW_CANCEL_ATTENDEE_DELETE_FAILED",
                        message=(
                            f"Deleting {attendee_email}'s copy (event {item['id']}) of "
                            f"iCalUId={ical_uid!r} failed | status={del_res.status_code} | "
                            f"body={del_res.text[:500]}"
                        ),
                    )
        except Exception:
            frappe.log_error(
                title="PHILANTHROPY_INTERVIEW_CANCEL_ATTENDEE_CLEANUP",
                message=f"Failed to remove cancelled event from {attendee_email}'s calendar: {frappe.get_traceback()}",
            )


@frappe.whitelist()
def cancel_interview_event(name):
    """
    Cancels an already-scheduled interview: cancels the Outlook event via
    Graph (notifying attendees), then actively deletes it off each
    attendee's own calendar too rather than leaving that to Outlook's
    manual "Remove event" prompt, emails the candidate directly (they were
    never a Graph attendee, only invited by email), and clears event_id so
    the same record can be freely rescheduled later.
    """
    doc = frappe.get_doc("Philanthropy Interview Schedule", name)

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
                title="PHILANTHROPY_INTERVIEW_CANCEL_ICALUID",
                message=frappe.get_traceback(),
            )

        res = requests.post(
            f"{event_url}/cancel",
            headers=headers,
            json={"comment": "This interview has been cancelled."},
        )
        if res.status_code not in (202, 204, 404):
            frappe.log_error(
                title="PHILANTHROPY_INTERVIEW_CANCEL",
                message=f"Graph cancel failed | status={res.status_code} | body={res.text[:800]}",
            )

        _remove_event_from_attendee_calendars(headers, ical_uid, _attendee_emails_for(doc))

    interview_date = formatdate(doc.interview_date, "dd MMMM yyyy") if doc.interview_date else ""
    start_time = format_time(doc.start_time) if doc.start_time else ""
    end_time = format_time(doc.end_time) if doc.end_time else ""
    logo_html = _logo_html()

    if doc.attendees:
        candidate_body = f"""
        <p>Hi {doc.applicants_name or "there"},</p>
        <p>This is to inform you that your interview scheduled on
        <strong>{interview_date}</strong> ({start_time} – {end_time}) has been
        <strong>cancelled</strong>.</p>
        <p>We will reach out separately if the interview needs to be rescheduled.</p>
        <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
        {logo_html}
        """
        frappe.sendmail(
            recipients=[doc.attendees],
            sender=doc.organizer_email,
            subject=f"Interview Cancelled – Azim Premji Foundation ({interview_date}){_theme_geo_subline(doc.get('theme'), doc.get('geo'))}",
            message=candidate_body,
            delayed=False,
        )

    # Interviewers/CC are Graph attendees on this event, and Graph's
    # /events/{id}/cancel action already sends them a native cancellation
    # notice in the same meeting thread — a separate frappe.sendmail here
    # would be a redundant second email for the same cancellation.

    doc.db_set("is_cancelled", 1, update_modified=False)
    doc.db_set("event_id", "", update_modified=False)

    frappe.msgprint("✅ Interview cancelled — candidate and interviewer(s) notified.")

    return {"cancelled": True}


def send_interviewer_feedback_reminders():
    """Runs once daily (see hooks.py scheduler_events["daily"]).

    Starting 1 day after an interview's end time, sends a daily reminder to
    any interviewer who hasn't yet submitted a matching Philanthrophy
    Feedback Form. Stops re-checking a schedule (sets reminder_sent) once
    every interviewer has submitted, or once 7 days have passed since the
    interview ended, whichever comes first.
    """
    now = frappe.utils.now_datetime()

    schedules = frappe.get_all(
        "Philanthropy Interview Schedule",
        filters={"reminder_sent": 0},
        fields=[
            "name",
            "application_id",
            "applicants_name",
            "role",
            "organizer_email",
            "interview_date",
            "end_time",
        ],
    )

    for s in schedules:
        if not (s.interview_date and s.end_time and s.application_id):
            continue

        try:
            end_dt = frappe.utils.get_datetime(f"{s.interview_date} {s.end_time}")
        except Exception:
            continue

        elapsed = now - end_dt
        if elapsed < timedelta(days=1):
            continue

        doc = frappe.get_doc("Philanthropy Interview Schedule", s.name)
        interviewer_emails = [
            row.interviewer_email
            for row in (doc.interviewer_email or [])
            if row.interviewer_email
        ]

        if not interviewer_emails:
            frappe.db.set_value(
                "Philanthropy Interview Schedule", s.name, "reminder_sent", 1
            )
            frappe.db.commit()
            continue

        submitted_emails = {
            (e or "").strip().lower()
            for e in frappe.get_all(
                "Philanthrophy Feedback Form",
                filters={
                    "applicant_id": s.application_id,
                    "email": ["in", interviewer_emails],
                },
                pluck="email",
            )
        }
        pending_emails = [
            e for e in interviewer_emails if e.strip().lower() not in submitted_emails
        ]

        if not pending_emails:
            # everyone has submitted feedback - nothing left to chase
            frappe.db.set_value(
                "Philanthropy Interview Schedule", s.name, "reminder_sent", 1
            )
            frappe.db.commit()
            continue

        if elapsed > timedelta(days=7):
            # gave it a full week of daily reminders - stop nagging
            frappe.db.set_value(
                "Philanthropy Interview Schedule", s.name, "reminder_sent", 1
            )
            frappe.db.commit()
            continue

        feedback_url = get_url(
            f"/philanthrophy-feedback-form/new"
            f"?app_id={s.application_id}&applicant_name={s.applicants_name}&role={s.role or ''}"
        )
        reminder_body = f"""
        <p>Hi,</p>
        <p>This is a reminder that the interview with <b>{s.applicants_name}</b>
        for the role of <b>{s.role or ''}</b> has concluded, and your feedback
        is still pending.</p>
        <p><strong>Feedback form:</strong>
        <a href="{feedback_url}" target="_blank">Click here</a></p>
        <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
        """

        sender_arg = {}
        if s.organizer_email and frappe.db.exists(
            "Email Account", {"email_id": s.organizer_email, "enable_outgoing": 1}
        ):
            sender_arg = {"sender": s.organizer_email}

        for email in pending_emails:
            try:
                frappe.sendmail(
                    recipients=[email],
                    subject=f"Reminder: Interview Feedback Pending – {s.applicants_name}",
                    message=reminder_body,
                    delayed=False,
                    **sender_arg,
                )
            except Exception:
                frappe.log_error(
                    title="Interview Feedback Reminder Error",
                    message=frappe.get_traceback()[:2000],
                )

        # Do NOT mark reminder_sent here - keep re-checking daily until
        # everyone submits or the 7-day window above closes it out.
        frappe.db.commit()


def send_candidate_interview_reminders():
    """Runs once daily (see hooks.py scheduler_events["daily"]).

    Sends each candidate a one-time reminder email roughly a day before
    their scheduled interview. Uses candidate_reminder_sent (a Check field
    on Philanthropy Interview Schedule) so the daily run never re-sends —
    the "daily" scheduler doesn't fire at an exact time, so this checks a
    same-day-ahead window (0 < time to interview <= 24h) rather than trying
    to hit "exactly 24 hours before".
    """
    now = frappe.utils.now_datetime()

    schedules = frappe.get_all(
        "Philanthropy Interview Schedule",
        filters={
            "candidate_reminder_sent": 0,
            "is_cancelled": 0,
            "interview_date": ["is", "set"],
            "start_time": ["is", "set"],
        },
        fields=[
            "name",
            "applicants_name",
            "role",
            "attendees",
            "organizer_email",
            "interview_date",
            "start_time",
            "end_time",
            "interview_type",
            "event_id",
            "google_map_link",
        ],
    )

    for s in schedules:
        if not (s.interview_date and s.start_time and s.attendees):
            continue

        try:
            start_dt = frappe.utils.get_datetime(f"{s.interview_date} {s.start_time}")
        except Exception:
            continue

        time_to_interview = start_dt - now
        if time_to_interview <= timedelta(0) or time_to_interview > timedelta(days=1):
            continue

        # Online interviews: re-fetch the Teams join link fresh off the
        # Graph event (it isn't persisted on the doc, only event_id is).
        # In-person: fall back to the Google Map link, if any.
        join_url = ""
        if s.interview_type and s.event_id and s.organizer_email:
            try:
                headers = _graph_headers()
                event_url = (
                    f"https://graph.microsoft.com/v1.0/users/{s.organizer_email}"
                    f"/events/{s.event_id}"
                )
                ev = requests.get(event_url, headers=headers).json()
                if ev.get("onlineMeeting"):
                    join_url = ev["onlineMeeting"].get("joinUrl", "")
            except Exception:
                pass

        link = join_url or s.google_map_link or ""
        interview_date_fmt = formatdate(s.interview_date, "dd MMMM yyyy")
        interview_time_fmt = format_time(s.start_time)

        link_html = (
            f'<p>Please join using the link below:<br>'
            f'<a href="{link}" target="_blank">{link}</a></p>'
            if link
            else ""
        )

        reminder_body = f"""
        <p>Hi {s.applicants_name or "there"},</p>
        <p>This is a reminder about your interview for the <strong>{s.role or ''}</strong>
        position scheduled on <strong>{interview_date_fmt}</strong> at
        <strong>{interview_time_fmt}</strong>.</p>
        {link_html}
        <p>Looking forward to speaking with you.</p>
        <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
        {_logo_html()}
        """

        try:
            frappe.sendmail(
                recipients=[s.attendees],
                sender=s.organizer_email,
                subject=f"Reminder: Your Interview Tomorrow – Azim Premji Foundation ({interview_date_fmt})",
                message=reminder_body,
                delayed=False,
            )
            frappe.db.set_value(
                "Philanthropy Interview Schedule", s.name, "candidate_reminder_sent", 1
            )
            frappe.db.commit()
        except Exception:
            frappe.log_error(
                title="Candidate Interview Reminder Error",
                message=frappe.get_traceback()[:2000],
            )
