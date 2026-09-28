frappe.pages['reports'].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Reports',
		single_column: true
	});

	// ── Shared constants ─────────────────────────────────────────────────
	function getCol(role) {
		var r = (role || '').trim().toLowerCase();
		// Real role values are things like "School Teacher - Barmer",
		// "Azim Premji School: School Teacher Education", etc. — an exact
		// match against "school teacher" only ever caught the plain,
		// unsuffixed value (159 records) and silently miscounted the other
		// 38,000+ teacher variants as Resource Person. Substring match,
		// same approach already used for health/livelihood below.
		if (r.includes('teacher')) return 'ST';
		if (r.includes('health') || r.includes('livelihood')) return null;
		return 'RP';
	}

	function getState(rec) {
		var dept = (rec.department || '').toLowerCase();
		if (dept.includes('health') || dept.includes('livelihood')) {
			return (rec.location || '').trim();
		}
		return (rec.location || rec.native_state || '').trim();
	}

	// Fields needed for the Applications Received / Source reports' summary
	// table, dropdown population, and getState()/getCol() classification —
	// i.e. everything EXCEPT the ~22 drill-down-only detail fields (email,
	// phone, education, reject reason, etc.), which are fetched separately,
	// only for the specific cell a recruiter actually clicks into. See the
	// fetchArData()/fetchSrcData() comments for why this split exists.
	var AR_LEAN_FIELDS = ['name', 'application_status', 'role', 'department',
		'location', 'worklocation', 'native_state', 'native_district', 'creation'];
	// The full field list, fetched on-demand for just the matched IDs of one
	// clicked cell — same columns the drill-down dialog has always shown.
	var AR_FULL_FIELDS = ['name', 'full_name_aadhaar', 'application_status', 'role', 'department',
		'location', 'worklocation', 'native_state', 'native_district', 'opportunity',
		'email_address', 'phone_number', 'alternate_no', 'gender', 'dob', 'age',
		'highest_education', 'teaching_degrees', 'teaching_year', 'teachingexp_month',
		'health_expyear', 'health_expmonth', 'languages_known', 'written_subject',
		'test_location', 'apf_associated', 'former_employee',
		'reasons_for_shortlist', 'reasons_for_reject', 'hold_reason', 'blocklist_reason',
		'creation'];

	// Monday-Sunday week containing (today + offsetWeeks*7 days) — offsetWeeks
	// -1 gives last week, 0 gives the current week.
	function getWeekBounds(offsetWeeks) {
		var now = new Date();
		var day = now.getDay(); // 0=Sun,1=Mon,...,6=Sat
		var diffToMonday = (day === 0 ? -6 : 1 - day);
		var monday = new Date(now);
		monday.setDate(now.getDate() + diffToMonday + offsetWeeks * 7);
		monday.setHours(0, 0, 0, 0);
		var sunday = new Date(monday);
		sunday.setDate(monday.getDate() + 6);
		return { from: monday, to: sunday };
	}
	function fmtDate(d) {
		return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
	}

	// Monday of the Mon–Sun week containing `d` — used by the School
	// Teacher week-wise report to bucket records, same Monday-start
	// convention as getWeekBounds() above.
	function stwMondayOf(d) {
		var day = d.getDay();
		var diff = (day === 0 ? -6 : 1 - day);
		var m = new Date(d);
		m.setDate(d.getDate() + diff);
		m.setHours(0, 0, 0, 0);
		return m;
	}
	function stwWeekLabel(mondayDate) {
		var sunday = new Date(mondayDate);
		sunday.setDate(mondayDate.getDate() + 6);
		var f = function (d) { return String(d.getDate()).padStart(2, '0') + ' ' + d.toLocaleString('en', { month: 'short' }); };
		return f(mondayDate) + ' – ' + f(sunday);
	}

	// Coarse funnel bucketing for the ~90 distinct application_status values
	// this doctype allows — same rationale as AR_ROW_DEFS's "Other / In
	// Process" catch-all below: naming every status explicitly isn't
	// maintainable, so anything not clearly Rejected/Offer-Joined/Shortlisted
	// falls into "In Process" (interview rounds, tests, calibration, etc.)
	// rather than being silently dropped or guessed into the wrong bucket.
	var FUNNEL_STAGES = ['Applied / Pending', 'Shortlisted', 'In Process', 'Offer / Joined', 'Rejected / Dropped'];
	function getFunnelStage(status) {
		var s = (status || '').trim().toLowerCase();
		if (!s || s === 'new applicant' || s === 'on hold' || s.includes('pending') || s.includes('document')
			|| s.includes('correction')) return 'Applied / Pending';
		if (s.includes('reject') || s.includes('blacklist') || s.includes('blocklist') || s.includes('not selected')
			|| s.includes('no show') || s.includes('duplicated') || s.includes('not joined') || s.includes('revoked')
			|| s.includes('declined') || s.includes('failed')) return 'Rejected / Dropped';
		if (s.includes('offer') || s.includes('joined') || s.includes('boarding')) return 'Offer / Joined';
		if (s.includes('shortlist') || s.includes('select')) return 'Shortlisted';
		return 'In Process';
	}

	// Escapes text for both HTML content and (double-quoted) attribute
	// contexts — option values come straight from DB fields (state, school,
	// ...) with no guarantee they're free of < > & ".
	function escHtml(s) {
		return (s == null ? '' : String(s))
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	// ── Multiselect (tag/chip) widget ───────────────────────────────────────
	// Turns a plain div#xxx into a chip-input multiselect (search box,
	// Select all/Clear, checkbox list) and returns a get/setOptions/val API.
	// Same widget style as the Field Over All Dashboard's makeMultiselect —
	// kept as its own copy here (rpt- prefixed classes) since this page has
	// no shared JS module with that one to import it from.
	function makeMultiselect($el, onChange) {
		var placeholder = $el.data('placeholder') || 'All';
		var options = []; // full list of selectable string values
		var selected = []; // currently-selected string values

		$el.html(
			'<div class="rpt-ms-box"><span class="rpt-ms-ph">' + escHtml(placeholder) + '</span></div>' +
			'<div class="rpt-ms-panel">' +
			'<div class="rpt-ms-search"><input type="text" placeholder="Search…"/></div>' +
			'<div class="rpt-ms-actions"><a class="rpt-ms-all">Select all</a><a class="rpt-ms-none">Clear</a></div>' +
			'<div class="rpt-ms-list"></div>' +
			'</div>'
		);
		var $box = $el.find('.rpt-ms-box');
		var $search = $el.find('.rpt-ms-search input');
		var $list = $el.find('.rpt-ms-list');

		function renderBox() {
			$box.empty();
			if (!selected.length) {
				$box.append('<span class="rpt-ms-ph">' + escHtml(placeholder) + '</span>');
				return;
			}
			var shown = selected.slice(0, 2);
			shown.forEach(function (v) {
				var esc = escHtml(v);
				$box.append(
					'<span class="rpt-ms-chip" title="' + esc + '">' +
					'<span class="txt">' + esc + '</span><span class="x" data-v="' + esc + '">&times;</span>' +
					'</span>'
				);
			});
			if (selected.length > shown.length) {
				$box.append('<span class="rpt-ms-more">+' + (selected.length - shown.length) + ' more</span>');
			}
		}

		function renderList(filterText) {
			var q = (filterText || '').toLowerCase();
			$list.empty();
			var matches = options.filter(function (v) { return v.toLowerCase().indexOf(q) !== -1; });
			if (!matches.length) {
				$list.append('<div class="rpt-ms-empty">No matches</div>');
				return;
			}
			matches.forEach(function (v) {
				var checked = selected.indexOf(v) !== -1;
				var esc = escHtml(v);
				$list.append(
					'<label class="rpt-ms-opt"><input type="checkbox" data-v="' + esc + '"' + (checked ? ' checked' : '') + '/>' +
					'<span>' + esc + '</span></label>'
				);
			});
		}

		function open() {
			if ($el.hasClass('open')) return;
			$('.rpt-ms.open').each(function () { $(this).removeClass('open'); });
			$el.addClass('open');
			renderList($search.val());
			$search.val('').trigger('focus');
		}
		function close() { $el.removeClass('open'); }

		$box.on('click', function (e) {
			if ($(e.target).hasClass('x')) return; // handled below
			$el.hasClass('open') ? close() : open();
		});
		$box.on('click', '.x', function (e) {
			e.stopPropagation();
			var v = $(this).data('v').toString();
			selected = selected.filter(function (s) { return s !== v; });
			renderBox();
			if ($el.hasClass('open')) renderList($search.val());
			onChange(selected.slice());
		});
		$search.on('input', function () { renderList($(this).val()); });
		$search.on('click', function (e) { e.stopPropagation(); });
		$list.on('click', '.rpt-ms-opt', function (e) {
			e.stopPropagation();
		});
		$list.on('change', 'input[type=checkbox]', function () {
			var v = $(this).data('v').toString();
			if (this.checked) {
				if (selected.indexOf(v) === -1) selected.push(v);
			} else {
				selected = selected.filter(function (s) { return s !== v; });
			}
			renderBox();
			onChange(selected.slice());
		});
		$el.find('.rpt-ms-all').on('click', function (e) {
			e.stopPropagation();
			var q = ($search.val() || '').toLowerCase();
			var visible = options.filter(function (v) { return v.toLowerCase().indexOf(q) !== -1; });
			visible.forEach(function (v) { if (selected.indexOf(v) === -1) selected.push(v); });
			renderBox(); renderList($search.val());
			onChange(selected.slice());
		});
		$el.find('.rpt-ms-none').on('click', function (e) {
			e.stopPropagation();
			selected = [];
			renderBox(); renderList($search.val());
			onChange(selected.slice());
		});

		var api = {
			setOptions: function (opts) {
				options = opts.slice();
				selected = selected.filter(function (s) { return options.indexOf(s) !== -1; });
				renderBox();
				if ($el.hasClass('open')) renderList($search.val());
			},
			val: function () { return selected.slice(); },
			setVal: function (vals) {
				selected = (vals || []).filter(function (s) { return options.indexOf(s) !== -1; });
				renderBox();
			},
			clear: function () { selected = []; renderBox(); }
		};
		$el.data('rptMs', api);
		return api;
	}

	// Global: close any open multiselect when clicking elsewhere on the page.
	$(document).off('click.rptMsOutside').on('click.rptMsOutside', function (e) {
		if ($(e.target).closest('.rpt-ms').length) return;
		$(wrapper).find('.rpt-ms.open').removeClass('open');
	});


	// ── Styles ────────────────────────────────────────────────────────────
	$(wrapper).find('.page-content').append(`<style>
		/* ── Page ── */
		.rpt-wrap { padding: 20px 24px 48px; color:#1F2937; }
		/* ── Hub ── */
		.rpt-hub-head { display:flex; align-items:flex-end; justify-content:space-between; gap:16px;
			margin-bottom:22px; padding-bottom:16px; border-bottom:1px solid #E5E7EB; }
		.rpt-hub-title { font-size:20px; font-weight:700; color:#111827; letter-spacing:-.01em; }
		.rpt-hub-sub { font-size:13px; color:#6B7280; margin-top:4px; }
		.rpt-hub-count { font-size:12px; font-weight:500; color:#475569; background:#F1F5F9;
			padding:4px 12px; border-radius:999px; white-space:nowrap; }
		.rpt-group { margin-bottom:26px; }
		.rpt-group-title { font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase;
			color:#6B7280; margin:0 0 10px; }
		.rpt-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:14px; }
		.rpt-card { --acc:#1F3A5F; background:#fff; border:1px solid #E5E7EB; border-radius:12px;
			padding:16px 16px 12px; cursor:pointer; display:flex; flex-direction:column; gap:6px;
			box-shadow:0 1px 2px rgba(16,24,40,.04);
			transition:border-color .15s, box-shadow .15s, transform .15s; }
		.rpt-card:hover { border-color:var(--acc); transform:translateY(-1px);
			box-shadow:0 10px 24px -12px rgba(16,24,40,.25); }
		.rpt-card:focus-visible { outline:2px solid var(--acc); outline-offset:2px; }
		.rpt-card.unavailable { cursor:not-allowed; opacity:.55; }
		.rpt-card.unavailable:hover { border-color:#E5E7EB; transform:none; box-shadow:0 1px 2px rgba(16,24,40,.04); }
		.rpt-card-top { display:flex; align-items:center; gap:12px; margin-bottom:2px; }
		.rpt-card-icon { flex:none; width:38px; height:38px; border-radius:10px; display:grid; place-items:center;
			color:var(--acc); background:color-mix(in srgb, var(--acc) 11%, #fff); }
		.rpt-card-icon svg { width:20px; height:20px; }
		.rpt-card-title { font-size:14px; font-weight:600; color:#111827; line-height:1.3; }
		.rpt-card-desc { font-size:12.5px; color:#6B7280; line-height:1.45; flex:1; }
		.rpt-card-foot { margin-top:8px; padding-top:10px; border-top:1px solid #F1F5F9; }
		.rpt-badge { font-size:12px; font-weight:600; }
		.rpt-badge.open { color:var(--acc); }
		.rpt-badge.open .arr { display:inline-block; transition:transform .15s; }
		.rpt-card:hover .rpt-badge.open .arr { transform:translateX(3px); }
		.rpt-badge.soon { color:#9CA3AF; background:#F3F4F6; padding:2px 10px; border-radius:999px; font-weight:500; }
		/* ── Report toolbar ── */
		.rpt-view-toolbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; background:#fff;
			border:1px solid #E5E7EB; border-radius:12px; padding:10px 12px; margin-bottom:12px;
			box-shadow:0 1px 2px rgba(16,24,40,.04); }
		.rpt-back { display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 12px;
			border-radius:8px; background:#fff; color:#374151; font-weight:500; font-size:12.5px;
			border:1px solid #D1D5DB; cursor:pointer; }
		.rpt-back:hover { background:#F9FAFB; border-color:#9CA3AF; }
		.rpt-view-title { font-size:15px; font-weight:700; color:#111827; padding:0 12px 0 6px;
			margin-right:4px; border-right:1px solid #E5E7EB; line-height:24px; }
		.rpt-toolbar-label { font-size:12px; color:#6B7280; font-weight:500; }
		.rpt-toolbar-date { height:32px; border:1px solid #D1D5DB; border-radius:8px; padding:0 10px;
			font-size:12.5px; color:#111827; background:#fff; }
		.rpt-toolbar-date:focus { outline:none; border-color:#274C77; box-shadow:0 0 0 3px rgba(39,76,119,.15); }
		.rpt-btn-refresh { display:inline-flex; align-items:center; justify-content:center; gap:6px; height:32px;
			padding:0 14px; border-radius:8px; background:#1F3A5F; color:#fff; font-weight:500;
			font-size:12.5px; border:1px solid #1F3A5F; cursor:pointer; transition:background .15s; }
		.rpt-btn-refresh:hover { background:#274C77; border-color:#274C77; }
		.rpt-btn-dl { display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 14px;
			border-radius:8px; background:#15803D; color:#fff; font-weight:500;
			font-size:12.5px; border:1px solid #15803D; cursor:pointer; }
		.rpt-btn-dl:hover { background:#166534; }
		.rpt-info { margin-left:auto; font-size:12px; color:#475569; background:#F8FAFC;
			border:1px solid #E5E7EB; padding:4px 10px; border-radius:999px; }
		/* ── Tables ── */
		.rpt-tbl-wrap { overflow:auto; max-height:calc(100vh - 210px); background:#fff;
			border:1px solid #E5E7EB; border-radius:12px; box-shadow:0 1px 2px rgba(16,24,40,.04); }
		.rpt-tbl-wrap > .rpt-tbl { border-style:hidden; }
		.rpt-tbl { border-collapse:collapse; font-size:12px; white-space:nowrap; color:#1F2937;
			width:max-content; min-width:100%; }
		.rpt-tbl th, .rpt-tbl td { border:1px solid #E5E7EB; padding:4px 8px;
			text-align:center; vertical-align:middle; }
		.rpt-tbl td { padding:6px 8px; }
		.rpt-tbl tbody tr:hover td { box-shadow:inset 0 0 0 9999px rgba(31,58,95,.04); }
		.rpt-tbl thead tr:first-child th { background:#1F3A5F; color:#fff; font-weight:600;
			font-size:12px; position:sticky; top:0; z-index:20; border-color:#2F4B70; }
		/* Older reports colour some header cells with an inline pastel background only —
		   give those dark text (white on pastel was unreadable); navy ones set color:#fff inline. */
		.rpt-tbl thead th[style*="background"]:not([style*="color"]) { color:#1F2937; }
		.rpt-tbl thead tr:nth-child(2) th { position:sticky; top:33px; z-index:19; background:#EEF2F7;
			color:#1F2937; font-weight:600; font-size:11.5px; }
		.rpt-tbl thead tr:nth-child(3) th { position:sticky; top:60px; z-index:18; background:#F8FAFC;
			color:#475569; font-weight:600; font-size:10.5px; }
		.rpt-tbl .col-month { min-width:72px; font-weight:700; position:sticky; left:0; z-index:10; }
		.rpt-tbl .col-status { min-width:200px; text-align:left; position:sticky;
			left:80px; z-index:10; white-space:normal; }
		.rpt-tbl .col-src { min-width:160px; max-width:180px; text-align:left; position:sticky;
			left:0; z-index:10; white-space:normal; background:inherit; }
		.rpt-tbl .col-num { min-width:46px; font-variant-numeric:tabular-nums; }
		.rpt-tbl .row-grand td { background:#EEF2F7 !important; font-weight:700; color:#111827;
			border-top:2px solid #CBD5E1; }
		.rpt-tbl .col-total-rp,.rpt-tbl .col-total-st { background:#F1F5F9 !important; font-weight:700; }
		.rpt-loading { padding:56px 20px; text-align:center; color:#6B7280; font-size:13px; }
		.rpt-loading.is-busy::before { content:""; display:block; width:26px; height:26px; margin:0 auto 12px;
			border:3px solid #E5E7EB; border-top-color:#1F3A5F; border-radius:50%; animation:rpt-spin .8s linear infinite; }
		@keyframes rpt-spin { to { transform:rotate(360deg); } }
		/* ── Month multi-select ── */
		.ar-month-picker { position:relative; }
		.ar-month-btn { height:32px; padding:0 12px; border-radius:8px; border:1px solid #D1D5DB;
			background:#fff; font-size:12.5px; font-weight:500; cursor:pointer; color:#374151; }
		.ar-month-btn:hover { background:#F9FAFB; }
		.ar-month-drop { position:absolute; top:calc(100% + 4px); left:0; z-index:100;
			background:#fff; border:1px solid #E5E7EB; border-radius:10px;
			box-shadow:0 10px 24px -8px rgba(16,24,40,.2); min-width:170px; padding-bottom:2px; }
		.ar-month-actions { display:flex; gap:12px; padding:8px 10px 6px;
			border-bottom:1px solid #E5E7EB; }
		.ar-month-link { font-size:11px; color:#274C77; cursor:pointer; font-weight:600; }
		.ar-month-link:hover { text-decoration:underline; }
		#ar-month-checks { max-height:220px; overflow-y:auto; padding:6px 4px; }
		.ar-month-item { display:flex; align-items:center; gap:6px; padding:4px 10px;
			font-size:12px; color:#374151; cursor:pointer; border-radius:6px; }
		.ar-month-item:hover { background:#F3F4F6; }
		/* ── Records drill-down dialog: full screen ── */
		.rec-dlg-fullscreen { width:96vw !important; max-width:96vw !important;
			height:92vh; margin:4vh auto !important; }
		.rec-dlg-fullscreen .modal-content { height:92vh; display:flex; flex-direction:column; }
		.rec-dlg-fullscreen .modal-body { flex:1 1 auto; overflow:auto; }
		.rec-dlg-fullscreen .modal-header,.rec-dlg-fullscreen .modal-footer { flex:0 0 auto; }
		.ar-month-item input { cursor:pointer; accent-color:#1F3A5F; }
		/* ── Chip multiselect (State / School / Department / Role filters) ── */
		.rpt-ms{position:relative;min-width:150px;max-width:230px}
		.rpt-ms-box{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:3px 8px;border:1px solid #D1D5DB;border-radius:8px;background:#fff;cursor:pointer;min-height:32px}
		.rpt-ms-box:hover{border-color:#9CA3AF}
		.rpt-ms.open .rpt-ms-box{border-color:#274C77;box-shadow:0 0 0 3px rgba(39,76,119,.15)}
		.rpt-ms-ph{font-size:12.5px;color:#9CA3AF;padding:2px 2px}
		.rpt-ms-chip{display:inline-flex;align-items:center;gap:4px;background:#EEF2F7;color:#1F3A5F;border-radius:6px;padding:1px 5px 1px 7px;font-size:11px;font-weight:600;max-width:120px}
		.rpt-ms-chip span.txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
		.rpt-ms-chip .x{cursor:pointer;font-size:12px;line-height:1;opacity:.7;padding:0 1px}
		.rpt-ms-chip .x:hover{opacity:1}
		.rpt-ms-more{font-size:11px;color:#6B7280;font-weight:600;padding:1px 4px}
		.rpt-ms-panel{display:none;position:absolute;top:calc(100% + 4px);left:0;z-index:60;background:#fff;border:1px solid #E5E7EB;border-radius:10px;box-shadow:0 10px 24px -8px rgba(16,24,40,.2);width:max(100%,270px);max-width:min(360px,90vw);max-height:300px;overflow-y:auto;overflow-x:hidden}
		.rpt-ms.open .rpt-ms-panel{display:block}
		.rpt-ms-search{position:sticky;top:0;background:#fff;padding:6px;border-bottom:1px solid #F1F5F9}
		.rpt-ms-search input{width:100%;padding:5px 8px;border:1px solid #D1D5DB;border-radius:6px;font-size:12px}
		.rpt-ms-actions{display:flex;justify-content:space-between;padding:5px 8px;border-bottom:1px solid #F1F5F9;font-size:11px}
		.rpt-ms-actions a{color:#274C77;cursor:pointer;font-weight:600}
		.rpt-ms-opt{display:flex;align-items:flex-start;gap:8px;padding:6px 10px;font-size:12px;cursor:pointer;white-space:normal;line-height:1.35}
		.rpt-ms-opt:hover{background:#F3F4F6}
		.rpt-ms-opt input{margin:2px 0 0;flex:none;accent-color:#1F3A5F}
		.rpt-ms-opt span{overflow-wrap:anywhere}
		.rpt-ms-empty{padding:10px;font-size:12px;color:#9CA3AF;text-align:center}
		/* ── Shared bits for the newer reports (Cycle Time → Interviewers) ── */
		.ct-note { margin:0; padding:12px 14px 14px; font-size:11.5px; color:#6B7280; line-height:1.6;
			border-top:1px solid #F1F5F9; background:#FCFCFD; }
		.cmp-title, .iv-title { font-size:13px; font-weight:700; color:#1F3A5F; margin:0; padding:14px 14px 10px; }
		.cmp-offers, .iv-sec { margin-top:6px; border-top:1px solid #E5E7EB; padding:0 14px 14px; }
		.cmp-offers .cmp-title, .iv-sec .iv-title { padding-left:0; padding-right:0; }
		/* ── Cycle Time ── */
		.ct-tbl th { white-space:normal; min-width:130px; max-width:170px; }
		.ct-tbl .ct-stage { background:#F8FAFC !important; font-weight:600; color:#1F2937; text-align:left; min-width:110px; }
		.ct-tbl thead th.ct-stage { background:#1F3A5F !important; color:#fff !important; }
		.ct-tbl .ct-cell { cursor:pointer; min-width:130px; }
		.ct-tbl .ct-cell:hover { background:#EEF2FF; }
		.ct-tbl .ct-na { background:#F3F4F6 !important; color:#9CA3AF; cursor:help; }
		.ct-tbl .ct-year td { font-weight:700; border-top:2px solid #CBD5E1; background:#F8FAFC; }
		.ct-avg { font-size:13px; font-weight:700; color:#1F3A5F; }
		.ct-n { font-size:10.5px; color:#6B7280; }
		/* ── Conversion ── */
		.cv-tbl thead tr:first-child th.cv-state { background:#1F3A5F; color:#fff; }
		.cv-tbl thead tr:first-child th.cv-corner { background:#1F3A5F; color:#fff; left:0; z-index:25; text-align:left; }
		.cv-tbl thead tr:nth-child(2) th { background:#EEF2F7; color:#1F2937; }
		.cv-tbl thead tr:nth-child(2) th.cv-tot { background:#E2E8F0; }
		.cv-tbl thead tr:nth-child(2) th.cv-corner { background:#EEF2F7; left:0; z-index:24; text-align:left; }
		.cv-tbl .cv-stage { background:#F8FAFC; font-weight:600; text-align:left; min-width:170px; position:sticky; left:0; z-index:10; }
		.cv-tbl .cv-cell { cursor:pointer; min-width:52px; }
		.cv-tbl .cv-cell:hover { background:#EEF2FF; }
		.cv-tbl .cv-cell.cv-tot { background:#F1F5F9; font-weight:700; }
		.cv-tbl .cv-all { border-left:2px solid #1F3A5F; }
		.cv-n { font-size:12px; font-weight:700; color:#111827; }
		.cv-pct { font-size:9.5px; color:#6B7280; }
		/* ── Compare Qs & Last Year ── */
		.cmp-tbl thead tr:first-child th { background:#1F3A5F; }
		.cmp-tbl thead tr:first-child th.cmp-corner { background:#1F3A5F; color:#fff; text-align:left; left:0; z-index:25; }
		.cmp-tbl thead tr:nth-child(2) th { background:#EEF2F7; color:#334155; font-weight:500; }
		.cmp-tbl thead tr:nth-child(3) th { background:#F8FAFC; color:#475569; }
		.cmp-tbl thead th.cmp-corner2 { left:0; z-index:24; }
		.cmp-tbl .cmp-stage { background:#F8FAFC; font-weight:600; text-align:left; min-width:150px; position:sticky; left:0; z-index:10; }
		.cmp-tbl .cmp-cell { cursor:pointer; min-width:60px; font-weight:700; color:#111827; }
		.cmp-tbl .cmp-cell:hover { background:#EEF2FF; }
		.cmp-tbl .cmp-pct { min-width:52px; color:#6B7280; }
		.cmp-tbl .cmp-yr { background:#F5F8FC; }
		.cmp-tbl .cmp-prev { background:#F9FAFB; }
		.cmp-tbl .cmp-split { border-left:2px solid #1F3A5F; }
		.cmp-offers .rpt-tbl { min-width:0; }
		.cmp-offers .rpt-tbl thead tr:first-child th { background:#1F3A5F; }
		.cmp-offers .cmp-state { background:#F8FAFC; font-weight:600; }
		.cmp-offers .row-grand td { cursor:pointer; }
		.cmp-up { color:#15803D; font-size:10.5px; font-weight:600; }
		.cmp-down { color:#B91C1C; font-size:10.5px; font-weight:600; }
		/* ── Interviewers Data ── */
		.iv-tbl thead tr:first-child th { background:#1F3A5F; color:#fff; white-space:normal; }
		.iv-tbl .iv-state { background:#F8FAFC; font-weight:600; text-align:left; }
		.iv-tbl .iv-name { text-align:left; min-width:200px; }
		.iv-tbl .iv-cell { cursor:pointer; font-weight:600; min-width:70px; }
		.iv-tbl .iv-cell:hover { background:#EEF2FF; }
		.iv-tbl .iv-group { background:#fff; font-weight:700; text-align:center; vertical-align:middle; color:#1F3A5F; }
		.iv-tbl .iv-lbl { background:#F8FAFC; font-weight:600; text-align:left; }
		.iv-tbl .iv-year td { font-weight:700; border-bottom:2px solid #CBD5E1; }
		.iv-tbl .iv-tot { background:#F1F5F9; font-weight:700; }
	</style>
	<div class="rpt-wrap" id="rpt-main"></div>`);

	// Line icons for the hub cards (24×24, stroke = currentColor, so each
	// card's accent colour tints its own icon).
	var RPT_ICONS = {
		chart:    '<path d="M3 3v18h18"/><path d="M7 16v-5"/><path d="M12 16V8"/><path d="M17 16V7"/>',
		inbox:    '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
		share:    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
		timer:    '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/>',
		funnel:   '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>',
		trend:    '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
		users:    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
		fileok:   '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/>',
		calday:   '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><rect x="8" y="14" width="3" height="3" rx=".5"/>',
		calweek:  '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M7 15h10"/>',
		school:   '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
		pin:      '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
	};
	var RPT_GROUPS = ['Funnel & Conversion', 'Interviews & Offers', 'Daily & Weekly', 'School Teacher'];

	// ── REPORTS definition ────────────────────────────────────────────────
	const REPORTS = [
		{
			key: 'pipeline', title: 'Pipeline', icon: 'chart', color: '#1F3A5F', group: 'Funnel & Conversion',
			desc: 'Overall recruitment pipeline across all states & roles', available: true
		},
		{
			key: 'apps_received', title: 'Applications Received', icon: 'inbox', color: '#B45309', group: 'Funnel & Conversion',
			desc: 'Month-wise CV stage breakdown by state & role', available: true
		},
		{
			key: 'source', title: 'Source', icon: 'share', color: '#7C3AED', group: 'Funnel & Conversion',
			desc: 'Candidate source breakdown by role type', available: true
		},
		{
			key: 'conversion', title: 'Conversion', icon: 'funnel', color: '#C2410C', group: 'Funnel & Conversion',
			desc: 'Stage conversion rates by state and quarter', available: true
		},
		{
			key: 'compare', title: 'Compare Qs & Last Year', icon: 'trend', color: '#047857', group: 'Funnel & Conversion',
			desc: 'Quarter-on-quarter and year-on-year comparison', available: true
		},
		{
			key: 'cycle', title: 'Cycle Time', icon: 'timer', color: '#0369A1', group: 'Funnel & Conversion',
			desc: 'Stage-to-stage cycle times by quarter', available: true
		},
		{
			key: 'interviewers', title: 'Interviewers Data', icon: 'users', color: '#475569', group: 'Interviews & Offers',
			desc: 'Interviewer-wise feedback and selection statistics', available: true
		},
		{
			key: 'offers', title: 'Offers', icon: 'fileok', color: '#BE185D', group: 'Interviews & Offers',
			desc: 'Offer pipeline — made, accepted, declined, joined', available: true
		},
		{
			key: 'daily', title: 'Daily (Recruiters)', icon: 'calday', color: '#0F766E', group: 'Daily & Weekly',
			desc: 'New applications, status changes & pending actions — today', available: true
		},
		{
			key: 'weekly', title: 'Weekly (Recruitment)', icon: 'calweek', color: '#B91C1C', group: 'Daily & Weekly',
			desc: 'Pipeline funnel, role/location breakdown & conversion — this week', available: true
		},
		{
			key: 'st_weekly', title: 'School Teacher — Week wise', icon: 'school', color: '#A16207', group: 'School Teacher',
			desc: 'Week-by-week (Mon–Sun) application breakdown for School Teacher, by stage', available: true
		},
		{
			key: 'st_district', title: 'School Teacher — District Funnel', icon: 'pin', color: '#A16207', group: 'School Teacher',
			desc: 'District-wise full funnel — CV, Test, Recruiter/Subject/Demo/Leader Rounds', available: true
		},
	];

	// ── Render hub (card grid, grouped) ───────────────────────────────────
	function showHub() {
		var live = REPORTS.filter(function (r) { return r.available; }).length;
		$('#rpt-main').html(`
			<div class="rpt-hub-head">
				<div>
					<div class="rpt-hub-title">Reports</div>
					<div class="rpt-hub-sub">Field Recruitment analytics — choose a report to open it.</div>
				</div>
				<span class="rpt-hub-count">${live} of ${REPORTS.length} reports available</span>
			</div>
			<div id="rpt-groups"></div>
		`);
		RPT_GROUPS.forEach(function (g) {
			var items = REPORTS.filter(function (r) { return r.group === g; });
			if (!items.length) return;
			var $group = $('<section class="rpt-group"><div class="rpt-group-title">' + g + '</div><div class="rpt-grid"></div></section>');
			items.forEach(function (r) {
				var badge = r.available
					? '<span class="rpt-badge open">Open report <span class="arr">→</span></span>'
					: '<span class="rpt-badge soon">Coming soon</span>';
				var card = $(`<div class="rpt-card ${r.available ? '' : 'unavailable'}" style="--acc:${r.color};"
					${r.available ? 'role="button" tabindex="0"' : 'aria-disabled="true"'}>
					<div class="rpt-card-top">
						<span class="rpt-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
							stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${RPT_ICONS[r.icon] || ''}</svg></span>
						<div class="rpt-card-title">${r.title}</div>
					</div>
					<div class="rpt-card-desc">${r.desc}</div>
					<div class="rpt-card-foot">${badge}</div>
				</div>`);
				if (r.available) {
					card.on('click', function () { loadReport(r.key); });
					card.on('keydown', function (e) {
						if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadReport(r.key); }
					});
				}
				$group.find('.rpt-grid').append(card);
			});
			$('#rpt-groups').append($group);
		});
	}

	// ── Route to correct report ───────────────────────────────────────────
	function loadReport(key) {
		if (key === 'pipeline') { frappe.set_route('field-over-all-dashb'); return; }
		if (key === 'apps_received') { showAppsReceived(); return; }
		if (key === 'source') { showSource(); return; }
		if (key === 'cycle') { showCycleTime(); return; }
		if (key === 'conversion') { showConversion(); return; }
		if (key === 'compare') { showCompare(); return; }
		if (key === 'interviewers') { showInterviewers(); return; }
		if (key === 'offers') { showOffers(); return; }
		if (key === 'daily') { showDaily(); return; }
		if (key === 'weekly') { showWeekly(); return; }
		if (key === 'st_weekly') { showSTWeekly(); return; }
		if (key === 'st_district') { showSTDistrictFunnel(); return; }
	}

	// ── Shared: show records dialog with CSV export + Frappe links ────────
	// `doctype` defaults to Field Registration Form (every existing caller's
	// records come from there) — the daily report also drills into Field
	// Interview Schedule, so it's an optional 5th arg rather than a second
	// near-duplicate function.
	function showRecordsDialog(title, records, headers, rowFn, doctype) {
		doctype = doctype || 'Field Registration Form';
		function csvDownload() {
			var lines = [headers.join(',')];
			records.forEach(function (r) {
				lines.push(rowFn(r).map(function (v) {
					return '"' + (v || '').toString().replace(/"/g, '""') + '"';
				}).join(','));
			});
			var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
			var url = URL.createObjectURL(blob);
			var a = document.createElement('a'); a.href = url;
			a.download = title.replace(/[^a-z0-9]/gi, '_').slice(0, 40) + '.csv';
			document.body.appendChild(a); a.click();
			document.body.removeChild(a); URL.revokeObjectURL(url);
		}

		var rows = records.map(function (r) {
			var vals = rowFn(r);
			var link = frappe.utils.get_url_to_form
				? frappe.utils.get_url_to_form(doctype, r.name)
				: '/app/' + frappe.router.slug(doctype) + '/' + encodeURIComponent(r.name);
			var cells = vals.map(function (v, i) {
				if (i === 0) {
					return '<td style="padding:4px 8px;white-space:nowrap;">'
						+ '<a href="' + link + '" target="_blank" '
						+ 'style="color:#1F3A5F;font-weight:600;">' + (v || '') + '</a>'
						+ '</td>';
				}
				return '<td style="padding:4px 8px;">' + (v || '') + '</td>';
			}).join('');
			return '<tr>' + cells + '</tr>';
		}).join('');

		var thCells = headers.map(function (h) {
			return '<th style="padding:6px 8px;white-space:nowrap;">' + h + '</th>';
		}).join('');

		var tbl = '<table id="rec-dlg-tbl" style="width:100%;border-collapse:collapse;font-size:12px;">'
			+ '<thead><tr style="background:#1F3A5F;color:#fff;">' + thCells + '</tr></thead>'
			+ '<tbody>' + rows + '</tbody></table>';

		var html = '<div style="margin-bottom:8px;display:flex;gap:8px;align-items:center;">'
			+ '<button id="rec-csv-btn" style="padding:5px 14px;background:#166534;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;">⬇ Download CSV</button>'
			+ '<button id="rec-print-btn" style="padding:5px 14px;background:#1e40af;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;">🖨 Print / PDF</button>'
			+ '<span style="font-size:11px;color:#6b7280;">Click ID to open in Frappe</span>'
			+ '</div>'
			+ '<div style="overflow:auto;">' + tbl + '</div>';

		// Full-screen dialog (not frappe.msgprint, which caps at "wide" —
		// the drill-down tables can run 15-20+ columns and need real room).
		var d = new frappe.ui.Dialog({
			title: title + ' (' + records.length + ')',
			size: 'extra-large'
		});
		d.$body.html(html);
		d.$wrapper.find('.modal-dialog').addClass('rec-dlg-fullscreen');
		d.show();

		// Bind buttons after dialog renders
		setTimeout(function () {
			$('#rec-csv-btn').off('click').on('click', csvDownload);
			$('#rec-print-btn').off('click').on('click', function () {
				var w = window.open('', '_blank');
				w.document.write('<html><head><title>' + title + '</title>'
					+ '<style>table{border-collapse:collapse;font-size:12px;width:100%}'
					+ 'th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}'
					+ 'th{background:#1F3A5F;color:#fff}</style></head><body>'
					+ '<h3>' + title + '</h3>' + document.getElementById('rec-dlg-tbl').outerHTML
					+ '</body></html>');
				w.document.close(); w.focus(); w.print();
			});
		}, 100);

		return d;
	}

	// ── APPLICATIONS RECEIVED ─────────────────────────────────────────────
	var _arData = {};       // aggregated data
	var _arStates = [];     // discovered states
	var _arUsedMonths = []; // all months that have data
	var _arSelected = {};   // selected months {label: true/false}
	var _arAllRecs = [];    // raw records for click-through

	var FIN_MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
	var STATE_COLORS = ['#DDEBF7', '#E2EFDA', '#FFF2CC', '#FCE4D6', '#D9E1F2', '#EAF4E2', '#FDE9D9', '#EBE9F3'];
	var AR_ROW_DEFS = [
		{ label: 'Application Received', key: 'app_received', bg: '#DDEEFF', bold: false },
		{ label: 'CV Level Shortlisted', key: 'cv_shortlist', bg: '#EAF4E2', bold: false },
		{ label: 'CV Level Rejected', key: 'cv_regret', bg: '#FDEDEC', bold: false },
		{ label: 'CV level Pending', key: 'cv_pending', bg: '#FFF9E6', bold: false },
		// Catch-all for every application_status value that isn't one of the
		// handful recognised above (there are ~90 possible status values on
		// this field — Test Process, Recruiter Round, Offer, Joined, etc. —
		// and only 7 are matched by name into the three rows above). Without
		// this row those records were still counted in "Application
		// Received" but silently dropped from the breakdown, so the three
		// rows above never summed to the total. This row makes up the
		// difference instead of guessing which of Shortlisted/Rejected/
		// Pending each of those ~90 statuses "really" belongs in.
		{ label: 'Other / In Process', key: 'other_process', bg: '#EDE7F6', bold: false },
		{ label: 'Grand Total', key: 'app_received', bg: '#BDD7EE', bold: true, isGrand: true },
	];

	function mkRow() {
		return { app_received: 0, cv_shortlist: 0, cv_regret: 0, cv_pending: 0, other_process: 0 };
	}

	// Single source of truth for which application_status values fall into
	// each named bucket — shared by the aggregator below and by the
	// click-through drill-down dialog, so the count shown in a cell and the
	// records listed when you click it can never disagree.
	var AR_STATUS_KEYS = {
		cv_shortlist: ['CV Shortlist', 'Shortlisted'],
		cv_regret: ['CV Reject', 'Rejected'],
		cv_pending: ['New Applicant', 'Applied', 'On Hold'],
	};

	function showAppsReceived() {
		$('#rpt-main').html(`
			<div class="rpt-view-toolbar" id="ar-toolbar">
				<button class="rpt-back" id="rpt-back">← Reports</button>
				<span class="rpt-view-title">Applications Received</span>
				<span class="rpt-toolbar-label">From:</span>
				<input type="date" class="rpt-toolbar-date" id="ar-from" />
				<span class="rpt-toolbar-label">To:</span>
				<input type="date" class="rpt-toolbar-date" id="ar-to" />
				<select class="rpt-toolbar-date" id="ar-state" style="min-width:120px;"><option value="">All States</option></select>
				<select class="rpt-toolbar-date" id="ar-district" style="min-width:120px;"><option value="">All Districts</option></select>
				<div class="ar-month-picker" id="ar-month-picker" style="display:none;">
					<button class="ar-month-btn" id="ar-month-btn">
						Months: All <span style="font-size:10px;">▼</span>
					</button>
					<div class="ar-month-drop" id="ar-month-drop" style="display:none;">
						<div class="ar-month-actions">
							<span class="ar-month-link" id="ar-sel-all">Select All</span>
							<span class="ar-month-link" id="ar-clr-all">Clear All</span>
						</div>
						<div id="ar-month-checks"></div>
						<div style="padding:6px 10px;border-top:1px solid #e5e7eb;">
							<button class="rpt-btn-refresh" id="ar-apply" style="width:100%;justify-content:center;">Apply</button>
						</div>
					</div>
				</div>
				<button class="rpt-btn-refresh" id="ar-refresh">&#x21bb; Refresh</button>
				<span class="rpt-info" id="ar-info"></span>
			</div>
			<div class="rpt-tbl-wrap" id="ar-tbl-wrap">
				<div class="rpt-loading is-busy">Loading…</div>
			</div>
		`);

		// Default: current financial year
		(function () {
			var t = new Date();
			var yr = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;
			$('#ar-from').val(yr + '-04-01');
			$('#ar-to').val(t.toISOString().slice(0, 10));
		})();

		$('#rpt-back').on('click', function () {
			$(document).off('click.arDrop');
			showHub();
		});
		$('#ar-refresh').on('click', fetchArData);
		$('#ar-state,#ar-district').on('change', function () {
			applyArStateFilter();
		});

		// Month picker toggle
		$(document).on('click.arDrop', function (e) {
			if (!$(e.target).closest('#ar-month-picker').length) {
				$('#ar-month-drop').hide();
			}
		});
		$('#ar-month-btn').on('click', function (e) {
			e.stopPropagation();
			$('#ar-month-drop').toggle();
		});
		$('#ar-sel-all').on('click', function () {
			$('#ar-month-checks input[type=checkbox]').prop('checked', true);
		});
		$('#ar-clr-all').on('click', function () {
			$('#ar-month-checks input[type=checkbox]').prop('checked', false);
		});
		$('#ar-apply').on('click', function () {
			$('#ar-month-drop').hide();
			applyArMonthFilter();
		});

		fetchArData();
	}

	function applyArStateFilter() {
		var stF = $('#ar-state').val() || '';
		var diF = $('#ar-district').val() || '';
		var filtered = _arAllRecs.filter(function (r) {
			if (stF && getState(r) !== stF) return false;
			if (diF && (r.native_district || '').trim() !== diF) return false;
			return true;
		});
		aggregateArData(filtered);
		buildArMonthFilter();
		renderArBody();
	}

	function fetchArData() {
		$('#ar-tbl-wrap').html('<div class="rpt-loading is-busy">Loading…</div>');
		var from = $('#ar-from').val() || '';
		var to = $('#ar-to').val() || '';

		var filters = [];
		if (from) filters.push(['creation', '>=', from + ' 00:00:00']);
		if (to) filters.push(['creation', '<=', to + ' 23:59:59']);

		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Field Registration Form',
				filters: filters,
				// Lean field list — only what aggregateArData()/getState()/
				// getCol() actually need for the summary table and the
				// state/district dropdowns. The other ~22 detail fields (email,
				// phone, education, reject reason, etc.) are drill-down-only —
				// fetched on demand per cell instead (see the click handler
				// below), not for every one of 126k+ rows up front. Measured
				// 2026-09-04 against live cloud data: full field list was 98MB /
				// 7.1s for this report's default date range; this lean list is
				// 27MB / 3.0s for the exact same rows — the report still counts
				// and shows every record correctly, it just isn't dragging 22
				// unused fields along for each one.
				fields: AR_LEAN_FIELDS,
				// No cap — same 10000+"creation asc" bug as the District Funnel
				// report (confirmed 2026-09-04: 126k+ records in a typical date
				// range, with two known bulk-import days accounting for ~97k of
				// them), and no status/role pre-filter applies here since this
				// report covers every application regardless of role.
				limit_page_length: 0,
				order_by: 'creation asc'
			},
			callback: function (r) {
				_arAllRecs = (r && r.message) ? r.message : [];
				$('#ar-info').text('Records: ' + _arAllRecs.length + ' | Date: ' + frappe.datetime.now_date());
				// Populate state/district dropdowns
				var stSet = {}, diSet = {};
				_arAllRecs.forEach(function (rec) {
					var st = getState(rec);
					if (st) stSet[st] = true;
					if (rec.native_district) diSet[rec.native_district.trim()] = true;
				});
				var $st = $('#ar-state').empty().append('<option value="">All States</option>');
				Object.keys(stSet).sort().forEach(function (v) { $st.append('<option value="' + v + '">' + v + '</option>'); });
				var $di = $('#ar-district').empty().append('<option value="">All Districts</option>');
				Object.keys(diSet).sort().forEach(function (v) { $di.append('<option value="' + v + '">' + v + '</option>'); });
				aggregateArData(_arAllRecs);
				buildArMonthFilter();
				renderArBody();
			},
			error: function () {
				$('#ar-tbl-wrap').html('<div class="rpt-loading">Failed to load. Please refresh.</div>');
			}
		});
	}

	function aggregateArData(records) {
		var stateSet = {};
		records.forEach(function (r) {
			var s = getState(r);
			if (s) stateSet[s] = true;
		});
		_arStates = Object.keys(stateSet).sort();
		_arData = {};

		function ensureMonth(ml) {
			if (!_arData[ml]) {
				_arData[ml] = { __total: { RP: mkRow(), ST: mkRow() } };
				_arStates.forEach(function (s) { _arData[ml][s] = { RP: mkRow(), ST: mkRow() }; });
			}
		}

		records.forEach(function (r) {
			if (!r.creation) return;
			var d = new Date(r.creation);
			var mi = d.getMonth();
			var yr = d.getFullYear();
			var mn = FIN_MONTHS[mi >= 3 ? mi - 3 : mi + 9];
			var yr2 = mi >= 3 ? yr : yr + 1;
			var ml = mn + '/' + String(yr2).slice(2);
			var col = getCol(r.role);
			if (!col) return;
			var state = getState(r);
			if (!state) return;

			ensureMonth(ml);
			var status = (r.application_status || '').trim();
			_arData[ml][state][col].app_received++;
			_arData[ml]['__total'][col].app_received++;
			if (AR_STATUS_KEYS.cv_shortlist.includes(status)) {
				_arData[ml][state][col].cv_shortlist++;
				_arData[ml]['__total'][col].cv_shortlist++;
			} else if (AR_STATUS_KEYS.cv_regret.includes(status)) {
				_arData[ml][state][col].cv_regret++;
				_arData[ml]['__total'][col].cv_regret++;
			} else if (AR_STATUS_KEYS.cv_pending.includes(status)) {
				_arData[ml][state][col].cv_pending++;
				_arData[ml]['__total'][col].cv_pending++;
			} else {
				// Every other status (Test Process, Recruiter Round, Offer,
				// Joined, Blocklisted, blank, ...) — see AR_ROW_DEFS above.
				_arData[ml][state][col].other_process++;
				_arData[ml]['__total'][col].other_process++;
			}
		});

		// Build ordered month list (financial year order)
		var monthLabelSet = {};
		Object.keys(_arData).forEach(function (ml) { monthLabelSet[ml] = true; });
		// Sort by parsing
		_arUsedMonths = Object.keys(monthLabelSet).sort(function (a, b) {
			function toNum(lbl) {
				var parts = lbl.split('/');
				var mi = FIN_MONTHS.indexOf(parts[0]);
				var yr2 = parseInt('20' + parts[1]);
				var finMi = mi >= 0 ? mi : 0;
				return yr2 * 12 + (finMi >= 9 ? finMi - 9 : finMi + 3);
			}
			return toNum(a) - toNum(b);
		});

		// Default: all selected
		_arSelected = {};
		_arUsedMonths.forEach(function (ml) { _arSelected[ml] = true; });
	}

	function buildArMonthFilter() {
		var checks = '';
		_arUsedMonths.forEach(function (ml) {
			checks += '<label class="ar-month-item">'
				+ '<input type="checkbox" value="' + ml + '" ' + (_arSelected[ml] ? 'checked' : '') + '>'
				+ ' ' + ml
				+ '</label>';
		});
		$('#ar-month-checks').html(checks);
		updateArBtnLabel();
		$('#ar-month-picker').show();
	}

	function updateArBtnLabel() {
		var total = _arUsedMonths.length;
		var sel = _arUsedMonths.filter(function (ml) { return _arSelected[ml]; }).length;
		var label = sel === total ? 'Months: All' : 'Months: ' + sel + ' selected';
		$('#ar-month-btn').html(label + ' <span style="font-size:10px;">▼</span>');
	}

	function applyArMonthFilter() {
		_arSelected = {};
		$('#ar-month-checks input[type=checkbox]').each(function () {
			_arSelected[$(this).val()] = $(this).is(':checked');
		});
		updateArBtnLabel();
		renderArBody();
	}

	function renderArBody() {
		var selectedMonths = _arUsedMonths.filter(function (ml) { return _arSelected[ml]; });
		if (!_arStates.length || !selectedMonths.length) {
			$('#ar-tbl-wrap').html('<div class="rpt-loading">No data for selected months.</div>');
			return;
		}

		// Build thead (static — states don't change)
		var thead = '<thead><tr>';
		thead += '<th class="col-month" rowspan="3" style="z-index:25;">Month</th>';
		thead += '<th class="col-status" rowspan="3" style="z-index:25;">Status</th>';
		_arStates.forEach(function (s, si) {
			var bg = STATE_COLORS[si % STATE_COLORS.length];
			thead += '<th colspan="2" style="background:' + bg + ';">' + s + '</th>';
		});
		thead += '<th colspan="2" style="background:#1F3A5F;color:#fff;">Total</th></tr>';
		thead += '<tr>';
		_arStates.forEach(function (_s, si) {
			var bg = STATE_COLORS[si % STATE_COLORS.length];
			thead += '<th style="background:' + bg + ';font-size:10px;">Role</th><th style="background:' + bg + ';font-size:10px;">Role</th>';
		});
		thead += '<th style="background:#274C77;color:#fff;font-size:10px;">Role</th><th style="background:#274C77;color:#fff;font-size:10px;">Role</th></tr>';
		thead += '<tr>';
		_arStates.forEach(function (_s, si) {
			var bg = STATE_COLORS[si % STATE_COLORS.length];
			thead += '<th style="background:' + bg + ';">RP</th><th style="background:' + bg + ';">ST</th>';
		});
		thead += '<th style="background:#274C77;color:#fff;">RP</th><th style="background:#274C77;color:#fff;">ST</th></tr></thead>';

		var tbody = '<tbody>';
		selectedMonths.forEach(function (ml) {
			var rowCount = AR_ROW_DEFS.length;
			AR_ROW_DEFS.forEach(function (rd, ri) {
				tbody += '<tr class="' + (rd.isGrand ? 'row-grand' : '') + '">';
				if (ri === 0) {
					tbody += '<td class="col-month" rowspan="' + rowCount + '" style="background:#FFF9C4;color:#5D4037;">' + ml + '</td>';
				}
				tbody += '<td class="col-status" style="background:' + rd.bg + ';' + (rd.bold ? 'font-weight:700;' : '') + '">' + rd.label + '</td>';
				_arStates.forEach(function (s) {
					var bucket = (_arData[ml] && _arData[ml][s]) ? _arData[ml][s] : { RP: mkRow(), ST: mkRow() };
					var rpV = bucket.RP[rd.key] || '';
					var stV = bucket.ST[rd.key] || '';
					tbody += '<td class="col-num ar-cell" style="background:' + rd.bg + ';cursor:pointer;" '
						+ 'data-month="' + ml + '" data-state="' + s + '" data-col="RP" data-rowkey="' + rd.key + '">'
						+ rpV + '</td>';
					tbody += '<td class="col-num ar-cell" style="background:' + rd.bg + ';cursor:pointer;" '
						+ 'data-month="' + ml + '" data-state="' + s + '" data-col="ST" data-rowkey="' + rd.key + '">'
						+ stV + '</td>';
				});
				var tot = (_arData[ml] && _arData[ml]['__total']) ? _arData[ml]['__total'] : { RP: mkRow(), ST: mkRow() };
				tbody += '<td class="col-num col-total-rp ar-cell" style="cursor:pointer;" '
					+ 'data-month="' + ml + '" data-state="" data-col="RP" data-rowkey="' + rd.key + '">'
					+ (tot.RP[rd.key] || '') + '</td>';
				tbody += '<td class="col-num col-total-st ar-cell" style="cursor:pointer;" '
					+ 'data-month="' + ml + '" data-state="" data-col="ST" data-rowkey="' + rd.key + '">'
					+ (tot.ST[rd.key] || '') + '</td>';
				tbody += '</tr>';
			});
		});
		tbody += '</tbody>';
		var $tbl = $('<table class="rpt-tbl">' + thead + tbody + '</table>');
		$('#ar-tbl-wrap').html($tbl);

		// Click handler: filter raw records and show dialog
		$('#ar-tbl-wrap').off('click.arCell').on('click.arCell', '.ar-cell', function () {
			var ml = $(this).data('month');
			var state = $(this).data('state');
			var col = $(this).data('col');
			var rowkey = $(this).data('rowkey');
			if (!ml) return;

			var matched = _arAllRecs.filter(function (r) {
				// month
				var d = new Date(r.creation); var mi = d.getMonth(); var yr = d.getFullYear();
				var mn = FIN_MONTHS[mi >= 3 ? mi - 3 : mi + 9];
				var yr2 = mi >= 3 ? yr : yr + 1;
				if ((mn + '/' + String(yr2).slice(2)) !== ml) return false;
				// state (empty = total, no filter)
				if (state && getState(r) !== state) return false;
				// col (RP / ST)
				if (getCol(r.role) !== col) return false;
				// row key
				if (rowkey === 'other_process') {
					// Same "not any of the named buckets" test the aggregator
					// uses — keeps the drill-down in sync with the count.
					var status = (r.application_status || '').trim();
					if (AR_STATUS_KEYS.cv_shortlist.includes(status)
						|| AR_STATUS_KEYS.cv_regret.includes(status)
						|| AR_STATUS_KEYS.cv_pending.includes(status)) return false;
				} else if (rowkey !== 'app_received') {
					var allowed = AR_STATUS_KEYS[rowkey] || [];
					if (!allowed.includes((r.application_status || '').trim())) return false;
				}
				return true;
			});

			if (!matched.length) { frappe.msgprint('No records found.'); return; }

			var title = (state || 'Total') + ' | ' + col + ' | ' + ml
				+ ' | ' + (rowkey === 'app_received' ? 'All Applications' : rowkey.replace('_', ' '))
				+ ' (' + matched.length + ')';

			// matched came from the lean fetch (AR_LEAN_FIELDS) — it has enough
			// to filter correctly but not the detail columns the dialog shows.
			// Fetch those now, scoped to just this cell's IDs (usually dozens
			// to a few hundred), instead of every one of 126k+ rows carrying
			// full detail on every page load.
			frappe.show_alert({ message: 'Loading details…', indicator: 'blue' });
			frappe.call({
				method: 'frappe.client.get_list',
				args: {
					doctype: 'Field Registration Form',
					filters: [['name', 'in', matched.map(function (r) { return r.name; })]],
					fields: AR_FULL_FIELDS,
					limit_page_length: 0
				},
				callback: function (r2) {
					var full = (r2 && r2.message) ? r2.message : [];
					showRecordsDialog(title, full,
						['ID', 'Full Name', 'Status', 'Role', 'Department',
							'Work State', 'Work Location', 'Native State', 'Native District', 'Source',
							'Email', 'Phone', 'Alt Phone', 'Gender', 'DOB', 'Age',
							'Education', 'Teaching Degree', 'Teaching Exp(Yr)', 'Teaching Exp(Mo)',
							'Health Exp(Yr)', 'Health Exp(Mo)', 'Languages', 'Written Subject',
							'Test Location', 'APF Associated', 'Former Employee',
							'Shortlist Reason', 'Reject Reason', 'Hold Reason', 'Blocklist Reason', 'Date'],
						function (r) {
							return [r.name, r.full_name_aadhaar, r.application_status, r.role, r.department,
							r.location, r.worklocation, r.native_state, r.native_district, r.opportunity,
							r.email_address, r.phone_number, r.alternate_no, r.gender, r.dob, r.age,
							r.highest_education, r.teaching_degrees, r.teaching_year, r.teachingexp_month,
							r.health_expyear, r.health_expmonth, r.languages_known, r.written_subject,
							r.test_location, r.apf_associated, r.former_employee,
							r.reasons_for_shortlist, r.reasons_for_reject, r.hold_reason, r.blocklist_reason,
							r.creation ? r.creation.split(' ')[0] : ''];
						});
				},
				error: function () {
					frappe.msgprint('Failed to load record details. Please try again.');
				}
			});
		});
	}

	// ── SOURCE REPORT ─────────────────────────────────────────────────────
	var SRC_SOURCES = [
		'College campus', 'Employee referral', 'Facebook', 'Indeed', 'Instagram',
		'Journals', 'LinkedIn', 'Newspaper', 'Magazine', 'WhatsApp', 'X (Twitter)',
	];
	var SRC_GROUPS = ['Health', 'Livelihoods', 'Resource Person', 'School Teacher', 'Total'];
	var SRC_COLORS = {
		'Health': '#FCE4D6', 'Livelihoods': '#E2EFDA',
		'Resource Person': '#DDEBF7', 'School Teacher': '#FFF2CC',
	};

	function getSrcGroup(rec) {
		var dept = (rec.department || '').toLowerCase();
		var role = (rec.role || '').toLowerCase();
		if (dept.includes('health')) return 'Health';
		if (dept.includes('livelihood')) return 'Livelihoods';
		if (role === 'school teacher') return 'School Teacher';
		return 'Resource Person';
	}

	var _srcAllRecs = [];

	function showSource() {
		$('#rpt-main').html(`
			<div class="rpt-view-toolbar">
				<button class="rpt-back" id="rpt-back">← Reports</button>
				<span class="rpt-view-title">Source</span>
				<span class="rpt-toolbar-label">From:</span>
				<input type="date" class="rpt-toolbar-date" id="src-from" />
				<span class="rpt-toolbar-label">To:</span>
				<input type="date" class="rpt-toolbar-date" id="src-to" />
				<select class="rpt-toolbar-date" id="src-state" style="min-width:120px;"><option value="">All States</option></select>
				<select class="rpt-toolbar-date" id="src-district" style="min-width:120px;"><option value="">All Districts</option></select>
				<button class="rpt-btn-refresh" id="src-refresh">&#x21bb; Refresh</button>
				<span class="rpt-info" id="src-info"></span>
			</div>
			<div class="rpt-tbl-wrap" id="src-tbl-wrap">
				<div class="rpt-loading is-busy">Loading…</div>
			</div>
		`);
		(function () {
			var t = new Date();
			var yr = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;
			$('#src-from').val(yr + '-04-01');
			$('#src-to').val(t.toISOString().slice(0, 10));
		})();
		$('#rpt-back').on('click', showHub);
		$('#src-refresh').on('click', fetchSrcData);
		$('#src-state,#src-district').on('change', function () {
			renderSourceTable(_srcAllRecs);
		});
		fetchSrcData();
	}

	function fetchSrcData() {
		$('#src-tbl-wrap').html('<div class="rpt-loading is-busy">Loading…</div>');
		var from = $('#src-from').val() || '';
		var to = $('#src-to').val() || '';
		var filters = [];
		if (from) filters.push(['creation', '>=', from + ' 00:00:00']);
		if (to) filters.push(['creation', '<=', to + ' 23:59:59']);

		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Field Registration Form',
				filters: filters,
				fields: ['name', 'role', 'department', 'opportunity',
					'location', 'worklocation', 'native_state', 'native_district', 'creation'],
				// No cap — same reasoning as Applications Received above.
				limit_page_length: 0,
				order_by: 'creation asc'
			},
			callback: function (r) {
				_srcAllRecs = (r && r.message) ? r.message : [];
				$('#src-info').text('Records: ' + _srcAllRecs.length + ' | Date: ' + frappe.datetime.now_date());
				// Populate state/district dropdowns
				var stSet = {}, diSet = {};
				_srcAllRecs.forEach(function (rec) {
					var st = (rec.location || rec.worklocation || rec.native_state || '').trim();
					if (st) stSet[st] = true;
					if (rec.native_district) diSet[rec.native_district.trim()] = true;
				});
				var $st = $('#src-state').empty().append('<option value="">All States</option>');
				Object.keys(stSet).sort().forEach(function (v) { $st.append('<option value="' + v + '">' + v + '</option>'); });
				var $di = $('#src-district').empty().append('<option value="">All Districts</option>');
				Object.keys(diSet).sort().forEach(function (v) { $di.append('<option value="' + v + '">' + v + '</option>'); });
				renderSourceTable(_srcAllRecs);
			},
			error: function () {
				$('#src-tbl-wrap').html('<div class="rpt-loading">Failed to load. Please refresh.</div>');
			}
		});
	}

	function renderSourceTable(records) {
		var selState = $('#src-state').val() || '';
		var selDist = $('#src-district').val() || '';
		if (selState || selDist) {
			records = records.filter(function (r) {
				var st = (r.location || r.worklocation || r.native_state || '').trim();
				if (selState && st !== selState) return false;
				if (selDist && (r.native_district || '').trim() !== selDist) return false;
				return true;
			});
		}

		var srcData = {};
		var groupTotals = { 'Health': 0, 'Livelihoods': 0, 'Resource Person': 0, 'School Teacher': 0, 'Total': 0 };
		var otherData = { 'Health': 0, 'Livelihoods': 0, 'Resource Person': 0, 'School Teacher': 0, 'Total': 0 };

		SRC_SOURCES.forEach(function (s) {
			srcData[s] = { 'Health': 0, 'Livelihoods': 0, 'Resource Person': 0, 'School Teacher': 0, 'Total': 0 };
		});

		records.forEach(function (r) {
			var src = (r.opportunity || '').trim();
			var grp = getSrcGroup(r);
			var bucket = SRC_SOURCES.includes(src) ? srcData[src] : otherData;
			bucket[grp]++;
			bucket['Total']++;
			groupTotals[grp]++;
			groupTotals['Total']++;
		});

		function pct(cnt, total) {
			if (!total || !cnt) return '';
			return (cnt / total * 100).toFixed(1) + '%';
		}

		// Header
		var thead = '<thead><tr>';
		thead += '<th class="col-src" rowspan="2" style="background:#1F3A5F;color:#fff;z-index:25;top:0;">Source</th>';
		SRC_GROUPS.forEach(function (g) {
			var bg = g === 'Total' ? '#1F3A5F' : SRC_COLORS[g];
			var fg = g === 'Total' ? '#fff' : '#000';
			thead += '<th colspan="2" style="background:' + bg + ';color:' + fg + ';">' + g + '</th>';
		});
		thead += '</tr><tr>';
		SRC_GROUPS.forEach(function (g) {
			var bg = g === 'Total' ? '#274C77' : SRC_COLORS[g];
			var fg = g === 'Total' ? '#fff' : '#333';
			thead += '<th style="background:' + bg + ';color:' + fg + ';font-size:11px;">Count</th>';
			thead += '<th style="background:' + bg + ';color:' + fg + ';font-size:11px;">%</th>';
		});
		thead += '</tr></thead>';

		var ROW_BG = ['#FFFFFF', '#F7F9FC'];
		var tbody = '<tbody>';

		SRC_SOURCES.forEach(function (s, ri) {
			var data = srcData[s];
			var bg = ROW_BG[ri % 2];
			tbody += '<tr>';
			tbody += '<td class="col-src" style="background:' + bg + ';">' + s + '</td>';
			SRC_GROUPS.forEach(function (g) {
				var cnt = data[g] || 0;
				var numBg = g === 'Total' ? '#EEF4FB' : bg;
				tbody += '<td class="col-num" style="background:' + numBg + ';">' + (cnt || '') + '</td>';
				tbody += '<td class="col-num" style="background:' + numBg + ';color:#555;">' + pct(cnt, groupTotals[g]) + '</td>';
			});
			tbody += '</tr>';
		});

		if (otherData['Total'] > 0) {
			tbody += '<tr>';
			tbody += '<td class="col-src" style="font-style:italic;">Other / Not specified</td>';
			SRC_GROUPS.forEach(function (g) {
				var cnt = otherData[g] || 0;
				tbody += '<td class="col-num">' + (cnt || '') + '</td>';
				tbody += '<td class="col-num" style="color:#555;">' + pct(cnt, groupTotals[g]) + '</td>';
			});
			tbody += '</tr>';
		}

		// Grand Total
		tbody += '<tr style="font-weight:700;">';
		tbody += '<td class="col-src" style="background:#D9D9D9;">Grand Total</td>';
		SRC_GROUPS.forEach(function (g) {
			tbody += '<td class="col-num" style="background:#D9D9D9;">' + (groupTotals[g] || '') + '</td>';
			tbody += '<td class="col-num" style="background:#D9D9D9;">' + (groupTotals[g] ? '100%' : '') + '</td>';
		});
		tbody += '</tr></tbody>';

		$('#src-tbl-wrap').html('<table class="rpt-tbl">' + thead + tbody + '</table>');
	}

	// ── OFFERS REPORT ─────────────────────────────────────────────────────
	var OFFER_STATUSES = ['Offer', 'Document Collection', 'Offer Accepted', 'Offer Declined', 'Offer Revoked', 'Joined'];
	var OFFER_ROLES = ['Resource Person', 'School Teacher', 'Health', 'Livelihoods'];
	var OFFER_ROLE_COLORS = {
		'Resource Person': '#E2EFDA', 'School Teacher': '#FFF2CC',
		'Health': '#FCE4D6', 'Livelihoods': '#DDEBF7',
	};
	var _offerRecs = [];

	function getOfferRoleGroup(rec) {
		var dept = (rec.department || '').toLowerCase();
		var role = (rec.role || '').toLowerCase();
		if (dept.includes('health')) return 'Health';
		if (dept.includes('livelihood')) return 'Livelihoods';
		if (role === 'school teacher') return 'School Teacher';
		return 'Resource Person';
	}

	function showOffers() {
		var now = new Date();
		var defaultMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

		$('#rpt-main').html(`
			<div class="rpt-view-toolbar">
				<button class="rpt-back" id="rpt-back">← Reports</button>
				<span class="rpt-view-title">Offers</span>
				<span class="rpt-toolbar-label">Year From:</span>
				<input type="date" class="rpt-toolbar-date" id="off-from" />
				<span class="rpt-toolbar-label">To:</span>
				<input type="date" class="rpt-toolbar-date" id="off-to" />
				<span class="rpt-toolbar-label">Summary Month:</span>
				<input type="month" class="rpt-toolbar-date" id="off-month" value="${defaultMonth}" style="min-width:130px;" />
				<button class="rpt-btn-refresh" id="off-refresh">&#x21bb; Refresh</button>
				<span class="rpt-info" id="off-info"></span>
			</div>
			<div id="off-content">
				<div class="rpt-loading is-busy">Loading…</div>
			</div>
		`);

		(function () {
			var t = new Date();
			var yr = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;
			$('#off-from').val(yr + '-04-01');
			$('#off-to').val(t.toISOString().slice(0, 10));
		})();

		$('#rpt-back').on('click', showHub);
		$('#off-refresh').on('click', fetchOfferData);
		fetchOfferData();
	}

	function fetchOfferData() {
		$('#off-content').html('<div class="rpt-loading is-busy">Loading…</div>');
		var from = $('#off-from').val() || '';
		var to = $('#off-to').val() || '';
		var filters = [['application_status', 'in', OFFER_STATUSES]];
		if (from) filters.push(['creation', '>=', from + ' 00:00:00']);
		if (to) filters.push(['creation', '<=', to + ' 23:59:59']);

		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Field Registration Form',
				filters: filters,
				fields: ['name', 'role', 'department', 'location', 'worklocation',
					'native_state', 'application_status', 'creation'],
				// Already pre-filtered to offer-related statuses (~1,200 records
				// currently, confirmed 2026-09-04) so this was never actually
				// hitting the cap — uncapped anyway for the same future-proofing
				// as the other reports on this page.
				limit_page_length: 0,
				order_by: 'creation asc'
			},
			callback: function (r) {
				_offerRecs = (r && r.message) ? r.message : [];
				$('#off-info').text('Offer records: ' + _offerRecs.length + ' | Date: ' + frappe.datetime.now_date());
				renderOffersPage();
			},
			error: function () {
				$('#off-content').html('<div class="rpt-loading">Failed to load. Please refresh.</div>');
			}
		});
	}

	function getOfferMonth(r) {
		return r.creation ? new Date(r.creation) : null;
	}

	function buildTrendTable(recs, states, title, titleBg, titleColor) {
		var FIN_M = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
		var STATE_COLORS = ['#DDEBF7', '#E2EFDA', '#FFF2CC', '#FCE4D6', '#D9E1F2', '#EAF4E2', '#FDE9D9', '#EBE9F3'];

		var trend = {};
		recs.forEach(function (r) {
			var d = getOfferMonth(r); if (!d) return;
			var mi = d.getMonth(); var yr = d.getFullYear();
			var mn = FIN_M[mi >= 3 ? mi - 3 : mi + 9];
			var yr2 = mi >= 3 ? yr : yr + 1;
			var ml = mn + '-' + String(yr2).slice(2);
			var st = getState(r); if (!st) return;
			if (!trend[ml]) trend[ml] = {};
			trend[ml][st] = (trend[ml][st] || 0) + 1;
		});

		if (!Object.keys(trend).length) return '';

		function toOrd(lbl) {
			var p = lbl.split('-'); var mi = FIN_M.indexOf(p[0]); var yr2 = parseInt('20' + p[1]);
			return yr2 * 12 + (mi >= 0 ? (mi < 9 ? mi + 3 : mi - 9) : 0);
		}
		var usedLabels = Object.keys(trend).sort(function (a, b) { return toOrd(a) - toOrd(b); });

		function getQ(lbl) { return 'Q' + (Math.floor(FIN_M.indexOf(lbl.split('-')[0]) / 3) + 1); }

		var qTotals = { Q1: {}, Q2: {}, Q3: {}, Q4: {} };
		var yearTotals = {};
		var rows = []; var lastQ = '';
		usedLabels.forEach(function (ml) {
			var q = getQ(ml);
			if (q !== lastQ && lastQ) rows.push({ type: 'q', label: lastQ, data: qTotals[lastQ] });
			lastQ = q;
			rows.push({ type: 'month', label: ml, data: trend[ml] });
			states.forEach(function (s) {
				qTotals[q][s] = (qTotals[q][s] || 0) + (trend[ml][s] || 0);
				yearTotals[s] = (yearTotals[s] || 0) + (trend[ml][s] || 0);
			});
		});
		if (lastQ) rows.push({ type: 'q', label: lastQ, data: qTotals[lastQ] });

		var head = '<thead><tr>';
		head += '<th class="col-month" style="z-index:25;top:0;background:#1F3A5F;color:#fff;">Month</th>';
		states.forEach(function (s, si) {
			head += '<th style="background:' + STATE_COLORS[si % STATE_COLORS.length] + ';">' + s + '</th>';
		});
		head += '<th style="background:#1F3A5F;color:#fff;">Total</th></tr></thead>';

		var body = '<tbody>';
		rows.forEach(function (row) {
			var isQ = row.type === 'q';
			var bg = isQ ? '#C6EFCE' : '#FFFFFF'; var fw = isQ ? 'font-weight:700;' : '';
			var rTotal = states.reduce(function (a, s) { return a + (row.data[s] || 0); }, 0);
			body += '<tr><td class="col-month" style="background:' + bg + ';' + fw + '">' + row.label + '</td>';
			states.forEach(function (s) {
				body += '<td class="col-num" style="background:' + bg + ';">' + (row.data[s] || '') + '</td>';
			});
			body += '<td class="col-num" style="background:#D9D9D9;font-weight:700;">' + (rTotal || '') + '</td></tr>';
		});
		var yTotal = states.reduce(function (a, s) { return a + (yearTotals[s] || 0); }, 0);
		body += '<tr style="font-weight:700;"><td class="col-month" style="background:#1F3A5F;color:#fff;">Total</td>';
		states.forEach(function (s) {
			body += '<td class="col-num" style="background:#D9D9D9;">' + (yearTotals[s] || '') + '</td>';
		});
		body += '<td class="col-num" style="background:#1F3A5F;color:#fff;">' + (yTotal || '') + '</td></tr></tbody>';

		return '<div style="margin-bottom:20px;">'
			+ '<div style="font-weight:700;font-size:13px;color:' + titleColor + ';margin-bottom:6px;padding:6px 8px;background:' + titleBg + ';border-radius:6px;">' + title + '</div>'
			+ '<div class="rpt-tbl-wrap"><table class="rpt-tbl">' + head + body + '</table></div></div>';
	}

	function renderOffersPage() {
		var monthVal = $('#off-month').val() || '';
		var selYear = monthVal ? parseInt(monthVal.split('-')[0]) : 0;
		var selMon = monthVal ? parseInt(monthVal.split('-')[1]) - 1 : -1;

		var offerRecs = _offerRecs; // already filtered to OFFER_STATUSES on fetch

		// Discover states from all offer records
		var stateSet = {};
		offerRecs.forEach(function (r) { var s = getState(r); if (s) stateSet[s] = true; });
		var states = Object.keys(stateSet).sort();
		if (!states.length) {
			$('#off-content').html('<div class="rpt-loading">No offer records in this date range.</div>');
			return;
		}

		// Filter to selected month using date_offer (or creation fallback)
		var monthName = monthVal ? new Date(selYear, selMon, 1).toLocaleString('en', { month: 'long' }) + '-' + selYear : 'All';
		var monthRecs = selMon >= 0 ? offerRecs.filter(function (r) {
			var d = getOfferMonth(r); if (!d) return false;
			return d.getFullYear() === selYear && d.getMonth() === selMon;
		}) : offerRecs;

		// ── Section 1: Summary table ───────────────────────────────────────
		var summary = {}; var summaryTotals = {}; var stateTotals = {}; var grandTotal = 0;
		OFFER_ROLES.forEach(function (rl) { summary[rl] = {}; summaryTotals[rl] = 0; });
		states.forEach(function (s) { stateTotals[s] = 0; });

		monthRecs.forEach(function (r) {
			var grp = getOfferRoleGroup(r); var st = getState(r);
			if (!st) return;
			if (!summary[grp]) summary[grp] = {};
			summary[grp][st] = (summary[grp][st] || 0) + 1;
			summaryTotals[grp] = (summaryTotals[grp] || 0) + 1;
			stateTotals[st] = (stateTotals[st] || 0) + 1;
			grandTotal++;
		});

		var SC = ['#DDEBF7', '#E2EFDA', '#FFF2CC', '#FCE4D6', '#D9E1F2', '#EAF4E2', '#FDE9D9', '#EBE9F3'];
		var s1Head = '<thead><tr><th class="col-src" style="background:#1F3A5F;color:#fff;z-index:25;top:0;">Role</th>';
		states.forEach(function (s, si) { s1Head += '<th style="background:' + SC[si % SC.length] + ';">' + s + '</th>'; });
		s1Head += '<th style="background:#1F3A5F;color:#fff;">Total</th></tr></thead>';

		var s1Body = '<tbody>';
		OFFER_ROLES.forEach(function (rl) {
			var bg = OFFER_ROLE_COLORS[rl] || '#fff';
			s1Body += '<tr><td class="col-src" style="background:' + bg + ';font-weight:600;">' + rl + '</td>';
			states.forEach(function (s) { s1Body += '<td class="col-num" style="background:' + bg + ';">' + ((summary[rl] && summary[rl][s]) || '') + '</td>'; });
			s1Body += '<td class="col-num" style="background:#D9D9D9;font-weight:700;">' + (summaryTotals[rl] || '') + '</td></tr>';
		});
		s1Body += '<tr style="font-weight:700;"><td class="col-src" style="background:#D9D9D9;">Total Offers</td>';
		states.forEach(function (s) { s1Body += '<td class="col-num" style="background:#D9D9D9;">' + (stateTotals[s] || '') + '</td>'; });
		s1Body += '<td class="col-num" style="background:#1F3A5F;color:#fff;">' + (grandTotal || '') + '</td></tr></tbody>';

		var table1 = '<div style="margin-bottom:24px;">'
			+ '<div style="font-weight:700;font-size:13px;color:#1F3A5F;margin-bottom:6px;padding:6px 8px;background:#EBF3FB;border-radius:6px;">Offers in ' + monthName + '</div>'
			+ '<div class="rpt-tbl-wrap" style="max-height:none;"><table class="rpt-tbl">' + s1Head + s1Body + '</table></div></div>';

		var noteRow = '<div style="margin-bottom:16px;padding:6px 10px;background:#FFFDE7;'
			+ 'border:1px solid #FFD600;border-radius:4px;font-size:12px;font-style:italic;'
			+ 'color:#5D4037;font-weight:600;">'
			+ 'Note - Required for all the roles &amp; need supporting data'
			+ '</div>';

		// ── Section 2: Monthly trend per role group (months from date range) ──
		var trendTables = '';
		var roleConfig = [
			{ grp: 'Resource Person', title: 'Resource Person — Monthly Offers by State', bg: '#EBF5E8', fg: '#1E5E1E' },
			{ grp: 'School Teacher', title: 'School Teacher — Monthly Offers by State', bg: '#FFF8E1', fg: '#7D4F00' },
			{ grp: 'Health', title: 'Health — Monthly Offers by State', bg: '#FBE9E7', fg: '#7E2E0E' },
			{ grp: 'Livelihoods', title: 'Livelihoods — Monthly Offers by State', bg: '#EBF3FB', fg: '#1F3A5F' },
		];
		roleConfig.forEach(function (cfg) {
			var grpRecs = offerRecs.filter(function (r) { return getOfferRoleGroup(r) === cfg.grp; });
			trendTables += buildTrendTable(grpRecs, states, cfg.title, cfg.bg, cfg.fg);
		});

		$('#off-content').html(table1 + noteRow + trendTables);
		$('#off-month').off('change').on('change', renderOffersPage);
	}

	// ── DAILY REPORT (Recruiters / Application Processing) ─────────────────
	// Scoped to Field Registration Form + its Field Interview Schedule
	// child records, same as every other report on this page.
	var _dailyFieldRecs = [];
	var _dailyInterviews = [];

	function showDaily() {
		$('#rpt-main').html(`
			<div class="rpt-view-toolbar">
				<button class="rpt-back" id="rpt-back">← Reports</button>
				<span class="rpt-view-title">Daily — Recruiters &amp; Application Processing</span>
				<span class="rpt-toolbar-label" id="daily-date-label"></span>
				<button class="rpt-btn-refresh" id="daily-refresh">&#x21bb; Refresh</button>
				<span class="rpt-info" id="daily-info"></span>
			</div>
			<div id="daily-content"><div class="rpt-loading is-busy">Loading…</div></div>
		`);
		$('#daily-date-label').text('Date: ' + frappe.datetime.get_today());
		$('#rpt-back').on('click', showHub);
		$('#daily-refresh').on('click', fetchDailyData);
		fetchDailyData();
	}

	function fetchDailyData() {
		$('#daily-content').html('<div class="rpt-loading is-busy">Loading…</div>');
		var today = frappe.datetime.get_today();

		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Field Registration Form',
				filters: [['modified', '>=', today + ' 00:00:00']],
				fields: ['name', 'full_name_aadhaar', 'application_status', 'role', 'department',
					'location', 'creation', 'modified'],
				// "modified today" is naturally small (163 records as of
				// 2026-09-04) so this cap was never actually hit — uncapped
				// anyway for the same future-proofing as the other reports here.
				limit_page_length: 0,
				order_by: 'modified desc'
			},
			callback: function (r) {
				_dailyFieldRecs = (r && r.message) ? r.message : [];
				frappe.call({
					method: 'frappe.client.get_list',
					args: {
						doctype: 'Field Interview Schedule',
						filters: [['interview_date', '<=', today]],
						fields: ['name', 'application_id', 'applicants_name', 'role', 'department',
							'interview_date', 'interview_round', 'feedback_form'],
						// Field Interview Schedule's whole doctype is only 148
						// records total (2026-09-04) — nowhere near this cap,
						// uncapped anyway for consistency.
						limit_page_length: 0,
						order_by: 'interview_date desc'
					},
					callback: function (r2) {
						_dailyInterviews = (r2 && r2.message) ? r2.message : [];
						renderDaily();
					},
					// Doctype may not exist / user may lack read access on some
					// sites — the applications half of the report still stands
					// on its own without interview data.
					error: function () { _dailyInterviews = []; renderDaily(); }
				});
			},
			error: function () {
				$('#daily-content').html('<div class="rpt-loading">Failed to load. Please refresh.</div>');
			}
		});
	}

	function renderDaily() {
		var today = frappe.datetime.get_today();

		var newToday = _dailyFieldRecs.filter(function (r) {
			return r.creation && r.creation.slice(0, 10) === today;
		});
		// "Changed" = touched today but not created today. There's no
		// per-field change history available client-side (that lives in the
		// Version doctype, one row per save with a diff blob) — the record's
		// own modified/creation timestamps are the closest signal without a
		// much heavier query, so this counts as an approximation, labelled
		// as such in the drill-down title below.
		var changedToday = _dailyFieldRecs.filter(function (r) {
			return !(r.creation && r.creation.slice(0, 10) === today);
		});
		var interviewsToday = _dailyInterviews.filter(function (iv) { return iv.interview_date === today; });
		var pendingFeedback = _dailyInterviews.filter(function (iv) { return iv.interview_date <= today && !iv.feedback_form; });

		$('#daily-info').text('New: ' + newToday.length + ' | Changed: ' + changedToday.length
			+ ' | Interviews today: ' + interviewsToday.length + ' | Feedback pending: ' + pendingFeedback.length);

		function statCard(title, count, color, bg, recs, onOpen) {
			var $c = $('<div class="rpt-card" style="cursor:' + (recs.length ? 'pointer' : 'default')
				+ ';background:' + bg + ';border-color:' + color + ';">'
				+ '<div class="rpt-card-title" style="color:' + color + ';font-size:26px;">' + count + '</div>'
				+ '<div class="rpt-card-desc" style="font-size:12px;font-weight:600;color:#374151;">' + title + '</div>'
				+ (recs.length ? '<span class="rpt-badge open">View list →</span>' : '')
				+ '</div>');
			if (recs.length) $c.on('click', onOpen);
			return $c;
		}

		var $grid = $('<div class="rpt-grid" style="margin-bottom:22px;"></div>');
		$grid.append(statCard('New Applications Today', newToday.length, '#0E6655', '#E9F7EF', newToday, function () {
			showRecordsDialog('New Applications Today', newToday,
				['ID', 'Full Name', 'Status', 'Role', 'Department', 'Location', 'Created'],
				function (r) { return [r.name, r.full_name_aadhaar, r.application_status, r.role, r.department, r.location, r.creation]; });
		}));
		$grid.append(statCard('Status Changes Today (approx.)', changedToday.length, '#B7950B', '#FEF9E7', changedToday, function () {
			showRecordsDialog('Status Changes Today — approx.: touched today, created earlier', changedToday,
				['ID', 'Full Name', 'Current Status', 'Role', 'Department', 'Last Modified'],
				function (r) { return [r.name, r.full_name_aadhaar, r.application_status, r.role, r.department, r.modified]; });
		}));
		$grid.append(statCard("Today's Interviews", interviewsToday.length, '#1F3A5F', '#EBF3FB', interviewsToday, function () {
			showRecordsDialog("Today's Interviews", interviewsToday,
				['ID', 'Applicant', 'Round', 'Role', 'Department', 'Interview Date'],
				function (r) { return [r.name, r.applicants_name, r.interview_round, r.role, r.department, r.interview_date]; },
				'Field Interview Schedule');
		}));
		$grid.append(statCard('Feedback Forms Pending', pendingFeedback.length, '#943126', '#FDEDEC', pendingFeedback, function () {
			showRecordsDialog('Feedback Forms Pending — interview date reached, no feedback attached', pendingFeedback,
				['ID', 'Applicant', 'Round', 'Role', 'Department', 'Interview Date'],
				function (r) { return [r.name, r.applicants_name, r.interview_round, r.role, r.department, r.interview_date]; },
				'Field Interview Schedule');
		}));

		var roleMap = {};
		newToday.forEach(function (r) { var k = r.role || 'Unspecified'; roleMap[k] = (roleMap[k] || 0) + 1; });
		var roleKeys = Object.keys(roleMap).sort();
		var roleTbl = '';
		if (roleKeys.length) {
			var roleRows = roleKeys.map(function (k) {
				return '<tr><td class="col-src">' + k + '</td><td class="col-num">' + roleMap[k] + '</td></tr>';
			}).join('');
			roleTbl = '<div style="font-weight:700;font-size:13px;color:#0E6655;margin:6px 0;">New Applications Today — by Role</div>'
				+ '<div class="rpt-tbl-wrap" style="max-height:none;"><table class="rpt-tbl">'
				+ '<thead><tr><th class="col-src" style="background:#1F3A5F;color:#fff;">Role</th>'
				+ '<th style="background:#1F3A5F;color:#fff;">Count</th></tr></thead>'
				+ '<tbody>' + roleRows + '</tbody></table></div>';
		}

		$('#daily-content').html('');
		$('#daily-content').append($grid);
		$('#daily-content').append(roleTbl);
	}

	// ── WEEKLY REPORT (Recruitment Reporting) ───────────────────────────────
	var _weeklyThisRecs = [];
	var _weeklyLastRecs = [];

	function showWeekly() {
		var thisWk = getWeekBounds(0);
		$('#rpt-main').html(`
			<div class="rpt-view-toolbar">
				<button class="rpt-back" id="rpt-back">← Reports</button>
				<span class="rpt-view-title">Weekly — Recruitment Reporting</span>
				<span class="rpt-toolbar-label" id="weekly-range-label"></span>
				<button class="rpt-btn-refresh" id="weekly-refresh">&#x21bb; Refresh</button>
				<span class="rpt-info" id="weekly-info"></span>
			</div>
			<div id="weekly-content"><div class="rpt-loading is-busy">Loading…</div></div>
		`);
		$('#weekly-range-label').text('Week: ' + fmtDate(thisWk.from) + ' to ' + fmtDate(thisWk.to) + ' (Mon–Sun)');
		$('#rpt-back').on('click', showHub);
		$('#weekly-refresh').on('click', fetchWeeklyData);
		fetchWeeklyData();
	}

	function fetchWeeklyData() {
		$('#weekly-content').html('<div class="rpt-loading is-busy">Loading…</div>');
		var thisWk = getWeekBounds(0);
		var lastWk = getWeekBounds(-1);

		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Field Registration Form',
				filters: [
					['creation', '>=', fmtDate(lastWk.from) + ' 00:00:00'],
					['creation', '<=', fmtDate(thisWk.to) + ' 23:59:59'],
				],
				fields: ['name', 'full_name_aadhaar', 'application_status', 'role', 'department',
					'location', 'native_state', 'creation', 'modified'],
				// Especially important to uncap here: any 2-week window that
				// includes 2026-08-25/26 (a confirmed bulk import, ~97k records
				// in those 2 days alone) blew straight through the old 10000
				// cap on its own — this report would have shown badly wrong
				// this-week/last-week numbers for weeks including that import.
				limit_page_length: 0,
				order_by: 'creation asc'
			},
			callback: function (r) {
				var all = (r && r.message) ? r.message : [];
				var thisFrom = fmtDate(thisWk.from), thisTo = fmtDate(thisWk.to) + ' 23:59:59';
				var lastFrom = fmtDate(lastWk.from), lastTo = fmtDate(lastWk.to) + ' 23:59:59';
				_weeklyThisRecs = all.filter(function (rec) { return rec.creation >= thisFrom && rec.creation <= thisTo; });
				_weeklyLastRecs = all.filter(function (rec) { return rec.creation >= lastFrom && rec.creation <= lastTo; });
				renderWeekly();
			},
			error: function () {
				$('#weekly-content').html('<div class="rpt-loading">Failed to load. Please refresh.</div>');
			}
		});
	}

	function renderWeekly() {
		// ── Funnel: this week vs last week ──
		var thisFunnel = {}, lastFunnel = {};
		FUNNEL_STAGES.forEach(function (s) { thisFunnel[s] = 0; lastFunnel[s] = 0; });
		_weeklyThisRecs.forEach(function (r) { thisFunnel[getFunnelStage(r.application_status)]++; });
		_weeklyLastRecs.forEach(function (r) { lastFunnel[getFunnelStage(r.application_status)]++; });

		var funnelRows = FUNNEL_STAGES.map(function (s) {
			var t = thisFunnel[s], l = lastFunnel[s], delta = t - l;
			var deltaStr = delta > 0 ? ('+' + delta) : (delta < 0 ? String(delta) : '—');
			var deltaColor = delta > 0 ? '#0E6655' : (delta < 0 ? '#943126' : '#6b7280');
			return '<tr><td class="col-src">' + s + '</td>'
				+ '<td class="col-num">' + t + '</td>'
				+ '<td class="col-num">' + l + '</td>'
				+ '<td class="col-num" style="color:' + deltaColor + ';font-weight:700;">' + deltaStr + '</td></tr>';
		}).join('');
		var totalDelta = _weeklyThisRecs.length - _weeklyLastRecs.length;
		var funnelTbl = '<div style="font-weight:700;font-size:13px;color:#7B241C;margin:6px 0;">Pipeline Funnel — This Week vs Last Week</div>'
			+ '<div class="rpt-tbl-wrap" style="max-height:none;margin-bottom:20px;"><table class="rpt-tbl">'
			+ '<thead><tr><th class="col-src" style="background:#1F3A5F;color:#fff;">Stage</th>'
			+ '<th style="background:#1F3A5F;color:#fff;">This Week</th><th style="background:#1F3A5F;color:#fff;">Last Week</th>'
			+ '<th style="background:#1F3A5F;color:#fff;">Δ</th></tr></thead><tbody>' + funnelRows
			+ '<tr style="font-weight:700;"><td class="col-src" style="background:#D9D9D9;">Total</td>'
			+ '<td class="col-num" style="background:#D9D9D9;">' + _weeklyThisRecs.length + '</td>'
			+ '<td class="col-num" style="background:#D9D9D9;">' + _weeklyLastRecs.length + '</td>'
			+ '<td class="col-num" style="background:#D9D9D9;">' + (totalDelta > 0 ? '+' : '') + totalDelta + '</td></tr>'
			+ '</tbody></table></div>';

		// ── Role / location breakdown — this week ──
		var rl = {}, locSet = {};
		_weeklyThisRecs.forEach(function (r) {
			var role = r.role || 'Unspecified';
			var loc = getState(r) || 'Unspecified';
			locSet[loc] = true;
			rl[role] = rl[role] || {};
			rl[role][loc] = (rl[role][loc] || 0) + 1;
		});
		var locs = Object.keys(locSet).sort();
		var roles = Object.keys(rl).sort();
		var rlTbl = '';
		if (roles.length) {
			var rlHead = '<th class="col-src" style="background:#1F3A5F;color:#fff;">Role</th>'
				+ locs.map(function (l) { return '<th style="background:#1F3A5F;color:#fff;">' + l + '</th>'; }).join('')
				+ '<th style="background:#274C77;color:#fff;">Total</th>';
			var rlBody = roles.map(function (role) {
				var rowTotal = 0;
				var cells = locs.map(function (l) {
					var c = rl[role][l] || 0; rowTotal += c;
					return '<td class="col-num">' + (c || '') + '</td>';
				}).join('');
				return '<tr><td class="col-src">' + role + '</td>' + cells
					+ '<td class="col-num" style="background:#EEF4FB;font-weight:700;">' + rowTotal + '</td></tr>';
			}).join('');
			rlTbl = '<div style="font-weight:700;font-size:13px;color:#7B241C;margin:6px 0;">Role / Location Breakdown — This Week</div>'
				+ '<div class="rpt-tbl-wrap" style="max-height:none;margin-bottom:20px;"><table class="rpt-tbl">'
				+ '<thead><tr>' + rlHead + '</tr></thead><tbody>' + rlBody + '</tbody></table></div>';
		}

		// ── Conversion & turnaround — this week ──
		var applied = _weeklyThisRecs.length;
		var pastCvStage = _weeklyThisRecs.filter(function (r) {
			var st = getFunnelStage(r.application_status);
			return st === 'Shortlisted' || st === 'In Process' || st === 'Offer / Joined';
		}).length;
		var convRate = applied ? (pastCvStage / applied * 100).toFixed(1) + '%' : '—';

		// Same touched-vs-created approximation as the daily report's
		// "Status Changes" — average days between creation and last
		// modification, for applications that have moved past the initial
		// Applied/Pending bucket.
		var moved = _weeklyThisRecs.filter(function (r) { return getFunnelStage(r.application_status) !== 'Applied / Pending'; });
		var totalDays = 0, n = 0;
		moved.forEach(function (r) {
			if (!r.creation || !r.modified) return;
			var days = (new Date(r.modified) - new Date(r.creation)) / 86400000;
			if (days >= 0) { totalDays += days; n++; }
		});
		var avgTurnaround = n ? (totalDays / n).toFixed(1) + ' days' : '—';

		var convCards = '<div class="rpt-grid" style="margin-bottom:20px;">'
			+ '<div class="rpt-card" style="cursor:default;background:#EBF3FB;border-color:#1F3A5F;">'
			+ '<div class="rpt-card-title" style="color:#1F3A5F;font-size:24px;">' + convRate + '</div>'
			+ '<div class="rpt-card-desc" style="font-weight:600;">Conversion rate — moved past CV stage, this week</div></div>'
			+ '<div class="rpt-card" style="cursor:default;background:#FDEDEC;border-color:#943126;">'
			+ '<div class="rpt-card-title" style="color:#943126;font-size:24px;">' + avgTurnaround + '</div>'
			+ '<div class="rpt-card-desc" style="font-weight:600;">Avg. turnaround (approx.) for applications that moved</div></div>'
			+ '</div>';

		$('#weekly-info').text('This week: ' + _weeklyThisRecs.length + ' applications | Last week: ' + _weeklyLastRecs.length);
		$('#weekly-content').html(funnelTbl + rlTbl + convCards);
	}

	// ── SCHOOL TEACHER — WEEK WISE REPORT ───────────────────────────────────
	// Applications Received's month-wise idea, narrowed to one role (School
	// Teacher, matched the same substring way getCol() does everywhere else
	// on this page) and re-bucketed by Mon–Sun week instead of financial-year
	// month — a dedicated, self-contained report rather than a parameterised
	// variant of showAppsReceived(), same "each report owns its own state"
	// pattern the rest of this file already follows.
	var _stwAllRecs = [];
	var _stwData = {};   // { weekLabel: { app_received, cv_shortlist, cv_regret, cv_pending, other_process, __sortKey } }
	var _stwWeeks = [];  // week labels, oldest → newest

	function showSTWeekly() {
		$('#rpt-main').html(`
			<div class="rpt-view-toolbar">
				<button class="rpt-back" id="rpt-back">← Reports</button>
				<span class="rpt-view-title">School Teacher — Week wise</span>
				<span class="rpt-toolbar-label">From:</span>
				<input type="date" class="rpt-toolbar-date" id="stw-from" />
				<span class="rpt-toolbar-label">To:</span>
				<input type="date" class="rpt-toolbar-date" id="stw-to" />
				<select class="rpt-toolbar-date" id="stw-state" style="min-width:120px;"><option value="">All States</option></select>
				<button class="rpt-btn-refresh" id="stw-refresh">&#x21bb; Refresh</button>
				<span class="rpt-info" id="stw-info"></span>
			</div>
			<div class="rpt-tbl-wrap" id="stw-tbl-wrap"><div class="rpt-loading is-busy">Loading…</div></div>
		`);

		// Default: last 8 weeks — a week-wise view is for recent activity,
		// not a full financial year (that'd be ~52 rows, same table other
		// reports avoid by grouping into months/quarters instead).
		(function () {
			var to = new Date();
			var from = new Date(to);
			from.setDate(from.getDate() - 7 * 7);
			$('#stw-from').val(fmtDate(from));
			$('#stw-to').val(fmtDate(to));
		})();

		$('#rpt-back').on('click', showHub);
		$('#stw-refresh').on('click', fetchSTWeeklyData);
		$('#stw-state').on('change', renderSTWeeklyBody);
		fetchSTWeeklyData();
	}

	function fetchSTWeeklyData() {
		$('#stw-tbl-wrap').html('<div class="rpt-loading is-busy">Loading…</div>');
		var from = $('#stw-from').val() || '';
		var to = $('#stw-to').val() || '';
		var filters = [];
		if (from) filters.push(['creation', '>=', from + ' 00:00:00']);
		if (to) filters.push(['creation', '<=', to + ' 23:59:59']);
		// Same server-side pre-filter as the District Funnel report — cuts the
		// row count down before it crosses the wire, exactly equivalent to
		// getCol()==='ST' since that only checks 'teacher' in role.lower().
		filters.push(['role', 'like', '%Teacher%']);

		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Field Registration Form',
				filters: filters,
				fields: ['name', 'full_name_aadhaar', 'application_status', 'role', 'department',
					'location', 'worklocation', 'native_state', 'native_district', 'creation'],
				limit_page_length: 0,
				order_by: 'creation asc'
			},
			callback: function (r) {
				var all = (r && r.message) ? r.message : [];
				// getCol() still runs as the real classifier — the LIKE above
				// is just a coarse pre-filter, same reasoning as District Funnel.
				_stwAllRecs = all.filter(function (rec) { return getCol(rec.role) === 'ST'; });
				$('#stw-info').text('School Teacher records: ' + _stwAllRecs.length + ' | Date: ' + frappe.datetime.now_date());

				var stSet = {};
				_stwAllRecs.forEach(function (rec) { var st = getState(rec); if (st) stSet[st] = true; });
				var $st = $('#stw-state').empty().append('<option value="">All States</option>');
				Object.keys(stSet).sort().forEach(function (v) { $st.append('<option value="' + v + '">' + v + '</option>'); });

				renderSTWeeklyBody();
			},
			error: function () {
				$('#stw-tbl-wrap').html('<div class="rpt-loading">Failed to load. Please refresh.</div>');
			}
		});
	}

	function renderSTWeeklyBody() {
		var selState = $('#stw-state').val() || '';
		var recs = selState
			? _stwAllRecs.filter(function (r) { return getState(r) === selState; })
			: _stwAllRecs;

		_stwData = {};
		recs.forEach(function (r) {
			if (!r.creation) return;
			var monday = stwMondayOf(new Date(r.creation));
			var wl = stwWeekLabel(monday);
			if (!_stwData[wl]) {
				_stwData[wl] = mkRow();
				_stwData[wl].__sortKey = monday.getTime();
			}
			var status = (r.application_status || '').trim();
			_stwData[wl].app_received++;
			// Same three named buckets + catch-all as Applications
			// Received's AR_STATUS_KEYS/AR_ROW_DEFS — kept in sync with
			// that single source of truth rather than re-listing statuses.
			if (AR_STATUS_KEYS.cv_shortlist.includes(status)) _stwData[wl].cv_shortlist++;
			else if (AR_STATUS_KEYS.cv_regret.includes(status)) _stwData[wl].cv_regret++;
			else if (AR_STATUS_KEYS.cv_pending.includes(status)) _stwData[wl].cv_pending++;
			else _stwData[wl].other_process++;
		});
		_stwWeeks = Object.keys(_stwData).sort(function (a, b) { return _stwData[a].__sortKey - _stwData[b].__sortKey; });

		if (!_stwWeeks.length) {
			$('#stw-tbl-wrap').html('<div class="rpt-loading">No School Teacher applications in this range.</div>');
			return;
		}

		var thead = '<thead><tr>'
			+ '<th class="col-month" style="background:#1F3A5F;color:#fff;">Week (Mon–Sun)</th>'
			+ '<th style="background:#DDEEFF;">Applications Received</th>'
			+ '<th style="background:#EAF4E2;">CV Shortlisted</th>'
			+ '<th style="background:#FDEDEC;">CV Rejected</th>'
			+ '<th style="background:#FFF9E6;">CV Pending</th>'
			+ '<th style="background:#EDE7F6;">Other / In Process</th>'
			+ '</tr></thead>';

		var tbody = '<tbody>';
		var grand = mkRow();
		_stwWeeks.forEach(function (wl) {
			var d = _stwData[wl];
			grand.app_received += d.app_received;
			grand.cv_shortlist += d.cv_shortlist;
			grand.cv_regret += d.cv_regret;
			grand.cv_pending += d.cv_pending;
			grand.other_process += d.other_process;
			tbody += '<tr>'
				+ '<td class="col-month" style="background:#FFF9C4;color:#5D4037;">' + wl + '</td>'
				+ '<td class="col-num stw-cell" data-week="' + wl + '" data-rowkey="app_received" style="cursor:pointer;">' + (d.app_received || '') + '</td>'
				+ '<td class="col-num stw-cell" data-week="' + wl + '" data-rowkey="cv_shortlist" style="cursor:pointer;">' + (d.cv_shortlist || '') + '</td>'
				+ '<td class="col-num stw-cell" data-week="' + wl + '" data-rowkey="cv_regret" style="cursor:pointer;">' + (d.cv_regret || '') + '</td>'
				+ '<td class="col-num stw-cell" data-week="' + wl + '" data-rowkey="cv_pending" style="cursor:pointer;">' + (d.cv_pending || '') + '</td>'
				+ '<td class="col-num stw-cell" data-week="' + wl + '" data-rowkey="other_process" style="cursor:pointer;">' + (d.other_process || '') + '</td>'
				+ '</tr>';
		});
		tbody += '<tr class="row-grand">'
			+ '<td class="col-month">Grand Total</td>'
			+ '<td class="col-num">' + (grand.app_received || '') + '</td>'
			+ '<td class="col-num">' + (grand.cv_shortlist || '') + '</td>'
			+ '<td class="col-num">' + (grand.cv_regret || '') + '</td>'
			+ '<td class="col-num">' + (grand.cv_pending || '') + '</td>'
			+ '<td class="col-num">' + (grand.other_process || '') + '</td>'
			+ '</tr>';
		tbody += '</tbody>';

		$('#stw-tbl-wrap').html('<table class="rpt-tbl">' + thead + tbody + '</table>');

		// Click a cell → drill down to the matching records, same
		// click-through pattern (and shared showRecordsDialog) as every
		// other report's table on this page.
		$('#stw-tbl-wrap').off('click.stwCell').on('click.stwCell', '.stw-cell', function () {
			var wl = $(this).data('week');
			var rowkey = $(this).data('rowkey');
			var selStateNow = $('#stw-state').val() || '';
			var baseRecs = selStateNow ? _stwAllRecs.filter(function (r) { return getState(r) === selStateNow; }) : _stwAllRecs;

			var matched = baseRecs.filter(function (r) {
				if (!r.creation) return false;
				if (stwWeekLabel(stwMondayOf(new Date(r.creation))) !== wl) return false;
				if (rowkey === 'app_received') return true;
				if (rowkey === 'other_process') {
					var status = (r.application_status || '').trim();
					return !(AR_STATUS_KEYS.cv_shortlist.includes(status)
						|| AR_STATUS_KEYS.cv_regret.includes(status)
						|| AR_STATUS_KEYS.cv_pending.includes(status));
				}
				var allowed = AR_STATUS_KEYS[rowkey] || [];
				return allowed.includes((r.application_status || '').trim());
			});

			if (!matched.length) { frappe.msgprint('No records found.'); return; }

			var title = 'School Teacher | Week ' + wl + ' | '
				+ (rowkey === 'app_received' ? 'All Applications' : rowkey.replace('_', ' ')) + ' (' + matched.length + ')';

			showRecordsDialog(title, matched,
				['ID', 'Full Name', 'Status', 'Role', 'Department', 'State', 'District', 'Date'],
				function (r) {
					return [r.name, r.full_name_aadhaar, r.application_status, r.role, r.department,
					getState(r), r.native_district, r.creation ? r.creation.split(' ')[0] : ''];
				});
		});
	}

	// ── SCHOOL TEACHER — DISTRICT FUNNEL REPORT ─────────────────────────────
	// Recreates the recruiter's own manually-maintained "School wise
	// candidate" tracker (Excel — one row per district/"school", one
	// column per funnel stage) as a live report, School Teacher only.
	//
	// application_status on Field Registration Form is a genuinely messy,
	// evolved picklist (~85 options, confirmed 2026-09-04 by reading the
	// live field definition) — it carries TWO overlapping naming eras for
	// the same stages at once, e.g. plain "Recruiter Round"/"Recruiter
	// Reject" alongside the newer "Recruiter Round-Interview Scheduled/
	// Rejected", and "Round One"/"Round 1 Reject" alongside "Subject
	// Round-Interview Scheduled/Rejected". A first pass at this report
	// wrongly borrowed round-name strings ("Subject Round", "Demo Round",
	// "Leader Round-1"/"-2") from a DIFFERENT doctype's field entirely
	// (Field Interview Schedule.interview_round) — those strings don't
	// exist on THIS field at all, so those columns silently matched zero
	// records. Every column below now lists every real spelling variant
	// that means the same stage, taken directly from this field's actual
	// option list, so a candidate showing under any of them still counts.
	//
	// Column -> status mapping, confirmed/corrected by the recruiter
	// 2026-09-04:
	//   "Admit Card Sent"  counts "Test Process" (there's also a literal
	//     "Admit Card Sent" option, unused in practice — included too).
	//   "Assessment Pass"  counts "Test Select" (+ "Assessment Passed").
	//   "Assessment Fail"  counts "Test Reject" (+ "Assessment Failed").
	//   "Functional Round" is this app's "Subject Round" for School
	//     Teacher — the picklist's "Functional Round-Interview
	//     Scheduled/Selected/Rejected" values are folded into the Subject
	//     Round columns here, not a separate Demo Round bucket.
	// Two more mappings are judgment calls, NOT yet confirmed — flag if
	// either is wrong:
	//   Demo Round folds in both "Subject/Classroom Demo Round-Interview
	//     …" and "Principal/Demo Round-Interview …" (two more real
	//     variants that both say "Demo"), plus the bare "Demo Round-
	//     Interview Rejected" and "Demo & Leader Round-Interview
	//     Rejected" options.
	//   "Pending with CBT (offer released)" counts "Pending With CBT" +
	//     "CBT Assigned" + "Offer" + "Offer Sent" — the closest real
	//     statuses to that label.
	// The sheet's own "Leader Round 3" column (skipping "Round 2") is
	// NOT an assumption — "Leader Round 1/2/3-Interview …" are all three
	// real, distinct options; the recruiter's sheet genuinely just
	// doesn't track Round 2.
	var STF_COLS = [
		{ label: 'No. of Applications', key: 'applications', statuses: null },
		{ label: 'CV Shortlisted', key: 'cv_shortlisted', statuses: ['CV Shortlist', 'Shortlisted'] },
		{ label: 'CV Screening Pending', key: 'cv_pending', statuses: ['New Applicant', 'Pending', 'Correction Pending', 'PI Edited'] },
		{ label: 'CV Rejected', key: 'cv_rejected', statuses: ['CV Reject', 'Rejected', 'Not Selected', 'Duplicated', 'Blacklisted', 'Blocklisted'] },
		{ label: 'On Hold', key: 'on_hold', statuses: ['On Hold'] },
		{ label: 'Admit Card Sent', key: 'admit_card_sent', statuses: ['Test Process', 'Admit Card Sent'] },
		{ label: 'Assessment Pass', key: 'assessment_pass', statuses: ['Test Select', 'Assessment Passed'] },
		{ label: 'Assessment Fail', key: 'assessment_fail', statuses: ['Test Reject', 'Assessment Failed'] },
		{ label: 'Recruiter Round Scheduled', key: 'rr_sched', statuses: ['Recruiter Round', 'Recruiter Round-Interview Scheduled'] },
		{ label: 'Recruiter Round Selected', key: 'rr_sel', statuses: ['Recruiter Round Select', 'Recruiter Round-Interview Selected'] },
		{ label: 'Recruiter Round Rejected', key: 'rr_rej', statuses: ['Recruiter Reject', 'Recruiter Round-Interview Rejected'] },
		{ label: 'Subject Round Interview Scheduled', key: 'sr_sched', statuses: ['Round One', 'Subject Round', 'Subject Round-Interview Scheduled', 'Functional Round-Interview Scheduled', 'Functional Round-Interviewed'] },
		{ label: 'Subject Round Interview Selected', key: 'sr_sel', statuses: ['Round One Select', 'Subject Round Select', 'Functional Round-Interview Selected'] },
		{ label: 'Subject Round Interview Rejected', key: 'sr_rej', statuses: ['Round 1 Reject', 'Subject Round Reject', 'Subject Round-Interview Rejected', 'Functional Round-Interview Rejected'] },
		{ label: 'Demo Round Scheduled', key: 'dr_sched', statuses: ['Round Two', 'Demo Round', 'Subject/Classroom Demo Round-Interview Scheduled', 'Principal/Demo Round-Interview Scheduled'] },
		{ label: 'Demo Round Selected', key: 'dr_sel', statuses: ['Round Two Select', 'Demo Round Select', 'Subject/Classroom Demo Round-Interview Selected', 'Principal/Demo Round-Interview Selected'] },
		{ label: 'Demo Round Rejected', key: 'dr_rej', statuses: ['Round 2 Reject', 'Demo Round Reject', 'Subject/Classroom Demo Round-Interview Rejected', 'Principal/Demo Round-Interview Rejected', 'Demo Round-Interview Rejected', 'Demo & Leader Round-Interview Rejected'] },
		{ label: 'Leader Round 1 Interview Scheduled', key: 'lr1_sched', statuses: ['Leader Round-1', 'Leader Round 1-Interview Scheduled', 'Leader Round 1-Interviewed'] },
		{ label: 'Leader Round 1 Interview Selected', key: 'lr1_sel', statuses: ['Leader Round-1 Select', 'Leader Round 1-Interview Selected', 'Leader Round-Interview Selected'] },
		{ label: 'Leader Round 1 Interview Rejected', key: 'lr1_rej', statuses: ['Leader Round-1 Reject', 'Leader Round 1-Interview Rejected'] },
		{ label: 'Leader Round 2 Interview Scheduled', key: 'lr2_sched', statuses: ['Leader Round-2'] },
		{ label: 'Leader Round 2 Interview Selected', key: 'lr2_sel', statuses: ['Leader Round-2 Select'] },
		{ label: 'Leader Round 2 Interview Rejected', key: 'lr2_rej', statuses: ['Leader Round-2 Reject'] },
		{ label: 'Leader Round 3 Interview Scheduled', key: 'lr3_sched', statuses: ['Round Three', 'Leader Round-3', 'Leader Round 3-Interview Scheduled', 'Leader Round 3-Interviewed'] },
		{ label: 'Leader Round 3 Interview Selected', key: 'lr3_sel', statuses: ['Round Three Select', 'Leader Round-3 Select', 'Leader Round 3-Interview Selected'] },
		{ label: 'Leader Round 3 Interview Rejected', key: 'lr3_rej', statuses: ['Round 3 Reject', 'Leader Round-3 Reject', 'Leader Round 3-Interview Rejected'] },
		{ label: 'Pending with CBT (Offer Released)', key: 'pending_cbt', statuses: ['Pending With CBT', 'CBT Assigned', 'Offer', 'Offer Sent'] },
	];

	var _stfAllRecs = [];   // everything fetched for the current date range (unfiltered by State/School)
	var _stfViewRecs = [];  // _stfAllRecs after the State/School dropdown filters are applied — what actually renders
	var _stfDistricts = [];
	var _stfMsState = null, _stfMsSchool = null, _stfMsJobCode = null;   // chip-multiselect widgets (built in showSTDistrictFunnel)

	// The School filter only ever offers these 12 known schools (confirmed
	// 2026-09-11) instead of every distinct districtOf() bucket in the
	// data — that full set also includes ~20 non-school noise buckets
	// (unsuffixed roles like "School Teacher Education", "Resource Person /
	// Teacher Educator", "Azim Premji School: ...", etc.) nobody actually
	// wants to filter by. `value` is the real districtOf() bucket text
	// stored in the data (which the label doesn't always match verbatim —
	// e.g. "Khargone, Madhya Pradesh", "Itki, Ranchi", "Udham Singh Nagar").
	// Both applySTFFilters and the Download Excel handler translate the
	// selected label(s) to their real value via SCHOOL_LABEL_TO_VALUE
	// before filtering/sending, so reports.py's download endpoint only
	// ever sees real values and needs no matching list of its own.
	var FIXED_SCHOOLS = [
		{ label: 'Bangalore', value: 'Bengaluru' },
		{ label: 'Kalaburgi', value: 'Kalaburagi' },
		{ label: 'Yadgir', value: 'Yadgir' },
		{ label: 'Dhamtari', value: 'Dhamtari' },
		{ label: 'Raigarh', value: 'Raigarh' },
		{ label: 'Barmer', value: 'Barmer' },
		{ label: 'Sirohi', value: 'Sirohi' },
		{ label: 'Tonk', value: 'Tonk' },
		{ label: 'Ranchi', value: 'Itki, Ranchi' },
		{ label: 'USN', value: 'Udham Singh Nagar' },
		{ label: 'Uttarkashi', value: 'Uttarkashi' },
		{ label: 'Khargone', value: 'Khargone, Madhya Pradesh' },
	];
	var SCHOOL_LABEL_TO_VALUE = {};
	FIXED_SCHOOLS.forEach(function (s) { SCHOOL_LABEL_TO_VALUE[s.label] = s.value; });
	var STF_SCHOOL_VALUES = FIXED_SCHOOLS.map(function (s) { return s.value; });

	// "School" in the tracker sheet is derived from the candidate's own
	// Role field, not native_district/location (confirmed 2026-09-04) —
	// those were sometimes blank or held a full "City, State, India"
	// address instead of a clean place name. Role is a Link to
	// "Recruitment Designation", and its value on Field Registration
	// Form is already that record's own display text (e.g. "School
	// Teacher - Barmer", "School Teacher - Khargone, Madhya Pradesh")
	// — Frappe Link fields store the linked doc's `name`, and here
	// name == label, so no extra lookup query is needed. Takes
	// everything after the LAST " - " as the school; a handful of
	// designations (e.g. "Recruitment Drive in Chittorgarh for School
	// Teacher Rajasthan") don't fit that "<Role> - <School>" shape at
	// all — those fall back to the whole role text as-is rather than
	// guessing at an unfamiliar format and risking a wrong bucket.
	// Hoisted to module scope (was previously local to
	// renderSTDistrictBody) so the School filter dropdown can use the
	// exact same bucketing as the table itself.
	function districtOf(r) {
		var role = (r.role || '').trim();
		if (!role) return 'Unspecified';
		var dashIdx = role.lastIndexOf(' - ');
		if (dashIdx >= 0) return role.slice(dashIdx + 3).trim() || 'Unspecified';
		return role;
	}

	// Populate the State / Job Code multiselects from the full fetched set
	// (_stfAllRecs), not the already-filtered _stfViewRecs — otherwise
	// picking a School would narrow the State/Job Code lists to only that
	// school's values. The School multiselect's options are the fixed
	// FIXED_SCHOOLS list instead (set once in showSTDistrictFunnel, not
	// rebuilt here) — see FIXED_SCHOOLS above for why. setOptions() (see
	// makeMultiselect) already preserves any current selection that still
	// exists in the new option list, so a Refresh (re-fetch) keeps whatever
	// State/Job Code was picked before as long as it's still present in the
	// new data.
	function populateSTFFilterDropdowns() {
		var stSet = {}, jcSet = {};
		_stfAllRecs.forEach(function (r) {
			var st = (r.native_state || '').trim();
			if (st) stSet[st] = true;
			var jc = (r.job_code || '').trim();
			if (jc) jcSet[jc] = true;
		});
		_stfMsState.setOptions(Object.keys(stSet).sort());
		_stfMsJobCode.setOptions(Object.keys(jcSet).sort());
	}

	// Applies the current State / School / Job Code multiselect selections
	// on top of _stfAllRecs into _stfViewRecs, then re-renders — called both
	// on multiselect change and right after a fetch. Each is now a list of
	// zero or more values — empty means "All" (no filtering on that field),
	// same as the old blank-option select; a non-empty list is OR'd within
	// itself (state IN [...]) and AND'd against the other fields, same as
	// picking multiple checkboxes should read: "any of these states, any of
	// these schools, any of these job codes". The School multiselect stores
	// its short display labels (FIXED_SCHOOLS) — translated to the real
	// districtOf() value via SCHOOL_LABEL_TO_VALUE before matching.
	function applySTFFilters() {
		var stF = _stfMsState.val();
		var schF = _stfMsSchool.val().map(function (label) { return SCHOOL_LABEL_TO_VALUE[label] || label; });
		var jcF = _stfMsJobCode.val();
		_stfViewRecs = _stfAllRecs.filter(function (r) {
			if (stF.length && stF.indexOf((r.native_state || '').trim()) === -1) return false;
			if (schF.length && schF.indexOf(districtOf(r)) === -1) return false;
			if (jcF.length && jcF.indexOf((r.job_code || '').trim()) === -1) return false;
			return true;
		});
		var infoText = 'School Teacher records: ' + _stfViewRecs.length;
		if (stF.length || schF.length || jcF.length) infoText += ' of ' + _stfAllRecs.length;
		infoText += ' | Date: ' + frappe.datetime.now_date();
		$('#stf-info').text(infoText);
		renderSTDistrictBody();
	}

	function showSTDistrictFunnel() {
		$('#rpt-main').html(`
			<div class="rpt-view-toolbar">
				<button class="rpt-back" id="rpt-back">← Reports</button>
				<span class="rpt-view-title">School Teacher — District Funnel</span>
				<span class="rpt-toolbar-label">From:</span>
				<input type="date" class="rpt-toolbar-date" id="stf-from" />
				<span class="rpt-toolbar-label">To:</span>
				<input type="date" class="rpt-toolbar-date" id="stf-to" />
				<span class="rpt-toolbar-label">Applied From:</span>
				<input type="date" class="rpt-toolbar-date" id="stf-applied-from" />
				<span class="rpt-toolbar-label">Applied To:</span>
				<input type="date" class="rpt-toolbar-date" id="stf-applied-to" />
				<div class="rpt-ms" id="stf-state" data-placeholder="All States"></div>
				<div class="rpt-ms" id="stf-school" data-placeholder="All Schools"></div>
				<div class="rpt-ms" id="stf-jobcode" data-placeholder="All Job Codes"></div>
				<button class="rpt-btn-refresh" id="stf-refresh">&#x21bb; Refresh</button>
				<button class="rpt-btn-dl" id="stf-download">⬇ Download Excel</button>
				<span class="rpt-info" id="stf-info"></span>
			</div>
			<div class="rpt-tbl-wrap" id="stf-tbl-wrap"><div class="rpt-loading is-busy">Loading…</div></div>
		`);

		(function () {
			var t = new Date();
			var yr = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;
			$('#stf-from').val(yr + '-04-01');
			$('#stf-to').val(t.toISOString().slice(0, 10));
		})();

		// Re-filter in the browser only on every change — no re-fetch
		// needed, since _stfAllRecs already has every record for the
		// current date range.
		_stfMsState = makeMultiselect($('#stf-state'), applySTFFilters);
		_stfMsSchool = makeMultiselect($('#stf-school'), applySTFFilters);
		_stfMsJobCode = makeMultiselect($('#stf-jobcode'), applySTFFilters);
		// School's option list is the fixed FIXED_SCHOOLS set, not derived
		// from fetched data — set once here rather than on every fetch.
		_stfMsSchool.setOptions(FIXED_SCHOOLS.map(function (s) { return s.label; }));

		$('#rpt-back').on('click', showHub);
		$('#stf-refresh').on('click', fetchSTDistrictData);
		// Real .xlsx with the same header/row colours as the on-screen
		// table — the CSV export used elsewhere on this page has no
		// concept of colour, so this is a server-rendered file instead
		// (ms_calendar.api.reports.download_st_district_funnel), built
		// with the exact same From/To/Applied From/Applied To/State/School/
		// Job Code filters currently on screen. Multiple selected
		// states/schools/job codes are sent JSON-encoded (not comma-joined
		// — school names like "Khargone, Madhya Pradesh" already contain
		// commas, so a plain join/split would wrongly split a single
		// school into two) — see download_st_district_funnel's matching
		// json.loads handling. School is translated from its short display
		// label to the real districtOf() value before sending, same as
		// applySTFFilters does for the on-screen table — the server only
		// knows the real values.
		$('#stf-download').on('click', function () {
			var from = $('#stf-from').val() || '';
			var to = $('#stf-to').val() || '';
			var appliedFrom = $('#stf-applied-from').val() || '';
			var appliedTo = $('#stf-applied-to').val() || '';
			var state = JSON.stringify(_stfMsState.val());
			var school = JSON.stringify(_stfMsSchool.val().map(function (label) { return SCHOOL_LABEL_TO_VALUE[label] || label; }));
			var jobCode = JSON.stringify(_stfMsJobCode.val());
			var url = '/api/method/ms_calendar.api.reports.download_st_district_funnel'
				+ '?from_date=' + encodeURIComponent(from) + '&to_date=' + encodeURIComponent(to)
				+ '&applied_from=' + encodeURIComponent(appliedFrom) + '&applied_to=' + encodeURIComponent(appliedTo)
				+ '&native_state=' + encodeURIComponent(state) + '&school=' + encodeURIComponent(school)
				+ '&job_code=' + encodeURIComponent(jobCode);
			window.open(url, '_blank');
		});
		fetchSTDistrictData();
	}

	function fetchSTDistrictData() {
		$('#stf-tbl-wrap').html('<div class="rpt-loading is-busy">Loading…</div>');
		var from = $('#stf-from').val() || '';
		var to = $('#stf-to').val() || '';
		var appliedFrom = $('#stf-applied-from').val() || '';
		var appliedTo = $('#stf-applied-to').val() || '';
		var filters = [];
		if (from) filters.push(['creation', '>=', from + ' 00:00:00']);
		if (to) filters.push(['creation', '<=', to + ' 23:59:59']);
		// Separate, optional range on date_of_applied (a plain Date field,
		// so no time component) — additive to the From/To range above, not
		// a replacement for it: From/To is when the record was saved in
		// Frappe (creation), Applied From/To is the candidate's own
		// self-reported application date, and the two can differ (e.g.
		// bulk-imported records all share one creation timestamp but keep
		// their real original application dates).
		if (appliedFrom) filters.push(['date_of_applied', '>=', appliedFrom]);
		if (appliedTo) filters.push(['date_of_applied', '<=', appliedTo]);
		// Pre-filter server-side on role instead of fetching every Field
		// Registration Form and filtering with getCol() in the browser.
		// Confirmed 2026-09-04: this doctype now has 126,000+ records in a
		// typical date range, so the old limit_page_length:10000 + "creation
		// asc" combo silently dropped everything past the oldest 10,000 rows
		// — the newer region-suffixed "School Teacher - <District>" roles
		// (all created recently) fell outside that window entirely, showing
		// "School Teacher records: 0" even though the data was really there
		// (the Excel download was unaffected — reports.py's server-side
		// query has no such cap). "Teacher" is safe as a plain substring
		// here: getCol() only checks 'teacher' in role.lower() to classify
		// 'ST', so this LIKE is exactly equivalent, just done in SQL instead
		// of after fetching everything.
		filters.push(['role', 'like', '%Teacher%']);

		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Field Registration Form',
				filters: filters,
				fields: ['name', 'full_name_aadhaar', 'application_status', 'role', 'department',
					'location', 'native_state', 'native_district', 'creation', 'job_code'],
				limit_page_length: 0,
				order_by: 'creation asc'
			},
			callback: function (r) {
				var all = (r && r.message) ? r.message : [];
				// Still runs getCol() here too — the SQL LIKE above is a
				// coarse pre-filter (cuts 126k rows down to a few thousand
				// before they ever cross the wire), getCol() remains the
				// real classifier so health/livelihood roles that happen to
				// contain "teacher" as a substring can't slip through.
				//
				// Also restricted to only the 12 known schools in
				// FIXED_SCHOOLS (confirmed 2026-09-11) — this report is
				// meant to be just those, not every distinct districtOf()
				// bucket (unsuffixed roles like "School Teacher Education",
				// "Resource Person / Teacher Educator", "Azim Premji
				// School: ...", state-only buckets like "Rajasthan", etc.).
				// Applied here, before the School filter and before the
				// table renders, so those noise rows never show up even
				// with no School filter selected.
				_stfAllRecs = all
					.filter(function (rec) { return getCol(rec.role) === 'ST'; })
					.filter(function (rec) { return STF_SCHOOL_VALUES.indexOf(districtOf(rec)) !== -1; });
				populateSTFFilterDropdowns();
				// Sets #stf-info itself (accounting for whatever State/School
				// filter is currently selected) and renders the table.
				applySTFFilters();
			},
			error: function () {
				$('#stf-tbl-wrap').html('<div class="rpt-loading">Failed to load. Please refresh.</div>');
			}
		});
	}

	function renderSTDistrictBody() {
		// districtOf() is now module-level (see above, near
		// populateSTFFilterDropdowns) so the School dropdown and this
		// table use the exact same bucketing.
		//
		// Renders _stfViewRecs — _stfAllRecs after the State/School
		// dropdown filters are applied (see applySTFFilters above), not
		// the raw fetch — so the table, the info line, and the
		// drill-down dialog all agree with what's currently selected.
		var distSet = {};
		_stfViewRecs.forEach(function (r) { distSet[districtOf(r)] = true; });
		_stfDistricts = Object.keys(distSet).sort();

		if (!_stfDistricts.length) {
			$('#stf-tbl-wrap').html('<div class="rpt-loading">No School Teacher applications match the current filters.</div>');
			return;
		}

		var thead = '<thead><tr><th class="col-src" style="background:#1F3A5F;color:#fff;z-index:25;top:0;">School</th>';
		STF_COLS.forEach(function (c) {
			thead += '<th style="background:#F5A623;color:#3B2C00;">' + c.label + '</th>';
		});
		thead += '</tr></thead>';

		function districtRecs(d) {
			return _stfViewRecs.filter(function (r) { return districtOf(r) === d; });
		}
		function colCount(recs, col) {
			if (!col.statuses) return recs.length;
			return recs.filter(function (r) { return col.statuses.includes((r.application_status || '').trim()); }).length;
		}

		var tbody = '<tbody>';
		var grand = {};
		STF_COLS.forEach(function (c) { grand[c.key] = 0; });

		_stfDistricts.forEach(function (d) {
			var recs = districtRecs(d);
			tbody += '<tr><td class="col-src" style="background:#FFF3D6;font-weight:600;">' + d + '</td>';
			STF_COLS.forEach(function (c) {
				var cnt = colCount(recs, c);
				grand[c.key] += cnt;
				tbody += '<td class="col-num stf-cell" data-district="' + d + '" data-colkey="' + c.key + '" style="cursor:pointer;">' + (cnt || '') + '</td>';
			});
			tbody += '</tr>';
		});

		tbody += '<tr class="row-grand"><td class="col-src">Total</td>';
		STF_COLS.forEach(function (c) {
			tbody += '<td class="col-num">' + (grand[c.key] || '') + '</td>';
		});
		tbody += '</tr></tbody>';

		$('#stf-tbl-wrap').html('<table class="rpt-tbl">' + thead + tbody + '</table>');

		// Click a cell → drill down to the matching records, same
		// click-through + shared showRecordsDialog every other report on
		// this page uses.
		$('#stf-tbl-wrap').off('click.stfCell').on('click.stfCell', '.stf-cell', function () {
			var d = $(this).data('district');
			var colkey = $(this).data('colkey');
			var col = STF_COLS.filter(function (c) { return c.key === colkey; })[0];
			if (!col) return;

			var recs = districtRecs(d);
			var matched = col.statuses
				? recs.filter(function (r) { return col.statuses.includes((r.application_status || '').trim()); })
				: recs;

			if (!matched.length) { frappe.msgprint('No records found.'); return; }

			var title = d + ' | ' + col.label + ' (' + matched.length + ')';
			showRecordsDialog(title, matched,
				['ID', 'Full Name', 'Status', 'Role', 'Department', 'School', 'Date'],
				function (r) {
					return [r.name, r.full_name_aadhaar, r.application_status, r.role, r.department,
					districtOf(r), r.creation ? r.creation.split(' ')[0] : ''];
				});
		});
	}

	// ── CYCLE TIME ────────────────────────────────────────────────────────
	// Stage-to-stage cycle time (average days) by financial-year quarter,
	// laid out like the recruiter's "Cycle Time" sheet: rows Q1–Q4 + Year,
	// one column per stage transition.
	//
	// Each stage's date comes from a Field Registration Form field. Written
	// test and Offer release have no date field on that doctype yet
	// (checked 2026-09-28: date_offer is a Data field that is empty on
	// every record, the Field Application Status Log child table has no
	// rows, and MeritTrac test results link to Scholarship Recruitment
	// Form, not this doctype) — their `field` is null, so every column that
	// needs them renders greyed out instead of showing a made-up number.
	// Once a date is captured, set `field` here and the columns fill in.
	var CT_STAGES = {
		applied: { label: 'Application', field: 'date_of_applied' },
		test: { label: 'Written test', field: null },
		recruiter: { label: 'Recruiter screening', field: 'date_of_recruiter_round' },
		ec: { label: 'EC/Subject interview', field: 'date_of_functional_round' },
		final: { label: 'Final interview', field: 'date_of_final_round' },
		offer: { label: 'Offer release', field: null },
	};
	var CT_COLS = [
		{ key: 'app_test', label: 'Application to Written test', from: 'applied', to: 'test' },
		{ key: 'test_rr', label: 'Written test to Recruiter screening', from: 'test', to: 'recruiter' },
		{ key: 'rr_ec', label: 'Recruiter screening to EC/Subject interview', from: 'recruiter', to: 'ec' },
		{ key: 'test_ec', label: 'Written test to EC/Subject Interview', from: 'test', to: 'ec' },
		{ key: 'ec_final', label: 'EC/Subject to Final interview', from: 'ec', to: 'final' },
		{ key: 'final_offer', label: 'Final interview to Offer release', from: 'final', to: 'offer' },
		{ key: 'app_offer', label: 'Application to offer', from: 'applied', to: 'offer' },
	];
	var CT_QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

	var _ctAllRecs = [];   // everything fetched for the selected financial year
	var _ctViewRecs = [];  // after the State / Role type filters
	var _ctMsState = null;

	function ctColAvailable(col) {
		return !!(CT_STAGES[col.from].field && CT_STAGES[col.to].field);
	}

	// Stage date as 'YYYY-MM-DD', or '' if not captured. Application falls
	// back to application_date, then creation, when date_of_applied is blank.
	function ctStageDate(r, stageKey) {
		var f = CT_STAGES[stageKey].field;
		if (!f) return '';
		var v = r[f] || '';
		if (stageKey === 'applied' && !v) v = r.application_date || r.creation || '';
		return v ? String(v).slice(0, 10) : '';
	}

	function ctDays(fromStr, toStr) {
		var a = fromStr.split('-'), b = toStr.split('-');
		return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
	}

	// Financial year starting April of `startYear`: Q1 Apr–Jun … Q4 Jan–Mar.
	function ctFyBounds(startYear) {
		return { from: startYear + '-04-01', to: (startYear + 1) + '-03-31' };
	}
	function ctQuarterOf(dateStr) {
		var m = parseInt(dateStr.slice(5, 7), 10);
		if (m >= 4 && m <= 6) return 'Q1';
		if (m >= 7 && m <= 9) return 'Q2';
		if (m >= 10) return 'Q3';
		return 'Q4';
	}

	// One entry per (record, column) where both stage dates exist, the
	// transition finished inside the selected FY, and the dates are in
	// order. A transition is bucketed into the quarter its LATER stage
	// happened in (when that step was completed). Out-of-order pairs
	// (later stage dated before the earlier one — data-entry errors) are
	// counted separately and shown in the info line, not averaged in.
	function ctTransitions(recs, col, fy) {
		var out = [], bad = 0;
		recs.forEach(function (r) {
			var f = ctStageDate(r, col.from), t = ctStageDate(r, col.to);
			if (!f || !t || t < fy.from || t > fy.to) return;
			var d = ctDays(f, t);
			if (d < 0) { bad++; return; }
			out.push({ rec: r, from: f, to: t, days: d, q: ctQuarterOf(t) });
		});
		return { items: out, bad: bad };
	}

	function showCycleTime() {
		var t = new Date();
		var curFy = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;
		var fyOpts = '';
		for (var y = curFy; y >= curFy - 3; y--) {
			fyOpts += '<option value="' + y + '">FY ' + y + '-' + String(y + 1).slice(2) + '</option>';
		}

		$('#rpt-main').html(`
			<div class="rpt-view-toolbar">
				<button class="rpt-back" id="rpt-back">← Reports</button>
				<span class="rpt-view-title">Cycle Time</span>
				<span class="rpt-toolbar-label">Year:</span>
				<select class="rpt-toolbar-date" id="ct-fy">${fyOpts}</select>
				<select class="rpt-toolbar-date" id="ct-role">
					<option value="">All Roles</option>
					<option value="RP">Resource Person</option>
					<option value="ST">School Teacher</option>
				</select>
				<div class="rpt-ms" id="ct-state" data-placeholder="All States"></div>
				<button class="rpt-btn-refresh" id="ct-refresh">&#x21bb; Refresh</button>
				<span class="rpt-info" id="ct-info"></span>
			</div>
			<div class="rpt-tbl-wrap" id="ct-tbl-wrap"><div class="rpt-loading is-busy">Loading…</div></div>
		`);

		_ctMsState = makeMultiselect($('#ct-state'), applyCTFilters);
		$('#rpt-back').on('click', showHub);
		$('#ct-refresh').on('click', fetchCycleTimeData);
		$('#ct-fy').on('change', fetchCycleTimeData);
		$('#ct-role').on('change', applyCTFilters);
		fetchCycleTimeData();
	}

	function fetchCycleTimeData() {
		$('#ct-tbl-wrap').html('<div class="rpt-loading is-busy">Loading…</div>');
		var fy = ctFyBounds(parseInt($('#ct-fy').val(), 10));

		// Only records whose transition END date falls in the selected FY
		// can contribute to any cell, so fetch just those (OR across each
		// available column's end-stage field) instead of all 126k+ Field
		// Registration Forms — a few thousand rows at most.
		var orFilters = [], seen = {};
		CT_COLS.filter(ctColAvailable).forEach(function (c) {
			var f = CT_STAGES[c.to].field;
			if (seen[f]) return;
			seen[f] = true;
			orFilters.push([f, 'between', [fy.from, fy.to]]);
		});

		var fields = ['name', 'full_name_aadhaar', 'application_status', 'role', 'department',
			'location', 'native_state', 'application_date', 'creation'];
		Object.keys(CT_STAGES).forEach(function (k) {
			var f = CT_STAGES[k].field;
			if (f && fields.indexOf(f) === -1) fields.push(f);
		});

		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Field Registration Form',
				fields: fields,
				or_filters: orFilters,
				limit_page_length: 0,
				order_by: 'creation asc'
			},
			callback: function (r) {
				_ctAllRecs = (r && r.message) ? r.message : [];
				var stSet = {};
				_ctAllRecs.forEach(function (rec) {
					var st = getState(rec);
					if (st) stSet[st] = true;
				});
				_ctMsState.setOptions(Object.keys(stSet).sort());
				applyCTFilters();
			},
			error: function () {
				$('#ct-tbl-wrap').html('<div class="rpt-loading">Failed to load. Please refresh.</div>');
			}
		});
	}

	function applyCTFilters() {
		var stF = _ctMsState.val();
		var roleF = $('#ct-role').val() || '';
		_ctViewRecs = _ctAllRecs.filter(function (r) {
			if (stF.length && stF.indexOf(getState(r)) === -1) return false;
			if (roleF && getCol(r.role) !== roleF) return false;
			return true;
		});
		renderCycleTimeBody();
	}

	function renderCycleTimeBody() {
		var fyStart = parseInt($('#ct-fy').val(), 10);
		var fy = ctFyBounds(fyStart);
		var yearLabel = 'Year-' + fyStart + '-' + String(fyStart + 1).slice(2);

		// Pre-compute every column's transitions once; cells + drill-down reuse them.
		var colData = {}, badTotal = 0;
		CT_COLS.forEach(function (c) {
			if (!ctColAvailable(c)) return;
			colData[c.key] = ctTransitions(_ctViewRecs, c, fy);
			badTotal += colData[c.key].bad;
		});

		function bucket(colKey, q) {
			var items = colData[colKey].items;
			return q ? items.filter(function (it) { return it.q === q; }) : items;
		}
		function cellHtml(col, q) {
			if (!ctColAvailable(col)) {
				var missing = [col.from, col.to].filter(function (k) { return !CT_STAGES[k].field; })
					.map(function (k) { return CT_STAGES[k].label; }).join(' & ');
				return '<td class="ct-na" title="No ' + escHtml(missing) + ' date is captured on Field Registration Form yet">—</td>';
			}
			var items = bucket(col.key, q);
			if (!items.length) return '<td class="ct-cell" data-col="' + col.key + '" data-q="' + (q || '') + '"></td>';
			var sum = items.reduce(function (s, it) { return s + it.days; }, 0);
			var avg = Math.round((sum / items.length) * 10) / 10;
			return '<td class="ct-cell" data-col="' + col.key + '" data-q="' + (q || '') + '">'
				+ '<div class="ct-avg">' + avg + ' days</div>'
				+ '<div class="ct-n">n = ' + items.length + '</div></td>';
		}

		var thead = '<thead><tr><th class="ct-stage">Stages</th>';
		CT_COLS.forEach(function (c) {
			var style = ctColAvailable(c) ? '' : ' style="background:#94A3B8;"';
			thead += '<th' + style + '>' + c.label + '</th>';
		});
		thead += '</tr></thead>';

		var tbody = '<tbody>';
		CT_QUARTERS.forEach(function (q) {
			tbody += '<tr><td class="ct-stage">' + q + '</td>';
			CT_COLS.forEach(function (c) { tbody += cellHtml(c, q); });
			tbody += '</tr>';
		});
		tbody += '<tr class="ct-year"><td class="ct-stage">' + yearLabel + '</td>';
		CT_COLS.forEach(function (c) { tbody += cellHtml(c, null); });
		tbody += '</tr></tbody>';

		var missingStages = Object.keys(CT_STAGES).filter(function (k) { return !CT_STAGES[k].field; })
			.map(function (k) { return CT_STAGES[k].label; });
		var note = '<div class="ct-note">'
			+ 'Each cell is the average number of days between the two stages, for candidates who completed the later stage in that quarter '
			+ '(FY quarters: Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar). Click a cell to see the candidates.<br>'
			+ 'Stage dates: Recruiter screening = Date of Recruiter Round, EC/Subject interview = Date of Functional Round, '
			+ 'Final interview = Date of Final Round, Application = Date of Applied.'
			+ (missingStages.length
				? '<br><b>Greyed columns:</b> no ' + missingStages.join(' / ') + ' date is recorded on Field Registration Form yet, so those cycle times can\'t be calculated.'
				: '')
			+ '</div>';

		$('#ct-tbl-wrap').html('<table class="rpt-tbl ct-tbl">' + thead + tbody + '</table>' + note);

		var info = 'Candidates: ' + _ctViewRecs.length;
		if (_ctViewRecs.length !== _ctAllRecs.length) info += ' of ' + _ctAllRecs.length;
		if (badTotal) info += ' | ' + badTotal + ' skipped (later stage dated before earlier stage)';
		$('#ct-info').text(info);

		$('#ct-tbl-wrap').off('click.ctCell').on('click.ctCell', '.ct-cell', function () {
			var col = CT_COLS.filter(function (c) { return c.key === $(this).data('col'); }.bind(this))[0];
			var q = $(this).data('q') || null;
			if (!col) return;
			var items = bucket(col.key, q);
			if (!items.length) { frappe.msgprint('No records found.'); return; }
			var title = col.label + ' | ' + (q || yearLabel);
			showRecordsDialog(title, items.map(function (it) {
				return $.extend({}, it.rec, { _from: it.from, _to: it.to, _days: it.days });
			}),
				['ID', 'Full Name', 'Role', 'State', CT_STAGES[col.from].label + ' Date', CT_STAGES[col.to].label + ' Date', 'Days', 'Status'],
				function (r) {
					return [r.name, r.full_name_aadhaar, r.role, getState(r), r._from, r._to, r._days, r.application_status];
				});
		});
	}

	// ── CONVERSION ────────────────────────────────────────────────────────
	// Stage-wise funnel, laid out like the recruiter's "Conversion" sheet:
	// one row per stage, one column group per state (Q1–Q4 + Total) plus
	// All State. Each cell counts candidates who APPLIED in that quarter
	// (date_of_applied, falling back to application_date) and got at least
	// as far as that stage, so every row is a subset of the row above and
	// the small % under each count is the conversion from the previous
	// stage.
	var CV_STAGES = [
		'Applications received',
		'CV screening',
		'Written test',
		'Recruiter screening',
		'Education capacity round',
		'Leader/Final round',
		'Offers released',
	];

	// State columns are built from the data, not a fixed list: every Indian
	// state / UT that at least one candidate in the selected year maps to
	// gets its own column automatically (sorted by applications, most
	// first), so a new state starts showing the moment candidates from it
	// apply. State text on Field Registration Form is free-form ("Rajasthan,
	// India", "Itki, Ranchi, Jharkhand, India", "Lucknow, Uttar Pradesh",
	// "Ranchi, Dhanbad and Jamshedpur", ...), so it's matched against every
	// state/UT name first, then against district/city names that show up
	// without their state. Anything left (blank, "All States", unknown
	// text) goes to CV_OTHER so the state columns always add up to All State.
	var CV_INDIA_STATES = [
		'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
		'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
		'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
		'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
		'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
		'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
	];
	// Spelling variants and district/city names seen without a state name.
	var CV_STATE_ALIASES = {
		'Chhattisgarh': ['chattisgarh', 'dhamtari', 'raigarh', 'raipur'],
		'Karnataka': ['bengaluru', 'bangalore', 'kalaburagi', 'yadgir'],
		'Madhya Pradesh': ['khargone', 'bhopal'],
		'Rajasthan': ['tonk', 'sirohi', 'barmer', 'udaipur'],
		'Uttarakhand': ['uttaranchal', 'udham singh', 'uttarkashi', 'dehradun'],
		'Jharkhand': ['ranchi', 'dhanbad', 'jamshedpur', 'deoghar', 'pakur', 'sahibganj'],
		'Uttar Pradesh': ['lucknow', 'varanasi'],
		'Odisha': ['orissa'],
		'Puducherry': ['pondicherry'],
		'Maharashtra': ['nagpur', 'mumbai', 'pune'],
		'Jammu and Kashmir': ['jammu', 'kashmir'],
	};
	var CV_OTHER = 'Other / Not specified';
	var CV_ALL = 'All State';

	function cvStateOf(r) {
		var s = getState(r).toLowerCase();
		if (!s) return CV_OTHER;
		for (var i = 0; i < CV_INDIA_STATES.length; i++) {
			if (s.indexOf(CV_INDIA_STATES[i].toLowerCase()) !== -1) return CV_INDIA_STATES[i];
		}
		for (var st in CV_STATE_ALIASES) {
			if (CV_STATE_ALIASES[st].some(function (k) { return s.indexOf(k) !== -1; })) return st;
		}
		return CV_OTHER;
	}

	// Furthest stage index (into CV_STAGES) a candidate reached. Built from
	// the current application_status (keyword rules, so both naming eras of
	// the ~85 status options are covered — see the STF_COLS comment), then
	// raised by the round dates: a Recruiter/Functional/Final round date
	// means the candidate reached that round even if their status later
	// moved on or was overwritten.
	//   "No Show", "Test Initiated", "Test Process" = CV passed, test not
	//     taken (yet) → CV screening. "Test Select/Reject" = sat the test.
	//   "Interview No Show" = passed the test, missed the interview.
	//   Rejects count at the stage they were rejected in (they reached it).
	function cvStageOf(r) {
		var s = (r.application_status || '').trim().toLowerCase();
		var idx = 0;
		if (/offer|pre joining|joined|document|boarding|cbt/.test(s)) idx = 6;
		else if (/leader|fitment|final|round three|round 3/.test(s)) idx = 5;
		else if (/functional|subject|demo|education capacity|round one|round two|round 1|round 2/.test(s)) idx = 4;
		else if (/recruiter/.test(s)) idx = 3;
		else if (/interview.no show|test select|test reject|assessment pass|assessment fail/.test(s)) idx = 2;
		else if (/shortlist|no show|test initiated|test process|admit card/.test(s)) idx = 1;
		if (r.date_of_final_round) idx = Math.max(idx, 5);
		else if (r.date_of_functional_round) idx = Math.max(idx, 4);
		else if (r.date_of_recruiter_round) idx = Math.max(idx, 3);
		return idx;
	}

	function cvAppliedOf(r) {
		return String(r.date_of_applied || r.application_date || '').slice(0, 10);
	}

	var _cvAllRecs = [];   // fetched + tagged with _state/_stage/_q for the selected FY
	var _cvViewRecs = [];  // after the Role type / Department / Role filters
	var _cvMsDept = null, _cvMsRole = null;   // chip-multiselect widgets (built in showConversion)

	function showConversion() {
		var t = new Date();
		var curFy = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;
		var fyOpts = '';
		for (var y = curFy; y >= curFy - 3; y--) {
			fyOpts += '<option value="' + y + '">FY ' + y + '-' + String(y + 1).slice(2) + '</option>';
		}

		$('#rpt-main').html(`
			<div class="rpt-view-toolbar">
				<button class="rpt-back" id="rpt-back">← Reports</button>
				<span class="rpt-view-title">Conversion</span>
				<span class="rpt-toolbar-label">Year:</span>
				<select class="rpt-toolbar-date" id="cv-fy">${fyOpts}</select>
				<select class="rpt-toolbar-date" id="cv-role">
					<option value="RP">Resource Person-Education</option>
					<option value="ST">School Teacher</option>
					<option value="">All Role Types</option>
				</select>
				<div class="rpt-ms" id="cv-dept" data-placeholder="All Departments"></div>
				<div class="rpt-ms" id="cv-roles" data-placeholder="All Roles"></div>
				<button class="rpt-btn-refresh" id="cv-refresh">&#x21bb; Refresh</button>
				<span class="rpt-info" id="cv-info"></span>
			</div>
			<div class="rpt-tbl-wrap" id="cv-tbl-wrap"><div class="rpt-loading is-busy">Loading…</div></div>
		`);

		// Department / Role lists come from the fetched data, so every value
		// that exists shows up automatically. Changing Role type or
		// Department narrows the Role list to roles that still match.
		_cvMsDept = makeMultiselect($('#cv-dept'), function () { populateCVRoleOptions(); applyCVFilters(); });
		_cvMsRole = makeMultiselect($('#cv-roles'), applyCVFilters);
		$('#rpt-back').on('click', showHub);
		$('#cv-refresh').on('click', fetchConversionData);
		$('#cv-fy').on('change', fetchConversionData);
		$('#cv-role').on('change', function () { populateCVRoleOptions(); applyCVFilters(); });
		fetchConversionData();
	}

	function cvDeptOf(r) { return (r.department || '').trim() || 'Not specified'; }
	function cvRoleOf(r) { return (r.role || '').trim() || 'Not specified'; }

	function populateCVDeptOptions() {
		var set = {};
		_cvAllRecs.forEach(function (r) { set[cvDeptOf(r)] = true; });
		_cvMsDept.setOptions(Object.keys(set).sort());
	}

	// Roles matching the current Role type + Department choice (not the Role
	// selection itself), so the list only offers roles that can return rows.
	// setOptions() keeps any selected role that is still in the new list.
	function populateCVRoleOptions() {
		var typeF = $('#cv-role').val() || '';
		var deptF = _cvMsDept.val();
		var set = {};
		_cvAllRecs.forEach(function (r) {
			if (typeF && getCol(r.role) !== typeF) return;
			if (deptF.length && deptF.indexOf(cvDeptOf(r)) === -1) return;
			set[cvRoleOf(r)] = true;
		});
		_cvMsRole.setOptions(Object.keys(set).sort());
	}

	function fetchConversionData() {
		$('#cv-tbl-wrap').html('<div class="rpt-loading is-busy">Loading…</div>');
		var fy = ctFyBounds(parseInt($('#cv-fy').val(), 10));

		// Applied in the FY by either date field — the exact bucket is
		// decided per record below (date_of_applied wins when both exist).
		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Field Registration Form',
				fields: ['name', 'full_name_aadhaar', 'application_status', 'role', 'department',
					'location', 'native_state', 'date_of_applied', 'application_date',
					'date_of_recruiter_round', 'date_of_functional_round', 'date_of_final_round'],
				or_filters: [
					['date_of_applied', 'between', [fy.from, fy.to]],
					['application_date', 'between', [fy.from + ' 00:00:00', fy.to + ' 23:59:59']]
				],
				limit_page_length: 0,
				order_by: 'creation asc'
			},
			callback: function (r) {
				var all = (r && r.message) ? r.message : [];
				_cvAllRecs = [];
				all.forEach(function (rec) {
					var applied = cvAppliedOf(rec);
					if (!applied || applied < fy.from || applied > fy.to) return;
					rec._applied = applied;
					rec._q = ctQuarterOf(applied);
					rec._state = cvStateOf(rec);
					rec._stage = cvStageOf(rec);
					_cvAllRecs.push(rec);
				});
				populateCVDeptOptions();
				populateCVRoleOptions();
				applyCVFilters();
			},
			error: function () {
				$('#cv-tbl-wrap').html('<div class="rpt-loading">Failed to load. Please refresh.</div>');
			}
		});
	}

	function applyCVFilters() {
		var typeF = $('#cv-role').val() || '';
		var deptF = _cvMsDept.val();
		var roleF = _cvMsRole.val();
		_cvViewRecs = _cvAllRecs.filter(function (r) {
			if (typeF && getCol(r.role) !== typeF) return false;
			if (deptF.length && deptF.indexOf(cvDeptOf(r)) === -1) return false;
			if (roleF.length && roleF.indexOf(cvRoleOf(r)) === -1) return false;
			return true;
		});
		renderConversionBody();
	}

	function renderConversionBody() {
		// counts[state][q][stageIdx], q in Q1..Q4 / 'Total'. Each record adds
		// to every stage up to the one it reached (funnel, not exclusive buckets).
		// Columns = every state present in the current data, most applications
		// first, then Other / Not specified, then All State.
		var stateCount = {};
		_cvViewRecs.forEach(function (r) { stateCount[r._state] = (stateCount[r._state] || 0) + 1; });
		var groups = Object.keys(stateCount)
			.filter(function (s) { return s !== CV_OTHER; })
			.sort(function (a, b) { return stateCount[b] - stateCount[a] || a.localeCompare(b); });
		if (stateCount[CV_OTHER]) groups.push(CV_OTHER);
		groups.push(CV_ALL);

		var periods = CT_QUARTERS.concat(['Total']);
		var counts = {};
		groups.forEach(function (g) {
			counts[g] = {};
			periods.forEach(function (p) { counts[g][p] = CV_STAGES.map(function () { return 0; }); });
		});
		_cvViewRecs.forEach(function (r) {
			[r._state, CV_ALL].forEach(function (g) {
				for (var i = 0; i <= r._stage; i++) {
					counts[g][r._q][i]++;
					counts[g].Total[i]++;
				}
			});
		});

		var roleLabel = $('#cv-role option:selected').text();
		var thead = '<thead><tr><th class="cv-corner">Conversion</th>';
		groups.forEach(function (g) {
			thead += '<th class="cv-state' + (g === CV_ALL ? ' cv-all' : '') + '" colspan="5">' + g + '</th>';
		});
		thead += '</tr><tr><th class="cv-corner">' + escHtml(roleLabel) + '</th>';
		groups.forEach(function (g) {
			periods.forEach(function (p, i) {
				var cls = (p === 'Total' ? 'cv-tot' : '') + (g === CV_ALL && i === 0 ? ' cv-all' : '');
				thead += '<th class="' + cls + '">' + p + '</th>';
			});
		});
		thead += '</tr></thead>';

		var tbody = '<tbody>';
		CV_STAGES.forEach(function (stage, si) {
			tbody += '<tr><td class="cv-stage">' + stage + '</td>';
			groups.forEach(function (g) {
				periods.forEach(function (p, i) {
					var n = counts[g][p][si];
					var prev = si ? counts[g][p][si - 1] : 0;
					var pct = si && prev ? '<div class="cv-pct">' + Math.round((n / prev) * 1000) / 10 + '%</div>' : '';
					var cls = 'cv-cell col-num' + (p === 'Total' ? ' cv-tot' : '') + (g === CV_ALL && i === 0 ? ' cv-all' : '');
					tbody += '<td class="' + cls + '" data-g="' + escHtml(g) + '" data-p="' + p + '" data-s="' + si + '">'
						+ (n ? '<div class="cv-n">' + n + '</div>' + pct : '') + '</td>';
				});
			});
			tbody += '</tr>';
		});
		tbody += '</tbody>';

		var note = '<div class="ct-note">'
			+ 'Each cell counts candidates who <b>applied</b> in that quarter (Date of Applied; FY quarters Q1 Apr–Jun … Q4 Jan–Mar) '
			+ 'and reached at least that stage — rejected candidates count at the stage they were rejected in. '
			+ 'The % under a count is the conversion from the stage above. Click a cell to see the candidates.<br>'
			+ 'CV screening = passed CV screening · Written test = appeared for the test · '
			+ 'Recruiter / Education capacity / Leader-Final = reached that round (status or round date) · Offers released = Offer and later.<br>'
			+ 'State columns are added automatically for every state found in the data (most applications first). '
			+ CV_OTHER + ' = state blank or not recognisable. All State = sum of all columns.'
			+ '</div>';

		$('#cv-tbl-wrap').html('<table class="rpt-tbl cv-tbl">' + thead + tbody + '</table>' + note);

		var info = 'Candidates applied: ' + _cvViewRecs.length;
		if (_cvViewRecs.length !== _cvAllRecs.length) info += ' of ' + _cvAllRecs.length;
		info += ' | Date: ' + frappe.datetime.now_date();
		$('#cv-info').text(info);

		$('#cv-tbl-wrap').off('click.cvCell').on('click.cvCell', '.cv-cell', function () {
			var g = $(this).data('g'), p = $(this).data('p'), si = parseInt($(this).data('s'), 10);
			var matched = _cvViewRecs.filter(function (r) {
				if (g !== CV_ALL && r._state !== g) return false;
				if (p !== 'Total' && r._q !== p) return false;
				return r._stage >= si;
			});
			if (!matched.length) { frappe.msgprint('No records found.'); return; }
			showRecordsDialog(g + ' | ' + p + ' | ' + CV_STAGES[si], matched,
				['ID', 'Full Name', 'Status', 'Furthest Stage', 'Role', 'State', 'Applied On'],
				function (r) {
					return [r.name, r.full_name_aadhaar, r.application_status, CV_STAGES[r._stage], r.role,
					getState(r), r._applied];
				});
		});
	}

	// ── COMPARE QS & LAST YEAR ────────────────────────────────────────────
	// Two tables from the recruiter's "Compare Qs & last year" sheet:
	//  1. Stage funnel for Q1–Q4 of the selected FY, the full FY, and the
	//     previous FY — each a count (#) and % conversion from the stage
	//     above. Same counting as the Conversion report (applied-date
	//     cohort, candidate counts in every stage up to the furthest one
	//     reached), except Leader round and Final round are separate rows
	//     here, matching the sheet.
	//  2. Total offers per state, previous FY vs selected FY. State columns
	//     come from the data (cvStateOf), so new states appear by themselves.
	// Shares the Conversion helpers (cvStateOf, cvAppliedOf, cvDeptOf,
	// cvRoleOf) and filters, so both reports always agree.
	var CMP_STAGES = ['Applications received', 'CV Shortlist', 'Written test', 'Recruiter screening',
		'EC round', 'Leader round', 'Final round'];
	var CMP_OFFER_RE = /offer|pre joining|joined|document|boarding|cbt/;

	// Furthest CMP_STAGES index reached — cvStageOf()'s rules with its
	// combined Leader/Final stage split in two: Leader Round 1/2/3 statuses
	// or a Final round date = Leader round; a Final/Fitment status or an
	// offer-and-later status = Final round. date_of_final_round only lifts
	// to Leader round: on real data (checked 2026-09-28) it is filled for
	// candidates in the Leader rounds, so treating it as "Final round"
	// made that row ~99% of Leader round and meaningless.
	function cmpStageOf(r) {
		var s = (r.application_status || '').trim().toLowerCase();
		var idx = 0;
		if (CMP_OFFER_RE.test(s) || /final|fitment/.test(s)) idx = 6;
		else if (/leader|round three|round 3/.test(s)) idx = 5;
		else if (/functional|subject|demo|education capacity|round one|round two|round 1|round 2/.test(s)) idx = 4;
		else if (/recruiter/.test(s)) idx = 3;
		else if (/interview.no show|test select|test reject|assessment pass|assessment fail/.test(s)) idx = 2;
		else if (/shortlist|no show|test initiated|test process|admit card/.test(s)) idx = 1;
		if (r.date_of_final_round) idx = Math.max(idx, 5);
		else if (r.date_of_functional_round) idx = Math.max(idx, 4);
		else if (r.date_of_recruiter_round) idx = Math.max(idx, 3);
		return idx;
	}

	var _cmpAllRecs = [];   // both FYs, tagged with _fy ('cur'/'prev'), _q, _stage, _offer, _state
	var _cmpViewRecs = [];
	var _cmpMsDept = null, _cmpMsRole = null;

	function cmpFyLabel(y) { return y + '-' + String(y + 1).slice(2); }
	function cmpRange(from, to) {
		var f = function (s) {
			var d = new Date(s + 'T00:00:00');
			return d.getDate() + ' ' + d.toLocaleString('en', { month: 'short' }) + ' ' + d.getFullYear();
		};
		return f(from) + ' – ' + f(to);
	}

	function showCompare() {
		var t = new Date();
		var curFy = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;
		var fyOpts = '';
		for (var y = curFy; y >= curFy - 3; y--) {
			fyOpts += '<option value="' + y + '">FY ' + cmpFyLabel(y) + ' vs ' + cmpFyLabel(y - 1) + '</option>';
		}

		$('#rpt-main').html(`
			<div class="rpt-view-toolbar">
				<button class="rpt-back" id="rpt-back">← Reports</button>
				<span class="rpt-view-title">Compare Qs &amp; Last Year</span>
				<span class="rpt-toolbar-label">Year:</span>
				<select class="rpt-toolbar-date" id="cmp-fy">${fyOpts}</select>
				<select class="rpt-toolbar-date" id="cmp-type">
					<option value="RP">Resource Person-Education</option>
					<option value="ST">School Teacher</option>
					<option value="">All Role Types</option>
				</select>
				<div class="rpt-ms" id="cmp-dept" data-placeholder="All Departments"></div>
				<div class="rpt-ms" id="cmp-roles" data-placeholder="All Roles"></div>
				<button class="rpt-btn-refresh" id="cmp-refresh">&#x21bb; Refresh</button>
				<span class="rpt-info" id="cmp-info"></span>
			</div>
			<div class="rpt-tbl-wrap" id="cmp-wrap"><div class="rpt-loading is-busy">Loading…</div></div>
		`);

		_cmpMsDept = makeMultiselect($('#cmp-dept'), function () { populateCmpRoleOptions(); applyCmpFilters(); });
		_cmpMsRole = makeMultiselect($('#cmp-roles'), applyCmpFilters);
		$('#rpt-back').on('click', showHub);
		$('#cmp-refresh').on('click', fetchCompareData);
		$('#cmp-fy').on('change', fetchCompareData);
		$('#cmp-type').on('change', function () { populateCmpRoleOptions(); applyCmpFilters(); });
		fetchCompareData();
	}

	function fetchCompareData() {
		$('#cmp-wrap').html('<div class="rpt-loading is-busy">Loading…</div>');
		var y = parseInt($('#cmp-fy').val(), 10);
		var cur = ctFyBounds(y), prev = ctFyBounds(y - 1);

		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Field Registration Form',
				fields: ['name', 'full_name_aadhaar', 'application_status', 'role', 'department',
					'location', 'native_state', 'date_of_applied', 'application_date',
					'date_of_recruiter_round', 'date_of_functional_round', 'date_of_final_round'],
				or_filters: [
					['date_of_applied', 'between', [prev.from, cur.to]],
					['application_date', 'between', [prev.from + ' 00:00:00', cur.to + ' 23:59:59']]
				],
				limit_page_length: 0,
				order_by: 'creation asc'
			},
			callback: function (r) {
				var all = (r && r.message) ? r.message : [];
				_cmpAllRecs = [];
				all.forEach(function (rec) {
					var applied = cvAppliedOf(rec);
					if (!applied) return;
					if (applied >= cur.from && applied <= cur.to) rec._fy = 'cur';
					else if (applied >= prev.from && applied <= prev.to) rec._fy = 'prev';
					else return;
					rec._applied = applied;
					rec._q = ctQuarterOf(applied);
					rec._stage = cmpStageOf(rec);
					rec._offer = CMP_OFFER_RE.test((rec.application_status || '').trim().toLowerCase());
					rec._state = cvStateOf(rec);
					_cmpAllRecs.push(rec);
				});
				var dSet = {};
				_cmpAllRecs.forEach(function (rec) { dSet[cvDeptOf(rec)] = true; });
				_cmpMsDept.setOptions(Object.keys(dSet).sort());
				populateCmpRoleOptions();
				applyCmpFilters();
			},
			error: function () {
				$('#cmp-wrap').html('<div class="rpt-loading">Failed to load. Please refresh.</div>');
			}
		});
	}

	function populateCmpRoleOptions() {
		var typeF = $('#cmp-type').val() || '';
		var deptF = _cmpMsDept.val();
		var set = {};
		_cmpAllRecs.forEach(function (r) {
			if (typeF && getCol(r.role) !== typeF) return;
			if (deptF.length && deptF.indexOf(cvDeptOf(r)) === -1) return;
			set[cvRoleOf(r)] = true;
		});
		_cmpMsRole.setOptions(Object.keys(set).sort());
	}

	function applyCmpFilters() {
		var typeF = $('#cmp-type').val() || '';
		var deptF = _cmpMsDept.val();
		var roleF = _cmpMsRole.val();
		_cmpViewRecs = _cmpAllRecs.filter(function (r) {
			if (typeF && getCol(r.role) !== typeF) return false;
			if (deptF.length && deptF.indexOf(cvDeptOf(r)) === -1) return false;
			if (roleF.length && roleF.indexOf(cvRoleOf(r)) === -1) return false;
			return true;
		});
		renderCompareBody();
	}

	function renderCompareBody() {
		var y = parseInt($('#cmp-fy').val(), 10);
		var cur = ctFyBounds(y), prev = ctFyBounds(y - 1);
		var curLbl = cmpFyLabel(y), prevLbl = cmpFyLabel(y - 1);
		var typeLbl = $('#cmp-type option:selected').text();

		// Column periods: key -> record matcher
		var qRanges = {
			Q1: [y + '-04-01', y + '-06-30'], Q2: [y + '-07-01', y + '-09-30'],
			Q3: [y + '-10-01', y + '-12-31'], Q4: [(y + 1) + '-01-01', (y + 1) + '-03-31'],
		};
		var periods = CT_QUARTERS.map(function (q) {
			return {
				key: q, title: q + ' (' + curLbl + ')', range: cmpRange(qRanges[q][0], qRanges[q][1]),
				match: function (r) { return r._fy === 'cur' && r._q === q; }, cls: ''
			};
		}).concat([
			{
				key: 'cur', title: 'Year (' + curLbl + ')', range: cmpRange(cur.from, cur.to),
				match: function (r) { return r._fy === 'cur'; }, cls: 'cmp-yr cmp-split'
			},
			{
				key: 'prev', title: 'Year (' + prevLbl + ')', range: cmpRange(prev.from, prev.to),
				match: function (r) { return r._fy === 'prev'; }, cls: 'cmp-prev cmp-split'
			},
		]);

		// counts[periodKey][stageIdx]
		var counts = {};
		periods.forEach(function (p) { counts[p.key] = CMP_STAGES.map(function () { return 0; }); });
		_cmpViewRecs.forEach(function (r) {
			periods.forEach(function (p) {
				if (!p.match(r)) return;
				for (var i = 0; i <= r._stage; i++) counts[p.key][i]++;
			});
		});

		// ── Table 1: stage funnel ──
		var h1 = '<tr><th class="cmp-corner" rowspan="3">' + escHtml(typeLbl) + '</th>';
		var h2 = '<tr>', h3 = '<tr>';
		periods.forEach(function (p) {
			h1 += '<th colspan="2" class="' + (p.cls.indexOf('cmp-split') !== -1 ? 'cmp-split' : '') + '">' + p.title + '</th>';
			h2 += '<th colspan="2" class="' + (p.cls.indexOf('cmp-split') !== -1 ? 'cmp-split' : '') + '">' + p.range + '</th>';
			h3 += '<th class="' + (p.cls.indexOf('cmp-split') !== -1 ? 'cmp-split' : '') + '">#</th><th>%</th>';
		});
		var thead1 = '<thead>' + h1 + '</tr>' + h2 + '</tr>' + h3 + '</tr></thead>';

		var tbody1 = '<tbody>';
		CMP_STAGES.forEach(function (stage, si) {
			tbody1 += '<tr><td class="cmp-stage">' + stage + '</td>';
			periods.forEach(function (p) {
				var n = counts[p.key][si];
				var prevN = si ? counts[p.key][si - 1] : 0;
				var pct = si ? (prevN ? (Math.round((n / prevN) * 1000) / 10) + '%' : '') : (n ? '100%' : '');
				tbody1 += '<td class="cmp-cell col-num ' + p.cls + '" data-p="' + p.key + '" data-s="' + si + '">' + (n || '') + '</td>'
					+ '<td class="cmp-pct col-num ' + p.cls.replace('cmp-split', '') + '">' + pct + '</td>';
			});
			tbody1 += '</tr>';
		});
		tbody1 += '</tbody>';

		// ── Table 2: total offers by state, prev FY vs selected FY ──
		var offers = {};   // state -> {prev, cur}
		_cmpViewRecs.forEach(function (r) {
			if (!r._offer) return;
			offers[r._state] = offers[r._state] || { prev: 0, cur: 0 };
			offers[r._state][r._fy]++;
		});
		var states = Object.keys(offers).filter(function (s) { return s !== CV_OTHER; })
			.sort(function (a, b) {
				return (offers[b].cur + offers[b].prev) - (offers[a].cur + offers[a].prev) || a.localeCompare(b);
			});
		if (offers[CV_OTHER]) states.push(CV_OTHER);
		var tot = { prev: 0, cur: 0 };
		states.forEach(function (s) { tot.prev += offers[s].prev; tot.cur += offers[s].cur; });

		function changeHtml(a, b) {
			if (!a && !b) return '';
			if (!a) return '<span class="cmp-up">new</span>';
			var pct = Math.round(((b - a) / a) * 1000) / 10;
			return '<span class="' + (pct >= 0 ? 'cmp-up' : 'cmp-down') + '">' + (pct >= 0 ? '▲ +' : '▼ ') + pct + '%</span>';
		}
		var thead2 = '<thead><tr><th class="col-src">State</th>'
			+ '<th>' + prevLbl + '</th><th>' + curLbl + '</th><th>Change</th></tr></thead>';
		var tbody2 = '<tbody>';
		states.forEach(function (s) {
			tbody2 += '<tr><td class="col-src cmp-state">' + escHtml(s) + '</td>'
				+ '<td class="col-num cmp-cell" data-off="' + escHtml(s) + '" data-fy="prev">' + (offers[s].prev || '') + '</td>'
				+ '<td class="col-num cmp-cell" data-off="' + escHtml(s) + '" data-fy="cur">' + (offers[s].cur || '') + '</td>'
				+ '<td class="col-num">' + changeHtml(offers[s].prev, offers[s].cur) + '</td></tr>';
		});
		tbody2 += '<tr class="row-grand"><td class="col-src">Total</td>'
			+ '<td class="col-num cmp-cell" data-off="" data-fy="prev">' + (tot.prev || '') + '</td>'
			+ '<td class="col-num cmp-cell" data-off="" data-fy="cur">' + (tot.cur || '') + '</td>'
			+ '<td class="col-num">' + changeHtml(tot.prev, tot.cur) + '</td></tr></tbody>';
		var offersHtml = states.length
			? '<table class="rpt-tbl">' + thead2 + tbody2 + '</table>'
			: '<div class="rpt-loading" style="padding:16px;text-align:left;">No offers for these filters.</div>';

		var note = '<div class="ct-note">'
			+ 'Candidates are grouped by the quarter / year they <b>applied</b> (Date of Applied). # = candidates who reached at least that stage; '
			+ '% = conversion from the stage above. Click a number to see the candidates.<br>'
			+ 'CV Shortlist = passed CV screening · Written test = appeared for the test · Leader round = Leader Round 1/2/3 or a Final round date · '
			+ 'Final round = Final/Fitment round or an offer. Offers = status Offer and later. '
			+ 'Current year quarters that haven\'t finished yet will be low.'
			+ '</div>';

		$('#cmp-wrap').html(
			'<table class="rpt-tbl cmp-tbl">' + thead1 + tbody1 + '</table>'
			+ '<div class="cmp-offers"><div class="cmp-title">Total Offers — ' + escHtml(typeLbl)
			+ ': Comparison with Last Year (' + prevLbl + ' vs ' + curLbl + ')</div>' + offersHtml + '</div>'
			+ note
		);

		var curN = _cmpViewRecs.filter(function (r) { return r._fy === 'cur'; }).length;
		$('#cmp-info').text('Applied ' + curLbl + ': ' + curN + ' | ' + prevLbl + ': ' + (_cmpViewRecs.length - curN)
			+ ' | Date: ' + frappe.datetime.now_date());

		var cols = ['ID', 'Full Name', 'Status', 'Furthest Stage', 'Role', 'State', 'Applied On'];
		var rowFn = function (r) {
			return [r.name, r.full_name_aadhaar, r.application_status, CMP_STAGES[r._stage], r.role, getState(r), r._applied];
		};
		$('#cmp-wrap').off('click.cmpCell').on('click.cmpCell', '.cmp-cell', function () {
			var $td = $(this), matched, title;
			if ($td.is('[data-fy]')) {
				var st = $td.data('off'), fy = $td.data('fy');
				matched = _cmpViewRecs.filter(function (r) { return r._offer && r._fy === fy && (!st || r._state === st); });
				title = 'Offers | ' + (st || 'All states') + ' | ' + (fy === 'cur' ? curLbl : prevLbl);
			} else {
				var p = periods.filter(function (x) { return x.key === $td.data('p'); })[0];
				var si = parseInt($td.data('s'), 10);
				matched = _cmpViewRecs.filter(function (r) { return p.match(r) && r._stage >= si; });
				title = p.title + ' | ' + CMP_STAGES[si];
			}
			if (!matched.length) { frappe.msgprint('No records found.'); return; }
			showRecordsDialog(title, matched, cols, rowFn);
		});
	}

	// ── INTERVIEWERS DATA ─────────────────────────────────────────────────
	// The recruiter's "Interviewers Data" sheet, from Field Interview
	// Schedule (non-cancelled, interview_date in the selected FY):
	//  1. One row per state + panel member: interviews done, and how many
	//     of the candidates they interviewed were later selected in the
	//     Functional round / Final round.
	//  2. Per state: number of panel members, number of interview slots per
	//     quarter + year, and average slots per panel member.
	// Rows come from ms_calendar.api.reports.get_interviewer_data — one per
	// (interview, interviewer), see that method for why it's SQL.
	// State is the candidate's (Field Registration Form, via cvStateOf, so
	// new states show up automatically); falls back to the schedule's own
	// location when the candidate's form is missing.
	var IV_ROUNDS = {
		ec: 'EC/Subject (Functional) Round',
		recruiter: 'Recruiter Round',
		leader: 'Leader / Final Round',
		'': 'All Rounds',
	};
	function ivRoundOf(r) {
		var s = (r.interview_round || '').trim().toLowerCase();
		if (/leader|final|round three|round 3/.test(s)) return 'leader';
		if (/functional|subject|demo|education capacity|round one|round two|round 1|round 2/.test(s)) return 'ec';
		if (/recruiter/.test(s)) return 'recruiter';
		return 'other';
	}
	// Selected in Functional round = candidate moved past it (reached the
	// Leader/Final round or later) or has an explicit Functional/Subject/
	// EC/Demo "Select" status. Selected in Final round = offer and later.
	function ivSelFunctional(r) {
		var s = (r.application_status || '').trim().toLowerCase();
		return cmpStageOf(r) >= 5
			|| /(functional|subject|education capacity|demo|round one|round two).*select/.test(s);
	}
	function ivSelFinal(r) {
		return CMP_OFFER_RE.test((r.application_status || '').trim().toLowerCase());
	}

	var _ivAllRows = [];    // one per (interview, interviewer), tagged
	var _ivViewRows = [];

	function showInterviewers() {
		var t = new Date();
		var curFy = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;
		var fyOpts = '';
		for (var y = curFy; y >= curFy - 3; y--) {
			fyOpts += '<option value="' + y + '">FY ' + cmpFyLabel(y) + '</option>';
		}
		var roundOpts = Object.keys(IV_ROUNDS).map(function (k) {
			return '<option value="' + k + '">' + IV_ROUNDS[k] + '</option>';
		}).join('');

		$('#rpt-main').html(`
			<div class="rpt-view-toolbar">
				<button class="rpt-back" id="rpt-back">← Reports</button>
				<span class="rpt-view-title">Interviewers Data</span>
				<span class="rpt-toolbar-label">Year:</span>
				<select class="rpt-toolbar-date" id="iv-fy">${fyOpts}</select>
				<select class="rpt-toolbar-date" id="iv-round">${roundOpts}</select>
				<select class="rpt-toolbar-date" id="iv-type">
					<option value="EDU">Education (RP &amp; ST)</option>
					<option value="RP">Resource Person</option>
					<option value="ST">School Teacher</option>
					<option value="">All Role Types</option>
				</select>
				<button class="rpt-btn-refresh" id="iv-refresh">&#x21bb; Refresh</button>
				<span class="rpt-info" id="iv-info"></span>
			</div>
			<div class="rpt-tbl-wrap" id="iv-wrap"><div class="rpt-loading is-busy">Loading…</div></div>
		`);

		$('#rpt-back').on('click', showHub);
		$('#iv-refresh').on('click', fetchInterviewerData);
		$('#iv-fy').on('change', fetchInterviewerData);
		$('#iv-round,#iv-type').on('change', applyIvFilters);
		fetchInterviewerData();
	}

	function fetchInterviewerData() {
		$('#iv-wrap').html('<div class="rpt-loading is-busy">Loading…</div>');
		var fy = ctFyBounds(parseInt($('#iv-fy').val(), 10));
		frappe.call({
			method: 'ms_calendar.api.reports.get_interviewer_data',
			args: { from_date: fy.from, to_date: fy.to },
			callback: function (r) {
				var rows = (r && r.message) ? r.message : [];
				var seen = {};
				_ivAllRows = [];
				rows.forEach(function (row) {
					// Same interviewer in both interviewer fields = one row.
					var key = row.name + '|' + (row.interviewer || '');
					if (seen[key]) return;
					seen[key] = true;
					var hasFrf = !!row.application_status || !!row.role;
					row._state = cvStateOf(hasFrf ? row
						: { department: row.fis_department, location: row.fis_location });
					row._role = row.role || row.fis_role || '';
					row._round = ivRoundOf(row);
					row._q = ctQuarterOf(String(row.interview_date).slice(0, 10));
					row._iv = row.interviewer || '';
					row._ivName = (row.interviewer_name || '').trim() || row._iv || 'Not assigned';
					_ivAllRows.push(row);
				});
				applyIvFilters();
			},
			error: function () {
				$('#iv-wrap').html('<div class="rpt-loading">Failed to load. Please refresh.</div>');
			}
		});
	}

	function applyIvFilters() {
		var roundF = $('#iv-round').val() || '';
		var typeF = $('#iv-type').val() || '';
		_ivViewRows = _ivAllRows.filter(function (r) {
			if (roundF && r._round !== roundF) return false;
			var col = getCol(r._role);
			if (typeF === 'EDU' && col !== 'RP' && col !== 'ST') return false;
			if ((typeF === 'RP' || typeF === 'ST') && col !== typeF) return false;
			return true;
		});
		renderInterviewersBody();
	}

	function renderInterviewersBody() {
		var fyStart = parseInt($('#iv-fy').val(), 10);
		var yearLbl = 'Year ' + cmpFyLabel(fyStart);
		var roundLbl = IV_ROUNDS[$('#iv-round').val() || ''];
		var typeLbl = $('#iv-type option:selected').text();

		function uniq(rows, keyFn) {
			var s = {};
			rows.forEach(function (r) { s[keyFn(r)] = r; });
			return Object.keys(s).map(function (k) { return s[k]; });
		}
		var byInterview = function (r) { return r.name; };
		var byCandidate = function (r) { return r.application_id || r.name; };

		// ── Table 1: state × panel member ──
		var groups = {};   // "state||email" -> rows
		_ivViewRows.forEach(function (r) {
			var k = r._state + '||' + r._iv;
			(groups[k] = groups[k] || []).push(r);
		});
		var t1 = Object.keys(groups).map(function (k) {
			var rows = groups[k];
			var cands = uniq(rows, byCandidate);
			return {
				key: k, state: rows[0]._state, name: rows[0]._ivName, rows: rows,
				interviews: uniq(rows, byInterview).length,
				selF: cands.filter(ivSelFunctional).length,
				selFinal: cands.filter(ivSelFinal).length,
			};
		}).sort(function (a, b) {
			var sa = a.state === CV_OTHER ? 1 : 0, sb = b.state === CV_OTHER ? 1 : 0;
			return sa - sb || a.state.localeCompare(b.state) || b.interviews - a.interviews;
		});

		var allCands = uniq(_ivViewRows, byCandidate);
		var tbl1 = '<table class="rpt-tbl iv-tbl"><thead><tr><th>State</th><th>Name of ' + escHtml(roundLbl)
			+ ' Panel Members</th><th>Total Interviews done</th><th>No of Candidates Selected in Functional Round</th>'
			+ '<th>No of Candidates Selected in Final Round</th></tr></thead><tbody>';
		var lastState = null;
		t1.forEach(function (g) {
			var stateCell = g.state !== lastState ? escHtml(g.state) : '';
			lastState = g.state;
			tbl1 += '<tr><td class="iv-state">' + stateCell + '</td>'
				+ '<td class="iv-name" title="' + escHtml(g.rows[0]._iv) + '">' + escHtml(g.name) + '</td>'
				+ '<td class="col-num iv-cell" data-t1="' + escHtml(g.key) + '" data-k="int">' + (g.interviews || '') + '</td>'
				+ '<td class="col-num iv-cell" data-t1="' + escHtml(g.key) + '" data-k="selF">' + (g.selF || '') + '</td>'
				+ '<td class="col-num iv-cell" data-t1="' + escHtml(g.key) + '" data-k="selFinal">' + (g.selFinal || '') + '</td></tr>';
		});
		tbl1 += '<tr class="row-grand"><td colspan="2" class="iv-name">Total</td>'
			+ '<td class="col-num">' + uniq(_ivViewRows, byInterview).length + '</td>'
			+ '<td class="col-num">' + allCands.filter(ivSelFunctional).length + '</td>'
			+ '<td class="col-num">' + allCands.filter(ivSelFinal).length + '</td></tr></tbody></table>';

		// ── Table 2: panel members / slots / averages by state ──
		var TOTAL = 'Total';
		var stCount = {};
		_ivViewRows.forEach(function (r) { stCount[r._state] = (stCount[r._state] || 0) + 1; });
		var states = Object.keys(stCount).filter(function (s) { return s !== CV_OTHER; })
			.sort(function (a, b) { return stCount[b] - stCount[a] || a.localeCompare(b); });
		if (stCount[CV_OTHER]) states.push(CV_OTHER);
		var cols = states.concat([TOTAL]);
		var periods = CT_QUARTERS.concat(['Year']);

		function rowsFor(state, period) {
			return _ivViewRows.filter(function (r) {
				if (state !== TOTAL && r._state !== state) return false;
				return period === 'Year' || r._q === period;
			});
		}
		function members(rows) { return uniq(rows.filter(function (r) { return r._iv; }), function (r) { return r._iv; }).length; }

		var tbl2 = '<table class="rpt-tbl iv-tbl"><thead><tr><th colspan="2">State</th>';
		cols.forEach(function (c) { tbl2 += '<th' + (c === TOTAL ? ' class="iv-tot"' : '') + '>' + escHtml(c) + '</th>'; });
		tbl2 += '</tr></thead><tbody>';
		tbl2 += '<tr><td colspan="2" class="iv-lbl">' + escHtml(typeLbl) + ' ' + escHtml(roundLbl) + ' Panel Members</td>';
		cols.forEach(function (c) {
			tbl2 += '<td class="col-num' + (c === TOTAL ? ' iv-tot' : '') + '">' + (members(rowsFor(c, 'Year')) || '') + '</td>';
		});
		tbl2 += '</tr>';
		[['slots', 'No of Slots'], ['avg', 'Averages']].forEach(function (sec) {
			periods.forEach(function (p, pi) {
				var isYear = p === 'Year';
				tbl2 += '<tr' + (isYear ? ' class="iv-year"' : '') + '>';
				if (pi === 0) tbl2 += '<td class="iv-group" rowspan="' + periods.length + '">' + sec[1] + '</td>';
				tbl2 += '<td class="iv-lbl">' + (isYear ? yearLbl : p) + '</td>';
				cols.forEach(function (c) {
					var rows = rowsFor(c, p);
					var slots = uniq(rows, byInterview).length;
					var val;
					// Average = interviews each panel member took: (interview,
					// member) pairs ÷ members. Interviews with no panel member
					// on the schedule are left out — they belong to nobody.
					if (sec[0] === 'slots') val = slots || '';
					else {
						var m = members(rows);
						var taken = rows.filter(function (r) { return r._iv; }).length;
						val = m ? Math.round((taken / m) * 10) / 10 : '';
					}
					var cls = 'col-num' + (c === TOTAL ? ' iv-tot' : '') + (sec[0] === 'slots' && slots ? ' iv-cell' : '');
					tbl2 += '<td class="' + cls + '"' + (sec[0] === 'slots' ? ' data-st="' + escHtml(c) + '" data-p="' + p + '"' : '') + '>' + val + '</td>';
				});
				tbl2 += '</tr>';
			});
		});
		tbl2 += '</tbody></table>';

		var note = '<div class="ct-note">'
			+ 'From Field Interview Schedule (cancelled interviews excluded), interview date in ' + cmpFyLabel(fyStart)
			+ '. A slot = one scheduled interview; Averages = interviews per panel member in that period '
			+ '(an interview with 2 panel members counts once in slots and once for each member). '
			+ '"Not assigned" = interviews with no panel member saved on the schedule — not included in Averages.<br>'
			+ 'Selected in Functional Round = candidate went on to the Leader/Final round or later (or has a Functional/Subject/EC Select status). '
			+ 'Selected in Final Round = candidate reached Offer or later. Candidate status is read from their Field Registration Form today. '
			+ 'State = candidate\'s state (new states appear automatically). Click a number to see the list.'
			+ '</div>';

		if (!_ivViewRows.length) {
			$('#iv-wrap').html('<div class="rpt-loading">No interviews match these filters.</div>' + note);
		} else {
			$('#iv-wrap').html(
				'<div class="iv-title">' + escHtml(typeLbl) + ' — ' + escHtml(roundLbl) + ' Panel Members</div>' + tbl1
				+ '<div class="iv-sec"><div class="iv-title">Slots &amp; Averages by State</div>' + tbl2 + '</div>' + note
			);
		}
		$('#iv-info').text('Interviews: ' + uniq(_ivViewRows, byInterview).length
			+ ' | Panel members: ' + members(_ivViewRows) + ' | Date: ' + frappe.datetime.now_date());

		var ivCols = ['ID', 'Candidate', 'Round', 'Interview Date', 'Panel Member', 'Role', 'State', 'Candidate Status'];
		var ivRow = function (r) {
			return [r.name, r.applicants_name, r.interview_round, r.interview_date, r._ivName, r._role, r._state, r.application_status];
		};
		$('#iv-wrap').off('click.ivCell').on('click.ivCell', '.iv-cell', function () {
			var $td = $(this);
			if ($td.is('[data-t1]')) {
				var g = t1.filter(function (x) { return x.key === $td.data('t1'); })[0];
				if (!g) return;
				var k = $td.data('k');
				if (k === 'int') {
					showRecordsDialog(g.name + ' | Interviews', uniq(g.rows, byInterview), ivCols, ivRow, 'Field Interview Schedule');
				} else {
					var sel = uniq(g.rows, byCandidate).filter(k === 'selF' ? ivSelFunctional : ivSelFinal)
						.filter(function (r) { return r.application_id; });
					if (!sel.length) { frappe.msgprint('No records found.'); return; }
					showRecordsDialog(g.name + ' | Selected in ' + (k === 'selF' ? 'Functional' : 'Final') + ' Round',
						sel.map(function (r) { return $.extend({}, r, { name: r.application_id }); }),
						['ID', 'Candidate', 'Candidate Status', 'Role', 'State', 'Interview Date'],
						function (r) { return [r.name, r.applicants_name, r.application_status, r._role, r._state, r.interview_date]; });
				}
			} else {
				var st = $td.data('st'), p = $td.data('p');
				var rows = uniq(rowsFor(st, p), byInterview);
				showRecordsDialog(st + ' | ' + (p === 'Year' ? yearLbl : p) + ' | Slots', rows, ivCols, ivRow, 'Field Interview Schedule');
			}
		});
	}

	// ── Initial render ────────────────────────────────────────────────────
	showHub();
};
