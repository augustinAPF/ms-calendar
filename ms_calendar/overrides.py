import frappe


def redirect_to_pathways_dashboard(login_manager):
	"""Send desk users to the Pathways Dashboard on every fresh login.

	frappe.auth.LoginManager.set_user_info() runs after on_session_creation
	and unconditionally resets response["home_page"], so setting it here has
	no effect on where the login page navigates to. Instead this sets a
	one-shot cookie that pathways_redirect.js picks up on the next desk page
	load and force-redirects — that works regardless of which page the
	browser was mid-navigation to (redirect-to param, stale bookmark, etc).
	"""
	if frappe.session.user == "Guest":
		return
	if frappe.session.data.get("user_type") == "Website User":
		return

	frappe.local.cookie_manager.set_cookie("pathways_redirect_pending", "1")
