import frappe

no_cache = True


def get_context(context):
	context.app_id = (frappe.form_dict.app_id or "").strip()[:20]
	context.no_breadcrumbs = True
	return context
