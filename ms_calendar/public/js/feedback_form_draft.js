// Save-as-draft for the Field interview feedback web forms (loaded on every
// website page via hooks.py web_include_js; does nothing except on the
// feedback doctypes below).
//
// - "Save" keeps the answers in THIS browser only (localStorage) — nothing
//   is sent to the server, so no feedback record / Registration Form PDF is
//   created until the panelist clicks Submit.
// - Answers are also auto-saved a moment after every change.
// - Reopening the same link (same applicant + panelist) restores the draft.
// - A successful Submit deletes the draft.
// - ?panelist_email=&panelist_name= in the link (the personal link each
//   panel member is emailed, see ms_field.send_field_panel_feedback_links)
//   fill the panelist fields.
//
// Keep FEEDBACK_DOCTYPES in sync with ms_field.FIELD_FEEDBACK_ROUND_MAP
// (plus Calibration Process, the ARP calibration link in ms_field).
(function () {
	const FEEDBACK_DOCTYPES = [
		"Calibration Process",
		"Recruiter Feedback Form",
		"Recruiter Assessment Form",
		"Feedback Form - Associate Resource Person",
		"Educational Capacity Interview - Feedback Form",
		"School Teacher Feedback Form",
		"Functional Round Feedback Form",
		"Functional Feedback Field Enabler",
		"Technical Round Feedback Form",
		"Demo Lesson Observation Feedback Form",
		"Leader Final Round Feedback Form",
		"Final Round Feedback Form",
		"Final Feedback Field Enabler",
	];
	// Filled from the link / by the form's own script, never from a draft.
	const NEVER_RESTORE = ["applicant_id", "applicant_name", "date_time", "application_status"];
	const PANELIST_EMAIL_FIELDS = ["panelist_email", "panelist__email"];
	const DRAFT_PREFIX = "apf_feedback_draft::";
	const DRAFT_MAX_AGE_DAYS = 30;
	// The cloud web forms' own client scripts set applicant_id/name at 500 ms.
	const RESTORE_DELAY_MS = 900;

	const params = new URLSearchParams(window.location.search);
	let wf = null;
	let draft_key = "";
	let ready = false;
	let autosave_timer = null;

	function storage_get(key) {
		try {
			return JSON.parse(window.localStorage.getItem(key) || "null");
		} catch (e) {
			return null;
		}
	}

	function storage_set(key, value) {
		try {
			window.localStorage.setItem(key, JSON.stringify(value));
			return true;
		} catch (e) {
			return false;
		}
	}

	function storage_remove(key) {
		try {
			window.localStorage.removeItem(key);
		} catch (e) {
			// private window / blocked storage — nothing to clear
		}
	}

	function purge_old_drafts() {
		try {
			const cutoff = Date.now() - DRAFT_MAX_AGE_DAYS * 86400000;
			for (let i = window.localStorage.length - 1; i >= 0; i--) {
				const key = window.localStorage.key(i);
				if (!key || !key.startsWith(DRAFT_PREFIX)) continue;
				const d = storage_get(key);
				if (!d || !d.saved_at || d.saved_at < cutoff) storage_remove(key);
			}
		} catch (e) {
			// ignore
		}
	}

	function skip_fields() {
		const skip = NEVER_RESTORE.slice();
		// Panelist fields that came from the personal link win over a draft.
		if (params.get("panelist_name")) skip.push("panelist_name");
		if (params.get("panelist_email")) skip.push(...PANELIST_EMAIL_FIELDS);
		return skip;
	}

	function is_empty(v) {
		return v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);
	}

	function collect_values() {
		const all = wf.get_values(true) || {};
		const skip = skip_fields();
		const values = {};
		Object.keys(all).forEach((k) => {
			if (skip.includes(k) || is_empty(all[k])) return;
			values[k] = all[k];
		});
		return values;
	}

	function time_label(ts) {
		const d = new Date(ts);
		return d.toLocaleString([], {
			day: "numeric",
			month: "short",
			hour: "numeric",
			minute: "2-digit",
		});
	}

	function set_status(text) {
		$(".apf-draft-status").text(text);
	}

	function save_draft(show_toast) {
		const values = collect_values();
		if (!Object.keys(values).length) {
			if (show_toast) frappe.show_alert({ message: __("Nothing to save yet"), indicator: "orange" });
			return;
		}
		const saved_at = Date.now();
		if (!storage_set(draft_key, { saved_at, values })) {
			if (show_toast) {
				frappe.msgprint(
					__("This browser is blocking saved data (private window?). Please submit the form before closing it.")
				);
			}
			return;
		}
		frappe.form_dirty = false;
		$(".indicator-pill.orange").addClass("hide");
		set_status(__("Draft saved on this device · {0}", [time_label(saved_at)]));
		if (show_toast) {
			frappe.show_alert({
				message: __("Draft saved. Your feedback is sent only when you click Submit."),
				indicator: "green",
			});
		}
	}

	function schedule_autosave() {
		if (!ready) return;
		clearTimeout(autosave_timer);
		autosave_timer = setTimeout(() => save_draft(false), 1500);
	}

	function add_buttons() {
		$(".web-form-footer .submit-btn").each(function () {
			if ($(this).siblings(".apf-save-draft-btn").length) return;
			// v16's default label is also "Save" — the real button must read Submit.
			$(this).text(__("Submit"));
			$(
				`<button type="button" class="apf-save-draft-btn btn btn-default btn-sm ml-2">${__("Save")}</button>`
			)
				.insertBefore(this)
				.on("click", (e) => {
					e.preventDefault();
					save_draft(true);
				});
		});
		$(".web-form-footer .left-area").each(function () {
			if (!$(this).find(".apf-draft-status").length) {
				$(this).append(
					'<span class="apf-draft-status text-muted small" style="align-self:center;margin-left:8px;"></span>'
				);
			}
		});
	}

	function show_restored_note(saved_at) {
		const $note = $(`
			<div class="apf-draft-note" style="border:1px solid var(--border-color,#d1d5db);border-radius:6px;
				padding:10px 14px;margin-bottom:16px;font-size:13px;display:flex;gap:12px;
				align-items:center;justify-content:space-between;flex-wrap:wrap;">
				<span>${__("Your saved draft from {0} has been filled in. Check it and click Submit when you are done.", [
					time_label(saved_at),
				])}</span>
				<a href="#" class="apf-clear-draft">${__("Clear draft")}</a>
			</div>
		`);
		$note.find(".apf-clear-draft").on("click", (e) => {
			e.preventDefault();
			frappe.confirm(__("Remove the saved draft and reload an empty form?"), () => {
				ready = false;
				storage_remove(draft_key);
				window.location.reload();
			});
		});
		$(".web-form-wrapper").first().before($note);
	}

	function fill_from_link() {
		const email = (params.get("panelist_email") || "").trim();
		const name = (params.get("panelist_name") || "").trim();
		const values = {};
		// Most forms' own scripts set these from the link; some (the Enablers
		// Functional/Final forms) have no script, so fill whatever is still empty.
		[
			["applicant_id", params.get("app_id") || params.get("applicant_id")],
			["applicant_name", params.get("applicant_name")],
		].forEach(([f, v]) => {
			if (v && wf.fields_dict[f] && !wf.get_value(f)) values[f] = v.trim();
		});
		if (email) {
			PANELIST_EMAIL_FIELDS.forEach((f) => {
				if (wf.fields_dict[f]) values[f] = email;
			});
		}
		if (name && wf.fields_dict.panelist_name) values.panelist_name = name;
		return wf.set_values(values).then(() => {
			Object.keys(values).forEach((f) => {
				wf.fields_dict[f].df.read_only = 1;
				wf.fields_dict[f].refresh();
			});
		});
	}

	function restore_draft() {
		const d = storage_get(draft_key);
		if (!d || !d.values) return Promise.resolve();
		const skip = skip_fields();
		const values = {};
		Object.keys(d.values).forEach((k) => {
			if (!skip.includes(k) && wf.fields_dict[k]) values[k] = d.values[k];
		});
		if (!Object.keys(values).length) return Promise.resolve();
		return wf.set_values(values).then(() => {
			// The form now matches the saved draft.
			frappe.form_dirty = false;
			$(".indicator-pill.orange").addClass("hide");
			show_restored_note(d.saved_at);
			set_status(__("Draft saved on this device · {0}", [time_label(d.saved_at)]));
		});
	}

	function hook_form() {
		// Every field change goes through make_form_dirty (web_form.js).
		const orig_dirty = wf.make_form_dirty.bind(wf);
		wf.make_form_dirty = function () {
			orig_dirty();
			schedule_autosave();
		};
		// Submit succeeded → the record exists on the server, drop the draft.
		const orig_success = wf.handle_success.bind(wf);
		wf.handle_success = function (data) {
			ready = false;
			clearTimeout(autosave_timer);
			storage_remove(draft_key);
			$(".apf-draft-note").remove();
			return orig_success(data);
		};
		window.addEventListener("beforeunload", () => {
			if (ready && frappe.form_dirty) save_draft(false);
		});
	}

	function init() {
		wf = frappe.web_form;
		const route = wf.route || window.location.pathname.split("/")[1] || "";
		const app_id = params.get("app_id") || params.get("applicant_id") || "";
		const panelist = (params.get("panelist_email") || "").trim().toLowerCase();
		draft_key = `${DRAFT_PREFIX}${route}::${app_id}::${panelist}`;

		purge_old_drafts();
		add_buttons();
		hook_form();

		setTimeout(() => {
			fill_from_link()
				.then(restore_draft)
				.catch((e) => console.error("Feedback draft restore failed", e))
				.then(() => {
					ready = true;
				});
		}, RESTORE_DELAY_MS);
	}

	function wait_for_form(tries) {
		const f = frappe.web_form;
		if (f && f.fields_dict && f.doc_type) {
			// Only a new response on one of the feedback forms — not list/view pages.
			if (FEEDBACK_DOCTYPES.includes(f.doc_type) && f.is_new) init();
			return;
		}
		if (tries > 0) setTimeout(() => wait_for_form(tries - 1), 100);
	}

	frappe.ready(() => {
		if (!document.querySelector(".web-form-wrapper")) return;
		wait_for_form(100);
	});
})();
