frappe.pages['field-overall-dashboard'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Field Overall Dashboard',
		single_column: true
	});

	// ── Stage definitions (mirrors Python _FOD_STAGES) ──────────────────
	const STAGES = [
		{
			stage: 'Applications', color: '#DDEBF7', textColor: '#1F497D',
			rows: [
				{ label: 'Carried forward Application from last year Before April', key: 'carried_forward' },
				{ label: 'Received from April this Year', key: 'received_this_year' },
				{ label: 'Total Applications', key: 'total', isTotal: true },
			]
		},
		{
			stage: 'CV screening', color: '#BDD7EE', textColor: '#1F497D',
			rows: [
				{ label: 'Shortlist', key: 'cv_shortlist' },
				{ label: 'Regret', key: 'cv_regret' },
				{ label: 'Pending', key: 'cv_pending' },
			]
		},
		{
			stage: 'Written test', color: '#DDEBF7', textColor: '#1F497D',
			rows: [
				{ label: 'Select', key: 'written_select' },
				{ label: 'Regret', key: 'written_regret' },
			]
		},
		{
			stage: 'Recruiter screening', color: '#BDD7EE', textColor: '#1F497D',
			rows: [
				{ label: 'Select', key: 'recruiter_select' },
				{ label: 'Regret', key: 'recruiter_regret' },
				{ label: 'Pending', key: 'recruiter_pending' },
			]
		},
		{
			stage: 'Functional round', color: '#DDEBF7', textColor: '#1F497D',
			rows: [
				{ label: 'Select', key: 'functional_select' },
				{ label: 'Regret', key: 'functional_regret' },
				{ label: 'Scheduled', key: 'functional_scheduled' },
				{ label: 'Feedback Pending', key: 'functional_feedback_pending' },
				{ label: 'Pending', key: 'functional_pending' },
			]
		},
		{
			stage: 'Final round', color: '#BDD7EE', textColor: '#1F497D',
			rows: [
				{ label: 'Select', key: 'final_select' },
				{ label: 'Regret', key: 'final_regret' },
				{ label: 'Scheduled', key: 'final_scheduled' },
				{ label: 'Feedback Pending', key: 'final_feedback_pending' },
				{ label: 'Pending', key: 'final_pending' },
			]
		},
		{
			stage: 'Offers', color: '#DDEBF7', textColor: '#1F497D',
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

	const SUB_COLS = ['RP', 'ST', 'HL', 'LH', 'Total'];
	const DATA_COLS = ['RP', 'ST', 'HL', 'LH'];

	const STATE_HEADER_COLORS = ['#DDEBF7', '#BDD7EE'];

	// ── Inject styles ────────────────────────────────────────────────────
	$(wrapper).find('.page-content').append(`
		<style>
			.fod-toolbar {
				display: flex;
				align-items: center;
				gap: 10px;
				padding: 12px 20px 8px;
				flex-wrap: wrap;
			}
			.fod-report-date {
				font-size: 12px;
				color: #6b7280;
				margin-left: auto;
			}
			.fod-table-wrap {
				overflow-x: auto;
				overflow-y: auto;
				padding: 0 20px 30px;
				max-height: calc(100vh - 160px);
			}
			.fod-table {
				border-collapse: collapse;
				font-size: 11px;
				white-space: nowrap;
				width: max-content;
				min-width: 100%;
			}
			.fod-table th, .fod-table td {
				border: 1px solid #bbb;
				padding: 4px 6px;
				text-align: center;
				vertical-align: middle;
			}
			.fod-table thead tr:first-child th {
				background: #1F497D;
				color: #fff;
				font-weight: 700;
				font-size: 12px;
				position: sticky;
				top: 0;
				z-index: 20;
			}
			.fod-table thead tr:nth-child(2) th {
				position: sticky;
				top: 33px;
				z-index: 19;
				font-weight: 700;
				font-size: 11px;
			}
			.fod-table thead tr:nth-child(3) th {
				position: sticky;
				top: 66px;
				z-index: 18;
				font-weight: 600;
				font-size: 10px;
			}
			.fod-table .col-stage {
				min-width: 110px;
				max-width: 130px;
				font-weight: 700;
				position: sticky;
				left: 0;
				z-index: 10;
				white-space: normal;
				font-size: 11px;
			}
			.fod-table .col-status {
				min-width: 260px;
				max-width: 280px;
				text-align: left;
				white-space: normal;
				position: sticky;
				left: 120px;
				z-index: 10;
			}
			.fod-table .col-num {
				min-width: 42px;
				font-variant-numeric: tabular-nums;
			}
			.fod-table .col-subtotal {
				font-weight: 700;
				background: #D9D9D9 !important;
			}
			.fod-table .row-total td {
				background: #D9D9D9 !important;
				font-weight: 700;
			}
			.fod-table .grand-total-group th,
			.fod-table .grand-total-group td {
				background: #1F497D !important;
				color: #fff !important;
				font-weight: 700;
			}
			.fod-table .col-num:empty { color: #ccc; }
			.fod-btn-download {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				padding: 6px 16px;
				border-radius: 5px;
				background: #1a7f4f;
				color: #fff;
				font-weight: 600;
				font-size: 13px;
				border: none;
				cursor: pointer;
				transition: background 0.2s;
			}
			.fod-btn-download:hover { background: #145e3a; }
			.fod-btn-refresh {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				padding: 6px 14px;
				border-radius: 5px;
				background: #e5e7eb;
				color: #374151;
				font-weight: 600;
				font-size: 13px;
				border: 1px solid #d1d5db;
				cursor: pointer;
				transition: background 0.2s;
			}
			.fod-btn-refresh:hover { background: #d1d5db; }
			.fod-loading {
				padding: 60px;
				text-align: center;
				color: #6b7280;
				font-size: 14px;
			}
		</style>
		<div class="fod-toolbar">
			<button class="fod-btn-download" id="fod-download">
				<svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor">
					<path d="M10 13l-4-4h3V4h2v5h3l-4 4zm-7 3h14v2H3v-2z"/>
				</svg>
				Download Excel
			</button>
			<button class="fod-btn-refresh" id="fod-refresh">
				&#x21bb; Refresh
			</button>
			<span class="fod-report-date" id="fod-date"></span>
		</div>
		<div class="fod-table-wrap" id="fod-table-wrap">
			<div class="fod-loading">Loading dashboard…</div>
		</div>
	`);

	// ── Button handlers ───────────────────────────────────────────────────
	$(wrapper).find('#fod-download').on('click', function () {
		const url = '/api/method/ms_calendar.api.ms_field.download_field_dashboard_excel';
		const a = document.createElement('a');
		a.href = url;
		a.download = 'Field_Overall_Dashboard.xlsx';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	});

	$(wrapper).find('#fod-refresh').on('click', function () {
		loadDashboard();
	});

	// ── Load data ─────────────────────────────────────────────────────────
	function loadDashboard() {
		$('#fod-table-wrap').html('<div class="fod-loading">Loading dashboard…</div>');
		frappe.call({
			method: 'ms_calendar.api.ms_field.get_field_overall_dashboard',
			callback: function (r) {
				if (r && r.message) {
					renderTable(r.message);
					$('#fod-date').text('Date of Report: ' + frappe.datetime.now_date());
				} else {
					$('#fod-table-wrap').html('<div class="fod-loading">No data found.</div>');
				}
			},
			error: function () {
				$('#fod-table-wrap').html('<div class="fod-loading">Failed to load data. Please try refreshing.</div>');
			}
		});
	}

	// ── Render table ──────────────────────────────────────────────────────
	function renderTable(apiData) {
		const { states, data } = apiData;
		const allGroups = [...states, 'Grand Total'];

		function getCount(state, col, key) {
			return ((data[state] || {})[col] || {})[key] || 0;
		}

		function getStateTotal(state, key) {
			return DATA_COLS.reduce((s, col) => s + getCount(state, col, key), 0);
		}

		// ── Header row 1: fixed columns + state names ──
		let thead = '<thead>';
		thead += '<tr>';
		thead += '<th class="col-stage" rowspan="3" style="background:#1F497D;color:#fff;top:0;z-index:25;">Stages</th>';
		thead += '<th class="col-status" rowspan="3" style="background:#1F497D;color:#fff;top:0;z-index:25;">Status</th>';

		allGroups.forEach(function (grp, gi) {
			const bg = gi === allGroups.length - 1 ? '#1F497D' : STATE_HEADER_COLORS[gi % STATE_HEADER_COLORS.length];
			const fg = gi === allGroups.length - 1 ? '#fff' : '#000';
			thead += `<th colspan="${SUB_COLS.length}" style="background:${bg};color:${fg};">${grp}</th>`;
		});
		thead += '</tr>';

		// Header row 2: sub-column labels
		thead += '<tr>';
		allGroups.forEach(function (grp, gi) {
			const bg = gi === allGroups.length - 1 ? '#1F497D' : STATE_HEADER_COLORS[gi % STATE_HEADER_COLORS.length];
			const fg = gi === allGroups.length - 1 ? '#fff' : '#333';
			SUB_COLS.forEach(function (sc) {
				const bold = sc === 'Total' ? 'font-weight:700;' : '';
				thead += `<th style="background:${bg};color:${fg};${bold}">${sc}</th>`;
			});
		});
		thead += '</tr>';
		thead += '</thead>';

		// ── Body ──
		let tbody = '<tbody>';

		STAGES.forEach(function (stageCfg) {
			const stageColor = stageCfg.color;
			const stageText = stageCfg.textColor;
			const rowCount = stageCfg.rows.length;

			stageCfg.rows.forEach(function (rowCfg, ri) {
				const isTotal = rowCfg.isTotal;
				const rowClass = isTotal ? 'row-total' : '';
				const rowBg = isTotal ? '#D9D9D9' : stageColor;
				const rowFg = isTotal ? '#000' : stageText;

				tbody += `<tr class="${rowClass}">`;

				// Stage cell — only first row, rowspan the rest
				if (ri === 0) {
					tbody += `<td class="col-stage" rowspan="${rowCount}" style="background:${stageColor};color:${stageText};">${stageCfg.stage}</td>`;
				}

				// Status label
				tbody += `<td class="col-status" style="background:${rowBg};color:${rowFg};">${rowCfg.label}</td>`;

				// Data cells per group
				allGroups.forEach(function (grp, gi) {
					const isGrand = gi === allGroups.length - 1;
					const cellBg = isGrand ? '#1F497D' : rowBg;
					const cellFg = isGrand ? '#fff' : rowFg;

					DATA_COLS.forEach(function (col) {
						const val = getCount(grp, col, rowCfg.key);
						tbody += `<td class="col-num" style="background:${cellBg};color:${cellFg};">${val || ''}</td>`;
					});

					// State/group total
					const stTotal = getStateTotal(grp, rowCfg.key);
					const totalBg = isGrand ? '#1F497D' : '#BDD7EE';
					const totalFg = isGrand ? '#fff' : '#1F497D';
					tbody += `<td class="col-num col-subtotal" style="background:${totalBg};color:${totalFg};">${stTotal || ''}</td>`;
				});

				tbody += '</tr>';
			});
		});

		tbody += '</tbody>';

		const table = `<table class="fod-table">${thead}${tbody}</table>`;
		$('#fod-table-wrap').html(table);
	}

	// ── Initial load ──────────────────────────────────────────────────────
	loadDashboard();
};
