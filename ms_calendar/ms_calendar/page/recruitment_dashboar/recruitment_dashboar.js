frappe.pages['recruitment-dashboar'].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({ parent: wrapper, title: 'Recruitment Dashboard', single_column: true });

	// ── Design tokens ─────────────────────────────────────────────────────────
	const T1 = '#0f172a', T2 = '#64748b', T3 = '#94a3b8';
	const BG = '#f0f4ff', BORD = '#e2e8f0';
	const AC = '#1F497D', ACG = 'rgba(31,73,125,';

	// Per-unit color themes: Field=Indigo, Scholarship=Emerald, Philanthropy=Violet, Health=Rose
	const THEMES = [
		{ g1: '#1F497D', g2: '#2c7db8', g3: '#4a9fd4', rgb: '31,73,125', light: '#EBF3FB', dark: '#1F497D' },
		{ g1: '#2c7db8', g2: '#1F497D', g3: '#4a9fd4', rgb: '44,125,184', light: '#DDEBF7', dark: '#1a3d5c' },
		{ g1: '#1F497D', g2: '#2c7db8', g3: '#4a9fd4', rgb: '31,73,125', light: '#EBF3FB', dark: '#1F497D' },
		{ g1: '#2c7db8', g2: '#1F497D', g3: '#4a9fd4', rgb: '44,125,184', light: '#DDEBF7', dark: '#1a3d5c' },
	];

	// Status semantic type + colour map
	function sType(s) {
		const l = s.toLowerCase();
		if (/offer|joined|accept/.test(l)) return 'offer';
		if (/reject|blocklist|regret/.test(l)) return 'reject';
		if (/hold/.test(l)) return 'hold';
		if (/document|calibration/.test(l)) return 'doc';
		return 'pipe';
	}
	const SC = {
		offer: { bg: '#DDEBF7', txt: '#1F497D', brd: '#BDD7EE', dot: '#1F497D' },
		reject: { bg: '#DDEBF7', txt: '#1F497D', brd: '#BDD7EE', dot: '#1F497D' },
		hold: { bg: '#DDEBF7', txt: '#1F497D', brd: '#BDD7EE', dot: '#1F497D' },
		doc: { bg: '#DDEBF7', txt: '#1F497D', brd: '#BDD7EE', dot: '#1F497D' },
		pipe: { bg: '#DDEBF7', txt: '#1F497D', brd: '#BDD7EE', dot: '#1F497D' },
	};

	// Animate a number counter
	function countUp(el, target) {
		if (!el) return;
		const frames = 36, dur = 750;
		let cur = 0;
		const inc = Math.max(1, Math.ceil(target / frames));
		const t = setInterval(function () {
			cur = Math.min(cur + inc, target);
			el.textContent = cur.toLocaleString('en-IN');
			if (cur >= target) clearInterval(t);
		}, dur / frames);
	}

	const DATE_FILTERS = [
		{ label: 'All Time', key: 'all' },
		{ label: 'Today', key: 'today' },
		{ label: 'This Week', key: 'week' },
		{ label: 'This Month', key: 'month' },
		{ label: 'This Quarter', key: 'quarter' },
		{ label: 'This Year', key: 'year' },
		{ label: 'Custom Range', key: 'custom' },
	];
	let activeFilter = 'all', customFrom = '', customTo = '';

	// ── Unit config ───────────────────────────────────────────────────────────
	const UNITS = [
		{
			doctype: 'Field Registration Form',
			label: 'Field Recruitment', short: 'Field',
			icon: `<svg fill="none" stroke="#fff" stroke-width="2" viewBox="0 0 24 24" width="22" height="22"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
			desc: 'Ground-level field officers & educators',
			status_field: 'application_status',
			nameField: 'full_name_aadhaar',
			columns: [
				{ label: 'Full Name', field: 'full_name_aadhaar' },
				{ label: 'Email', field: 'email_address' },
				{ label: 'Phone', field: 'phone_number' },
				{ label: 'Role', field: 'role' },
				{ label: 'Location', field: 'location' },
				{ label: 'Gender', field: 'gender' },
				{ label: 'Education', field: 'highest_education' },
			],
			statuses: ['New Applicant', 'On Hold', 'Blocklisted', 'CV Shortlist', 'CV Reject', 'Online Test', 'Offline Test', 'Test Process', 'Recruiter Round', 'Recruiter Reject', 'Round One', 'Round 1 Reject', 'Round Two', 'Round 2 Reject', 'Round Three', 'Round 3 Reject', 'Calibration Process', 'Document Collection', 'Offer'],
			offerStatuses: ['Offer'],
			profileFields: [
				{
					section: 'Application', cols: [
						{ label: 'Status', field: 'application_status' },
						{ label: 'Role', field: 'role' },
						{ label: 'Location', field: 'location' },
						{ label: 'Department', field: 'department' },
						{ label: 'Shortlist Reason', field: 'reasons_for_shortlist' },
						{ label: 'Reject Reason', field: 'reasons_for_reject' },
						{ label: 'On Hold Reason', field: 'hold_reason' },
					]
				},
				{
					section: 'Personal Details', cols: [
						{ label: 'Full Name', field: 'full_name_aadhaar' },
						{ label: 'Email Address', field: 'email_address' },
						{ label: 'Phone', field: 'phone_number' },
						{ label: 'Alternate Phone', field: 'alternate_no' },
						{ label: 'Date of Birth', field: 'dob' },
						{ label: 'Age', field: 'age' },
						{ label: 'Gender', field: 'gender' },
						{ label: 'Native State', field: 'native_state' },
						{ label: 'Native District', field: 'native_district' },
					]
				},
				{
					section: 'Education & Experience', cols: [
						{ label: 'Highest Education', field: 'highest_education' },
						{ label: 'Teaching Exp. (Yrs)', field: 'teaching_year' },
						{ label: 'Teaching Exp. (Mo)', field: 'teaching_month' },
						{ label: 'Languages Known', field: 'languages_known' },
						{ label: 'Other Languages', field: 'other_languages' },
						{ label: 'Former APF Employee?', field: 'former_employee' },
						{ label: 'Source', field: 'opportunity' },
						{ label: 'Test Location', field: 'test_location' },
					]
				},
			],
		},
		{
			doctype: 'Scholarship Recruitment Form',
			label: 'Scholarship Recruitment', short: 'Scholarship',
			icon: `<svg fill="none" stroke="#fff" stroke-width="2" viewBox="0 0 24 24" width="22" height="22"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`,
			desc: 'Scholarship programme associates & resource persons',
			status_field: 'application_status',
			nameField: 'full_name_as_per_aadhar',
			columns: [
				{ label: 'Full Name', field: 'full_name_as_per_aadhar' },
				{ label: 'Email', field: 'email' },
				{ label: 'Phone', field: 'phone_number' },
				{ label: 'Role', field: 'role' },
				{ label: 'State', field: 'state_of_residence' },
				{ label: 'Gender', field: 'gender' },
				{ label: 'Education', field: 'highest_level_of_education' },
			],
			statuses: ['New Applicant', 'Application Reject', 'Test Process', 'Test Reject', 'Recruiter Round', 'Recruiter Reject', 'Round One', 'Round Two', 'Reject - Round 1', 'Reject - Round 2', 'Document Collection', 'Offer'],
			offerStatuses: ['Offer'],
			profileFields: [
				{
					section: 'Application', cols: [
						{ label: 'Status', field: 'application_status' },
						{ label: 'Role', field: 'role' },
					]
				},
				{
					section: 'Personal Details', cols: [
						{ label: 'Full Name', field: 'full_name_as_per_aadhar' },
						{ label: 'Email Address', field: 'email' },
						{ label: 'Phone', field: 'phone_number' },
						{ label: 'Gender', field: 'gender' },
						{ label: 'State of Residence', field: 'state_of_residence' },
					]
				},
				{
					section: 'Experience & Compensation', cols: [
						{ label: 'Total Experience (Yrs)', field: 'total_years_of_experience' },
						{ label: 'Current CTC', field: 'current_ctc' },
						{ label: 'Expected CTC', field: 'expected_ctc' },
						{ label: 'Willing to Relocate?', field: 'relocation' },
					]
				},
				{
					section: 'Education', cols: [
						{ label: 'Highest Education', field: 'highest_level_of_education' },
						{ label: 'Year of Completion', field: 'year_completion' },
					]
				},
			],
		},
		{
			doctype: 'Phil Registration Form',
			label: 'Philanthropy Recruitment', short: 'Philanthropy',
			icon: `<svg fill="none" stroke="#fff" stroke-width="2" viewBox="0 0 24 24" width="22" height="22"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
			desc: 'Philanthropy programme managers & resource persons',
			status_field: 'application_status',
			nameField: 'name1',
			columns: [
				{ label: 'Full Name', field: 'name1' },
				{ label: 'Email', field: 'email' },
				{ label: 'Phone', field: 'phone' },
				{ label: 'Role', field: 'role' },
				{ label: 'Location', field: 'location' },
				{ label: 'Geo', field: 'geo' },
				{ label: 'Education', field: 'highest_level_of_education' },
			],
			statuses: ['New Applicant', 'CV Shortlist', 'On Hold', 'CV Reject', 'Recruiter Round', 'Recruiter Reject', 'Round One', 'Round 1 Reject', 'Round Two', 'Round 2 Reject', 'Round Three', 'Round 3 Reject', 'Round Four', 'Round 4 Reject', 'Document Collection', 'Offer'],
			offerStatuses: ['Offer'],
			profileFields: [
				{
					section: 'Application', cols: [
						{ label: 'Status', field: 'application_status' },
						{ label: 'Role', field: 'role' },
						{ label: 'Geo', field: 'geo' },
						{ label: 'Theme', field: 'themes' },
						{ label: 'Position', field: 'position' },
						{ label: 'Location', field: 'location' },
					]
				},
				{
					section: 'Personal Details', cols: [
						{ label: 'Full Name', field: 'name1' },
						{ label: 'Email Address', field: 'email' },
						{ label: 'Phone', field: 'phone' },
						{ label: 'Date of Birth', field: 'date_of_birth' },
						{ label: 'Age', field: 'age' },
						{ label: 'Current Location', field: 'current_location' },
					]
				},
				{
					section: 'Education & Experience', cols: [
						{ label: 'Highest Education', field: 'highest_level_of_education' },
						{ label: 'Completion Year', field: 'completion_year' },
						{ label: 'Total Experience (Yrs)', field: 'total_experience' },
					]
				},
			],
		},
		{
			doctype: 'Health Registration Form',
			label: 'Health Fellowship', short: 'Health',
			icon: `<svg fill="none" stroke="#fff" stroke-width="2" viewBox="0 0 24 24" width="22" height="22"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
			desc: 'Health fellowship doctors & medical professionals',
			status_field: 'application_status',
			nameField: 'full_name',
			columns: [
				{ label: 'Full Name', field: 'full_name' },
				{ label: 'Email', field: 'email_address' },
				{ label: 'Phone', field: 'phone_number' },
				{ label: 'Education', field: 'education_qualification' },
				{ label: 'Experience', field: 'mbbs_experience' },
				{ label: 'State Council', field: 'state_medical_council' },
				{ label: 'Former APF?', field: 'foundation_selection' },
			],
			statuses: ['New Applicant', 'Shortlist - CV', 'On hold - CV', 'Regret - CV', 'Shortlist - R1', 'On hold - R1', 'Regret - R1', 'Shortlist - R2', 'On hold - R2', 'Regret - R2', 'Offered', 'Offer accepted', 'Offer declined', 'Joined', 'Document Collection', 'Offer'],
			offerStatuses: ['Offered', 'Offer accepted'],
			profileFields: [
				{
					section: 'Application', cols: [
						{ label: 'Status', field: 'application_status' },
						{ label: 'Former APF?', field: 'foundation_selection' },
					]
				},
				{
					section: 'Personal Details', cols: [
						{ label: 'Full Name', field: 'full_name' },
						{ label: 'Email Address', field: 'email_address' },
						{ label: 'Phone', field: 'phone_number' },
						{ label: 'Date of Birth', field: 'date_of_birth' },
						{ label: 'Age', field: 'age' },
						{ label: 'State', field: 'state' },
					]
				},
				{
					section: 'Medical Qualifications', cols: [
						{ label: 'Education Qualification', field: 'education_qualification' },
						{ label: 'MBBS Experience (Yrs)', field: 'mbbs_experience' },
						{ label: 'State Medical Council', field: 'state_medical_council' },
					]
				},
				{
					section: 'Preferences & Source', cols: [
						{ label: 'Monthly Salary', field: 'monthly_salary' },
						{ label: 'Preferred Location', field: 'first_prefered' },
						{ label: 'Open to Travel?', field: 'are_you_open' },
						{ label: 'Heard From', field: 'opportunity' },
					]
				},
			],
		},
	];

	// ── CSS ───────────────────────────────────────────────────────────────────
	const S = document.createElement('style');
	S.textContent = `
	.rd-wrap {
		background:${BG}; min-height:calc(100vh - 60px);
		margin:-15px -15px 0; padding:0 0 80px;
		font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
	}
	/* ── sticky nav ── */
	.rd-nav {
		display:flex; align-items:center; gap:10px;
		padding:11px 28px; background:#fff;
		border-bottom:1px solid ${BORD};
		box-shadow:0 1px 8px rgba(0,0,0,.06);
		position:sticky; top:0; z-index:100;
	}
	.rd-back {
		display:inline-flex; align-items:center; gap:6px;
		padding:6px 14px; border-radius:8px;
		background:${ACG}.08); border:1px solid ${ACG}.18);
		font-size:13px; font-weight:600; color:${AC};
		cursor:pointer; transition:all .15s; white-space:nowrap; flex-shrink:0;
	}
	.rd-back:hover { background:${AC}; color:#fff; border-color:${AC}; }
	.rd-crumb { font-size:13px; color:${T2}; }
	.rd-crumb b { color:${T1}; font-weight:700; }
	.rd-nav-sp { flex:1; }
	.rd-nav-date { font-size:12px; color:${T3}; flex-shrink:0; }
	/* ── header ── */
	.rd-header {
		padding:28px 32px 22px;
		background:#fff;
		border-bottom:1px solid ${BORD};
		box-shadow:0 2px 12px rgba(0,0,0,.04);
	}
	.rd-header-top {
		display:flex; align-items:center; justify-content:space-between;
		margin-bottom:20px; flex-wrap:wrap; gap:14px;
	}
	.rd-header-left { display:flex; flex-direction:column; gap:4px; }
	.rd-header-badge {
		display:inline-flex; align-items:center; gap:6px;
		font-size:10.5px; font-weight:700; letter-spacing:.09em;
		text-transform:uppercase; color:${T2};
	}
	.rd-pulse {
		width:7px; height:7px; border-radius:50%; background:#22c55e;
		box-shadow:0 0 0 0 rgba(34,197,94,.5);
		animation:rdpulse 2s infinite;
	}
	@keyframes rdpulse {
		0%   { box-shadow:0 0 0 0 rgba(34,197,94,.6); }
		70%  { box-shadow:0 0 0 7px rgba(34,197,94,0); }
		100% { box-shadow:0 0 0 0 rgba(34,197,94,0); }
	}
	.rd-header-title { font-size:26px; font-weight:900; color:${T1}; letter-spacing:-.015em; }
	/* ── header kpi chips ── */
	.rd-hkpis { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
	.rd-hkpi {
		display:flex; align-items:center; gap:11px;
		padding:10px 18px 10px 12px; border-radius:14px;
		background:#f8faff; border:1px solid ${BORD};
		transition:box-shadow .18s;
	}
	.rd-hkpi:hover { box-shadow:0 4px 14px rgba(0,0,0,.07); }
	.rd-hkpi-ico {
		width:40px; height:40px; border-radius:11px;
		display:flex; align-items:center; justify-content:center; flex-shrink:0;
	}
	.rd-hkpi-ico svg { width:18px; height:18px; }
	.rd-hkpi-body { display:flex; flex-direction:column; }
	.rd-hkpi-v { font-size:22px; font-weight:900; line-height:1; color:${T1}; }
	.rd-hkpi-k { font-size:10.5px; font-weight:600; color:${T2}; margin-top:2px; }
	/* ── segmented date filter ── */
	.rd-filter-row {
		display:inline-flex; align-items:center;
		background:#f1f5f9; border-radius:12px; padding:4px;
		border:1px solid ${BORD}; flex-wrap:wrap; gap:0;
	}
	.rd-fpill {
		padding:7px 15px; border-radius:9px;
		font-size:12px; font-weight:600;
		background:transparent; color:${T2};
		border:none; cursor:pointer; transition:all .15s; white-space:nowrap;
	}
	.rd-fpill:hover { color:${T1}; background:rgba(255,255,255,.65); }
	.rd-fpill.active { background:#fff; color:${T1}; box-shadow:0 2px 8px rgba(0,0,0,.09); }
	/* ── custom date row ── */
	.rd-cdate {
		display:none; align-items:center; gap:10px; margin-top:12px;
		padding:12px 16px; background:#f8faff;
		border:1px solid ${BORD}; border-radius:12px; flex-wrap:wrap;
	}
	.rd-cdate.show { display:flex; }
	.rd-cdate-lbl { font-size:11px; font-weight:700; color:${T2}; text-transform:uppercase; letter-spacing:.06em; }
	.rd-dinput {
		padding:7px 12px; border-radius:8px; font-size:12px; font-weight:500;
		background:#fff; border:1px solid ${BORD};
		color:${T1}; outline:none; cursor:pointer; transition:all .15s;
	}
	.rd-dinput::-webkit-calendar-picker-indicator { opacity:.45; cursor:pointer; }
	.rd-dinput:focus { border-color:${AC}; box-shadow:0 0 0 3px ${ACG}.08); }
	.rd-apply {
		padding:7px 18px; border-radius:8px; font-size:12px; font-weight:700;
		background:${AC}; color:#fff; border:none; cursor:pointer; transition:opacity .15s;
	}
	.rd-apply:hover { opacity:.85; }
	/* ── wave decoration on unit cards ── */
	.rd-ucard-wave {
		position:absolute; bottom:0; left:0; right:0; width:100%;
		height:60px; pointer-events:none;
	}
	/* ── page body ── */
	.rd-body { padding:28px 28px 0; }
	.rd-section-hdr {
		font-size:11px; font-weight:700; color:${T2};
		text-transform:uppercase; letter-spacing:.08em;
		margin:0 0 16px; display:flex; align-items:center; gap:10px;
	}
	.rd-section-hdr::after { content:''; flex:1; height:1px; background:${BORD}; }
	/* ── unit cards ── */
	.rd-units { display:grid; grid-template-columns:repeat(4,1fr); gap:18px; margin-bottom:32px; }
	.rd-ucard {
		border-radius:20px; padding:28px 30px;
		cursor:pointer; position:relative; overflow:hidden;
		transition:transform .22s cubic-bezier(.34,1.3,.64,1), box-shadow .22s;
	}
	.rd-ucard:hover { transform:translateY(-6px); }
	.rd-ucard-shine {
		position:absolute; top:-40%; left:-30%;
		width:50%; height:180%; transform:rotate(25deg);
		background:rgba(255,255,255,.07); pointer-events:none; transition:left .45s ease;
	}
	.rd-ucard:hover .rd-ucard-shine { left:130%; }
	.rd-ucard-top { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:16px; }
	.rd-ucard-icon {
		width:48px; height:48px; border-radius:14px;
		display:flex; align-items:center; justify-content:center;
		background:rgba(255,255,255,.18); border:1px solid rgba(255,255,255,.22);
	}
	.rd-ucard-num { font-size:46px; font-weight:900; color:#fff; line-height:1; text-shadow:0 2px 16px rgba(0,0,0,.2); }
	.rd-ucard-label { font-size:17px; font-weight:800; color:#fff; margin-bottom:5px; }
	.rd-ucard-desc  { font-size:12.5px; color:rgba(255,255,255,.65); margin-bottom:22px; line-height:1.5; }
	.rd-ucard-foot  { display:flex; align-items:center; justify-content:space-between; }
	.rd-ucard-pill  { font-size:11px; font-weight:700; padding:5px 14px; border-radius:20px; background:rgba(255,255,255,.18); color:#fff; border:1px solid rgba(255,255,255,.22); }
	.rd-ucard-arr {
		width:34px; height:34px; border-radius:10px;
		background:rgba(255,255,255,.18); color:#fff;
		display:flex; align-items:center; justify-content:center;
		font-size:16px; transition:background .18s, transform .18s;
		border:1px solid rgba(255,255,255,.22);
	}
	.rd-ucard:hover .rd-ucard-arr { background:rgba(255,255,255,.32); transform:translateX(4px); }
	/* decorative rings inside cards */
	.rd-ucard-ring1 {
		position:absolute; right:-35px; bottom:-35px;
		width:170px; height:170px; border-radius:50%;
		background:rgba(255,255,255,.07);
		border:1.5px solid rgba(255,255,255,.12);
		pointer-events:none;
	}
	.rd-ucard-ring2 {
		position:absolute; right:15px; bottom:-75px;
		width:110px; height:110px; border-radius:50%;
		background:rgba(255,255,255,.05);
		border:1px solid rgba(255,255,255,.09);
		pointer-events:none;
	}
	.rd-ucard-ring3 {
		position:absolute; left:-20px; top:-20px;
		width:80px; height:80px; border-radius:50%;
		background:rgba(255,255,255,.04);
		pointer-events:none;
	}
	/* number glow on load */
	@keyframes numGlow {
		0%   { text-shadow:0 0 0 rgba(255,255,255,0); }
		40%  { text-shadow:0 0 32px rgba(255,255,255,.5); }
		100% { text-shadow:0 2px 16px rgba(0,0,0,.2); }
	}
	.rd-ucard-num { animation:numGlow 1.2s ease-out forwards; }
	/* ── KPI strip ── */
	.rd-kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:24px; }
	.rd-kpi {
		background:#fff; border:1px solid ${BORD}; border-radius:14px;
		padding:20px 22px; display:flex; align-items:center; gap:14px;
		box-shadow:0 1px 4px rgba(0,0,0,.04); transition:all .2s;
	}
	.rd-kpi:hover { box-shadow:0 6px 20px rgba(0,0,0,.08); transform:translateY(-2px); }
	.rd-kpi-icon { width:46px; height:46px; border-radius:12px; flex-shrink:0; display:flex; align-items:center; justify-content:center; }
	.rd-kpi-icon svg { width:22px; height:22px; }
	.rd-kpi-body { flex:1; min-width:0; }
	.rd-kpi-v { font-size:30px; font-weight:900; line-height:1; margin-bottom:4px; }
	.rd-kpi-k { font-size:11.5px; font-weight:600; color:${T2}; margin-bottom:5px; }
	.rd-kpi-tag { font-size:10px; font-weight:700; padding:2px 9px; border-radius:10px; display:inline-block; }
	/* ── chart card ── */
	.rd-chart-card {
		background:#fff; border:1px solid ${BORD}; border-radius:14px;
		padding:22px 26px 18px; margin-bottom:24px;
		box-shadow:0 1px 4px rgba(0,0,0,.04);
	}
	.rd-chart-hdr { display:flex; align-items:baseline; justify-content:space-between; margin-bottom:18px; }
	.rd-chart-ttl { font-size:14px; font-weight:700; color:${T1}; }
	.rd-chart-sub { font-size:12px; color:${T2}; }
	/* ── status grid ── */
	.rd-sgrid { display:grid; grid-template-columns:repeat(6,1fr); gap:12px; margin-bottom:24px; }
	.rd-scard {
		background:#fff; border:1px solid ${BORD};
		border-left:3px solid transparent; border-radius:12px;
		padding:14px 16px; cursor:pointer;
		box-shadow:0 1px 3px rgba(0,0,0,.04); transition:all .18s;
	}
	.rd-scard:hover { transform:translateY(-2px); box-shadow:0 6px 18px rgba(0,0,0,.09); }
	.rd-scard.zero { opacity:.38; cursor:default; }
	.rd-scard.zero:hover { transform:none; box-shadow:0 1px 3px rgba(0,0,0,.04); }
	.rd-scard .sc-lbl { font-size:10px; font-weight:700; color:${T2}; text-transform:uppercase; letter-spacing:.05em; margin-bottom:8px; line-height:1.4; }
	.rd-scard .sc-num { font-size:32px; font-weight:900; line-height:1; }
	.rd-scard .sc-bar { height:3px; border-radius:2px; margin-top:10px; background:${BORD}; overflow:hidden; }
	.rd-scard .sc-fill { height:100%; border-radius:2px; width:0; transition:width 1.1s cubic-bezier(.4,0,.2,1); }
	/* ── records hero ── */
	.rd-rpg-hero {
		border-radius:16px; padding:26px 30px; margin-bottom:22px;
		position:relative; overflow:hidden;
	}
	.rd-rpg-hero::before {
		content:''; position:absolute; right:-40px; top:-40px;
		width:180px; height:180px; border-radius:50%;
		background:rgba(255,255,255,.07); pointer-events:none;
	}
	.rd-rpg-unit  { font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:rgba(255,255,255,.6); margin-bottom:6px; }
	.rd-rpg-title { font-size:24px; font-weight:900; color:#fff; margin-bottom:5px; }
	.rd-rpg-meta  { font-size:13px; color:rgba(255,255,255,.6); }
	.rd-rpg-big   { position:absolute; top:8px; right:26px; font-size:76px; font-weight:900; color:rgba(255,255,255,.07); line-height:1; pointer-events:none; }
	/* ── table card ── */
	.rd-tcard { background:#fff; border:1px solid ${BORD}; border-radius:14px; overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,.04); }
	.rd-toolbar { display:flex; align-items:center; gap:10px; padding:13px 18px; border-bottom:1px solid ${BORD}; flex-wrap:wrap; }
	.rd-tlabel { font-size:14px; font-weight:700; color:${T1}; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
	.rd-tcnt { font-size:12px; font-weight:700; padding:4px 12px; border-radius:20px; background:${ACG}.08); color:${AC}; border:1px solid ${ACG}.18); flex-shrink:0; }
	.rd-srch {
		padding:8px 14px; border:1px solid ${BORD}; border-radius:8px;
		font-size:13px; width:210px; outline:none; background:#fafbff; color:${T1};
		transition:border-color .18s, box-shadow .18s;
	}
	.rd-srch::placeholder { color:${T3}; }
	.rd-srch:focus { border-color:${AC}; box-shadow:0 0 0 3px ${ACG}.08); }
	.rd-export-btn {
		display:inline-flex; align-items:center; gap:6px;
		padding:7px 13px; border-radius:8px; font-size:12px; font-weight:700;
		background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0;
		cursor:pointer; transition:all .15s; white-space:nowrap; flex-shrink:0;
	}
	.rd-export-btn:hover { background:#dcfce7; border-color:#86efac; }
	.rd-tbody-wrap { overflow-x:auto; max-height:540px; overflow-y:auto; }
	.rd-tfoot { display:flex; align-items:center; justify-content:space-between; padding:11px 18px; border-top:1px solid ${BORD}; font-size:12px; color:${T2}; background:#fafbff; }
	/* ── profile page ── */
	.rdp-hero {
		border-radius:16px; margin-bottom:16px;
		display:flex; flex-direction:column;
		position:relative; overflow:hidden;
	}
	.rdp-hero::before {
		content:''; position:absolute; right:-60px; top:-60px;
		width:260px; height:260px; border-radius:50%;
		background:rgba(255,255,255,.08); filter:blur(28px); pointer-events:none;
	}
	.rdp-hero::after {
		content:''; position:absolute; left:-40px; bottom:-60px;
		width:200px; height:200px; border-radius:50%;
		background:rgba(255,255,255,.05); filter:blur(22px); pointer-events:none;
	}
	.rdp-hero-top {
		display:flex; align-items:flex-start; gap:22px;
		padding:28px 30px 20px; position:relative; z-index:1;
	}
	.rdp-avatar {
		width:76px; height:76px; border-radius:20px; flex-shrink:0;
		background:rgba(255,255,255,.2); border:2.5px solid rgba(255,255,255,.32);
		color:#fff; display:flex; align-items:center; justify-content:center;
		font-size:30px; font-weight:900; letter-spacing:-.02em;
		box-shadow:0 4px 16px rgba(0,0,0,.16);
	}
	.rdp-info { flex:1; min-width:0; }
	.rdp-name { font-size:26px; font-weight:900; color:#fff; margin-bottom:3px; letter-spacing:-.01em; }
	.rdp-id   { font-size:11.5px; color:rgba(255,255,255,.5); margin-bottom:12px; font-family:monospace; letter-spacing:.06em; }
	.rdp-badges { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
	.rdp-badge { padding:5px 14px; border-radius:20px; font-size:12px; font-weight:700; border:1px solid; display:inline-block; }
	.rdp-badge-unit { background:rgba(255,255,255,.14); color:#fff; border-color:rgba(255,255,255,.22); font-size:11px; }
	.rdp-open-btn {
		display:inline-flex; align-items:center; gap:6px; flex-shrink:0; margin-top:4px;
		padding:9px 17px; border-radius:10px; font-size:12px; font-weight:700;
		background:rgba(255,255,255,.14); color:#fff; border:1px solid rgba(255,255,255,.28);
		cursor:pointer; transition:all .15s; text-decoration:none;
	}
	.rdp-open-btn:hover { background:rgba(255,255,255,.26); }
	.rdp-hero-divider { height:1px; background:rgba(255,255,255,.1); margin:0 30px; position:relative; z-index:1; }
	.rdp-chips {
		display:flex; align-items:center; gap:10px; flex-wrap:wrap;
		padding:16px 30px 24px; position:relative; z-index:1;
	}
	.rdp-chip {
		display:inline-flex; align-items:center; gap:7px;
		padding:7px 14px; border-radius:8px;
		background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.16);
		color:rgba(255,255,255,.88); font-size:12.5px; font-weight:500; white-space:nowrap;
	}
	.rdp-chip.clickable { cursor:pointer; transition:all .14s; }
	.rdp-chip.clickable:hover { background:rgba(255,255,255,.22); border-color:rgba(255,255,255,.3); color:#fff; }
	.rdp-chip a { color:inherit; text-decoration:none; }
	.rdp-chip-ico { opacity:.7; display:flex; align-items:center; flex-shrink:0; }
	/* pipeline card */
	.rdp-pipeline {
		background:#fff; border:1px solid ${BORD}; border-radius:14px;
		padding:18px 22px; margin-bottom:14px;
		box-shadow:0 1px 4px rgba(0,0,0,.04);
	}
	.rdp-pipeline-top { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
	.rdp-pipeline-ttl { font-size:11px; font-weight:700; color:${T2}; text-transform:uppercase; letter-spacing:.07em; }
	.rdp-pipeline-pct { font-size:13px; font-weight:800; color:${AC}; }
	.rdp-pbar { height:7px; border-radius:4px; background:${BORD}; overflow:hidden; margin-bottom:12px; }
	.rdp-pbar-fill { height:100%; border-radius:4px; transition:width 1.2s cubic-bezier(.4,0,.2,1); width:0; }
	.rdp-pipeline-status { display:flex; align-items:center; gap:8px; }
	.rdp-pipeline-dot { width:9px; height:9px; border-radius:50%; flex-shrink:0; }
	.rdp-pipeline-lbl { font-size:14px; font-weight:800; color:${T1}; }
	.rdp-pipeline-of  { font-size:11.5px; color:${T2}; font-weight:500; }
	/* sections */
	.rdp-sections { display:flex; flex-direction:column; gap:14px; }
	.rdp-section { background:#fff; border:1px solid ${BORD}; border-radius:14px; overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,.04); }
	.rdp-sec-hdr { padding:13px 22px; background:#fafbff; border-bottom:1px solid ${BORD}; display:flex; align-items:center; gap:10px; }
	.rdp-sec-dot { width:8px; height:8px; border-radius:3px; background:${AC}; flex-shrink:0; }
	.rdp-sec-ttl { font-size:11.5px; font-weight:700; color:${AC}; text-transform:uppercase; letter-spacing:.07em; }
	.rdp-fields { display:grid; grid-template-columns:repeat(4,1fr); }
	.rdp-field { padding:16px 22px; border-bottom:1px solid ${BORD}; border-right:1px solid ${BORD}; transition:background .12s; }
	.rdp-field:nth-child(4n) { border-right:none; }
	.rdp-field:hover { background:#f8faff; }
	.rdp-field-lbl { font-size:10px; font-weight:800; color:${T3}; text-transform:uppercase; letter-spacing:.08em; margin-bottom:6px; }
	.rdp-field-val { font-size:15px; font-weight:700; color:${T1}; word-break:break-word; line-height:1.4; }
	.rdp-empty   { padding:48px; text-align:center; color:${T2}; font-size:14px; }
	.rdp-loading { padding:60px; text-align:center; color:${T2}; font-size:13px; }
	/* ── shared table ── */
	.rd-tbl { width:100%; border-collapse:collapse; font-size:13.5px; }
	.rd-tbl thead tr { position:sticky; top:0; z-index:2; background:#f8faff; }
	.rd-tbl th { padding:11px 14px; text-align:left; font-size:10.5px; font-weight:700; color:${T2}; text-transform:uppercase; letter-spacing:.05em; border-bottom:1px solid ${BORD}; white-space:nowrap; }
	.rd-tbl tbody tr { cursor:pointer; transition:background .1s; }
	.rd-tbl tbody tr:hover { background:${ACG}.05); }
	.rd-tbl tbody tr:hover .rd-tname { text-decoration:underline; }
	.rd-tbl td { padding:11px 14px; color:${T1}; border-bottom:1px solid ${BORD}; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
	.rd-tbl tbody tr:last-child td { border-bottom:none; }
	.rd-tsno  { color:${T3}; font-size:11px; width:40px; text-align:center; }
	.rd-tid   { font-family:monospace; font-size:11px; color:${T3}; }
	.rd-tname { font-weight:600; color:${AC}; }
	.rd-spill { display:inline-block; padding:3px 10px; border-radius:20px; font-size:10.5px; font-weight:700; border:1px solid; white-space:nowrap; }
	.rd-nodata { padding:60px; text-align:center; color:${T2}; font-size:14px; }
	`;
	document.head.appendChild(S);

	// ── DOM shell ─────────────────────────────────────────────────────────────
	$(wrapper).find('.page-content').append(`
		<div class="rd-wrap">
			<div id="rd-front"></div>
			<div id="rd-detail"  style="display:none"></div>
			<div id="rd-records" style="display:none"></div>
			<div id="rd-profile" style="display:none"></div>
		</div>
	`);

	const $front = $('#rd-front');
	const $detail = $('#rd-detail');
	const $records = $('#rd-records');
	const $profile = $('#rd-profile');
	const store = {};

	function fmtDate() {
		return new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
	}

	// ── Date filtering ────────────────────────────────────────────────────────
	function filterByDate(rows, key) {
		if (key === 'all') return rows;
		const now = new Date();
		let start, end;
		if (key === 'custom') {
			if (!customFrom && !customTo) return rows;
			start = customFrom ? new Date(customFrom) : null;
			end = customTo ? new Date(customTo + 'T23:59:59') : null;
			return rows.filter(function (r) {
				if (!r.creation) return false;
				const d = new Date(r.creation);
				return (!start || d >= start) && (!end || d <= end);
			});
		}
		if (key === 'today') {
			start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		} else if (key === 'week') {
			start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
		} else if (key === 'month') {
			start = new Date(now.getFullYear(), now.getMonth(), 1);
		} else if (key === 'quarter') {
			start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
		} else {
			start = new Date(now.getFullYear(), 0, 1);
		}
		return rows.filter(function (r) { return r.creation && new Date(r.creation) >= start; });
	}

	function getFilteredData(ui) {
		if (!store[ui]) return { rows: [], counts: {} };
		const rows = filterByDate(store[ui].rows, activeFilter);
		const counts = {};
		rows.forEach(function (r) {
			const s = r[UNITS[ui].status_field] || 'New Applicant';
			counts[s] = (counts[s] || 0) + 1;
		});
		return { rows, counts };
	}

	function updateFrontStats() {
		let total = 0, offers = 0;
		UNITS.forEach(function (unit, ui) {
			if (!store[ui]) return;
			const { rows, counts } = getFilteredData(ui);
			const el = document.getElementById('unum-' + ui);
			if (el) countUp(el, rows.length);
			total += rows.length;
			offers += unit.offerStatuses.reduce(function (s, st) { return s + (counts[st] || 0); }, 0);
		});
		const totalEl = document.getElementById('gs-total');
		const offerEl = document.getElementById('gs-offers');
		const convEl = document.getElementById('gs-conv');
		if (totalEl) countUp(totalEl, total);
		if (offerEl) countUp(offerEl, offers);
		if (convEl) convEl.textContent = total > 0 ? (offers / total * 100).toFixed(1) + '%' : '—';
	}

	// ── Front page ────────────────────────────────────────────────────────────
	const CARD_WAVES = [
		'<path d="M0,35 C50,15 100,50 150,30 C185,15 210,38 240,25 L240,70 L0,70 Z" fill="rgba(255,255,255,.15)"/><path d="M0,48 C40,36 90,55 145,44 C178,36 205,50 240,44 L240,70 L0,70 Z" fill="rgba(255,255,255,.08)"/>',
		'<path d="M0,30 C55,46 95,18 148,36 C180,48 210,26 240,32 L240,70 L0,70 Z" fill="rgba(255,255,255,.15)"/><path d="M0,46 C48,38 88,54 140,45 C172,38 206,50 240,46 L240,70 L0,70 Z" fill="rgba(255,255,255,.08)"/>',
		'<path d="M0,28 C60,44 100,16 150,34 C182,46 210,24 240,30 L240,70 L0,70 Z" fill="rgba(255,255,255,.15)"/><path d="M0,44 C52,36 90,52 144,42 C174,34 206,48 240,44 L240,70 L0,70 Z" fill="rgba(255,255,255,.08)"/>',
		'<path d="M0,33 C48,17 92,48 144,28 C178,14 208,40 240,26 L240,70 L0,70 Z" fill="rgba(255,255,255,.15)"/><path d="M0,47 C44,37 88,56 140,46 C170,38 202,52 240,47 L240,70 L0,70 Z" fill="rgba(255,255,255,.08)"/>',
	];

	$front.html(`
		<div class="rd-header">
			<div class="rd-header-top">
				<div class="rd-header-left">
					<div class="rd-header-badge">
						<span class="rd-pulse"></span>
						Azim Premji Foundation &mdash; Recruitment HQ
					</div>
					<div class="rd-header-title">Recruitment Dashboard</div>
				</div>
				<div class="rd-hkpis">
					<div class="rd-hkpi">
						<div class="rd-hkpi-ico" style="background:#DDEBF7">
							<svg fill="none" stroke="#1F497D" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
						</div>
						<div class="rd-hkpi-body">
							<div class="rd-hkpi-v" id="gs-total">—</div>
							<div class="rd-hkpi-k">Total Applicants</div>
						</div>
					</div>
					<div class="rd-hkpi">
						<div class="rd-hkpi-ico" style="background:#DDEBF7">
							<svg fill="none" stroke="#1F497D" stroke-width="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
						</div>
						<div class="rd-hkpi-body">
							<div class="rd-hkpi-v" id="gs-offers">—</div>
							<div class="rd-hkpi-k">Total Offers</div>
						</div>
					</div>
					<div class="rd-hkpi">
						<div class="rd-hkpi-ico" style="background:#DDEBF7">
							<svg fill="none" stroke="#1F497D" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>
						</div>
						<div class="rd-hkpi-body">
							<div class="rd-hkpi-v" id="gs-conv">—</div>
							<div class="rd-hkpi-k">Offer Rate</div>
						</div>
					</div>
					<div class="rd-hkpi">
						<div class="rd-hkpi-ico" style="background:#DDEBF7">
							<svg fill="none" stroke="#1F497D" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>
						</div>
						<div class="rd-hkpi-body">
							<div class="rd-hkpi-v">4</div>
							<div class="rd-hkpi-k">Active Units</div>
						</div>
					</div>
				</div>
			</div>
			<div class="rd-filter-row">
				${DATE_FILTERS.map(function (f) {
		return '<button class="rd-fpill' + (f.key === 'all' ? ' active' : '') + '" data-key="' + f.key + '">' + f.label + '</button>';
	}).join('')}
			</div>
			<div class="rd-cdate" id="rd-cdate">
				<span class="rd-cdate-lbl">From</span>
				<input type="date" class="rd-dinput" id="rd-from" />
				<span class="rd-cdate-lbl">To</span>
				<input type="date" class="rd-dinput" id="rd-to" />
				<button class="rd-apply" id="rd-apply-custom">Apply</button>
			</div>
		</div>
		<div class="rd-body">
			<div class="rd-section-hdr">Recruitment Units</div>
			<div class="rd-units">
				${UNITS.map(function (u, i) {
		const th = THEMES[i];
		return '<div class="rd-ucard" data-ui="' + i + '" style="background:linear-gradient(140deg,' + th.g1 + ' 0%,' + th.g2 + ' 55%,' + th.g3 + ' 100%);box-shadow:0 14px 44px rgba(' + th.rgb + ',.42)">' +
			'<div class="rd-ucard-shine"></div>' +
			'<div class="rd-ucard-ring1"></div>' +
			'<div class="rd-ucard-ring2"></div>' +
			'<div class="rd-ucard-ring3"></div>' +
			'<div class="rd-ucard-top">' +
			'<div class="rd-ucard-icon">' + u.icon + '</div>' +
			'<div class="rd-ucard-num" id="unum-' + i + '">—</div>' +
			'</div>' +
			'<div class="rd-ucard-label">' + u.label + '</div>' +
			'<div class="rd-ucard-desc">' + u.desc + '</div>' +
			'<div class="rd-ucard-foot">' +
			'<span class="rd-ucard-pill">View Pipeline</span>' +
			'<span class="rd-ucard-arr">&#8594;</span>' +
			'</div>' +
			'<svg class="rd-ucard-wave" viewBox="0 0 240 70" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' + CARD_WAVES[i] + '</svg>' +
			'</div>';
	}).join('')}
			</div>
		</div>
	`);

	$front.on('click', '.rd-ucard', function () {
		showDetail(parseInt($(this).data('ui')));
	});
	$front.on('click', '.rd-fpill', function () {
		activeFilter = $(this).data('key');
		$front.find('.rd-fpill').removeClass('active');
		$(this).addClass('active');
		if (activeFilter === 'custom') {
			$('#rd-cdate').addClass('show');
		} else {
			$('#rd-cdate').removeClass('show');
			customFrom = ''; customTo = '';
			updateFrontStats();
		}
	});
	$front.on('click', '#rd-apply-custom', function () {
		customFrom = $('#rd-from').val();
		customTo = $('#rd-to').val();
		updateFrontStats();
	});

	// ── Fetch all units ───────────────────────────────────────────────────────
	UNITS.forEach(function (unit, ui) {
		const fields = ['name', 'creation', unit.status_field].concat(
			unit.columns.map(function (c) { return c.field; })
		);
		frappe.call({
			method: 'frappe.client.get_list',
			args: { doctype: unit.doctype, fields: fields, filters: [['name', '!=', '']], limit_page_length: 0 },
			callback: function (r) {
				store[ui] = { rows: r && r.message ? r.message : [] };
				updateFrontStats();
			}
		});
	});

	// ── Detail page ───────────────────────────────────────────────────────────
	function showDetail(ui) {
		const unit = UNITS[ui];
		const th = THEMES[ui];
		if (!store[ui]) { frappe.msgprint('Data still loading, please wait.'); return; }

		const { rows, counts } = getFilteredData(ui);
		const total = rows.length;
		const RW = ['reject', 'blocklist', 'regret'];
		const offered = unit.offerStatuses.reduce(function (s, st) { return s + (counts[st] || 0); }, 0);
		const docColl = counts['Document Collection'] || 0;
		let rejected = 0;
		Object.keys(counts).forEach(function (s) {
			if (RW.some(function (w) { return s.toLowerCase().includes(w); })) rejected += counts[s];
		});
		const pipeline = Math.max(0, total - offered - docColl - rejected);
		const convRate = total > 0 ? (offered / total * 100).toFixed(1) + '%' : '—';
		const rejRate = total > 0 ? (rejected / total * 100).toFixed(1) + '%' : '—';
		const pipeRate = total > 0 ? (pipeline / total * 100).toFixed(1) + '%' : '—';

		$front.hide();
		$detail.show().html(`
			<div class="rd-nav">
				<button class="rd-back" id="rd-back">
					<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
					Dashboard
				</button>
				<span class="rd-crumb">Recruitment &rsaquo; <b>${unit.label}</b></span>
				<span class="rd-nav-sp"></span>
				<span class="rd-nav-date">${fmtDate()}</span>
			</div>
			<div class="rd-body">
				<div class="rd-kpis">
					<div class="rd-kpi" id="rd-kpi-total" style="cursor:pointer" title="Click to view all applicants">
						<div class="rd-kpi-icon" style="background:linear-gradient(135deg,${th.g1},${th.g2},${th.g3})">
							<svg fill="none" stroke="#fff" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
						</div>
						<div class="rd-kpi-body">
							<div class="rd-kpi-v" id="kv-total" style="color:${th.g1}">0</div>
							<div class="rd-kpi-k">Total Applicants</div>
							<div class="rd-kpi-tag" style="background:${th.light};color:${th.dark}">View all &rarr;</div>
						</div>
					</div>
					<div class="rd-kpi">
						<div class="rd-kpi-icon" style="background:linear-gradient(135deg,#1F497D,#2c7db8)">
							<svg fill="none" stroke="#fff" stroke-width="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
						</div>
						<div class="rd-kpi-body">
							<div class="rd-kpi-v" id="kv-offered" style="color:#1F497D">0</div>
							<div class="rd-kpi-k">Offered</div>
							<div class="rd-kpi-tag" style="background:#DDEBF7;color:#1F497D">${convRate} offer rate</div>
						</div>
					</div>
					<div class="rd-kpi">
						<div class="rd-kpi-icon" style="background:linear-gradient(135deg,#1F497D,#2c7db8)">
							<svg fill="none" stroke="#fff" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
						</div>
						<div class="rd-kpi-body">
							<div class="rd-kpi-v" id="kv-rejected" style="color:#1F497D">0</div>
							<div class="rd-kpi-k">Rejected</div>
							<div class="rd-kpi-tag" style="background:#DDEBF7;color:#1F497D">${rejRate} of total</div>
						</div>
					</div>
					<div class="rd-kpi">
						<div class="rd-kpi-icon" style="background:linear-gradient(135deg,#1F497D,#2c7db8)">
							<svg fill="none" stroke="#fff" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>
						</div>
						<div class="rd-kpi-body">
							<div class="rd-kpi-v" id="kv-pipeline" style="color:#1F497D">0</div>
							<div class="rd-kpi-k">In Pipeline</div>
							<div class="rd-kpi-tag" style="background:#DDEBF7;color:#1F497D">${pipeRate} active</div>
						</div>
					</div>
				</div>
				<div class="rd-chart-card">
					<div class="rd-chart-hdr">
						<div class="rd-chart-ttl">Applicants by Status</div>
						<div class="rd-chart-sub">Click a bar to view records for that status</div>
					</div>
					<div id="rd-bar"></div>
				</div>
				<div class="rd-section-hdr" style="margin-bottom:14px">Status Breakdown — click any card to open records</div>
				<div class="rd-sgrid" id="rd-sgrid">
					${unit.statuses.map(function (s) {
			const cnt = counts[s] || 0;
			const col = SC[sType(s)];
			const pct = total > 0 ? Math.round(cnt / total * 100) : 0;
			return '<div class="rd-scard' + (cnt === 0 ? ' zero' : '') + '" data-status="' + s + '" style="border-left-color:' + col.dot + '">' +
				'<div class="sc-lbl">' + s + '</div>' +
				'<div class="sc-num" style="color:' + col.dot + '">' + cnt + '</div>' +
				'<div class="sc-bar"><div class="sc-fill" style="background:' + col.dot + '" data-pct="' + pct + '"></div></div>' +
				'</div>';
		}).join('')}
				</div>
			</div>
		`);

		// animate KPIs + progress bars
		setTimeout(function () {
			countUp(document.getElementById('kv-total'), total);
			countUp(document.getElementById('kv-offered'), offered);
			countUp(document.getElementById('kv-rejected'), rejected);
			countUp(document.getElementById('kv-pipeline'), pipeline);
			document.querySelectorAll('.sc-fill').forEach(function (el) {
				requestAnimationFrame(function () { el.style.width = el.dataset.pct + '%'; });
			});
			drawChart(unit, counts, rows, th);
		}, 120);

		$detail.find('#rd-back').on('click', function () { $detail.hide(); $front.show(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
		$detail.find('#rd-sgrid').on('click', '.rd-scard:not(.zero)', function () {
			showRecords(unit, rows, $(this).data('status'), th);
		});
		$detail.find('#rd-kpi-total').on('click', function () {
			showRecords(unit, rows, null, th);
		});
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	// ── Records page ──────────────────────────────────────────────────────────
	function showRecords(unit, allRows, status, th) {
		const thm = th || THEMES[0];
		const isAll = status === null;
		const filtered = isAll ? allRows : allRows.filter(function (r) {
			return (r[unit.status_field] || 'New Applicant') === status;
		});
		const titleLabel = isAll ? 'All Applicants' : status;

		$detail.hide();
		$records.show().html(`
			<div class="rd-nav">
				<button class="rd-back" id="rp-back">
					<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
					${unit.short}
				</button>
				<span class="rd-crumb">Recruitment &rsaquo; <b>${unit.label}</b> &rsaquo; <b>${titleLabel}</b></span>
				<span class="rd-nav-sp"></span>
				<span class="rd-nav-date">${fmtDate()}</span>
			</div>
			<div class="rd-body">
				<div class="rd-rpg-hero" style="background:linear-gradient(140deg,${thm.g1} 0%,${thm.g2} 55%,${thm.g3} 100%);box-shadow:0 12px 40px rgba(${thm.rgb},.38)">
					<div class="rd-rpg-unit">${unit.label}</div>
					<div class="rd-rpg-title">${titleLabel}</div>
					<div class="rd-rpg-meta">${filtered.length.toLocaleString('en-IN')} applicant${filtered.length !== 1 ? 's' : ''} in this stage</div>
					<div class="rd-rpg-big">${filtered.length}</div>
				</div>
				<div class="rd-tcard">
					<div class="rd-toolbar">
						<span class="rd-tlabel">${titleLabel}</span>
						<span class="rd-tcnt" id="rp-cnt">${filtered.length} applicants</span>
						<input class="rd-srch" type="text" placeholder="Search name, email, phone…" id="rp-srch" />
						<button class="rd-export-btn" id="rp-export">
							<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
							Export CSV
						</button>
					</div>
					<div class="rd-tbody-wrap" id="rp-body">${buildTable(unit, filtered)}</div>
					<div class="rd-tfoot">
						<span id="rp-foot">Showing ${filtered.length} of ${filtered.length} records</span>
						<span>Click any row to open applicant profile</span>
					</div>
				</div>
			</div>
		`);

		$records.find('#rp-back').on('click', function () {
			$records.hide(); $detail.show();
			window.scrollTo({ top: 0, behavior: 'smooth' });
		});
		$records.find('#rp-srch').on('input', function () {
			const q = $(this).val().toLowerCase().trim();
			const f = q ? filtered.filter(function (r) {
				return unit.columns.some(function (c) { return (r[c.field] || '').toLowerCase().includes(q); });
			}) : filtered;
			$records.find('#rp-body').html(buildTable(unit, f));
			$records.find('#rp-cnt').text(f.length + ' applicants');
			$records.find('#rp-foot').text('Showing ' + f.length + ' of ' + filtered.length + ' records');
		});
		$records.find('#rp-export').on('click', function () {
			exportCSV(unit, filtered, titleLabel);
		});
		$records.off('click', '.rd-tbl tbody tr').on('click', '.rd-tbl tbody tr', function () {
			const name = $(this).data('name');
			if (name) showProfile(unit, name, titleLabel, thm);
		});
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	// ── Profile page ──────────────────────────────────────────────────────────
	function showProfile(unit, docName, status, th) {
		const thm = th || THEMES[0];
		$records.hide();
		$profile.show().html(`
			<div class="rd-nav">
				<button class="rd-back" id="rpp-back">
					<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
					${status}
				</button>
				<span class="rd-crumb">Recruitment &rsaquo; <b>${unit.label}</b> &rsaquo; <b>${status}</b> &rsaquo; <b>${docName}</b></span>
				<span class="rd-nav-sp"></span>
				<span class="rd-nav-date">${fmtDate()}</span>
			</div>
			<div class="rd-body"><div class="rdp-loading">Loading applicant profile…</div></div>
		`);
		$profile.find('#rpp-back').on('click', function () {
			$profile.hide(); $records.show();
			window.scrollTo({ top: 0, behavior: 'smooth' });
		});

		frappe.call({
			method: 'frappe.client.get',
			args: { doctype: unit.doctype, name: docName },
			callback: function (r) {
				if (!r || !r.message) {
					$profile.find('.rdp-loading').text('Could not load applicant data.');
					return;
				}
				const doc = r.message;
				const displayName = doc[unit.nameField] || docName;
				const initial = (displayName || '?').trim()[0].toUpperCase();
				const RW = ['reject', 'blocklist', 'regret'];
				const isOffer = unit.offerStatuses.includes(status);
				const isReject = RW.some(function (w) { return status.toLowerCase().includes(w); });
				const isHold = status.toLowerCase().includes('hold');
				const sc = isOffer ? SC.offer : isReject ? SC.reject : isHold ? SC.hold : SC.pipe;

				// Pipeline stage progress
				const stIdx = unit.statuses.indexOf(status);
				const stPct = stIdx >= 0 ? Math.round((stIdx + 1) / unit.statuses.length * 100) : 0;
				const stCol = sc.dot;

				// Smart contact & info chips
				const chipDefs = [
					{ ico: '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>', keys: ['email_address', 'email'], href: 'mailto:' },
					{ ico: '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.22h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.09 6.09l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>', keys: ['phone_number', 'phone'], href: 'tel:' },
					{ ico: '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>', keys: ['gender'], href: null },
					{ ico: '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>', keys: ['age'], href: null, suffix: ' yrs' },
					{ ico: '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>', keys: ['state', 'native_state', 'state_of_residence', 'current_location', 'location'], href: null },
					{ ico: '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/></svg>', keys: ['highest_education', 'highest_level_of_education', 'education_qualification'], href: null },
				];
				let chipsHtml = '';
				chipDefs.forEach(function (cd) {
					let val = null;
					cd.keys.forEach(function (k) { if (!val && doc[k]) val = String(doc[k]); });
					if (!val) return;
					const display = cd.suffix ? val + cd.suffix : val;
					const inner = cd.href
						? '<a href="' + cd.href + val + '" style="color:inherit;text-decoration:none">' + display + '</a>'
						: display;
					chipsHtml += '<div class="rdp-chip' + (cd.href ? ' clickable' : '') + '">' +
						'<span class="rdp-chip-ico">' + cd.ico + '</span>' + inner +
						'</div>';
				});

				// Section cards
				const sectionsHtml = unit.profileFields.map(function (sec) {
					const fh = sec.cols.map(function (f) {
						const v = doc[f.field];
						if (v === null || v === undefined || v === '') return '';
						return '<div class="rdp-field"><div class="rdp-field-lbl">' + f.label + '</div><div class="rdp-field-val">' + v + '</div></div>';
					}).join('');
					if (!fh) return '';
					return '<div class="rdp-section">' +
						'<div class="rdp-sec-hdr"><div class="rdp-sec-dot"></div><div class="rdp-sec-ttl">' + sec.section + '</div></div>' +
						'<div class="rdp-fields">' + fh + '</div>' +
						'</div>';
				}).join('');

				const frappePath = '/app/' + unit.doctype.toLowerCase().replace(/ /g, '-') + '/' + encodeURIComponent(docName);

				$profile.html(`
					<div class="rd-nav">
						<button class="rd-back" id="rpp-back2">
							<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
							${status}
						</button>
						<span class="rd-crumb">Recruitment &rsaquo; <b>${unit.label}</b> &rsaquo; <b>${status}</b> &rsaquo; <b>${displayName}</b></span>
						<span class="rd-nav-sp"></span>
						<span class="rd-nav-date">${fmtDate()}</span>
					</div>
					<div class="rd-body">
						<div class="rdp-hero" style="background:linear-gradient(140deg,${thm.g1} 0%,${thm.g2} 55%,${thm.g3} 100%);box-shadow:0 12px 40px rgba(${thm.rgb},.38)">
							<div class="rdp-hero-top">
								<div class="rdp-avatar">${initial}</div>
								<div class="rdp-info">
									<div class="rdp-name">${displayName}</div>
									<div class="rdp-id">${docName}</div>
									<div class="rdp-badges">
										<span class="rdp-badge" style="background:${sc.bg};color:${sc.txt};border-color:${sc.brd}">${status}</span>
										<span class="rdp-badge rdp-badge-unit">${unit.label}</span>
									</div>
								</div>
								<a class="rdp-open-btn" href="${frappePath}" target="_blank">
									<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
									Open in Frappe
								</a>
							</div>
							${chipsHtml ? '<div class="rdp-hero-divider"></div><div class="rdp-chips">' + chipsHtml + '</div>' : ''}
						</div>
						<div class="rdp-pipeline">
							<div class="rdp-pipeline-top">
								<div class="rdp-pipeline-ttl">Recruitment Pipeline Progress</div>
								<div class="rdp-pipeline-pct">${stPct}% complete — Step ${Math.max(stIdx + 1, 1)} of ${unit.statuses.length}</div>
							</div>
							<div class="rdp-pbar">
								<div class="rdp-pbar-fill" style="background:${stCol}" data-pct="${stPct}"></div>
							</div>
							<div class="rdp-pipeline-status">
								<div class="rdp-pipeline-dot" style="background:${stCol}"></div>
								<span class="rdp-pipeline-lbl">${status}</span>
								<span class="rdp-pipeline-of">&nbsp;— currently at this stage</span>
							</div>
						</div>
						<div class="rdp-sections">${sectionsHtml || '<div class="rdp-empty">No additional data available for this applicant.</div>'}</div>
					</div>
				`);
				$profile.find('#rpp-back2').on('click', function () {
					$profile.hide(); $records.show();
					window.scrollTo({ top: 0, behavior: 'smooth' });
				});
				setTimeout(function () {
					const fill = document.querySelector('.rdp-pbar-fill');
					if (fill) fill.style.width = fill.dataset.pct + '%';
				}, 120);
				window.scrollTo({ top: 0, behavior: 'smooth' });
			}
		});
	}

	// ── Bar chart ─────────────────────────────────────────────────────────────
	function drawChart(unit, counts, allRows, th) {
		const labels = unit.statuses.filter(function (s) { return (counts[s] || 0) > 0; });
		const values = labels.map(function (s) { return counts[s]; });
		const barEl = document.getElementById('rd-bar');
		if (!barEl || !labels.length) return;
		try {
			new frappe.Chart(barEl, {
				type: 'bar', height: 240,
				colors: [th ? th.g1 : AC],
				data: { labels: labels, datasets: [{ name: 'Applicants', values: values }] },
				barOptions: { spaceRatio: 0.3 },
				tooltipOptions: { formatTooltipY: function (d) { return d + ' applicants'; } }
			});
			barEl.addEventListener('data-select', function (e) {
				const lbl = e.label || (e.detail && e.detail.label);
				if (lbl) showRecords(unit, allRows, lbl, th);
			});
		} catch (err) { }
	}

	// ── Table builder ─────────────────────────────────────────────────────────
	function buildTable(unit, rows) {
		if (!rows.length) return '<div class="rd-nodata">No records found.</div>';
		const thHtml = unit.columns.map(function (c) { return '<th>' + c.label + '</th>'; }).join('');
		const trs = rows.map(function (r, i) {
			const sv = r[unit.status_field] || 'New Applicant';
			const col = SC[sType(sv)];
			const pill = '<span class="rd-spill" style="background:' + col.bg + ';color:' + col.txt + ';border-color:' + col.brd + '">' + sv + '</span>';
			const tds = unit.columns.map(function (c, ci) {
				const v = r[c.field] || '—';
				return ci === 0
					? '<td class="rd-tname" title="' + v + '">' + v + '</td>'
					: '<td title="' + v + '">' + v + '</td>';
			}).join('');
			return '<tr data-name="' + (r.name || '') + '">' +
				'<td class="rd-tsno">' + (i + 1) + '</td>' +
				'<td class="rd-tid">' + (r.name || '') + '</td>' +
				tds +
				'<td>' + pill + '</td>' +
				'</tr>';
		}).join('');
		return '<table class="rd-tbl"><thead><tr><th>#</th><th>ID</th>' + thHtml + '<th>Status</th></tr></thead><tbody>' + trs + '</tbody></table>';
	}

	// ── CSV export ────────────────────────────────────────────────────────────
	function exportCSV(unit, rows, label) {
		const headers = ['#', 'ID'].concat(unit.columns.map(function (c) { return c.label; })).concat(['Status']);
		const lines = [headers.join(',')];
		rows.forEach(function (r, i) {
			const vals = [i + 1, '"' + (r.name || '') + '"']
				.concat(unit.columns.map(function (c) {
					return '"' + (r[c.field] || '').toString().replace(/"/g, '""') + '"';
				}))
				.concat(['"' + (r[unit.status_field] || 'New Applicant').replace(/"/g, '""') + '"']);
			lines.push(vals.join(','));
		});
		const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		const fname = (unit.short + '_' + label + '_' + new Date().toISOString().slice(0, 10) + '.csv')
			.replace(/[^a-zA-Z0-9._-]/g, '_');
		a.href = url; a.download = fname; a.click();
		URL.revokeObjectURL(url);
	}

	// ── Keyboard navigation (Esc = go back) ──────────────────────────────────
	document.addEventListener('keydown', function (e) {
		if (e.key !== 'Escape') return;
		if ($profile.is(':visible')) { $profile.find('.rd-back').first().trigger('click'); }
		else if ($records.is(':visible')) { $records.find('.rd-back').first().trigger('click'); }
		else if ($detail.is(':visible')) { $detail.find('.rd-back').first().trigger('click'); }
	});
};
