frappe.pages['reports'].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Reports',
		single_column: true
	});

	// ── Shared constants ─────────────────────────────────────────────────
	function getCol(role) {
		var r = (role || '').trim().toLowerCase();
		if (r === 'school teacher') return 'ST';
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
	}

	// ── Shared: show records dialog with CSV export + Frappe links ────────
	function showRecordsDialog(title, records, headers, rowFn) {
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
				? frappe.utils.get_url_to_form('Field Registration Form', r.name)
				: '/app/field-registration-form/' + encodeURIComponent(r.name);
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
			+ '<div style="overflow:auto;max-height:420px;">' + tbl + '</div>';

		var d = frappe.msgprint({ title: title + ' (' + records.length + ')', wide: true, message: html });

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
				fields: ['name', 'full_name_aadhaar', 'application_status', 'role', 'department',
					'location', 'worklocation', 'native_state', 'native_district', 'opportunity',
					'email_address', 'phone_number', 'alternate_no', 'gender', 'dob', 'age',
					'highest_education', 'teaching_degrees', 'teaching_year', 'teachingexp_month',
					'health_expyear', 'health_expmonth', 'languages_known', 'written_subject',
					'test_location', 'apf_associated', 'former_employee',
					'reasons_for_shortlist', 'reasons_for_reject', 'hold_reason', 'blocklist_reason',
					'creation'],
				limit_page_length: 10000,
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

			showRecordsDialog(title, matched,
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
				limit_page_length: 10000,
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
				limit_page_length: 10000,
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

	// ── Initial render ────────────────────────────────────────────────────
	showHub();
};
