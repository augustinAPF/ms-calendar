import frappe
from frappe import _
from frappe.utils import getdate
from frappe.www.login import get_context as get_frappe_login_context

no_cache = True


def get_context(context):
	# Reuse Frappe's login context so redirect-after-login, social login, LDAP,
	# login-with-email-link and signup settings keep working on the custom page.
	context = get_frappe_login_context(context)

	context.brand_name = _("Pathways")
	context.brand_org = _("Azim Premji Foundation")
	context.current_year = getdate().year

	# Only use an uploaded logo (Website Settings / Navbar Settings > App Logo).
	# Otherwise the template draws the Pathways mark instead of Frappe's default logo.
	context.brand_logo = frappe.get_website_settings("app_logo") or frappe.db.get_single_value(
		"Navbar Settings", "app_logo"
	)
	return context
