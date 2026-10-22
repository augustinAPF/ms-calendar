// Form "Activity" timeline: show the exact date + time ("20-10-2026, 3:42 PM")
// instead of Frappe's relative "2 days ago". The relative text moves to the
// hover tooltip. Only timestamps inside a form timeline (.new-timeline) are
// touched — list views, notifications etc. keep the relative format.
//
// Frappe renders these as <span class="frappe-timestamp" data-timestamp="…">
// (comment_when) and frappe.datetime.refresh_when() rewrites every one of
// them back to relative text once a minute, so that is wrapped too.
(function () {
	// Also pasted on UAT as a Form Client Script — load only once.
	if (window.__pw_activity_exact_time) return;
	window.__pw_activity_exact_time = true;

	const SEL = ".new-timeline .frappe-timestamp";

	function exact(ts) {
		const m = moment(frappe.datetime.convert_to_user_tz(ts));
		if (!m.isValid()) return null;
		return m.format(frappe.datetime.get_user_date_fmt().toUpperCase() + ", h:mm A");
	}

	function apply(root) {
		$(root || document).find(SEL).each(function () {
			const ts = this.getAttribute("data-timestamp");
			const text = ts && exact(ts);
			// Only write when it differs, so the observer below doesn't loop.
			if (!text || this.textContent === text) return;
			this.textContent = text;
			this.title = frappe.datetime.prettyDate(ts);
		});
	}

	$(function () {
		const refresh_when = frappe.datetime.refresh_when;
		frappe.datetime.refresh_when = function () {
			refresh_when.apply(this, arguments);
			apply();
		};

		// The timeline is (re)drawn whenever a form loads or a new
		// comment / email / version lands, so watch for it.
		let pending = false;
		new MutationObserver(() => {
			if (pending) return;
			pending = true;
			requestAnimationFrame(() => {
				pending = false;
				apply();
			});
		}).observe(document.body, { childList: true, subtree: true });

		apply();
	});
})();
