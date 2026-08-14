import frappe
import os, ast, base64, time, re, requests
from datetime import datetime, timedelta
from frappe.utils import get_url, formatdate, format_time, get_datetime
from frappe.utils.file_manager import save_file
from frappe.utils.pdf import get_pdf


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


# Every Health-family sub-unit (PG Fellowship, MBBS Fellowship, Health -
# Common) sends interviewers to a real public feedback web form hosted on
# pathways.azimpremjifoundation.org — not a Desk route — and which exact
# form depends on BOTH which sub-unit the interview belongs to AND which
# round it is. This program (ms_health.py) only handles Health - Common
# right now, so SUB_UNIT is hardcoded below, but the table itself already
# covers all three so MBBS Fellowship's and PG Fellowship's future
# create_interview_event()s (in ms_healthfellowship.py / a future
# ms_pgfellowship.py) can reuse this exact same table and matching logic
# instead of duplicating it.
SUB_UNIT = "Health - Common"

FEEDBACK_FORM_URLS = {
    "PG Fellowship": {
        "Round One": "https://pathways.azimpremjifoundation.org/pg-fellowship-feedback-form-one/new",
        "Round Two": "https://pathways.azimpremjifoundation.org/pg-fellowship-feedback-two/new",
    },
    "MBBS Fellowship": {
        "Round One": "https://pathways.azimpremjifoundation.org/health-feedback-form-one/new",
        "Round Two": "https://pathways.azimpremjifoundation.org/mbbs-health-feedback-form-two/new",
    },
    "Health - Common": {
        "Round One": "https://pathways.azimpremjifoundation.org/health-feedback-form-one/new",
        "Round Two": "https://pathways.azimpremjifoundation.org/health-feedback-form-two/new",
        "Round Three": "https://pathways.azimpremjifoundation.org/health-feedback-form-three/new",
        "Visit": "https://pathways.azimpremjifoundation.org/health-center-visit-form/new",
    },
}

# application_status's Select/Reject variants are the post-decision
# statuses set right after that round's feedback is already in, so an
# interview (re)scheduled while status is still at the plain round also
# needs the same round's form — this maps every status down to the round
# name FEEDBACK_FORM_URLS is keyed by. Non-interview statuses (New
# Applicant, CV Shortlist/Reject, Test Process/Select/Reject/No Response)
# aren't a real round and have no form, so they're left unmapped on
# purpose — _health_feedback_url falls back to Round One for those.
ROUND_ALIASES = {
    "Round One Select": "Round One",
    "Round One Reject": "Round One",
    "Round Two Select": "Round Two",
    "Round Two Reject": "Round Two",
    "Round Three Select": "Round Three",
    "Round Three Reject": "Round Three",
}


def _health_feedback_url(interview_round, application_id, applicants_name):
    """Maps this Health - Common interview's round (the application_status
    value at scheduling time) to the correct public feedback form, with
    application_id/applicants_name pre-filled as query params (same
    pattern as every other feedback-form link already sent from this app,
    e.g. ms_philanthropy.py's feedback_url)."""
    status = str(interview_round or "").strip()
    round_name = ROUND_ALIASES.get(status, status)
    table = FEEDBACK_FORM_URLS[SUB_UNIT]
    base_url = table.get(round_name) or table["Round One"]
    return f"{base_url}?applicant_id={application_id}&applicant_name={applicants_name}"


def _resume_link_html(candidate_cv_resume):
    if not candidate_cv_resume:
        return ""
    return f'<p style="margin:6px 0;">Resume: <a href="{get_url(candidate_cv_resume)}" target="_blank">Click here</a></p>'


def _application_form_link_html(application_id):
    """No PDF/print format exists for Health Application Form yet, so this
    links straight to its Desk record — only reachable by someone with a
    Frappe desk login, same limitation noted throughout this file for the
    feedback-form links below."""
    if not application_id:
        return ""
    url = get_url(f"/app/health-application-form/{application_id}")
    return f'<p style="margin:6px 0;">Application form: <a href="{url}" target="_blank">Click here</a></p>'


def _earlier_feedback_links_html(application_id):
    """Links straight to Health Application Form's "All the Feedback Form
    PDF" field — the single combined PDF that
    on_health_feedback_form_submitted() (see the bottom of this file)
    keeps rebuilt from every round filed so far (Round 1/2/3 + Visit), so
    a later-round panelist sees every earlier panel's feedback in one
    click instead of separate per-round links."""
    if not application_id:
        return '<p style="margin:6px 0;">Feedback from earlier discussions: None yet</p>'

    file_url = frappe.db.get_value("Health Application Form", application_id, "all_the_feedback_form_pdf")
    if not file_url:
        return '<p style="margin:6px 0;">Feedback from earlier discussions: None yet</p>'

    return (
        f'<p style="margin:6px 0;">Feedback from earlier discussions: '
        f'<a href="{get_url(file_url)}" target="_blank">Click here</a></p>'
    )


def _new_feedback_link_html(interview_round, application_id, applicants_name):
    url = _health_feedback_url(interview_round, application_id, applicants_name)
    return f'<p style="margin:6px 0;">Feedback form to share your views: <a href="{url}" target="_blank">Click here</a></p>'


def _mode_link_html(is_online, join_web_url, location_adress, map_location):
    """Single combined "MS Teams link / Venue address" line, per the
    official email template — replaces the previous separate
    meeting_html/venue_html/map_link_html blocks."""
    if is_online == 1 and join_web_url:
        return (
            f'<p style="margin:6px 0;"><strong>MS Teams link / Venue address:</strong> '
            f'<a href="{join_web_url}" target="_blank">Join Now</a></p>'
        )
    if location_adress or map_location:
        map_part = (
            f' (<a href="{map_location}" target="_blank">Map</a>)' if map_location else ""
        )
        return (
            f'<p style="margin:6px 0;"><strong>MS Teams link / Venue address:</strong> '
            f'{location_adress}{map_part}</p>'
        )
    return ""


@frappe.whitelist()
def get_org_rooms_and_availability(interview_date, start_time, end_time):
    """
    Lists every bookable room in the org and whether each is free for the
    given slot — backs the "Check Available Room" dialog on Health Interview
    Schedule. Mirrors ms_philanthropy.py's copy of this function exactly.
    """
    from datetime import timezone
    from zoneinfo import ZoneInfo

    IST = ZoneInfo("Asia/Kolkata")
    headers = _graph_headers()

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
            title="HEALTH_INTERVIEW_ROOM_LIST_FAILED",
            message=frappe.get_traceback(),
        )
        frappe.throw(
            f"Could not fetch the room list from Microsoft Graph — try again in a moment. ({e})"
        )

    room_emails = [r.get("emailAddress") for r in rooms if r.get("emailAddress")]

    start_local = get_datetime(f"{interview_date} {start_time}")
    end_local = get_datetime(f"{interview_date} {end_time}")
    start_utc = start_local.replace(tzinfo=IST).astimezone(timezone.utc)
    end_utc = end_local.replace(tzinfo=IST).astimezone(timezone.utc)

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
            frappe.log_error(
                title="HEALTH_INTERVIEW_ROOM_SCHEDULE_BATCH_FAILED",
                message=f"getSchedule batch failed for {batch}: {frappe.get_traceback()}",
            )
            continue

        for item in resp.json().get("value", []):
            key = item["scheduleId"].lower()
            schedule_map[key] = item.get("scheduleItems", [])
            availability_view_map[key] = item.get("availabilityView", "")

        time.sleep(0.1)

    final = []
    for r in rooms:
        email = r.get("emailAddress")
        if not email:
            continue
        key = email.lower()

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
    """Resolve each url in `attachment_paths` to a real File record and POST
    it onto the given Graph event as an attachment. Mirrors
    ms_philanthropy.py's helper of the same name exactly — see its docstring
    for the duplicate-File-record and Graph-has-no-dedupe reasoning this
    guards against.
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
        candidates = frappe.get_all(
            "File",
            filters={"file_url": web_path},
            fields=["file_url", "file_name", "is_private"],
        )
        if not candidates:
            frappe.log_error(
                title="HEALTH_INTERVIEW_ATTACH_NO_FILE_RECORD",
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
                title="HEALTH_INTERVIEW_ATTACH_FILE_MISSING",
                message=(
                    f"url={web_path!r} for event {event_id} matched {len(candidates)} "
                    f"File record(s), but none resolve to a real file on disk in "
                    f"either public or private folders — nothing to attach."
                ),
            )
            continue

        if os.path.getsize(resolved_path) > 3 * 1024 * 1024:
            frappe.log_error(
                title="HEALTH_INTERVIEW_ATTACH_TOO_LARGE",
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
            title="HEALTH_INTERVIEW_ATTACH_LIST_ERROR",
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
                    title="HEALTH_INTERVIEW_ATTACH_FAILED",
                    message=(
                        f"Attaching {fname!r} to event {event_id} failed | "
                        f"status={res.status_code} | body={res.text[:800]}"
                    ),
                )
        except Exception:
            frappe.log_error(
                title="HEALTH_INTERVIEW_ATTACH_ERROR",
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

    # An empty Organizer Email used to reach requests.post() as-is,
    # building a malformed Graph URL (.../users//events — empty organizer
    # segment) that Graph rejects with a bare 405 Method Not Allowed. That
    # told the recruiter nothing about what was actually wrong; this at
    # least names the missing field before ever calling Graph.
    if not (Organizer_email or "").strip():
        frappe.throw(
            "Organizer Email is required to schedule this interview — "
            "please fill it in and save before scheduling."
        )

    Organizer_email = Organizer_email.strip()
    Applicants_Role = Applicants_Role or ""
    Map_location = Map_location or ""
    Comments_for_interviewer = Comments_for_interviewer or ""
    Location_adress = Location_adress or ""

    start_dt = datetime.fromisoformat(start_datetime)
    end_dt = datetime.fromisoformat(end_datetime)

    interview_date = start_dt.strftime("%d %B %Y")
    start_time = start_dt.strftime("%I:%M %p")
    end_time = end_dt.strftime("%I:%M %p")
    mode_label = "Teams Meeting" if is_online == 1 else "In-Person"

    headers = _graph_headers()
    meeting_room = _resolve_meeting_room(room_emails, headers)

    interview_round = None
    application_pdf_url = None
    if application_id:
        _r = frappe.db.get_value(
            "Health Application Form",
            application_id,
            ["application_status", "resume_upload"],
            as_dict=True,
        )
        if _r:
            interview_round = _r.get("application_status")
            application_pdf_url = _r.get("resume_upload")

    feedback_url = _health_feedback_url(interview_round, application_id, Applicants_name)

    # -------- CREATE EVENT --------
    create_url = f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events"

    draft_payload = {
        "subject": f"{Applicants_Role} - {Applicants_name}",
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

    # -------- ATTACH FILES --------
    extra_paths = [application_pdf_url] if application_pdf_url else []
    _attach_files_to_event(headers, Organizer_email, event_id, attachment_paths, extra_paths)

    meeting_room_html = (
        f'<p style="margin:6px 0;"><strong>Meeting room:</strong> {meeting_room}</p>'
        if meeting_room
        else ""
    )
    mode_link_html = _mode_link_html(is_online, join_web_url, Location_adress, Map_location)

    # Official templates (items 8 & 9) — see below for the "Documents"
    # section, which only item 8 (the panel email) carries.
    interviewer_body = f"""
    <p>Hi {InterviewersName},</p>
    <p>Kindly find the details of the discussion scheduled:</p>
    <p><strong>Applicant name:</strong> {Applicants_name}</p>
    <p><strong>Role:</strong> {Applicants_Role}</p>
    <p><strong>Date:</strong> {interview_date}</p>
    <p><strong>Time:</strong> {start_time} – {end_time}</p>
    <p><strong>Mode:</strong> {mode_label}</p>
    {mode_link_html}
    {meeting_room_html}
    <p><strong>Documents:</strong></p>
    {_resume_link_html(application_pdf_url)}
    {_application_form_link_html(application_id)}
    {_earlier_feedback_links_html(application_id)}
    {_new_feedback_link_html(interview_round, application_id, Applicants_name)}
    <p>Kindly reach out to us if you have any questions.</p>
    <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
    """

    candidate_body = f"""
    <p>Hi {Applicants_name},</p>
    <p>Kindly find below the details of the discussion scheduled:</p>
    <p><strong>Role:</strong> {Applicants_Role}</p>
    <p><strong>Date:</strong> {interview_date}</p>
    <p><strong>Time:</strong> {start_time} – {end_time}</p>
    <p><strong>Mode:</strong> {mode_label}</p>
    {mode_link_html}
    <p>Kindly reach out to us if you have any questions.</p>
    <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
    """

    interviewer_list = [
        i.strip() for i in (interviewer_emails or "").split(",") if i.strip()
    ]
    cc_list = [i.strip() for i in (cc_emails or "").split(",") if i.strip()]
    room_list = [r.strip() for r in (room_emails or "").split(",") if r.strip()]
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
        subject=f"APF - {Applicants_Role} - {Applicants_name}",
        message=candidate_body,
        delayed=False,
    )

    frappe.msgprint("✅ Event created successfully — Outlook notified automatically.")

    if name:
        frappe.db.set_value(
            "Health Interview Schedule",
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
    Reschedules an already-created interview. Mirrors
    ms_philanthropy.py's update_interview_event exactly, including the
    attach-before-notify ordering and 404 stale-event recovery — see its
    docstring for the full reasoning.
    """
    doc = frappe.get_doc("Health Interview Schedule", name)
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

    if not (Organizer_email or "").strip():
        frappe.throw(
            "Organizer Email is required to reschedule this interview — "
            "please fill it in and save before rescheduling."
        )

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

    # Attach BEFORE the time/attendees PATCH below — see
    # ms_philanthropy.py's update_interview_event for the full reasoning
    # (PATCHing is what triggers Exchange's "meeting updated" notice, and a
    # freshly-attached file only shows up in it if it's already on the
    # event by the time this PATCH fires).
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
        frappe.log_error(
            title="HEALTH_INTERVIEW_RESCHEDULE_STALE_EVENT",
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

    join_web_url = ""
    if is_online == 1:
        ev = requests.get(event_url, headers=headers).json()
        if ev.get("onlineMeeting"):
            join_web_url = ev["onlineMeeting"].get("joinUrl", "")

    meeting_room_html = (
        f'<p style="margin:6px 0;"><strong>Meeting room:</strong> {meeting_room}</p>'
        if meeting_room
        else ""
    )
    mode_link_html = _mode_link_html(is_online, join_web_url, Location_adress, Map_location)

    interview_round = frappe.db.get_value(
        "Health Application Form", application_id, "application_status"
    ) if application_id else None
    candidate_cv_resume = frappe.db.get_value(
        "Health Application Form", application_id, "resume_upload"
    ) if application_id else None

    # Same official templates as create_interview_event, just noting the
    # reschedule up front rather than re-sending a generic "scheduled" line.
    interviewer_body = f"""
    <p>Hi {InterviewersName},</p>
    <p>The discussion below has been <strong>rescheduled</strong>:</p>
    <p><strong>Applicant name:</strong> {Applicants_name}</p>
    <p><strong>Role:</strong> {Applicants_Role}</p>
    <p><strong>New Date:</strong> {interview_date}</p>
    <p><strong>New Time:</strong> {start_time} – {end_time}</p>
    <p><strong>Mode:</strong> {mode_label}</p>
    {mode_link_html}
    {meeting_room_html}
    <p><strong>Documents:</strong></p>
    {_resume_link_html(candidate_cv_resume)}
    {_application_form_link_html(application_id)}
    {_earlier_feedback_links_html(application_id)}
    {_new_feedback_link_html(interview_round, application_id, Applicants_name)}
    <p>Kindly reach out to us if you have any questions.</p>
    <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
    """

    candidate_body = f"""
    <p>Hi {Applicants_name},</p>
    <p>Kindly find below the updated details of the discussion — it has been <strong>rescheduled</strong>:</p>
    <p><strong>Role:</strong> {Applicants_Role}</p>
    <p><strong>New Date:</strong> {interview_date}</p>
    <p><strong>New Time:</strong> {start_time} – {end_time}</p>
    <p><strong>Mode:</strong> {mode_label}</p>
    {mode_link_html}
    <p>Kindly reach out to us if you have any questions.</p>
    <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
    """

    frappe.sendmail(
        recipients=[interviewee_email],
        sender=Organizer_email,
        subject=f"APF - {Applicants_Role} - {Applicants_name} (Rescheduled)",
        message=candidate_body,
        delayed=False,
    )
    if interviewer_list:
        frappe.sendmail(
            recipients=interviewer_list,
            cc=cc_list or None,
            sender=Organizer_email,
            subject=f"{Applicants_Role} - {Applicants_name} (Rescheduled)",
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
    Mirrors ms_philanthropy.py's helper of the same name — see its
    docstring for the full explanation.
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
                frappe.log_error(
                    title="HEALTH_INTERVIEW_CANCEL_ATTENDEE_LOOKUP_FAILED",
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
                if del_res.status_code not in (200, 202, 204, 404):
                    frappe.log_error(
                        title="HEALTH_INTERVIEW_CANCEL_ATTENDEE_DELETE_FAILED",
                        message=(
                            f"Deleting {attendee_email}'s copy (event {item['id']}) of "
                            f"iCalUId={ical_uid!r} failed | status={del_res.status_code} | "
                            f"body={del_res.text[:500]}"
                        ),
                    )
        except Exception:
            frappe.log_error(
                title="HEALTH_INTERVIEW_CANCEL_ATTENDEE_CLEANUP",
                message=f"Failed to remove cancelled event from {attendee_email}'s calendar: {frappe.get_traceback()}",
            )


@frappe.whitelist()
def cancel_interview_event(name):
    """
    Cancels an already-scheduled interview. Mirrors
    ms_philanthropy.py's cancel_interview_event exactly — cancels via Graph,
    then actively deletes it off each attendee's own calendar too rather
    than leaving that to Outlook's manual "Remove event" prompt.
    """
    doc = frappe.get_doc("Health Interview Schedule", name)

    if doc.is_cancelled:
        frappe.throw("This interview is already cancelled.")

    if doc.event_id and doc.organizer_email:
        headers = _graph_headers()
        event_url = (
            f"https://graph.microsoft.com/v1.0/users/{doc.organizer_email}"
            f"/events/{doc.event_id}"
        )

        ical_uid = None
        try:
            ev = requests.get(event_url, headers=headers, params={"$select": "iCalUId"})
            if ev.status_code == 200:
                ical_uid = ev.json().get("iCalUId")
        except Exception:
            frappe.log_error(
                title="HEALTH_INTERVIEW_CANCEL_ICALUID",
                message=frappe.get_traceback(),
            )

        res = requests.post(
            f"{event_url}/cancel",
            headers=headers,
            json={"comment": "This interview has been cancelled."},
        )
        if res.status_code not in (202, 204, 404):
            frappe.log_error(
                title="HEALTH_INTERVIEW_CANCEL",
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
            subject=f"Interview Cancelled – Azim Premji Foundation ({interview_date})",
            message=candidate_body,
            delayed=False,
        )

    # Interviewers/CC are Graph attendees on this event, and Graph's
    # /events/{id}/cancel action already sends them a native cancellation
    # notice in the same meeting thread — a separate frappe.sendmail here
    # would be a redundant second email.

    doc.db_set("is_cancelled", 1, update_modified=False)
    doc.db_set("event_id", "", update_modified=False)

    frappe.msgprint("✅ Interview cancelled — candidate and interviewer(s) notified.")

    return {"cancelled": True}


def send_interviewer_feedback_reminders():
    """Runs every 5 minutes (see hooks.py's cron entry).

    Starting 1 day after an interview's end time, sends a daily-equivalent
    reminder to any interviewer who hasn't yet submitted a matching Health
    feedback form — checking whichever of the two Health feedback doctypes
    matches this record's interview_round (Round 1 vs Rounds 2/3/4). Stops
    re-checking a schedule (sets reminder_sent) once every interviewer has
    submitted, or once 7 days have passed since the interview ended,
    whichever comes first. Mirrors ms_philanthropy.py's version of this
    function; the only real difference is which feedback doctype to check,
    since Health split that across two doctypes instead of one.
    """
    now = frappe.utils.now_datetime()

    schedules = frappe.get_all(
        "Health Interview Schedule",
        filters={"reminder_sent": 0},
        fields=[
            "name",
            "application_id",
            "applicants_name",
            "role",
            "organizer_email",
            "interview_date",
            "end_time",
            "interview_round",
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

        doc = frappe.get_doc("Health Interview Schedule", s.name)
        interviewer_emails = [
            row.interviewer_email
            for row in (doc.interviewer_email or [])
            if row.interviewer_email
        ]

        if not interviewer_emails:
            frappe.db.set_value("Health Interview Schedule", s.name, "reminder_sent", 1)
            frappe.db.commit()
            continue

        feedback_doctype = (
            "Health Common Feedback Form Round 1"
            if "1" in str(s.interview_round or "").lower()
            else "Health Common Feedback Form Round 2 3 4"
        )
        submitted_panelists = frappe.get_all(
            feedback_doctype,
            filters={"applicant_id": s.application_id},
            pluck="panelist_names",
        )
        # panelist_names is one free-text field (can list multiple names),
        # not a per-interviewer record — a submission counts as covering an
        # interviewer if their address appears anywhere in it.
        submitted_blob = " ".join((p or "") for p in submitted_panelists).lower()
        pending_emails = [
            e for e in interviewer_emails if e.strip().lower() not in submitted_blob
        ]

        if not pending_emails:
            frappe.db.set_value("Health Interview Schedule", s.name, "reminder_sent", 1)
            frappe.db.commit()
            continue

        if elapsed > timedelta(days=7):
            frappe.db.set_value("Health Interview Schedule", s.name, "reminder_sent", 1)
            frappe.db.commit()
            continue

        feedback_url = _health_feedback_url(s.interview_round, s.application_id, s.applicants_name)
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
                    title="Health Interview Feedback Reminder Error",
                    message=frappe.get_traceback()[:2000],
                )

        frappe.db.commit()


def send_candidate_interview_reminders():
    """Runs every 5 minutes (see hooks.py's cron entry — registered directly
    on the 5-minute cron from the start, learning from
    ms_philanthropy.py's equivalent originally being on the once-daily
    scheduler: that only checked once around midnight, so how much notice a
    candidate actually got depended entirely on what time their interview
    was. Checking every 5 minutes fires this close to exactly 24 hours
    before the interview regardless of its time of day — see the identical
    fix applied to send_candidate_interview_reminders in ms_philanthropy.py.
    """
    now = frappe.utils.now_datetime()

    schedules = frappe.get_all(
        "Health Interview Schedule",
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
                "Health Interview Schedule", s.name, "candidate_reminder_sent", 1
            )
            frappe.db.commit()
        except Exception:
            frappe.log_error(
                title="Health Candidate Interview Reminder Error",
                message=frappe.get_traceback()[:2000],
            )


# ---------------------------------------------------------------------------
# Combined feedback PDF — mirrors ms_calendar.api.feedback_merge's pattern
# for Philanthropy (Philanthrophy Feedback Form -> Phil Registration Form's
# "feedback_form" field), adapted for MBBS Fellowship's 4-way round split:
# unlike Philanthropy's single feedback doctype, MBBS's rounds are spread
# across four separate doctypes (Round 1/2/3 + a Center Visit form), each
# linking applicant_id straight at Health Registration Form (NOT Health
# Application Form — MBBS's applicant record, despite this being
# ms_health.py). Every round gets rendered into ONE combined PDF and
# attached to Health Registration Form's existing "feedback_form" field
# (labelled "Health Feedback Form" on the form itself).
#
# "Health Common Feedback Form Round 1" / "Round 2 3 4" (built earlier this
# session as Health - Common's own feedback doctypes, linking to Health
# Application Form) are unused — the four MBBS doctypes below are the only
# ones actually in use, so these two are dead/orphaned and can be deleted
# whenever convenient.
# ---------------------------------------------------------------------------

MBBS_FEEDBACK_ROUND_DOCTYPES = [
    "Health Feedback Form one",
    "Health FeedBack Form Two",
    "Health Feedback Form Three",
    "Health Center Visit Form",
]

# These fields are just the applicant's own details, copied onto every
# feedback-round record at submission time (fetch_from Health Registration
# Form) — already shown once in the combined PDF's header, so skipped when
# rendering each round's own content to avoid repeating them under every
# single round.
_MBBS_FEEDBACK_HEADER_FIELDS = {
    "applicant_id", "applicant_name", "application_status", "role",
    "department", "phone", "email_address", "email",
}


def _build_mbbs_feedback_pdf(registration_name):
    """Core PDF-merge logic, shared by the whitelisted, permission-checked
    entrypoint below and on_mbbs_feedback_form_submitted's automated
    hook — the hook runs as whoever just filed feedback (often not someone
    with write access to Health Registration Form), so it calls this
    directly rather than through generate_mbbs_feedback_pdf()'s permission
    gate.

    Rebuilds the WHOLE combined PDF from every round's current record each
    time, rather than appending just the one just-saved record — so an
    edit to an earlier round's feedback (Round 2's form explicitly expects
    edits: "Any additions / edits to the feedback from Round 1") is
    reflected too, instead of only ever growing.
    """
    if not frappe.db.exists("Health Registration Form", registration_name):
        return {"status": "error", "message": "Registration not found"}

    reg = frappe.get_doc("Health Registration Form", registration_name)

    html = f"""
    <h1>Interview Feedback Summary</h1>
    <p><b>Applicant ID:</b> {registration_name}</p>
    <p><b>Applicant Name:</b> {reg.full_name or ''}</p>
    <hr>
    """

    any_feedback = False
    for feedback_doctype in MBBS_FEEDBACK_ROUND_DOCTYPES:
        meta = frappe.get_meta(feedback_doctype)
        docnames = frappe.get_all(
            feedback_doctype,
            filters={"applicant_id": registration_name},
            pluck="name",
            order_by="creation asc",
        )
        for docname in docnames:
            fb = frappe.get_doc(feedback_doctype, docname)
            any_feedback = True
            html += f"<h3>{feedback_doctype}</h3>"
            html += f"<p><b>Status at the time:</b> {fb.application_status or ''}</p>"
            for f in meta.fields:
                if f.fieldtype in ("Section Break", "Column Break", "Tab Break", "HTML", "Attach", "Link"):
                    continue
                if f.fieldname in _MBBS_FEEDBACK_HEADER_FIELDS:
                    continue
                value = fb.get(f.fieldname)
                if not value:
                    continue
                html += f"<p><b>{f.label or f.fieldname}:</b> {value}</p>"
            html += "<hr>"

    if not any_feedback:
        return {"status": "error", "message": "No feedback found"}

    pdf = get_pdf(html)
    filename = f"feedback_{registration_name}.pdf"

    # Regenerating replaces the previous combined PDF rather than piling up
    # a new file every time another round's feedback comes in — same fix
    # feedback_merge.py needed: match by attached_to_doctype/name/field,
    # not by file_name (save_file() appends a random suffix on disk, so
    # the old file is never actually named exactly "feedback_<id>.pdf").
    old_files = frappe.get_all(
        "File",
        filters={
            "attached_to_doctype": "Health Registration Form",
            "attached_to_name": registration_name,
            "attached_to_field": "feedback_form",
        },
        pluck="name",
    )
    for f in old_files:
        frappe.delete_doc("File", f, force=True, ignore_permissions=True)

    file_doc = save_file(
        fname=filename,
        content=pdf,
        dt="Health Registration Form",
        dn=registration_name,
        df="feedback_form",
        is_private=1,
    )
    file_url = file_doc.file_url

    reg.feedback_form = file_url
    reg.save(ignore_permissions=True)

    return {
        "status": "success",
        "file_url": file_url,
        "message": "PDF generated and attached successfully",
    }


@frappe.whitelist()
def generate_mbbs_feedback_pdf(registration_name):
    if not registration_name:
        return {"status": "error", "message": "Registration name required"}

    if not frappe.has_permission("Health Registration Form", "write"):
        frappe.throw(
            "You don't have permission to generate feedback PDFs.",
            frappe.PermissionError,
        )

    try:
        result = _build_mbbs_feedback_pdf(registration_name)
        frappe.db.commit()
        return result
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "MBBS Feedback PDF Error")
        return {"status": "error", "message": str(e)}


def on_mbbs_feedback_form_submitted(doc, method=None):
    """doc_events hook: on_update of all four MBBS feedback-round doctypes
    (Health Feedback Form one/Two/Three, Health Center Visit Form).
    on_update (not after_insert) so an edit to an already-saved round's
    feedback also rebuilds the combined PDF — matches the "collate from
    all panellists" wording built into Round 2's form, which expects edits
    after the initial save.

    Best-effort: never blocks the feedback save itself. Whoever just saved
    this often doesn't have write access to Health Registration Form, so
    this calls the permission-free core builder directly rather than the
    whitelisted, permission-checked generate_mbbs_feedback_pdf().
    """
    if not doc.applicant_id:
        return
    try:
        _build_mbbs_feedback_pdf(doc.applicant_id)
    except Exception:
        frappe.log_error(
            title="MBBS Feedback PDF Auto-Generate Error",
            message=f"{doc.doctype} {doc.name} ({doc.applicant_id}): {frappe.get_traceback()}",
        )
