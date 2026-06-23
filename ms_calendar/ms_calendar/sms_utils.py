import frappe
import requests
from frappe.utils import now_datetime

# Interview round values — SMS/WhatsApp for these fires only from Field Interview Schedule,
# NOT from a registration form status change.
INTERVIEW_ROUND_STATUSES = {
	"Recruiter Round",
	"Round One",
	"Round Two",
	"Round Three",
	"Calibration Process",
}


def send_sms(
	phone,
	status,
	applicant_id=None,
	applicant_name=None,
	full_name_aadhaar=None,
	triggered_from=None,
):
	"""Send an SMS via MSG91 and write a log entry regardless of outcome."""
	if not phone or not status:
		return

	# ── load settings ──────────────────────────────────────────────────────────
	try:
		settings = frappe.get_single("Field SMS Settings")
		auth_key = settings.get_password("auth_key", raise_exception=False)
	except Exception:
		_log_sms(
			applicant_id=applicant_id, applicant_name=applicant_name,
			full_name_aadhaar=full_name_aadhaar, phone=phone,
			status_round=status, sender_id="", template_id="",
			sms_status="Failed", triggered_from=triggered_from or "",
			error_message="Field SMS Settings not found or auth_key missing",
			channel="SMS",
		)
		return

	# ── look up the template row for this status ───────────────────────────────
	matched = next(
		(row for row in (settings.sms_templates or []) if row.status_round == status),
		None,
	)
	sender_id = matched.sender_id if matched else ""
	template_id = matched.template_id if matched else ""

	if not auth_key or not sender_id or not template_id:
		_log_sms(
			applicant_id=applicant_id, applicant_name=applicant_name,
			full_name_aadhaar=full_name_aadhaar, phone=phone,
			status_round=status, sender_id=sender_id, template_id=template_id,
			sms_status="Failed", triggered_from=triggered_from or "",
			error_message=(
				f"No SMS template configured for '{status}'. "
				"Add a row in Field SMS Settings → SMS Templates."
			),
			channel="SMS",
		)
		return

	# ── normalise phone to 91XXXXXXXXXX ───────────────────────────────────────
	digits = "".join(c for c in (phone or "") if c.isdigit())
	if len(digits) == 10:
		mobile = "91" + digits
	elif len(digits) >= 12 and digits.startswith("91"):
		mobile = digits[-12:]
	else:
		mobile = digits

	# ── fire MSG91 Flow API ────────────────────────────────────────────────────
	try:
		resp = requests.post(
			"https://control.msg91.com/api/v5/flow/",
			json={"flow_id": template_id, "sender": sender_id, "mobiles": mobile},
			headers={"authkey": auth_key, "Content-Type": "application/json"},
			timeout=10,
		)
		resp.raise_for_status()
		_log_sms(
			applicant_id=applicant_id, applicant_name=applicant_name,
			full_name_aadhaar=full_name_aadhaar, phone=phone,
			status_round=status, sender_id=sender_id, template_id=template_id,
			sms_status="Sent", triggered_from=triggered_from or "",
			api_response=resp.text,
			channel="SMS",
		)
	except Exception as exc:
		frappe.log_error(frappe.get_traceback(), f"SMS send failed for status '{status}'")
		_log_sms(
			applicant_id=applicant_id, applicant_name=applicant_name,
			full_name_aadhaar=full_name_aadhaar, phone=phone,
			status_round=status, sender_id=sender_id, template_id=template_id,
			sms_status="Failed", triggered_from=triggered_from or "",
			error_message=str(exc),
			channel="SMS",
		)


def send_whatsapp(
	phone,
	status,
	applicant_id=None,
	applicant_name=None,
	full_name_aadhaar=None,
	triggered_from=None,
):
	"""Send a WhatsApp message via MSG91 and write a log entry regardless of outcome."""
	if not phone or not status:
		return

	# ── load settings ──────────────────────────────────────────────────────────
	try:
		settings = frappe.get_single("Field SMS Settings")
		auth_key = settings.get_password("auth_key", raise_exception=False)
	except Exception:
		_log_sms(
			applicant_id=applicant_id, applicant_name=applicant_name,
			full_name_aadhaar=full_name_aadhaar, phone=phone,
			status_round=status, sender_id="", template_id="",
			sms_status="Failed", triggered_from=triggered_from or "",
			error_message="Field SMS Settings not found or auth_key missing",
			channel="WhatsApp",
		)
		return

	# ── look up the WhatsApp template row for this status ─────────────────────
	matched = next(
		(row for row in (settings.whatsapp_templates or []) if row.status_round == status),
		None,
	)
	template_name = matched.template_name if matched else ""
	integrated_number = matched.integrated_number if matched else ""

	if not auth_key or not template_name or not integrated_number:
		_log_sms(
			applicant_id=applicant_id, applicant_name=applicant_name,
			full_name_aadhaar=full_name_aadhaar, phone=phone,
			status_round=status, sender_id=template_name, template_id=integrated_number,
			sms_status="Failed", triggered_from=triggered_from or "",
			error_message=(
				f"No WhatsApp template configured for '{status}'. "
				"Add a row in Field SMS Settings → WhatsApp Templates."
			),
			channel="WhatsApp",
		)
		return

	# ── normalise phone to 91XXXXXXXXXX ───────────────────────────────────────
	digits = "".join(c for c in (phone or "") if c.isdigit())
	if len(digits) == 10:
		mobile = "91" + digits
	elif len(digits) >= 12 and digits.startswith("91"):
		mobile = digits[-12:]
	else:
		mobile = digits

	# ── fire MSG91 WhatsApp API ────────────────────────────────────────────────
	payload = {
		"integrated_number": integrated_number,
		"content_type": "template",
		"payload": {
			"to": mobile,
			"type": "template",
			"template": {
				"name": template_name,
				"language": {"code": "en"},
			},
		},
	}
	try:
		resp = requests.post(
			"https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/",
			json=payload,
			headers={"authkey": auth_key, "Content-Type": "application/json"},
			timeout=10,
		)
		body = resp.text
		if not resp.ok:
			raise Exception(f"HTTP {resp.status_code}: {body}")
		_log_sms(
			applicant_id=applicant_id, applicant_name=applicant_name,
			full_name_aadhaar=full_name_aadhaar, phone=phone,
			status_round=status, sender_id=template_name, template_id=integrated_number,
			sms_status="Sent", triggered_from=triggered_from or "",
			api_response=body,
			channel="WhatsApp",
		)
	except Exception as exc:
		frappe.log_error(frappe.get_traceback(), f"WhatsApp send failed for status '{status}'")
		_log_sms(
			applicant_id=applicant_id, applicant_name=applicant_name,
			full_name_aadhaar=full_name_aadhaar, phone=phone,
			status_round=status, sender_id=template_name, template_id=integrated_number,
			sms_status="Failed", triggered_from=triggered_from or "",
			error_message=str(exc),
			channel="WhatsApp",
		)


def send_registration_form_after_insert(doc, method=None):
	"""doc_events handler: send SMS/WhatsApp when a Field Registration Form is first inserted."""
	status = (doc.get("application_status") or "New Applicant").strip()
	if status in INTERVIEW_ROUND_STATUSES:
		return
	phone = (doc.get("phone_number") or "").strip()
	if not phone:
		return
	_kwargs = dict(
		phone=phone,
		status=status,
		applicant_id=doc.name,
		applicant_name=doc.get("full_name_aadhaar"),
		full_name_aadhaar=doc.get("full_name_aadhaar"),
		triggered_from="Registration Form",
	)
	send_sms(**_kwargs)
	send_whatsapp(**_kwargs)


def send_registration_form_on_update(doc, method=None):
	"""doc_events handler: send SMS/WhatsApp when application_status changes on a Field Registration Form."""
	if not doc.has_value_changed("application_status"):
		return
	status = (doc.get("application_status") or "").strip()
	if not status or status in INTERVIEW_ROUND_STATUSES:
		return
	phone = (doc.get("phone_number") or "").strip()
	if not phone:
		return
	_kwargs = dict(
		phone=phone,
		status=status,
		applicant_id=doc.name,
		applicant_name=doc.get("full_name_aadhaar"),
		full_name_aadhaar=doc.get("full_name_aadhaar"),
		triggered_from="Registration Form",
	)
	send_sms(**_kwargs)
	send_whatsapp(**_kwargs)


def _log_sms(
	applicant_id, applicant_name, full_name_aadhaar, phone,
	status_round, sender_id, template_id,
	sms_status, triggered_from="",
	api_response="", error_message="", channel="SMS",
):
	try:
		frappe.get_doc({
			"doctype": "Field SMS Logs",
			"applicant_id": applicant_id or "",
			"applicant_name": applicant_name or "",
			"full_name_aadhaar": full_name_aadhaar or "",
			"phone": phone or "",
			"status_round": status_round or "",
			"channel": channel,
			"sender_id": sender_id or "",
			"template_id": template_id or "",
			"sms_status": sms_status,
			"triggered_from": triggered_from,
			"sent_at": now_datetime(),
			"api_response": api_response,
			"error_message": error_message,
		}).insert(ignore_permissions=True)
		frappe.db.commit()
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Field SMS Log creation failed")
