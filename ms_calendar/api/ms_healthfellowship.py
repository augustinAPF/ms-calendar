import ast
import base64
from datetime import datetime
import os
import re
import time
import frappe
import requests


def format_interviewers_names(names_string):
    """
    Format interviewer names:
    - 2 names: Ram & Mercy
    - 3+ names: Ram, Mercy & Maha
    """
    if not names_string:
        return ""
    
    names = [n.strip() for n in names_string.split(",") if n.strip()]
    
    if len(names) == 0:
        return ""
    elif len(names) == 1:
        return names[0]
    elif len(names) == 2:
        return f"{names[0]} & {names[1]}"
    else:
        # 3 or more: comma-separated except last one with &
        return ", ".join(names[:-1]) + f" & {names[-1]}"


def format_date_with_suffix(dt):
    """
    Format date as: 27th Jan 2026
    """
    day = dt.day
    
    # Determine suffix
    if 10 <= day % 100 <= 20:
        suffix = 'th'
    else:
        suffix = {1: 'st', 2: 'nd', 3: 'rd'}.get(day % 10, 'th')
    
    return dt.strftime(f"%d{suffix} %b %Y").lstrip('0')


@frappe.whitelist()
def create_interview_event(
    start_datetime,
    end_datetime,
    interviewer_emails,
    interviewee_email,
    room_emails,
    is_online,
    interview_Round,
    Organizer_email,
    InterviewersName,
    Applicants_name,
    application_id,
    Comments_for_interviewer,
    attachment_paths=None
):

    try:
        is_online = int(is_online)
    except:
        is_online = 0

    Organizer_email = Organizer_email.strip()

    start_dt = datetime.fromisoformat(start_datetime)
    end_dt   = datetime.fromisoformat(end_datetime)

    # Format for interviewer email (old format)
    interview_date = start_dt.strftime("%d/%m/%Y")
    
    # Format for candidate email (new format: 27th Jan 2026)
    candidate_interview_date = format_date_with_suffix(start_dt)
    
    start_time = start_dt.strftime("%I:%M %p")
    end_time   = end_dt.strftime("%I:%M %p")
    mode_label = "Teams Meeting" if is_online == 1 else "In-Person"
    
    # Format interviewer names for both emails
    formatted_interviewers = format_interviewers_names(InterviewersName)

    # -------- GRAPH AUTH --------
    creds = frappe.get_single("MS Graph Credentials")

    token = requests.post(
        f"https://login.microsoftonline.com/{creds.tenant_id}/oauth2/v2.0/token",
        data={
            "grant_type": "client_credentials",
            "client_id": creds.client_id,
            "client_secret": creds.get_password("client_secret"),
            "scope": "https://graph.microsoft.com/.default"
        }
    )
    token.raise_for_status()
    access_token = token.json()["access_token"]

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
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
        "subject": f"Interview - {Applicants_name} – Health Equity Fellowship",
        "isOnlineMeeting": True if is_online == 1 else False,
        "onlineMeetingProvider": "teamsForBusiness" if is_online == 1 else None,
        "showAs": "busy",
        "start": {"dateTime": start_datetime, "timeZone": "Asia/Kolkata"},
        "end": {"dateTime": end_datetime, "timeZone": "Asia/Kolkata"},
        "location": {"displayName": meeting_room} if meeting_room else None,
        "locations": [
            {"displayName": meeting_room, "locationType": "conferenceRoom"}
        ] if meeting_room else [],
        "body": {"contentType": "HTML", "content": "<p>Interview scheduled.</p>"}
    }

    res = requests.post(create_url, headers=headers, json=draft_payload)
    res.raise_for_status()
    event = res.json()
    event_id = event["id"]

    event_url = f"https://graph.microsoft.com/v1.0/users/{Organizer_email}/events/{event_id}"

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
                join_passcode   = m.get("passcode", "") or join_passcode

    meeting_html = (
        f"""
        <p><b>Join Teams Meeting:</b>
        <a href="{join_web_url}" target="_blank">Join Now</a></p>
        <p><b>Meeting ID:</b> {join_meeting_id}<br>
        <b>Passcode:</b> {join_passcode}</p>
        """
        if is_online == 1 and join_web_url else ""
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
            fields=["file_url", "file_name", "is_private"]
        )
        if not file_doc:
            continue

        file_doc = file_doc[0]
        file_name = file_doc.file_name
        file_path = frappe.get_site_path(
            "private" if file_doc.is_private else "public",
            "files",
            file_name
        )
        if not os.path.isfile(file_path):
            # `is_private` can be stale vs. where the bytes actually live
            # (bulk imports / reused "library file" attachments) — check the
            # other folder before dropping the attachment silently.
            alt_path = frappe.get_site_path(
                "public" if file_doc.is_private else "private",
                "files",
                file_name
            )
            if os.path.isfile(alt_path):
                file_path = alt_path
            else:
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
                "contentBytes": fb64
            }
        )

    # -------- LOGO --------
    file_path = frappe.get_site_path("public", "files", "apf email.png")
    with open(file_path, "rb") as f:
        logo_base64 = base64.b64encode(f.read()).decode("utf-8")

    # ---- EMAIL BODY PARTS ----
    feedback_url1= (
        f"https://careers.frappe.cloud/health-feedback-form-one/new"
        f"?app_id={application_id}&applicant_name={Applicants_name}"
    )
    feedback_url2= (
        f"https://careers.frappe.cloud/health-feedback-form-two/new"
        f"?app_id={application_id}&applicant_name={Applicants_name}"
    )
    # -------- FEEDBACK URL BASED ON ROUND --------
    if interview_Round == "Shortlist - CV":
        feedback_url = feedback_url1
    elif interview_Round == "Shortlist - R1":
        feedback_url = feedback_url2
    else:
        feedback_url =""

    meeting_room_html = (
        f'<p style="margin:6px 0;"><strong>Meeting room:</strong> {meeting_room}</p>'
        if meeting_room else ""
    )

    note_html = (
        f'<p><strong>For your information:</strong> {Comments_for_interviewer}</p>'
        if Comments_for_interviewer else ""
    )

    interviewer_body = f"""
    <p>Hi {formatted_interviewers},</p>
    <p>Kindly find the details of the interview scheduled:</p>
    <div style="border:1px solid #e3e3e3;border-radius:10px;padding:14px;background:#f9fafb;">
    <p><strong>Applicant name:</strong> {Applicants_name}</p>
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
    <img src="data:image/png;base64,{logo_base64}" style="height:48px;">
    """

    candidate_body = f"""
    <p>Hi {Applicants_name},</p>
    <p>Thank you for your interest in the Health Equity Fellowship. Your interview has been scheduled with {formatted_interviewers}.</p>
    <p>Kindly find the details of the interview scheduled:</p>
    <div style="border:1px solid #e3e3e3;border-radius:10px;padding:14px;background:#f9fafb;">
    <p><strong>Date:</strong> {candidate_interview_date}</p>
    <p><strong>Time:</strong> {start_time} – {end_time}</p>
    <p><strong>Mode:</strong> {mode_label}</p>
    </div>
    {meeting_html}

    <p>Kindly reach out to us if you have any questions.</p>

    <p>Regards,<br>People Function<br>Azim Premji Foundation</p>
    <img src="data:image/png;base64,{logo_base64}" style="height:48px;">
    """

    interviewer_list = [i.strip() for i in (interviewer_emails or "").split(",") if i.strip()]
    attendees = [{"emailAddress": {"address": i}, "type": "required"} for i in interviewer_list]

    requests.patch(
        event_url,
        headers=headers,
        json={
            "attendees": attendees,
            "body": {"contentType": "HTML", "content": interviewer_body},
            "showAs": "busy"
        }
    )

    frappe.sendmail(
        recipients=[interviewee_email],
        sender=Organizer_email,
        subject=f"Interview - Health Equity Fellowship",
        message=candidate_body,
        delayed=False
    )

    frappe.msgprint("✅ Event created successfully — Outlook notified automatically.")

    return {
        "event_id": event_id,
        "join_url": join_web_url,
        "meeting_id": join_meeting_id,
        "passcode": join_passcode,
        "is_online": is_online
    }