import frappe
import random
import requests
from frappe.utils import now_datetime

_OTP_TTL = 600  # 10 minutes
_OTP_RESEND_COOLDOWN = 60  # seconds between OTP sends to the same email
_OTP_MAX_ATTEMPTS = 3  # failed verify attempts before the OTP is invalidated


def _normalize_mobile(phone):
    digits = "".join(c for c in (phone or "") if c.isdigit())
    if len(digits) == 10:
        return "91" + digits
    if len(digits) == 12 and digits.startswith("91"):
        return digits
    return None


# PHONE OTP DISABLED — not ready yet, commented out for now.
# @frappe.whitelist(allow_guest=True)
# def send_otp(phone):
#     phone = (phone or "").strip()
#     mobile = _normalize_mobile(phone)
#     if not mobile:
#         return {"success": False, "message": "Enter a valid 10-digit phone number."}
#
#     try:
#         settings = frappe.get_single("Field SMS Settings")
#         auth_key = settings.get_password("auth_key", raise_exception=False)
#         otp_template_id = (settings.otp_template_id or "").strip()
#         otp_sender_id = (settings.otp_sender_id or "").strip()
#     except Exception:
#         return {"success": False, "message": "SMS settings not configured."}
#
#     if not auth_key or not otp_template_id or not otp_sender_id:
#         return {"success": False, "message": "OTP settings not configured. Please set OTP Template ID and Sender ID in Field SMS Settings."}
#
#     otp = str(random.randint(100000, 999999))
#     cache_key = f"field_reg_otp_{mobile}"
#     frappe.cache().set_value(cache_key, otp, expires_in_sec=_OTP_TTL)
#
#     try:
#         resp = requests.post(
#             "https://control.msg91.com/api/v5/otp",
#             params={
#                 "template_id": otp_template_id,
#                 "mobile": mobile,
#                 "authkey": auth_key,
#                 "otp": otp,
#                 "sender": otp_sender_id,
#             },
#             timeout=10,
#         )
#         resp.raise_for_status()
#         return {"success": True, "message": "OTP sent to your phone number."}
#     except Exception as exc:
#         frappe.log_error(frappe.get_traceback(), "OTP send failed")
#         frappe.cache().delete_value(cache_key)
#         return {"success": False, "message": f"Failed to send OTP: {exc}"}
#
#
# @frappe.whitelist(allow_guest=True)
# def verify_otp(phone, otp):
#     phone = (phone or "").strip()
#     otp = (otp or "").strip()
#     mobile = _normalize_mobile(phone)
#     if not mobile:
#         return {"success": False, "message": "Invalid phone number."}
#     if not otp:
#         return {"success": False, "message": "Please enter the OTP."}
#
#     cache_key = f"field_reg_otp_{mobile}"
#     stored = frappe.cache().get_value(cache_key)
#
#     if not stored:
#         return {"success": False, "message": "OTP expired or not sent. Please request a new OTP."}
#     if stored != otp:
#         return {"success": False, "message": "Incorrect OTP. Please try again."}
#
#     frappe.cache().delete_value(cache_key)
#     # Store a verified flag so the form submission can trust it
#     frappe.cache().set_value(f"field_reg_otp_verified_{mobile}", "1", expires_in_sec=1800)
#     return {"success": True, "message": "Phone number verified successfully."}


# Which mailbox/label the OTP email is sent from -- keyed by the calling
# web form's doc_type, since enforce_otp_verification (and this cache) is
# now shared across Field and Health Registration Form, but each has its
# own recruiter inbox candidates already expect replies to land in.
_OTP_SENDER_BY_FORM = {
    "Field Registration Form": (
        "field.recruitment@azimpremjifoundation.org",
        "Field Registration Form",
    ),
    "Health Registration Form": (
        "health.jobs@azimpremjifoundation.org",
        "Health Registration Form",
    ),
}
_DEFAULT_OTP_SENDER = _OTP_SENDER_BY_FORM["Field Registration Form"]


@frappe.whitelist(allow_guest=True)
def send_email_otp(email, doctype=None):
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        return {"success": False, "message": "Enter a valid email address."}

    cooldown_key = f"field_reg_email_otp_cooldown_{email}"
    if frappe.cache().get_value(cooldown_key):
        return {
            "success": False,
            "message": "Please wait a moment before requesting another OTP.",
        }

    sender, form_label = _OTP_SENDER_BY_FORM.get(doctype, _DEFAULT_OTP_SENDER)

    otp = str(random.randint(100000, 999999))
    cache_key = f"field_reg_email_otp_{email}"
    frappe.cache().set_value(cache_key, otp, expires_in_sec=_OTP_TTL)
    frappe.cache().delete_value(f"field_reg_email_otp_attempts_{email}")
    frappe.cache().set_value(cooldown_key, "1", expires_in_sec=_OTP_RESEND_COOLDOWN)

    try:
        frappe.sendmail(
            recipients=[email],
            sender=sender,
            subject=f"Your OTP - {form_label}",
            message=(
                '<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#333;">'
                f"<p>Use the OTP below to verify your email address for the {form_label}.</p>"
                '<div style="background:#f4f4f4;border-radius:6px;text-align:center;padding:18px;margin:16px 0;">'
                f'<span style="font-size:32px;font-weight:800;letter-spacing:10px;color:#1e6e66;">{otp}</span>'
                "</div>"
                '<p style="font-size:13px;color:#888;">Valid for 10 minutes. '
                "If you did not request this, you can ignore this email.</p>"
                "</div>"
            ),
            now=True,
        )
        return {"success": True, "message": "OTP sent to your email address."}
    except Exception as exc:
        frappe.log_error(frappe.get_traceback(), "Email OTP send failed")
        frappe.cache().delete_value(cache_key)
        return {"success": False, "message": f"Failed to send OTP: {exc}"}


@frappe.whitelist(allow_guest=True)
def verify_email_otp(email, otp):
    email = (email or "").strip().lower()
    otp = (otp or "").strip()
    if not email or "@" not in email:
        return {"success": False, "message": "Invalid email address."}
    if not otp:
        return {"success": False, "message": "Please enter the OTP."}

    cache_key = f"field_reg_email_otp_{email}"
    attempts_key = f"field_reg_email_otp_attempts_{email}"
    stored = frappe.cache().get_value(cache_key)

    if not stored:
        return {
            "success": False,
            "message": "OTP expired or not sent. Please request a new OTP.",
        }
    if stored != otp:
        attempts = (frappe.cache().get_value(attempts_key) or 0) + 1
        if attempts >= _OTP_MAX_ATTEMPTS:
            frappe.cache().delete_value(cache_key)
            frappe.cache().delete_value(attempts_key)
            return {
                "success": False,
                "message": "Too many incorrect attempts. Please request a new OTP.",
            }
        frappe.cache().set_value(attempts_key, attempts, expires_in_sec=_OTP_TTL)
        return {"success": False, "message": "Incorrect OTP. Please try again."}

    frappe.cache().delete_value(cache_key)
    frappe.cache().delete_value(attempts_key)
    frappe.cache().set_value(
        f"field_reg_email_otp_verified_{email}", "1", expires_in_sec=1800
    )
    return {"success": True, "message": "Email address verified successfully."}


def enforce_otp_verification(doc, method=None):
    """`validate` hook for Field Registration Form and Health Registration Form
    (see hooks.py) -- both share the same email_address/email_verified
    (and phone_number/phone_verified) fieldnames, so this one function
    covers both doctypes as-is.

    Client-side "verified" checkmarks are just UX — a guest could bypass
    them via devtools. This is the real backstop: a new Guest-submitted
    application is rejected unless both phone and email were actually
    confirmed through send_otp/verify_otp and send_email_otp/verify_email_otp,
    which is the only way the cache flags below get set.
    """
    if frappe.session.user != "Guest" or not doc.is_new():
        return

    # PHONE OTP DISABLED — not ready yet, commented out for now.
    # mobile = _normalize_mobile(doc.phone_number)
    # if not mobile or not frappe.cache().get_value(f"field_reg_otp_verified_{mobile}"):
    #     frappe.throw("Please verify your phone number with the OTP before submitting.")

    email = (doc.email_address or "").strip().lower()
    if not email or not frappe.cache().get_value(
        f"field_reg_email_otp_verified_{email}"
    ):
        frappe.throw("Please verify your email address with the OTP before submitting.")

    # doc.phone_verified = 1
    doc.email_verified = 1
