// Document upload for Enablers AND Finance Fellowship applicants (public,
// opened from the emailed link). One page, one DocType (Enablers Document
// Collection) since 2026-11-18:
// - Enablers link:           ?app_id=...&key=...
// - Finance Fellowship link: ?app_id=...&key=...&stage=...  (Application Form
//   after Round 1, or Documents after Round 2). The stage switches the form to
//   the Fellowship fields (the sections follow `stage` through depends_on).
// Rendered through Jinja by frappe, so keep curly-brace pairs out of this file.
const EDU_ENABLERS_REQUIRED = ["pan_card", "aadhaar_card", "class_x", "class_xii", "degree"];
const EDU_FELLOWSHIP_STAGE_FIELDS = {
	"Application Form (after Round 1)": ["application_form"],
	"Documents (after Round 2)": ["pan_card", "aadhaar_card", "education_certificates"],
};
// Experience letters / payslips (and the Enablers offer letter) are made
// mandatory by the web form's mandatory_depends_on on is_fresher, which frappe
// re-applies on every refresh — so for Fellowship the script fills the hidden
// is_fresher from the registration instead of setting reqd on them.

// Must run against the live form (frappe.web_form with its fields):
// - as this app's standard web form .js (v16), the file runs BEFORE frappe
//   builds the form, so wait for frappe.ready (frappe's own setup is
//   registered earlier). A plain after_load assignment here would land on
//   the placeholder object frappe replaces.
// - as a Web Form "Client Script" (v15 UAT / prod), frappe runs it inside
//   frappe.init_client_script() while building the form — after the ready
//   events have already fired, so a frappe.ready callback would never run.
function edu_setup_form() {
	const params = new URLSearchParams(window.location.search);
	const app_id = params.get("app_id");
	const key = params.get("key");
	const stage = params.get("stage");
	const fellowship = !!stage;

	const stop = (msg) => {
		$(".web-form-container").html(`<div class="alert alert-warning" style="margin:24px 0">${msg}</div>`);
	};
	if (!app_id || !key || (fellowship && !EDU_FELLOWSHIP_STAGE_FIELDS[stage])) {
		stop("This page opens from the link in our email. Please use that link.");
		return;
	}

	frappe.call({
		method: fellowship
			? "ms_calendar.api.ms_finance.get_upload_context"
			: "ms_calendar.api.ms_enablers.get_upload_context",
		args: fellowship ? { application_id: app_id, key: key, stage: stage } : { application_id: app_id, key: key },
		callback: (r) => {
			const ctx = r.message || {};
			frappe.web_form.set_value("application_id", app_id);
			frappe.web_form.set_value("applicant_name", ctx.applicant_name);
			frappe.web_form.set_value("access_key", key);
			if (ctx.role) frappe.web_form.set_value("role", ctx.role);

			let required = EDU_ENABLERS_REQUIRED;
			if (fellowship) {
				frappe.web_form.set_value("stage", stage);
				frappe.web_form.set_value("is_fresher", ctx.experienced ? 0 : 1);
				required = EDU_FELLOWSHIP_STAGE_FIELDS[stage];
				if (ctx.blank_form_link && stage === "Application Form (after Round 1)") {
					$('[data-fieldname="application_form"]').first().before(
						`<p style="margin-bottom:10px"><a href="${ctx.blank_form_link}" target="_blank">Download the blank Application Form</a>, fill it in, and upload it below.</p>`
					);
				}
			}
			required.forEach((f) => frappe.web_form.set_df_property(f, "reqd", 1));
		},
		// Website frappe.call never calls `error`; `always` sees every response.
		always: (d) => !(d && "message" in d) && stop("This link is not valid. Please use the link in the email we sent you."),
	});
}

if (frappe.web_form && frappe.web_form.fields_dict) {
	edu_setup_form();
} else {
	frappe.ready(edu_setup_form);
}
