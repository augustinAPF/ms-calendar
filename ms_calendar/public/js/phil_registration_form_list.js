// Phil Registration Form — list view.
//
// Adds a "Download CVs" button that appears the moment a recruiter ticks
// one or more applicants, and zips up every ticked applicant's `cv_attach`
// into a single download instead of making them open each application and
// save the CV one at a time.
//
// hooks.py loads this through app_include_js (not doctype_list_js): Phil
// Registration Form is a Custom DocType, and the doctype_* hooks are
// skipped for custom doctypes — same reason frf_list.js is loaded that way.

frappe.listview_settings['Phil Registration Form'] = {

    onload(listview) {
        setup_cv_download_button(listview);

        // Scoped to this list's own result area rather than $(document):
        // this file is included on every page, so a global binding would
        // keep firing against a stale listview after navigating away.
        listview.$result.on("change", "input[type=checkbox]", () => {
            toggle_cv_download_button(listview);
        });
    },

    refresh(listview) {
        // A re-render clears the checkboxes without firing a change event,
        // so re-evaluate the button here too.
        toggle_cv_download_button(listview);
    }
};

// ---------------------------------------------------------------------------
// DOWNLOAD CVs BUTTON
// ---------------------------------------------------------------------------
// The button is built once and then shown/hidden with the selection, rather
// than added and removed: add_inner_button() also registers a matching item
// in the page's "⋯" menu for mobile, and that item is not something
// removing the returned button would ever clean up.
function setup_cv_download_button(listview) {
    if (listview._cv_download_btn) return;

    let btn = listview.page.add_inner_button(
        '<i class="fa fa-download"></i> Download CVs',
        () => handle_cv_download(listview)
    );
    if (!btn) return;

    listview._cv_download_btn = btn;

    btn.removeClass("btn-secondary")
        .addClass("btn-primary")
        .css({
            "background-color": "black",
            "border-color": "black",
            "color": "white"
        })
        .hide();
}

function toggle_cv_download_button(listview) {
    if (!listview._cv_download_btn) return;
    listview._cv_download_btn.toggle(listview.get_checked_items().length > 0);
}

// ---------------------------------------------------------------------------
// DOWNLOAD FLOW
// ---------------------------------------------------------------------------
function handle_cv_download(listview) {

    let names = listview.get_checked_items().map(d => d.name);
    if (!names.length) return;

    // Ask the server what's actually downloadable first. Once the browser
    // starts navigating to the zip there's no way left to tell the
    // recruiter that some of their picks had no CV attached.
    frappe.call({
        method: "ms_calendar.api.phil_cv_download.get_cv_download_summary",
        args: { names: JSON.stringify(names) },
        freeze: true,
        freeze_message: __("Checking attached CVs…"),
        callback(r) {
            let summary = r.message;
            if (!summary) return;

            if (!summary.with_cv) {
                frappe.msgprint({
                    title: __("No CVs to download"),
                    message: __("None of the {0} selected applicants have a CV attached.",
                        [summary.total]),
                    indicator: "orange"
                });
                return;
            }

            if (summary.too_large) {
                frappe.msgprint({
                    title: __("Selection too large"),
                    message: __("The {0} selected CVs add up to {1} MB, over the {2} MB limit. Please download them in smaller batches.",
                        [summary.with_cv, summary.total_size_mb, summary.size_limit_mb]),
                    indicator: "red"
                });
                return;
            }

            if (!summary.missing.length) {
                start_cv_download(names, summary.with_cv);
                return;
            }

            let missing_list = summary.missing
                .map(m => `<li>${frappe.utils.escape_html(m.applicant || "")} <span style="color:#94a3b8">(${m.name})</span></li>`)
                .join("");

            frappe.confirm(
                `${__("{0} of the {1} selected applicants have no CV attached and will be skipped:",
                    [summary.missing.length, summary.total])}
                 <ul style="margin:8px 0 0 0;padding-left:18px;max-height:180px;overflow:auto;">${missing_list}</ul>
                 <p style="margin-top:10px;">${__("Download the remaining {0} CV(s)?", [summary.with_cv])}</p>`,
                () => start_cv_download(names, summary.with_cv)
            );
        }
    });
}

function start_cv_download(names, count) {
    // A form POST, not frappe.call: the selection can run to hundreds of
    // ids (too long for a GET query string), and the browser has to
    // navigate to the response for it to land as a saved file.
    open_url_post("/api/method/ms_calendar.api.phil_cv_download.download_cvs", {
        names: JSON.stringify(names)
    });

    frappe.show_alert({
        message: __("Preparing {0} CV(s) — the zip will download shortly.", [count]),
        indicator: "green"
    }, 7);
}
