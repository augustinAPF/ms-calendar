// "Download Merged PDF" — combines every attached document (PAN, Aadhaar,
// certificates, etc.) on this record into a single PDF instead of making
// the reviewer download each attachment one at a time. The actual merge
// happens server-side in ms_calendar.api.document_merge.download_merged_pdf;
// this just triggers it and saves the result.
function download_merged_pdf(frm) {
    frappe.call({
        method: "ms_calendar.api.document_merge.download_merged_pdf",
        args: {
            doctype: frm.doctype,
            name: frm.doc.name,
        },
        freeze: true,
        freeze_message: __("Merging attachments…"),
        callback: function (r) {
            if (!r.message || !r.message.filedata) {
                return;
            }
            const { filename, filedata, skipped } = r.message;

            const byteChars = atob(filedata);
            const bytes = new Uint8Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) {
                bytes[i] = byteChars.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: "application/pdf" });
            const url = URL.createObjectURL(blob);

            const link = document.createElement("a");
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            if (skipped && skipped.length) {
                frappe.msgprint({
                    title: __("Some attachments were skipped"),
                    indicator: "orange",
                    message: __("Could not merge: {0}", [skipped.join(", ")]),
                });
            }
        },
        error: function (err) {
            frappe.msgprint({
                title: __("Error"),
                message: __("Failed to merge attachments. See console."),
                indicator: "red",
            });
            console.error("Merge PDF Error:", err);
        },
    });
}

frappe.ui.form.on("Health Document Collection", {
    refresh: function (frm) {
        if (frm.is_new()) {
            return;
        }
        frm.add_custom_button(__("Download Merged PDF"), () => download_merged_pdf(frm));
    },
});
