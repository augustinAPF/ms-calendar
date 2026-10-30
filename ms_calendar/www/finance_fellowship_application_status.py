import frappe

from ms_calendar.ms_calendar.doctype.finance_fellowship_settings.finance_fellowship_settings import get_settings

no_cache = True


def get_context(context):
	context.fellowship_name = get_settings().fellowship_name
	context.app_id = (frappe.form_dict.app_id or "").strip()[:20]
	context.no_breadcrumbs = True
	return context
