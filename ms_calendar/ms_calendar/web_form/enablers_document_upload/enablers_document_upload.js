// Enablers document upload (public, opened from the emailed link
// ?app_id=...&key=...). Rendered through Jinja by frappe, so keep curly-brace
// pairs out of this file.
// Runs after frappe's own web form setup (registered earlier), so
// frappe.web_form is the live form here. A plain after_load assignment in
// this file would land on the placeholder object frappe replaces.
frappe.ready(() => {
	const params = new URLSearchParams(window.location.search);
	const app_id = params.get("app_id");
	const key = params.get("key");
	const stop = (msg) => {
		$(".web-form-container").html(`<div class="alert alert-warning" style="margin:24px 0">${msg}</div>`);
	};
	if (!app_id || !key) {
		stop("This page opens from the link in our email. Please use that link.");
		return;
	}
	frappe.call({
		method: "ms_calendar.api.ms_enablers.get_upload_context",
		args: { application_id: app_id, key },
		callback: (r) => {
			const ctx = r.message || {};
			frappe.web_form.set_value("application_id", app_id);
			frappe.web_form.set_value("applicant_name", ctx.applicant_name);
			frappe.web_form.set_value("role", ctx.role);
			frappe.web_form.set_value("access_key", key);
		},
		// Website frappe.call never calls `error`; `always` sees every response.
		always: (d) => !(d && "message" in d) && stop("This link is not valid. Please use the link in the email we sent you."),
	});
});
