// Finance Fellowship document upload (public, opened from the emailed link
// ?app_id=...&key=...&stage=...). Rendered through Jinja by frappe, so keep
// curly-brace pairs out of this file.
const FFDU_STAGE_FIELDS = {
	"Application Form (after Round 1)": ["application_form"],
	"Documents (after Round 2)": ["pan_card", "aadhaar_card", "education_certificates"],
};
const FFDU_EXPERIENCED = ["work_experience_letters", "payslips"];

// Runs after frappe's own web form setup (registered earlier), so
// frappe.web_form is the live form here. A plain after_load assignment in
// this file would land on the placeholder object frappe replaces.
frappe.ready(() => {
	const params = new URLSearchParams(window.location.search);
	const app_id = params.get("app_id");
	const key = params.get("key");
	const stage = params.get("stage");

	const stop = (msg) => {
		$(".web-form-container").html(`<div class="alert alert-warning" style="margin:24px 0">${msg}</div>`);
	};
	if (!app_id || !key || !FFDU_STAGE_FIELDS[stage]) {
		stop("This page opens from the link in our email. Please use that link.");
		return;
	}

	frappe.call({
		method: "ms_calendar.api.ms_finance.get_upload_context",
		args: { application_id: app_id, key, stage },
		callback: (r) => {
			const ctx = r.message || {};
			frappe.web_form.set_value("application_id", app_id);
			frappe.web_form.set_value("applicant_name", ctx.applicant_name);
			frappe.web_form.set_value("stage", stage);
			frappe.web_form.set_value("access_key", key);

			const required = FFDU_STAGE_FIELDS[stage].concat(
				stage === "Documents (after Round 2)" && ctx.experienced ? FFDU_EXPERIENCED : []
			);
			required.forEach((f) => frappe.web_form.set_df_property(f, "reqd", 1));

			if (ctx.blank_form_link && stage === "Application Form (after Round 1)") {
				const $field = $('[data-fieldname="application_form"]');
				$field.before(
					`<p style="margin-bottom:10px"><a href="${ctx.blank_form_link}" target="_blank">Download the blank Application Form</a>, fill it in, and upload it below.</p>`
				);
			}
		},
		// Website frappe.call never calls `error`; `always` sees every response.
		always: (d) => !(d && "message" in d) && stop("This link is not valid. Please use the link in the email we sent you."),
	});
});
