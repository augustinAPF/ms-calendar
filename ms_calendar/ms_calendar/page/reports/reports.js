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


	// ── Styles ────────────────────────────────────────────────────────────
	$(wrapper).find('.page-content').append(`<style>
		.rpt-wrap { padding: 16px 20px 40px; }
		/* ── Hub cards ── */
		.rpt-hub-title { font-size:15px; font-weight:700; color:#374151; margin-bottom:16px;
			padding-bottom:10px; border-bottom:2px solid #e5e7eb; }
		.rpt-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:16px; }
		.rpt-card { border-radius:10px; border:1.5px solid #ddd; padding:18px 16px 14px;
			cursor:pointer; transition:box-shadow .18s,transform .15s;
			display:flex; flex-direction:column; gap:5px; position:relative; }
		.rpt-card:hover { box-shadow:0 4px 18px rgba(0,0,0,.13); transform:translateY(-2px); }
		.rpt-card.unavailable { opacity:.5; cursor:not-allowed; }
		.rpt-card.unavailable:hover { box-shadow:none; transform:none; }
		.rpt-card-icon { font-size:24px; margin-bottom:3px; }
		.rpt-card-title { font-size:13px; font-weight:700; }
		.rpt-card-desc { font-size:11px; color:#6b7280; line-height:1.4; }
		.rpt-badge { display:inline-block; margin-top:7px; padding:2px 10px; border-radius:20px;
			font-size:11px; font-weight:600; }
		.rpt-badge.open { background:#D1FAE5; color:#065F46; }
		.rpt-badge.soon { background:#F3F4F6; color:#9CA3AF; }
		/* ── Report view ── */
		.rpt-view-toolbar { display:flex; align-items:center; gap:10px; padding:0 0 12px; flex-wrap:wrap; }
		.rpt-back { display:inline-flex; align-items:center; gap:5px; padding:5px 14px;
			border-radius:6px; background:#e5e7eb; color:#374151; font-weight:600;
			font-size:12px; border:1px solid #d1d5db; cursor:pointer; }
		.rpt-back:hover { background:#d1d5db; }
		.rpt-view-title { font-size:15px; font-weight:700; color:#1F497D; }
		.rpt-toolbar-label { font-size:12px; color:#374151; font-weight:600; }
		.rpt-toolbar-date { border:1px solid #d1d5db; border-radius:4px; padding:4px 8px;
			font-size:12px; }
		.rpt-btn-refresh { display:inline-flex; align-items:center; gap:5px; padding:5px 13px;
			border-radius:5px; background:#e5e7eb; color:#374151; font-weight:600;
			font-size:12px; border:1px solid #d1d5db; cursor:pointer; }
		.rpt-btn-refresh:hover { background:#d1d5db; }
		.rpt-btn-dl { display:inline-flex; align-items:center; gap:5px; padding:5px 14px;
			border-radius:5px; background:#1a7f4f; color:#fff; font-weight:600;
			font-size:12px; border:none; cursor:pointer; }
		.rpt-btn-dl:hover { background:#145e3a; }
		.rpt-tbl-wrap { overflow-x:auto; overflow-y:auto; max-height:calc(100vh - 200px); }
		.rpt-tbl { border-collapse:collapse; font-size:11px; white-space:nowrap;
			width:max-content; min-width:100%; }
		.rpt-tbl th, .rpt-tbl td { border:1px solid #bbb; padding:4px 6px;
			text-align:center; vertical-align:middle; }
		.rpt-tbl thead tr:first-child th { background:#1F497D; color:#fff; font-weight:700;
			font-size:12px; position:sticky; top:0; z-index:20; }
		.rpt-tbl thead tr:nth-child(2) th { position:sticky; top:33px; z-index:19;
			font-weight:700; font-size:11px; }
		.rpt-tbl thead tr:nth-child(3) th { position:sticky; top:60px; z-index:18;
			font-weight:600; font-size:10px; }
		.rpt-tbl .col-month { min-width:72px; font-weight:700; position:sticky; left:0; z-index:10; }
		.rpt-tbl .col-status { min-width:200px; text-align:left; position:sticky;
			left:80px; z-index:10; white-space:normal; }
		.rpt-tbl .col-src { min-width:160px; max-width:180px; text-align:left; position:sticky;
			left:0; z-index:10; white-space:normal; background:inherit; }
		.rpt-tbl .col-num { min-width:46px; font-variant-numeric:tabular-nums; }
		.rpt-tbl .row-grand td { background:#BDD7EE !important; font-weight:700; }
		.rpt-tbl .col-total-rp,.rpt-tbl .col-total-st { background:#D9D9D9 !important; font-weight:700; }
		.rpt-loading { padding:50px; text-align:center; color:#6b7280; font-size:14px; }
		.rpt-info { font-size:11px; color:#6b7280; margin-left:auto; }
		/* ── Month multi-select ── */
		.ar-month-picker { position:relative; }
		.ar-month-btn { padding:5px 12px; border-radius:5px; border:1px solid #d1d5db;
			background:#fff; font-size:12px; font-weight:600; cursor:pointer; color:#374151; }
		.ar-month-btn:hover { background:#f3f4f6; }
		.ar-month-drop { position:absolute; top:calc(100% + 4px); left:0; z-index:100;
			background:#fff; border:1px solid #d1d5db; border-radius:8px;
			box-shadow:0 4px 16px rgba(0,0,0,.12); min-width:160px; padding-bottom:2px; }
		.ar-month-actions { display:flex; gap:12px; padding:8px 10px 6px;
			border-bottom:1px solid #e5e7eb; }
		.ar-month-link { font-size:11px; color:#2563eb; cursor:pointer; font-weight:600; }
		.ar-month-link:hover { text-decoration:underline; }
		#ar-month-checks { max-height:220px; overflow-y:auto; padding:6px 4px; }
		.ar-month-item { display:flex; align-items:center; gap:6px; padding:4px 10px;
			font-size:12px; color:#374151; cursor:pointer; border-radius:4px; }
		.ar-month-item:hover { background:#f3f4f6; }
		/* ── Records drill-down dialog: full screen ── */
		.rec-dlg-fullscreen { width:96vw !important; max-width:96vw !important;
			height:92vh; margin:4vh auto !important; }
		.rec-dlg-fullscreen .modal-content { height:92vh; display:flex; flex-direction:column; }
		.rec-dlg-fullscreen .modal-body { flex:1 1 auto; overflow:auto; }
		.rec-dlg-fullscreen .modal-header,.rec-dlg-fullscreen .modal-footer { flex:0 0 auto; }
		.ar-month-item input { cursor:pointer; accent-color:#1F497D; }
	</style>
	<div class="rpt-wrap" id="rpt-main"></div>`);

	// ── REPORTS definition ────────────────────────────────────────────────
	const REPORTS = [
		{
			key: 'pipeline', title: 'Pipeline', icon: '📊', color: '#1F497D', bg: '#EBF3FB', border: '#1F497D',
			desc: 'Overall recruitment pipeline across all states & roles', available: true
		},
		{
			key: 'apps_received', title: 'Applications Received', icon: '📥', color: '#7D4F00', bg: '#FFF8E1', border: '#F9A825',
			desc: 'Month-wise CV stage breakdown by state & role', available: true
		},
		{
			key: 'source', title: 'Source', icon: '🔗', color: '#6A1B9A', bg: '#F3E5F5', border: '#8E24AA',
			desc: 'Candidate source breakdown by role type', available: true
		},
		{
			key: 'cycle', title: 'Cycle Time', icon: '⏱️', color: '#1B4F72', bg: '#E3F2FD', border: '#1565C0',
			desc: 'Stage-to-stage cycle times by quarter', available: false
		},
		{
			key: 'conversion', title: 'Conversion', icon: '🔄', color: '#7E2E0E', bg: '#FBE9E7', border: '#BF360C',
			desc: 'Stage conversion rates by state and quarter', available: false
		},
		{
			key: 'compare', title: 'Compare Qs & Last Year', icon: '📈', color: '#117A65', bg: '#E8F8F5', border: '#117A65',
			desc: 'Quarter-on-quarter and year-on-year comparison', available: false
		},
		{
			key: 'interviewers', title: 'Interviewers Data', icon: '👥', color: '#424242', bg: '#F5F5F5', border: '#757575',
			desc: 'Interviewer-wise feedback and selection statistics', available: false
		},
		{
			key: 'offers', title: 'Offers', icon: '📋', color: '#4A2C0A', bg: '#FFF3E0', border: '#E65100',
			desc: 'Offer pipeline — made, accepted, declined, joined', available: true
		},
		{
			key: 'daily', title: 'Daily (Recruiters)', icon: '🗓️', color: '#0B5345', bg: '#E9F7EF', border: '#0E6655',
			desc: 'New applications, status changes & pending actions — today', available: true
		},
		{
			key: 'weekly', title: 'Weekly (Recruitment)', icon: '📅', color: '#7B241C', bg: '#FDEDEC', border: '#943126',
			desc: 'Pipeline funnel, role/location breakdown & conversion — this week', available: true
		},
		{
			key: 'st_weekly', title: 'School Teacher — Week wise', icon: '🏫', color: '#6D4C00', bg: '#FFF3D6', border: '#F5A623',
			desc: 'Week-by-week (Mon–Sun) application breakdown for School Teacher, by stage', available: true
		},
		{
			key: 'st_district', title: 'School Teacher — District Funnel', icon: '📌', color: '#7D4F00', bg: '#FFF8E1', border: '#F5A623',
			desc: 'District-wise full funnel — CV, Test, Recruiter/Subject/Demo/Leader Rounds', available: true
		},
	];

	// ── Render hub (card grid) ────────────────────────────────────────────
	function showHub() {
		$('#rpt-main').html(`
			<div class="rpt-hub-title">Field Recruitment — All Reports</div>
			<div class="rpt-grid" id="rpt-grid"></div>
		`);
		REPORTS.forEach(function (r) {
			var badge = r.available
				? '<span class="rpt-badge open">Open →</span>'
				: '<span class="rpt-badge soon">Coming soon</span>';
			var card = $(`<div class="rpt-card ${r.available ? '' : 'unavailable'}"
				style="background:${r.bg};border-color:${r.border};">
				<div class="rpt-card-icon">${r.icon}</div>
				<div class="rpt-card-title" style="color:${r.color};">${r.title}</div>
				<div class="rpt-card-desc">${r.desc}</div>
				${badge}
			</div>`);
			if (r.available) {
				card.on('click', function () { loadReport(r.key); });
			}
			$('#rpt-grid').append(card);
		});
	}

	// ── Route to correct report ───────────────────────────────────────────
	function loadReport(key) {
		if (key === 'pipeline') { frappe.set_route('field-over-all-dashb'); return; }
		if (key === 'apps_received') { showAppsReceived(); return; }
		if (key === 'source') { showSource(); return; }
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
			records.forEach(function(r) {
				lines.push(rowFn(r).map(function(v) {
					return '"' + (v || '').toString().replace(/"/g,'""') + '"';
				}).join(','));
			});
			var blob = new Blob([lines.join('\n')], {type:'text/csv'});
			var url = URL.createObjectURL(blob);
			var a = document.createElement('a'); a.href=url;
			a.download = title.replace(/[^a-z0-9]/gi,'_').slice(0,40) + '.csv';
			document.body.appendChild(a); a.click();
			document.body.removeChild(a); URL.revokeObjectURL(url);
		}

		var rows = records.map(function(r) {
			var vals = rowFn(r);
			var link = frappe.utils.get_url_to_form
				? frappe.utils.get_url_to_form(doctype, r.name)
				: '/app/' + frappe.router.slug(doctype) + '/' + encodeURIComponent(r.name);
			var cells = vals.map(function(v, i) {
				if (i === 0) {
					return '<td style="padding:4px 8px;white-space:nowrap;">'
						+ '<a href="' + link + '" target="_blank" '
						+ 'style="color:#1F497D;font-weight:600;">' + (v||'') + '</a>'
						+ '</td>';
				}
				return '<td style="padding:4px 8px;">' + (v||'') + '</td>';
			}).join('');
			return '<tr>' + cells + '</tr>';
		}).join('');

		var thCells = headers.map(function(h) {
			return '<th style="padding:6px 8px;white-space:nowrap;">' + h + '</th>';
		}).join('');

		var tbl = '<table id="rec-dlg-tbl" style="width:100%;border-collapse:collapse;font-size:12px;">'
			+ '<thead><tr style="background:#1F497D;color:#fff;">' + thCells + '</tr></thead>'
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
		setTimeout(function() {
			$('#rec-csv-btn').off('click').on('click', csvDownload);
			$('#rec-print-btn').off('click').on('click', function() {
				var w = window.open('', '_blank');
				w.document.write('<html><head><title>' + title + '</title>'
					+ '<style>table{border-collapse:collapse;font-size:12px;width:100%}'
					+ 'th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}'
					+ 'th{background:#1F497D;color:#fff}</style></head><body>'
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
		cv_regret:    ['CV Reject', 'Rejected'],
		cv_pending:   ['New Applicant', 'Applied', 'On Hold'],
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
				<div class="rpt-loading">Loading…</div>
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
		$('#ar-tbl-wrap').html('<div class="rpt-loading">Loading…</div>');
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
		thead += '<th colspan="2" style="background:#1F497D;color:#fff;">Total</th></tr>';
		thead += '<tr>';
		_arStates.forEach(function (_s, si) {
			var bg = STATE_COLORS[si % STATE_COLORS.length];
			thead += '<th style="background:' + bg + ';font-size:10px;">Role</th><th style="background:' + bg + ';font-size:10px;">Role</th>';
		});
		thead += '<th style="background:#2a5fa0;color:#fff;font-size:10px;">Role</th><th style="background:#2a5fa0;color:#fff;font-size:10px;">Role</th></tr>';
		thead += '<tr>';
		_arStates.forEach(function (_s, si) {
			var bg = STATE_COLORS[si % STATE_COLORS.length];
			thead += '<th style="background:' + bg + ';">RP</th><th style="background:' + bg + ';">ST</th>';
		});
		thead += '<th style="background:#2a5fa0;color:#fff;">RP</th><th style="background:#2a5fa0;color:#fff;">ST</th></tr></thead>';

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
			var ml     = $(this).data('month');
			var state  = $(this).data('state');
			var col    = $(this).data('col');
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
						['ID','Full Name','Status','Role','Department',
						 'Work State','Work Location','Native State','Native District','Source',
						 'Email','Phone','Alt Phone','Gender','DOB','Age',
						 'Education','Teaching Degree','Teaching Exp(Yr)','Teaching Exp(Mo)',
						 'Health Exp(Yr)','Health Exp(Mo)','Languages','Written Subject',
						 'Test Location','APF Associated','Former Employee',
						 'Shortlist Reason','Reject Reason','Hold Reason','Blocklist Reason','Date'],
						function(r) {
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
				<div class="rpt-loading">Loading…</div>
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
		$('#src-tbl-wrap').html('<div class="rpt-loading">Loading…</div>');
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
		var selDist  = $('#src-district').val() || '';
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
		thead += '<th class="col-src" rowspan="2" style="background:#1F497D;color:#fff;z-index:25;top:0;">Source</th>';
		SRC_GROUPS.forEach(function (g) {
			var bg = g === 'Total' ? '#1F497D' : SRC_COLORS[g];
			var fg = g === 'Total' ? '#fff' : '#000';
			thead += '<th colspan="2" style="background:' + bg + ';color:' + fg + ';">' + g + '</th>';
		});
		thead += '</tr><tr>';
		SRC_GROUPS.forEach(function (g) {
			var bg = g === 'Total' ? '#2a5fa0' : SRC_COLORS[g];
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
				<div class="rpt-loading">Loading…</div>
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
		$('#off-content').html('<div class="rpt-loading">Loading…</div>');
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
		head += '<th class="col-month" style="z-index:25;top:0;background:#1F497D;color:#fff;">Month</th>';
		states.forEach(function (s, si) {
			head += '<th style="background:' + STATE_COLORS[si % STATE_COLORS.length] + ';">' + s + '</th>';
		});
		head += '<th style="background:#1F497D;color:#fff;">Total</th></tr></thead>';

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
		body += '<tr style="font-weight:700;"><td class="col-month" style="background:#1F497D;color:#fff;">Total</td>';
		states.forEach(function (s) {
			body += '<td class="col-num" style="background:#D9D9D9;">' + (yearTotals[s] || '') + '</td>';
		});
		body += '<td class="col-num" style="background:#1F497D;color:#fff;">' + (yTotal || '') + '</td></tr></tbody>';

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
		var s1Head = '<thead><tr><th class="col-src" style="background:#1F497D;color:#fff;z-index:25;top:0;">Role</th>';
		states.forEach(function (s, si) { s1Head += '<th style="background:' + SC[si % SC.length] + ';">' + s + '</th>'; });
		s1Head += '<th style="background:#1F497D;color:#fff;">Total</th></tr></thead>';

		var s1Body = '<tbody>';
		OFFER_ROLES.forEach(function (rl) {
			var bg = OFFER_ROLE_COLORS[rl] || '#fff';
			s1Body += '<tr><td class="col-src" style="background:' + bg + ';font-weight:600;">' + rl + '</td>';
			states.forEach(function (s) { s1Body += '<td class="col-num" style="background:' + bg + ';">' + ((summary[rl] && summary[rl][s]) || '') + '</td>'; });
			s1Body += '<td class="col-num" style="background:#D9D9D9;font-weight:700;">' + (summaryTotals[rl] || '') + '</td></tr>';
		});
		s1Body += '<tr style="font-weight:700;"><td class="col-src" style="background:#D9D9D9;">Total Offers</td>';
		states.forEach(function (s) { s1Body += '<td class="col-num" style="background:#D9D9D9;">' + (stateTotals[s] || '') + '</td>'; });
		s1Body += '<td class="col-num" style="background:#1F497D;color:#fff;">' + (grandTotal || '') + '</td></tr></tbody>';

		var table1 = '<div style="margin-bottom:24px;">'
			+ '<div style="font-weight:700;font-size:13px;color:#1F497D;margin-bottom:6px;padding:6px 8px;background:#EBF3FB;border-radius:6px;">Offers in ' + monthName + '</div>'
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
			{ grp: 'Livelihoods', title: 'Livelihoods — Monthly Offers by State', bg: '#EBF3FB', fg: '#1F497D' },
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
			<div id="daily-content"><div class="rpt-loading">Loading…</div></div>
		`);
		$('#daily-date-label').text('Date: ' + frappe.datetime.get_today());
		$('#rpt-back').on('click', showHub);
		$('#daily-refresh').on('click', fetchDailyData);
		fetchDailyData();
	}

	function fetchDailyData() {
		$('#daily-content').html('<div class="rpt-loading">Loading…</div>');
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
		$grid.append(statCard("Today's Interviews", interviewsToday.length, '#1F497D', '#EBF3FB', interviewsToday, function () {
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
				+ '<thead><tr><th class="col-src" style="background:#1F497D;color:#fff;">Role</th>'
				+ '<th style="background:#1F497D;color:#fff;">Count</th></tr></thead>'
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
			<div id="weekly-content"><div class="rpt-loading">Loading…</div></div>
		`);
		$('#weekly-range-label').text('Week: ' + fmtDate(thisWk.from) + ' to ' + fmtDate(thisWk.to) + ' (Mon–Sun)');
		$('#rpt-back').on('click', showHub);
		$('#weekly-refresh').on('click', fetchWeeklyData);
		fetchWeeklyData();
	}

	function fetchWeeklyData() {
		$('#weekly-content').html('<div class="rpt-loading">Loading…</div>');
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
			+ '<thead><tr><th class="col-src" style="background:#1F497D;color:#fff;">Stage</th>'
			+ '<th style="background:#1F497D;color:#fff;">This Week</th><th style="background:#1F497D;color:#fff;">Last Week</th>'
			+ '<th style="background:#1F497D;color:#fff;">Δ</th></tr></thead><tbody>' + funnelRows
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
			var rlHead = '<th class="col-src" style="background:#1F497D;color:#fff;">Role</th>'
				+ locs.map(function (l) { return '<th style="background:#1F497D;color:#fff;">' + l + '</th>'; }).join('')
				+ '<th style="background:#2a5fa0;color:#fff;">Total</th>';
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
			+ '<div class="rpt-card" style="cursor:default;background:#EBF3FB;border-color:#1F497D;">'
			+ '<div class="rpt-card-title" style="color:#1F497D;font-size:24px;">' + convRate + '</div>'
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
			<div class="rpt-tbl-wrap" id="stw-tbl-wrap"><div class="rpt-loading">Loading…</div></div>
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
		$('#stw-tbl-wrap').html('<div class="rpt-loading">Loading…</div>');
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
			+ '<th class="col-month" style="background:#1F497D;color:#fff;">Week (Mon–Sun)</th>'
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
		{ label: 'Subject Round Interview Scheduled', key: 'sr_sched', statuses: ['Round One', 'Subject Round-Interview Scheduled', 'Functional Round-Interview Scheduled', 'Functional Round-Interviewed'] },
		{ label: 'Subject Round Interview Selected', key: 'sr_sel', statuses: ['Round One Select', 'Functional Round-Interview Selected'] },
		{ label: 'Subject Round Interview Rejected', key: 'sr_rej', statuses: ['Round 1 Reject', 'Subject Round-Interview Rejected', 'Functional Round-Interview Rejected'] },
		{ label: 'Demo Round Scheduled', key: 'dr_sched', statuses: ['Round Two', 'Subject/Classroom Demo Round-Interview Scheduled', 'Principal/Demo Round-Interview Scheduled'] },
		{ label: 'Demo Round Selected', key: 'dr_sel', statuses: ['Round Two Select', 'Subject/Classroom Demo Round-Interview Selected', 'Principal/Demo Round-Interview Selected'] },
		{ label: 'Demo Round Rejected', key: 'dr_rej', statuses: ['Round 2 Reject', 'Subject/Classroom Demo Round-Interview Rejected', 'Principal/Demo Round-Interview Rejected', 'Demo Round-Interview Rejected', 'Demo & Leader Round-Interview Rejected'] },
		{ label: 'Leader Round 1 Interview Scheduled', key: 'lr1_sched', statuses: ['Leader Round 1-Interview Scheduled', 'Leader Round 1-Interviewed'] },
		{ label: 'Leader Round 1 Interview Selected', key: 'lr1_sel', statuses: ['Leader Round 1-Interview Selected', 'Leader Round-Interview Selected'] },
		{ label: 'Leader Round 1 Interview Rejected', key: 'lr1_rej', statuses: ['Leader Round 1-Interview Rejected'] },
		{ label: 'Leader Round 3 Interview Scheduled', key: 'lr3_sched', statuses: ['Round Three', 'Leader Round 3-Interview Scheduled', 'Leader Round 3-Interviewed'] },
		{ label: 'Leader Round 3 Interview Selected', key: 'lr3_sel', statuses: ['Round Three Select', 'Leader Round 3-Interview Selected'] },
		{ label: 'Leader Round 3 Interview Rejected', key: 'lr3_rej', statuses: ['Round 3 Reject', 'Leader Round 3-Interview Rejected'] },
		{ label: 'Pending with CBT (Offer Released)', key: 'pending_cbt', statuses: ['Pending With CBT', 'CBT Assigned', 'Offer', 'Offer Sent'] },
	];

	var _stfAllRecs = [];   // everything fetched for the current date range (unfiltered by State/School)
	var _stfViewRecs = [];  // _stfAllRecs after the State/School dropdown filters are applied — what actually renders
	var _stfDistricts = [];

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

	// Populate the State / School dropdowns from the full fetched set
	// (_stfAllRecs), not the already-filtered _stfViewRecs — otherwise
	// picking a State would narrow the School list to only that state's
	// schools and vice versa, instead of both staying full option lists.
	// Preserves the current selection across a Refresh (re-fetch) as long
	// as that value still exists in the new data.
	function populateSTFFilterDropdowns() {
		var stSet = {}, schSet = {};
		_stfAllRecs.forEach(function (r) {
			var st = (r.native_state || '').trim();
			if (st) stSet[st] = true;
			schSet[districtOf(r)] = true;
		});
		var curState = $('#stf-state').val() || '';
		var curSchool = $('#stf-school').val() || '';

		var $st = $('#stf-state').empty().append('<option value="">All States</option>');
		Object.keys(stSet).sort().forEach(function (v) { $st.append('<option value="' + v + '">' + v + '</option>'); });
		if (stSet[curState]) $st.val(curState);

		var $sch = $('#stf-school').empty().append('<option value="">All Schools</option>');
		Object.keys(schSet).sort().forEach(function (v) { $sch.append('<option value="' + v + '">' + v + '</option>'); });
		if (schSet[curSchool]) $sch.val(curSchool);
	}

	// Applies the current State / School dropdown selections on top of
	// _stfAllRecs into _stfViewRecs, then re-renders — called both on
	// dropdown change and right after a fetch.
	function applySTFFilters() {
		var stF = $('#stf-state').val() || '';
		var schF = $('#stf-school').val() || '';
		_stfViewRecs = _stfAllRecs.filter(function (r) {
			if (stF && (r.native_state || '').trim() !== stF) return false;
			if (schF && districtOf(r) !== schF) return false;
			return true;
		});
		var infoText = 'School Teacher records: ' + _stfViewRecs.length;
		if (stF || schF) infoText += ' of ' + _stfAllRecs.length;
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
				<select class="rpt-toolbar-date" id="stf-state" style="min-width:140px;"><option value="">All States</option></select>
				<select class="rpt-toolbar-date" id="stf-school" style="min-width:160px;"><option value="">All Schools</option></select>
				<button class="rpt-btn-refresh" id="stf-refresh">&#x21bb; Refresh</button>
				<button class="rpt-btn-dl" id="stf-download">⬇ Download Excel</button>
				<span class="rpt-info" id="stf-info"></span>
			</div>
			<div class="rpt-tbl-wrap" id="stf-tbl-wrap"><div class="rpt-loading">Loading…</div></div>
		`);

		(function () {
			var t = new Date();
			var yr = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;
			$('#stf-from').val(yr + '-04-01');
			$('#stf-to').val(t.toISOString().slice(0, 10));
		})();

		$('#rpt-back').on('click', showHub);
		$('#stf-refresh').on('click', fetchSTDistrictData);
		// Re-filter in the browser only — no re-fetch needed, since
		// _stfAllRecs already has every record for the current date range.
		$('#stf-state,#stf-school').on('change', applySTFFilters);
		// Real .xlsx with the same header/row colours as the on-screen
		// table — the CSV export used elsewhere on this page has no
		// concept of colour, so this is a server-rendered file instead
		// (ms_calendar.api.reports.download_st_district_funnel), built
		// with the exact same From/To/State/School filters currently on
		// screen.
		$('#stf-download').on('click', function () {
			var from = $('#stf-from').val() || '';
			var to = $('#stf-to').val() || '';
			var state = $('#stf-state').val() || '';
			var school = $('#stf-school').val() || '';
			var url = '/api/method/ms_calendar.api.reports.download_st_district_funnel'
				+ '?from_date=' + encodeURIComponent(from) + '&to_date=' + encodeURIComponent(to)
				+ '&native_state=' + encodeURIComponent(state) + '&school=' + encodeURIComponent(school);
			window.open(url, '_blank');
		});
		fetchSTDistrictData();
	}

	function fetchSTDistrictData() {
		$('#stf-tbl-wrap').html('<div class="rpt-loading">Loading…</div>');
		var from = $('#stf-from').val() || '';
		var to = $('#stf-to').val() || '';
		var filters = [];
		if (from) filters.push(['creation', '>=', from + ' 00:00:00']);
		if (to) filters.push(['creation', '<=', to + ' 23:59:59']);
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
					'location', 'native_state', 'native_district', 'creation'],
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
				_stfAllRecs = all.filter(function (rec) { return getCol(rec.role) === 'ST'; });
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

		var thead = '<thead><tr><th class="col-src" style="background:#1F497D;color:#fff;z-index:25;top:0;">School</th>';
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

	// ── Initial render ────────────────────────────────────────────────────
	showHub();
};
