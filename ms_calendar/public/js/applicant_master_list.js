// "Fetch All Data" — pulls every existing record from one of the four
// registration forms into Applicant Master (see
// ms_calendar.api.applicant_master_sync.fetch_all_from_form / run_backfill).
// New submissions already sync automatically as they're saved; this button
// is for backfilling records that existed before that, or re-running the
// sync after a field-mapping fix.

const APPLICANT_MASTER_SOURCE_FORMS = [
    "Field Registration Form",
    "Health Registration Form",
    "Phil Registration Form",
    "Scholarship Recruitment Form",
];

frappe.listview_settings['Applicant Master'] = {

    onload(listview) {
        listview.page.add_inner_button(
            '<i class="fa fa-download"></i> Fetch All Data',
            () => open_fetch_all_data_dialog(listview)
        );
    }
};

function open_fetch_all_data_dialog(listview) {
    let d = new frappe.ui.Dialog({
        title: "Fetch All Data",
        fields: [
            {
                fieldname: "intro_html",
                fieldtype: "HTML",
                options: `<div style="font-size:12.5px;color:#64748b;margin-bottom:4px;">
                    Pick a registration form. Every existing record in that form will be
                    synced into Applicant Master (matched by Zayam Id, or by email if it
                    doesn't have one yet). This runs in the background — you'll see a
                    progress bar and a summary when it's done.
                </div>`
            },
            {
                label: "Registration Form",
                fieldname: "source_doctype",
                fieldtype: "Select",
                options: APPLICANT_MASTER_SOURCE_FORMS,
                reqd: 1
            }
        ],
        primary_action_label: "Fetch",
        primary_action: (values) => {
            d.hide();
            frappe.call({
                method: "ms_calendar.api.applicant_master_sync.fetch_all_from_form",
                args: { source_doctype: values.source_doctype },
                callback() {
                    frappe.show_alert({
                        message: `Fetching all data from ${values.source_doctype}…`,
                        indicator: "blue"
                    }, 6);
                }
            });
        }
    });
    d.show();
}

// Fired once by run_backfill() when a fetch finishes (see
// applicant_master_sync.py). frappe.publish_progress() along the way
// drives the built-in progress bar automatically — nothing to wire up here
// for that part.
frappe.realtime.on("applicant_master_backfill_done", (data) => {
    let message = `<b>${frappe.utils.escape_html(data.source_doctype)}</b>: ${data.ok} / ${data.total} synced.`;
    if (data.error_count) {
        let shown = (data.errors || []).map(e => frappe.utils.escape_html(e.split("\n")[0])).join("<br>");
        message += `<br><br><span style="color:#dc2626;">${data.error_count} error(s)`
            + `${data.error_count > (data.errors || []).length ? " (first " + (data.errors || []).length + " shown, rest in Error Log)" : ""}:</span>`
            + `<br>${shown}`;
    }
    frappe.msgprint({
        title: "Fetch All Data — finished",
        message,
        indicator: data.error_count ? "orange" : "green"
    });
    if (cur_list && cur_list.doctype === "Applicant Master") {
        cur_list.refresh();
    }
});
