// Copyright (c) 2026, Azim Premji Foundation and contributors
// For license information, please see license.txt

// The one interview form for Enablers and Finance Fellowship interviews:
// interviewer free/busy, meeting room, then Send Invite / Reschedule /
// Cancel (ms_calendar.api.ms_enablers, which hands Fellowship interviews to
// ms_finance).
const EIS_ROUND_MODE = { "Round 1": "Online (MS Teams)", "Round 2": "Online (MS Teams)", "Round 3": "In-person" };
const EIS_FELLOWSHIP_ROUND_MODE = { "Round 1": "Online (MS Teams)", "Round 2": "In-person" };

function eis_is_fellowship(frm) {
	return frm.doc.sub_unit === "Finance Fellowship";
}

// Fellowship: Rounds 1-2, Round 2 in person. Enablers: Rounds 1-3.
function eis_apply_flow(frm) {
	const modes = eis_is_fellowship(frm) ? EIS_FELLOWSHIP_ROUND_MODE : EIS_ROUND_MODE;
	frm.set_df_property("interview_round", "options", [""].concat(Object.keys(modes)));
}

frappe.ui.form.on("Enablers Interview Schedule", {
	onload(frm) {
		if (frm.is_new() && !frm.doc.organizer_email) {
			frappe.db.get_single_value("Enablers Settings", "default_organizer_email").then((v) => {
				if (v) frm.set_value("organizer_email", v);
			});
		}
		eis_apply_flow(frm);
		if (frm.is_new() && frm.doc.application_id) eis_fetch_round(frm);
	},

	application_id(frm) {
		eis_fetch_round(frm);
	},

	sub_unit(frm) {
		// Fetched from the applicant — the flow is known only now.
		eis_apply_flow(frm);
	},

	refresh(frm) {
		frm.toggle_display("available_slots_section", false);
		eis_apply_flow(frm);
		// What the invite was last sent with — Save compares against it.
		if (!frm.is_dirty()) frm.__eis_saved_key = eis_invite_key(frm);
		if (frm.is_new()) return;

		const colours = { Draft: "gray", Scheduled: "green", Cancelled: "red", Completed: "blue" };
		frm.page.set_indicator(__(frm.doc.status), colours[frm.doc.status] || "gray");

		// Saving sends the invite (and a changed slot reschedules it), like the
		// other units' interview forms. This button is only the fallback when a
		// send failed (e.g. Outlook was unreachable).
		if (frm.doc.status === "Draft") {
			frm.add_custom_button(__("Send Invite"), () => eis_send(frm, "schedule_interview")).addClass("btn-primary");
		}
		if (frm.doc.status === "Scheduled") {
			frm.add_custom_button(__("Cancel Interview"), () => {
				frappe.prompt(
					{ fieldname: "reason", fieldtype: "Small Text", label: __("Reason for cancelling"), reqd: 1 },
					({ reason }) => frappe.call({
						method: "ms_calendar.api.ms_enablers.cancel_interview",
						args: { name: frm.doc.name, reason },
						freeze: true,
						freeze_message: __("Cancelling the invite…"),
					}).then(() => frm.reload_doc()),
					__("Cancel Interview"),
					__("Cancel Interview")
				);
			});
		}
		if (frm.doc.feedback_link) {
			frm.add_custom_button(__("Copy Feedback Link"), () => frappe.utils.copy_to_clipboard(frm.doc.feedback_link));
		}
	},

	before_save(frm) {
		frm.__eis_changed = eis_invite_key(frm) !== frm.__eis_saved_key;
	},

	after_save(frm) {
		// New / cancelled interview -> send the invite; scheduled one whose
		// date, time, mode, venue, room or interviewers changed -> reschedule.
		if (["Draft", "Cancelled"].includes(frm.doc.status)) {
			eis_send(frm, "schedule_interview");
		} else if (frm.doc.status === "Scheduled" && frm.__eis_changed) {
			eis_send(frm, "reschedule_interview");
		}
	},


	meeting_room(frm) {
		// Typed by hand -> not a booked room any more.
		if (!frm.__eis_room_pick) frm.set_value("room_email", "");
	},

	check_availability(frm) {
		// Hybrid: the online panel's calendars too.
		const emails = (frm.doc.interviewer_email || []).concat(frm.doc.online_panel || []).map((r) => r.interviewer_email);
		if (!emails.length || !frm.doc.interview_date) {
			frappe.msgprint(__("Add the interviewers and the interview date first."));
			return;
		}
		const $w = frm.get_field("available_slots").$wrapper;
		frm.toggle_display("available_slots_section", true);
		$w.html(`<p class="text-muted">${__("Checking the interviewers' calendars…")}</p>`);
		frappe.call({
			method: "ms_calendar.api.msgraph.get_schedule_free_slots",
			args: { interviewer_emails: emails, interview_date: frm.doc.interview_date },
		}).then((r) => {
			$w.html(eis_slots_html(r.message || {}));
			$w.find("[data-start]").on("click", function () {
				frm.set_value("start_time", this.dataset.start);
				frm.set_value("end_time", this.dataset.end);
				frappe.show_alert({ message: __("Time set to {0} – {1}", [this.dataset.label, this.dataset.endLabel]), indicator: "green" });
			});
		}, () => $w.html(`<p class="text-danger">${__("Could not read the calendars.")}</p>`));
	},

	check_available_room(frm) {
		if (!frm.doc.interview_date || !frm.doc.start_time || !frm.doc.end_time) {
			frappe.msgprint(__("Fill the Interview Date, Start Time and End Time first."));
			return;
		}
		frappe.call({
			method: "ms_calendar.api.ms_health.get_org_rooms_and_availability",
			args: { interview_date: frm.doc.interview_date, start_time: frm.doc.start_time, end_time: frm.doc.end_time },
			freeze: true,
			freeze_message: __("Checking meeting rooms…"),
		}).then((r) => {
			const rooms = ((r.message || {}).rooms || []).filter((x) => x.is_available);
			if (!rooms.length) {
				frappe.msgprint(__("No meeting room is free for this slot."));
				return;
			}
			const d = new frappe.ui.Dialog({
				title: __("Free meeting rooms"),
				fields: [{
					fieldname: "room", fieldtype: "Select", label: __("Room"), reqd: 1,
					options: rooms.map((x) => ({ value: x.email, label: `${x.name}${x.capacity ? ` (${x.capacity} seats)` : ""}` })),
				}],
				primary_action_label: __("Use this room"),
				primary_action({ room }) {
					const picked = rooms.find((x) => x.email === room);
					frm.__eis_room_pick = true;
					frm.set_value("meeting_room", picked.name);
					frm.set_value("room_email", picked.email);
					frm.__eis_room_pick = false;
					d.hide();
				},
			});
			d.show();
		});
	},
});

// Interview Round + Mode come from the applicant's status (not picked here).
function eis_fetch_round(frm) {
	if (!frm.doc.application_id) return;
	frappe.call({
		method: "ms_calendar.ms_calendar.doctype.enablers_interview_schedule.enablers_interview_schedule.get_round_for_applicant",
		args: { application_id: frm.doc.application_id },
	}).then((r) => {
		const d = r.message || {};
		if (!d.interview_round) {
			frm.set_value("interview_round", "");
			frappe.msgprint({
				title: __("Not at an interview stage"),
				indicator: "orange",
				message: __("{0} is at <b>{1}</b>. Move the applicant to a shortlisted / selected status first.", [
					frm.doc.application_id, d.status || __("no status"),
				]),
			});
			return;
		}
		frm.set_value("interview_round", d.interview_round);
		if (frm.is_new() || !frm.doc.interview_mode) frm.set_value("interview_mode", d.interview_mode);
	});
}

function eis_send(frm, method) {
	const reschedule = method === "reschedule_interview";
	frappe.call({
		method: `ms_calendar.api.ms_enablers.${method}`,
		args: { name: frm.doc.name },
		freeze: true,
		freeze_message: reschedule ? __("Updating the invite…") : __("Sending the invite…"),
	}).then(() => {
		frappe.show_alert({
			message: reschedule ? __("Invite updated and applicant emailed") : __("Invite sent to the interviewers and the applicant"),
			indicator: "green",
		});
		frm.reload_doc();
	});
}

// Everything the invite carries — a change in any of it reschedules on Save.
function eis_invite_key(frm) {
	const d = frm.doc;
	const emails = (rows) => (rows || []).map((r) => r.interviewer_email).sort().join(",");
	return JSON.stringify([
		d.interview_date, d.start_time, d.end_time, d.interview_mode, d.venue, d.google_map_link,
		d.meeting_room, d.room_email, d.message_to_the_interviewer, d.assignment_round, d.assignment_details,
		emails(d.interviewer_email), emails(d.online_panel), emails(d.interviewers_cc_email),
	]);
}

// Busy intervals per interviewer + the hours when everyone is free (same
// view as the Finance Fellowship form; defined here too so this form works
// without that one having been opened).
function eis_slots_html(busyByEmail) {
	const toHour = (dt) => {
		const m = moment.utc(dt).local();
		return m.hours() + m.minutes() / 60;
	};
	const fmt = (h) => moment().startOf("day").add(h * 60, "minutes").format("h:mm A");
	const hhmm = (h) => moment().startOf("day").add(h * 60, "minutes").format("HH:mm:ss");
	const allBusy = [];
	let rows = "";
	Object.entries(busyByEmail).forEach(([email, intervals]) => {
		const busy = (intervals || []).map((i) => [toHour(i.start.dateTime), toHour(i.end.dateTime)]);
		allBusy.push(...busy);
		const text = busy.length ? busy.map(([s, e]) => `${fmt(s)} – ${fmt(e)}`).join(", ") : __("Free all day");
		rows += `<tr><td>${frappe.utils.escape_html(email)}</td><td>${text}</td></tr>`;
	});
	const free = [];
	for (let h = 9; h + 1 <= 18; h += 0.5) {
		if (!allBusy.some(([s, e]) => s < h + 1 && e > h)) free.push(h);
	}
	const buttons = free.length
		? free.map((h) => `<button class="btn btn-xs btn-default" style="margin:0 6px 6px 0"
			data-start="${hhmm(h)}" data-end="${hhmm(h + 1)}" data-label="${fmt(h)}" data-end-label="${fmt(h + 1)}">
			${fmt(h)} – ${fmt(h + 1)}</button>`).join("")
		: `<span class="text-muted">${__("No common free hour between 9 AM and 6 PM.")}</span>`;
	return `
		<table class="table table-bordered" style="font-size:12px">
			<thead><tr><th>${__("Interviewer")}</th><th>${__("Busy")}</th></tr></thead>
			<tbody>${rows}</tbody>
		</table>
		<p style="margin:8px 0 6px"><b>${__("Everyone free (1 hour) — click to use:")}</b></p>
		<div>${buttons}</div>`;
}
