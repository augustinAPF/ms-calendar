frappe.pages['field-over-all-dashb'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Field Over All Dashboard',
		single_column: true
	});

	// ── Stage / row definitions ───────────────────────────────────────────
	const STAGES = [
		{
			stage: 'Applications', bg: '#ffffff', fg: '#1F497D',
			rows: [
				{ label: 'Carried forward Application from last year Before April', key: 'carried_forward' },
				{ label: 'Received from April this Year', key: 'received_this_year' },
				{ label: 'Total Applications', key: 'total', isTotal: true },
			]
		},
		{
			stage: 'CV screening', bg: '#ffffff', fg: '#1F497D',
			rows: [
				{ label: 'Shortlist', key: 'cv_shortlist' },
				{ label: 'Regret', key: 'cv_regret' },
				{ label: 'Pending', key: 'cv_pending' },
			]
		},
		{
			stage: 'Written test', bg: '#ffffff', fg: '#1F497D',
			rows: [
				{ label: 'Select', key: 'written_select' },
				{ label: 'Regret', key: 'written_regret' },
			]
		},
		{
			stage: 'Recruiter screening', bg: '#ffffff', fg: '#1F497D',
			rows: [
				{ label: 'Select', key: 'recruiter_select' },
				{ label: 'Regret', key: 'recruiter_regret' },
				{ label: 'Pending', key: 'recruiter_pending' },
			]
		},
		{
			stage: 'Functional round', bg: '#ffffff', fg: '#1F497D',
			rows: [
				{ label: 'Select', key: 'functional_select' },
				{ label: 'Regret', key: 'functional_regret' },
				{ label: 'Scheduled', key: 'functional_scheduled' },
				{ label: 'Feedback Pending', key: 'functional_feedback_pending' },
				{ label: 'Pending', key: 'functional_pending' },
			]
		},
		{
			stage: 'Final round', bg: '#ffffff', fg: '#1F497D',
			rows: [
				{ label: 'Select', key: 'final_select' },
				{ label: 'Regret', key: 'final_regret' },
				{ label: 'Scheduled', key: 'final_scheduled' },
				{ label: 'Feedback Pending', key: 'final_feedback_pending' },
				{ label: 'Pending', key: 'final_pending' },
			]
		},
		{
			stage: 'Offers', bg: '#ffffff', fg: '#1F497D',
			rows: [
				{ label: 'Offer in process', key: 'offer_in_process' },
				{ label: 'Offer Made', key: 'offer_made' },
				{ label: 'Offer Accepted', key: 'offer_accepted' },
				{ label: 'Joined', key: 'joined' },
				{ label: 'Offer declined', key: 'offer_declined' },
				{ label: 'Offer Revoked', key: 'offer_revoked' },
				{ label: 'Joined in 2025-26, Offered in 2025-26', key: 'joined_offered_current' },
				{ label: 'Joined in 2025-26, Offered in 2024-25', key: 'joined_offered_prev' },
			]
		},
	];

	const STATUS_TO_KEY = {
		'New Applicant': 'cv_pending',
		'CV Shortlist': 'cv_shortlist',
		'CV Reject': 'cv_regret',
		'Test Process': 'written_select',
		'Test Select': 'written_select',
		'Test Reject': 'written_regret',
		'Recruiter Round': 'recruiter_select',
		'Recruiter Reject': 'recruiter_regret',
		'Round One': 'functional_select',
		'Round 1 Reject': 'functional_regret',
		'Round Two': 'final_select',
		'Round 2 Reject': 'final_regret',
		'Round Three': 'final_select',
		'Round 3 Reject': 'final_regret',
		'Document Collection': 'offer_in_process',
		'Offer': 'offer_made',
		'Offer Accepted': 'offer_accepted',
		'Joined': 'joined',
		'Offer Declined': 'offer_declined',
		'Offer Revoked': 'offer_revoked',
		'Applied': 'cv_pending',
		'Shortlisted': 'cv_shortlist',
		'Rejected': 'cv_regret',
		'Interview Scheduled': 'functional_scheduled',
		'Selected': 'joined',
		'On Hold': 'offer_in_process',
		'Blocklisted': null,
	};

	const DATA_COLS = ['RP', 'ST', 'HL', 'LH'];
	const SUB_COLS = ['RP', 'ST', 'HL', 'LH', 'Total'];

	function getCol(rec) {
		// department is the standardized, reliable field — check it first.
		// Exact-match here ("health" / "livelihood(s)") missed real live
		// values like "Health - Field", "Health Urban", "Livelihoods -
		// Field" and dropped ~15,500 records from this table entirely
		// (not miscounted — absent). Substring match instead, same fix
		// already applied to the role fallback below.
		const dept = (rec.department || '').toLowerCase().trim();
		if (dept.includes('health')) return 'HL';
		if (dept.includes('livelihood')) return 'LH';
		if (dept.includes('teacher')) return 'ST';
		if (dept.includes('resource person')) return 'RP';
		// department blank/unrecognized — fall back to role. Requiring an
		// exact role string ("School Teacher" / one of 3 exact Resource
		// Person variants) meant every other real value — "School Teacher
		// - Barmer", "Cluster..." with different casing, etc. — fell
		// through to `return null` too. Confirmed live: ~38,000 teacher
		// records and ~12,000 resource-person records outside that exact
		// list. Substring match here too.
		const role = (rec.role || '').toLowerCase();
		if (role.includes('teacher')) return 'ST';
		if (role.includes('resource person')) return 'RP';
		return null;
	}

	function getRecState(r) {
		return (r.location || r.worklocation || r.native_state || '').trim();
	}

	let _allRecs = [], _states = [], _data = {};
	let _ssSrcRecs = []; // records the currently-displayed summary cards were built from — read fresh at click time, not captured in a per-render closure (see renderSummary)

	const ALL_HEADERS = [
		'ID','Full Name','Status','Role','Department',
		'Work State','Work Location','Native State','Native District','Source',
		'Email','Phone','Alt Phone','Gender','DOB','Age',
		'Education','Teaching Degree','Teaching Exp (Yr)','Teaching Exp (Mo)',
		'Health Exp (Yr)','Health Exp (Mo)','Languages','Written Subject',
		'Test Location','APF Associated','Former Employee',
		'Shortlist Reason','Reject Reason','Hold Reason','Blocklist Reason','Date'
	];

	function fullRow(r) {
		return [
			r.name, r.full_name_aadhaar, r.application_status, r.role, r.department,
			r.location, r.worklocation, r.native_state, r.native_district, r.opportunity,
			r.email_address, r.phone_number, r.alternate_no, r.gender, r.dob, r.age,
			r.highest_education, r.teaching_degrees, r.teaching_year, r.teachingexp_month,
			r.health_expyear, r.health_expmonth, r.languages_known, r.written_subject,
			r.test_location, r.apf_associated, r.former_employee,
			r.reasons_for_shortlist, r.reasons_for_reject, r.hold_reason, r.blocklist_reason,
			r.creation ? r.creation.split(' ')[0] : ''
		];
	}

	// ── Styles ────────────────────────────────────────────────────────────
	$(wrapper).find('.page-content').append(`
	<style>
		.fod-bar{display:flex;align-items:center;gap:8px;padding:10px 20px 8px;background:#fff;border-bottom:1px solid #e5e7eb;flex-wrap:wrap}
		.fod-bar label{font-size:12px;font-weight:600;color:#374151}
		.fod-bar input[type=date],.fod-bar select{padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;color:#111;background:#fff;min-width:120px}
		.fod-dt{font-size:12px;color:#9ca3af;margin-left:auto}
		.fod-btn{display:inline-flex;align-items:center;gap:5px;padding:6px 14px;border-radius:6px;font-weight:600;font-size:12px;border:none;cursor:pointer;transition:background .15s}
		.btn-green{background:#166534;color:#fff}.btn-green:hover{background:#14532d}
		.btn-blue{background:#1e40af;color:#fff}.btn-blue:hover{background:#1d3a8a}
		.btn-grey{background:#f3f4f6;color:#374151;border:1px solid #d1d5db}.btn-grey:hover{background:#e5e7eb}
		.fod-wrap{overflow:auto;padding:0 20px 10px;max-height:calc(100vh - 160px)}
		.fod-load{padding:60px;text-align:center;color:#9ca3af;font-size:14px}
		.fod-tbl{border-collapse:collapse;font-size:11px;white-space:nowrap}
		.fod-tbl th,.fod-tbl td{border:1px solid #bbb;padding:3px 7px;text-align:center;vertical-align:middle}
		.fod-tbl .c-stage{min-width:110px;font-weight:700;white-space:normal;position:sticky;left:0;z-index:12}
		.fod-tbl .c-status{min-width:250px;text-align:left;white-space:normal;position:sticky;left:111px;z-index:12}
		.fod-tbl .c-num{min-width:36px;font-variant-numeric:tabular-nums;cursor:pointer}
		.fod-tbl .c-num:hover{filter:brightness(0.88)}
		.fod-tbl .c-tot{font-weight:700;background:#BDD7EE!important;color:#1F497D!important}
		.fod-tbl .r-total .c-stage,.fod-tbl .r-total .c-status{background:#BDD7EE!important;font-weight:700;color:#1F497D!important}
		.fod-tbl .r-total .c-num{background:#BDD7EE!important;font-weight:700;color:#1F497D!important}
		.fod-tbl .r-total .c-tot{background:#9ab8d4!important;color:#1F497D!important}
		.fod-tbl thead th{position:sticky;top:0;z-index:20;font-weight:700}
		.fod-tbl thead tr:nth-child(2) th{top:32px;z-index:19}
		.ss-wrap{padding:18px 20px 28px}
		.ss-title{font-size:13px;font-weight:700;color:#1e3a5f;margin-bottom:10px;padding-bottom:5px;border-bottom:2px solid #1e3a5f}
		.ss-grid{display:flex;flex-wrap:wrap;gap:8px}
		.ss-card{background:#fff;border:1px solid #e5e7eb;border-radius:7px;padding:10px 14px;min-width:140px;text-align:center;box-shadow:0 1px 2px rgba(0,0,0,.05);transition:box-shadow .15s,transform .1s}
		.ss-card:hover{box-shadow:0 3px 10px rgba(0,0,0,.15);transform:translateY(-1px)}
		.ss-card .n{font-size:26px;font-weight:700}.ss-card .l{font-size:11px;color:#6b7280;font-weight:500}
	</style>
	<div class="fod-bar">
		<label>From:</label><input type="date" id="f-from"/>
		<label>To:</label><input type="date" id="f-to"/>
		<select id="f-state"><option value="">All States</option></select>
		<select id="f-district"><option value="">All Districts</option></select>
		<select id="f-source"><option value="">All Sources</option></select>
		<button class="fod-btn btn-blue" id="f-apply">Apply</button>
		<button class="fod-btn btn-grey"  id="f-clear">Clear</button>
		<button class="fod-btn btn-grey"  id="f-rf">&#x21bb; Refresh</button>
		<button class="fod-btn btn-green" id="f-xl">&#8659; Download Excel</button>
		<span class="fod-dt" id="f-dt"></span>
	</div>
	<div class="ss-wrap" id="ss-wrap" style="display:none">
		<div class="ss-title">Application Status Summary</div>
		<div class="ss-grid" id="ss-grid"></div>
	</div>
	<div class="fod-wrap" id="f-wrap"><div class="fod-load">Loading…</div></div>`);

	// ── Event handlers ────────────────────────────────────────────────────
	// Bound once here (not inside renderSummary, which re-runs on every
	// filter change) — always reads _ssSrcRecs fresh at click time instead
	// of a value captured by whichever render happened to bind last.
	$(wrapper).find('#ss-grid').on('click', '.ss-card', function () {
		var status = $(this).data('status');
		var matched = status
			? _ssSrcRecs.filter(function (r) { return (r.application_status || 'Unknown') === status; })
			: _ssSrcRecs;
		if (!matched.length) { frappe.msgprint('No records found.'); return; }
		showRecordsDialog(status || 'Overall', matched, ALL_HEADERS, fullRow);
	});
	$(wrapper).find('#f-apply').on('click', loadData);
	$(wrapper).find('#f-rf').on('click', loadData);
	$(wrapper).find('#f-clear').on('click', function () {
		$(wrapper).find('#f-from,#f-to').val('');
		$(wrapper).find('#f-state,#f-district,#f-source').val('');
		loadData();
	});
	$(wrapper).find('#f-state,#f-district,#f-source').on('change', function () {
		var filtered = getFilteredRecs();
		var res = aggregate(filtered);
		_states = res.states; _data = res.data;
		renderTable();
		renderSummary(filtered);
	});
	$(wrapper).find('#f-xl').on('click', function () {
		const from = $(wrapper).find('#f-from').val();
		const to = $(wrapper).find('#f-to').val();
		let url = '/api/method/ms_calendar.api.ms_field.download_field_overall_excel';
		const p = [];
		if (from) p.push('from_date=' + encodeURIComponent(from));
		if (to) p.push('to_date=' + encodeURIComponent(to));
		if (p.length) url += '?' + p.join('&');
		window.location.href = url;
	});

	function buildFilters() {
		const f = [['docstatus', '!=', '2']];
		const from = $(wrapper).find('#f-from').val();
		const to = $(wrapper).find('#f-to').val();
		if (from) f.push(['creation', '>=', from + ' 00:00:00']);
		if (to) f.push(['creation', '<=', to + ' 23:59:59']);
		return f;
	}

	function getFilteredRecs() {
		var selState = $(wrapper).find('#f-state').val();
		var selDist  = $(wrapper).find('#f-district').val();
		var selSrc   = $(wrapper).find('#f-source').val();
		return _allRecs.filter(function (r) {
			if (selState && getRecState(r) !== selState) return false;
			if (selDist && (r.native_district || '').trim() !== selDist) return false;
			if (selSrc && (r.opportunity || '').trim() !== selSrc) return false;
			return true;
		});
	}

	// ── Load ──────────────────────────────────────────────────────────────
	function loadData() {
		$(wrapper).find('#f-wrap').html('<div class="fod-load">Loading dashboard…</div>');
		$(wrapper).find('#ss-wrap').hide();
		$(wrapper).find('#f-dt').text('Date of Report: ' + frappe.datetime.now_date());
		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Field Registration Form',
				fields: ['name', 'full_name_aadhaar', 'application_status', 'role', 'department',
					'location', 'worklocation', 'native_state', 'native_district', 'opportunity',
					'email_address', 'phone_number', 'alternate_no', 'gender', 'dob', 'age',
					'highest_education', 'teaching_degrees', 'teaching_year', 'teachingexp_month',
					'health_expyear', 'health_expmonth', 'languages_known', 'written_subject',
					'test_location', 'apf_associated', 'former_employee',
					'reasons_for_shortlist', 'reasons_for_reject', 'hold_reason', 'blocklist_reason',
					'creation'],
				filters: buildFilters(),
				limit_page_length: 0,
				order_by: 'creation asc'
			},
			callback: function (r) {
				_allRecs = r.message || [];
				// Populate dropdowns
				var stSet = {}, diSet = {}, srcSet = {};
				_allRecs.forEach(function (rec) {
					var st = getRecState(rec);
					if (st) stSet[st] = true;
					if (rec.native_district) diSet[rec.native_district.trim()] = true;
					if (rec.opportunity) srcSet[rec.opportunity.trim()] = true;
				});
				var $st = $(wrapper).find('#f-state').empty().append('<option value="">All States</option>');
				Object.keys(stSet).sort().forEach(function (v) { $st.append('<option value="' + v + '">' + v + '</option>'); });
				var $di = $(wrapper).find('#f-district').empty().append('<option value="">All Districts</option>');
				Object.keys(diSet).sort().forEach(function (v) { $di.append('<option value="' + v + '">' + v + '</option>'); });
				var $so = $(wrapper).find('#f-source').empty().append('<option value="">All Sources</option>');
				Object.keys(srcSet).sort().forEach(function (v) { $so.append('<option value="' + v + '">' + v + '</option>'); });

				var res = aggregate(_allRecs);
				_states = res.states; _data = res.data;
				renderTable();
				renderSummary(_allRecs);
			},
			error: function () {
				$(wrapper).find('#f-wrap').html('<div class="fod-load">Failed to load. Please refresh.</div>');
			}
		});
	}

	// ── Aggregate ─────────────────────────────────────────────────────────
	function aggregate(records) {
		const april1 = new Date(new Date().getFullYear(), 3, 1);
		const stSet = new Set();
		const data = {}, summ = {};

		function inc(e, c, k) {
			if (!data[e]) data[e] = {};
			if (!data[e][c]) data[e][c] = {};
			data[e][c][k] = (data[e][c][k] || 0) + 1;
		}

		records.forEach(function (r) {
			const state = getRecState(r) || 'Unknown';
			const col = getCol(r);
			if (!col) return;
			stSet.add(state);

			const cr = new Date(r.creation);
			const sk = STATUS_TO_KEY[r.application_status] || null;
			summ[r.application_status || 'Unknown'] = (summ[r.application_status || 'Unknown'] || 0) + 1;

			[state, 'Grand Total'].forEach(function (e) {
				inc(e, col, 'total');
				cr < april1 ? inc(e, col, 'carried_forward') : inc(e, col, 'received_this_year');
				if (sk) inc(e, col, sk);
			});
		});

		return { states: Array.from(stSet).sort(), data, statusSummary: summ };
	}

	function cnt(s, c, k) { return ((_data[s] || {})[c] || {})[k] || 0; }
	function stTot(s, k) { return DATA_COLS.reduce(function (a, c) { return a + cnt(s, c, k); }, 0); }

	// ── Render count table with clickable cells ───────────────────────────
	function renderTable() {
		const groups = _states.concat(['Grand Total']);
		const HDR = '#1F497D', COL_A = '#DDEBF7', COL_B = '#BDD7EE', GRAND = '#1F497D';

		let h = '<table class="fod-tbl"><thead><tr>';
		h += `<th class="c-stage" rowspan="2" style="background:${HDR};color:#fff;top:0;z-index:25">Stages</th>`;
		h += `<th class="c-status" rowspan="2" style="background:${HDR};color:#fff;top:0;z-index:25">Status</th>`;
		groups.forEach(function (g, gi) {
			const isG = gi === groups.length - 1;
			const bg = isG ? GRAND : (gi % 2 === 0 ? COL_A : COL_B);
			const fg = isG ? '#fff' : '#1e293b';
			h += `<th colspan="${SUB_COLS.length}" style="background:${bg};color:${fg}">${g}</th>`;
		});
		h += '</tr><tr>';
		groups.forEach(function (_, gi) {
			const isG = gi === groups.length - 1;
			const bg = isG ? GRAND : (gi % 2 === 0 ? COL_A : COL_B);
			const fg = isG ? '#fff' : '#374151';
			SUB_COLS.forEach(function (sc) {
				h += `<th class="c-num" style="background:${bg};color:${fg};${sc === 'Total' ? 'font-weight:700' : ''};">${sc}</th>`;
			});
		});
		h += '</tr></thead><tbody>';

		STAGES.forEach(function (st) {
			st.rows.forEach(function (row, ri) {
				const isTot = row.isTotal;
				const rbg = isTot ? '#BDD7EE' : '#ffffff';
				const rfg = '#1F497D';
				h += `<tr${isTot ? ' class="r-total"' : ''}>`;
				if (ri === 0) {
					h += `<td class="c-stage" rowspan="${st.rows.length}" style="background:#ffffff;color:#1F497D">${st.stage}</td>`;
				}
				h += `<td class="c-status" style="background:${rbg};color:${rfg}">${row.label}</td>`;

				groups.forEach(function (g, gi) {
					const isG = gi === groups.length - 1;
					const nbg = isG ? '#1F497D' : rbg;
					const nfg = isG ? '#fff' : rfg;

					DATA_COLS.forEach(function (col) {
						const v = cnt(g, col, row.key);
						const attr = 'data-state="' + g + '" data-col="' + col + '" data-rowkey="' + row.key + '"';
						h += `<td class="c-num fod-cell" ${attr} style="background:${nbg};color:${nfg}">${v || ''}</td>`;
					});
					const t = stTot(g, row.key);
					const tbg = isG ? '#1F497D' : '#BDD7EE';
					h += `<td class="c-num c-tot fod-cell" data-state="${g}" data-col="Total" data-rowkey="${row.key}" style="background:${tbg};color:${isG ? '#fff' : '#000'}">${t || ''}</td>`;
				});
				h += '</tr>';
			});
		});

		h += '</tbody></table>';
		$(wrapper).find('#f-wrap').html(h);

		// Click handler on number cells
		$(wrapper).find('#f-wrap').off('click.fodCell').on('click.fodCell', '.fod-cell', function () {
			var state  = $(this).data('state');
			var col    = $(this).data('col');
			var rowkey = $(this).data('rowkey');
			if (!$(this).text().trim()) return;

			var base = getFilteredRecs();
			var april1 = new Date(new Date().getFullYear(), 3, 1);

			var matched = base.filter(function (r) {
				// state filter
				if (state !== 'Grand Total') {
					if (getRecState(r) !== state) return false;
				}
				// col filter
				if (col !== 'Total') {
					if (getCol(r) !== col) return false;
				}
				// rowkey filter
				if (rowkey === 'total') return true;
				if (rowkey === 'carried_forward') return new Date(r.creation) < april1;
				if (rowkey === 'received_this_year') return new Date(r.creation) >= april1;
				return STATUS_TO_KEY[r.application_status] === rowkey;
			});

			if (!matched.length) { frappe.msgprint('No records found.'); return; }

			var title = (state === 'Grand Total' ? 'All States' : state)
				+ ' | ' + col + ' | ' + rowkey.replace(/_/g, ' ');

			showRecordsDialog(title, matched, ALL_HEADERS, fullRow);
		});
	}

	// ── Application Status summary cards ──────────────────────────────────
	function renderSummary(recs) {
		var srcRecs = recs || _allRecs;
		_ssSrcRecs = srcRecs;
		var summ = {};
		srcRecs.forEach(function (r) {
			var k = r.application_status || 'Unknown';
			summ[k] = (summ[k] || 0) + 1;
		});
		const entries = Object.entries(summ).sort(function (a, b) { return b[1] - a[1]; });
		if (!entries.length) return;
		const overallTotal = entries.reduce(function (sum, e) { return sum + e[1]; }, 0);
		const palette = ['#1F497D', '#2c7db8'];
		// Overall card first — every status card below is a slice of this
		// same total (current filters applied), so it's the one number that
		// lets you sanity-check the rest at a glance. data-status="" (empty)
		// means "no status filter" for the click handler below, same
		// convention the Overall card's total already uses.
		let html = `<div class="ss-card" data-status="" style="background:#1e3a5f;border-color:#1e3a5f;cursor:pointer;">
			<div class="n" style="color:#fff">${overallTotal}</div>
			<div class="l" style="color:#c7d7ea;font-weight:700;">Overall</div></div>`;
		entries.forEach(function (e, i) {
			html += `<div class="ss-card" data-status="${e[0].replace(/"/g, '&quot;')}" style="cursor:pointer;">
				<div class="n" style="color:${palette[i%palette.length]}">${e[1]}</div><div class="l">${e[0]}</div></div>`;
		});
		$(wrapper).find('#ss-grid').html(html);
		$(wrapper).find('#ss-wrap').show();
		// Click handling for these cards is bound once, outside this
		// function (see the "Event handlers" section near the top) — it
		// reads _ssSrcRecs (set just above) fresh at click time.
	}

	// ── Records dialog: CSV + Print/PDF + open in Frappe ─────────────────
	function showRecordsDialog(title, records, headers, rowFn) {
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

		var thCells = headers.map(function (h) {
			return '<th style="padding:6px 8px;white-space:nowrap;">' + h + '</th>';
		}).join('');

		var rows = records.map(function (r) {
			var vals = rowFn(r);
			var formUrl = frappe.utils.get_url_to_form
				? frappe.utils.get_url_to_form('Field Registration Form', r.name)
				: '/app/field-registration-form/' + encodeURIComponent(r.name);
			return '<tr>' + vals.map(function (v, i) {
				return i === 0
					? '<td style="padding:4px 8px;white-space:nowrap;"><a href="' + formUrl + '" target="_blank" style="color:#1F497D;font-weight:600;">' + (v || '') + '</a></td>'
					: '<td style="padding:4px 8px;">' + (v || '') + '</td>';
			}).join('') + '</tr>';
		}).join('');

		var html = '<div style="margin-bottom:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
			+ '<button id="rec-csv-btn" style="padding:5px 14px;background:#166534;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;">⬇ Download CSV/Excel</button>'
			+ '<button id="rec-print-btn" style="padding:5px 14px;background:#1e40af;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;">🖨 Print / PDF</button>'
			+ '<span style="font-size:11px;color:#6b7280;">Click the ID to open record in Frappe</span>'
			+ '</div>'
			+ '<div style="overflow:auto;max-height:420px;">'
			+ '<table id="rec-dlg-tbl" style="width:100%;border-collapse:collapse;font-size:12px;">'
			+ '<thead><tr style="background:#1F497D;color:#fff;">' + thCells + '</tr></thead>'
			+ '<tbody>' + rows + '</tbody></table></div>';

		frappe.msgprint({ title: title + ' (' + records.length + ')', wide: true, message: html });

		setTimeout(function () {
			$('#rec-csv-btn').off('click').on('click', csvDownload);
			$('#rec-print-btn').off('click').on('click', function () {
				var tbl = document.getElementById('rec-dlg-tbl');
				var w = window.open('', '_blank');
				w.document.open();
				w.document.write('<html><head><title>' + title + '</title>'
					+ '<style>body{font-family:sans-serif}table{border-collapse:collapse;font-size:12px;width:100%}'
					+ 'th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}'
					+ 'th{background:#1F497D;color:#fff}a{color:#1F497D}</style></head><body>'
					+ '<h3>' + title + ' (' + records.length + ')</h3>'
					+ (tbl ? tbl.outerHTML : '') + '</body></html>');
				w.document.close(); w.focus(); w.print();
			});
		}, 100);
	}

	loadData();
};
