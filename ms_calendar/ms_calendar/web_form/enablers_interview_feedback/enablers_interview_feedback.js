// Enablers interview feedback (public, opened from the interview invite:
// ?schedule=EIS-...). Rendered through Jinja by frappe, so keep curly-brace
// pairs out of this file.
// Runs after frappe's own web form setup (registered earlier), so
// frappe.web_form is the live form here. A plain after_load assignment in
// this file would land on the placeholder object frappe replaces.
frappe.ready(() => {
	const schedule = new URLSearchParams(window.location.search).get("schedule");
	const stop = (msg) => {
		$(".web-form-container").html(`<div class="alert alert-warning" style="margin:24px 0">${msg}</div>`);
	};
	if (!schedule) {
		stop("Please open the feedback form from the link in your interview invite.");
		return;
	}
	frappe.call({
		method: "ms_calendar.api.ms_enablers.get_feedback_context",
		args: { schedule },
		callback: (r) => {
			const ctx = r.message || {};
			frappe.web_form.set_value("interview_schedule", schedule);
			frappe.web_form.set_value("application_id", ctx.application_id);
			frappe.web_form.set_value("applicant_name", ctx.applicant_name);
			frappe.web_form.set_value("role", ctx.role);
			frappe.web_form.set_value("interview_round", ctx.interview_round);
			if (ctx.interview_date) frappe.web_form.set_value("interview_date", ctx.interview_date);
		},
		// Website frappe.call never calls `error`; `always` sees every response.
		always: (d) => !(d && "message" in d) && stop("This feedback link is not valid."),
	});
});
