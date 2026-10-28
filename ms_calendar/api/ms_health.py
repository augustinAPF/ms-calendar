import frappe
import os, ast, base64, time, re, requests, traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from frappe.utils import formatdate, format_time, get_datetime
from frappe.utils.file_manager import save_file
from frappe.utils.pdf import get_pdf

# Scholarship's (msgraph.py) Hybrid invite blocks — reused so both modules'
# Hybrid invites look the same.
from ms_calendar.api.msgraph import (
    _interview_schedule_candidate_panel_html,
    _interview_schedule_hybrid_panel_html,
    _interview_schedule_map_html,
)
# Field's panel-feedback helpers (one feedback link per invite, personal
# links in reminders, candidate kept off panel emails) — shared with Health.
from ms_calendar.api.ms_field import (
    FEEDBACK_REMINDER_SUBJECT,
    _feedback_reminder_sent_since,
    _field_panelist_names,
    _field_personal_feedback_url,
    _field_without_candidate,
    _outgoing_sender,
    _send_panel_feedback_reminders,
)

# Health Interview Schedule's "Application ID" (application_id) Link always
# points to Health Registration Form now — Health Application Form (this
# program's own separate applicant doctype, built earlier this session) has
# been dropped in favor of standardizing on Health Registration Form alone.
#
# Every function below that needs to read something off the applicant
# record still resolves the target doctype from application_id's own field
# metadata via _application_doctype() rather than hardcoding the doctype
# name directly, so this file keeps working unchanged if that Link's
# target ever needs repointing again in the future.
_APPLICATION_RESUME_FIELD = {
    "Health Registration Form": "resume",
}
_APPLICATION_FEEDBACK_PDF_FIELD = {
    "Health Registration Form": "feedback_form",
}
_APPLICATION_FORM_PDF_FIELD = {
    "Health Registration Form": "registration_form",
}


def _application_doctype():
    return frappe.get_meta("Health Interview Schedule").get_field("application_id").options


def _graph_headers():
    """Client-credentials OAuth against MS Graph; shared by create/update/cancel.
    The token is cached until 5 minutes before it expires (same as
    msgraph.py's copy, under a Health-only key), so each schedule doesn't
    spend a login round-trip first."""
    cache_key = "ms_calendar:ms_health_graph_token"
    access_token = frappe.cache().get_value(cache_key)
    if not access_token:
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


# Every Health-family sub-unit (PG Fellowship, MBBS Fellowship, Hospital
# and Urban) sends interviewers to a real public feedback web form hosted on
# pathways.azimpremjifoundation.org — not a Desk route — and which exact
# form depends on BOTH which sub-unit the interview belongs to AND which
# round it is. This program (ms_health.py) only handles Hospital and Urban
# right now, so SUB_UNIT is hardcoded below, but the table itself already
# covers all three so MBBS Fellowship's and PG Fellowship's future
# create_interview_event()s (in ms_healthfellowship.py / a future
# ms_pgfellowship.py) can reuse this exact same table and matching logic
# instead of duplicating it.
SUB_UNIT = "Hospital and Urban"

FEEDBACK_FORM_URLS = {
    "PG Fellowship": {
        "Round One": "https://pathways.azimpremjifoundation.org/pg-fellowship-feedback-form-one/new",
        "Round Two": "https://pathways.azimpremjifoundation.org/pg-fellowship-feedback-two/new",
    },
    "MBBS Fellowship": {
        "Round One": "https://pathways.azimpremjifoundation.org/health-feedback-form-one/new",
        "Round Two": "https://pathways.azimpremjifoundation.org/mbbs-health-feedback-form-two/new",
    },
    "Hospital and Urban": {
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
# name FEEDBACK_FORM_URLS is keyed by. Shortlist - CV/R1/R2 are likewise
# post-decision statuses set right after CV/Round One/Round Two feedback
# is already in, so they map to that same round's form. Non-interview
# statuses (New Applicant, CV Reject, Test Process/Select/Reject/No
# Response) aren't a real round and have no form, so they're left
# unmapped on purpose — _health_feedback_url falls back to Round One for
# those.
ROUND_ALIASES = {
    "Round One Select": "Round One",
    "Round One Reject": "Round One",
    "Round Two Select": "Round Two",
    "Round Two Reject": "Round Two",
    "Round Three Select": "Round Three",
    "Round Three Reject": "Round Three",
    "Shortlist - CV": "Round One",
    "Shortlist - R1": "Round Two",
    "Shortlist - R2": "Round Three",
}


def _resolve_sub_unit(role):
    """Picks which top-level FEEDBACK_FORM_URLS table an interview's
    feedback link should come from, based on the applicant's actual Role —
    e.g. a role of "PG Fellowship - 2026" routes to the "PG Fellowship"
    table, "MBBS Fellowship - 2026" to "MBBS Fellowship". Matched as a
    substring, case-insensitively, so any year/batch suffix on the role
    ("- 2026", "- 2027", ...) doesn't matter. Anything else (including no
    role at all) falls back to SUB_UNIT, this program's own default."""
    role_lower = str(role or "").strip().lower()
    if "pg fellowship" in role_lower:
        return "PG Fellowship"
    if "mbbs fellowship" in role_lower:
        return "MBBS Fellowship"
    return SUB_UNIT


def _health_feedback_round(interview_round, role=None):
    """The round whose feedback form this interview actually uses: the
    application_status at scheduling time, mapped through ROUND_ALIASES,
    falling back to "Round One" when the applicant's sub-unit has no form
    for that round (PG/MBBS Fellowship have no Round Three or Visit form).
    Shared by _health_feedback_url and send_interviewer_feedback_reminders
    so the reminder checks the same form the interviewer's link opens."""
    status = str(interview_round or "").strip()
    round_name = ROUND_ALIASES.get(status, status)
    if round_name not in FEEDBACK_FORM_URLS[_resolve_sub_unit(role)]:
        return "Round One"
    return round_name


def _health_feedback_url(interview_round, application_id, applicants_name, role=None):
    """Maps this interview's round (the application_status value at
    scheduling time) to the correct public feedback form — which table it
    comes from depends on the applicant's Role (see _resolve_sub_unit) —
    with application_id/applicants_name pre-filled as query params (same
    pattern as every other feedback-form link already sent from this app,
    e.g. ms_philanthropy.py's feedback_url).

    `app_id` (not `applicant_id`): the Health web forms' own scripts only
    read app_id. Local / UAT get their own host (_field_feedback_site_url)."""
    from urllib.parse import quote

    from ms_calendar.api.ms_field import _field_feedback_site_url

    table = FEEDBACK_FORM_URLS[_resolve_sub_unit(role)]
    base_url = table[_health_feedback_round(interview_round, role)]
    return _field_feedback_site_url(
        f"{base_url}?app_id={quote(str(application_id or ''), safe='')}"
        f"&applicant_name={quote(str(applicants_name or ''), safe='')}"
    )


def _document_attachment_paths(application_id):
    """Real file URLs for the applicant's own Resume, Application form,
    and combined Feedback PDF — passed to _attach_files_to_event() so
    these are attached to the calendar invite as real files an
    interviewer can open directly, instead of "Click here" links that
    used to point at the same three documents. (The fourth Documents
    line, "Feedback form to share your views", stays a link — it's a
    live web form to fill in, not a document that exists as a file.)"""
    if not application_id:
        return []
    doctype = _application_doctype()
    fields = [
        f
        for f in (
            _APPLICATION_RESUME_FIELD.get(doctype),
            _APPLICATION_FORM_PDF_FIELD.get(doctype),
            _APPLICATION_FEEDBACK_PDF_FIELD.get(doctype),
        )
        if f
    ]
    if not fields:
        return []
    values = frappe.db.get_value(doctype, application_id, fields, as_dict=True) or {}
    return [v for v in values.values() if v]


def _new_feedback_link_html(interview_round, application_id, applicants_name, role=None, panel_emails=None):
    """ONE feedback link for the whole panel, same as Field's invite
    (ms_field._field_panel_feedback_block): one member → their own link,
    several → the form asks "Who is filling this feedback?". The form keeps
    a Save draft per member (public/js/feedback_form_draft.js)."""
    from ms_calendar.api.ms_field import _field_panel_feedback_block

    url = _health_feedback_url(interview_round, application_id, applicants_name, role)
    return _field_panel_feedback_block(url, panel_emails)


def _coerce_is_online(value):
    """`is_online` arrives from health_interview_schedule.js as
    `frm.doc.interview_type` — the raw "Interview Mode" Select value
    ("Online" / "Offline" / "Phone"), not an actual 0/1 flag. The old
    `int(is_online)` conversion silently swallowed that: `int("Online")`
    always raises, so the except below always fell back to 0 — meaning
    every interview marked "Online" on the form still went out as
    "In-Person" in the email, and never got a real Teams meeting created
    (isOnlineMeeting/onlineMeetingProvider both derive from this same
    value). Recognizes "Online" and "Phone" explicitly (1 and 2) before
    falling through to a plain numeric parse, so a genuine 0/1/2 caller
    (e.g. a direct API call) still works exactly as before — "Offline"
    (and anything else unrecognized) stays In-Person (0). "Phone" used to
    collapse into this same 0/In-Person bucket too (confirmed 2026-09-11:
    a telephonic interview's email wrongly went out with the In-Person
    template instead of "Telephonic discussion" — see mode_label below),
    since int("Phone") also always raises.

    "Hybrid" is 1 too: the event still carries the Teams meeting so the
    Hybrid Interview Email group (attendees of the same event) can join
    online."""
    if isinstance(value, str):
        v = value.strip().lower()
        if v in ("online", "hybrid"):
            return 1
        if v == "phone":
            return 2
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _mode_link_html(is_online, join_web_url, location_adress, map_location):
    """Single combined "MS Teams link / Venue address" line, per the
    official email template — replaces the previous separate
    meeting_html/venue_html/map_link_html blocks."""
    if is_online == 1 and join_web_url:
        return (
            f'<p style="margin:6px 0;"><strong>MS Teams link / Venue address:</strong> '
            f'<a href="{join_web_url}" target="_blank">Join Now</a></p>'
        )
    if is_online == 2:
        # Phone/telephonic — no Teams link or venue address to show; the
        # candidate/interviewer is just called on the confirmed number, per
        # the official "Telephonic discussion" template (see mode_label).
        return ""
    if location_adress or map_location:
        map_part = (
            f' (<a href="{map_location}" target="_blank">Map</a>)'
            if map_location
            else ""
        )
        # Location Address is a Small Text — keep its line breaks.
        address_html = "<br>".join(
            line.strip() for line in (location_adress or "").splitlines() if line.strip()
        )
        return (
            f'<p style="margin:6px 0;"><strong>MS Teams link / Venue address:</strong> '
            f"{address_html}{map_part}</p>"
        )
    return ""


# ---------------------------------------------------------------------------
# Hybrid interview — same as Scholarship's (msgraph.py). The candidate and
# the main interviewers attend in person (venue + room); the "Hybrid
# Interview Email (Online)" group joins online. Both groups are attendees of
# the ONE Outlook event, and its single invite body lists the Offline Panel
# (with the venue) and the Online Panel (with the Teams link).
# hybrid_event_id is only kept to clean up the separate online event that
# older records were scheduled with.
# ---------------------------------------------------------------------------


def _is_hybrid(interview_type):
    return isinstance(interview_type, str) and interview_type.strip().lower() == "hybrid"


def _hybrid_interviewer_list(hybrid, hybrid_interviewer_emails, interviewer_list):
    # Empty unless the mode is Hybrid. Anyone already in the main (in-person)
    # interviewer list is skipped so nobody gets both invites.
    if not hybrid:
        return []
    hybrid_list = [
        h.strip() for h in (hybrid_interviewer_emails or "").split(",") if h.strip()
    ]
    return [h for h in dict.fromkeys(hybrid_list) if h not in interviewer_list]


def _schedule_interviewer_emails(schedule):
    """Every interviewer on a schedule — main (in-person) group plus, in
    Hybrid mode, the Hybrid Interview Email group. Lower-cased, de-duplicated,
    original order kept."""
    rows = list(schedule.interviewer_email or [])
    if _is_hybrid(schedule.get("interview_type")):
        rows += list(schedule.get("hybrid_interview_email") or [])
    emails = [(r.interviewer_email or "").strip().lower() for r in rows]
    return [e for e in dict.fromkeys(emails) if e]


def _health_venue(name, address, map_location):
    """(location, address, map_location) for the invite. Location Address /
    Google Map Link are fetched on the form from "Select Interview Location"
    (google_map); when they came through empty, read them off the Google Map
    Link record here, or fall back to the location text itself. google_map
    is a Data field on some sites and a Link on others — either way it holds
    the Google Map Link record's name."""
    location = (
        (frappe.db.get_value("Health Interview Schedule", name, "google_map") or "")
        if name
        else ""
    ).strip()
    address = (address or "").strip()
    map_location = (map_location or "").strip()
    if location and not (address and map_location) and frappe.db.exists("Google Map Link", location):
        rec = frappe.db.get_value(
            "Google Map Link", location, ["location_address", "location_map_link"], as_dict=True
        )
        address = address or (rec.location_address or "").strip()
        map_location = map_location or (rec.location_map_link or "").strip()
    return location, address or location, map_location


def _health_event_location(is_online, show_venue, location, address, meeting_room):
    """Outlook "Location" line: "<location> - <address>" for Offline / Hybrid,
    Teams for Online. Phone (and a venue-less Offline) keeps the old
    behaviour of showing the meeting room. None when there is nothing to show."""
    if is_online == 1 and not show_venue:
        return {"displayName": "Microsoft Teams Meeting"}
    if show_venue:
        # Address lines often already end in "," — don't double it up.
        one_line_address = ", ".join(
            line.strip().rstrip(",").strip()
            for line in (address or "").splitlines()
            if line.strip().rstrip(",").strip()
        )
        if location and one_line_address and location != one_line_address:
            return {"displayName": f"{location} - {one_line_address}"}
        if location or one_line_address:
            return {"displayName": location or one_line_address}
    return {"displayName": meeting_room} if meeting_room else None


def _health_teams_info(organizer_email, event_id, headers, event_json=None, poll=True):
    """(join_url, meeting_id, passcode). Read straight off `event_json`:
    Graph returns its Teams footer (Join / Meeting ID / Passcode) in the body
    of the POST that creates an online event, and after that our own invite
    body carries them — so usually no extra request is needed. Only when
    something is missing and `poll` is set does ms_field's
    _fetch_teams_meeting_info poll the event (it only tries the
    onlineMeetings API — which 403s here — if the body still has no IDs).
    poll=False for an existing event whose body never had the IDs: polling
    can't bring them back."""
    import html as _html

    from ms_calendar.api.ms_field import _extract_teams_ids_from_html

    body = ((event_json or {}).get("body") or {}).get("content", "") or ""
    join_web_url = ((event_json or {}).get("onlineMeeting") or {}).get("joinUrl", "") or ""
    if not join_web_url:
        m = re.search(r"""<a href=["'](https://teams\.microsoft\.com[^"']+)["']""", body)
        join_web_url = _html.unescape(m.group(1)) if m else ""
    meeting_id, passcode = _extract_teams_ids_from_html(body)
    if poll and not (join_web_url and meeting_id and passcode):
        from ms_calendar.api.ms_field import _fetch_teams_meeting_info

        polled = _fetch_teams_meeting_info(organizer_email, event_id, headers, True)
        join_web_url = polled[0] or join_web_url
        meeting_id = polled[1] or meeting_id
        passcode = polled[2] or passcode
    return join_web_url, meeting_id, passcode


def _health_meeting_html(join_web_url, meeting_id, passcode):
    """Online Panel's Join link + Meeting ID + Passcode (Hybrid invite) —
    same markup as Scholarship's, so _extract_teams_ids_from_html reads the
    IDs back off this body on a reschedule."""
    if not join_web_url:
        return ""
    html = f'<p><b>Join Teams Meeting:</b> <a href="{join_web_url}" target="_blank">Join Now</a>'
    if meeting_id:
        html += f"<br><b>Meeting ID:</b> {meeting_id}"
    if passcode:
        html += f"<br><b>Passcode:</b> {passcode}"
    return html + "</p>"


def _cancel_graph_event(headers, organizer_email, event_id, comment):
    """Cancels one Outlook event (Graph notifies its attendees with
    `comment`) and returns (iCalUId, attendee emails) for the background
    calendar cleanup — read off the event itself before cancelling."""
    event_url = (
        f"https://graph.microsoft.com/v1.0/users/{organizer_email}/events/{event_id}"
    )
    ical_uid = None
    attendee_emails = []
    try:
        ev = requests.get(
            event_url, headers=headers, params={"$select": "iCalUId,attendees"}
        )
        if ev.status_code == 200:
            data = ev.json()
            ical_uid = data.get("iCalUId")
            attendee_emails = [
                (a.get("emailAddress") or {}).get("address", "").strip()
                for a in data.get("attendees", [])
            ]
    except Exception:
        frappe.log_error(
            title="HEALTH_INTERVIEW_CANCEL_ICALUID", message=frappe.get_traceback()
        )

    res = requests.post(f"{event_url}/cancel", headers=headers, json={"comment": comment})
    if res.status_code not in (202, 204, 404):
        frappe.log_error(
            title="HEALTH_INTERVIEW_CANCEL",
            message=f"Graph cancel failed | status={res.status_code} | body={res.text[:800]}",
        )
    return ical_uid, [e for e in attendee_emails if e]


def _save_hybrid_event_id(name, hybrid_event_id):
    if name and frappe.get_meta("Health Interview Schedule").has_field("hybrid_event_id"):
        frappe.db.set_value(
            "Health Interview Schedule",
            name,
            "hybrid_event_id",
            hybrid_event_id or "",
            update_modified=False,
        )


def _cancel_legacy_hybrid_event(headers, organizer_email, name, hybrid_event_id, comment):
    """Older Hybrid records had the online group on a separate Outlook event
    (hybrid_event_id). They're on the main event now, so that one is
    cancelled, taken off their calendars in the background, and the field
    cleared."""
    if not hybrid_event_id:
        return
    ical_uid, emails = _cancel_graph_event(headers, organizer_email, hybrid_event_id, comment)
    if ical_uid:
        frappe.enqueue(
            "ms_calendar.api.ms_health._remove_cancelled_event_in_background",
            queue="short",
            ical_uid=ical_uid,
            attendee_emails=emails,
            enqueue_after_commit=True,
        )
    _save_hybrid_event_id(name, "")


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
    """Resolve each url in `attachment_paths` to a real File record and POST
    it onto the given Graph event as an attachment. Mirrors
    ms_philanthropy.py's helper of the same name — see its docstring for the
    duplicate-File-record and Graph-has-no-dedupe reasoning this guards
    against. Like msgraph.py's copy: existing attachment names are only
    looked up for an existing event (not new_event), and files are uploaded
    in parallel.
    """
    attachment_files = []
    large_files = []
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

        # Graph's simple attachment method (a single POST with base64
        # contentBytes) rejects anything over ~3MB — used to just skip
        # these silently, which is exactly what was dropping the combined
        # feedback PDF for real applicants whose "Health Feedback Form"
        # field holds an older, larger merged document (5MB+) from before
        # this program's own feedback-merge feature existed. Graph
        # supports files up to 150MB via a separate chunked
        # createUploadSession + PUT flow instead — used here for anything
        # over the simple method's cap, so no attachment silently
        # disappears just for being a few MB over.
        if os.path.getsize(resolved_path) > 3 * 1024 * 1024:
            large_files.append((file_name, resolved_path))
            continue

        with open(resolved_path, "rb") as f:
            fb64 = base64.b64encode(f.read()).decode()

        attachment_files.append((file_name, fb64))

    if not (attachment_files or large_files):
        return

    attach_url = f"https://graph.microsoft.com/v1.0/users/{organizer_email}/events/{event_id}/attachments"

    # A just-created event has no attachments yet — skip the lookup.
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
                title="HEALTH_INTERVIEW_ATTACH_LIST_ERROR",
                message=f"Could not list existing attachments on event {event_id}: {frappe.get_traceback()}",
            )

    # Uploads run in parallel worker threads — no frappe calls in there;
    # each returns (title, message) on failure, logged on the main thread.
    def upload_small(fname, fb64):
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
                return (
                    "HEALTH_INTERVIEW_ATTACH_FAILED",
                    f"Attaching {fname!r} to event {event_id} failed | "
                    f"status={res.status_code} | body={res.text[:800]}",
                )
        except Exception:
            return (
                "HEALTH_INTERVIEW_ATTACH_ERROR",
                f"Attaching {fname!r} to event {event_id}: {traceback.format_exc()}",
            )
        return None

    def upload_large(fname, resolved_path):
        try:
            _upload_large_attachment(headers, organizer_email, event_id, resolved_path, fname)
        except Exception:
            return (
                "HEALTH_INTERVIEW_ATTACH_LARGE_UPLOAD_ERROR",
                f"Large-file upload for {fname!r} on event {event_id} failed: {traceback.format_exc()}",
            )
        return None

    jobs = [(upload_small, f, b) for f, b in attachment_files if f not in existing_names] + [
        (upload_large, f, p) for f, p in large_files if f not in existing_names
    ]
    if not jobs:
        return
    with ThreadPoolExecutor(max_workers=min(4, len(jobs))) as pool:
        errors = list(pool.map(lambda job: job[0](job[1], job[2]), jobs))
    for error in errors:
        if error:
            frappe.log_error(title=error[0], message=error[1])


def _upload_large_attachment(headers, organizer_email, event_id, file_path, file_name):
    """Graph's createUploadSession + chunked PUT flow for attachments over
    the ~3MB simple-attachment limit (up to 150MB total). Chunks must be a
    multiple of 320 KiB except the final one — see
    _attach_files_to_event's call site for why this exists at all."""
    file_size = os.path.getsize(file_path)
    session_url = (
        f"https://graph.microsoft.com/v1.0/users/{organizer_email}"
        f"/events/{event_id}/attachments/createUploadSession"
    )
    session_resp = requests.post(
        session_url,
        headers=headers,
        json={
            "AttachmentItem": {
                "attachmentType": "file",
                "name": file_name,
                "size": file_size,
            }
        },
        timeout=30,
    )
    session_resp.raise_for_status()
    upload_url = session_resp.json()["uploadUrl"]

    CHUNK_SIZE = 320 * 1024 * 10  # 3.2 MB — a multiple of Graph's required 320 KiB
    # Deliberately NOT reusing `headers` here — Graph's own docs for this
    # upload-session flow say not to send an Authorization header on these
    # PUTs at all (the uploadUrl is already user-context authenticated on
    # its own); carrying over the bearer token risked Graph rejecting the
    # chunk upload outright.
    with open(file_path, "rb") as f:
        offset = 0
        while offset < file_size:
            chunk = f.read(CHUNK_SIZE)
            chunk_len = len(chunk)
            end = offset + chunk_len - 1
            resp = requests.put(
                upload_url,
                headers={
                    "Content-Length": str(chunk_len),
                    "Content-Range": f"bytes {offset}-{end}/{file_size}",
                },
                data=chunk,
                timeout=120,
            )
            if resp.status_code not in (200, 201, 202):
                resp.raise_for_status()
            offset += chunk_len


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
    hybrid_interviewer_emails=None,
    HybridInterviewersName=None,
):

    # `is_online` is the raw Interview Mode value — read Hybrid off it
    # before it's coerced down to 0/1/2.
    hybrid = _is_hybrid(is_online)
    is_online = _coerce_is_online(is_online)
    # Venue (address / map) shows for Offline and Hybrid.
    show_venue = hybrid or is_online == 0

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
    Comments_for_interviewer = Comments_for_interviewer or ""
    location, Location_adress, Map_location = _health_venue(name, Location_adress, Map_location)

    start_dt = datetime.fromisoformat(start_datetime)
    end_dt = datetime.fromisoformat(end_datetime)

    interview_date = start_dt.strftime("%d %B %Y")
    start_time = start_dt.strftime("%I:%M %p")
    end_time = end_dt.strftime("%I:%M %p")
    mode_label = (
        "In-Person" if hybrid
        else "Teams Meeting" if is_online == 1
        else "Telephonic discussion - Please be available to receive the call" if is_online == 2
        else "In-Person"
    )

    headers = _graph_headers()
    meeting_room = _resolve_meeting_room(room_emails, headers)
    event_location = _health_event_location(
        is_online, show_venue, location, Location_adress, meeting_room
    )

    interview_round = None
    application_pdf_url = None
    if application_id:
        _application_dt = _application_doctype()
        _resume_field = _APPLICATION_RESUME_FIELD.get(_application_dt, "resume")
        _r = frappe.db.get_value(
            _application_dt,
            application_id,
            ["application_status", _resume_field],
            as_dict=True,
        )
        if _r:
            interview_round = _r.get("application_status")
            application_pdf_url = _r.get(_resume_field)

    interviewer_list = [
        i.strip() for i in (interviewer_emails or "").split(",") if i.strip()
    ]
    cc_list = [i.strip() for i in (cc_emails or "").split(",") if i.strip()]
    room_list = [r.strip() for r in (room_emails or "").split(",") if r.strip()]
    # Hybrid: the online group is invited on this same event.
    hybrid_list = _hybrid_interviewer_list(
        hybrid, hybrid_interviewer_emails, interviewer_list
    )
    # The panel invite carries the feedback link — never the candidate, even
    # if their address was also typed into a panel/CC list.
    interviewer_list = _field_without_candidate(interviewer_list, interviewee_email)
    cc_list = _field_without_candidate(cc_list, interviewee_email)
    hybrid_list = _field_without_candidate(hybrid_list, interviewee_email)
    online_names = (HybridInterviewersName or ", ".join(hybrid_list)) if hybrid_list else ""
    attendees = (
        [{"emailAddress": {"address": i}, "type": "required"} for i in interviewer_list]
        + [{"emailAddress": {"address": h}, "type": "required"} for h in hybrid_list]
        + [{"emailAddress": {"address": i}, "type": "optional"} for i in cc_list]
        + [{"emailAddress": {"address": r}, "type": "resource"} for r in room_list]
    )

    # -------- CREATE EVENT --------
    create_url = f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events"

    draft_payload = {
        "subject": f"{Applicants_Role} - {Applicants_name}",
        "isOnlineMeeting": True if is_online == 1 else False,
        "onlineMeetingProvider": "teamsForBusiness" if is_online == 1 else None,
        "showAs": "busy",
        "start": {"dateTime": start_datetime, "timeZone": "Asia/Kolkata"},
        "end": {"dateTime": end_datetime, "timeZone": "Asia/Kolkata"},
        "body": {"contentType": "HTML", "content": "<p>Interview scheduled.</p>"},
    }
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
    extra_paths = _document_attachment_paths(application_id)
    _attach_files_to_event(
        headers, Organizer_email, event_id, attachment_paths, extra_paths, new_event=True
    )

    # -------- MEETING DETAILS --------
    # Join link + Meeting ID + Passcode come back in the create response's
    # body (Graph's Teams footer); the poll only runs if Graph hadn't
    # attached the Teams meeting yet.
    join_web_url = ""
    join_meeting_id = ""
    join_passcode = ""
    if is_online == 1:
        join_web_url, join_meeting_id, join_passcode = _health_teams_info(
            Organizer_email, event_id, headers, event_json=event
        )

    meeting_room_html = (
        f'<p style="margin:6px 0;"><strong>Meeting room:</strong> {meeting_room}</p>'
        if meeting_room
        else ""
    )
    mode_link_html = _mode_link_html(
        0 if show_venue else is_online, join_web_url, Location_adress, Map_location
    )
    # Hybrid: the candidate attends in person — venue only, no Teams link
    # (the Teams call is for the online interviewers).
    candidate_mode_link_html = mode_link_html
    # Meeting ID / Passcode under the Teams link — the candidate needs them,
    # and the interviewer invite carries them too: our body replaces Graph's
    # own Teams footer, and reschedules / reminders read them back off it.
    meeting_id_html = (
        f'<p style="margin:6px 0;"><strong>Meeting ID:</strong> {join_meeting_id}<br>'
        f'<strong>Passcode:</strong> {join_passcode}</p>'
        if is_online == 1 and not hybrid and join_web_url and (join_meeting_id or join_passcode)
        else ""
    )
    # The "Message to the Interviewer" field (message_to_the_interviewer on
    # the form, passed through as Comments_for_interviewer) used to be
    # normalized to "" above and then never actually rendered anywhere —
    # confirmed 2026-09-11: a recruiter's note here silently never reached
    # the interviewer's inbox. Only the interviewer email carries it, per
    # the field's own name/purpose — the candidate template has no matching
    # line.
    comments_html = (
        f'<p style="margin:6px 0;"><strong>Message to the Interviewer:</strong> {Comments_for_interviewer}</p>'
        if Comments_for_interviewer
        else ""
    )

    feedback_link_html = _new_feedback_link_html(
        interview_round, application_id, Applicants_name, Applicants_Role,
        panel_emails=interviewer_list + hybrid_list,
    )

    # One invite for the whole panel. Hybrid lists the Offline Panel (venue)
    # and the Online Panel (Teams link) together, in place of the Mode line.
    if hybrid:
        mode_html = _interview_schedule_hybrid_panel_html(
            InterviewersName,
            online_names,
            join_web_url,
            _health_meeting_html(join_web_url, join_meeting_id, join_passcode),
            _interview_schedule_map_html(0, Location_adress, Map_location),
        )
        greeting = f"Hi {', '.join(n for n in (InterviewersName, online_names) if n)}"
    else:
        mode_html = f"<p><strong>Mode:</strong> {mode_label}</p>\n    {mode_link_html}\n    {meeting_id_html}"
        greeting = f"Hi {InterviewersName}"

    # Official templates (items 8 & 9) — see below for the "Documents"
    # section, which only item 8 (the panel email) carries.
    interviewer_body = f"""
    <p>{greeting},</p>
    <p>Kindly find the details of the discussion scheduled:</p>
    <p><strong>Applicant name:</strong> {Applicants_name}</p>
    <p><strong>Role:</strong> {Applicants_Role}</p>
    <p><strong>Date:</strong> {interview_date}</p>
    <p><strong>Time:</strong> {start_time} – {end_time}</p>
    {mode_html}
    {meeting_room_html}
    {comments_html}
    <p><strong>Documents:</strong> Resume, Application form, and Feedback from earlier
    discussions (if any) are attached to this invite.</p>
    {feedback_link_html}
    <p>Kindly reach out to us if you have any questions.</p>
    <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
    """

    candidate_panel_html = (
        _interview_schedule_candidate_panel_html(True, InterviewersName, online_names)
        if hybrid
        else ""
    )
    candidate_body = f"""
    <p>Hi {Applicants_name},</p>
    <p>Kindly find below the details of the discussion scheduled:</p>
    <p><strong>Role:</strong> {Applicants_Role}</p>
    <p><strong>Date:</strong> {interview_date}</p>
    <p><strong>Time:</strong> {start_time} – {end_time}</p>
    <p><strong>Mode:</strong> {mode_label}</p>
    {candidate_mode_link_html}
    {meeting_id_html}
    {candidate_panel_html}
    <p>Kindly reach out to us if you have any questions.</p>
    <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
    """

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
    # round-trip — see cancel_interview_event's matching comment.
    frappe.enqueue(
        "frappe.sendmail",
        queue="short",
        enqueue_after_commit=True,
        recipients=[interviewee_email],
        sender=Organizer_email,
        subject=f"APF - {Applicants_Role} - {Applicants_name}",
        message=candidate_body,
        delayed=False,
    )

    if name:
        frappe.db.set_value(
            "Health Interview Schedule",
            name,
            {"event_id": event_id, "is_cancelled": 0},
            update_modified=False,
        )
        # No separate online event any more (see the Hybrid note above).
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
    hybrid_interviewer_emails=None,
    HybridInterviewersName=None,
):
    """
    Reschedules an already-created interview. Mirrors
    ms_philanthropy.py's update_interview_event exactly, including the
    attach-before-notify ordering and 404 stale-event recovery — see its
    docstring for the full reasoning. In Hybrid mode both groups are on this
    one event; an older record's separate online event (hybrid_event_id) is
    cancelled.
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

    interview_mode = is_online
    hybrid = _is_hybrid(interview_mode)
    is_online = _coerce_is_online(is_online)
    show_venue = hybrid or is_online == 0

    if not (Organizer_email or "").strip():
        frappe.throw(
            "Organizer Email is required to reschedule this interview — "
            "please fill it in and save before rescheduling."
        )

    Organizer_email = Organizer_email.strip()
    Applicants_Role = Applicants_Role or ""
    location, Location_adress, Map_location = _health_venue(name, Location_adress, Map_location)

    start_dt = datetime.fromisoformat(start_datetime)
    end_dt = datetime.fromisoformat(end_datetime)
    interview_date = start_dt.strftime("%d %B %Y")
    start_time = start_dt.strftime("%I:%M %p")
    end_time = end_dt.strftime("%I:%M %p")
    mode_label = (
        "In-Person" if hybrid
        else "Teams Meeting" if is_online == 1
        else "Telephonic discussion - Please be available to receive the call" if is_online == 2
        else "In-Person"
    )

    headers = _graph_headers()
    meeting_room = _resolve_meeting_room(room_emails, headers)
    event_location = _health_event_location(
        is_online, show_venue, location, Location_adress, meeting_room
    )

    event_url = f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events/{doc.event_id}"

    interviewer_list = [
        i.strip() for i in (interviewer_emails or "").split(",") if i.strip()
    ]
    # Hybrid: the online group is invited on this same event.
    hybrid_list = _hybrid_interviewer_list(
        hybrid, hybrid_interviewer_emails, interviewer_list
    )
    # Separate online event from before Hybrid was merged into one invite.
    hybrid_event_id = doc.get("hybrid_event_id") or ""
    cc_list = [i.strip() for i in (cc_emails or "").split(",") if i.strip()]
    room_list = [r.strip() for r in (room_emails or "").split(",") if r.strip()]
    # Panel only on the invite (it carries the feedback link) — never the candidate.
    interviewer_list = _field_without_candidate(interviewer_list, interviewee_email)
    cc_list = _field_without_candidate(cc_list, interviewee_email)
    hybrid_list = _field_without_candidate(hybrid_list, interviewee_email)
    online_names = (HybridInterviewersName or ", ".join(hybrid_list)) if hybrid_list else ""
    attendees = (
        [{"emailAddress": {"address": i}, "type": "required"} for i in interviewer_list]
        + [{"emailAddress": {"address": h}, "type": "required"} for h in hybrid_list]
        + [{"emailAddress": {"address": i}, "type": "optional"} for i in cc_list]
        + [{"emailAddress": {"address": r}, "type": "resource"} for r in room_list]
    )

    # Fetch the existing event first (instead of PATCHing straight away) so
    # the Teams join details are known BEFORE the single PATCH below — that
    # PATCH carries the refreshed body too, so interviewers get exactly one
    # "meeting updated" invite showing the new date/time, instead of an
    # updated invite still showing the OLD time in its body plus a second,
    # separate "(Rescheduled)" email.
    ev_res = requests.get(
        event_url, headers=headers, params={"$select": "id,isOnlineMeeting,onlineMeeting,body"}
    )
    if ev_res.status_code == 404:
        frappe.log_error(
            title="HEALTH_INTERVIEW_RESCHEDULE_STALE_EVENT",
            message=(
                f"Reschedule target Outlook event {doc.event_id} for {name} "
                f"returned 404 (likely deleted directly in Outlook) — "
                f"recreating a fresh event instead of failing the reschedule."
            ),
        )
        # The fresh event invites the online group too — cancel an older
        # record's separate online event first so they aren't double-booked.
        _cancel_legacy_hybrid_event(
            headers, Organizer_email, name, hybrid_event_id, "This interview has been rescheduled."
        )
        return create_interview_event(
            start_datetime=start_datetime,
            end_datetime=end_datetime,
            interviewer_emails=interviewer_emails,
            interviewee_email=interviewee_email,
            room_emails=room_emails,
            is_online=interview_mode,
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
            hybrid_interviewer_emails=hybrid_interviewer_emails,
            HybridInterviewersName=HybridInterviewersName,
        )
    ev_res.raise_for_status()
    ev = ev_res.json()

    # Attach BEFORE the time/attendees PATCH below — see
    # ms_philanthropy.py's update_interview_event for the full reasoning
    # (PATCHing is what triggers Exchange's "meeting updated" notice, and a
    # freshly-attached file only shows up in it if it's already on the
    # event by the time this PATCH fires).
    _attach_files_to_event(
        headers,
        Organizer_email,
        doc.event_id,
        attachment_paths,
        _document_attachment_paths(application_id),
    )

    # Interview Mode can be changed via "Modify The Schedule" (e.g. Offline
    # -> Online / Hybrid) — the original event then has no Teams meeting
    # yet, so add one first; its link goes into the body below.
    added_teams = False
    if is_online == 1 and not ev.get("isOnlineMeeting"):
        teams_res = requests.patch(
            event_url,
            headers=headers,
            json={"isOnlineMeeting": True, "onlineMeetingProvider": "teamsForBusiness"},
        )
        teams_res.raise_for_status()
        ev = teams_res.json()
        added_teams = True

    # The existing invite body (ours) already carries the Join link /
    # Meeting ID / Passcode. Only poll when the Teams meeting was just added
    # — for an older event without them in its body, polling can't help.
    join_web_url = ""
    join_meeting_id = ""
    join_passcode = ""
    if is_online == 1:
        join_web_url, join_meeting_id, join_passcode = _health_teams_info(
            Organizer_email, doc.event_id, headers, event_json=ev, poll=added_teams
        )

    meeting_room_html = (
        f'<p style="margin:6px 0;"><strong>Meeting room:</strong> {meeting_room}</p>'
        if meeting_room
        else ""
    )
    mode_link_html = _mode_link_html(
        0 if show_venue else is_online, join_web_url, Location_adress, Map_location
    )
    # Hybrid: the candidate attends in person — venue only, no Teams link.
    candidate_mode_link_html = mode_link_html
    # See create_interview_event's matching comment.
    meeting_id_html = (
        f'<p style="margin:6px 0;"><strong>Meeting ID:</strong> {join_meeting_id}<br>'
        f'<strong>Passcode:</strong> {join_passcode}</p>'
        if is_online == 1 and not hybrid and join_web_url and (join_meeting_id or join_passcode)
        else ""
    )
    # See create_interview_event's matching comment — Comments_for_interviewer
    # (the "Message to the Interviewer" field) used to be normalized and then
    # never actually rendered into either email template.
    comments_html = (
        f'<p style="margin:6px 0;"><strong>Message to the Interviewer:</strong> {Comments_for_interviewer}</p>'
        if Comments_for_interviewer
        else ""
    )

    _application_dt = _application_doctype()
    interview_round = (
        frappe.db.get_value(_application_dt, application_id, "application_status")
        if application_id
        else None
    )

    feedback_link_html = _new_feedback_link_html(
        interview_round, application_id, Applicants_name, Applicants_Role,
        panel_emails=interviewer_list + hybrid_list,
    )

    # One invite for the whole panel — see create_interview_event.
    if hybrid:
        mode_html = _interview_schedule_hybrid_panel_html(
            InterviewersName,
            online_names,
            join_web_url,
            _health_meeting_html(join_web_url, join_meeting_id, join_passcode),
            _interview_schedule_map_html(0, Location_adress, Map_location),
        )
        greeting = f"Hi {', '.join(n for n in (InterviewersName, online_names) if n)}"
    else:
        mode_html = f"<p><strong>Mode:</strong> {mode_label}</p>\n    {mode_link_html}\n    {meeting_id_html}"
        greeting = f"Hi {InterviewersName}"

    # Same template as create_interview_event's invite body, just with the
    # new date/time — this replaces the invite's body in place, so it's the
    # only thing the interviewer receives for a reschedule.
    interviewer_body = f"""
    <p>{greeting},</p>
    <p>Kindly find the details of the discussion scheduled:</p>
    <p><strong>Applicant name:</strong> {Applicants_name}</p>
    <p><strong>Role:</strong> {Applicants_Role}</p>
    <p><strong>Date:</strong> {interview_date}</p>
    <p><strong>Time:</strong> {start_time} – {end_time}</p>
    {mode_html}
    {meeting_room_html}
    {comments_html}
    <p><strong>Documents:</strong> Resume, Application form, and Feedback from earlier
    discussions (if any) are attached to this invite.</p>
    {feedback_link_html}
    <p>Kindly reach out to us if you have any questions.</p>
    <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
    """

    candidate_panel_html = (
        _interview_schedule_candidate_panel_html(True, InterviewersName, online_names)
        if hybrid
        else ""
    )
    candidate_body = f"""
    <p>Hi {Applicants_name},</p>
    <p>Kindly find below the updated details of the discussion — it has been <strong>rescheduled</strong>:</p>
    <p><strong>Role:</strong> {Applicants_Role}</p>
    <p><strong>New Date:</strong> {interview_date}</p>
    <p><strong>New Time:</strong> {start_time} – {end_time}</p>
    <p><strong>Mode:</strong> {mode_label}</p>
    {candidate_mode_link_html}
    {meeting_id_html}
    {candidate_panel_html}
    <p>Kindly reach out to us if you have any questions.</p>
    <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
    """

    # Single notifying PATCH: new time, full panel (incl. the Hybrid online
    # group), venue and the merged body. location is always sent so a mode
    # change (e.g. Online -> Phone) doesn't leave the old one behind.
    res = requests.patch(
        event_url,
        headers=headers,
        json={
            "start": {"dateTime": start_datetime, "timeZone": "Asia/Kolkata"},
            "end": {"dateTime": end_datetime, "timeZone": "Asia/Kolkata"},
            "location": event_location,
            "attendees": attendees,
            "body": {"contentType": "HTML", "content": interviewer_body},
            "showAs": "busy",
        },
    )
    res.raise_for_status()

    # Older Hybrid records had the online group on a separate event — they
    # are on this event now (or no longer invited), so that one comes off
    # their calendars.
    _cancel_legacy_hybrid_event(
        headers, Organizer_email, name, hybrid_event_id, "This interview has been rescheduled."
    )

    # The candidate isn't an attendee on the Outlook event, so the updated
    # invite never reaches them — this email is their only notice. Sent
    # from a background worker, same as create_interview_event's.
    frappe.enqueue(
        "frappe.sendmail",
        queue="short",
        enqueue_after_commit=True,
        recipients=[interviewee_email],
        sender=Organizer_email,
        subject=f"APF - {Applicants_Role} - {Applicants_name} (Rescheduled)",
        message=candidate_body,
        delayed=False,
    )

    # New date/time → the candidate's 24-hour reminder must fire again for
    # it, even if one already went out for the old slot.
    frappe.db.set_value(
        "Health Interview Schedule",
        name,
        "candidate_reminder_sent",
        0,
        update_modified=False,
    )

    frappe.msgprint("✅ Interview rescheduled — Outlook invite updated and candidate notified.")

    return {"event_id": doc.event_id, "rescheduled": True}


def _attendee_emails_for(doc):
    emails = set()
    rows = list(doc.interviewer_email or [])
    # Hybrid's online group is on this same event too.
    if _is_hybrid(doc.get("interview_type")):
        rows += list(doc.get("hybrid_interview_email") or [])
    for row in rows:
        if row.interviewer_email:
            emails.add(row.interviewer_email.strip())
    for row in doc.interviewers_cc_email or []:
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


def _remove_cancelled_event_in_background(ical_uid, attendee_emails):
    """Background half of cancel_interview_event — see its comment."""
    _remove_event_from_attendee_calendars(_graph_headers(), ical_uid, attendee_emails)


@frappe.whitelist()
def cancel_interview_event(name, reason=None):
    """
    Cancels an already-scheduled interview. Mirrors
    ms_philanthropy.py's cancel_interview_event exactly — cancels via Graph,
    then actively deletes it off each attendee's own calendar too rather
    than leaving that to Outlook's manual "Remove event" prompt.

    `reason` is mandatory (prompted for by health_interview_schedule.js's
    "Cancel The Schedule" button) and goes out to both sides: interviewers
    see it in Outlook's own cancellation notice (Graph's /cancel "comment"),
    the candidate in their cancellation email.
    """
    doc = frappe.get_doc("Health Interview Schedule", name)

    if doc.is_cancelled:
        frappe.throw("This interview is already cancelled.")

    reason = (reason or "").strip()
    if not reason:
        frappe.throw("Please enter the reason for cancelling this interview.")
    reason_html = frappe.utils.escape_html(reason).replace("\n", "<br>")

    # Kept on the record itself too — only if the field exists on this
    # site, since Health Interview Schedule is a custom (DB-only) doctype
    # and the field may not have been added everywhere yet.
    if frappe.get_meta("Health Interview Schedule").has_field("reson_for_canceling_event"):
        doc.db_set("reson_for_canceling_event", reason, update_modified=False)

    interview_date = (
        formatdate(doc.interview_date, "dd MMMM yyyy") if doc.interview_date else ""
    )
    # "hh:mm a" → "10:00 AM" (plain format_time() printed "10:00:02").
    start_time = format_time(doc.start_time, "hh:mm a") if doc.start_time else ""
    end_time = format_time(doc.end_time, "hh:mm a") if doc.end_time else ""
    logo_html = _logo_html()

    if doc.event_id and doc.organizer_email:
        headers = _graph_headers()
        event_url = (
            f"https://graph.microsoft.com/v1.0/users/{doc.organizer_email}"
            f"/events/{doc.event_id}"
        )

        # Outlook renders the /cancel "comment" as HTML (plain "\n" line
        # breaks all collapsed onto one line), so format it the same way as
        # the candidate's cancellation email below.
        interviewer_names = frappe.utils.escape_html(
            (doc.interviewer_name or "").strip()
        )

        def build_interviewer_comment(names):
            return f"""
        <p>Hi {names or "there"},</p>
        <p>This is to inform you that the interview with
        <strong>{frappe.utils.escape_html(doc.applicants_name or "")}</strong>
        scheduled on <strong>{interview_date}</strong> ({start_time} – {end_time})
        has been <strong>cancelled</strong>.</p>
        <p><strong>Reason:</strong> {reason_html}</p>
        <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
        """

        interviewer_comment = build_interviewer_comment(interviewer_names)

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
            json={"comment": interviewer_comment},
        )
        if res.status_code not in (202, 204, 404):
            frappe.log_error(
                title="HEALTH_INTERVIEW_CANCEL",
                message=f"Graph cancel failed | status={res.status_code} | body={res.text[:800]}",
            )

        # Per-attendee calendar cleanup is 2 Graph calls PER attendee — the
        # main reason cancelling used to hang for a long time. The /cancel
        # above has already notified everyone, so this is just tidying up
        # their calendars and can safely run in the background.
        if ical_uid:
            frappe.enqueue(
                "ms_calendar.api.ms_health._remove_cancelled_event_in_background",
                queue="short",
                ical_uid=ical_uid,
                attendee_emails=list(_attendee_emails_for(doc)),
                enqueue_after_commit=True,
            )

        # Older Hybrid records: the online group is on its own separate event.
        _cancel_legacy_hybrid_event(
            headers,
            doc.organizer_email,
            name,
            doc.get("hybrid_event_id"),
            build_interviewer_comment(""),
        )

    if doc.attendees:
        candidate_body = f"""
        <p>Hi {doc.applicants_name or "there"},</p>
        <p>This is to inform you that your interview scheduled on
        <strong>{interview_date}</strong> ({start_time} – {end_time}) has been
        <strong>cancelled</strong>.</p>
        <p><strong>Reason:</strong> {reason_html}</p>
        <p>We will reach out separately if the interview needs to be rescheduled.</p>
        <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
        {logo_html}
        """
        # Sent from a background worker so the Cancel button doesn't wait
        # on the SMTP round-trip (delayed=False / now=True both still send
        # inside this same request, just after commit).
        frappe.enqueue(
            "frappe.sendmail",
            queue="short",
            enqueue_after_commit=True,
            recipients=[doc.attendees],
            sender=doc.organizer_email,
            subject=f"Interview Cancelled – Azim Premji Foundation ({interview_date})",
            message=candidate_body,
            delayed=False,
        )

    # Interviewers/CC are Graph attendees on this event, and Graph's
    # /events/{id}/cancel action already sends them a native cancellation
    # notice (carrying the reason above as its comment) in the same meeting
    # thread — a separate frappe.sendmail here would be a redundant second
    # email.

    doc.db_set("is_cancelled", 1, update_modified=False)
    doc.db_set("event_id", "", update_modified=False)
    _save_hybrid_event_id(name, "")

    # No frappe.msgprint here — health_interview_schedule.js already shows
    # its own alert plus a red "Interview Cancelled" banner on the form, a
    # modal on top of that was just an extra click.
    return {"cancelled": True}


# Round -> which of the four real feedback doctypes to check for a
# submission — used by send_interviewer_feedback_reminders below. Every
# feedback web form in FEEDBACK_FORM_URLS (PG Fellowship, MBBS Fellowship
# and Hospital and Urban alike) writes into one of these same four
# doctypes, so this one map covers all three sub-units.
#
# These forms can't say WHICH interviewer submitted: "panal_name" /
# "panelist_name" is free-text names ("Ivan", "Shanthini, Vinod" — one
# form is often collated for the whole panel), and "email" is always the
# default health.fellowship@ address. Matching interviewer emails against
# the panelist-name field (the previous approach) therefore never matched,
# so every interviewer was reminded daily for the full 7 days even after
# feedback was in. Same as Field's reminder, any submission for the
# applicant in that round's doctype now counts as the feedback being done.
ROUND_TO_FEEDBACK_DOCTYPE = {
    "Round One": "Health Feedback Form one",
    "Round Two": "Health FeedBack Form Two",
    "Round Three": "Health Feedback Form Three",
    "Visit": "Health Center Visit Form",
}


def send_interviewer_feedback_reminders():
    """Runs daily (see hooks.py's scheduler_events["daily"] entry).

    Starting 1 day after an interview's end time, sends a daily reminder to
    every interviewer on the schedule until feedback for that applicant has
    been submitted in the round's feedback doctype (ROUND_TO_FEEDBACK_DOCTYPE,
    for the same round _health_feedback_url links to), or 7
    days have passed since the interview ended, whichever comes first — then
    sets reminder_sent so the schedule isn't checked again. Only feedback
    created on or after the interview date counts, so an earlier interview
    in the same round for the same applicant doesn't close this one out.
    """
    now = frappe.utils.now_datetime()

    # Cancelled interviews never happened, so there's no feedback to chase.
    # Rescheduling one resets is_cancelled to 0 (create_interview_event),
    # which brings it back into this queue automatically.
    schedules = frappe.get_all(
        "Health Interview Schedule",
        filters={"reminder_sent": 0, "is_cancelled": 0},
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
        # Panel only — never the candidate (attendees).
        interviewer_emails = _field_without_candidate(
            _schedule_interviewer_emails(doc), doc.get("attendees")
        )

        if not interviewer_emails:
            frappe.db.set_value("Health Interview Schedule", s.name, "reminder_sent", 1)
            frappe.db.commit()
            continue

        if _health_feedback_submitted(s):
            frappe.db.set_value("Health Interview Schedule", s.name, "reminder_sent", 1)
            frappe.db.commit()
            continue

        if elapsed > timedelta(days=7):
            frappe.db.set_value("Health Interview Schedule", s.name, "reminder_sent", 1)
            frappe.db.commit()
            continue

        feedback_url = _health_feedback_url(
            s.interview_round, s.application_id, s.applicants_name, s.role
        )
        reminder_body = _health_reminder_body(s, feedback_url)

        sender_arg = {}
        if s.organizer_email and frappe.db.exists(
            "Email Account", {"email_id": s.organizer_email, "enable_outgoing": 1}
        ):
            sender_arg = {"sender": s.organizer_email}

        names = _field_panelist_names(interviewer_emails)
        for email in interviewer_emails:
            # Each interviewer's own link (as in the invite) — the form opens
            # with their name filled in and their saved draft loaded.
            body = reminder_body.replace(
                feedback_url,
                _field_personal_feedback_url(feedback_url, email, names.get(email, "")),
            )
            try:
                frappe.sendmail(
                    recipients=[email],
                    subject=f"{FEEDBACK_REMINDER_SUBJECT} – {s.applicants_name}",
                    message=body,
                    delayed=False,
                    reference_doctype="Health Interview Schedule",
                    reference_name=s.name,
                    **sender_arg,
                )
            except Exception:
                frappe.log_error(
                    title="Health Interview Feedback Reminder Error",
                    message=frappe.get_traceback()[:2000],
                )

        frappe.db.commit()


def _health_feedback_submitted(s):
    """Any feedback for the applicant in this round's feedback doctype since
    the interview date (see ROUND_TO_FEEDBACK_DOCTYPE)."""
    feedback_doctype = ROUND_TO_FEEDBACK_DOCTYPE[
        _health_feedback_round(s.interview_round, s.role)
    ]
    return frappe.db.exists(
        feedback_doctype,
        {"applicant_id": s.application_id, "creation": [">=", s.interview_date]},
    )


def _health_reminder_body(s, feedback_url):
    return f"""
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


def send_interviewer_first_feedback_reminder():
    """Runs every 5 minutes (see hooks.py scheduler_events["cron"]) — same as
    Field's send_field_interview_first_feedback_reminder.

    Sends the FIRST "feedback pending" reminder 5 minutes after an interview
    ends, if no feedback has been submitted yet. Each panel member gets their
    own link. Sent as Communications on the schedule (no first_reminder_sent
    field on Health Interview Schedule), so it is sent only once. The daily
    send_interviewer_feedback_reminders takes over from day 1."""
    now = frappe.utils.now_datetime()
    schedules = frappe.get_all(
        "Health Interview Schedule",
        filters={
            "reminder_sent": 0,
            "is_cancelled": 0,
            "event_id": ["is", "set"],
            # Only interviews that may have just ended.
            "interview_date": ["between", [frappe.utils.add_days(now.date(), -1), now.date()]],
        },
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
        # Older than a day: the daily job covers it.
        if elapsed < timedelta(minutes=5) or elapsed > timedelta(days=1):
            continue
        if _health_feedback_submitted(s):
            continue
        if _feedback_reminder_sent_since("Health Interview Schedule", s.name, end_dt):
            continue

        doc = frappe.get_doc("Health Interview Schedule", s.name)
        interviewer_emails = _field_without_candidate(
            _schedule_interviewer_emails(doc), doc.get("attendees")
        )
        if not interviewer_emails:
            continue

        feedback_url = _health_feedback_url(
            s.interview_round, s.application_id, s.applicants_name, s.role
        )
        _send_panel_feedback_reminders(
            "Health Interview Schedule",
            s.name,
            interviewer_emails,
            f"{FEEDBACK_REMINDER_SUBJECT} – {s.applicants_name}",
            _health_reminder_body(s, feedback_url),
            feedback_url,
            sender=_outgoing_sender(s.organizer_email),
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
        join_meeting_id = ""
        join_passcode = ""
        # Only a fully Online interview gives the candidate a Teams link — in
        # Hybrid mode the event carries one too, but it's for the online
        # interviewers; the candidate attends in person.
        if (s.interview_type or "").strip().lower() == "online" and s.event_id and s.organizer_email:
            try:
                headers = _graph_headers()
                event_url = (
                    f"https://graph.microsoft.com/v1.0/users/{s.organizer_email}"
                    f"/events/{s.event_id}"
                )
                ev = requests.get(
                    event_url,
                    headers=headers,
                    params={"$select": "id,isOnlineMeeting,onlineMeeting,body"},
                ).json()
                # The invite body (ours) carries Meeting ID / Passcode — no
                # onlineMeetings lookup (it 403s without a Teams application
                # access policy).
                join_url, join_meeting_id, join_passcode = _health_teams_info(
                    s.organizer_email, s.event_id, headers, event_json=ev, poll=False
                )
            except Exception:
                pass

        link = join_url or s.google_map_link or ""
        interview_date_fmt = formatdate(s.interview_date, "dd MMMM yyyy")
        interview_time_fmt = format_time(s.start_time)

        link_html = (
            f"<p>Please join using the link below:<br>"
            f'<a href="{link}" target="_blank">{link}</a></p>'
            if link
            else ""
        )
        meeting_id_html = (
            f'<p style="margin:6px 0;"><strong>Meeting ID:</strong> {join_meeting_id}<br>'
            f'<strong>Passcode:</strong> {join_passcode}</p>'
            if join_url and (join_meeting_id or join_passcode)
            else ""
        )

        reminder_body = f"""
        <p>Hi {s.applicants_name or "there"},</p>
        <p>This is a reminder about your interview for the <strong>{s.role or ''}</strong>
        position scheduled on <strong>{interview_date_fmt}</strong> at
        <strong>{interview_time_fmt}</strong>.</p>
        {link_html}
        {meeting_id_html}
        <p>Looking forward to speaking with you.</p>
        <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
        {_logo_html()}
        """

        try:
            frappe.sendmail(
                recipients=[s.attendees],
                sender=s.organizer_email,
                subject=f"Reminder: Your Interview – Azim Premji Foundation ({interview_date_fmt})",
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
    "applicant_id",
    "applicant_name",
    "application_status",
    "role",
    "department",
    "phone",
    "email_address",
    "email",
}


def _mbbs_feedback_fields_html(fb):
    """One feedback record's own answers as <p> lines — shared by the
    combined PDF below and send_feedback_submitted_email."""
    html = ""
    for f in frappe.get_meta(fb.doctype).fields:
        if f.fieldtype in (
            "Section Break",
            "Column Break",
            "Tab Break",
            "HTML",
            "Attach",
            "Link",
        ):
            continue
        if f.fieldname in _MBBS_FEEDBACK_HEADER_FIELDS:
            continue
        value = fb.get(f.fieldname)
        if not value:
            continue
        html += f"<p><b>{f.label or f.fieldname}:</b> {value}</p>"
    return html


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
            html += _mbbs_feedback_fields_html(fb)
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
    # Built in a background job, so Submit on the web form returns at once
    # instead of waiting for the PDF.
    frappe.enqueue(
        "ms_calendar.api.ms_health._build_mbbs_feedback_pdf_job",
        queue="short",
        enqueue_after_commit=True,
        doctype=doc.doctype,
        docname=doc.name,
        applicant_id=doc.applicant_id,
    )


def _build_mbbs_feedback_pdf_job(doctype, docname, applicant_id):
    try:
        _build_mbbs_feedback_pdf(applicant_id)
        frappe.db.commit()
    except Exception:
        frappe.log_error(
            title="MBBS Feedback PDF Auto-Generate Error",
            message=f"{doctype} {docname} ({applicant_id}): {frappe.get_traceback()}",
        )


# ---------------------------------------------------------------------------
# "Feedback submitted" email — mirrors ms_philanthropy.py's
# send_feedback_submitted_email. Health's feedback forms can't say WHICH
# interviewer submitted (see ROUND_TO_FEEDBACK_DOCTYPE's comment: the panel
# field is free text, "email" is always the shared health.fellowship@
# address), so instead of matching the submitter this picks the interview
# whose round uses this feedback doctype, and lists the panel names the
# form was filed under rather than a "pending from" list.
# ---------------------------------------------------------------------------


def _find_schedule_for_feedback(feedback_doc):
    """The interview this feedback belongs to: the most recent scheduled (not
    cancelled) interview for the applicant whose round's feedback form is
    this doctype — falling back to the applicant's most recent scheduled
    interview."""
    rows = frappe.get_all(
        "Health Interview Schedule",
        filters={
            "application_id": feedback_doc.applicant_id,
            "is_cancelled": 0,
            "event_id": ["is", "set"],
            # An interview scheduled after this feedback can't be its interview.
            "creation": ["<=", feedback_doc.creation or frappe.utils.now_datetime()],
        },
        fields=["name", "interview_round", "role"],
        order_by="interview_date desc, start_time desc, creation desc",
    )
    if not rows:
        return None
    for r in rows:
        round_doctype = ROUND_TO_FEEDBACK_DOCTYPE[
            _health_feedback_round(r.interview_round, r.role)
        ]
        if round_doctype == feedback_doc.doctype:
            return frappe.get_doc("Health Interview Schedule", r.name)
    return frappe.get_doc("Health Interview Schedule", rows[0].name)


def _feedback_panel_names(fb):
    return (fb.get("panelist_name") or fb.get("panal_name") or "").strip()


def send_feedback_submitted_email(doc, method=None):
    """doc_events hook: after_insert of the four Health feedback doctypes
    (ROUND_TO_FEEDBACK_DOCTYPE). after_insert, not on_update like the PDF
    merge above, so editing an already-filed form doesn't email everyone
    again.

    Emails every interviewer of that interview (main + Hybrid group, CC'd to
    the schedule's CC list) the submitted feedback. Each later submission
    for the same interview goes as a reply in the SAME email thread and
    carries every feedback filed for it so far.

    Best-effort: never blocks the feedback submission itself. Sent from a
    background job so Submit doesn't wait for it.
    """
    if not doc.get("applicant_id"):
        return
    frappe.enqueue(
        "ms_calendar.api.ms_health._send_feedback_submitted_email_job",
        queue="short",
        enqueue_after_commit=True,
        doctype=doc.doctype,
        docname=doc.name,
    )


def _send_feedback_submitted_email_job(doctype, docname):
    try:
        _send_feedback_submitted_email(frappe.get_doc(doctype, docname))
        frappe.db.commit()
    except Exception:
        frappe.log_error(
            title="Health Feedback Submitted Email Error",
            message=f"{doctype} {docname}: {frappe.get_traceback()}",
        )


def _send_feedback_submitted_email(feedback_doc):
    from frappe.core.doctype.communication.email import _make as make_communication

    if not feedback_doc.get("applicant_id"):
        return
    schedule = _find_schedule_for_feedback(feedback_doc)
    if not schedule:
        return

    # Panel only — never the candidate (attendees).
    recipients = _field_without_candidate(
        _schedule_interviewer_emails(schedule), schedule.get("attendees")
    )
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

    # All feedback for THIS interview so far — earlier interviews' feedback
    # for the same applicant is excluded by the creation filter.
    feedbacks = [
        frappe.get_doc(feedback_doc.doctype, n)
        for n in frappe.get_all(
            feedback_doc.doctype,
            filters={
                "applicant_id": feedback_doc.applicant_id,
                "creation": [">=", schedule.creation],
            },
            pluck="name",
            order_by="creation asc",
        )
    ]
    if feedback_doc.name not in {f.name for f in feedbacks}:
        feedbacks.append(feedback_doc)

    known = _field_panelist_names(recipients)
    names = {e: known.get(e) or e for e in recipients}
    applicant_name = schedule.applicants_name or feedback_doc.get("applicant_name") or ""
    role = schedule.role or ""
    subject = f"Interview Feedback – {applicant_name}" + (f" ({role})" if role else "")

    root = frappe.db.get_value(
        "Communication",
        {
            "reference_doctype": "Health Interview Schedule",
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
        panel = _feedback_panel_names(f)
        cards += f"""
        <div style="border:1px solid {'#1e3a8a' if is_new else '#e3e3e3'};border-radius:10px;padding:14px;background:#f9fafb;margin-bottom:12px;">
        <p><strong>{f.doctype}</strong>{' <em>(new)</em>' if is_new else ''}</p>
        {f'<p><strong>Panel:</strong> {panel}</p>' if panel else ''}
        <p><strong>Submitted on:</strong> {formatdate(f.creation, 'dd MMMM yyyy')}</p>
        {_mbbs_feedback_fields_html(f)}
        </div>
        """

    new_panel = _feedback_panel_names(feedback_doc)
    body = f"""
    <p>Hi {', '.join(names[e] for e in recipients)},</p>
    <p>{'More interview feedback has' if root else 'Interview feedback has'} been submitted
    for <strong>{applicant_name}</strong>{f' ({role})' if role else ''}{f' by <strong>{new_panel}</strong>' if new_panel else ''}.</p>
    <p><strong>Interview Date:</strong> {formatdate(schedule.interview_date, 'dd MMMM yyyy') if schedule.interview_date else ''}</p>
    {cards}
    <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
    {_logo_html()}
    """

    # Organizer's mailbox if it's set up as an outgoing Email Account, else the
    # default outgoing account — never the session user, which for the
    # public feedback web form is often Guest.
    if schedule.organizer_email and frappe.db.exists(
        "Email Account", {"email_id": schedule.organizer_email, "enable_outgoing": 1}
    ):
        sender = schedule.organizer_email
    else:
        sender = frappe.db.get_value(
            "Email Account", {"default_outgoing": 1, "enable_outgoing": 1}, "email_id"
        )

    make_communication(
        doctype="Health Interview Schedule",
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
