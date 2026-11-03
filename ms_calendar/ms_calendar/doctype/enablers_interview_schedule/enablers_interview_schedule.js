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
		// Typed by hand -> not a booked room any more. (Compared with the room
		// picked in the dialog: this handler runs after set_value has
		// returned, so a "picking now" flag would already be cleared.)
		if (frm.doc.meeting_room !== frm.__eis_picked_room) frm.set_value("room_email", "");
	},

	// Same view as the Field / Health / Philanthropy interview forms: one
	// 8 AM – 6 PM busy/free timeline per interviewer, then the hours when
	// everyone is free (click one to fill Start / End Time).
	check_availability(frm) {
		// Hybrid: the online panel's calendars too.
		const emails = [...new Set((frm.doc.interviewer_email || []).concat(frm.doc.online_panel || [])
			.map((r) => r.interviewer_email).filter(Boolean))];
		if (!emails.length || !frm.doc.interview_date) {
			frappe.msgprint({
				title: __("Missing Information"),
				indicator: "red",
				message: __("Please enter at least one interviewer email and the interview date."),
			});
			return;
		}
		const $w = frm.get_field("available_slots").$wrapper;
		frm.toggle_display("available_slots_section", true);
		$w.html(`
			<div class="text-center p-5">
				<div class="spinner-border text-primary mb-3" style="width:3rem;height:3rem;" role="status"></div>
				<p class="text-muted">${__("Checking availability…")}</p>
			</div>`);
		frappe.call({
			method: "ms_calendar.api.msgraph.get_schedule_free_slots",
			args: { interviewer_emails: emails, interview_date: frm.doc.interview_date },
			callback(r) {
				if (!r.message) {
					$w.html(`<div class="alert alert-danger">${__("An error occurred while fetching availability.")}</div>`);
					return;
				}
				const all_events = [];
				const past_until = eis_past_until(frm.doc.interview_date);
				let html = "";
				Object.keys(r.message).forEach((email) => {
					const events = (r.message[email] || []).map(eis_busy_event);
					all_events.push(...events);
					html += eis_schedule_html(frm, events, email, past_until);
				});
				$w.html(html + eis_common_free_html(all_events, past_until));
				$w.find(".eis-free-pick").on("click", function () {
					frm.set_value("start_time", this.dataset.start);
					frm.set_value("end_time", this.dataset.end);
					frappe.show_alert({ message: __("Time set to {0} – {1}", [this.dataset.label, this.dataset.endLabel]), indicator: "green" });
				});
			},
			error(err) {
				$w.html(`<div class="alert alert-danger">${__("Failed to fetch schedule. Please try again.")}</div>`);
				console.error("Schedule Fetch Error:", err);
			},
		});
	},

	// Same room picker as the Health interview form: every room as a card
	// (free ones green, busy ones only with "Show busy rooms too"), search box,
	// one room picked — the invite books that room's calendar.
	check_available_room(frm) {
		if (!frm.doc.interview_date || !frm.doc.start_time || !frm.doc.end_time) {
			frappe.msgprint(__("Please fill Interview Date, Start Time, and End Time."));
			return;
		}
		const start = moment(`${frm.doc.interview_date} ${frm.doc.start_time}`);
		const end = moment(`${frm.doc.interview_date} ${frm.doc.end_time}`);
		if (end.isSameOrBefore(start)) {
			frappe.msgprint(__("End Time must be greater than Start Time."));
			return;
		}
		frappe.call({
			method: "ms_calendar.api.ms_health.get_org_rooms_and_availability",
			args: { interview_date: frm.doc.interview_date, start_time: frm.doc.start_time, end_time: frm.doc.end_time },
			freeze: true,
			freeze_message: `
				<div class="text-center">
					<div class="spinner-border text-primary mb-2" style="width:2rem;height:2rem;" role="status"></div>
					<div>${__("Fetching available rooms…")}</div>
				</div>`,
			callback(r) {
				const rooms = (r.message || {}).rooms;
				if (!rooms) {
					frappe.msgprint(__("Failed to fetch room availability. Please try again."));
					return;
				}
				if (!rooms.length) {
					frappe.msgprint(__("No rooms were returned from the calendar. Please try again."));
					return;
				}
				eis_room_dialog(frm, rooms, start, end);
			},
			error(err) {
				frappe.msgprint(__("Failed to fetch room availability. Please try again."));
				console.error("Room Availability Error:", err);
			},
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

// ---------------------------------------------------------------- availability timeline
// Ported from health_interview_schedule.js / field_interview_schedule.js
// (generate_schedule_html, calculate_free_slots) so all units' interview
// forms show interviewer availability the same way.
const EIS_DAY_START = 8;
const EIS_DAY_END = 18;

function eis_busy_event(interval) {
	const start = moment.utc(interval.start.dateTime).local();
	const end = moment.utc(interval.end.dateTime).local();
	return {
		startHour: start.hours() + start.minutes() / 60,
		endHour: end.hours() + end.minutes() / 60,
		displayStartTime: start.format("h:mm A"),
		displayEndTime: end.format("h:mm A"),
	};
}

function eis_calculate_free_slots(events, day_start_hour, day_end_hour) {
	const slots = [];
	let current = day_start_hour;
	events
		.filter((e) => e.endHour > day_start_hour && e.startHour < day_end_hour)
		.sort((a, b) => a.startHour - b.startHour)
		.forEach((e) => {
			const start = Math.max(e.startHour, day_start_hour);
			if (current < start) slots.push({ start: current, end: start });
			current = Math.max(current, e.endHour);
		});
	if (current < day_end_hour) slots.push({ start: current, end: day_end_hour });
	return slots;
}

const eis_hour_label = (h) => moment().startOf("day").add(Math.round(h * 60), "minutes").format("h:mm A");

// Hour of the interview day up to which time has already passed: 0 for a
// future date, "now" for today, 24 for a past date. Nothing before it is
// offered as free.
function eis_past_until(interview_date) {
	const day = moment(interview_date, "YYYY-MM-DD");
	const today = moment().startOf("day");
	if (day.isBefore(today)) return 24;
	if (day.isAfter(today)) return 0;
	const now = moment();
	return now.hours() + now.minutes() / 60;
}

function eis_schedule_html(frm, events, email, past_until = 0) {
	const total = EIS_DAY_END - EIS_DAY_START;
	const SLOT_WIDTH_PX = 80;
	let labels = "";
	for (let i = EIS_DAY_START; i < EIS_DAY_END; i++) {
		const hour = i % 12 === 0 ? 12 : i % 12;
		labels += `
			<div class="eis-time-slot-group" style="width:${SLOT_WIDTH_PX * 2}px;">
				<div class="eis-time-slot-hour">
					<div class="eis-hour-label major">${hour}:00 ${i < 12 ? "AM" : "PM"}</div>
					<div class="eis-hour-line major"></div>
				</div>
				<div class="eis-time-slot-half">
					<div class="eis-hour-label minor">${hour}:30</div>
					<div class="eis-hour-line minor"></div>
				</div>
			</div>`;
	}
	const last = EIS_DAY_END % 12 === 0 ? 12 : EIS_DAY_END % 12;
	labels += `<div class="eis-time-slot-final" style="width:${SLOT_WIDTH_PX}px;">
		<div class="eis-hour-label major">${last}:00 ${EIS_DAY_END < 12 ? "AM" : "PM"}</div>
		<div class="eis-hour-line major"></div></div>`;

	const block = (cls, title, from, to, text) => {
		const left = ((from - EIS_DAY_START) / total) * 100;
		const width = ((to - from) / total) * 100;
		return width <= 0 ? "" : `
			<div class="eis-schedule-event ${cls}" style="left:${left}%;width:${width}%;">
				<div class="eis-event-content">
					<div class="eis-event-title">${title}</div>
					<div class="eis-event-time">${text}</div>
				</div>
				<div class="eis-event-tooltip"><strong>${title}</strong><br>${text}</div>
			</div>`;
	};
	// Time already gone (today before now / a past date) is grey, never "Free".
	const free_from = Math.min(Math.max(EIS_DAY_START, past_until), EIS_DAY_END);
	let blocks = "";
	if (free_from > EIS_DAY_START) {
		blocks += block("eis-event-past", __("Past"), EIS_DAY_START, free_from,
			past_until >= 24 ? __("Date has passed") : `${eis_hour_label(EIS_DAY_START)} - ${eis_hour_label(free_from)}`);
	}
	events.forEach((e) => {
		if (e.endHour <= free_from || e.startHour >= EIS_DAY_END) return;
		blocks += block("eis-event-busy", __("Busy"), Math.max(e.startHour, free_from), Math.min(e.endHour, EIS_DAY_END),
			`${e.displayStartTime} - ${e.displayEndTime}`);
	});
	if (free_from < EIS_DAY_END) {
		eis_calculate_free_slots(events, free_from, EIS_DAY_END).forEach((s) => {
			blocks += block("eis-event-free", __("Free"), s.start, s.end, `${eis_hour_label(s.start)} - ${eis_hour_label(s.end)}`);
		});
	}

	return `
		<div class="eis-schedule-container">
			<div class="eis-schedule-header">
				<h5 class="eis-schedule-date">${moment(frm.doc.interview_date, "YYYY-MM-DD").format("dddd, MMMM DD, YYYY")}</h5>
				<div class="eis-email-info">
					<span class="eis-email-label">${__("Calendar Events for")}</span>
					<span class="eis-email-address">${frappe.utils.escape_html(email)}</span>
				</div>
			</div>
			<div class="eis-schedule-legend">
				<div class="eis-legend-item"><div class="eis-legend-dot busy"></div><span>${__("Busy")}</span></div>
				<div class="eis-legend-item"><div class="eis-legend-dot available"></div><span>${__("Free")}</span></div>
				${past_until > EIS_DAY_START ? `<div class="eis-legend-item"><div class="eis-legend-dot past"></div><span>${__("Past")}</span></div>` : ""}
			</div>
			<div class="eis-timeline-section">
				<div class="eis-time-labels">${labels}</div>
				<div class="eis-timeline-grid"><div class="eis-timeline-track"></div>${blocks}</div>
			</div>
		</div>
		${EIS_SCHEDULE_CSS}`;
}

// 1-hour slots (on the half hour, 9 AM – 6 PM) when every interviewer is
// free — only ones that have not started yet.
function eis_common_free_html(all_events, past_until = 0) {
	const hhmm = (h) => moment().startOf("day").add(Math.round(h * 60), "minutes").format("HH:mm:ss");
	const free = [];
	for (let h = 9; h + 1 <= EIS_DAY_END; h += 0.5) {
		if (h < past_until) continue;
		if (!all_events.some((e) => e.startHour < h + 1 && e.endHour > h)) free.push(h);
	}
	const none = past_until >= 24
		? __("This date has passed — pick today or a later date.")
		: past_until > 9
			? __("No common free hour left today before 6 PM — try another date.")
			: __("No common free hour between 9 AM and 6 PM.");
	const buttons = free.length
		? free.map((h) => `<button type="button" class="btn btn-xs btn-default eis-free-pick"
			data-start="${hhmm(h)}" data-end="${hhmm(h + 1)}" data-label="${eis_hour_label(h)}" data-end-label="${eis_hour_label(h + 1)}">
			${eis_hour_label(h)} – ${eis_hour_label(h + 1)}</button>`).join("")
		: `<span class="text-muted">${none}</span>`;
	return `
		<div class="eis-common-free">
			<div class="eis-common-free-title">${__("Everyone free (1 hour) — click to use:")}</div>
			<div>${buttons}</div>
		</div>`;
}

const EIS_SCHEDULE_CSS = `<style>
	.eis-schedule-container{max-width:1200px;margin:16px auto;background:var(--card-bg,#fff);border-radius:8px;box-shadow:0 2px 4px -1px rgba(0,0,0,0.1);border:1px solid #e2e8f0;overflow:hidden;}
	.eis-schedule-header{display:flex;justify-content:space-between;align-items:flex-start;padding:0.75rem;border-bottom:1px solid #e2e8f0;background:#f8fafc;}
	.eis-schedule-date{font-size:0.8rem;font-weight:700;color:#1e293b;margin:0;}
	.eis-email-info{display:flex;flex-direction:column;gap:0.1rem;text-align:right;}
	.eis-email-label{color:#64748b;font-size:0.65rem;font-weight:500;text-transform:uppercase;}
	.eis-email-address{color:#374151;font-size:0.75rem;font-weight:600;font-family:monospace;}
	.eis-schedule-legend{display:flex;gap:1rem;padding:0.4rem 0.75rem;background:#f8fafc;border-bottom:1px solid #e2e8f0;}
	.eis-legend-item{display:flex;align-items:center;gap:0.3rem;font-size:0.65rem;color:#475569;}
	.eis-legend-dot{width:10px;height:10px;border-radius:3px;}
	.eis-legend-dot.busy{background:#f87171;}
	.eis-legend-dot.available{background:#6ee7b7;}
	.eis-timeline-section{padding:0.75rem;overflow-x:auto;}
	.eis-time-labels{display:flex;margin-bottom:0.2rem;min-width:800px;}
	.eis-time-slot-group,.eis-time-slot-final{display:flex;flex-direction:column;position:relative;}
	.eis-time-slot-group{justify-content:space-between;}
	.eis-time-slot-hour,.eis-time-slot-half{display:flex;flex-direction:column;align-items:center;flex:1;gap:0.15rem;}
	.eis-time-slot-final{align-items:center;gap:0.15rem;}
	.eis-hour-label{font-size:0.55rem;color:#64748b;text-align:center;}
	.eis-hour-label.major{font-weight:600;color:#374151;font-size:0.6rem;}
	.eis-hour-label.minor{font-weight:500;color:#6b7280;font-size:0.5rem;}
	.eis-hour-line.major{background:#374151;height:10px;width:1.5px;}
	.eis-hour-line.minor{background:#6b7280;height:4px;width:1px;}
	.eis-timeline-grid{position:relative;height:40px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;min-width:800px;}
	.eis-timeline-track{position:absolute;inset:0;background:repeating-linear-gradient(to right,transparent 0%,transparent 4.9%,rgba(107,114,128,0.3) 4.9%,rgba(107,114,128,0.3) 5%,transparent 5%,transparent 9.9%,rgba(55,65,81,0.4) 9.9%,rgba(55,65,81,0.4) 10%);}
	.eis-schedule-event{position:absolute;top:2px;bottom:2px;border-radius:4px;padding:0.15rem;display:flex;flex-direction:column;justify-content:center;min-width:40px;z-index:2;box-shadow:0 1px 4px rgba(0,0,0,0.1);}
	.eis-schedule-event:hover{z-index:10;box-shadow:0 4px 10px rgba(0,0,0,0.15);}
	.eis-event-busy{background:#f87171;color:#fff;border:1px solid #ef4444;}
	.eis-event-free{background:#34d399;color:#fff;border:1px solid #10b981;}
	.eis-event-past{background:#e5e7eb;color:#6b7280;border:1px solid #d1d5db;box-shadow:none;}
	.eis-legend-dot.past{background:#d1d5db;}
	.eis-event-content{text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
	.eis-event-title{font-weight:600;font-size:0.55rem;line-height:1;margin-bottom:0.05rem;}
	.eis-event-time{font-size:0.5rem;opacity:0.9;line-height:1;}
	.eis-event-tooltip{visibility:hidden;opacity:0;position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:#1f2937;color:#fff;padding:0.3rem 0.5rem;border-radius:4px;font-size:0.55rem;z-index:1000;white-space:nowrap;transition:opacity 0.2s;}
	.eis-schedule-event:hover .eis-event-tooltip{visibility:visible;opacity:1;}
	.eis-common-free{margin:4px 0 8px;}
	.eis-common-free-title{font-weight:600;font-size:12px;margin-bottom:6px;}
	.eis-free-pick{margin:0 6px 6px 0;}
</style>`;

// ---------------------------------------------------------------- meeting room picker
// Ported from health_interview_schedule.js check_available_room.
function eis_room_dialog(frm, rooms, start, end) {
	const available = rooms.filter((r) => r.is_available);
	let selected = frm.doc.meeting_room && available.some((r) => r.name === frm.doc.meeting_room) ? frm.doc.meeting_room : null;
	const dialog = new frappe.ui.Dialog({
		title: __("Select a Meeting Room"),
		size: "large",
		fields: [{ fieldtype: "HTML", fieldname: "room_grid" }],
		primary_action_label: __("Select"),
		primary_action() {
			if (!selected) {
				frappe.msgprint(__("Please select a room."));
				return;
			}
			const room = rooms.find((r) => r.name === selected);
			frm.__eis_picked_room = room.name;
			frm.set_value("meeting_room", room.name).then(() => frm.set_value("room_email", room.email || ""));
			dialog.hide();
		},
	});
	const $w = dialog.fields_dict.room_grid.$wrapper;
	$w.html(`
		${EIS_ROOM_CSS}
		<div class="eis-room-slot"><i class="fa fa-calendar"></i> ${__("Time Slot")}: ${start.format("h:mm A")} – ${end.format("h:mm A")}, ${start.format("ddd, DD MMM YYYY")}</div>
		<div class="eis-room-header">
			<input type="text" class="eis-room-search" placeholder="${__("Search rooms…")}">
			<label class="eis-room-toggle">
				<input type="checkbox" class="eis-show-busy"${available.length ? "" : " checked"}> ${__("Show busy rooms too")}
			</label>
			<span class="eis-room-count"></span>
		</div>
		<div class="eis-room-grid"></div>`);
	const $grid = $w.find(".eis-room-grid");
	const $search = $w.find(".eis-room-search");
	const $busy = $w.find(".eis-show-busy");

	const render = () => {
		const term = ($search.val() || "").trim().toLowerCase();
		const source = $busy.is(":checked") ? rooms : available;
		const list = source.filter((r) => r.name.toLowerCase().includes(term));
		$w.find(".eis-room-count").text(
			term
				? __("{0} of {1} rooms", [list.length, source.length])
				: $busy.is(":checked")
					? __("{0} rooms ({1} available)", [rooms.length, available.length])
					: __("{0} rooms available", [available.length])
		);
		if (!list.length) {
			$grid.html(`<div class="eis-room-empty">${available.length || term ? __("No rooms match your search.") : __("No rooms are available for the selected time slot.")}</div>`);
			return;
		}
		$grid.html(list.map((r) => `
			<div class="eis-room-card${r.is_available ? "" : " busy"}${r.name === selected ? " selected" : ""}"
				data-room="${frappe.utils.escape_html(r.name)}" data-available="${r.is_available ? 1 : 0}">
				<span class="room-check">✓</span>
				<div class="room-name">${frappe.utils.escape_html(r.name)}</div>
				${r.capacity ? `<div class="room-capacity">${__("Capacity")}: ${r.capacity}</div>` : ""}
				<div class="room-status">${r.name === selected ? __("Selected") : r.is_available ? __("Available") : __("Busy")}</div>
			</div>`).join(""));
	};
	$search.on("input", render);
	$busy.on("change", render);
	$w.on("click", '.eis-room-card[data-available="1"]', function () {
		selected = $(this).attr("data-room");
		render();
	});
	render();
	dialog.show();
	if (!available.length) {
		frappe.show_alert({ message: __("No rooms are available for the selected time slot."), indicator: "orange" });
	}
}

const EIS_ROOM_CSS = `<style>
	.eis-room-slot{margin-bottom:10px;text-align:center;font-size:12px;font-weight:600;color:#1e3a8a;background:#e0e7ff;padding:6px;border-radius:4px;}
	.eis-room-header{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:12px;}
	.eis-room-search{width:260px;padding:6px 10px;border:1px solid #d1d8dd;border-radius:6px;font-size:13px;outline:none;}
	.eis-room-search:focus{border-color:#1a7f4b;box-shadow:0 0 0 2px rgba(26,127,75,0.15);}
	.eis-room-toggle{display:flex;align-items:center;gap:6px;font-size:12px;color:#5c6b73;cursor:pointer;user-select:none;margin:0;}
	.eis-room-count{font-size:12px;color:#5c6b73;font-weight:500;}
	.eis-room-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;max-height:420px;overflow-y:auto;padding:2px;}
	.eis-room-card{position:relative;border:1px solid #bfe6cf;background:#f3fbf6;border-radius:8px;padding:14px 12px;text-align:center;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,0.04);transition:background 0.15s,border-color 0.15s,box-shadow 0.15s;}
	.eis-room-card:hover{background:#e2f6ea;box-shadow:0 2px 6px rgba(0,0,0,0.08);}
	.eis-room-card.selected{background:#1a7f4b;border-color:#14603a;color:#fff;}
	.eis-room-card.busy{border-color:#f3c2c2;background:#fdf1f1;cursor:not-allowed;}
	.eis-room-card.busy:hover{background:#fdf1f1;box-shadow:0 1px 2px rgba(0,0,0,0.04);}
	.eis-room-card .room-check{position:absolute;top:6px;right:8px;font-size:12px;visibility:hidden;}
	.eis-room-card.selected .room-check{visibility:visible;}
	.eis-room-card .room-name{font-weight:600;font-size:13px;line-height:1.3;word-break:break-word;}
	.eis-room-card .room-capacity{font-size:11px;margin-top:4px;color:#5c6b73;}
	.eis-room-card .room-status{font-size:11px;margin-top:5px;color:#1a7f4b;font-weight:500;}
	.eis-room-card.busy .room-status{color:#c0392b;}
	.eis-room-card.selected .room-status,.eis-room-card.selected .room-capacity{color:#eafaf1;}
	.eis-room-empty{text-align:center;color:#8a97a0;font-size:13px;padding:30px 0;grid-column:1/-1;}
</style>`;
