frappe.pages['scholarship-dashboard'].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({ parent: wrapper, title: 'Scholarship Recruitment Dashboard', single_column: true });

	// ── design tokens ─────────────────────────────────────────────────────────
	const T1 = '#0f172a', T2 = '#64748b', T3 = '#94a3b8';
	const BORD = '#e2e8f0', BG = '#f8faff';
	const AC = '#1F497D', AC2 = '#2c7db8', AC3 = '#4a9fd4';
	const GOOD = '#10b981', WARN = '#f59e0b', BAD = '#f43f5e';

	// Semantic colour chips used on KPI tiles & icon badges.
	const PALETTE = {
		blue: { bg: '#EBF3FB', fg: '#1F497D' },
		cyan: { bg: '#E0F7FA', fg: '#0e7490' },
		green: { bg: '#E7F9F1', fg: '#047857' },
		red: { bg: '#FEEBEE', fg: '#b91c1c' },
		amber: { bg: '#FEF3E2', fg: '#b45309' },
		purple: { bg: '#F1EEFD', fg: '#6d28d9' },
	};
	const FUNNEL_COLORS = ['#1F497D', '#2c7db8', '#0ea5e9', '#f59e0b', '#fb7185', '#8b5cf6', '#10b981'];
	const GEO_COLORS = ['#1F497D', '#2c7db8', '#0ea5e9', '#4a9fd4', '#38bdf8'];

	const DOCTYPE = 'Scholarship Recruitment Form';

	// Every status the doctype defines, in pipeline order.
	const ALL_STATUSES = [
		'New Applicant', 'Application Reject', 'Test Process', 'Test Reject',
		'Recruiter Round', 'Recruiter Reject', 'Round One', 'Round Two',
		'Reject - Round 1', 'Reject - Round 2', 'Document Collection', 'Offer',
	];
	const REJECT_STATUSES = ['Application Reject', 'Test Reject', 'Recruiter Reject', 'Reject - Round 1', 'Reject - Round 2'];
	const OFFER_STATUS = 'Offer';
	const ACTIVE_STATUSES = ALL_STATUSES.filter(function (s) { return s !== OFFER_STATUS && REJECT_STATUSES.indexOf(s) === -1; });

	// Cumulative funnel: a candidate whose *current* status is any status in `reached`
	// has, by definition, passed through this stage (reject statuses are attributed to
	// the stage they occurred right after — there is no separate stage-history log).
	const STAGE_DEFS = [
		{ label: 'Applied', reached: ALL_STATUSES.slice() },
		{
			label: 'Test Process', reached: [
				'Test Process', 'Test Reject', 'Recruiter Round', 'Recruiter Reject',
				'Round One', 'Reject - Round 1', 'Round Two', 'Reject - Round 2',
				'Document Collection', 'Offer',
			]
		},
		{
			label: 'Recruiter Round', reached: [
				'Recruiter Round', 'Recruiter Reject', 'Round One', 'Reject - Round 1',
				'Round Two', 'Reject - Round 2', 'Document Collection', 'Offer',
			]
		},
		{
			label: 'Round One', reached: [
				'Round One', 'Reject - Round 1', 'Round Two', 'Reject - Round 2',
				'Document Collection', 'Offer',
			]
		},
		{ label: 'Round Two', reached: ['Round Two', 'Reject - Round 2', 'Document Collection', 'Offer'] },
		{ label: 'Document Collection', reached: ['Document Collection', 'Offer'] },
		{ label: 'Offer', reached: ['Offer'] },
	];

	const ROLES = ['Associate', 'Resource Person', 'To be Decided'];
	const EDU_LEVELS = ['Diploma/Vocational course', 'Bachelors', 'Masters', 'Mphil/PhD/Others'];

	const FIELDS = [
		'name', 'creation', 'modified', 'application_status', 'role', 'gender',
		'state_of_residence', 'highest_level_of_education', 'total_years_of_experience',
		'full_name_as_per_aadhar', 'email',
	];

	let ROWS = [];
	let LOADED = false;
	let activeKey = 'exec';

	// ── style ─────────────────────────────────────────────────────────────────
	const S = document.createElement('style');
	S.textContent = `
		.sd-wrap { display:flex; align-items:flex-start; gap:0; background:${BG}; min-height:calc(100vh - 120px); margin:-10px -15px; }
		.sd-nav { width:230px; flex-shrink:0; padding:22px 14px; border-right:1px solid ${BORD}; background:#fff; position:sticky; top:0; }
		.sd-nav-title { font-size:11px; font-weight:700; color:${T2}; text-transform:uppercase; letter-spacing:.08em; margin:4px 8px 10px; }
		.sd-nav-item {
			display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:10px;
			font-size:13px; font-weight:600; color:${T1}; cursor:pointer; margin-bottom:2px;
			transition:background .15s, color .15s;
		}
		.sd-nav-item svg { width:16px; height:16px; stroke:${T2}; flex-shrink:0; transition:stroke .15s; }
		.sd-nav-item:hover { background:${BG}; transform:translateX(2px); }
		.sd-nav-item.active { background:${AC}; color:#fff; box-shadow:0 6px 16px rgba(31,73,125,.28); }
		.sd-nav-item.active svg { stroke:#fff; }
		.sd-body { flex:1; min-width:0; padding:24px 28px 40px; }
		.sd-hdr { display:flex; align-items:baseline; justify-content:space-between; margin-bottom:16px; flex-wrap:wrap; gap:8px; }
		.sd-hdr h2 { font-size:19px; font-weight:800; color:${T1}; margin:0; }
		.sd-hdr .sd-crumb { font-size:12px; color:${T2}; margin-left:10px; font-weight:500; }
		.sd-banner {
			display:flex; gap:10px; align-items:flex-start; background:#fff8e6; border:1px solid #fde5a8;
			color:#8a6300; border-radius:12px; padding:12px 16px; font-size:12.5px; line-height:1.5; margin-bottom:20px;
		}
		.sd-banner b { font-weight:700; }
		.sd-section { display:none; }
		.sd-section.active { display:block; animation:sdFadeUp .4s cubic-bezier(.22,1,.36,1) both; }
		@keyframes sdFadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
		@keyframes sdCardIn { from { opacity:0; transform:translateY(12px) scale(.985); } to { opacity:1; transform:translateY(0) scale(1); } }
		@keyframes sdSkel { 0% { background-position:100% 50%; } 100% { background-position:0 50%; } }
		@keyframes sdSpin { to { transform:rotate(360deg); } }
		.sd-kpis { display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:14px; margin-bottom:22px; }
		.sd-kpi {
			background:#fff; border:1px solid ${BORD}; border-radius:16px; padding:16px 18px;
			animation:sdCardIn .45s cubic-bezier(.22,1,.36,1) both; transition:transform .2s, box-shadow .2s, border-color .2s;
		}
		.sd-kpi:hover { transform:translateY(-3px); box-shadow:0 12px 26px rgba(15,23,42,.09); border-color:transparent; }
		.sd-kpi:nth-of-type(1){ animation-delay:.02s } .sd-kpi:nth-of-type(2){ animation-delay:.06s }
		.sd-kpi:nth-of-type(3){ animation-delay:.1s } .sd-kpi:nth-of-type(4){ animation-delay:.14s }
		.sd-kpi:nth-of-type(5){ animation-delay:.18s } .sd-kpi:nth-of-type(6){ animation-delay:.22s }
		.sd-kpi-ico { width:34px; height:34px; border-radius:10px; display:flex; align-items:center; justify-content:center; margin-bottom:10px; }
		.sd-kpi-ico svg { width:17px; height:17px; }
		.sd-kpi-k { font-size:11px; font-weight:700; color:${T2}; text-transform:uppercase; letter-spacing:.04em; }
		.sd-kpi-v { font-size:26px; font-weight:900; color:${T1}; margin-top:6px; }
		.sd-kpi-s { font-size:11.5px; color:${T2}; margin-top:4px; }
		.sd-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px; }
		.sd-card {
			background:#fff; border:1px solid ${BORD}; border-radius:16px; padding:20px; margin-bottom:16px;
			animation:sdCardIn .5s cubic-bezier(.22,1,.36,1) both; transition:box-shadow .2s, transform .2s;
		}
		.sd-card:hover { box-shadow:0 14px 30px rgba(15,23,42,.07); transform:translateY(-2px); }
		.sd-card:nth-of-type(1){ animation-delay:.04s } .sd-card:nth-of-type(2){ animation-delay:.12s }
		.sd-card:nth-of-type(3){ animation-delay:.2s } .sd-card:nth-of-type(4){ animation-delay:.28s }
		.sd-card h3 { font-size:14px; font-weight:800; color:${T1}; margin:0 0 2px; }
		.sd-card .sd-sub { font-size:11.5px; color:${T2}; margin-bottom:14px; }
		.sd-funnel-row { display:flex; align-items:center; gap:12px; margin-bottom:10px; }
		.sd-funnel-idx {
			width:24px; height:24px; border-radius:50%; background:${BG}; color:${T2}; font-size:11px; font-weight:700;
			display:flex; align-items:center; justify-content:center; flex-shrink:0;
		}
		.sd-funnel-lbl { width:150px; flex-shrink:0; font-size:12.5px; font-weight:600; color:${T1}; }
		.sd-funnel-bar-wrap { flex:1; background:${BG}; border-radius:8px; height:34px; position:relative; overflow:hidden; }
		.sd-funnel-bar {
			height:100%; width:0; border-radius:8px; display:flex; align-items:center; padding:0 10px;
			color:#fff; font-size:12px; font-weight:700; white-space:nowrap;
			transition:width .8s cubic-bezier(.22,1,.36,1); box-shadow:inset 0 -10px 14px rgba(0,0,0,.08);
		}
		.sd-funnel-meta { width:150px; flex-shrink:0; display:flex; justify-content:space-between; font-size:11.5px; color:${T2}; }
		.sd-funnel-meta b { color:${GOOD}; }
		.sd-bar-list-row { display:flex; align-items:center; gap:10px; margin-bottom:9px; }
		.sd-bar-list-lbl { width:150px; flex-shrink:0; font-size:12.5px; font-weight:600; color:${T1}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
		.sd-bar-list-track { flex:1; background:${BG}; border-radius:6px; height:16px; overflow:hidden; }
		.sd-bar-list-fill { height:100%; width:0; border-radius:6px; background:${AC}; transition:width .7s cubic-bezier(.22,1,.36,1); }
		.sd-bar-list-val { width:56px; text-align:right; flex-shrink:0; font-size:12.5px; font-weight:700; color:${T1}; }
		table.sd-table { width:100%; border-collapse:collapse; font-size:12.5px; }
		table.sd-table th { text-align:left; font-size:10.5px; font-weight:700; color:${T2}; text-transform:uppercase; letter-spacing:.04em; padding:8px 10px; border-bottom:1px solid ${BORD}; }
		table.sd-table td { padding:9px 10px; border-bottom:1px solid ${BORD}; color:${T1}; }
		table.sd-table tr:last-child td { border-bottom:none; font-weight:700; }
		.sd-chip { display:inline-block; padding:2px 9px; border-radius:999px; font-size:11px; font-weight:700; }
		.sd-clickable { cursor:pointer; border-radius:8px; transition:background .15s, transform .15s; }
		.sd-clickable:hover { background:${BG}; }
		.sd-funnel-row.sd-clickable:hover, .sd-bar-list-row.sd-clickable:hover { transform:translateX(2px); }
		.sd-kpi.sd-kpi-click { cursor:pointer; }
		.sd-kpi-link { font-size:11px; font-weight:700; color:${AC}; margin-top:10px; opacity:0; transition:opacity .15s; }
		.sd-kpi.sd-kpi-click:hover .sd-kpi-link { opacity:1; }
		.sd-nodata { padding:30px 10px; text-align:center; color:${T3}; font-size:12.5px; }
		.sd-skel-line, .sd-skel-card, .sd-kpi.sd-skel {
			background:linear-gradient(90deg, #eef2f7 25%, #e4eaf3 37%, #eef2f7 63%);
			background-size:400% 100%; animation:sdSkel 1.3s ease infinite;
		}
		.sd-skel-line { height:22px; border-radius:8px; margin-bottom:16px; width:280px; }
		.sd-kpi.sd-skel { height:88px; }
		.sd-skel-card { height:240px; }
		.sd-spinner {
			width:14px; height:14px; border-radius:50%; border:2px solid rgba(255,255,255,.4); border-top-color:#fff;
			display:inline-block; animation:sdSpin .7s linear infinite; margin-right:6px; vertical-align:-2px;
		}
		@media (max-width: 900px) { .sd-grid2 { grid-template-columns:1fr; } }
		/* ── records popup (shown on click, before jumping into Frappe) ── */
		.sd-modal-overlay {
			position:fixed; inset:0; background:rgba(15,23,42,.45); z-index:9000;
			display:none; align-items:center; justify-content:center; padding:24px;
		}
		.sd-modal-overlay.show { display:flex; }
		.sd-modal {
			background:#fff; border-radius:18px; width:min(880px, 100%); max-height:82vh;
			display:flex; flex-direction:column; box-shadow:0 30px 70px rgba(0,0,0,.28);
			animation:sdModalIn .22s cubic-bezier(.22,1,.36,1) both;
		}
		@keyframes sdModalIn { from { opacity:0; transform:translateY(10px) scale(.98); } to { opacity:1; transform:translateY(0) scale(1); } }
		.sd-modal-hdr { display:flex; align-items:flex-start; justify-content:space-between; padding:18px 22px; border-bottom:1px solid ${BORD}; }
		.sd-modal-hdr h4 { margin:0; font-size:15px; font-weight:800; color:${T1}; }
		.sd-modal-hdr .sd-modal-sub { font-size:12px; color:${T2}; margin-top:3px; }
		.sd-modal-close { cursor:pointer; width:30px; height:30px; border-radius:8px; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:${T2}; font-size:18px; transition:background .15s; }
		.sd-modal-close:hover { background:${BG}; }
		.sd-modal-body { overflow-y:auto; padding:0 22px; flex:1; }
		table.sd-modal-table { width:100%; border-collapse:collapse; font-size:12.5px; }
		table.sd-modal-table thead th {
			position:sticky; top:0; background:#fff; text-align:left; font-size:10.5px; font-weight:700; color:${T2};
			text-transform:uppercase; letter-spacing:.04em; padding:10px; border-bottom:1px solid ${BORD}; z-index:1;
		}
		table.sd-modal-table tbody tr.sd-modal-row { cursor:pointer; transition:background .15s; }
		table.sd-modal-table tbody tr.sd-modal-row:hover { background:${BG}; }
		table.sd-modal-table tbody tr.sd-modal-row:hover td:first-child { color:${AC}; }
		table.sd-modal-table td { padding:10px; border-bottom:1px solid ${BORD}; color:${T1}; white-space:nowrap; }
		table.sd-modal-table td:first-child { font-weight:700; transition:color .15s; }
		table.sd-modal-table tbody tr:last-child td { border-bottom:none; }
		.sd-modal-ftr { display:flex; justify-content:flex-end; gap:10px; padding:16px 22px; border-top:1px solid ${BORD}; }
		.sd-modal-btn { padding:9px 18px; border-radius:9px; font-size:12.5px; font-weight:700; cursor:pointer; border:1px solid ${BORD}; background:#fff; color:${T1}; transition:opacity .15s; }
		.sd-modal-btn:hover { opacity:.8; }
		.sd-modal-btn.primary { background:${AC}; color:#fff; border-color:${AC}; }
	`;
	document.head.appendChild(S);

	// ── icons ─────────────────────────────────────────────────────────────────
	const ICON = {
		exec: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18.7 8 12 14.7l-3.3-3.4L4 16.6"/></svg>',
		funnel: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 3H2l8 9.5V19l4 2v-8.5z"/></svg>',
		demo: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
		speed: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
	};
	// KPI-tile icon badges (stroke colour is set inline per-tile from PALETTE).
	const ICONK = {
		total: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
		active: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
		offer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
		reject: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
		star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
		pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
		clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
		flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
		alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
	};

	const SECTIONS = [
		{ key: 'exec', label: 'Executive Summary' },
		{ key: 'funnel', label: 'Funnel & Pipeline' },
		{ key: 'demo', label: 'Demographics' },
		{ key: 'speed', label: 'Speed & Efficiency' },
	];

	// ── DOM shell ─────────────────────────────────────────────────────────────
	$(wrapper).find('.page-content').append(`
		<div class="sd-wrap">
			<div class="sd-nav">
				<div class="sd-nav-title">Dashboards</div>
				${SECTIONS.map(function (s) {
		return '<div class="sd-nav-item" data-sec="' + s.key + '">' + ICON[s.key] + '<span>' + s.label + '</span></div>';
	}).join('')}
			</div>
			<div class="sd-body">
				<div class="sd-banner">
					<b>Scope note:</b>&nbsp;This dashboard only reports on fields actually captured in
					<b>Scholarship Recruitment Form</b>. Source channel, interviewer/panel data and
					post-process candidate surveys are not tracked by this doctype today, so Sourcing,
					Interviewer Performance and Candidate Experience views aren't shown here. Add those
					fields (or linked doctypes) to enable them.
				</div>
				<div id="sd-sec-exec" class="sd-section"></div>
				<div id="sd-sec-funnel" class="sd-section"></div>
				<div id="sd-sec-demo" class="sd-section"></div>
				<div id="sd-sec-speed" class="sd-section"></div>
			</div>
		</div>
		<div class="sd-modal-overlay" id="sd-modal-overlay">
			<div class="sd-modal">
				<div class="sd-modal-hdr">
					<div><h4 id="sd-modal-title"></h4><div class="sd-modal-sub" id="sd-modal-sub"></div></div>
					<div class="sd-modal-close" id="sd-modal-close">&times;</div>
				</div>
				<div class="sd-modal-body" id="sd-modal-body"></div>
				<div class="sd-modal-ftr">
					<div class="sd-modal-btn" id="sd-modal-cancel">Close</div>
					<div class="sd-modal-btn primary" id="sd-modal-open-frappe">Open in Pathway &rarr;</div>
				</div>
			</div>
		</div>
	`);

	$(wrapper).find('.sd-nav-item').on('click', function () {
		setActive($(this).data('sec'));
	});

	// Every drill-down (KPI tile / funnel row / geo row / bar) opens a popup
	// showing the matching records first — mirrors the Recruitment Dashboard's
	// "profile card first, explicit button to Frappe" pattern instead of
	// jumping straight into the raw Frappe list view on the very first click.
	function openList(filters) {
		frappe.route_options = filters || {};
		frappe.set_route('List', DOCTYPE);
	}
	function fmtDate(d) { return d.toISOString().slice(0, 10); }

	// Client-side re-implementation of the filter shapes used throughout this
	// file ({field: value}, {field: ['in', arr]}, {field: ['<'|'<='|'between', ...]},
	// {field: ['like', '%']}) — lets the popup preview the same record set
	// "Open in Frappe" would land on, without a round-trip to the server.
	function toDate(s) { return new Date(String(s).replace(' ', 'T')); }
	function rowMatchesFilters(row, filters) {
		return Object.keys(filters).every(function (field) {
			var cond = filters[field];
			var val = row[field];
			if (!Array.isArray(cond)) return val === cond;
			var op = cond[0], arg = cond[1];
			if (op === 'in') return arg.indexOf(val) !== -1;
			if (op === 'like') return true; // only used for the "match everything" tautology filter
			if (!val) return false;
			if (op === '<') return toDate(val) < toDate(arg);
			if (op === '<=') { var end = toDate(arg); end.setHours(23, 59, 59, 999); return toDate(val) <= end; }
			if (op === 'between') {
				var hi = toDate(arg[1]); hi.setHours(23, 59, 59, 999);
				return toDate(val) >= toDate(arg[0]) && toDate(val) <= hi;
			}
			return true;
		});
	}

	let MODAL_FILTERS = null;
	function showRecordsModal(title, filters) {
		MODAL_FILTERS = filters;
		var matches = ROWS.filter(function (r) { return rowMatchesFilters(r, filters); });
		document.getElementById('sd-modal-title').textContent = title;
		document.getElementById('sd-modal-sub').textContent =
			matches.length.toLocaleString('en-IN') + (matches.length === 1 ? ' record' : ' records');
		var body = document.getElementById('sd-modal-body');
		if (!matches.length) {
			body.innerHTML = '<div class="sd-nodata">No records match.</div>';
		} else {
			// Every matching record, in full — this is a small per-doctype dataset
			// (a few hundred rows at most), so there's no need to truncate.
			body.innerHTML = `
				<table class="sd-modal-table">
					<thead>
						<tr>
							<th>Name</th><th>Role</th><th>Status</th><th>Gender</th><th>State</th><th>Experience</th>
						</tr>
					</thead>
					<tbody>
						${matches.map(function (r) {
					return `
								<tr class="sd-modal-row" data-name="${r.name}">
									<td>${r.full_name_as_per_aadhar || r.name}</td>
									<td>${r.role || '&mdash;'}</td>
									<td>${r.application_status || '&mdash;'}</td>
									<td>${r.gender || '&mdash;'}</td>
									<td>${r.state_of_residence || '&mdash;'}</td>
									<td>${r.total_years_of_experience ? r.total_years_of_experience + ' yrs' : '&mdash;'}</td>
								</tr>
							`;
				}).join('')}
					</tbody>
				</table>
			`;
		}
		document.getElementById('sd-modal-overlay').classList.add('show');
	}
	function hideRecordsModal() {
		document.getElementById('sd-modal-overlay').classList.remove('show');
		MODAL_FILTERS = null;
	}
	$(wrapper).on('click', '#sd-modal-close, #sd-modal-cancel', hideRecordsModal);
	$(wrapper).on('click', '#sd-modal-overlay', function (e) { if (e.target === this) hideRecordsModal(); });
	$(wrapper).on('click', '#sd-modal-open-frappe', function () { if (MODAL_FILTERS) openList(MODAL_FILTERS); });
	$(wrapper).on('click', '.sd-modal-row', function () {
		frappe.set_route('Form', DOCTYPE, $(this).data('name'));
	});

	$(wrapper).on('click', '.sd-kpi[data-filters], .sd-funnel-row[data-filters], .sd-bar-list-row[data-filters]', function () {
		var filters = JSON.parse(this.getAttribute('data-filters'));
		var title = this.getAttribute('data-title') || 'Records';
		showRecordsModal(title, filters);
	});
	// Delegated click on the chart's (stable) container element — reads the
	// clicked bar's `data-point-index` straight off the SVG rect frappe-charts
	// draws (`<rect class="bar" data-point-index="N">`). Delegation means this
	// keeps working even though frappe-charts destroys & recreates those rects
	// during its own entry-animation re-render. Pie charts don't expose a
	// per-slice DOM hook the same way, so those stay view-only.
	function bindBarClick(container, mapFn) {
		if (!container) return;
		container.addEventListener('click', function (e) {
			var bar = e.target.closest('.bar');
			if (!bar) return;
			var idx = parseInt(bar.getAttribute('data-point-index'), 10);
			if (isNaN(idx)) return;
			var result = mapFn(idx);
			if (result && result.filters) showRecordsModal(result.title, result.filters);
		});
	}

	function setActive(key) {
		activeKey = key;
		$(wrapper).find('.sd-nav-item').removeClass('active').filter('[data-sec="' + key + '"]').addClass('active');
		$(wrapper).find('.sd-section').removeClass('active');
		$(wrapper).find('#sd-sec-' + key).addClass('active');
		if (LOADED) renderSection(key);
		else showSkeleton(document.getElementById('sd-sec-' + key));
	}
	setActive('exec');

	// ── data load ─────────────────────────────────────────────────────────────
	frappe.call({
		method: 'frappe.client.get_list',
		args: { doctype: DOCTYPE, fields: FIELDS, filters: [['name', '!=', '']], limit_page_length: 0 },
		callback: function (r) {
			ROWS = (r && r.message) || [];
			LOADED = true;
			// Only render the tab that's actually visible — the others render
			// lazily on first click (a hidden/zero-width container breaks frappe.Chart).
			renderSection(activeKey);
		}
	});

	function renderSection(key) {
		if (key === 'exec') renderExec();
		else if (key === 'funnel') renderFunnel();
		else if (key === 'demo') renderDemo();
		else if (key === 'speed') renderSpeed();
	}

	// ── shared helpers ────────────────────────────────────────────────────────
	function countBy(rows, field) {
		var m = {};
		rows.forEach(function (r) {
			var v = (r[field] || '').toString().trim();
			if (!v) return;
			m[v] = (m[v] || 0) + 1;
		});
		return m;
	}
	function pct(n, d) { return d ? Math.round((n / d) * 1000) / 10 : 0; }
	function daysSince(dateStr) {
		if (!dateStr) return null;
		var d = new Date(dateStr.replace(' ', 'T'));
		if (isNaN(d.getTime())) return null;
		return Math.floor((Date.now() - d.getTime()) / 86400000);
	}
	function daysBetween(a, b) {
		var da = new Date(a.replace(' ', 'T')), db = new Date(b.replace(' ', 'T'));
		if (isNaN(da.getTime()) || isNaN(db.getTime())) return null;
		return Math.max(0, Math.round((db.getTime() - da.getTime()) / 86400000));
	}
	function avg(arr) {
		var nums = arr.filter(function (n) { return typeof n === 'number' && !isNaN(n); });
		if (!nums.length) return null;
		return nums.reduce(function (s, n) { return s + n; }, 0) / nums.length;
	}
	function safeChart(el, opts) {
		if (!el) return;
		el.innerHTML = '';
		try { new frappe.Chart(el, opts); }
		catch (err) { el.innerHTML = '<div class="sd-nodata">Not enough data to render this chart.</div>'; }
	}
	// Builds one KPI tile. `raw` (a plain number) drives the count-up animation;
	// `suffix` is any non-animated trailing text (" yrs", "d", "%", …).
	// `filters`, when given, makes the tile clickable — it opens the doctype's
	// list view pre-filtered (see openList()); omit it for tiles that don't map
	// to a single filterable subset (e.g. an average or a distinct-count).
	function kpi(opts) {
		var pal = PALETTE[opts.color] || PALETTE.blue;
		var valueHtml = (typeof opts.raw === 'number')
			? '<span class="sd-cnt" data-target="' + opts.raw + '" data-decimals="' + (opts.decimals || 0) + '">0</span>' + (opts.suffix || '')
			: (opts.value || '&mdash;');
		var filtersAttr = opts.filters
			? ' data-filters="' + JSON.stringify(opts.filters).replace(/"/g, '&quot;') + '" data-title="' + opts.label + '"'
			: '';
		return `
			<div class="sd-kpi${opts.filters ? ' sd-kpi-click' : ''}"${filtersAttr}>
				<div class="sd-kpi-ico" style="background:${pal.bg}; color:${pal.fg}">${ICONK[opts.icon] || ''}</div>
				<div class="sd-kpi-k">${opts.label}</div>
				<div class="sd-kpi-v">${valueHtml}</div>
				<div class="sd-kpi-s">${opts.sub}</div>
				${opts.filters ? '<div class="sd-kpi-link">View records &rarr;</div>' : ''}
			</div>
		`;
	}
	// Animates every `.sd-cnt` counter inside `scopeEl` from 0 up to its data-target.
	function runCountUps(scopeEl) {
		var els = scopeEl.querySelectorAll('.sd-cnt');
		els.forEach(function (el) {
			var target = parseFloat(el.getAttribute('data-target'));
			var decimals = parseInt(el.getAttribute('data-decimals') || '0', 10);
			if (isNaN(target)) return;
			var frames = 28, i = 0, cur = 0;
			var step = target / frames;
			var t = setInterval(function () {
				i++; cur += step;
				var done = i >= frames || cur >= target;
				var v = done ? target : cur;
				el.textContent = decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString('en-IN');
				if (done) clearInterval(t);
			}, 18);
		});
	}
	// Bars/tracks are rendered at width:0 and flipped to their real width next frame,
	// so the CSS `transition:width` on `.sd-funnel-bar` / `.sd-bar-list-fill` animates in.
	function animateBars(scopeEl, selector) {
		var bars = scopeEl.querySelectorAll(selector);
		requestAnimationFrame(function () {
			bars.forEach(function (b, i) {
				setTimeout(function () { b.style.width = b.getAttribute('data-w') + '%'; }, i * 55);
			});
		});
	}
	function showSkeleton(el) {
		el.innerHTML = `
			<div class="sd-skel-line"></div>
			<div class="sd-kpis">${new Array(4).fill('<div class="sd-kpi sd-skel"></div>').join('')}</div>
			<div class="sd-grid2"><div class="sd-card sd-skel-card"></div><div class="sd-card sd-skel-card"></div></div>
		`;
	}

	// ── Executive Summary ────────────────────────────────────────────────────
	function renderExec() {
		var el = document.getElementById('sd-sec-exec');
		var total = ROWS.length;
		var offers = ROWS.filter(function (r) { return r.application_status === OFFER_STATUS; }).length;
		var rejected = ROWS.filter(function (r) { return REJECT_STATUSES.indexOf(r.application_status) !== -1; }).length;
		var active = total - offers - rejected;
		var expYrs = avg(ROWS.map(function (r) { return parseFloat(r.total_years_of_experience); }));
		var states = Object.keys(countBy(ROWS, 'state_of_residence')).length;

		el.innerHTML = `
			<div class="sd-hdr"><h2>Executive Summary</h2><span class="sd-crumb">Scholarship Recruitment &middot; All Time</span></div>
			<div class="sd-kpis">
				${kpi({ icon: 'total', color: 'blue', label: 'Total Applications', raw: total, sub: 'All-time submissions', filters: { name: ['like', '%'] } })}
				${kpi({ icon: 'active', color: 'amber', label: 'Active Pipeline', raw: active, sub: pct(active, total) + '% of total', filters: { application_status: ['in', ACTIVE_STATUSES] } })}
				${kpi({ icon: 'offer', color: 'green', label: 'Offers Extended', raw: offers, sub: 'Offer rate ' + pct(offers, total) + '%', filters: { application_status: OFFER_STATUS } })}
				${kpi({ icon: 'reject', color: 'red', label: 'Rejected', raw: rejected, sub: 'Reject rate ' + pct(rejected, total) + '%', filters: { application_status: ['in', REJECT_STATUSES] } })}
				${kpi({ icon: 'star', color: 'purple', label: 'Avg. Experience', raw: expYrs === null ? null : Math.round(expYrs * 10) / 10, decimals: 1, suffix: ' yrs', value: expYrs === null ? '&mdash;' : undefined, sub: 'Self-reported, applicants' })}
				${kpi({ icon: 'pin', color: 'cyan', label: 'States Sourced From', raw: states, sub: 'Distinct states of residence' })}
			</div>
			<div class="sd-grid2">
				<div class="sd-card"><h3>Applications by Role</h3><div class="sd-sub">Distribution of applied roles</div><div id="sd-chart-role" style="min-height:220px"></div></div>
				<div class="sd-card"><h3>Current Status Distribution</h3><div class="sd-sub">Where every application stands right now</div><div id="sd-chart-status" style="min-height:220px"></div></div>
			</div>
		`;
		runCountUps(el);

		var roleCounts = countBy(ROWS, 'role');
		var roleChartEl = document.getElementById('sd-chart-role');
		safeChart(roleChartEl, {
			type: 'bar', height: 220, colors: [AC],
			data: { labels: ROLES, datasets: [{ name: 'Applications', values: ROLES.map(function (r) { return roleCounts[r] || 0; }) }] },
			barOptions: { spaceRatio: 0.3 },
		});
		bindBarClick(roleChartEl, function (i) { return { title: ROLES[i], filters: { role: ROLES[i] } }; });

		var statusCounts = countBy(ROWS, 'application_status');
		var statusEntries = ALL_STATUSES.map(function (s) { return [s, statusCounts[s] || 0]; }).filter(function (e) { return e[1] > 0; });
		safeChart(document.getElementById('sd-chart-status'), {
			type: 'pie', height: 220,
			colors: ['#1F497D', '#2c7db8', '#4a9fd4', '#10b981', '#f59e0b', '#f43f5e', '#94a3b8', '#a78bfa', '#fb923c', '#38bdf8', '#e879f9', '#334155'],
			data: { labels: statusEntries.map(function (e) { return e[0]; }), datasets: [{ values: statusEntries.map(function (e) { return e[1]; }) }] },
		});
	}

	// ── Funnel & Pipeline ─────────────────────────────────────────────────────
	function renderFunnel() {
		var el = document.getElementById('sd-sec-funnel');
		var total = ROWS.length;
		var stageCounts = STAGE_DEFS.map(function (st) {
			return ROWS.filter(function (r) { return st.reached.indexOf(r.application_status) !== -1; }).length;
		});
		var maxCount = stageCounts[0] || 1;

		var funnelHtml = STAGE_DEFS.map(function (st, i) {
			var count = stageCounts[i];
			var widthPct = Math.max(4, Math.round((count / maxCount) * 100));
			var convPct = i === 0 ? null : pct(count, stageCounts[i - 1]);
			var ofTotal = pct(count, total);
			var color = FUNNEL_COLORS[i % FUNNEL_COLORS.length];
			var filtersAttr = JSON.stringify({ application_status: ['in', st.reached] }).replace(/"/g, '&quot;');
			return `
				<div class="sd-funnel-row sd-clickable" data-filters="${filtersAttr}" data-title="${st.label}">
					<div class="sd-funnel-idx" style="background:${color}22; color:${color}">${i + 1}</div>
					<div class="sd-funnel-lbl">${st.label}</div>
					<div class="sd-funnel-bar-wrap">
						<div class="sd-funnel-bar" data-w="${widthPct}" style="background:${color};">${count.toLocaleString('en-IN')}</div>
					</div>
					<div class="sd-funnel-meta"><span>${ofTotal}% total</span>${convPct === null ? '' : '<b style="color:' + (convPct >= 70 ? GOOD : convPct >= 40 ? WARN : BAD) + '">' + convPct + '%</b>'}</div>
				</div>
			`;
		}).join('');

		var rejectCounts = countBy(ROWS, 'application_status');
		var rejectEntries = REJECT_STATUSES.map(function (s) { return [s, rejectCounts[s] || 0]; });

		el.innerHTML = `
			<div class="sd-hdr"><h2>Funnel & Pipeline</h2><span class="sd-crumb">Cumulative, based on current application status</span></div>
			<div class="sd-card">
				<h3>Recruitment Funnel</h3>
				<div class="sd-sub">7-stage pipeline &middot; ${total.toLocaleString('en-IN')} applications &middot; conv. % is stage-to-stage</div>
				${funnelHtml}
			</div>
			<div class="sd-grid2">
				<div class="sd-card"><h3>Rejections by Stage</h3><div class="sd-sub">Where in the pipeline candidates were rejected</div><div id="sd-chart-reject" style="min-height:220px"></div></div>
				<div class="sd-card"><h3>Active Pipeline by Role</h3><div class="sd-sub">Candidates still in process, by applied role</div><div id="sd-chart-role-pipeline" style="min-height:220px"></div></div>
			</div>
		`;
		animateBars(el, '.sd-funnel-bar');

		var rejectChartEl = document.getElementById('sd-chart-reject');
		safeChart(rejectChartEl, {
			type: 'bar', height: 220, colors: [BAD],
			data: { labels: rejectEntries.map(function (e) { return e[0].replace('Reject - ', 'R'); }), datasets: [{ name: 'Rejections', values: rejectEntries.map(function (e) { return e[1]; }) }] },
			barOptions: { spaceRatio: 0.3 },
		});
		bindBarClick(rejectChartEl, function (i) { return { title: rejectEntries[i][0], filters: { application_status: rejectEntries[i][0] } }; });

		var activeRows = ROWS.filter(function (r) { return ACTIVE_STATUSES.indexOf(r.application_status) !== -1; });
		var roleActive = countBy(activeRows, 'role');
		var rolePipelineChartEl = document.getElementById('sd-chart-role-pipeline');
		safeChart(rolePipelineChartEl, {
			type: 'bar', height: 220, colors: [AC2],
			data: { labels: ROLES, datasets: [{ name: 'Active', values: ROLES.map(function (r) { return roleActive[r] || 0; }) }] },
			barOptions: { spaceRatio: 0.3 },
		});
		bindBarClick(rolePipelineChartEl, function (i) {
			return { title: ROLES[i] + ' — Active Pipeline', filters: { role: ROLES[i], application_status: ['in', ACTIVE_STATUSES] } };
		});
	}

	// ── Demographics ──────────────────────────────────────────────────────────
	function renderDemo() {
		var el = document.getElementById('sd-sec-demo');
		el.innerHTML = `
			<div class="sd-hdr"><h2>Demographics</h2><span class="sd-crumb">Gender, geography & education of applicants</span></div>
			<div class="sd-grid2">
				<div class="sd-card"><h3>Gender Representation by Stage</h3><div class="sd-sub">Cumulative reach, split by gender</div><div id="sd-chart-gender-stage" style="min-height:240px"></div></div>
				<div class="sd-card"><h3>Overall Gender Split</h3><div class="sd-sub">All applications</div><div id="sd-chart-gender-pie" style="min-height:240px"></div></div>
			</div>
			<div class="sd-grid2">
				<div class="sd-card"><h3>Geographic Distribution</h3><div class="sd-sub">Top states by applicant volume</div><div id="sd-geo-list"></div></div>
				<div class="sd-card"><h3>Highest Education Level</h3><div class="sd-sub">Distribution across applicants</div><div id="sd-chart-edu" style="min-height:240px"></div></div>
			</div>
		`;

		var genderStageLabels = STAGE_DEFS.map(function (s) { return s.label; });
		var male = [], female = [], other = [];
		STAGE_DEFS.forEach(function (st) {
			var rows = ROWS.filter(function (r) { return st.reached.indexOf(r.application_status) !== -1; });
			var m = 0, f = 0, o = 0;
			rows.forEach(function (r) {
				var g = (r.gender || '').toLowerCase();
				if (g === 'female') f++; else if (g === 'male') m++; else if (g) o++;
			});
			male.push(m); female.push(f); other.push(o);
		});
		var gsDatasets = [{ name: 'Female', values: female }, { name: 'Male', values: male }];
		if (other.some(function (v) { return v > 0; })) gsDatasets.push({ name: 'Others', values: other });
		safeChart(document.getElementById('sd-chart-gender-stage'), {
			type: 'bar', height: 240, colors: [AC, AC2, T3],
			data: { labels: genderStageLabels, datasets: gsDatasets },
			barOptions: { spaceRatio: 0.3, stacked: 1 },
		});

		var genderCounts = countBy(ROWS, 'gender');
		var GENDER_ORDER = ['Female', 'Male', 'Others'];
		var GENDER_COLORS = { Female: AC, Male: AC2, Others: T3 };
		var genderEntries = GENDER_ORDER.map(function (k) { return [k, genderCounts[k] || 0]; }).filter(function (e) { return e[1] > 0; });
		safeChart(document.getElementById('sd-chart-gender-pie'), {
			type: 'pie', height: 240, colors: genderEntries.map(function (e) { return GENDER_COLORS[e[0]]; }),
			data: { labels: genderEntries.map(function (e) { return e[0]; }), datasets: [{ values: genderEntries.map(function (e) { return e[1]; }) }] },
		});

		var stateCounts = countBy(ROWS, 'state_of_residence');
		var stateEntries = Object.keys(stateCounts).map(function (k) { return [k, stateCounts[k]]; })
			.sort(function (a, b) { return b[1] - a[1]; }).slice(0, 10);
		var geoEl = document.getElementById('sd-geo-list');
		if (!stateEntries.length) {
			geoEl.innerHTML = '<div class="sd-nodata">No state data yet.</div>';
		} else {
			var maxState = stateEntries[0][1] || 1;
			geoEl.innerHTML = stateEntries.map(function (e, i) {
				var w = Math.max(4, Math.round((e[1] / maxState) * 100));
				var color = GEO_COLORS[i % GEO_COLORS.length];
				var filtersAttr = JSON.stringify({ state_of_residence: e[0] }).replace(/"/g, '&quot;');
				return `
					<div class="sd-bar-list-row sd-clickable" data-filters="${filtersAttr}" data-title="${e[0]}">
						<div class="sd-bar-list-lbl">${e[0]}</div>
						<div class="sd-bar-list-track"><div class="sd-bar-list-fill" data-w="${w}" style="background:${color}"></div></div>
						<div class="sd-bar-list-val">${e[1].toLocaleString('en-IN')}</div>
					</div>
				`;
			}).join('');
			animateBars(geoEl, '.sd-bar-list-fill');
		}

		var eduCounts = countBy(ROWS, 'highest_level_of_education');
		var eduEntries = EDU_LEVELS.map(function (l) { return [l, eduCounts[l] || 0]; }).filter(function (e) { return e[1] > 0; });
		safeChart(document.getElementById('sd-chart-edu'), {
			type: 'pie', height: 240, colors: ['#1F497D', '#2c7db8', '#4a9fd4', '#10b981'],
			data: { labels: eduEntries.map(function (e) { return e[0]; }), datasets: [{ values: eduEntries.map(function (e) { return e[1]; }) }] },
		});
	}

	// ── Speed & Efficiency ────────────────────────────────────────────────────
	function renderSpeed() {
		var el = document.getElementById('sd-sec-speed');
		var activeRows = ROWS.filter(function (r) { return ACTIVE_STATUSES.indexOf(r.application_status) !== -1; });
		var closedRows = ROWS.filter(function (r) { return r.application_status === OFFER_STATUS || REJECT_STATUSES.indexOf(r.application_status) !== -1; });

		var ageDays = activeRows.map(function (r) { return daysSince(r.creation); }).filter(function (n) { return n !== null; });
		var avgAge = avg(ageDays);
		var decisionDays = closedRows.map(function (r) { return daysBetween(r.creation, r.modified); }).filter(function (n) { return n !== null; });
		var avgDecision = avg(decisionDays);
		var aged60 = ageDays.filter(function (n) { return n > 60; }).length;

		el.innerHTML = `
			<div class="sd-hdr"><h2>Speed & Efficiency</h2><span class="sd-crumb">Pipeline aging &middot; approximated from creation/modified timestamps</span></div>
			<div class="sd-kpis">
				${kpi({ icon: 'clock', color: 'amber', label: 'Avg. Days in Active Pipeline', raw: avgAge === null ? null : Math.round(avgAge), suffix: 'd', value: avgAge === null ? '&mdash;' : undefined, sub: activeRows.length.toLocaleString('en-IN') + ' candidates in process', filters: { application_status: ['in', ACTIVE_STATUSES] } })}
				${kpi({ icon: 'flag', color: 'blue', label: 'Avg. Days to Decision (approx.)', raw: avgDecision === null ? null : Math.round(avgDecision), suffix: 'd', value: avgDecision === null ? '&mdash;' : undefined, sub: 'Creation &rarr; last update, offered/rejected', filters: { application_status: ['in', REJECT_STATUSES.concat([OFFER_STATUS])] } })}
				${kpi({ icon: 'alert', color: 'red', label: 'Aged &gt; 60 Days', raw: aged60, sub: 'Still active, needs attention', filters: { application_status: ['in', ACTIVE_STATUSES], creation: ['<', fmtDate(new Date(Date.now() - 60 * 86400000))] } })}
			</div>
			<div class="sd-grid2">
				<div class="sd-card"><h3>Application Aging</h3><div class="sd-sub">Days since submission, active pipeline only</div><div id="sd-chart-aging" style="min-height:220px"></div></div>
				<div class="sd-card"><h3>Avg. Pipeline Age by Role</h3><div class="sd-sub">Active candidates only, in days</div><div id="sd-chart-age-role" style="min-height:220px"></div></div>
			</div>
		`;
		runCountUps(el);

		var buckets = [
			{ label: '0-7d', min: 0, max: 7 },
			{ label: '8-14d', min: 8, max: 14 },
			{ label: '15-30d', min: 15, max: 30 },
			{ label: '31-60d', min: 31, max: 60 },
			{ label: '60d+', min: 61, max: Infinity },
		];
		var bucketCounts = buckets.map(function (b) {
			return ageDays.filter(function (n) { return n >= b.min && n <= b.max; }).length;
		});
		var agingChartEl = document.getElementById('sd-chart-aging');
		safeChart(agingChartEl, {
			type: 'bar', height: 220, colors: [WARN],
			data: { labels: buckets.map(function (b) { return b.label; }), datasets: [{ name: 'Applications', values: bucketCounts }] },
			barOptions: { spaceRatio: 0.3 },
		});
		bindBarClick(agingChartEl, function (i) {
			var b = buckets[i];
			var filters = { application_status: ['in', ACTIVE_STATUSES] };
			var upper = fmtDate(new Date(Date.now() - b.min * 86400000));
			if (b.max === Infinity) {
				filters.creation = ['<=', upper];
			} else {
				var lower = fmtDate(new Date(Date.now() - b.max * 86400000));
				filters.creation = ['between', [lower, upper]];
			}
			return { title: 'Aging: ' + b.label, filters: filters };
		});

		var roleAge = ROLES.map(function (role) {
			var days = activeRows.filter(function (r) { return r.role === role; }).map(function (r) { return daysSince(r.creation); }).filter(function (n) { return n !== null; });
			var a = avg(days);
			return a === null ? 0 : Math.round(a);
		});
		var ageRoleChartEl = document.getElementById('sd-chart-age-role');
		safeChart(ageRoleChartEl, {
			type: 'bar', height: 220, colors: [AC],
			data: { labels: ROLES, datasets: [{ name: 'Avg. Days', values: roleAge }] },
			barOptions: { spaceRatio: 0.3 },
		});
		bindBarClick(ageRoleChartEl, function (i) {
			return { title: ROLES[i] + ' — Active Pipeline', filters: { role: ROLES[i], application_status: ['in', ACTIVE_STATUSES] } };
		});
	}
};
