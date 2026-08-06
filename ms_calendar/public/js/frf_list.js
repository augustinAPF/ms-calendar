frappe.listview_settings['Field Registration Form'] = {

    onload(listview) {

        async function validate_selection() {

            let selected = listview.get_checked_items();

            if (!selected.length) {
                remove_merittrac_button(listview);
                remove_result_button(listview);
                return;
            }

            let names = selected.map(r => r.name);

            let records = await frappe.db.get_list('Field Registration Form', {
                filters: [["name", "in", names]],
                fields: ["name", "application_status"],
                limit_page_length: names.length
            });

            // MeritTrac button — Test Process or No Show Test 1
            let all_test_ok = records.every(r =>
                r.application_status === "Test Process" ||
                r.application_status === "No Show Test 1"
            );
            if (all_test_ok) load_merittrac_button(listview);
            else remove_merittrac_button(listview);

            // View Test Result button — exactly one candidate selected
            if (selected.length === 1) load_result_button(listview);
            else remove_result_button(listview);
        }

        $(document).on("change", ".list-row-checkbox", validate_selection);
        $(document).on("change", ".list-check-all", validate_selection);
    },

    refresh() {
        $('span.sidebar-toggle-btn').hide();
        $('.col-lg-2.layout-side-section').hide();
    }
};

// ---------------------------------------------------------------------------
// VIEW TEST RESULT BUTTON
// ---------------------------------------------------------------------------
function load_result_button(listview) {
    if (listview._result_btn) return;

    let btn = listview.page.add_inner_button(
        '<i class="fa fa-file-text"></i> View Test Result',
        () => handle_view_result_button(listview)
    );

    listview._result_btn = btn;

    setTimeout(() => {
        btn.removeClass("btn-secondary")
            .addClass("btn-primary")
            .css({
                "background-color": "#0f766e",
                "border-color": "#0f766e",
                "color": "white",
                "width": "100%",
                "display": "block",
                "text-align": "left"
            });
    }, 0);
}

function remove_result_button(listview) {
    if (listview._result_btn) {
        listview._result_btn.remove();
        listview._result_btn = null;
    }
}

function handle_view_result_button(listview) {
    let selected = listview.get_checked_items();
    if (selected.length !== 1) return;
    open_result_dialog(selected[0].name);
}

async function open_result_dialog(candidate_id) {
    let d = new frappe.ui.Dialog({
        title: `MeritTrac Test Result — ${candidate_id}`,
        size: "large",
        fields: [{ fieldname: "result_html", fieldtype: "HTML" }]
    });
    d.show();
    d.fields_dict.result_html.$wrapper.html(
        '<div style="padding:24px;text-align:center;color:#64748b">Loading assessment result…</div>'
    );

    try {
        let listRes = await frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Field MeritTrac Test Result",
                filters: [["applicant_id", "=", candidate_id]],
                fields: ["name"],
                order_by: "creation desc",
                limit_page_length: 1
            }
        });
        let row = listRes && listRes.message && listRes.message[0];
        if (!row) {
            d.fields_dict.result_html.$wrapper.html(
                '<div style="padding:24px;color:#64748b">No assessment result received yet for this candidate.</div>'
            );
            return;
        }

        let docRes = await frappe.call({
            method: "frappe.client.get",
            args: { doctype: "Field MeritTrac Test Result", name: row.name }
        });
        let t = docRes && docRes.message;
        if (!t) return;
        render_result_html(d, t);
    } catch (err) {
        d.fields_dict.result_html.$wrapper.html(
            `<div style="padding:24px;color:#be123c">Failed to load assessment result: ${err.message || err}</div>`
        );
    }
}

function render_result_html(d, t) {
    const statBox = (lbl, val) => `
        <div style="flex:1;min-width:140px;background:#f8faff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;">
            <div style="font-size:10.5px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">${lbl}</div>
            <div style="font-size:16px;font-weight:800;color:#0f172a;">${val}</div>
        </div>`;

    const overallPct = (t.overall_percentage_score !== null && t.overall_percentage_score !== undefined)
        ? `${t.overall_percentage_score}%` : (t.score_percentile || "—");

    const stats = [
        statBox("Attempt Status", t.attempt_status || "—"),
        statBox("Total Score", `${t.total_score ?? "—"} / ${t.max_score || "—"}`),
        statBox("Overall %", overallPct),
        statBox("Attempted", `${t.total_attempted || "—"} / ${t.total_questions || "—"}`)
    ].join("");

    const sections = t.section_wise_score || [];
    const sectionRows = sections.map((s, i) => `
        <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#94a3b8;">${i + 1}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${s.section_name || "—"}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${s.score ?? "—"}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${s.max_score ?? "—"}</td>
        </tr>`).join("");
    const sectionTable = sections.length
        ? `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:10px;">
            <thead><tr>
                <th style="text-align:left;padding:8px 12px;font-size:10.5px;color:#64748b;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">#</th>
                <th style="text-align:left;padding:8px 12px;font-size:10.5px;color:#64748b;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">Section</th>
                <th style="text-align:left;padding:8px 12px;font-size:10.5px;color:#64748b;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">Score</th>
                <th style="text-align:left;padding:8px 12px;font-size:10.5px;color:#64748b;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">Max Score</th>
            </tr></thead>
            <tbody>${sectionRows}</tbody>
        </table>`
        : `<div style="padding:14px;color:#94a3b8;">No section-wise scores recorded.</div>`;

    const responses = t.descriptive_response || [];
    const responsesHtml = responses.length
        ? responses.map((resp, i) => `
            <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;margin-bottom:12px;background:#fafbff;">
                <div style="font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Question ${i + 1}</div>
                <div style="font-size:13.5px;color:#0f172a;line-height:1.6;margin-bottom:12px;">${resp.question_text || ""}</div>
                <div style="font-size:11px;font-weight:800;color:#1F497D;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Candidate Response</div>
                <div style="font-size:13.5px;color:#334155;line-height:1.6;padding:10px 14px;background:#fff;border-radius:8px;border:1px solid #e2e8f0;">
                    ${resp.candidate_response || '<em style="color:#94a3b8">No response provided</em>'}
                </div>
            </div>`).join("")
        : `<div style="padding:14px;color:#94a3b8;">No descriptive responses recorded.</div>`;

    d.fields_dict.result_html.$wrapper.html(`
        <div style="padding:4px 2px 16px;">
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;">${stats}</div>
            <div style="font-size:12px;font-weight:700;color:#1F497D;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Section-wise Scores</div>
            ${sectionTable}
            <div style="font-size:12px;font-weight:700;color:#1F497D;text-transform:uppercase;letter-spacing:.06em;margin:20px 0 6px;">Descriptive Responses</div>
            ${responsesHtml}
        </div>
    `);
}

// ---------------------------------------------------------------------------
// MERITTRAC BUTTON
// ---------------------------------------------------------------------------
function load_merittrac_button(listview) {

    if (listview._merittrac_btn) return;

    let btn = listview.page.add_inner_button(
        '<i class="fa fa-bolt"></i> Initiate Test',
        () => handle_create_button(listview)
    );

    listview._merittrac_btn = btn;

    setTimeout(() => {
        btn.removeClass("btn-secondary")
            .addClass("btn-primary")
            .css({
                "background-color": "black",
                "border-color": "black",
                "color": "white",
                "width": "100%",
                "display": "block",
                "text-align": "left"
            });
    }, 0);
}

function remove_merittrac_button(listview) {
    if (listview._merittrac_btn) {
        listview._merittrac_btn.remove();
        listview._merittrac_btn = null;
    }
}

// ---------------------------------------------------------------------------
// LIMIT
// ---------------------------------------------------------------------------
function handle_create_button(listview) {

    let selected = listview.get_checked_items();

    if (selected.length > 450) {
        frappe.msgprint("Max 450 candidates allowed.");
        return;
    }

    open_merittrac_dialog(listview);
}

// ---------------------------------------------------------------------------
// HELPER — render a Frappe-styled datetime picker block
// ---------------------------------------------------------------------------
function frappe_datetime_html(id, label) {
    return `
        <style>
            .custom-dt-wrap { margin-bottom: 10px; }
            .custom-dt-wrap .custom-dt-label {
                font-size: var(--text-sm, 12px);
                color: var(--text-muted, #8d99a6);
                font-weight: 500;
                margin-bottom: 4px;
                display: block;
            }
            .custom-dt-wrap .custom-dt-label span { color: var(--red, #e74c3c); margin-left: 2px; }
            .custom-dt-wrap .custom-dt-row { display: flex; gap: 6px; }
            .custom-dt-wrap input {
                height: 32px; padding: 0 8px;
                border: 1px solid var(--border-color, #d1d8dd);
                border-radius: var(--border-radius, 6px);
                font-size: var(--text-md, 13px);
                color: var(--text-color, #333);
                background: var(--control-bg, #fff);
                font-family: inherit; outline: none;
                transition: border-color 0.15s; box-sizing: border-box;
            }
            .custom-dt-wrap input:focus {
                border-color: var(--primary, #171717);
                box-shadow: 0 0 0 2px var(--primary-light, #e8e8e8);
            }
            .custom-dt-wrap input[type="date"] { flex: 1.2; }
            .custom-dt-wrap input[type="time"] { flex: 1; }
        </style>
        <div class="custom-dt-wrap">
            <label class="custom-dt-label">${label}<span>*</span></label>
            <div class="custom-dt-row">
                <input type="date" id="${id}_date" />
                <input type="time" id="${id}_time" value="00:00" />
            </div>
        </div>
    `;
}

// ---------------------------------------------------------------------------
// HELPER — render a plain HTML time input
// ---------------------------------------------------------------------------
function frappe_time_html(id, label) {
    return `
        <style>
            .custom-time-wrap { margin-bottom: 10px; }
            .custom-time-wrap .custom-time-label {
                font-size: var(--text-sm, 12px);
                color: var(--text-muted, #8d99a6);
                font-weight: 500;
                margin-bottom: 4px;
                display: block;
            }
            .custom-time-wrap .custom-time-label span { color: var(--red, #e74c3c); margin-left: 2px; }
            .custom-time-wrap input[type="time"] {
                width: 100%; height: 32px; padding: 0 8px;
                border: 1px solid var(--border-color, #d1d8dd);
                border-radius: var(--border-radius, 6px);
                font-size: var(--text-md, 13px);
                color: var(--text-color, #333);
                background: var(--control-bg, #fff);
                font-family: inherit; outline: none;
                transition: border-color 0.15s; box-sizing: border-box; cursor: pointer;
            }
            .custom-time-wrap input[type="time"]:focus {
                border-color: var(--primary, #171717);
                box-shadow: 0 0 0 2px var(--primary-light, #e8e8e8);
            }
            .custom-time-wrap input[type="time"]::-webkit-calendar-picker-indicator { display: none; }
        </style>
        <div class="custom-time-wrap">
            <label class="custom-time-label">${label}<span>*</span></label>
            <input type="time" id="${id}" onclick="this.showPicker()" />
        </div>
    `;
}

// ---------------------------------------------------------------------------
// AM/PM datetime picker helpers
// ---------------------------------------------------------------------------
function mt_dt_html(id, label) {
    let hr_opts = '', min_opts = '';
    for (let i = 1; i <= 12; i++) hr_opts += `<option value="${i}">${String(i).padStart(2, '0')}</option>`;
    for (let i = 0; i < 60; i++) min_opts += `<option value="${String(i).padStart(2, '0')}">${String(i).padStart(2, '0')}</option>`;
    const sel = 'height:32px;padding:0 8px;border:1px solid #d1d8dd;border-radius:6px;font-size:13px;cursor:pointer;background:#fff;';
    return `<div style="margin-bottom:10px;">
        <label style="font-size:12px;color:#8d99a6;font-weight:500;margin-bottom:6px;display:block;">
            ${label}<span style="color:#e74c3c;margin-left:2px;">*</span>
        </label>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <input type="date" id="${id}_date" style="flex:1.6;min-width:120px;${sel}" />
            <select id="${id}_hr"   style="${sel}">${hr_opts}</select>
            <span style="font-size:15px;font-weight:700;color:#555;line-height:32px;">:</span>
            <select id="${id}_min"  style="${sel}">${min_opts}</select>
            <select id="${id}_ampm" style="${sel}">
                <option value="AM">AM</option>
                <option value="PM">PM</option>
            </select>
        </div>
    </div>`;
}

function get_mt_dt(id) {
    let date = (document.getElementById(id + '_date') || {}).value || '';
    let hr = parseInt((document.getElementById(id + '_hr') || {}).value || '12');
    let min = (document.getElementById(id + '_min') || {}).value || '00';
    let ampm = (document.getElementById(id + '_ampm') || {}).value || 'AM';
    if (!date) return '';
    let hr24 = ampm === 'PM' ? (hr === 12 ? 12 : hr + 12) : (hr === 12 ? 0 : hr);
    return date + ' ' + String(hr24).padStart(2, '0') + ':' + min + ':00';
}

function set_mt_dt_defaults(id, m) {
    let h = m.hours() % 12 || 12;
    let mm = String(m.minutes()).padStart(2, '0');
    let ap = m.hours() >= 12 ? 'PM' : 'AM';
    let el = n => document.getElementById(id + '_' + n);
    if (el('date')) el('date').value = m.format('YYYY-MM-DD');
    if (el('hr')) el('hr').value = h;
    if (el('min')) el('min').value = mm;
    if (el('ampm')) el('ampm').value = ap;
}

// ---------------------------------------------------------------------------
// AM/PM time-only picker helpers (no date) — used for Reporting Time
// ---------------------------------------------------------------------------
function mt_time_html(id, label) {
    let hr_opts = '', min_opts = '';
    for (let i = 1; i <= 12; i++) hr_opts += `<option value="${i}">${String(i).padStart(2, '0')}</option>`;
    for (let i = 0; i < 60; i++) min_opts += `<option value="${String(i).padStart(2, '0')}">${String(i).padStart(2, '0')}</option>`;
    const sel = 'height:32px;padding:0 8px;border:1px solid #d1d8dd;border-radius:6px;font-size:13px;cursor:pointer;background:#fff;';
    return `<div style="margin-bottom:10px;">
        <label style="font-size:12px;color:#8d99a6;font-weight:500;margin-bottom:6px;display:block;">
            ${label}<span style="color:#e74c3c;margin-left:2px;">*</span>
        </label>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <select id="${id}_hr"   style="${sel}">${hr_opts}</select>
            <span style="font-size:15px;font-weight:700;color:#555;line-height:32px;">:</span>
            <select id="${id}_min"  style="${sel}">${min_opts}</select>
            <select id="${id}_ampm" style="${sel}">
                <option value="AM">AM</option>
                <option value="PM">PM</option>
            </select>
        </div>
    </div>`;
}

function get_mt_time(id) {
    let hr = parseInt((document.getElementById(id + '_hr') || {}).value || '12');
    let min = (document.getElementById(id + '_min') || {}).value || '00';
    let ampm = (document.getElementById(id + '_ampm') || {}).value || 'AM';
    if (!document.getElementById(id + '_hr')) return '';
    let hr24 = ampm === 'PM' ? (hr === 12 ? 12 : hr + 12) : (hr === 12 ? 0 : hr);
    return String(hr24).padStart(2, '0') + ':' + min + ':00';
}

function set_mt_time_defaults(id, m) {
    let h = m.hours() % 12 || 12;
    let mm = String(m.minutes()).padStart(2, '0');
    let ap = m.hours() >= 12 ? 'PM' : 'AM';
    let el = n => document.getElementById(id + '_' + n);
    if (el('hr')) el('hr').value = h;
    if (el('min')) el('min').value = mm;
    if (el('ampm')) el('ampm').value = ap;
}

// ---------------------------------------------------------------------------
// MAIN MERITTRAC DIALOG
// ---------------------------------------------------------------------------
function open_merittrac_dialog(listview) {

    let selected = listview.get_checked_items();
    let selected_ids = selected.map(d => d.name);

    let d = new frappe.ui.Dialog({
        title: "Initiate Test",

        fields: [
            {
                label: "Test Mode",
                fieldname: "test_mode",
                fieldtype: "Select",
                options: ["Online", "Offline"],
                default: "Online",
                reqd: 1
            },
            {
                label: "Assignment ID",
                fieldname: "assessment_link",
                fieldtype: "Link",
                options: "Field Meritrac Assessment",
                depends_on: "eval:doc.test_mode=='Online'",
                mandatory_depends_on: "eval:doc.test_mode=='Online'"
            },
            {
                fieldname: "start_datetime_html",
                fieldtype: "HTML",
                depends_on: "eval:doc.test_mode=='Online'",
                options: mt_dt_html("mt_start", "Start Date &amp; Time")
            },
            {
                fieldname: "end_datetime_html",
                fieldtype: "HTML",
                depends_on: "eval:doc.test_mode=='Online'",
                options: mt_dt_html("mt_end", "End Date &amp; Time")
            },
            {
                label: "Remote Proctored",
                fieldname: "remote_proctored",
                fieldtype: "Check",
                depends_on: "eval:doc.test_mode=='Online'"
            },
            {
                label: "Test Date",
                fieldname: "date",
                fieldtype: "Date",
                depends_on: "eval:doc.test_mode=='Offline'",
                mandatory_depends_on: "eval:doc.test_mode=='Offline'"
            },
            {
                fieldname: "reporting_time_html",
                fieldtype: "HTML",
                depends_on: "eval:doc.test_mode=='Offline'",
                options: mt_time_html("mt_reporting", "Reporting Time")
            },
            {
                label: "Test Duration",
                fieldname: "duration",
                fieldtype: "Select",
                options: [
                    "30 mins", "1 hour", "1 hour 30 mins", "2 hours",
                    "2 hours 30 mins", "3 hours", "3 hours 30 mins",
                    "4 hours", "4 hours 30 mins", "5 hours"
                ],
                depends_on: "eval:doc.test_mode=='Offline'",
                mandatory_depends_on: "eval:doc.test_mode=='Offline'"
            },
            {
                label: "Other Test Location",
                fieldname: "other_location",
                fieldtype: "Check",
                depends_on: "eval:doc.test_mode=='Offline'",
                change: function () { d.refresh(); }
            },
            {
                label: "Test Location",
                fieldname: "venue",
                fieldtype: "Link",
                options: "Offline Test Location",
                depends_on: "eval:doc.test_mode=='Offline' && !doc.other_location",
                mandatory_depends_on: "eval:doc.test_mode=='Offline' && !doc.other_location",
                change: async function () {
                    let venue = d.get_value("venue");
                    if (!venue) { d.set_value("venue_address", ""); return; }
                    let doc = await frappe.db.get_doc("Offline Test Location", venue);
                    d.set_value("venue_address", doc.address || "");
                }
            },
            {
                label: "Venue Address",
                fieldname: "venue_address",
                fieldtype: "Small Text",
                read_only: 1,
                depends_on: "eval:doc.test_mode=='Offline' && !doc.other_location"
            },
            {
                label: "Other Location Address",
                fieldname: "other_location_address",
                fieldtype: "Small Text",
                depends_on: "eval:doc.test_mode=='Offline' && doc.other_location",
                mandatory_depends_on: "eval:doc.test_mode=='Offline' && doc.other_location"
            }
        ],

        primary_action_label: "Create",

        primary_action: async function () {

            let test_mode = d.get_value("test_mode");
            let date = d.get_value("date");
            let duration = d.get_value("duration");
            let venue = d.get_value("venue");
            let venue_address = d.get_value("venue_address");
            let other_location = d.get_value("other_location");
            let other_location_address = d.get_value("other_location_address");
            let assessment_link = d.get_value("assessment_link");
            let remote_proctored = d.get_value("remote_proctored");
            let reporting_time = get_mt_time("mt_reporting");
            let start_datetime = get_mt_dt("mt_start");
            let end_datetime = get_mt_dt("mt_end");

            // OFFLINE
            if (test_mode === "Offline") {
                let has_venue = other_location ? !!other_location_address : !!venue;
                if (!date || !reporting_time || !duration || !has_venue) {
                    frappe.msgprint("Please fill all Offline test details.");
                    return;
                }
                frappe.call({
                    method: "send_test_invitation",
                    args: {
                        candidates: selected_ids,
                        data: { test_mode, date, reporting_time, duration, venue, venue_address, other_location, other_location_address }
                    },
                    freeze: true,
                    freeze_message: "Sending emails to candidates...",
                    callback() { frappe.msgprint("✔ Offline Emails Sent Successfully"); d.hide(); }
                });
                return;
            }

            // ONLINE
            let loaderCountdownTimer = null;

            function showLoader() {
                $("body").append(`
                    <div id="loader" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(15,23,42,0.55);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;z-index:9999;">
                        <style>
                            @keyframes loaderSpin { to { transform: rotate(360deg); } }
                            @keyframes loaderPop { from { opacity:0; transform:translateY(10px) scale(.97); } to { opacity:1; transform:none; } }
                            #loader-spinner {
                                width:40px; height:40px; border-radius:50%;
                                border:3.5px solid #e2e8f0; border-top-color:#1F497D;
                                animation:loaderSpin .8s linear infinite; margin:0 auto 18px;
                            }
                            #loader-card { animation:loaderPop .28s cubic-bezier(.34,1.2,.64,1) both; }
                        </style>
                        <div id="loader-card" style="background:#fff;border-radius:16px;padding:34px 42px;min-width:300px;max-width:360px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.25);">
                            <div id="loader-spinner"></div>
                            <div id="loader-title" style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:6px;">Creating Test…</div>
                            <div id="loader-sub" style="font-size:12.5px;color:#64748b;line-height:1.5;">Please don't close this window.</div>
                        </div>
                    </div>
                `);
            }

            function updateLoader(title, sub) {
                $("#loader-title").text(title);
                if (sub !== undefined) $("#loader-sub").text(sub);
            }

            function startLoaderCountdown(seconds, labelPrefix) {
                let remaining = seconds;
                updateLoader(labelPrefix, `Please wait ${remaining}s…`);
                clearInterval(loaderCountdownTimer);
                loaderCountdownTimer = setInterval(() => {
                    remaining -= 1;
                    if (remaining <= 0) { clearInterval(loaderCountdownTimer); return; }
                    updateLoader(labelPrefix, `Please wait ${remaining}s…`);
                }, 1000);
            }

            function hideLoader() {
                clearInterval(loaderCountdownTimer);
                $("#loader").remove();
            }

            try {
                if (!start_datetime || !end_datetime) { frappe.msgprint("Please select Start and End Date & Time."); return; }
                let start = moment(start_datetime, "YYYY-MM-DD HH:mm:ss");
                let end = moment(end_datetime, "YYYY-MM-DD HH:mm:ss");
                if (!start.isValid() || !end.isValid()) { frappe.msgprint("Invalid date/time. Please re-select."); return; }
                if (end.isBefore(start)) { frappe.msgprint("End Date must be after Start Date."); return; }

                let start_utc = start.clone().utc().format("YYYY-MM-DDTHH:mm:ss.SSSZ");
                let end_utc = end.clone().utc().format("YYYY-MM-DDTHH:mm:ss.SSSZ");

                showLoader();
                updateLoader("Initiating test with MeritTrac…", `Setting up ${selected_ids.length} candidate(s).`);

                // API 1 — initiate test (server-side, no CORS)
                let r1 = await frappe.call({
                    method: "ms_calendar.api.field_merit_trac.initiate_merittrac_online_test",
                    args: {
                        candidate_ids: JSON.stringify(selected_ids),
                        assessment_number: assessment_link,
                        start_utc: start_utc,
                        end_utc: end_utc,
                        enable_rp: remote_proctored ? 1 : 0
                    }
                });
                if (r1 && r1.exc) throw new Error("API 1 failed");

                // Wait 35 s for MeritTrac to process
                startLoaderCountdown(35, "Generating candidate test links…");
                await new Promise(r => setTimeout(r, 35000));
                clearInterval(loaderCountdownTimer);

                updateLoader("Fetching test links…", "Almost there.");

                // API 2 — fetch tickets (server-side, no CORS)
                let r2 = await frappe.call({
                    method: "ms_calendar.api.field_merit_trac.get_merittrac_tickets",
                    args: {
                        candidate_ids: JSON.stringify(selected_ids),
                        start_utc: start_utc,
                        end_utc: end_utc
                    }
                });
                if (r2 && r2.exc) throw new Error("API 2 failed");

                let data = r2.message;

                // Pre-fetch applicant details for all selected candidates
                let frf_map = {};
                for (let cid of selected_ids) {
                    let frf = await frappe.db.get_value("Field Registration Form", cid,
                        ["full_name_aadhaar", "email_address", "role"]);
                    frf_map[cid] = frf.message || {};
                }

                let today = frappe.datetime.get_today();
                let total = data.data.length;
                let done = 0;

                for (let row of data.data) {
                    let cid = row.candidate_id || row.candidateId || "";
                    let info = frf_map[cid] || {};
                    updateLoader("Saving candidate records…", `${done + 1} of ${total} — ${info.full_name_aadhaar || cid}`);
                    await frappe.call({
                        method: "frappe.client.insert",
                        args: {
                            doc: {
                                doctype: "Field Meritrac Test URL",
                                applicant_id: cid,
                                applicant_name: info.full_name_aadhaar || "",
                                applicant_email: info.email_address || "",
                                applicant_role: info.role || "",
                                attempt_id: row.attemptId || row.attempt_id || "",
                                test_url: row.lpurl || row.url || "",
                                current_date: today,
                                start_time: start.format("DD MMM YYYY hh:mm A"),
                                end_time: end.format("DD MMM YYYY hh:mm A")
                            }
                        }
                    });
                    done += 1;
                }

                frappe.msgprint("✔ Online Test Created Successfully");
                d.hide();

            } catch (err) {
                frappe.msgprint("Error: " + err.message);
            } finally {
                hideLoader();
            }
        }
    });

    d.show();

    // Pre-fill: start = now, end = tomorrow same time
    setTimeout(() => {
        let now = moment();
        let tomorrow = moment().add(1, 'day');
        set_mt_dt_defaults('mt_start', now);
        set_mt_dt_defaults('mt_end', tomorrow);
        set_mt_time_defaults('mt_reporting', moment());
    }, 150);

    // Auto-suggest the Assignment ID from the candidates' "Choose your subject
    // for written test?" field. Best-effort only — recruiter can still edit it.
    frappe.call({
        method: "ms_calendar.api.field_merit_trac.suggest_meritrac_assessment",
        args: { candidate_ids: selected_ids },
        callback(r) {
            let res = r.message;
            if (!res || !res.matched) return;

            d.set_value("assessment_link", res.assessment);

            let msg = `Auto-selected test: <b>${res.assessment_set}</b> based on the candidates' chosen subject.`;
            if (res.ambiguous) {
                msg += ` Other tests matched equally well — please double-check before creating.`;
            }
            frappe.show_alert({ message: msg, indicator: res.ambiguous ? "orange" : "green" }, 7);
        }
    });
}
