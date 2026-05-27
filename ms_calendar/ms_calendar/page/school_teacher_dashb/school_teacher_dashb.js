frappe.pages['school-teacher-dashb'].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: 'School Teacher Dashboard',
		single_column: true
	});

	// ── Stage/row definitions ─────────────────────────────────────────────
	const STAGES = [
		{
			stage: 'Candidate Applications',
			color: '#ffffff', textColor: '#1F497D',
			rows: [
				{ label: 'Total Received', key: 'total_received', isTotal: true },
				{ label: 'Shortlisted', key: 'cv_shortlist' },
				{ label: 'Regret', key: 'cv_regret' },
				{ label: 'Pending', key: 'cv_pending' },
			]
		},
		{
			stage: 'Written Assessment',
			color: '#ffffff', textColor: '#1F497D',
			rows: [
				{ label: 'Select', key: 'written_select' },
				{ label: 'Regret', key: 'written_regret' },
				{ label: 'Scheduled', key: 'written_scheduled' },
				{ label: 'Absent', key: 'written_absent' },
				{ label: 'Pending', key: 'written_pending' },
			]
		},
		{
			stage: 'Recruiter Round',
			color: '#ffffff', textColor: '#1F497D',
			rows: [
				{ label: 'Select', key: 'recruiter_select' },
				{ label: 'Regret', key: 'recruiter_regret' },
				{ label: 'Scheduled', key: 'recruiter_scheduled' },
				{ label: 'Pending', key: 'recruiter_pending' },
			]
		},
		{
			stage: 'Functional Round',
			color: '#ffffff', textColor: '#1F497D',
			rows: [
				{ label: 'Select', key: 'functional_select' },
				{ label: 'Regret', key: 'functional_regret' },
				{ label: 'Scheduled', key: 'functional_scheduled' },
				{ label: 'Pending', key: 'functional_pending' },
			]
		},
		{
			stage: 'Final Round',
			color: '#ffffff', textColor: '#1F497D',
			rows: [
				{ label: 'Select', key: 'final_select' },
				{ label: 'Regret', key: 'final_regret' },
				{ label: 'Scheduled', key: 'final_scheduled' },
				{ label: 'Pending', key: 'final_pending' },
			]
		},
		{
			stage: 'Offer',
			color: '#ffffff', textColor: '#1F497D',
			rows: [
				{ label: 'Offer Made', key: 'offer_made' },
				{ label: 'Offer Accepted', key: 'offer_accepted' },
				{ label: 'Offer Declined', key: 'offer_declined' },
				{ label: 'Offer Revoked', key: 'offer_revoked' },
				{ label: 'Joined', key: 'joined' },
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
		'Test Scheduled': 'written_scheduled',
		'Test Absent': 'written_absent',
		'Recruiter Round': 'recruiter_select',
		'Recruiter Reject': 'recruiter_regret',
		'Recruiter Scheduled': 'recruiter_scheduled',
		'Round One': 'functional_select',
		'Round 1 Reject': 'functional_regret',
		'Round One Scheduled': 'functional_scheduled',
		'Round Two': 'final_select',
		'Round 2 Reject': 'final_regret',
		'Round Two Scheduled': 'final_scheduled',
		'Round Three': 'final_select',
		'Round 3 Reject': 'final_regret',
		'Document Collection': 'offer_made',
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
		'On Hold': 'cv_pending',
	};

	// All stage keys (for zero-init)
	const ALL_KEYS = [
		'total_received', 'cv_shortlist', 'cv_regret', 'cv_pending',
		'written_select', 'written_regret', 'written_scheduled', 'written_absent', 'written_pending',
		'recruiter_select', 'recruiter_regret', 'recruiter_scheduled', 'recruiter_pending',
		'functional_select', 'functional_regret', 'functional_scheduled', 'functional_pending',
		'final_select', 'final_regret', 'final_scheduled', 'final_pending',
		'offer_made', 'offer_accepted', 'offer_declined', 'offer_revoked', 'joined',
	];

	// Default subject list (shown even if no data)
	const DEFAULT_SUBJECTS = [
		'Early Childhood Education',
		'Primary All subjects',
		'Primary EVS',
		'Primary English',
		'Primary Hindi',
		'Primary Kannada',
		'Primary Mathematics',
		'Upper Primary English',
		'Upper Primary Sanskrit',
		'Upper Primary Bengali',
		'Upper Primary Science',
		'Upper Primary Social Science',
		'Upper Primary Maths',
		'Upper Primary Hindi',
		'Upper Primary Kannada',
		'Secondary Geography',
		'Secondary English',
		'Secondary Hindi',
	];

	// ── Inject styles ────────────────────────────────────────────────────
	$(wrapper).find('.page-content').append(`
		<style>
			.std-toolbar {
				display: flex;
				align-items: center;
				gap: 10px;
				padding: 12px 20px 8px;
				flex-wrap: wrap;
			}
			.std-toolbar label { font-size: 12px; color: #374151; font-weight: 600; }
			.std-toolbar input[type=date] {
				border: 1px solid #d1d5db;
				border-radius: 4px;
				padding: 4px 8px;
				font-size: 12px;
				color: #111;
			}
			.std-report-date {
				font-size: 12px;
				color: #6b7280;
				margin-left: auto;
			}
			.std-table-wrap {
				overflow-x: auto;
				overflow-y: auto;
				padding: 0 20px 30px;
				max-height: calc(100vh - 160px);
			}
			.std-table {
				border-collapse: collapse;
				font-size: 11px;
				white-space: nowrap;
				width: max-content;
				min-width: 100%;
			}
			.std-table th, .std-table td {
				border: 1px solid #bbb;
				padding: 4px 6px;
				text-align: center;
				vertical-align: middle;
			}
			.std-table thead tr:first-child th {
				background: #1F497D;
				color: #fff;
				font-weight: 700;
				font-size: 12px;
				position: sticky;
				top: 0;
				z-index: 20;
			}
			.std-table thead tr:nth-child(2) th {
				position: sticky;
				top: 33px;
				z-index: 19;
				font-weight: 600;
				font-size: 10px;
				background: #DDEBF7;
			}
			.std-table .col-stage {
				min-width: 110px;
				max-width: 130px;
				font-weight: 700;
				position: sticky;
				left: 0;
				z-index: 10;
				white-space: normal;
				font-size: 11px;
			}
			.std-table .col-status {
				min-width: 200px;
				max-width: 220px;
				text-align: left;
				white-space: normal;
				position: sticky;
				left: 120px;
				z-index: 10;
			}
			.std-table .col-num {
				min-width: 52px;
				font-variant-numeric: tabular-nums;
				cursor: pointer;
			}
			.std-table .col-num:hover { filter: brightness(0.9); }
			.std-table .col-total-num {
				min-width: 60px;
				font-variant-numeric: tabular-nums;
				font-weight: 700;
				background: #D9D9D9 !important;
			}
			.std-table .row-total td { background: #D9D9D9 !important; font-weight: 700; }
			.std-loading {
				padding: 60px;
				text-align: center;
				color: #6b7280;
				font-size: 14px;
			}
			.std-btn-download {
				display: inline-flex; align-items: center; gap: 6px;
				padding: 6px 16px; border-radius: 5px;
				background: #1a7f4f; color: #fff;
				font-weight: 600; font-size: 13px; border: none;
				cursor: pointer; transition: background 0.2s;
			}
			.std-btn-download:hover { background: #145e3a; }
			.std-btn-refresh {
				display: inline-flex; align-items: center; gap: 6px;
				padding: 6px 14px; border-radius: 5px;
				background: #e5e7eb; color: #374151;
				font-weight: 600; font-size: 13px;
				border: 1px solid #d1d5db; cursor: pointer;
				transition: background 0.2s;
			}
			.std-btn-refresh:hover { background: #d1d5db; }
		</style>
		<div class="std-toolbar">
			<label>From:</label>
			<input type="date" id="st-from" />
			<label>To:</label>
			<input type="date" id="st-to" />
			<button class="std-btn-refresh" id="st-refresh">&#x21bb; Refresh</button>
			<button class="std-btn-download" id="st-download">
				<svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor">
					<path d="M10 13l-4-4h3V4h2v5h3l-4 4zm-7 3h14v2H3v-2z"/>
				</svg>
				Download Excel
			</button>
			<span class="std-report-date" id="st-date"></span>
		</div>
		<div class="std-table-wrap" id="st-table-wrap">
			<div class="std-loading">Loading dashboard…</div>
		</div>
	`);

	// Default date range: current financial year (Apr 1 – Mar 31)
	(function () {
		var today = new Date();
		var yr = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
		$('#st-from').val(yr + '-04-01');
		$('#st-to').val(today.toISOString().slice(0, 10));
	})();

	// ── Button handlers ───────────────────────────────────────────────────
	$(wrapper).find('#st-download').on('click', function () {
		var from = $('#st-from').val() || '';
		var to = $('#st-to').val() || '';
		var url = '/api/method/ms_calendar.api.ms_field.download_school_teacher_excel'
			+ '?from_date=' + encodeURIComponent(from)
			+ '&to_date=' + encodeURIComponent(to);
		window.location.href = url;
	});

	$(wrapper).find('#st-refresh').on('click', function () {
		loadDashboard();
	});

	// ── Load data ─────────────────────────────────────────────────────────
	var _lastRecords = [];

	function loadDashboard() {
		$('#st-table-wrap').html('<div class="std-loading">Loading…</div>');
		var from = $('#st-from').val() || '';
		var to = $('#st-to').val() || '';

		var filters = [['role', 'like', '%School Teacher%']];
		if (from) filters.push(['creation', '>=', from + ' 00:00:00']);
		if (to) filters.push(['creation', '<=', to + ' 23:59:59']);

		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Field Registration Form',
				filters: filters,
				fields: ['name', 'role', 'written_subject', 'application_status', 'creation',
					'full_name_aadhaar', 'email_address', 'phone_number'],
				limit_page_length: 10000,
				order_by: 'creation asc'
			},
			callback: function (r) {
				if (r && r.message) {
					_lastRecords = r.message;
					renderTable(r.message);
					$('#st-date').text('Report Date: ' + frappe.datetime.now_date()
						+ ' | Records: ' + r.message.length);
				} else {
					$('#st-table-wrap').html('<div class="std-loading">No data found.</div>');
				}
			},
			error: function () {
				$('#st-table-wrap').html('<div class="std-loading">Failed to load data. Please refresh.</div>');
			}
		});
	}

	// ── Aggregate data ────────────────────────────────────────────────────
	function aggregateData(records) {
		var subjectSet = {};
		records.forEach(function (r) {
			var subj = (r.written_subject || '').trim();
			if (subj) subjectSet[subj] = true;
		});

		// Merge default subjects + data subjects (preserve order)
		var subjects = [];
		DEFAULT_SUBJECTS.forEach(function (s) {
			if (!subjects.includes(s)) subjects.push(s);
		});
		Object.keys(subjectSet).sort().forEach(function (s) {
			if (!subjects.includes(s)) subjects.push(s);
		});

		// Init counts: data['Total'][key] and data[subject][key]
		var data = { 'Total': {} };
		ALL_KEYS.forEach(function (k) { data['Total'][k] = 0; });
		subjects.forEach(function (s) {
			data[s] = {};
			ALL_KEYS.forEach(function (k) { data[s][k] = 0; });
		});

		// Accumulate
		records.forEach(function (r) {
			var status = (r.application_status || '').trim();
			var subj = (r.written_subject || '').trim();
			var stKey = STATUS_TO_KEY[status];
			if (!stKey) return;

			data['Total']['total_received']++;
			data['Total'][stKey]++;
			if (subj && data[subj]) {
				data[subj]['total_received']++;
				data[subj][stKey]++;
			}
		});

		return { subjects: subjects, data: data };
	}

	// ── Render table ──────────────────────────────────────────────────────
	function renderTable(records) {
		var agg = aggregateData(records);
		var subjects = agg.subjects;
		var data = agg.data;

		// ── Subject abbreviation for header ──
		function abbr(s) {
			if (s === 'Early Childhood Education') return 'ECE';
			if (s.startsWith('Primary ')) return 'P ' + s.slice(8);
			if (s.startsWith('Upper Primary ')) return 'UP ' + s.slice(14);
			if (s.startsWith('Secondary ')) return 'Sec ' + s.slice(10);
			return s.length > 12 ? s.slice(0, 12) + '…' : s;
		}

		// ── Header row 1: main column headers ──
		var thead = '<thead><tr>';
		thead += '<th class="col-stage" rowspan="2" style="z-index:25;">Stage</th>';
		thead += '<th class="col-status" rowspan="2" style="z-index:25;">Result</th>';
		thead += '<th style="min-width:60px;font-weight:700;">Total<br>Number</th>';
		subjects.forEach(function (s, si) {
			var bg = si % 2 === 0 ? '#DDEBF7' : '#BDD7EE';
			thead += '<th style="background:' + bg + ';min-width:52px;" title="' + s + '">' + abbr(s) + '</th>';
		});
		thead += '</tr>';

		// ── Header row 2: subject full names ──
		thead += '<tr>';
		thead += '<th style="font-size:10px;background:#DDEBF7;font-weight:600;">All Subjects</th>';
		subjects.forEach(function (s, si) {
			var bg = si % 2 === 0 ? '#DDEBF7' : '#BDD7EE';
			thead += '<th style="background:' + bg + ';font-size:9px;white-space:normal;max-width:60px;" title="' + s + '">' + s + '</th>';
		});
		thead += '</tr></thead>';

		// ── Body ──
		var tbody = '<tbody>';
		STAGES.forEach(function (stageCfg) {
			var rowCount = stageCfg.rows.length;
			stageCfg.rows.forEach(function (rowCfg, ri) {
				var isTotal = rowCfg.isTotal;
				var rowBg = isTotal ? '#BDD7EE' : '#ffffff';
				var rowFg = '#1F497D';
				tbody += '<tr' + (isTotal ? ' class="row-total"' : '') + '>';

				if (ri === 0) {
					tbody += '<td class="col-stage" rowspan="' + rowCount + '" style="background:#ffffff;color:#1F497D;">' + stageCfg.stage + '</td>';
				}

				tbody += '<td class="col-status" style="background:' + rowBg + ';color:' + rowFg + ';">' + rowCfg.label + '</td>';

				// Total column
				var totalVal = data['Total'][rowCfg.key] || 0;
				tbody += '<td class="col-total-num" style="background:#BDD7EE;color:#1F497D;" '
					+ 'data-key="' + rowCfg.key + '" data-subj="" '
					+ 'data-label="' + rowCfg.label + '">'
					+ (totalVal || '') + '</td>';

				// Per-subject columns
				subjects.forEach(function (s) {
					var val = data[s][rowCfg.key] || 0;
					var bg = '#ffffff';
					if (isTotal) bg = '#BDD7EE';
					tbody += '<td class="col-num" style="background:' + bg + ';color:#000;" '
						+ 'data-key="' + rowCfg.key + '" '
						+ 'data-subj="' + s.replace(/"/g, '&quot;') + '" '
						+ 'data-label="' + rowCfg.label + '">'
						+ (val || '') + '</td>';
				});

				tbody += '</tr>';
			});
		});
		tbody += '</tbody>';

		var table = '<table class="std-table">' + thead + tbody + '</table>';
		$('#st-table-wrap').html(table);

		// ── Cell click → show records dialog ──
		$('#st-table-wrap').on('click', 'td.col-num, td.col-total-num', function () {
			var key = $(this).data('key');
			var subj = $(this).data('subj');
			var label = $(this).data('label');
			if (!key) return;

			var matched = _lastRecords.filter(function (r) {
				var status = (r.application_status || '').trim();
				var recKey = STATUS_TO_KEY[status];
				if (recKey !== key) return false;
				if (subj && (r.written_subject || '').trim() !== subj) return false;
				return true;
			});

			if (matched.length === 0) {
				frappe.msgprint('No records found for this cell.');
				return;
			}

			var rows = matched.map(function (r) {
				return '<tr>'
					+ '<td style="padding:4px 8px;">' + (r.name || '') + '</td>'
					+ '<td style="padding:4px 8px;">' + (r.full_name_aadhaar || '') + '</td>'
					+ '<td style="padding:4px 8px;">' + (r.written_subject || '—') + '</td>'
					+ '<td style="padding:4px 8px;">' + (r.application_status || '') + '</td>'
					+ '<td style="padding:4px 8px;">' + (r.phone_number || '') + '</td>'
					+ '</tr>';
			}).join('');

			var title = label + (subj ? ' — ' + subj : ' — All Subjects') + ' (' + matched.length + ' records)';
			var html = '<div style="overflow:auto;max-height:400px;">'
				+ '<table style="width:100%;border-collapse:collapse;font-size:12px;">'
				+ '<thead><tr style="background:#1F497D;color:#fff;">'
				+ '<th style="padding:6px 8px;">ID</th>'
				+ '<th style="padding:6px 8px;">Name</th>'
				+ '<th style="padding:6px 8px;">Subject</th>'
				+ '<th style="padding:6px 8px;">Status</th>'
				+ '<th style="padding:6px 8px;">Phone</th>'
				+ '</tr></thead>'
				+ '<tbody>' + rows + '</tbody>'
				+ '</table></div>';

			frappe.msgprint({ title: title, message: html, wide: true });
		});
	}

	// ── Initial load ──────────────────────────────────────────────────────
	loadDashboard();
};
