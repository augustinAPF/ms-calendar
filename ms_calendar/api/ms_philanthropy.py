import frappe
import os, ast, base64, time, re, requests
from datetime import datetime, timedelta, timezone
from frappe.utils import get_url, formatdate, format_time, get_datetime
from urllib.parse import quote
from zoneinfo import ZoneInfo

# Field's panel-feedback helpers (one feedback link per invite, personal
# links in reminders, candidate kept off panel emails) — shared with Philanthropy.
from ms_calendar.api.ms_field import (
    _field_panel_feedback_block,
    _field_panelist_names,
    _field_personal_feedback_url,
    _field_without_candidate,
)

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
    """Client-credentials OAuth against MS Graph; shared by create/update/cancel.
    The token is cached until 5 minutes before it expires, so each schedule
    doesn't spend a login round-trip first."""
    cache_key = "ms_calendar:ms_philanthropy_app_token"
    access_token = frappe.cache().get_value(cache_key)
    if not access_token:
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
        data = token.json()
        access_token = data["access_token"]
        frappe.cache().set_value(
            cache_key,
            access_token,
            expires_in_sec=max(int(data.get("expires_in") or 3600) - 300, 60),
        )
    return {
        "Authorization": f"Bearer {access_token}",
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


def _phil_feedback_url(application_id, applicants_name, role):
    """The Philanthrophy Feedback Form web form on this site, applicant and
    role filled in from the link (public/js/feedback_form_draft.js adds the
    Save draft and the "Who is filling this feedback?" picker)."""
    return get_url(
        "/philanthrophy-feedback-form/new"
        f"?app_id={quote(str(application_id or ''), safe='')}"
        f"&applicant_name={quote(str(applicants_name or ''), safe='')}"
        f"&role={quote(str(role or ''), safe='')}"
    )


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
            frappe.get_traceback(),
            "Philanthropy room availability: room list fetch failed",
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
        batch = room_emails[i : i + MAX_BATCH]
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
            final.append(
                {
                    "name": r.get("displayName"),
                    "email": email,
                    "capacity": r.get("capacity"),
                    "availability": [],
                    "is_available": False,
                    "status_unknown": True,
                }
            )
            continue

        busy = schedule_map[key]
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

        # Cross-check against availabilityView even when scheduleItems came
        # back empty/clean — each character covers one availabilityViewInterval
        # (5 min) of the requested window; '0' is free, anything else
        # (tentative/busy/OOF/working-elsewhere) means the room isn't clear
        # for the full slot even though no individual item was visible.
        view = availability_view_map.get(key, "")
        if available and view and any(c != "0" for c in view):
            available = False

        final.append(
            {
                "name": r.get("displayName"),
                "email": email,
                "capacity": r.get("capacity"),
                "availability": busy,
                "is_available": available,
            }
        )

    return {"rooms": final}


def _attach_files_to_event(
    headers, organizer_email, event_id, attachment_paths, extra_paths=None, new_event=False
):
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

    new_event=True skips listing the event's existing attachments (a
    just-created event has none). Files are uploaded in parallel.
    """
    from concurrent.futures import ThreadPoolExecutor

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

    if not attachment_files:
        return

    attach_url = f"https://graph.microsoft.com/v1.0/users/{organizer_email}/events/{event_id}/attachments"

    # Graph's attachments endpoint has no dedupe of its own — POSTing the
    # same file twice just adds a second copy. update_interview_event now
    # runs this on every Modify/reschedule (see its own comment on why), so
    # an unchanged CV that's still in attachment_paths from a previous save
    # would otherwise pile up one more copy each time. Skip anything whose
    # name already matches an attachment already sitting on the event.
    existing_names = set()
    if not new_event:
        try:
            existing = requests.get(
                attach_url, headers=headers, params={"$select": "name"}, timeout=30
            )
            if existing.status_code == 200:
                existing_names = {a.get("name") for a in existing.json().get("value", [])}
        except Exception:
            frappe.log_error(
                title="PHILANTHROPY_INTERVIEW_ATTACH_LIST_ERROR",
                message=f"Could not list existing attachments on event {event_id}: {frappe.get_traceback()}",
            )

    def upload(item):
        # Runs in a worker thread — no frappe calls here; errors are logged
        # back on the main thread below.
        fname, fb64 = item
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
                return fname, f"status={res.status_code} | body={res.text[:800]}"
        except Exception as e:
            return fname, repr(e)
        return fname, None

    pending = [item for item in attachment_files if item[0] not in existing_names]
    if not pending:
        return
    with ThreadPoolExecutor(max_workers=min(4, len(pending))) as pool:
        results = list(pool.map(upload, pending))
    # A failure here (bad permissions, a >3MB attachment tripping Graph's
    # simple-attachment size limit, a transient error) raises nothing — it
    # is only logged, so the invite itself still goes out.
    for fname, error in results:
        if error:
            frappe.log_error(
                title="PHILANTHROPY_INTERVIEW_ATTACH_FAILED",
                message=f"Attaching {fname!r} to event {event_id} failed | {error}",
            )


def _resolve_interview_mode(interview_mode, is_online):
    """Interview Mode (Online / Offline / Hybrid) decides the meeting type of
    the event (interviewers + CC + room + candidate email):

    Online  -> Teams meeting, no venue in the emails
    Offline -> in-person, venue + Google Map link, no Teams meeting
    Hybrid  -> ONE event that is in-person (venue + Google Map link) AND
               carries the Teams meeting: the main interviewers attend in
               person, the Hybrid Interview Email group are attendees of
               the same event and join online with its Teams link

    Records created before Interview Mode existed have it blank — those
    fall back to the old "Is this a virtual call ?" checkbox (is_online).

    Returns (is_online, show_venue, mode_label).
    """
    try:
        is_online = int(is_online)
    except Exception:
        is_online = 0

    mode = (interview_mode or "").strip().lower()
    if mode == "online":
        return 1, False, "Teams Meeting"
    if mode == "offline":
        return 0, True, "In-Person"
    if mode == "hybrid":
        return 1, True, "In-Person"
    return (
        is_online,
        is_online == 0,
        ("Teams Meeting" if is_online == 1 else "In-Person"),
    )


def _is_hybrid(interview_mode):
    return (interview_mode or "").strip().lower() == "hybrid"


def _resolve_location(google_map, Location_adress, Map_location):
    """The venue the recruiter picks goes into the "Google Map" field. On
    ms.local it's a plain Data field (a Link to "Google Map Link" on the
    cloud) — its fetch into Location Address / Google Map Link never fires
    there, so those stay empty and the email showed no location.
    Fill them from Google Map here: a "Google Map Link" master record gives
    its address + map link, a URL is used as the map link, anything else
    (e.g. a typed place name) is used as the venue text.

    Returns (Location_adress, Map_location).
    """
    gm = (google_map or "").strip()
    if not gm or (Location_adress and Map_location):
        return Location_adress, Map_location

    rec = frappe.db.get_value(
        "Google Map Link", gm, ["location_address", "location_map_link"], as_dict=True
    )
    if rec:
        return (
            Location_adress or (rec.location_address or "").strip() or gm,
            Map_location or (rec.location_map_link or "").strip(),
        )
    if gm.lower().startswith(("http://", "https://")):
        return Location_adress, Map_location or gm
    return Location_adress or gm, Map_location


def _resolve_venue(name, google_map, Location_adress, Map_location):
    """(location, address, map_location) for the invite and the Outlook
    "Location" line. `google_map` normally comes from the form; when it
    didn't, it's read off the saved record. Address / map link fall back to
    the "Google Map Link" record (see _resolve_location), else the typed
    location text."""
    gm = (google_map or "").strip()
    if not gm and name:
        gm = (
            frappe.db.get_value("Philanthropy Interview Schedule", name, "google_map") or ""
        ).strip()
    address, map_location = _resolve_location(
        gm, (Location_adress or "").strip(), (Map_location or "").strip()
    )
    location = "" if gm.lower().startswith(("http://", "https://")) else gm
    return location, (address or "").strip(), (map_location or "").strip()


def _event_location(show_venue, location, address, meeting_room):
    """Outlook "Location" line: "<venue> - <one-line address>" for Offline /
    Hybrid, "Microsoft Teams Meeting" for Online. Falls back to the booked
    room's name when no venue was picked at all."""
    from ms_calendar.api.msgraph import _interview_schedule_event_location

    event_location = _interview_schedule_event_location(show_venue, location, address)
    if not event_location and meeting_room:
        event_location = {"displayName": meeting_room}
    return event_location


def _venue_html(address, map_location):
    """Venue text + Google Map Link lines. The map-link line used to render
    unconditionally whenever the interview was in-person, regardless of
    whether Map_location actually had a value — an empty/unset
    google_map_link still produced <a href=""> ("Click here" that goes
    nowhere, reads as "not clickable"). Venue text is shown on its own
    either way; the link line only appears when there's a real URL to link
    to. Multi-line addresses keep their line breaks."""
    html = ""
    if address:
        address_html = "<br>".join(
            line.strip() for line in address.splitlines() if line.strip()
        )
        html += f'<p style="margin:6px 0;"><strong>Venue:</strong> {address_html}</p>'
    if map_location:
        html += (
            f'<p style="margin:6px 0;"><strong>Google Map Link:</strong> '
            f'<a href="{map_location}" target="_blank">Click here</a></p>'
        )
    return html


def _hybrid_interviewer_list(
    interview_mode, hybrid_interviewer_emails, interviewer_list
):
    # The Hybrid Interview Email group — empty unless the mode is Hybrid.
    # Anyone already in the main (in-person) interviewer list is skipped so
    # nobody is on the invite twice.
    if (interview_mode or "").strip().lower() != "hybrid":
        return []
    hybrid_list = [
        h.strip() for h in (hybrid_interviewer_emails or "").split(",") if h.strip()
    ]
    return [h for h in dict.fromkeys(hybrid_list) if h not in interviewer_list]


def _teams_from_event(event_json):
    """(join_web_url, meeting_id, passcode) read straight off an event
    payload. Graph returns its Teams footer (Join / "Meeting ID:\\r\\n
    </span><span>…" / Passcode) in the body of the POST that creates an
    online event, and after that our own invite body carries them — so
    usually no extra request is needed. ms_field's extractor handles both
    body formats (the old local regexes missed ours)."""
    from ms_calendar.api.ms_field import _extract_teams_ids_from_html

    body = ((event_json or {}).get("body") or {}).get("content", "") or ""
    join_web_url = ((event_json or {}).get("onlineMeeting") or {}).get("joinUrl", "") or ""
    if not join_web_url:
        m = re.search(r"""<a href=["'](https://teams\.microsoft\.com[^"']+)["']""", body)
        join_web_url = m.group(1) if m else ""
    meeting_id, passcode = _extract_teams_ids_from_html(body)
    return join_web_url, meeting_id, passcode


def _fetch_teams_join_details(
    headers, organizer_email, event_url, event_json=None, poll=True
):
    """Join link, meeting ID and passcode of an event's Teams meeting.
    Read from `event_json` (the event Graph just returned) when it has them;
    otherwise — when poll — the same resolver as Field interviews
    (ms_field._fetch_teams_meeting_info): it polls until Exchange has written
    its "Meeting ID / Passcode" footer, which lands a few seconds AFTER the
    join link, then tries the onlineMeetings lookup by the organizer's object
    id. The old loop here gave up ~4 s after the join link appeared and its
    lookup used the organizer's email (that API only takes the GUID), so
    invites — Hybrid ones especially — often went out with a Join link but no
    Meeting ID / Passcode. poll=False (an existing event whose body no longer
    has them) only reads `event_json`.
    Returns (join_web_url, join_meeting_id, join_passcode).
    """
    join_web_url, join_meeting_id, join_passcode = _teams_from_event(event_json)

    if poll and not (join_web_url and join_meeting_id and join_passcode):
        from ms_calendar.api.ms_field import _fetch_teams_meeting_info

        event_id = event_url.rstrip("/").rsplit("/", 1)[-1]
        j, m, p = _fetch_teams_meeting_info(organizer_email, event_id, headers, True)
        join_web_url = join_web_url or j
        join_meeting_id = join_meeting_id or m
        join_passcode = join_passcode or p

    return join_web_url, join_meeting_id, join_passcode


def _teams_meeting_html(join_web_url, join_meeting_id, join_passcode):
    if not join_web_url:
        return ""
    html = f"""
        <p><b>Join Teams Meeting:</b>
        <a href="{join_web_url}" target="_blank">Join Now</a></p>
        """
    ids = []
    if join_meeting_id:
        ids.append(f"<b>Meeting ID:</b> {join_meeting_id}")
    if join_passcode:
        ids.append(f"<b>Passcode:</b> {join_passcode}")
    if ids:
        html += f"<p>{'<br>'.join(ids)}</p>"
    return html


def _cancel_graph_event(
    headers, organizer_email, event_id, comment="This interview has been cancelled."
):
    """Cancels one Outlook event (notifies its attendees) and removes it off
    each attendee's own calendar. Attendees are read off the event itself.
    Only used now for the separate Hybrid online event (hybrid_event_id)
    that records scheduled before Hybrid became one invite still have."""
    event_url = (
        f"https://graph.microsoft.com/v1.0/users/{organizer_email}/events/{event_id}"
    )

    ical_uid = None
    attendee_emails = set()
    try:
        ev = requests.get(
            event_url, headers=headers, params={"$select": "iCalUId,attendees"}
        )
        if ev.status_code == 200:
            data = ev.json()
            ical_uid = data.get("iCalUId")
            for a in data.get("attendees", []):
                address = (a.get("emailAddress") or {}).get("address")
                if address:
                    attendee_emails.add(address.strip())
    except Exception:
        frappe.log_error(
            title="PHILANTHROPY_INTERVIEW_CANCEL_ICALUID",
            message=frappe.get_traceback(),
        )

    res = requests.post(
        f"{event_url}/cancel",
        headers=headers,
        json={"comment": comment},
    )
    if res.status_code not in (202, 204, 404):
        frappe.log_error(
            title="PHILANTHROPY_INTERVIEW_CANCEL",
            message=f"Graph cancel failed | status={res.status_code} | body={res.text[:800]}",
        )

    _remove_event_from_attendee_calendars(headers, ical_uid, attendee_emails)


def _save_hybrid_event_id(name, hybrid_event_id):
    if name and frappe.get_meta("Philanthropy Interview Schedule").has_field(
        "hybrid_event_id"
    ):
        frappe.db.set_value(
            "Philanthropy Interview Schedule",
            name,
            "hybrid_event_id",
            hybrid_event_id or "",
            update_modified=False,
        )


def _interviewer_mode_blocks(
    hybrid,
    mode_label,
    meeting_room_html,
    venue_html,
    show_venue,
    meeting_html,
    join_web_url,
    InterviewersName,
    online_names,
):
    """(greeting names, html inside the details box, html after it) for the
    interviewer invite. Hybrid: one invite for both panels — the details box
    keeps applicant/date/time/room, then "Mode: Hybrid Interview" with an
    Offline Panel box (names + venue + map link) and an Online Panel box
    (names + Join link + Meeting ID + Passcode)."""
    if hybrid:
        from ms_calendar.api.msgraph import _interview_schedule_hybrid_panel_html

        return (
            ", ".join(n for n in (InterviewersName, online_names) if n),
            meeting_room_html,
            _interview_schedule_hybrid_panel_html(
                InterviewersName, online_names, join_web_url, meeting_html, venue_html
            ),
        )
    return (
        InterviewersName,
        f"<p><strong>Mode:</strong> {mode_label}</p>\n    {meeting_room_html}\n    "
        f"{venue_html if show_venue else ''}",
        meeting_html,
    )


def _candidate_panel_html(hybrid, InterviewersName, online_names):
    # Hybrid only — Online / Offline candidate emails never listed the panel.
    if not hybrid:
        return ""
    from ms_calendar.api.msgraph import _interview_schedule_candidate_panel_html

    return _interview_schedule_candidate_panel_html(True, InterviewersName, online_names)


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
    interview_mode=None,
    hybrid_interviewer_emails=None,
    HybridInterviewersName=None,
    google_map=None,
):

    is_online, show_venue, mode_label = _resolve_interview_mode(
        interview_mode, is_online
    )
    hybrid = _is_hybrid(interview_mode)

    Organizer_email = Organizer_email.strip()
    Applicants_Role = Applicants_Role or ""
    Comments_for_interviewer = Comments_for_interviewer or ""
    location, Location_adress, Map_location = _resolve_venue(
        name, google_map, Location_adress, Map_location
    )

    start_dt = datetime.fromisoformat(start_datetime)
    end_dt = datetime.fromisoformat(end_datetime)

    interview_date = start_dt.strftime("%d %B %Y")
    start_time = start_dt.strftime("%I:%M %p")
    end_time = end_dt.strftime("%I:%M %p")

    headers = _graph_headers()
    meeting_room = _resolve_meeting_room(room_emails, headers)
    event_location = _event_location(show_venue, location, Location_adress, meeting_room)

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

    interviewer_list = [
        i.strip() for i in (interviewer_emails or "").split(",") if i.strip()
    ]
    # Hybrid: the online panel is invited on this same event.
    hybrid_list = _hybrid_interviewer_list(
        interview_mode, hybrid_interviewer_emails, interviewer_list
    )
    # The panel invite carries the feedback link — never the candidate, even
    # if their address was also typed into a panel/CC list.
    interviewer_list = _field_without_candidate(interviewer_list, interviewee_email)
    hybrid_list = _field_without_candidate(hybrid_list, interviewee_email)
    cc_emails = ",".join(_field_without_candidate((cc_emails or "").split(","), interviewee_email))
    online_names = (
        (HybridInterviewersName or ", ".join(hybrid_list)) if hybrid_list else ""
    )
    cc_list = [
        i.strip()
        for i in (cc_emails or "").split(",")
        if i.strip() and i.strip() not in hybrid_list
    ]
    room_list = [r.strip() for r in (room_emails or "").split(",") if r.strip()]
    # Rooms must be added as "resource" attendees, not just written into the
    # location text — otherwise Graph never sends the room a booking request
    # and its own calendar never shows the slot as busy (the "Block Rooms"
    # picker only stores the room's email/name locally; this is what
    # actually reserves it).
    attendees = (
        [{"emailAddress": {"address": i}, "type": "required"} for i in interviewer_list]
        + [{"emailAddress": {"address": h}, "type": "required"} for h in hybrid_list]
        + [{"emailAddress": {"address": i}, "type": "optional"} for i in cc_list]
        + [{"emailAddress": {"address": r}, "type": "resource"} for r in room_list]
    )

    # -------- CREATE EVENT --------
    create_url = f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events"

    draft_payload = {
        "subject": f"Discussion with {Applicants_name} - ({Applicants_Role}){_subline}",
        "isOnlineMeeting": True if is_online == 1 else False,
        "onlineMeetingProvider": "teamsForBusiness" if is_online == 1 else None,
        "showAs": "busy",
        "start": {"dateTime": start_datetime, "timeZone": "Asia/Kolkata"},
        "end": {"dateTime": end_datetime, "timeZone": "Asia/Kolkata"},
        "body": {"contentType": "HTML", "content": "<p>Interview scheduled.</p>"},
    }
    # Venue for Offline / Hybrid, "Microsoft Teams Meeting" for Online.
    if event_location:
        draft_payload["location"] = event_location

    res = requests.post(create_url, headers=headers, json=draft_payload)
    res.raise_for_status()
    event = res.json()
    event_id = event["id"]

    event_url = (
        f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events/{event_id}"
    )

    # -------- ATTACH FILES --------
    # Always include the candidate's Application PDF (Phil Registration Form)
    # so interviewers have it on hand for the interview — this only ever
    # reaches the Graph event's attachments below (i.e. the interviewer/room
    # calendar invite), never the candidate's own frappe.sendmail further
    # down, so the candidate is never sent their own PDF back.
    extra_paths = [application_pdf_url] if application_pdf_url else []
    _attach_files_to_event(
        headers, Organizer_email, event_id, attachment_paths, extra_paths, new_event=True
    )

    # -------- MEETING DETAILS --------
    # Only relevant for Teams meetings. Join link + Meeting ID + Passcode
    # come back in the create response's body; the poll only runs if Graph
    # hadn't attached the Teams meeting yet.
    join_web_url = ""
    join_meeting_id = ""
    join_passcode = ""

    if is_online == 1:
        join_web_url, join_meeting_id, join_passcode = _fetch_teams_join_details(
            headers, Organizer_email, event_url, event_json=event
        )

    meeting_html = (
        _teams_meeting_html(join_web_url, join_meeting_id, join_passcode)
        if is_online == 1
        else ""
    )

    logo_html = _logo_html()

    # ---- EMAIL BODY PARTS ----
    feedback_html = _field_panel_feedback_block(
        _phil_feedback_url(application_id, Applicants_name, Applicants_Role),
        interviewer_list + hybrid_list,
    )

    meeting_room_html = (
        f'<p style="margin:6px 0;"><strong>Meeting room:</strong> {meeting_room}</p>'
        if meeting_room
        else ""
    )

    venue_html = _venue_html(Location_adress, Map_location)
    map_html = venue_html if show_venue else ""

    note_html = (
        f"<p><strong>For your information:</strong> {Comments_for_interviewer}</p>"
        if Comments_for_interviewer
        else ""
    )

    # One invite for the whole panel. Hybrid lists the Offline Panel (venue)
    # and the Online Panel (Teams link) together.
    dear_names, details_mode_html, after_details_html = _interviewer_mode_blocks(
        hybrid,
        mode_label,
        meeting_room_html,
        venue_html,
        show_venue,
        meeting_html,
        join_web_url,
        InterviewersName,
        online_names,
    )

    interviewer_body = f"""
    <p>Hi {dear_names},</p>
    <p>Kindly find the details of the interview scheduled:</p>
    <div style="border:1px solid #e3e3e3;border-radius:10px;padding:14px;background:#f9fafb;">
    <p><strong>Applicant name:</strong> {Applicants_name}</p>
    <p><strong>Role:</strong> {Applicants_Role}</p>
    <p><strong>Date:</strong> {interview_date}</p>
    <p><strong>Time:</strong> {start_time} – {end_time}</p>
    {details_mode_html}
    </div>
    {after_details_html}
    {feedback_html}
    {note_html}
    <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
    {logo_html}
    """

    # Hybrid: the candidate attends in person — venue only, no Teams link
    # (the Teams call is for the online panel to join).
    candidate_meeting_html = "" if hybrid else meeting_html

    candidate_body = f"""
    <p>Hi {Applicants_name},</p>
    <p>Kindly find the details of the interview scheduled:</p>
    <div style="border:1px solid #e3e3e3;border-radius:10px;padding:14px;background:#f9fafb;">
    <p><strong>Role:</strong> {Applicants_Role}</p>
    <p><strong>Date:</strong> {interview_date}</p>
    <p><strong>Time:</strong> {start_time} – {end_time}</p>
    <p><strong>Mode:</strong> {mode_label}</p>
    {map_html}
    {_candidate_panel_html(hybrid, InterviewersName, online_names)}
    </div>
    {candidate_meeting_html}
    <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
    {logo_html}
    """

    # Attendees + body in one PATCH — this is what sends the Outlook invite.
    requests.patch(
        event_url,
        headers=headers,
        json={
            "attendees": attendees,
            "body": {"contentType": "HTML", "content": interviewer_body},
            "showAs": "busy",
        },
    )

    # Sent from a background worker so scheduling doesn't wait on the SMTP
    # round-trip (same as ms_health.py).
    frappe.enqueue(
        "frappe.sendmail",
        queue="short",
        enqueue_after_commit=True,
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
    # (No success msgprint — the form's loader card shows the confirmation.)

    if name:
        frappe.db.set_value(
            "Philanthropy Interview Schedule",
            name,
            {"event_id": event_id, "is_cancelled": 0},
            update_modified=False,
        )
        # Hybrid is one event now — no separate online event to remember.
        _save_hybrid_event_id(name, "")

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
    interview_mode=None,
    hybrid_interviewer_emails=None,
    HybridInterviewersName=None,
    google_map=None,
):
    """
    Reschedules an already-created interview: PATCHes the existing Outlook
    event's time/room/attendees/body instead of creating a duplicate,
    attaches any files passed in (CV, feedback PDF, assignment — same as at
    create time; PATCHing time/attendees never touches existing attachments,
    and this function previously had no attachment_paths parameter at all,
    so frappe.call() silently dropped whatever the JS side sent), then
    emails the candidate and interviewers about the change.
    In Hybrid mode both panels are on this one event; an older record's
    separate online event (hybrid_event_id) is cancelled.
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

    is_online, show_venue, mode_label = _resolve_interview_mode(
        interview_mode, is_online
    )
    hybrid = _is_hybrid(interview_mode)

    Organizer_email = Organizer_email.strip()
    Applicants_Role = Applicants_Role or ""
    location, Location_adress, Map_location = _resolve_venue(
        name, google_map, Location_adress, Map_location
    )

    start_dt = datetime.fromisoformat(start_datetime)
    end_dt = datetime.fromisoformat(end_datetime)
    interview_date = start_dt.strftime("%d %B %Y")
    start_time = start_dt.strftime("%I:%M %p")
    end_time = end_dt.strftime("%I:%M %p")

    headers = _graph_headers()
    meeting_room = _resolve_meeting_room(room_emails, headers)
    event_location = _event_location(show_venue, location, Location_adress, meeting_room)

    event_url = f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events/{doc.event_id}"

    interviewer_list = [
        i.strip() for i in (interviewer_emails or "").split(",") if i.strip()
    ]
    # Hybrid: the online panel is invited on this same event.
    hybrid_list = _hybrid_interviewer_list(
        interview_mode, hybrid_interviewer_emails, interviewer_list
    )
    # The panel invite carries the feedback link — never the candidate, even
    # if their address was also typed into a panel/CC list.
    interviewer_list = _field_without_candidate(interviewer_list, interviewee_email)
    hybrid_list = _field_without_candidate(hybrid_list, interviewee_email)
    cc_emails = ",".join(_field_without_candidate((cc_emails or "").split(","), interviewee_email))
    online_names = (
        (HybridInterviewersName or ", ".join(hybrid_list)) if hybrid_list else ""
    )
    # Separate online event from before Hybrid was merged into one invite.
    hybrid_event_id = doc.get("hybrid_event_id") or ""
    cc_list = [
        i.strip()
        for i in (cc_emails or "").split(",")
        if i.strip() and i.strip() not in hybrid_list
    ]
    room_list = [r.strip() for r in (room_emails or "").split(",") if r.strip()]
    attendees = (
        [{"emailAddress": {"address": i}, "type": "required"} for i in interviewer_list]
        + [{"emailAddress": {"address": h}, "type": "required"} for h in hybrid_list]
        + [{"emailAddress": {"address": i}, "type": "optional"} for i in cc_list]
        + [{"emailAddress": {"address": r}, "type": "resource"} for r in room_list]
    )

    res = requests.get(
        event_url,
        headers=headers,
        params={"$select": "id,isOnlineMeeting,onlineMeeting,body"},
    )
    if res.status_code == 404:
        # The Outlook event this record's event_id points at is gone —
        # most likely someone deleted it directly in Outlook rather than
        # through this app. Rather than crash the whole reschedule, recover
        # by creating a fresh event in its place. create_interview_event()
        # already knows how to update this record's event_id once the new
        # event exists (it accepts the same `name` this function was called
        # with), so delegate to it instead of duplicating that logic.
        frappe.log_error(
            title="PHILANTHROPY_INTERVIEW_RESCHEDULE_STALE_EVENT",
            message=(
                f"Reschedule target Outlook event {doc.event_id} for {name} "
                f"returned 404 (likely deleted directly in Outlook) — "
                f"recreating a fresh event instead of failing the reschedule."
            ),
        )
        # The fresh event invites the online panel too — cancel an older
        # record's separate online event first so they aren't double-booked.
        if hybrid_event_id:
            _cancel_graph_event(
                headers, Organizer_email, hybrid_event_id, "This interview has been rescheduled."
            )
            _save_hybrid_event_id(name, "")
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
            interview_mode=interview_mode,
            hybrid_interviewer_emails=hybrid_interviewer_emails,
            HybridInterviewersName=HybridInterviewersName,
            google_map=google_map,
        )
    res.raise_for_status()

    # Attach BEFORE the notifying PATCH below, not after — PATCHing
    # start/end/attendees is what makes Exchange fire its own "meeting
    # updated" notification to everyone on the invite, and that notification
    # reflects whatever's on the event AT THAT MOMENT. Attaching afterwards
    # (as this used to) meant the notification always went out before the
    # new file existed on the event — the reason a freshly-attached CV
    # never showed up after using "Modify The Schedule": it geniunely was
    # being attached, just one step too late for anyone to see it in what
    # they'd already been notified about. A failed attach here is harmless
    # — it only logs.
    _attach_files_to_event(headers, Organizer_email, doc.event_id, attachment_paths)

    # Interview Mode can be changed via "Modify The Schedule" (e.g. Offline
    # -> Online / Hybrid) — the original event then has no Teams meeting
    # yet, so add one first; its link goes into the body below.
    current_event = res.json()
    added_teams = False
    if is_online == 1 and not current_event.get("isOnlineMeeting"):
        teams_res = requests.patch(
            event_url,
            headers=headers,
            json={"isOnlineMeeting": True, "onlineMeetingProvider": "teamsForBusiness"},
        )
        teams_res.raise_for_status()
        current_event = teams_res.json()
        added_teams = True

    # The existing invite body (ours) already carries the Join link /
    # Meeting ID / Passcode — online meetings keep the same Teams link
    # across a reschedule. Only poll when the Teams meeting was just added;
    # for an older event without them in its body, polling can't help.
    join_web_url = join_meeting_id = join_passcode = ""
    if is_online == 1:
        join_web_url, join_meeting_id, join_passcode = _fetch_teams_join_details(
            headers, Organizer_email, event_url, event_json=current_event, poll=added_teams
        )

    meeting_html = (
        _teams_meeting_html(join_web_url, join_meeting_id, join_passcode)
        if is_online == 1
        else ""
    )

    logo_html = _logo_html()

    venue_html = _venue_html(Location_adress, Map_location)
    map_html = venue_html if show_venue else ""
    meeting_room_html = (
        f"<p><strong>Meeting room:</strong> {meeting_room}</p>" if meeting_room else ""
    )

    # Same feedback-form link create_interview_event sends the interviewer —
    # a reschedule without it left anyone whose interview got rescheduled
    # (common) with no working feedback link until the next-day reminder
    # job (send_interviewer_feedback_reminders) eventually caught it.
    feedback_html = _field_panel_feedback_block(
        _phil_feedback_url(application_id, Applicants_name, Applicants_Role),
        interviewer_list + hybrid_list,
    )

    # One invite for the whole panel — see create_interview_event.
    dear_names, details_mode_html, after_details_html = _interviewer_mode_blocks(
        hybrid,
        mode_label,
        meeting_room_html,
        venue_html,
        show_venue,
        meeting_html,
        join_web_url,
        InterviewersName,
        online_names,
    )

    interviewer_body = f"""
    <p>Hi {dear_names},</p>
    <p>The interview below has been <strong>rescheduled</strong>:</p>
    <div style="border:1px solid #e3e3e3;border-radius:10px;padding:14px;background:#f9fafb;">
    <p><strong>Applicant name:</strong> {Applicants_name}</p>
    <p><strong>Role:</strong> {Applicants_Role}</p>
    <p><strong>New Date:</strong> {interview_date}</p>
    <p><strong>New Time:</strong> {start_time} – {end_time}</p>
    {details_mode_html}
    </div>
    {after_details_html}
    {feedback_html}
    <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
    {logo_html}
    """

    # Hybrid: the candidate attends in person — venue only, no Teams link.
    candidate_meeting_html = "" if hybrid else meeting_html

    candidate_body = f"""
    <p>Hi {Applicants_name},</p>
    <p>Your interview has been <strong>rescheduled</strong>:</p>
    <div style="border:1px solid #e3e3e3;border-radius:10px;padding:14px;background:#f9fafb;">
    <p><strong>Role:</strong> {Applicants_Role}</p>
    <p><strong>New Date:</strong> {interview_date}</p>
    <p><strong>New Time:</strong> {start_time} – {end_time}</p>
    <p><strong>Mode:</strong> {mode_label}</p>
    {map_html}
    {_candidate_panel_html(hybrid, InterviewersName, online_names)}
    </div>
    {candidate_meeting_html}
    <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
    {logo_html}
    """

    # Single notifying PATCH: new time, full panel (incl. the Hybrid online
    # group), venue and the merged body.
    patch_payload = {
        "start": {"dateTime": start_datetime, "timeZone": "Asia/Kolkata"},
        "end": {"dateTime": end_datetime, "timeZone": "Asia/Kolkata"},
        "attendees": attendees,
        "body": {"contentType": "HTML", "content": interviewer_body},
        "showAs": "busy",
    }
    if event_location:
        patch_payload["location"] = event_location
    requests.patch(event_url, headers=headers, json=patch_payload).raise_for_status()

    # Older Hybrid records had the online panel on a separate event — they
    # are on this event now, so that one comes off their calendars.
    if hybrid_event_id:
        _cancel_graph_event(
            headers, Organizer_email, hybrid_event_id, "This interview has been rescheduled."
        )
        _save_hybrid_event_id(name, "")

    _subline = _theme_geo_subline(doc.get("theme"), doc.get("geo"))

    # Sent from a background worker so rescheduling doesn't wait on the SMTP
    # round-trips.
    frappe.enqueue(
        "frappe.sendmail",
        queue="short",
        enqueue_after_commit=True,
        recipients=[interviewee_email],
        sender=Organizer_email,
        subject=f"Interview Rescheduled – Azim Premji Foundation ({interview_date}){_subline}",
        message=candidate_body,
        delayed=False,
    )
    if interviewer_list or hybrid_list:
        frappe.enqueue(
            "frappe.sendmail",
            queue="short",
            enqueue_after_commit=True,
            recipients=interviewer_list + hybrid_list,
            cc=cc_list or None,
            sender=Organizer_email,
            subject=f"Interview Rescheduled – {Applicants_name} ({interview_date}){_subline}",
            message=interviewer_body,
            delayed=False,
        )

    # No success msgprint — the form's loader card shows the confirmation.
    return {"event_id": doc.event_id, "rescheduled": True}


def _attendee_emails_for(doc):
    emails = set()
    for row in doc.interviewer_email or []:
        if row.interviewer_email:
            emails.add(row.interviewer_email.strip())
    for row in doc.interviewers_cc_email or []:
        if row.interviewer_email:
            emails.add(row.interviewer_email.strip())
    # Hybrid's online panel is on this same event too.
    if _is_hybrid(doc.get("interview_mode")):
        for row in doc.get("hybrid_interview_email") or []:
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


def _remove_cancelled_event_in_background(ical_uid, attendee_emails):
    """Background half of cancel_interview_event — see its comment."""
    _remove_event_from_attendee_calendars(_graph_headers(), ical_uid, attendee_emails)


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

        # Per-attendee calendar cleanup is 2 Graph calls PER attendee — the
        # /cancel above has already notified everyone, so this tidying-up
        # runs in the background instead of holding the Cancel button.
        if ical_uid:
            frappe.enqueue(
                "ms_calendar.api.ms_philanthropy._remove_cancelled_event_in_background",
                queue="short",
                ical_uid=ical_uid,
                attendee_emails=list(_attendee_emails_for(doc)),
                enqueue_after_commit=True,
            )

        # Older Hybrid records: the online group is on its own separate event.
        if doc.get("hybrid_event_id"):
            _cancel_graph_event(headers, doc.organizer_email, doc.hybrid_event_id)
            _save_hybrid_event_id(doc.name, "")

    interview_date = (
        formatdate(doc.interview_date, "dd MMMM yyyy") if doc.interview_date else ""
    )
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
        frappe.enqueue(
            "frappe.sendmail",
            queue="short",
            enqueue_after_commit=True,
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


_FEEDBACK_REMINDER_FIELDS = [
    "name",
    "application_id",
    "applicants_name",
    "role",
    "organizer_email",
    "interview_date",
    "end_time",
]

# Only interviews that were actually sent out (event_id set) and not
# cancelled - a cancelled interview has nothing to give feedback on.
_FEEDBACK_REMINDER_FILTERS = {
    "reminder_sent": 0,
    "is_cancelled": 0,
    "event_id": ["is", "set"],
}


def _pending_feedback_interviewers(schedule_name, application_id):
    """Interviewers on the schedule (main group plus, in Hybrid mode, the
    Hybrid Interview Email group) who haven't submitted a Philanthrophy
    Feedback Form for this applicant yet. Returns (all_emails, pending)."""
    doc = frappe.get_doc("Philanthropy Interview Schedule", schedule_name)
    # Panel only — never the candidate (attendees).
    interviewer_emails = _field_without_candidate(
        _schedule_interviewer_emails(doc), doc.get("attendees")
    )
    if not interviewer_emails:
        return [], []

    names = _field_panelist_names(interviewer_emails)
    submitted_emails = set()
    for fb in frappe.get_all(
        "Philanthrophy Feedback Form",
        # This interview's feedback only, not an earlier round's.
        filters={"applicant_id": application_id, "creation": [">=", doc.creation]},
        fields=["email", "owner", "interviewer_name"],
    ):
        submitted_emails |= _feedback_panel_emails(fb, interviewer_emails, names)
    pending = [e for e in interviewer_emails if e not in submitted_emails]
    return interviewer_emails, pending


def _feedback_panel_emails(fb, panel_emails, names):
    """Which panel members a Philanthrophy Feedback Form was submitted for.
    The web form's "email" field is hidden on the live site and always holds
    the default grants.recruitment@ address, so it rarely says who
    submitted. Tried in order: a real panel email in "email", the logged-in
    owner, then the name(s) in interviewer_name — the form's "Who is filling
    this feedback?" picker fills the exact Interviewer Email List name, and
    Consolidated fills every member's name, comma-separated."""
    email = (fb.get("email") or "").strip().lower()
    if email in panel_emails:
        return {email}
    owner = (fb.get("owner") or "").strip().lower()
    if owner in panel_emails:
        return {owner}
    typed = {
        n.strip().lower()
        for n in re.split(r"[,;&/]|\band\b", fb.get("interviewer_name") or "")
        if n.strip()
    }
    return {e for e in panel_emails if (names.get(e) or "").strip().lower() in typed}


def _send_feedback_reminder(s, pending_emails, error_title):
    feedback_url = _phil_feedback_url(s.application_id, s.applicants_name, s.role)
    reminder_body = f"""
    <p>Hi,</p>
    <p>This is a reminder that the interview with <b>{s.applicants_name}</b>
    for the role of <b>{s.role or ''}</b> has concluded, and your feedback
    is still pending.</p>
    <p><strong>Feedback form:</strong>
    <a href="{feedback_url}" target="_blank">Click here</a></p>
    <p>You can click <b>Save</b> on the form to keep a draft and finish it
    later; your feedback is recorded only when you click <b>Submit</b>.</p>
    <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
    """

    sender_arg = {}
    if s.organizer_email and frappe.db.exists(
        "Email Account", {"email_id": s.organizer_email, "enable_outgoing": 1}
    ):
        sender_arg = {"sender": s.organizer_email}

    names = _field_panelist_names(pending_emails)
    for email in pending_emails:
        # Each interviewer's own link — the form opens with their name filled
        # in and their saved draft loaded.
        body = reminder_body.replace(
            feedback_url, _field_personal_feedback_url(feedback_url, email, names.get(email, ""))
        )
        try:
            frappe.sendmail(
                recipients=[email],
                subject=f"Reminder: Interview Feedback Pending – {s.applicants_name}",
                message=body,
                delayed=False,
                reference_doctype="Philanthropy Interview Schedule",
                reference_name=s.name,
                **sender_arg,
            )
        except Exception:
            frappe.log_error(
                title=error_title,
                message=frappe.get_traceback()[:2000],
            )


def send_interviewer_feedback_reminders():
    """Runs once daily (see hooks.py scheduler_events["daily"]).

    Starting 2 days after an interview's end time, sends a daily reminder to
    any interviewer who hasn't yet submitted a matching Philanthrophy
    Feedback Form. Stops re-checking a schedule (sets reminder_sent) once
    every interviewer has submitted, or once 7 days have passed since the
    interview ended, whichever comes first. The very first reminder (at the
    24-hour mark) is sent separately by
    send_interviewer_first_feedback_reminder() - this job only handles
    day 2 onward, so the two never land on the same day.
    """
    now = frappe.utils.now_datetime()

    schedules = frappe.get_all(
        "Philanthropy Interview Schedule",
        filters=_FEEDBACK_REMINDER_FILTERS,
        fields=_FEEDBACK_REMINDER_FIELDS,
    )

    for s in schedules:
        if not (s.interview_date and s.end_time and s.application_id):
            continue

        try:
            end_dt = frappe.utils.get_datetime(f"{s.interview_date} {s.end_time}")
        except Exception:
            continue

        elapsed = now - end_dt
        if elapsed < timedelta(days=2):
            continue

        interviewer_emails, pending_emails = _pending_feedback_interviewers(
            s.name, s.application_id
        )

        if not pending_emails or elapsed > timedelta(days=7):
            # No interviewers, everyone has submitted, or a full week of
            # daily reminders has gone by - nothing left to chase.
            frappe.db.set_value(
                "Philanthropy Interview Schedule", s.name, "reminder_sent", 1
            )
            frappe.db.commit()
            continue

        _send_feedback_reminder(
            s, pending_emails, "Interview Feedback Reminder Error"
        )

        # Do NOT mark reminder_sent here - keep re-checking daily until
        # everyone submits or the 7-day window above closes it out.
        frappe.db.commit()


def send_interviewer_first_feedback_reminder():
    """Runs every 5 minutes (see hooks.py scheduler_events["cron"]).

    Sends the FIRST feedback reminder as soon as 24 hours have passed
    since a Philanthropy interview's end time, to every interviewer who
    hasn't submitted a Philanthrophy Feedback Form yet. Running every 5
    minutes means it goes out within minutes of the 24-hour mark, whatever
    time of day the interview ended. Marks first_reminder_sent so this
    never fires twice for the same schedule - the daily
    send_interviewer_feedback_reminders() job takes over from day 2.
    """
    now = frappe.utils.now_datetime()

    schedules = frappe.get_all(
        "Philanthropy Interview Schedule",
        filters={**_FEEDBACK_REMINDER_FILTERS, "first_reminder_sent": 0},
        fields=_FEEDBACK_REMINDER_FIELDS,
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

        if elapsed > timedelta(days=2):
            # Interview ended over 2 days ago (e.g. schedules that existed
            # before this job did) - the daily job already covers it, so
            # don't send a late "first" reminder on top.
            frappe.db.set_value(
                "Philanthropy Interview Schedule", s.name, "first_reminder_sent", 1
            )
            frappe.db.commit()
            continue

        _, pending_emails = _pending_feedback_interviewers(s.name, s.application_id)

        if pending_emails:
            _send_feedback_reminder(
                s, pending_emails, "Interview First Feedback Reminder Error"
            )

        frappe.db.set_value(
            "Philanthropy Interview Schedule", s.name, "first_reminder_sent", 1
        )
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
            "interview_mode",
            "event_id",
            "google_map_link",
            "google_map",
        ],
    )

    for s in schedules:
        if not (s.interview_date and s.start_time and s.attendees):
            continue

        try:
            start_dt = frappe.utils.get_datetime(f"{s.interview_date} {s.start_time}")
        except Exception:
            continue

        # Example: interview tomorrow 10:00 AM -> this becomes true (and the
        # candidate gets emailed) starting today at 10:00 AM, the moment
        # time_to_interview first drops to exactly 24h. Runs every 5
        # minutes (see hooks.py's cron entry), so it fires within minutes
        # of that mark rather than only once a day at whatever time the
        # old "daily" job happened to run.
        time_to_interview = start_dt - now
        if time_to_interview <= timedelta(0) or time_to_interview > timedelta(days=1):
            continue

        # Online interviews: re-fetch the Teams join link fresh off the
        # Graph event (it isn't persisted on the doc, only event_id is).
        # In-person: fall back to the Google Map link, if any.
        join_url = ""
        # Hybrid: the candidate attends in person, so they get the map link.
        s_is_online = _resolve_interview_mode(s.interview_mode, s.interview_type)[
            0
        ] and not _is_hybrid(s.interview_mode)
        if s_is_online and s.event_id and s.organizer_email:
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

        link = (
            join_url
            or _resolve_location(s.google_map, "", s.google_map_link or "")[1]
            or ""
        )
        interview_date_fmt = formatdate(s.interview_date, "dd MMMM yyyy")
        interview_time_fmt = format_time(s.start_time)

        link_html = (
            f"<p>Please join using the link below:<br>"
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


def _schedule_interviewer_emails(schedule):
    """Every interviewer on a schedule — main (in-person) group plus, in
    Hybrid mode, the Hybrid Interview Email group. Lower-cased, de-duplicated,
    original order kept."""
    rows = list(schedule.interviewer_email or [])
    if _is_hybrid(schedule.get("interview_mode")):
        rows += list(schedule.get("hybrid_interview_email") or [])
    emails = [(r.interviewer_email or "").strip().lower() for r in rows]
    return [e for e in dict.fromkeys(emails) if e]


def _find_schedule_for_feedback(feedback_doc):
    """The interview this feedback belongs to: the most recent scheduled
    (not cancelled) interview for the applicant that the submitter was on
    the panel of (_feedback_panel_emails). Falls back to the applicant's
    most recent scheduled interview."""
    names = frappe.get_all(
        "Philanthropy Interview Schedule",
        filters={
            "application_id": feedback_doc.applicant_id,
            "is_cancelled": 0,
            "event_id": ["is", "set"],
            # An interview scheduled after this feedback can't be its interview.
            "creation": ["<=", feedback_doc.creation or frappe.utils.now_datetime()],
        },
        order_by="interview_date desc, start_time desc, creation desc",
        pluck="name",
    )
    if not names:
        return None
    for name in names:
        schedule = frappe.get_doc("Philanthropy Interview Schedule", name)
        panel = _schedule_interviewer_emails(schedule)
        if _feedback_panel_emails(feedback_doc, panel, _field_panelist_names(panel)):
            return schedule
    return frappe.get_doc("Philanthropy Interview Schedule", names[0])


def send_feedback_submitted_email(feedback_doc):
    """Called from feedback_merge.on_feedback_form_submitted (after_insert of
    Philanthrophy Feedback Form).

    Emails every interviewer of that interview (main + Hybrid group, CC'd to
    the schedule's CC list) that this interviewer has submitted feedback,
    with the submitted data. Each later submission for the same interview is
    sent as a reply in the SAME email thread ("X has also submitted"), and
    carries every feedback submitted so far plus who is still pending.

    Sent as Communication records linked to the schedule, so they also show
    on the schedule's timeline, and the reply's In-Reply-To header points
    at the first email — that's what keeps them in one thread.
    """
    from frappe.core.doctype.communication.email import _make as make_communication

    schedule = _find_schedule_for_feedback(feedback_doc)
    if not schedule:
        return

    # Panel only — never the candidate (attendees). The form's own "email"
    # (the hidden grants.recruitment@ default) isn't a panel member.
    interviewer_emails = _field_without_candidate(
        _schedule_interviewer_emails(schedule), schedule.get("attendees")
    )
    recipients = list(interviewer_emails)
    if not recipients:
        return
    cc_list = _field_without_candidate(
        [
            (r.interviewer_email or "").strip().lower()
            for r in (schedule.interviewers_cc_email or [])
            if r.interviewer_email
        ],
        schedule.get("attendees"),
    )
    cc_list = [c for c in dict.fromkeys(cc_list) if c not in recipients]

    # All feedback for THIS interview so far: submitted by one of its
    # interviewers after the interview was scheduled (earlier rounds'
    # feedback for the same applicant is excluded by the creation filter).
    feedbacks = frappe.get_all(
        "Philanthrophy Feedback Form",
        filters={
            "applicant_id": feedback_doc.applicant_id,
            "creation": [">=", schedule.creation],
        },
        fields=[
            "name",
            "interviewer_name",
            "email",
            "owner",
            "application_status",
            "interview_status",
            "feedback_date",
            "phil_feedback",
        ],
        order_by="creation asc",
    )

    known = _field_panelist_names(recipients)
    names = {e: known.get(e) or e for e in recipients}

    # Feedback from this interview's panel (matched by email / owner / name,
    # see _feedback_panel_emails) plus the one just submitted.
    covers = {f.name: _feedback_panel_emails(f, interviewer_emails, known) for f in feedbacks}
    feedbacks = [f for f in feedbacks if covers[f.name] or f.name == feedback_doc.name]

    submitter_name = (
        (feedback_doc.interviewer_name or "").strip()
        or ", ".join(names[e] for e in covers.get(feedback_doc.name, ()))
        or "An interviewer"
    )
    submitted = set().union(*covers.values()) if covers else set()
    pending = [names[e] for e in interviewer_emails if e not in submitted]

    applicant_name = (
        schedule.applicants_name
        or feedback_doc.applicant_name
        or feedback_doc.applicant_id
    )
    role = schedule.role or feedback_doc.role or ""
    subject = (
        f"Interview Feedback – {applicant_name} ({role})"
        f"{_theme_geo_subline(schedule.get('theme'), schedule.get('geo'))}"
    )

    root = frappe.db.get_value(
        "Communication",
        {
            "reference_doctype": "Philanthropy Interview Schedule",
            "reference_name": schedule.name,
            "subject": subject,
            "sent_or_received": "Sent",
        },
        "name",
        order_by="creation asc",
    )

    cards = ""
    for f in reversed(feedbacks):  # newest first
        is_new = f.name == feedback_doc.name
        cards += f"""
        <div style="border:1px solid {'#1e3a8a' if is_new else '#e3e3e3'};border-radius:10px;padding:14px;background:#f9fafb;margin-bottom:12px;">
        <p><strong>Interviewer:</strong> {f.interviewer_name or ', '.join(names[e] for e in covers.get(f.name, ())) or '-'}{' <em>(new)</em>' if is_new else ''}</p>
        {f"<p><strong>Email:</strong> {', '.join(sorted(covers[f.name]))}</p>" if covers.get(f.name) else ''}
        <p><strong>Round:</strong> {f.application_status or ''}</p>
        <p><strong>Interview Status:</strong> {f.interview_status or ''}</p>
        <p><strong>Date:</strong> {formatdate(f.feedback_date, 'dd MMMM yyyy') if f.feedback_date else ''}</p>
        <p><strong>Feedback:</strong></p>
        {f.phil_feedback or ''}
        </div>
        """

    pending_html = (
        f"<p><strong>Feedback pending from:</strong> {', '.join(pending)}</p>"
        if pending
        else "<p><strong>All interviewers have submitted their feedback.</strong></p>"
    )

    body = f"""
    <p>Hi {', '.join(names[e] for e in recipients)},</p>
    <p><strong>{submitter_name}</strong> has {'also ' if root else ''}submitted the interview
    feedback for <strong>{applicant_name}</strong> ({role}).</p>
    <p><strong>Interview Date:</strong> {formatdate(schedule.interview_date, 'dd MMMM yyyy') if schedule.interview_date else ''}</p>
    {cards}
    {pending_html}
    <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
    {_logo_html()}
    """

    # Organizer's mailbox if it's set up as an outgoing Email Account, else the
    # default outgoing account — never the session user, which for the
    # public feedback web form is often Guest.
    sender = None
    if schedule.organizer_email and frappe.db.exists(
        "Email Account", {"email_id": schedule.organizer_email, "enable_outgoing": 1}
    ):
        sender = schedule.organizer_email
    else:
        sender = frappe.db.get_value(
            "Email Account", {"default_outgoing": 1, "enable_outgoing": 1}, "email_id"
        )

    make_communication(
        doctype="Philanthropy Interview Schedule",
        name=schedule.name,
        content=body,
        subject=f"Re: {subject}" if root else subject,
        sender=sender,
        recipients=recipients,
        cc=cc_list or None,
        send_email=True,
        add_signature=False,
        in_reply_to=root,
    )
