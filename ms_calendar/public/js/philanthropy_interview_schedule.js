// Fields the recruiter fills in to schedule the interview. Locked once the
// interview is actually scheduled (has an event_id) so nobody accidentally
// edits a live meeting without going through "Modify The Schedule" — which
// unlocks these for editing and, on Save, emails candidate + interviewer(s)
// about the change instead of silently drifting from the calendar invite.
const SCHEDULE_LOCK_FIELDS = [
    'application_id', 'applicants_mobile_no', 'role', 'interview_round',
    'candidate_cv__resume', 'organizer_email', 'interview_date',
    'interviewer_email', 'interviewers_cc_email', 'interview_type',
    'google_map_link', 'event_title', 'attendees', 'message_to_the_interviewer',
    'start_time', 'end_time'
];

// Turns a room's raw Graph busy slots (UTC) into a short local-time label
// for the room grid, e.g. "Busy 2:00 – 3:00 PM". Falls back to a plain
// "Busy" if no slot detail is available (e.g. a stale cached room with no
// stored busy-slot data yet).
function formatBusyTimes(slots) {
    if (!slots || !slots.length) {
        return __('Busy');
    }
    const ranges = slots.map(slot => {
        const start = moment.utc(slot.start.dateTime).local();
        const end = moment.utc(slot.end.dateTime).local();
        if (start.isSame(end, 'day')) {
            return `${start.format('h:mm A')} – ${end.format('h:mm A')}`;
        }
        // Multi-day / all-day block — both ends can land on the same
        // time-of-day (e.g. midnight to midnight), which without the
        // date reads as a confusing zero-length "12:00 AM – 12:00 AM".
        return `${start.format('D MMM, h:mm A')} – ${end.format('D MMM, h:mm A')}`;
    });
    return __('Busy') + ' ' + ranges.join(', ');
}

function set_schedule_lock(frm, locked) {
    SCHEDULE_LOCK_FIELDS.forEach(fieldname => {
        if (frm.fields_dict[fieldname]) {
            frm.set_df_property(fieldname, 'read_only', locked ? 1 : 0);
        }
    });
    frm.refresh_fields();
    frm.toggle_display('check_availability', !locked);
    frm.toggle_display('check_available_room', !locked);
}

function handle_modify_schedule(frm) {
    if (!frm.doc.event_id || frm.doc.is_cancelled) {
        frappe.msgprint(__('Nothing is scheduled on this record yet — the fields are already editable. Fill them in and Save to schedule it.'));
        return;
    }
    frm.__unlocked_for_edit = true;
    frm.refresh();
    frappe.show_alert({
        message: __('Fields unlocked — edit and Save to reschedule. Candidate and interviewer(s) will be emailed the new details.'),
        indicator: 'blue'
    }, 7);
}

function handle_cancel_schedule(frm) {
    if (!frm.doc.event_id) {
        frappe.msgprint(__('There is no scheduled Outlook event on this record yet.'));
        return;
    }

    frappe.confirm(
        __('Cancel this interview? The calendar invite will be cancelled and the candidate and interviewer(s) will be emailed.'),
        () => {
            frappe.call({
                method: "ms_calendar.api.ms_philanthropy.cancel_interview_event",
                args: { name: frm.doc.name },
                freeze: true,
                freeze_message: __("Cancelling interview…"),
                callback: function (r) {
                    if (r.message && r.message.cancelled) {
                        frappe.show_alert({ message: __("Interview cancelled — candidate and interviewer(s) notified."), indicator: "green" });
                        frm.reload_doc();
                    }
                },
                error: function (err) {
                    frappe.msgprint({
                        title: __("Error"),
                        message: __("Failed to cancel the interview. See console."),
                        indicator: "red"
                    });
                    console.error("Cancel Interview Error:", err);
                }
            });
        }
    );
}

frappe.ui.form.on('Philanthropy Interview Schedule', {
    refresh: function (frm) {
        frm.toggle_display('available_slots_section', false);

        const is_scheduled = !!frm.doc.event_id && !frm.doc.is_cancelled;
        const unlocked = !!frm.__unlocked_for_edit;

        set_schedule_lock(frm, is_scheduled && !unlocked);

        if (!frm.is_new()) {
            // Plain neutral/grey buttons — no color distinction between the two.
            frm.add_custom_button(__('Modify The Schedule'), () => handle_modify_schedule(frm));
            frm.add_custom_button(__('Cancel The Schedule'), () => handle_cancel_schedule(frm));
        }

    },
    interview_round: function (frm) {
        console.log(frm.doc.interview_round, "Round name");
    },
    candidate_cv__resume: function (frm) {
        console.log(frm.doc.candidate_cv__resume, "Round name");
    },

    application_id: function (frm) {
        frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Phil Registration Form",
                fields: ["name", "cv_attach"],
                filters: {
                    name: frm.doc.application_id,
                }
            },
            callback: function (r) {
                if (r.message && r.message.length > 0) {
                    console.log(r.message)
                    frm.set_value("candidate_cv__resume", r.message[0].cv_attach);
                    console.log(frm.doc.interview_round, "frm.doc.interview_round")

                }
            }
        });

    },

    async after_save(frm) {


        if (
            !frm.doc.interviewer_email ||
            !frm.doc.attendees ||
            !frm.doc.interview_date ||
            !frm.doc.start_time ||
            !frm.doc.end_time
        ) {
            frappe.msgprint(__('Please fill Interviewer Email, Interviewee Email, Date, Start Time and End Time.'));
            return;
        }

        const startDateTime = moment(`${frm.doc.interview_date} ${frm.doc.start_time}`)
            .format("YYYY-MM-DDTHH:mm:ss");

        const endDateTime = moment(`${frm.doc.interview_date} ${frm.doc.end_time}`)
            .format("YYYY-MM-DDTHH:mm:ss");

        // 1️⃣ Get interviewer emails
        const interviewerEmailsArr = (frm.doc.interviewer_email || [])
            .map(row => row.interviewer_email)
            .filter(email => !!email);

        const interviewerEmailsString = interviewerEmailsArr.join(",");

        const ccEmailsArr = (frm.doc.interviewers_cc_email || [])
            .map(row => row.interviewer_email)
            .filter(email => !!email);

        const ccEmailsString = ccEmailsArr.join(",");

        // 2️⃣ Fetch interviewer names (SAFE)
        async function get_interviewer_names(emailArray) {
            let names = [];

            for (let email of emailArray) {
                let r = await frappe.db.get_value(
                    "Interviewer Email List",
                    email,    // PRIMARY KEY = name
                    "interviewer_name"
                );

                if (r && r.message && r.message.interviewer_name) {
                    names.push(r.message.interviewer_name);
                } else {
                    names.push(email);
                }
            }

            return names;
        }

        let interviewerNamesArray = await get_interviewer_names(interviewerEmailsArr);
        let interviewerNamesString = interviewerNamesArray.join(", ");

        // 3️⃣ Attachments
        let attachments = [];
        if (frm.doc.candidate_cv__resume) {
            attachments.push(frm.doc.candidate_cv__resume);
            // attachments.push(frm.doc.feedback_form);
        }
        //     async function get_feedback_files(appId) {

        //     let files = [];

        //  let a = await frappe.call({
        //         method: "frappe.client.get_list",
        //         args: {
        //             doctype: "Phil Registration Form",
        //             filters: { name: appId },
        //             fields: ["feedback_form"]
        //         }
        //     });

        //     if (a.message && a.message.length > 0) {
        //         files = a.message
        //             .map(row => row.feedback_form)
        //             .filter(path => path && path.trim() !== "");
        //     }
        //     return files;
        // }
        async function get_feedback_files(appId) {

            let files = [];

            try {
                let a = await frappe.call({
                    method: "frappe.client.get_list",
                    args: {
                        doctype: "Philanthrophy Feedback Form",
                        filters: { applicant_id: appId },
                        fields: ["feedback_pdf_path"]
                    }
                });

                if (a.message && a.message.length > 0) {
                    files = a.message
                        .map(row => row.feedback_pdf_path)
                        .filter(path => path && path.trim() !== "");
                }
            } catch (e) {
                console.error("get_feedback_files failed, skipping feedback attachments:", e);
            }
            return files;
        }

        async function get_assignment_files(appId) {

            let files = [];

            try {
                let r = await frappe.call({
                    method: "frappe.client.get_list",
                    args: {
                        doctype: "Phil Assignment",
                        filters: { applicant_id: appId },
                        fields: ["assignment_submission"]
                    }
                });

                if (r.message && r.message.length > 0) {
                    files = r.message
                        .map(row => row.assignment_submission)
                        .filter(path => path && path.trim() !== "");
                }
            } catch (e) {
                console.error("get_assignment_files failed, skipping assignment attachments:", e);
            }
            // let a = await frappe.call({
            //     method: "frappe.client.get_list",
            //     args: {
            //         doctype: "Phil Registration Form",
            //         filters: { name: appId },
            //         fields: ["feedback_form"]
            //     }
            // });

            // if (a.message && a.message.length > 0) {
            //     files = a.message
            //         .map(row => row.feedback_form)
            //         .filter(path => path && path.trim() !== "");
            // }

            return files;
        }
        // Feedback PDFs
        let feedback_files = await get_feedback_files(frm.doc.application_id);
        let assignment_files = await get_assignment_files(frm.doc.application_id);

        attachments.push(...feedback_files);
        attachments.push(...assignment_files);

        console.log("Final attachments:", attachments);
        // if (frm.doc.feedback_form && frm.doc.interview_round=="Round Two") {
        // attachments.push(frm.doc.feedback_form);
        // }
        console.log(frm.doc.role)

        //     // Inject loader HTML once
        // if (!document.getElementById("event-loader")) {
        //     const loaderHTML = `
        //       <div id="event-loader" style="display:none">
        //         <div class="pro-overlay">
        //           <div class="pro-card">
        //             <div class="pro-icon-wrap">
        //               <div class="pro-ring"></div>
        //               <div class="pro-calendar">
        //                 <div class="pro-month">JAN</div>
        //                 <div class="pro-date">01</div>
        //               </div>
        //             </div>
        //             <div class="pro-title">Creating your calendar event…</div>
        //             <div class="pro-sub">Please wait while we schedule it.</div>
        //           </div>
        //         </div>
        //       </div>

        //       <style>
        //         .pro-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);
        //           backdrop-filter: blur(2px);display:flex;align-items:center;
        //           justify-content:center;z-index:9999;font-family:system-ui;}
        //         .pro-card{background:#fff;border-radius:18px;padding:20px 26px;width:280px;
        //           box-shadow:0 22px 60px rgba(0,0,0,.18);text-align:center;animation:pro-pop .22s ease;}
        //         .pro-icon-wrap{position:relative;width:70px;height:70px;margin:0 auto 12px;}
        //         .pro-ring{position:absolute;inset:0;border-radius:50%;border:4px solid #e5e7eb;
        //           border-top-color:#2563eb;animation:pro-spin 1s linear infinite;}
        //         .pro-calendar{position:absolute;inset:10px;background:#f9fafb;border:1px solid #e5e7eb;
        //           border-radius:10px;box-shadow:0 4px 10px rgba(0,0,0,.06);}
        //         .pro-month{background:#2563eb;color:#fff;font-size:10px;font-weight:600;padding:3px 0;}
        //         .pro-date{font-size:18px;font-weight:700;padding:6px 0;color:#111827;}
        //         .pro-title{font-size:14px;font-weight:600;margin-top:4px;}
        //         .pro-sub{font-size:12px;color:#6b7280;margin-top:3px;}
        //         @keyframes pro-spin{to{transform:rotate(360deg);}}
        //         @keyframes pro-pop{from{opacity:0;transform:scale(.94);}to{opacity:1;transform:scale(1);}}
        //       </style>`;
        //     document.body.insertAdjacentHTML("beforeend", loaderHTML);
        // }

        // // loader helpers
        // function setCalendarDate() {
        //     const d = new Date();
        //     const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL",
        //                     "AUG","SEP","OCT","NOV","DEC"];
        //     document.querySelector(".pro-month").textContent = months[d.getMonth()];
        //     document.querySelector(".pro-date").textContent  = d.getDate().toString().padStart(2,'0');
        // }

        // function showLoader() {
        //     setCalendarDate();
        //     document.getElementById("event-loader").style.display = "block";
        // }

        // function hideLoader() {
        //     document.getElementById("event-loader").style.display = "none";
        // }

        // ── Inject loader HTML once ──────────────────────────────────────────────────
        if (!document.getElementById("event-loader")) {
            const loaderHTML = `
      <div id="event-loader" style="display:none">
        <div class="apf-overlay">
          <div class="apf-card">

            <div class="apf-top-bar"><div class="apf-sweep"></div></div>

            <div class="apf-header">
              <div class="apf-logo-wrap">
                <canvas id="apf-arc" width="72" height="72"></canvas>
                <div class="apf-logo-inner">
                  <img src="/files/Logo APF.png" alt="APF"
                    style="width:42px;height:42px;object-fit:contain;"
                    onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
                  <div class="apf-logo-fallback">APF</div>
                </div>
              </div>

              <div class="apf-title-wrap">
                <div class="apf-main-label" id="apf-main-label">Scheduling interview…</div>
                <div class="apf-sub-label"  id="apf-sub-label">Connecting to calendar</div>
              </div>

              <div class="apf-cal-badge">
                <div class="apf-cal-month" id="apf-cal-month"></div>
                <div class="apf-cal-date"  id="apf-cal-date"></div>
                <div class="apf-cal-day"   id="apf-cal-day"></div>
              </div>
            </div>

            <div class="apf-divider"></div>

            <div class="apf-steps" id="apf-steps"></div>

            <div class="apf-footer">
              <div class="apf-prog-track">
                <div class="apf-prog-bar" id="apf-prog-bar"></div>
              </div>
              <div class="apf-pct" id="apf-pct">0%</div>
            </div>

          </div>
        </div>
      </div>

      <style>
        .apf-overlay {
          position:fixed; inset:0; background:rgba(0,0,0,0.6);
          backdrop-filter:blur(3px); display:flex;
          align-items:center; justify-content:center;
          z-index:9999; font-family:system-ui,-apple-system,sans-serif;
        }
        .apf-card {
          width:360px; background:#fff; border-radius:28px;
          border:0.5px solid #e5e7eb; overflow:hidden;
          animation:apf-pop .25s ease;
        }
        .apf-top-bar {
          height:4px; position:relative;
          overflow:hidden; background:#f1f5f9;
        }
        .apf-sweep {
          position:absolute; left:-40%; width:40%; height:100%;
          background:#1e3a8a; border-radius:4px;
          animation:apf-sweep 1.8s ease-in-out infinite;
        }
        .apf-header {
          padding:28px 28px 0;
          display:flex; align-items:center; gap:16px;
        }
        .apf-logo-wrap {
          position:relative; flex-shrink:0; width:72px; height:72px;
        }
        .apf-logo-inner {
          position:absolute; inset:8px; border-radius:50%;
          background:#f8fafc; border:0.5px solid #e5e7eb;
          display:flex; align-items:center; justify-content:center;
          overflow:hidden;
        }
        .apf-logo-fallback {
          display:none; font-size:12px; font-weight:500; color:#6b7280;
          align-items:center; justify-content:center;
        }
        .apf-title-wrap { flex:1; min-width:0; }
        .apf-main-label {
          font-size:15px; font-weight:600; color:#111827; margin-bottom:3px;
        }
        .apf-sub-label { font-size:12px; color:#6b7280; }
        .apf-cal-badge {
          flex-shrink:0; border:0.5px solid #e5e7eb;
          border-radius:12px; overflow:hidden; width:40px; text-align:center;
        }
        .apf-cal-month {
          background:#1e3a8a; color:#fff; font-size:9px;
          font-weight:500; padding:3px 0; letter-spacing:0.06em;
        }
        .apf-cal-date {
          font-size:16px; font-weight:600; color:#111827;
          padding:2px 0 1px; line-height:1;
        }
        .apf-cal-day { font-size:8px; color:#6b7280; padding:0 0 3px; }
        .apf-divider {
          margin:20px 28px 0; height:0.5px; background:#e5e7eb;
        }
        .apf-steps { padding:16px 28px 0; }
        .apf-step-row {
          display:flex; align-items:center; gap:12px;
          margin-bottom:12px;
          animation:apf-slide .35s ease forwards; opacity:0;
        }
        .apf-step-icon {
          width:28px; height:28px; border-radius:50%;
          border:1.5px solid #e5e7eb;
          display:flex; align-items:center; justify-content:center;
          flex-shrink:0; transition:all 0.4s ease; background:#fff;
        }
        .apf-step-icon.active { border-color:#1e3a8a; background:#eff6ff; }
        .apf-step-icon.done   { border-color:#1D9E75; background:#E1F5EE; }
        .apf-step-icon svg { width:12px; height:12px; }
        .apf-step-text { font-size:13px; color:#9ca3af; transition:color 0.3s; }
        .apf-step-text.active { color:#111827; font-weight:600; }
        .apf-step-text.done   { color:#0F6E56; }
        .apf-step-conn {
          width:1.5px; height:10px; background:#e5e7eb;
          margin-left:13px; margin-bottom:2px; transition:background 0.4s;
        }
        .apf-step-conn.done { background:#1D9E75; }
        .apf-footer {
          margin:20px 28px 24px; background:#f8fafc;
          border-radius:10px; padding:12px 16px;
          display:flex; align-items:center; gap:12px;
        }
        .apf-prog-track {
          flex:1; height:4px; background:#e5e7eb;
          border-radius:4px; overflow:hidden;
        }
        .apf-prog-bar {
          height:100%; width:0%; background:#1e3a8a;
          border-radius:4px; transition:width 0.7s cubic-bezier(.4,0,.2,1);
        }
        .apf-pct {
          font-size:12px; font-weight:600; color:#111827;
          min-width:30px; text-align:right;
        }
        @keyframes apf-sweep {
          0%   { left:-40%; }
          100% { left:140%; }
        }
        @keyframes apf-pop {
          from { opacity:0; transform:scale(.93); }
          to   { opacity:1; transform:scale(1); }
        }
        @keyframes apf-slide {
          from { opacity:0; transform:translateX(-8px); }
          to   { opacity:1; transform:translateX(0); }
        }
      </style>`;
            document.body.insertAdjacentHTML("beforeend", loaderHTML);
        }

        // ── Loader helpers ────────────────────────────────────────────────────────────
        function showLoader() {
            // Calendar badge
            const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
            const d = new Date();
            document.getElementById("apf-cal-month").textContent = months[d.getMonth()].toUpperCase();
            document.getElementById("apf-cal-date").textContent = d.getDate().toString().padStart(2, "0");
            document.getElementById("apf-cal-day").textContent = days[d.getDay()];

            document.getElementById("event-loader").style.display = "block";

            // Arc spinner on canvas
            const canvas = document.getElementById("apf-arc");
            if (canvas && !canvas._running) {
                canvas._running = true;
                const ctx = canvas.getContext("2d");
                let angle = 0;
                function drawArc() {
                    if (!document.getElementById("event-loader") ||
                        document.getElementById("event-loader").style.display === "none") {
                        canvas._running = false; return;
                    }
                    ctx.clearRect(0, 0, 72, 72);
                    ctx.beginPath(); ctx.arc(36, 36, 28, 0, Math.PI * 2);
                    ctx.strokeStyle = "rgba(30,58,138,0.12)"; ctx.lineWidth = 3; ctx.stroke();
                    ctx.beginPath(); ctx.arc(36, 36, 28, angle, angle + Math.PI * 1.1);
                    ctx.strokeStyle = "#1e3a8a"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.stroke();
                    angle += 0.04; requestAnimationFrame(drawArc);
                }
                drawArc();
            }

            // Build steps
            const stepDefs = [
                { label: "Creating calendar event", icon: "event" },
                { label: "Sending interviewer invites", icon: "mail" },
                { label: "Attaching documents", icon: "clip" },
            ];
            const icons = {
                event: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M5 1v4M11 1v4M2 7h12"/></svg>`,
                mail: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="4" width="12" height="9" rx="2"/><path d="M2 5l6 4 6-4"/></svg>`,
                clip: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M13 7.5L7.5 13A4 4 0 012 7.5l6-6A2.5 2.5 0 0112 5l-5.5 5.5A1 1 0 015 9l4-4"/></svg>`,
            };
            const checkIcon = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l4 4 6-6"/></svg>`;
            const spinDot = `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" fill="#1e3a8a"><animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite"/></circle></svg>`;
            const subTexts = [
                "Creating calendar event…",
                "Sending invites to interviewers…",
                "Attaching CV and documents…",
            ];

            const wrap = document.getElementById("apf-steps");
            wrap.innerHTML = "";
            stepDefs.forEach((s, i) => {
                if (i > 0) {
                    const conn = document.createElement("div");
                    conn.className = "apf-step-conn"; conn.id = "apf-conn-" + i;
                    wrap.appendChild(conn);
                }
                const row = document.createElement("div");
                row.className = "apf-step-row";
                row.style.animationDelay = (i * 0.12) + "s";
                row.innerHTML = `<div class="apf-step-icon" id="apf-icon-${i}">${icons[s.icon]}</div>
                         <div class="apf-step-text" id="apf-txt-${i}">${s.label}</div>`;
                wrap.appendChild(row);
            });

            // Animate steps
            let cur = 0;
            const mainLabel = document.getElementById("apf-main-label");
            const subLabel = document.getElementById("apf-sub-label");
            const bar = document.getElementById("apf-prog-bar");
            const pct = document.getElementById("apf-pct");

            function advance() {
                if (document.getElementById("event-loader").style.display === "none") return;
                if (cur >= stepDefs.length) return;
                if (cur > 0) {
                    document.getElementById("apf-icon-" + (cur - 1)).className = "apf-step-icon done";
                    document.getElementById("apf-icon-" + (cur - 1)).innerHTML = checkIcon;
                    document.getElementById("apf-txt-" + (cur - 1)).className = "apf-step-text done";
                    const conn = document.getElementById("apf-conn-" + cur);
                    if (conn) conn.className = "apf-step-conn done";
                }
                document.getElementById("apf-icon-" + cur).className = "apf-step-icon active";
                document.getElementById("apf-icon-" + cur).innerHTML = spinDot;
                document.getElementById("apf-txt-" + cur).className = "apf-step-text active";
                subLabel.textContent = subTexts[cur];
                const p = Math.round((cur / stepDefs.length) * 100);
                bar.style.width = p + "%"; pct.textContent = p + "%";
                cur++; setTimeout(advance, 1050);
            }
            setTimeout(advance, 600);
        }

        function hideLoader() {
            const loader = document.getElementById("event-loader");
            if (loader) {
                // Mark all steps done on success
                [0, 1, 2].forEach(i => {
                    const icon = document.getElementById("apf-icon-" + i);
                    const txt = document.getElementById("apf-txt-" + i);
                    if (icon) { icon.className = "apf-step-icon done"; icon.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l4 4 6-6"/></svg>`; }
                    if (txt) txt.className = "apf-step-text done";
                });
                const bar = document.getElementById("apf-prog-bar");
                const pct = document.getElementById("apf-pct");
                if (bar) bar.style.width = "100%";
                if (pct) pct.textContent = "100%";
                const ml = document.getElementById("apf-main-label");
                const sl = document.getElementById("apf-sub-label");
                if (ml) ml.textContent = "All done!";
                if (sl) sl.textContent = "Your interview is scheduled";
                setTimeout(() => { loader.style.display = "none"; }, 600);
            }
        }
        showLoader();   // <-- start loader

        // Already scheduled (and not cancelled) => reschedule the existing Outlook
        // event instead of creating a duplicate one.
        const is_reschedule = !!frm.doc.event_id && !frm.doc.is_cancelled;

        frappe.call({
            method: is_reschedule
                ? "ms_calendar.api.ms_philanthropy.update_interview_event"
                : "ms_calendar.api.ms_philanthropy.create_interview_event",
            args: {
                name: frm.doc.name,
                start_datetime: startDateTime,
                end_datetime: endDateTime,
                interviewer_emails: interviewerEmailsString,
                interviewee_email: frm.doc.attendees,
                room_emails: frm.doc.room_email || "",
                is_online: frm.doc.interview_type,
                Organizer_email: frm.doc.organizer_email,
                InterviewersName: interviewerNamesString,
                Applicants_name: frm.doc.applicants_name,
                Applicants_Role: frm.doc.role,
                application_id: frm.doc.application_id,
                Map_location: frm.doc.google_map_link,
                Comments_for_interviewer: frm.doc.message_to_the_interviewer,
                Location_adress: frm.doc.location_address,
                cc_emails: ccEmailsString,
                attachment_paths: attachments
            },

            callback: function (r) {
                hideLoader();   // <-- stop loader

                if (r.message) {
                    frappe.msgprint({
                        title: __("Success"),
                        message: is_reschedule
                            ? __("Interview rescheduled successfully!")
                            : __("Interview scheduled successfully! Event ID: ") + r.message.event_id,
                        indicator: "green"
                    });
                    frm.__unlocked_for_edit = false;
                    frm.reload_doc();
                }
            },

            error: function (err) {
                hideLoader();   // <-- stop loader on failure

                frappe.msgprint({
                    title: __("Error"),
                    message: __("Failed to create calendar event. See console."),
                    indicator: "red"
                });

                console.error("Calendar Event Error:", err);
            }
        });

    },
    interview_date: function (frm) {
        const today = moment().startOf('day');
        const interviewDate = moment(frm.doc.interview_date, "YYYY-MM-DD");

        if (interviewDate.isBefore(today)) {
            frappe.msgprint(__('Interview Date cannot be in the past.'));
            frm.set_value('interview_date', null);
        }
    },

    start_time: function (frm) {
        if (frm.doc.end_time && frm.doc.start_time) {
            const startDateTime = moment(frm.doc.interview_date + " " + frm.doc.start_time);
            const endDateTime = moment(frm.doc.interview_date + " " + frm.doc.end_time);

            if (startDateTime.isAfter(endDateTime)) {
                frappe.msgprint(__('Start Time must be less than End Time.'));
                frm.set_value('start_time', null);
            }
        }
    },

    end_time: function (frm) {
        if (frm.doc.start_time && frm.doc.end_time) {
            const startDateTime = moment(frm.doc.interview_date + " " + frm.doc.start_time);
            const endDateTime = moment(frm.doc.interview_date + " " + frm.doc.end_time);
            if (endDateTime.isBefore(startDateTime)) {
                frappe.msgprint(__('End Time must be greater than Start Time.'));
                frm.set_value('end_time', null);
            }
        }
    },

    check_available_room: function (frm) {
        // Validate required fields
        if (!frm.doc.interview_date || !frm.doc.start_time || !frm.doc.end_time) {
            showCustomDialog(frm, 'Missing Information', 'Please fill Interview Date, Start Time, and End Time.', '#dc2626', 'fa-exclamation-circle');
            return;
        }

        const startDateTime = moment(frm.doc.interview_date + " " + frm.doc.start_time);
        const endDateTime = moment(frm.doc.interview_date + " " + frm.doc.end_time);

        if (endDateTime.isBefore(startDateTime)) {
            showCustomDialog(frm, 'Invalid Time', 'End Time must be greater than Start Time.', '#dc2626', 'fa-clock-o');
            return;
        }

        // Check if required fields exist
        if (!frm.fields_dict.meeting_room) {
            showCustomDialog(frm, 'Configuration Error', 'The "meeting_room" field is missing in the form. Please add it via Customize Form.', '#dc2626', 'fa-cog');
            return;
        }
        if (!frm.fields_dict.room_email) {
            showCustomDialog(frm, 'Configuration Error', 'The "room_email" field is missing in the form. Please add it via Customize Form.', '#dc2626', 'fa-cog');
            return;
        }

        // Always fetch fresh availability from Microsoft Graph — never
        // reuse a previously cached snapshot, even if a room is already
        // picked on this record. A cached snapshot goes stale the moment
        // the interview date/time changes, or someone else books the room
        // in the meantime, and silently showing an out-of-date "Available"
        // is worse than the extra API call this costs.
        frappe.call({
            method: 'ms_calendar.api.msgraph.get_org_rooms_and_availability',
            args: {
                interview_date: frm.doc.interview_date,
                start_time: frm.doc.start_time,
                end_time: frm.doc.end_time
            },
            freeze: true,
            freeze_message: __("Fetching available rooms..."),
            callback: function (r) {
                if (r.message && r.message.rooms) {
                    const rooms = r.message.rooms;
                    // Store room data for reuse — including the raw busy
                    // slots so a room shown via "Show busy rooms too" can
                    // display when it's busy, not just that it is.
                    frm.room_email_map = {};
                    frm.room_availability_map = {};
                    frm.room_capacity_map = {};
                    frm.room_busy_slots_map = {};
                    rooms.forEach(room => {
                        frm.room_email_map[room.name] = room.email;
                        frm.room_availability_map[room.name] = room.is_available;
                        frm.room_capacity_map[room.name] = room.capacity;
                        frm.room_busy_slots_map[room.name] = room.availability || [];
                    });

                    // Seed selected rooms from whatever is already booked on
                    // this record, using the email->name map just built from
                    // the fresh response above (never a stale one).
                    frm.selected_rooms = [];
                    if (frm.doc.room_email && frm.doc.room_email.trim() !== '') {
                        const emails = frm.doc.room_email.split(', ').filter(Boolean);
                        frm.selected_rooms = Object.keys(frm.room_email_map).filter(name => emails.includes(frm.room_email_map[name]));
                    }

                    // Create popup dialog
                        const dialog = new frappe.ui.Dialog({
                            title: __('Select Meeting Rooms'),
                            fields: [{
                                fieldtype: 'HTML',
                                fieldname: 'rooms_display',
                                options: ''
                            }],
                            primary_action_label: __('Block Rooms'),
                            primary_action: function () {
                                if (frm.selected_rooms.length > 0) {
                                    frm.set_value('meeting_room', frm.selected_rooms.join(', '));
                                    frm.set_value('room_email', frm.selected_rooms.map(room => frm.room_email_map[room]).join(', '));
                                    dialog.hide();
                                } else {
                                    showCustomDialog(frm, 'No Rooms Selected', 'Please select at least one available room before confirming.', '#dc2626', 'fa-exclamation-circle');
                                }
                            }
                        });

                        // Generate HTML for room selection
                        let rooms_html = `
                            <style>
                                @keyframes fadeIn {
                                    from { opacity: 0; transform: translateY(-10px); }
                                    to { opacity: 1; transform: translateY(0); }
                                }
                                .room-item:hover[data-available="true"]:not(.selected) {
                                    transform: scale(1.05);
                                }
                                .room-grid {
                                    display: grid;
                                    grid-template-columns: repeat(4, 1fr);
                                    gap: 8px;
                                    padding: 8px;
                                    justify-items: center;
                                    max-height: 300px;
                                    overflow-y: auto;
                                    overflow-x: hidden;
                                }
                                .room-item {
                                    width: 100%;
                                    box-sizing: border-box;
                                    min-width: 0;
                                    min-height: 80px;
                                    position: relative;
                                    padding: 8px;
                                    border: 1px solid #e5e7eb;
                                    border-radius: 4px;
                                    color: white;
                                    text-align: center;
                                    transition: all 0.2s ease;
                                }
                                .room-name {
                                    font-weight: 600;
                                    font-size: 11px;
                                    margin-top: 4px;
                                    margin-bottom: 3px;
                                    word-wrap: break-word;
                                    line-height: 1.3;
                                }
                                .room-capacity {
                                    font-size: 9px;
                                    opacity: 0.9;
                                    margin-bottom: 3px;
                                }
                                .room-status {
                                    font-size: 9px;
                                    opacity: 0.9;
                                }
                                .room-item.busy-visible .room-status {
                                    font-size: 8px;
                                    line-height: 1.25;
                                }
                                .room-search-wrap {
                                    position: relative;
                                    margin-bottom: 8px;
                                }
                                .room-search-wrap .fa-search {
                                    position: absolute;
                                    left: 10px;
                                    top: 50%;
                                    transform: translateY(-50%);
                                    color: #9ca3af;
                                    font-size: 11px;
                                    pointer-events: none;
                                }
                                .room-search-input {
                                    width: 100%;
                                    box-sizing: border-box;
                                    padding: 7px 10px 7px 28px;
                                    font-size: 11px;
                                    color: #1f2937;
                                    border: 1px solid #d1d5db;
                                    border-radius: 6px;
                                    outline: none;
                                    background: #fff;
                                    transition: border-color 0.15s ease, box-shadow 0.15s ease;
                                }
                                .room-search-input:focus {
                                    border-color: #3b82f6;
                                    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
                                }
                                .show-busy-row {
                                    display: flex;
                                    align-items: center;
                                    gap: 6px;
                                    margin-bottom: 8px;
                                    font-size: 10px;
                                    color: #4b5563;
                                    cursor: pointer;
                                    user-select: none;
                                }
                                .show-busy-row input[type="checkbox"] {
                                    margin: 0;
                                    cursor: pointer;
                                }
                                @media (max-width: 600px) {
                                    .room-grid {
                                        grid-template-columns: repeat(3, 1fr);
                                    }
                                }
                                @media (max-width: 400px) {
                                    .room-grid {
                                        grid-template-columns: repeat(2, 1fr);
                                    }
                                }
                            </style>
                            <div style="padding: 12px; background: #f9fafb; border-radius: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.1); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;">
                                <div style="margin-bottom: 8px; text-align: center; font-size: 12px; font-weight: 600; color: #1e3a8a; background: #e0e7ff; padding: 6px; border-radius: 3px;">
                                    <i class="fa fa-calendar" style="margin-right: 4px;"></i>Time Slot: ${moment(frm.doc.interview_date + " " + frm.doc.start_time).format('h:mm A')} - ${moment(frm.doc.interview_date + " " + frm.doc.end_time).format('h:mm A')}
                                </div>
                                <div class="legend" style="display: flex; justify-content: center; gap: 10px; margin-bottom: 10px; font-size: 10px; color: #1f2937; background: #f1f5f9; padding: 4px; border-radius: 3px;">
                                    <div><span style="color: #10b981; font-size: 10px; margin-right: 2px;">●</span>Available</div>
                                    <div><span style="color: #ef4444; font-size: 10px; margin-right: 2px;">●</span>Busy</div>
                                    <div><span style="color: #3b82f6; font-size: 10px; margin-right: 2px;">●</span>Selected</div>
                                </div>
                                <div class="room-search-wrap">
                                    <i class="fa fa-search"></i>
                                    <input type="text" class="room-search-input" placeholder="${__('Search room name…')}">
                                </div>
                                <label class="show-busy-row">
                                    <input type="checkbox" class="show-busy-toggle">
                                    ${__('Show busy rooms too')}
                                </label>
                                <div class="room-grid" style="animation: fadeIn 0.3s ease-in;"></div>
                            </div>
                        `;

                        // Set HTML in dialog
                        dialog.fields_dict.rooms_display.$wrapper.html(rooms_html);

                        function bindRoomItemEvents() {
                            // Add click event for room selection
                            dialog.$wrapper.find('.room-item[data-available="true"]').on('click', function () {
                                const roomName = $(this).data('room');
                                if (frm.selected_rooms.includes(roomName)) {
                                    frm.selected_rooms = frm.selected_rooms.filter(r => r !== roomName);
                                } else {
                                    frm.selected_rooms.push(roomName);
                                }
                                renderRoomGrid();
                            });

                            // Add hover effects for available rooms
                            dialog.$wrapper.find('.room-item[data-available="true"]').hover(
                                function () {
                                    if (!$(this).hasClass('selected')) {
                                        $(this).css({ 'transform': 'scale(1.05)', 'box-shadow': '0 2px 4px rgba(0,0,0,0.15)' });
                                    }
                                },
                                function () {
                                    if (!$(this).hasClass('selected')) {
                                        $(this).css({ 'transform': 'scale(1)', 'box-shadow': 'none' });
                                    }
                                }
                            );
                        }

                        // Only Available rooms are shown by default — Busy ones
                        // stay hidden unless already selected for this booking,
                        // or the recruiter ticks "Show busy rooms too", in which
                        // case busy rooms reappear labelled with their actual
                        // busy time range (via room.availability from the API).
                        function renderRoomGrid() {
                            const term = (dialog.$wrapper.find('.room-search-input').val() || '').toLowerCase().trim();
                            const showBusy = dialog.$wrapper.find('.show-busy-toggle').is(':checked');

                            const visible = rooms.filter(room => {
                                if (!room.name.toLowerCase().includes(term)) return false;
                                const isSelected = frm.selected_rooms.includes(room.name);
                                return room.is_available || isSelected || showBusy;
                            });

                            let html = '';
                            if (visible.length === 0) {
                                html = `
                                    <div style="grid-column: 1 / -1; text-align: center; padding: 16px; font-size: 11px; color: #6b7280;">
                                        ${__('No rooms match for this time slot.')}
                                    </div>
                                `;
                            }

                            visible.forEach(room => {
                                const isAvailable = room.is_available;
                                const isSelected = frm.selected_rooms.includes(room.name);
                                const bgColor = isAvailable ? '#10b981' : '#ef4444';
                                const statusText = isSelected ? 'Selected' : (isAvailable ? 'Available' : formatBusyTimes(room.availability));
                                const icon = isAvailable ? '<i class="fa fa-check-circle" style="font-size: 10px;"></i>' : '<i class="fa fa-times-circle" style="font-size: 10px;"></i>';
                                const selectedStyle = isSelected ? 'border: 2px solid #3b82f6; transform: scale(1.03); box-shadow: 0 2px 6px rgba(0,0,0,0.15); background: #3b82f6;' : '';
                                html += `
                                    <div class="room-item ${isAvailable ? '' : 'disabled busy-visible'} ${isSelected ? 'selected' : ''}" data-room="${room.name}" data-available="${isAvailable}"
                                        style="background: ${isSelected ? '#3b82f6' : bgColor}; ${isAvailable ? 'cursor: pointer;' : 'cursor: not-allowed; opacity: 0.75;'} ${selectedStyle}">
                                        <div style="position: absolute; top: -4px; left: -4px; width: 18px; height: 18px; background: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 1px rgba(0,0,0,0.1);">${icon}</div>
                                        <div class="room-name">${room.name}</div>
                                        <div class="room-capacity">Capacity: ${room.capacity}</div>
                                        <div class="room-status">${statusText}</div>
                                    </div>
                                `;
                            });

                            dialog.$wrapper.find('.room-grid').html(html);
                            bindRoomItemEvents();
                        }

                        renderRoomGrid();
                        dialog.$wrapper.find('.room-search-input').on('input', renderRoomGrid);
                        dialog.$wrapper.find('.show-busy-toggle').on('change', renderRoomGrid);

                        // Style dialog buttons
                        dialog.$wrapper.find('.btn-primary').css({
                            'background': 'linear-gradient(135deg, #1e40af, #3b82f6)',
                            'border': 'none',
                            'border-radius': '4px',
                            'padding': '6px 12px',
                            'font-weight': '500',
                            'transition': 'all 0.2s ease',
                            'box-shadow': '0 1px 3px rgba(0,0,0,0.1)'
                        }).hover(
                            function () { $(this).css('background', 'linear-gradient(135deg, #2b6cb0, #60a5fa)'); },
                            function () { $(this).css('background', 'linear-gradient(135deg, #1e40af, #3b82f6)'); }
                        );

                        // Show dialog with animation
                        dialog.show();
                        dialog.$wrapper.find('.modal-content').css({
                            'animation': 'fadeIn 0.3s ease-in',
                            'border-radius': '6px',
                            'max-width': '700px',
                            'padding': '8px'
                        });

                        // Show message if no rooms are available
                        const available_rooms = rooms.filter(room => room.is_available);
                        if (available_rooms.length === 0) {
                            showCustomDialog(frm, 'No Rooms Available', 'No rooms are available for the selected time slot.', '#f59e0b', 'fa-exclamation-triangle');
                        }
                    } else {
                        showCustomDialog(frm, 'Error', 'Failed to fetch room availability. Please try again.', '#dc2626', 'fa-exclamation-circle');
                    }
                },
                error: function (err) {
                    showCustomDialog(frm, 'Error', 'Failed to fetch room availability. Please check the console.', '#dc2626', 'fa-exclamation-circle');
                    console.error("Room Availability Error:", err);
                }
            });
    },

    meeting_room: function (frm) {
        const selected_rooms = frm.doc.meeting_room ? frm.doc.meeting_room.split(', ') : [];
        if (selected_rooms.length > 0 && frm.room_email_map) {
            const emails = selected_rooms.map(room => frm.room_email_map[room] || '').filter(email => email);
            frm.set_value('room_email', emails.join(', '));
            console.log(frm.doc.room_email, "room email");
            // Check if any selected room is busy
            const hasBusyRoom = selected_rooms.some(room => !frm.room_availability_map[room]);
            if (hasBusyRoom) {
                showCustomDialog(frm, 'Room Unavailable', 'One or more selected rooms are busy for the chosen time slot.', '#f59e0b', 'fa-exclamation-triangle');
            }
        } else {
            frm.set_value('room_email', '');
        }
    },

    check_availability: function (frm) {
        console.log("working")
        let selected_emails = (frm.doc.interviewer_email || []).map(row => row.interviewer_email);
        console.log("Selected emails:", selected_emails);

        if (!selected_emails.length || !frm.doc.interview_date) {
            frappe.msgprint({
                title: __('Missing Information'),
                indicator: 'red',
                message: __('Please enter at least one interviewer email and the interview date.')
            });
            return;
        }

        frm.get_field('available_slots').$wrapper.html(`
            <div class="availability-loader text-center p-5">
                <div class="spinner-border text-primary mb-3" style="width: 3rem; height: 3rem;" role="status"></div>
                <h5 class="fw-bold">Checking Availability...</h5>
                <p class="text-muted">Please wait while we fetch available slots.</p>
            </div>
        `);

        frm.toggle_display('available_slots_section', true);

        frappe.call({
            method: 'ms_calendar.api.msgraph.get_schedule_free_slots',
            args: {
                interviewer_emails: selected_emails,
                interview_date: frm.doc.interview_date
            },
            callback: function (r) {
                if (r.message) {
                    let allSchedulesHtml = '';

                    Object.keys(r.message).forEach(email => {
                        const intervals = r.message[email];
                        const processedEvents = intervals.map(interval => {
                            const startUtc = moment.utc(interval.start.dateTime);
                            const endUtc = moment.utc(interval.end.dateTime);

                            const start = startUtc.local();
                            const end = endUtc.local();

                            return {
                                title: "Busy",
                                type: interval.location?.displayName || "Meeting",
                                attendee: interval.organizer?.emailAddress?.name || "Unknown",
                                startHour: start.hours() + start.minutes() / 60,
                                endHour: end.hours() + end.minutes() / 60,
                                displayStartTime: start.format("h:mm A"),
                                displayEndTime: end.format("h:mm A"),
                                color: '#e74c3c'
                            };
                        });

                        const scheduleHtml = frm.events.generate_schedule_html(frm, processedEvents, email);
                        allSchedulesHtml += scheduleHtml;
                    });

                    frm.get_field('available_slots').$wrapper.html(allSchedulesHtml);

                    setTimeout(() => {
                        $('.schedule-event').on('click', function () {
                            const startTime = $(this).data('start');
                            const endTime = $(this).data('end');
                            const title = $(this).data('title');
                            const type = $(this).data('type');

                            frappe.msgprint({
                                title: title === 'Busy' ? 'Busy Slot' : 'Available Time Slot',
                                message: `
                                    <div class="event-details">
                                        <p><strong>${title}</strong></p>
                                        <p><strong>Time:</strong> ${startTime} - ${endTime}</p>
                                        ${title === 'Busy' ? `<p><strong>Type:</strong> ${type}</p>` : ""}
                                    </div>
                                `
                            });
                        });
                    }, 100);
                } else {
                    frm.get_field('available_slots').$wrapper.html(`
                        <div class="alert alert-danger d-flex align-items-center" role="alert">
                            <svg class="bi flex-shrink-0 me-2" width="24" height="24" role="img" aria-label="Danger:">
                                <use xlink:href="#exclamation-triangle-fill"/>
                            </svg>
                            <div>An error occurred while fetching availability.</div>
                        </div>
                    `);
                }
            },
            error: function (err) {
                frappe.msgprint({
                    title: __("Error"),
                    message: __("Failed to fetch schedule. Please check the console."),
                    indicator: "red"
                });
                console.error("Schedule Fetch Error:", err);
            }
        });
    },

    generate_schedule_html: function (frm, events, email) {
        const day_start_hour = 8;
        const day_end_hour = 18;
        const total_hours = day_end_hour - day_start_hour;
        const SLOT_WIDTH_PX = 80;

        let timeSlotsHtml = '';
        for (let i = day_start_hour; i < day_end_hour; i++) {
            const hour = i % 12 === 0 ? 12 : i % 12;
            const ampm = i < 12 ? 'AM' : 'PM';

            timeSlotsHtml += `
                <div class="time-slot-group" style="width: ${SLOT_WIDTH_PX * 2}px;">
                    <div class="time-slot-hour">
                        <div class="hour-label major">${hour}:00 ${ampm}</div>
                        <div class="hour-line major"></div>
                    </div>
                    <div class="time-slot-half">
                        <div class="hour-label minor">${hour}:30</div>
                        <div class="hour-line minor"></div>
                    </div>
                </div>
            `;
        }

        const finalHour = day_end_hour % 12 === 0 ? 12 : day_end_hour % 12;
        const finalAmpm = day_end_hour < 12 ? 'AM' : 'PM';
        timeSlotsHtml += `
            <div class="time-slot-final" style="width: ${SLOT_WIDTH_PX}px;">
                <div class="hour-label major">${finalHour}:00 ${finalAmpm}</div>
                <div class="hour-line major"></div>
            </div>
        `;

        let eventsHtml = '';
        events.forEach((event, index) => {
            if (event.endHour <= day_start_hour || event.startHour >= day_end_hour) {
                return;
            }

            const startHour = Math.max(event.startHour, day_start_hour);
            const endHour = Math.min(event.endHour, day_end_hour);

            const leftPercentage = ((startHour - day_start_hour) / total_hours) * 100;
            const widthPercentage = ((endHour - startHour) / total_hours) * 100;

            eventsHtml += `
                <div class="schedule-event event-busy" 
                     data-start="${event.displayStartTime}"
                     data-end="${event.displayEndTime}"
                     data-title="Busy"
                     data-type="${event.type}"
                     style="left: ${leftPercentage}%; width: ${widthPercentage}%;">
                    <div class="event-content">
                        <div class="event-title">Busy</div>
                        <div class="event-time">${event.displayStartTime} - ${event.displayEndTime}</div>
                    </div>
                    <div class="event-tooltip">
                        <strong>Busy</strong><br>
                        ${event.displayStartTime} - ${event.displayEndTime}<br>
                        <em>(${event.type})</em>
                    </div>
                </div>
            `;
        });

        const freeSlots = frm.events.calculate_free_slots(events, day_start_hour, day_end_hour);
        freeSlots.forEach(slot => {
            const leftPercentage = ((slot.start - day_start_hour) / total_hours) * 100;
            const widthPercentage = ((slot.end - slot.start) / total_hours) * 100;

            if (widthPercentage > 0) {
                const startFormatted = moment().hour(Math.floor(slot.start)).minute((slot.start % 1) * 60).format("h:mm A");
                const endFormatted = moment().hour(Math.floor(slot.end)).minute((slot.end % 1) * 60).format("h:mm A");

                eventsHtml += `
                    <div class="schedule-event event-free" 
                         data-start="${startFormatted}"
                         data-end="${endFormatted}"
                         data-title="Free"
                         style="left: ${leftPercentage}%; width: ${widthPercentage}%;">
                        <div class="event-content">
                            <div class="event-title">Free</div>
                            <div class="event-time">${startFormatted} - ${endFormatted}</div>
                        </div>
                        <div class="event-tooltip">
                            <strong>Free</strong><br>
                            ${startFormatted} - ${endFormatted}
                        </div>
                    </div>
                `;
            }
        });

        return `
            <div class="schedule-container">
                <div class="schedule-header">
                    <div class="header-content">
                        <div class="date-section">
                            <h5 class="schedule-date">${moment(frm.doc.interview_date).format('dddd, MMMM DD, YYYY')}</h5>
                        </div>
                        <div class="email-info">
                            <span class="email-label">Calendar Events for</span>
                            <span class="email-address">${email}</span>
                        </div>
                    </div>
                </div>

                <div class="schedule-legend">
                    <div class="legend-items">
                        <div class="legend-item">
                            <div class="legend-dot busy"></div>
                            <span>Busy</span>
                        </div>
                        <div class="legend-item">
                            <div class="legend-dot available"></div>
                            <span>Free</span>
                        </div>
                    </div>
                </div>

                <div class="timeline-section">
                    <div class="time-labels">
                        ${timeSlotsHtml}
                    </div>

                    <div class="timeline-grid">
                        <div class="timeline-track"></div>
                        ${eventsHtml}
                    </div>
                </div>

                <div class="schedule-footer">
                    <div class="footer-stats"></div>
                </div>
            </div>

            <style>
                .schedule-container {
                    max-width: 1200px;
                    margin: 20px auto;
                    background: white;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px -1px rgba(0, 0, 0, 0.1);
                    border: 1px solid #e2e8f0;
                    overflow: hidden;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                }

                .schedule-header {
                    padding: 0.75rem;
                    border-bottom: 1px solid #e2e8f0;
                    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
                }

                .header-content {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                }

                .date-section {
                    flex: 1;
                }

                .schedule-date {
                    font-size: 0.8rem;
                    font-weight: 700;
                    color: #1e293b;
                    margin: 0 0 0.25rem 0;
                    letter-spacing: -0.025em;
                }

                .email-info {
                    display: flex;
                    flex-direction: column;
                    gap: 0.1rem;
                }

                .email-label {
                    color: #64748b;
                    font-size: 0.65rem;
                    font-weight: 500;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                }

                .email-address {
                    color: #374151;
                    font-size: 0.75rem;
                    font-weight: 600;
                    font-family: 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
                }

                .schedule-legend {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 0.4rem 0.75rem;
                    background: #f8fafc;
                    border-bottom: 1px solid #e2e8f0;
                }

                .legend-items {
                    display: flex;
                    gap: 1rem;
                }

                .legend-item {
                    display: flex;
                    align-items: center;
                    gap: 0.3rem;
                    font-size: 0.65rem;
                    color: #475569;
                }

                .legend-dot {
                    width: 10px;
                    height: 10px;
                    border-radius: 3px;
                }

                .legend-dot.busy {
                    background: #f87171;
                    border: 1px solid #f87171;
                }

                .legend-dot.available {
                    background: #6ee7b7;
                    border: 1px solid #6ee7b7;
                }

                .timeline-section {
                    padding: 0.75rem;
                    overflow-x: auto;
                }

                .time-labels {
                    display: flex;
                    margin-bottom: 0.2rem;
                    min-width: 800px;
                }

                .time-slot-group, .time-slot-final {
                    display: flex;
                    flex-direction: column;
                    position: relative;
                }

                .time-slot-group {
                    justify-content: space-between;
                }

                .time-slot-hour, .time-slot-half {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    flex: 1;
                    gap: 0.15rem;
                }

                .time-slot-final {
                    align-items: center;
                    gap: 0.15rem;
                }

                .hour-label {
                    font-size: 0.55rem;
                    color: #64748b;
                    text-align: center;
                }

                .hour-label.major {
                    font-weight: 600;
                    color: #374151;
                    font-size: 0.6rem;
                }

                .hour-label.minor {
                    font-weight: 500;
                    color: #6b7280;
                    font-size: 0.5rem;
                }

                .hour-line {
                    width: 1px;
                    height: 6px;
                }

                .hour-line.major {
                    background: #374151;
                    height: 10px;
                    width: 1.5px;
                }

                .hour-line.minor {
                    background: #6b7280;
                    height: 4px;
                    width: 1px;
                }

                .timeline-grid {
                    position: relative;
                    height: 40px;
                    border: 1px solid #e2e8f0;
                    border-radius: 6px;
                    background: #ffffff;
                    min-width: 800px;
                }

                .timeline-track {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: repeating-linear-gradient(
                        to right,
                        transparent 0%,
                        transparent 4.9%,
                        rgba(107, 114, 128, 0.3) 4.9%,
                        rgba(107, 114, 128, 0.3) 5%,
                        transparent 5%,
                        transparent 9.9%,
                        rgba(55, 65, 81, 0.4) 9.9%,
                        rgba(55, 65, 81, 0.4) 10%
                    );
                }

                .schedule-event {
                    position: absolute;
                    top: 2px;
                    bottom: 2px;
                    border-radius: 4px;
                    padding: 0.15rem;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    min-width: 40px;
                    z-index: 2;
                    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
                    overflow: hidden;
                }

                .schedule-event:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
                    z-index: 10;
                }

                .event-busy {
                    background: linear-gradient(135deg, #f87171, #fb7185) !important;
                    color: white !important;
                    border: 1px solid #f87171 !important;
                }

                .event-busy:hover {
                    background: linear-gradient(135deg, #fb7185, #f87171) !important;
                }

                .event-free {
                    background: linear-gradient(135deg, #6ee7b7, #34d399) !important;
                    color: white !important;
                    border: 1px solid #6ee7b7 !important;
                }

                .event-free:hover {
                    background: linear-gradient(135deg, #34d399, #6ee7b7) !important;
                }

                .event-content {
                    text-align: center;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .event-title {
                    font-weight: 600;
                    font-size: 0.55rem;
                    line-height: 1;
                    margin-bottom: 0.05rem;
                    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .event-time {
                    font-size: 0.5rem;
                    opacity: 0.9;
                    line-height: 1;
                    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .event-tooltip {
                    visibility: hidden;
                    position: absolute;
                    bottom: calc(100% + 6px);
                    left: 50%;
                    transform: translateX(-50%);
                    background: #1f2937;
                    color: white;
                    padding: 0.3rem 0.5rem;
                    border-radius: 4px;
                    font-size: 0.55rem;
                    z-index: 1000;
                    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
                    white-space: nowrap;
                    opacity: 0;
                    transition: all 0.3s ease;
                }

                .event-tooltip::after {
                    content: '';
                    position: absolute;
                    top: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    border: 4px solid transparent;
                    border-top-color: #1f2937;
                }

                .schedule-event:hover .event-tooltip {
                    visibility: visible;
                    opacity: 1;
                }

                .schedule-footer {
                    padding: 0.75rem;
                    background: #f8fafc;
                    border-top: 1px solid #e2e8f0;
                }

                .footer-stats {
                    display: flex;
                    gap: 1.5rem;
                }

                @media (max-width: 768px) {
                    .schedule-container {
                        border-radius: 6px;
                    }

                    .schedule-header {
                        padding: 0.5rem;
                    }

                    .header-content {
                        flex-direction: column;
                        gap: 0.75rem;
                        align-items: flex-start;
                    }

                    .schedule-date {
                        font-size: 1rem;
                    }

                    .email-address {
                        font-size: 0.7rem;
                        word-break: break-all;
                    }

                    .schedule-legend {
                        padding: 0.3rem 0.5rem;
                        flex-direction: column;
                        gap: 0.5rem;
                        align-items: flex-start;
                    }

                    .timeline-section {
                        padding: 0.5rem;
                    }

                    .hour-label.major {
                        font-size: 0.55rem;
                    }

                    .hour-label.minor {
                        font-size: 0.5rem;
                    }

                    .schedule-event {
                        padding: 0.15rem;
                    }

                    .event-title {
                        font-size: 0.55rem;
                        margin-bottom: 0.05rem;
                    }

                    .event-time {
                        font-size: 0.5rem;
                    }

                    .footer-stats {
                        gap: 1rem;
                        justify-content: center;
                    }
                }

                @media (max-width: 480px) {
                    .hour-label.minor {
                        display: none;
                    }

                    .event-title {
                        font-size: 0.5rem;
                    }

                    .event-time {
                        font-size: 0.45rem;
                    }

                    .footer-stats {
                        gap: 0.75rem;
                    }
                }
            </style>
        `;
    },
    calculate_free_slots: function (events, day_start_hour, day_end_hour) {
        const slots = [];
        let currentHour = day_start_hour;

        const sortedEvents = events
            .filter(e => e.endHour > day_start_hour && e.startHour < day_end_hour)
            .sort((a, b) => a.startHour - b.startHour);

        sortedEvents.forEach(event => {
            const start = Math.max(event.startHour, day_start_hour);
            if (currentHour < start) {
                slots.push({ start: currentHour, end: start });
            }
            currentHour = Math.max(currentHour, event.endHour);
        });

        if (currentHour < day_end_hour) {
            slots.push({ start: currentHour, end: day_end_hour });
        }

        return slots;
    }
});


// Utility function to show styled dialogs
function showCustomDialog(frm, title, message, color, icon) {
    const dialog = new frappe.ui.Dialog({
        title: __(title),
        fields: [{
            fieldtype: 'HTML',
            options: `<div style="padding: 8px; font-size: 11px; color: ${color};"><i class="fa ${icon}" style="margin-right: 4px;"></i>${message}</div>`
        }],
        primary_action_label: __('OK'),
        primary_action: function () { dialog.hide(); }
    });
    dialog.show();
    dialog.$wrapper.find('.modal-content').css({
        'border-radius': '6px',
        'box-shadow': '0 3px 8px rgba(0,0,0,0.1)'
    });
    dialog.$wrapper.find('.btn-primary').css({
        'background': color,
        'border': 'none',
        'border-radius': '4px',
        'padding': '6px 12px'
    });
    return dialog;
}