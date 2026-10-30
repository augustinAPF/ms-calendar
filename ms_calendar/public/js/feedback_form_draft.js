// Save-as-draft for the Field, Health and Scholarship interview feedback web
// forms (loaded on every website page via hooks.py web_include_js; does
// nothing except on the feedback doctypes below).
//
// - "Save" keeps the answers in THIS browser only (localStorage) — nothing
//   is sent to the server, so no feedback record / Registration Form PDF is
//   created until the panelist clicks Submit.
// - Answers are also auto-saved a moment after every change.
// - Reopening the same link (same applicant + panelist) restores the draft.
// - A successful Submit deletes the draft.
// - The interview invite has ONE link for the whole panel
//   (ms_field._field_panel_feedback_block). With several panel members it
//   carries ?panel= and the form first asks "Who is filling this feedback?";
//   a click fills that member's name and email and loads their own draft.
//   With one member, or a personal ?panelist_email=&panelist_name= link
//   (the reminder emails), the panelist fields are filled straight away.
//
// Keep FEEDBACK_DOCTYPES in sync with ms_field.FIELD_FEEDBACK_ROUND_MAP
// (plus Calibration Process, the ARP calibration link in ms_field),
// ms_health.ROUND_TO_FEEDBACK_DOCTYPE, msgraph.SCHOLARSHIP_FEEDBACK_DOCTYPES
// and Philanthrophy Feedback Form.
(function () {
	const FEEDBACK_DOCTYPES = [
		// Health (ms_health.ROUND_TO_FEEDBACK_DOCTYPE)
		"Health Feedback Form one",
		"Health FeedBack Form Two",
		"Health Feedback Form Three",
		"Health Center Visit Form",
		// Philanthropy (ms_philanthropy._phil_feedback_url)
		"Philanthrophy Feedback Form",
		// Enablers + Finance Fellowship (enablers_panel.panel_feedback_link;
		// their links carry ?schedule= instead of ?app_id=)
		"Enablers Feedback Form",
		"Finance Fellowship Feedback Form",
		// Scholarship (msgraph.SCHOLARSHIP_FEEDBACK_DOCTYPES; two spaces in "Feedback  Form Two")
		"Feedback Form One",
		"Feedback  Form Two",
		// Field
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
	const NEVER_RESTORE = ["applicant_id", "applicant_name", "date_time", "application_status", "department", "role",
		// Enablers / Finance Fellowship forms fill these from the schedule.
		"application_id", "interview_schedule", "interview_round", "interview_date", "sub_unit"];
	// The panelist's name / email field, named differently per form
	// (Health: panal_name / panelist_name; Scholarship: interviewer_name).
	const PANELIST_NAME_FIELDS = ["panelist_name", "panal_name", "interviewer_name"];
	const PANELIST_EMAIL_FIELDS = ["panelist_email", "panelist__email", "interviewer_email"];
	const DRAFT_PREFIX = "apf_feedback_draft::";
	const DRAFT_MAX_AGE_DAYS = 30;
	// The cloud web forms' own client scripts set applicant_id/name at 500 ms.
	const RESTORE_DELAY_MS = 900;

	const params = new URLSearchParams(window.location.search);
	let wf = null;
	let draft_key = "";
	let ready = false;
	let autosave_timer = null;
	// Panel member picked on the form (one link for the whole panel, see
	// panel_list); a personal link's panelist_email/name win over it.
	let chosen = null;
	// The buttons on the "Who is filling this feedback?" card.
	let pick_choices = [];

	// ?panel= (ms_field._field_panel_feedback_block): base64url JSON
	// [[email, name], …] of the interview's panel members.
	function panel_list() {
		try {
			const raw = (params.get("panel") || "").replace(/-/g, "+").replace(/_/g, "/");
			if (!raw) return [];
			const bin = atob(raw + "===".slice((raw.length + 3) % 4));
			const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
			return (JSON.parse(json) || [])
				.filter((p) => Array.isArray(p) && p[0])
				.map(([email, name]) => ({ email: String(email).trim(), name: String(name || "").trim() }));
		} catch (e) {
			return [];
		}
	}

	// Who / what the feedback is about: the applicant (app_id) or, on the
	// Enablers / Finance Fellowship forms, the interview (schedule).
	function link_id() {
		return params.get("app_id") || params.get("applicant_id") || params.get("schedule") || "";
	}

	function panelist() {
		const email = (params.get("panelist_email") || "").trim();
		if (email) return { email, name: (params.get("panelist_name") || "").trim() };
		return chosen || { email: "", name: "" };
	}

	function picking() {
		return !!$(".apf-panel-pick").length;
	}

	// The form's Individual / Consolidated select — named differently per form.
	function type_field() {
		return ["interview_type", "interview_feedback_type", "select_the_interview_type"].find((f) => {
			const field = wf && wf.fields_dict[f];
			return field && /(^|\n)Consolidated(\n|$)/.test(field.df.options || "");
		});
	}

	// One feedback for the whole panel: every member's name, and every email
	// that fits the 140-character field.
	function consolidated(panel) {
		const emails = [];
		panel.forEach((p) => {
			if ([...emails, p.email].join(", ").length <= 140) emails.push(p.email);
		});
		return {
			consolidated: true,
			email: emails.join(", "),
			name: panel.map((p) => p.name || p.email).join(", ").slice(0, 140),
			label: __("Consolidated (whole panel)"),
		};
	}

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
		// Panelist fields from the link / the picked name win over a draft.
		const p = panelist();
		if (p.name) skip.push(...PANELIST_NAME_FIELDS);
		if (p.email) skip.push(...PANELIST_EMAIL_FIELDS);
		if (chosen && type_field()) skip.push(type_field());
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
		if (picking()) {
			if (show_toast) ask_to_pick();
			return;
		}
		const values = collect_values();
		if (!Object.keys(values).length) {
			if (show_toast) frappe.show_alert({ message: __("Nothing to save yet"), indicator: "orange" });
			return;
		}
		const saved_at = Date.now();
		// url / applicant: to offer "Continue" when the form is opened without the applicant in the link.
		const applicant = wf.get_value("applicant_name") || params.get("applicant_name") || "";
		const by = panelist();
		if (!storage_set(draft_key, { saved_at, values, url: window.location.href, applicant, by })) {
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
			// Clicks are handled in on_click_capture.
			$(
				`<button type="button" class="apf-save-draft-btn btn btn-default btn-sm ml-2">${__("Save")}</button>`
			).insertBefore(this);
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

	// "Who is filling this feedback?" — one button per panel member, above the
	// form. A click fills that member's name and email (locked) and loads
	// their own draft; "Not you?" reopens the choice.
	function show_panel_picker(panel) {
		const esc = (v) => frappe.utils.escape_html(v || "");
		// Each member (Individual feedback) + Consolidated, when the form has
		// that feedback type: one feedback on behalf of the whole panel.
		const choices = panel.slice();
		if (type_field()) choices.push(consolidated(panel));
		pick_choices = choices;
		const $pick = $(`
			<div class="apf-panel-pick" style="border:1px solid var(--border-color,#d1d5db);border-left:4px solid #1d4ed8;
				border-radius:6px;padding:12px 14px;margin-bottom:16px;">
				<div style="font-weight:600;margin-bottom:8px;">${__("Who is filling this feedback?")}</div>
				<div style="display:flex;flex-wrap:wrap;gap:8px;">
					${choices.map((p, i) => `<button type="button" class="btn btn-sm apf-pick ${p.consolidated ? "btn-primary" : "btn-default"}"
						data-i="${i}" title="${esc(p.consolidated ? p.name : p.email)}">${esc(p.label || p.name || p.email)}</button>`).join("")}
				</div>
				<div class="text-muted small" style="margin-top:8px;">
					${__("Your name and email are filled in, and your saved draft (if any) is loaded.")}
					${type_field() ? __("Consolidated is one feedback for the whole panel.") : ""}</div>
			</div>`);
		// Clicks are handled in on_click_capture → pick().
		$(".web-form-wrapper").first().before($pick);
	}

	function pick(i) {
		const esc = (v) => frappe.utils.escape_html(v || "");
		chosen = pick_choices[i];
		if (!chosen) return;
		$(".apf-panel-pick").remove();
		start_filling();
		const who = chosen.consolidated ? `${chosen.label} — ${chosen.name}` : chosen.name || chosen.email;
		const $who = $(`<div class="apf-panel-who text-muted small" style="margin-bottom:12px;">
			${__("Filling as {0}", [`<b>${esc(who)}</b>`])} ·
			<a href="#" class="apf-not-me">${__("Change")}</a></div>`);
		// Your answers so far are kept as your draft; the page reopens the choice.
		$who.find(".apf-not-me").on("click", (ev) => {
			ev.preventDefault();
			window.location.reload();
		});
		$(".web-form-wrapper").first().before($who);
	}

	// Our buttons are handled here, in the window's capture phase, before any
	// other click listener sees them. The Health web forms on the live site
	// have their own "Saving your feedback…" guard (a document capture
	// listener) that treats any Save / Submit / primary button as Submit and
	// shows its popup — so Save and the name buttons stop here, and so does
	// a Submit while no panel member has been picked.
	function on_click_capture(e) {
		const el = e.target && e.target.closest && e.target.closest(
			".apf-save-draft-btn, .apf-pick, .web-form-footer .submit-btn"
		);
		if (!el) return;
		if (el.classList.contains("submit-btn")) {
			if (!picking()) return; // a real Submit — let it through
			ask_to_pick();
		} else if (el.classList.contains("apf-pick")) {
			pick(+el.getAttribute("data-i"));
		} else {
			save_draft(true);
		}
		e.preventDefault();
		e.stopPropagation();
	}

	function ask_to_pick() {
		const $pick = $(".apf-panel-pick");
		if ($pick.length) $pick[0].scrollIntoView({ behavior: "smooth", block: "center" });
		frappe.show_alert({ message: __("First click your name under 'Who is filling this feedback?'"), indicator: "orange" });
	}

	function make_key() {
		const route = wf.route || window.location.pathname.split("/")[1] || "";
		const app_id = link_id();
		const who = chosen && chosen.consolidated ? "consolidated" : panelist().email.toLowerCase();
		return `${DRAFT_PREFIX}${route}::${app_id}::${who}`;
	}

	function start_filling() {
		draft_key = make_key();
		return fill_from_link()
			.then(restore_draft)
			.catch((e) => console.error("Feedback draft restore failed", e))
			.then(() => {
				// Filled from the link / draft, not typed: only the panelist's own
				// edits make the form dirty (and get saved on leaving the page).
				frappe.form_dirty = false;
				$(".indicator-pill.orange").addClass("hide");
				ready = true;
			});
	}

	function fill_from_link() {
		const { email, name } = panelist();
		const values = {};
		// Most forms' own scripts set these from the link; some (the Enablers
		// Functional/Final forms) have no script, and the Philanthropy form's
		// leaves Role out, so fill whatever is still empty.
		[
			["applicant_id", params.get("app_id") || params.get("applicant_id")],
			["applicant_name", params.get("applicant_name")],
			["role", params.get("role")],
		].forEach(([f, v]) => {
			if (v && wf.fields_dict[f] && !wf.get_value(f)) values[f] = v.trim();
		});
		if (email) {
			PANELIST_EMAIL_FIELDS.forEach((f) => {
				if (wf.fields_dict[f]) values[f] = email;
			});
		}
		if (name) {
			PANELIST_NAME_FIELDS.forEach((f) => {
				if (wf.fields_dict[f]) values[f] = name;
			});
		}
		// Picked on the form: the feedback type follows the choice.
		const tf = type_field();
		if (chosen && tf) values[tf] = chosen.consolidated ? "Consolidated" : "Individual";
		return wf.set_values(values).then(() => {
			Object.keys(values).forEach((f) => {
				wf.fields_dict[f].df.read_only = 1;
				wf.fields_dict[f].refresh();
			});
		});
	}

	// Drafts saved on this device for this form: [{key, app_id, who, d}], newest first.
	function saved_drafts() {
		const route = wf.route || window.location.pathname.split("/")[1] || "";
		const out = [];
		try {
			for (let i = 0; i < window.localStorage.length; i++) {
				const key = window.localStorage.key(i);
				if (!key || !key.startsWith(`${DRAFT_PREFIX}${route}::`)) continue;
				const d = storage_get(key);
				const [, , app_id, ...who] = key.split("::");
				if (d && d.values) out.push({ key, app_id, who: who.join("::"), d });
			}
		} catch (e) {
			// blocked storage — no drafts
		}
		return out.sort((a, b) => (b.d.saved_at || 0) - (a.d.saved_at || 0));
	}

	// The draft to load: the one saved from this exact link, else the newest
	// one for the same applicant saved from another link (the invite's link vs
	// a personal / reminder link) — but never another panel member's own draft.
	function find_draft() {
		const exact = storage_get(draft_key);
		if (exact && exact.values) return { key: draft_key, d: exact };
		const app_id = link_id();
		if (!app_id) return null;
		const me = draft_key.split("::").slice(3).join("::");
		return saved_drafts().find((c) => c.app_id === app_id && (!me || !c.who || c.who === me)) || null;
	}

	// Opened without an applicant in the link (e.g. from history): point to
	// the saved drafts instead of starting blank.
	function offer_saved_drafts() {
		const drafts = saved_drafts().filter((c) => c.d.url && c.app_id);
		if (!drafts.length) return;
		const esc = (v) => frappe.utils.escape_html(v || "");
		const $note = $(`<div class="apf-draft-note" style="border:1px solid var(--border-color,#d1d5db);border-left:4px solid #1d4ed8;
			border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:13px;">
			<div style="font-weight:600;margin-bottom:6px;">${__("You have a saved draft on this device")}</div>
			${drafts.slice(0, 5).map((c) => `<div style="margin:4px 0;">${esc(c.d.applicant || c.app_id)} (${esc(c.app_id)}) ·
				${esc(time_label(c.d.saved_at))} · <a href="${esc(c.d.url)}">${__("Continue")}</a></div>`).join("")}
		</div>`);
		$(".web-form-wrapper").first().before($note);
	}

	function restore_draft() {
		const found = find_draft();
		if (!found) return Promise.resolve();
		const d = found.d;
		// From another link: keep it under this link's key from now on.
		if (found.key !== draft_key && storage_set(draft_key, d)) storage_remove(found.key);
		const skip = skip_fields();
		const values = {};
		Object.keys(d.values).forEach((k) => {
			if (!skip.includes(k) && wf.fields_dict[k]) values[k] = d.values[k];
		});
		// Saved from a personal link, reopened from one without the panelist:
		// the panelist comes back too.
		const by = d.by || {};
		if (!panelist().email && by.email) {
			PANELIST_EMAIL_FIELDS.forEach((f) => {
				if (wf.fields_dict[f] && !values[f]) values[f] = by.email;
			});
			PANELIST_NAME_FIELDS.forEach((f) => {
				if (by.name && wf.fields_dict[f] && !values[f]) values[f] = by.name;
			});
		}
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
		// No Submit before the panel member is known (one link for the panel).
		const orig_save = wf.save.bind(wf);
		wf.save = function () {
			if (picking()) {
				ask_to_pick();
				return false;
			}
			return orig_save.apply(this, arguments);
		};
	}

	function init() {
		wf = frappe.web_form;
		draft_key = make_key();

		purge_old_drafts();
		window.addEventListener("click", on_click_capture, true);
		add_buttons();
		hook_form();

		// One link for the whole panel: one member → filled in straight away,
		// several → they pick their name first (start_filling runs on the click).
		if (!link_id()) offer_saved_drafts();
		const panel = params.get("panelist_email") ? [] : panel_list();
		if (panel.length === 1) chosen = panel[0];
		if (panel.length > 1) {
			show_panel_picker(panel);
			return;
		}
		setTimeout(start_filling, RESTORE_DELAY_MS);
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
