import frappe
import os, ast, base64, time, re, requests
from datetime import datetime, timedelta
from frappe.utils import get_url
from urllib.parse import quote

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

    # -------- GRAPH AUTH --------
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
    access_token = token.json()["access_token"]

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    # -------- helper: get room displayName --------
    def get_room_display_name(room_email):
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

    # -------- room: resolve to displayName --------
    room_list = [r.strip() for r in (room_emails or "").split(",") if r.strip()]
    meeting_room_names = [get_room_display_name(r) for r in room_list]
    meeting_room = ", ".join(meeting_room_names)

    # -------- CREATE EVENT --------
    create_url = f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events"

    draft_payload = {
        "subject": f"Discussion with {Applicants_name} - ({Applicants_Role})",
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
    attachment_files = []
    if attachment_paths:
        try:
            paths = ast.literal_eval(attachment_paths)
        except:
            paths = []
    else:
        paths = []

    for web_path in paths:
        file_doc = frappe.get_all(
            "File",
            filters={"file_url": web_path},
            fields=["file_url", "file_name", "is_private"],
        )
        if not file_doc:
            continue

        file_doc = file_doc[0]
        file_name = file_doc.file_name
        file_path = frappe.get_site_path(
            "private" if file_doc.is_private else "public", "files", file_name
        )
        if not os.path.isfile(file_path):
            continue

        with open(file_path, "rb") as f:
            fb64 = base64.b64encode(f.read()).decode()

        attachment_files.append((file_name, fb64))

    attach_url = f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events/{event_id}/attachments"
    for fname, fb64 in attachment_files:
        requests.post(
            attach_url,
            headers=headers,
            json={
                "@odata.type": "#microsoft.graph.fileAttachment",
                "name": fname,
                "contentBytes": fb64,
            },
        )

    # -------- LOGO --------
    logo_base64 = ""
    logo_path = frappe.get_site_path("public", "files", "apf email.png")
    if os.path.isfile(logo_path):
        with open(logo_path, "rb") as f:
            logo_base64 = base64.b64encode(f.read()).decode("utf-8")
    logo_html = (
        f'<img src="data:image/png;base64,{logo_base64}" style="height:48px;">'
        if logo_base64
        else ""
    )

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

    Map_location_html = (
        f'<p style="margin:6px 0;"><strong>Venue:</strong> {Location_adress}</p>'
        f'<p style="margin:6px 0;"><strong>Google Map Link:</strong>'
        f'<a href="{Map_location}" target="_blank">Click here</a></p>'
    )
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
    attendees = [
        {"emailAddress": {"address": i}, "type": "required"} for i in interviewer_list
    ] + [{"emailAddress": {"address": i}, "type": "optional"} for i in cc_list]

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
        subject=f"Discussion – Azim Premji Foundation ({interview_date})",
        message=candidate_body,
        delayed=False,
    )

    frappe.msgprint("✅ Event created successfully — Outlook notified automatically.")

    return {
        "event_id": event_id,
        "join_url": join_web_url,
        "meeting_id": join_meeting_id,
        "passcode": join_passcode,
        "is_online": is_online,
    }


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
