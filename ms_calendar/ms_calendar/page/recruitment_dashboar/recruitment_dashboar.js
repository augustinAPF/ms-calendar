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
		offer: { bg: '#e7e7e7ff', txt: '#1F497D', brd: '#BDD7EE', dot: '#1F497D' },
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

	// Welcome transition overlay shown on every navigation
	function showTransition(welcomeText, name, sub) {
		var old = document.getElementById('rd-tx');
		if (old && old.parentNode) old.parentNode.removeChild(old);
		var tx = document.createElement('div');
		tx.id = 'rd-tx';
		tx.innerHTML =
			'<div class="rd-tx-welcome">' + (welcomeText || 'Welcome to') + '</div>' +
			'<div class="rd-tx-name">' + name + '</div>' +
			(sub ? '<div class="rd-tx-sub">' + sub + '</div>' : '') +
			'<div class="rd-tx-dots">' +
			'<div class="rd-tx-dot"></div>' +
			'<div class="rd-tx-dot"></div>' +
			'<div class="rd-tx-dot"></div>' +
			'</div>';
		document.body.appendChild(tx);
		setTimeout(function () {
			tx.classList.add('rd-tx-out');
			setTimeout(function () { if (tx.parentNode) tx.parentNode.removeChild(tx); }, 340);
		}, 950);
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
	let activeStatuses = [], activeUnits = [];

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
	/* ── Opening animations ── */
	@keyframes rdFadeUp  { from{opacity:0;transform:translateY(22px)} to{opacity:1;transform:none} }
	@keyframes rdFadeIn  { from{opacity:0} to{opacity:1} }
	@keyframes rdLoader  { 0%{transform:translateX(-100%)} 100%{transform:translateX(300%)} }
	@keyframes rdProgress{ 0%{width:0%} 80%{width:85%} 100%{width:100%} }
	@keyframes rdSlideIn { from{opacity:0;transform:translateY(32px) scale(.97)} to{opacity:1;transform:none} }
	.rd-anim-hdr { animation:rdFadeUp .55s cubic-bezier(.25,.46,.45,.94) .1s both; }
	.rd-anim-kpi { animation:rdFadeUp .5s cubic-bezier(.25,.46,.45,.94) .22s both; }
	.rd-anim-filter { animation:rdFadeUp .5s .3s both; }
	.rd-ucard { animation:rdSlideIn .5s cubic-bezier(.34,1.2,.64,1) both; }
	.rd-ucard:nth-child(1) { animation-delay:.35s; }
	.rd-ucard:nth-child(2) { animation-delay:.45s; }
	.rd-ucard:nth-child(3) { animation-delay:.55s; }
	.rd-ucard:nth-child(4) { animation-delay:.65s; }
	.rd-hub-charts { animation:rdFadeUp .6s .75s both; }
	/* ── Splash overlay ── */
	#rd-splash {
		position:fixed; inset:0; z-index:9999;
		background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 50%,#0f172a 100%);
		display:flex; flex-direction:column; align-items:center; justify-content:center;
		transition:opacity .5s ease; pointer-events:none;
	}
	.rd-splash-badge {
		font-size:11px; font-weight:700; letter-spacing:.18em; text-transform:uppercase;
		color:rgba(255,255,255,.4); margin-bottom:12px;
		animation:rdFadeIn .6s .2s both;
	}
	.rd-splash-welcome {
		font-size:14px; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
		color:#2c7db8; margin-bottom:10px; animation:rdFadeUp .5s .25s both;
	}
	.rd-splash-title {
		font-size:36px; font-weight:900; color:#fff; letter-spacing:-.025em; line-height:1.1;
		text-align:center; animation:rdFadeUp .6s .35s both;
	}
	.rd-splash-quote {
		font-size:13.5px; font-style:italic; color:rgba(255,255,255,.55);
		margin-top:18px; max-width:380px; text-align:center; line-height:1.65;
		animation:rdFadeIn .8s .65s both;
	}
	.rd-splash-quote::before { content:'"'; font-size:20px; color:#2c7db8; vertical-align:-.1em; margin-right:2px; }
	.rd-splash-quote::after  { content:'"'; font-size:20px; color:#2c7db8; vertical-align:-.1em; margin-left:2px; }
	.rd-splash-bar {
		margin-top:32px; width:220px; height:3px;
		background:rgba(255,255,255,.1); border-radius:3px; overflow:hidden;
		animation:rdFadeIn .4s .6s both;
	}
	.rd-splash-fill {
		height:100%; width:0%; background:linear-gradient(90deg,#1F497D,#2c7db8,#4a9fd4); border-radius:3px;
		animation:rdProgress 9.5s .4s cubic-bezier(.4,0,.2,1) forwards;
	}
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
	/* ── unit & status filters ── */
	.rd-droprow {
		display:flex; align-items:center; gap:10px; margin-top:10px; flex-wrap:wrap;
	}
	.rd-drop {
		padding:6px 12px; border-radius:8px; font-size:12px; font-weight:600;
		border:1px solid ${BORD}; background:#fff; color:${T1};
		cursor:pointer; min-width:140px; outline:none; transition:border-color .15s;
	}
	.rd-drop:focus { border-color:${AC}; box-shadow:0 0 0 3px ${ACG}.08); }
	.rd-drop-lbl { font-size:11px; font-weight:700; color:${T2}; text-transform:uppercase; letter-spacing:.06em; }
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
	/* ── hub analytics grid ── */
	.rd-hub-charts { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-bottom:32px; }
	.rd-hub-charts .rd-chart-card { margin-bottom:0; }
	.rd-hub-charts .span2 { grid-column:span 2; }
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
	/* ── filter bar (one-line) ── */
	.rd-filter-bar {
		display:flex; align-items:center; gap:12px; flex-wrap:wrap;
		padding:12px 32px; border-top:1px solid ${BORD}; background:#fafbff;
	}
	.rd-fitem { display:flex; flex-direction:column; gap:3px; }
	.rd-fitem-row { display:flex; align-items:center; gap:8px; }
	.rd-filter-divider { width:1px; height:32px; background:${BORD}; flex-shrink:0; }
	/* ── refined multi-select ── */
	.rd-ms { position:relative; display:inline-block; }
	.rd-ms-btn {
		display:flex; align-items:center; gap:8px; height:38px;
		padding:0 10px 0 14px; border-radius:10px;
		border:1.5px solid ${BORD}; background:#fff;
		cursor:pointer; min-width:164px; max-width:260px;
		transition:border-color .18s, box-shadow .18s, background .15s;
		user-select:none; box-shadow:0 1px 3px rgba(0,0,0,.05);
	}
	.rd-ms-btn:hover { border-color:${ACG}.5); background:#fafcff; }
	.rd-ms-btn.open {
		border-color:${AC}; background:#fff;
		box-shadow:0 0 0 3px ${ACG}.1), 0 1px 4px rgba(0,0,0,.04);
	}
	.rd-ms-lbl { flex:1; font-size:13px; font-weight:600; color:${T1}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
	.rd-ms-badge {
		display:none; min-width:20px; height:20px; padding:0 6px;
		border-radius:10px; background:${AC}; color:#fff;
		font-size:10px; font-weight:800; align-items:center; justify-content:center; flex-shrink:0;
	}
	.rd-ms-badge.show { display:inline-flex; }
	.rd-ms-chev {
		width:15px; height:15px; flex-shrink:0; color:${T3};
		transition:transform .22s cubic-bezier(.4,0,.2,1), color .15s;
	}
	.rd-ms-btn.open .rd-ms-chev { transform:rotate(180deg); color:${AC}; }
	/* dropdown panel */
	.rd-ms-panel {
		position:fixed;
		width:300px;
		display:flex; flex-direction:column;
		background:#fff; border:1px solid ${BORD}; border-radius:14px;
		box-shadow:0 20px 48px rgba(0,0,0,.13), 0 4px 12px rgba(0,0,0,.06);
		z-index:99999;
		opacity:0; transform:translateY(-8px) scale(.98);
		pointer-events:none;
		transition:opacity .18s ease, transform .2s cubic-bezier(.34,1.2,.64,1);
	}
	.rd-ms-panel.open { opacity:1; transform:none; pointer-events:all; }
	/* search */
	.rd-ms-srchwrap { padding:10px 10px 8px; border-bottom:1px solid ${BORD}; flex-shrink:0; background:#fafbff; }
	.rd-ms-srch {
		width:100%; padding:8px 12px 8px 36px; border-radius:8px; font-size:13px;
		border:1.5px solid ${BORD}; outline:none; color:${T1}; background:#fff;
		transition:border-color .15s; box-sizing:border-box;
		background-image:url("data:image/svg+xml,%3Csvg width='15' height='15' fill='none' stroke='%2394a3b8' stroke-width='2' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E");
		background-repeat:no-repeat; background-position:11px center;
	}
	.rd-ms-srch:focus { border-color:${AC}; box-shadow:0 0 0 3px ${ACG}.08); }
	/* options list */
	.rd-ms-opts { overflow-y:auto; overflow-x:hidden; max-height:240px; min-height:40px; padding:6px; flex-shrink:0; }
	.rd-ms-opts::-webkit-scrollbar { width:4px; }
	.rd-ms-opts::-webkit-scrollbar-thumb { background:#dde3ef; border-radius:4px; }
	/* each option — no checkbox boxes, just left-border + checkmark */
	.rd-ms-opt {
		display:flex; align-items:center; justify-content:space-between; gap:10px;
		padding:9px 12px 9px 14px; border-radius:9px; cursor:pointer;
		border-left:3px solid transparent;
		transition:background .12s, border-color .12s;
		user-select:none;
	}
	.rd-ms-opt:hover { background:#f2f6ff; border-left-color:#bdd7ee; }
	.rd-ms-opt.selected { background:#EBF3FB; border-left-color:${AC}; }
	.rd-ms-optlbl { font-size:13px; font-weight:500; color:${T1}; flex:1; line-height:1.35; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
	.rd-ms-opt.selected .rd-ms-optlbl { font-weight:700; color:${AC}; }
	.rd-ms-optchk {
		display:none; width:15px; height:15px; flex-shrink:0;
		color:${AC}; stroke-width:2.5;
	}
	.rd-ms-opt.selected .rd-ms-optchk { display:block; }
	.rd-ms-empty { padding:20px; text-align:center; color:${T3}; font-size:13px; }
	/* footer */
	.rd-ms-foot {
		padding:8px 14px; border-top:1px solid ${BORD}; flex-shrink:0;
		display:flex; align-items:center; justify-content:space-between;
		background:#fafbff;
	}
	.rd-ms-selall {
		font-size:12px; font-weight:600; color:${T2}; cursor:pointer;
		padding:4px 10px; border-radius:6px; transition:all .12s;
	}
	.rd-ms-selall:hover { background:#eef2f7; color:${T1}; }
	.rd-ms-clr {
		font-size:12px; font-weight:700; color:${AC}; cursor:pointer;
		padding:4px 10px; border-radius:6px; transition:all .12s;
	}
	.rd-ms-clr:hover { background:${ACG}.08); }
	/* ── summary cards ── */
	.rd-sum-cards { display:grid; grid-template-columns:repeat(5,1fr); gap:14px; margin-bottom:24px; }
	.rd-sum-card {
		background:#fff; border:1.5px solid ${BORD}; border-radius:16px;
		padding:16px 18px; display:flex; align-items:center; gap:14px;
		cursor:pointer; transition:all .22s; box-shadow:0 2px 8px rgba(0,0,0,.04);
	}
	.rd-sum-card:hover { border-color:${AC}; box-shadow:0 8px 24px ${ACG}.14); transform:translateY(-3px); }
	.rd-sum-ico { width:46px; height:46px; border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
	.rd-sum-body { flex:1; min-width:0; }
	.rd-sum-v { font-size:28px; font-weight:900; line-height:1; color:${T1}; }
	.rd-sum-k { font-size:11.5px; font-weight:600; color:${T2}; margin-top:4px; }
	.rd-sum-hint { font-size:10px; color:${T3}; margin-top:5px; }

	/* ── Floating splash particles ── */
	@keyframes rdParticle {
		0%   { transform:translateY(0) scale(1);   opacity:0; }
		10%  { opacity:.7; }
		90%  { opacity:.4; }
		100% { transform:translateY(-110vh) scale(.3); opacity:0; }
	}
	.rd-particle {
		position:absolute; border-radius:50%; pointer-events:none;
		background:rgba(44,125,184,.5);
		animation:rdParticle linear infinite;
	}

	/* ── Summary card staggered entrance ── */
	@keyframes rdSumIn { from{opacity:0;transform:translateY(24px) scale(.95)} to{opacity:1;transform:none} }
	.rd-sum-card:nth-child(1) { animation:rdSumIn .5s cubic-bezier(.34,1.2,.64,1) .05s both; }
	.rd-sum-card:nth-child(2) { animation:rdSumIn .5s cubic-bezier(.34,1.2,.64,1) .15s both; }
	.rd-sum-card:nth-child(3) { animation:rdSumIn .5s cubic-bezier(.34,1.2,.64,1) .25s both; }
	.rd-sum-card:nth-child(4) { animation:rdSumIn .5s cubic-bezier(.34,1.2,.64,1) .35s both; }
	.rd-sum-card:nth-child(5) { animation:rdSumIn .5s cubic-bezier(.34,1.2,.64,1) .45s both; }

	/* ── KPI card pop-in on detail page ── */
	@keyframes rdKpiPop { 0%{opacity:0;transform:scale(.82)} 70%{transform:scale(1.06)} 100%{opacity:1;transform:none} }
	.rd-kpi:nth-child(1) { animation:rdKpiPop .42s cubic-bezier(.34,1.3,.64,1) .05s both; }
	.rd-kpi:nth-child(2) { animation:rdKpiPop .42s cubic-bezier(.34,1.3,.64,1) .14s both; }
	.rd-kpi:nth-child(3) { animation:rdKpiPop .42s cubic-bezier(.34,1.3,.64,1) .23s both; }
	.rd-kpi:nth-child(4) { animation:rdKpiPop .42s cubic-bezier(.34,1.3,.64,1) .32s both; }

	/* ── Chart card slide-up ── */
	@keyframes rdChartIn { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:none} }
	.rd-chart-card { animation:rdChartIn .5s cubic-bezier(.25,.46,.45,.94) .1s both; }

	/* ── Shimmer skeleton loader ── */
	@keyframes rdShimmer { 0%{background-position:-600px 0} 100%{background-position:600px 0} }
	.rd-skeleton {
		display:inline-block; border-radius:8px; height:18px; width:80%;
		background:linear-gradient(90deg,#e8edf6 25%,#d0d9ea 50%,#e8edf6 75%);
		background-size:1200px 100%;
		animation:rdShimmer 1.5s infinite linear;
	}
	.rd-ucard-num .rd-skeleton { height:36px; width:60px; border-radius:6px; }

	/* ── Table row slide-in ── */
	@keyframes rdRowIn { from{opacity:0;transform:translateX(-10px)} to{opacity:1;transform:translateX(0)} }
	.rd-tbl tbody tr { animation:rdRowIn .22s ease both; }

	/* ── Ripple on unit card click ── */
	@keyframes rdRipple { from{transform:scale(0);opacity:.55} to{transform:scale(5);opacity:0} }
	.rd-ripple {
		position:absolute; border-radius:50%;
		width:60px; height:60px; margin:-30px 0 0 -30px;
		background:rgba(255,255,255,.35); pointer-events:none;
		animation:rdRipple .65s ease-out forwards;
	}

	/* ── Status card entrance stagger ── */
	@keyframes rdSCardIn { from{opacity:0;transform:scale(.9) translateY(12px)} to{opacity:1;transform:none} }
	.rd-scard { animation:rdSCardIn .35s cubic-bezier(.34,1.2,.64,1) both; }

	/* ── Page transition welcome overlay ── */
	@keyframes rdTxIn  { from{transform:translateY(100%);opacity:0} to{transform:translateY(0);opacity:1} }
	@keyframes rdTxOut { from{opacity:1;transform:scale(1)} to{opacity:0;transform:scale(1.05)} }
	@keyframes rdDotPing { 0%,100%{transform:scale(1);opacity:.3} 50%{transform:scale(1.6);opacity:1} }
	#rd-tx {
		position:fixed; inset:0; z-index:9998; pointer-events:none;
		background:linear-gradient(135deg,#0a1128 0%,#1e3a5f 52%,#0a1128 100%);
		display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px;
		animation:rdTxIn .38s cubic-bezier(.34,1.1,.64,1) forwards;
	}
	#rd-tx.rd-tx-out { animation:rdTxOut .32s ease forwards; }
	.rd-tx-welcome {
		font-size:11px; font-weight:800; letter-spacing:.2em; text-transform:uppercase;
		color:#2c7db8; animation:rdFadeUp .4s .12s both;
	}
	.rd-tx-name {
		font-size:36px; font-weight:900; color:#fff; letter-spacing:-.025em;
		text-align:center; max-width:80vw; line-height:1.15;
		animation:rdFadeUp .45s .22s both;
	}
	.rd-tx-sub {
		font-size:13px; color:rgba(255,255,255,.42); margin-top:3px; text-align:center;
		animation:rdFadeIn .5s .35s both;
	}
	.rd-tx-dots {
		display:flex; gap:9px; margin-top:22px; animation:rdFadeIn .4s .38s both;
	}
	.rd-tx-dot {
		width:9px; height:9px; border-radius:50%; background:rgba(255,255,255,.18);
	}
	.rd-tx-dot:nth-child(1) { animation:rdDotPing 1s .0s infinite; background:#2c7db8; }
	.rd-tx-dot:nth-child(2) { animation:rdDotPing 1s .18s infinite; background:#4a9fd4; }
	.rd-tx-dot:nth-child(3) { animation:rdDotPing 1s .36s infinite; background:#6bb5e0; }
	`;
	document.head.appendChild(S);

	// ── DOM shell ─────────────────────────────────────────────────────────────
	const SPLASH_QUOTES = [
		'Every great hire starts with a great process.',
		'Building tomorrow\'s team, one candidate at a time.',
		'Finding the right people to make the difference.',
		'Great teams don\'t happen by accident — they\'re built with purpose.',
		'The right talent can transform an organisation.',
		'People are our greatest asset.',
		'Every interview is an opportunity to change someone\'s story.',
		'Connecting talent with purpose.',
		'Empowering communities through the right people.',
		'Excellence in recruitment, excellence in impact.',
		'One good hire can change everything.',
		'Invest in people — they are the foundation of every mission.',
	];
	const _splashQuote = SPLASH_QUOTES[Math.floor(Math.random() * SPLASH_QUOTES.length)];

	$(wrapper).find('.page-content').append(`
		<div id="rd-splash">
			<div class="rd-splash-badge">Azim Premji Foundation</div>
			<div class="rd-splash-welcome">&#x1F44B; Welcome to</div>
			<div class="rd-splash-title">Recruitment Dashboard</div>
			<div class="rd-splash-quote">${_splashQuote}</div>
			<div class="rd-splash-bar"><div class="rd-splash-fill"></div></div>
		</div>
		<div class="rd-wrap">
			<div id="rd-front"></div>
			<div id="rd-detail"  style="display:none"></div>
			<div id="rd-records" style="display:none"></div>
			<div id="rd-profile" style="display:none"></div>
		</div>
	`);

	// Floating particles inside splash
	(function () {
		var sp = document.getElementById('rd-splash');
		if (!sp) return;
		var sizes = [4, 6, 8, 10, 5, 7, 9, 6, 4, 8, 5, 7];
		var delays = [0, 1.2, 0.5, 2.1, 3.0, 1.7, 0.3, 2.8, 1.5, 0.8, 3.5, 2.3];
		var durs = [8, 11, 9, 13, 10, 12, 8.5, 11.5, 9.5, 14, 10.5, 7.5];
		for (var i = 0; i < 12; i++) {
			var p = document.createElement('div');
			p.className = 'rd-particle';
			p.style.cssText = [
				'width:' + sizes[i] + 'px',
				'height:' + sizes[i] + 'px',
				'left:' + (5 + i * 8) + '%',
				'bottom:' + (-sizes[i]) + 'px',
				'animation-duration:' + durs[i] + 's',
				'animation-delay:' + delays[i] + 's',
			].join(';');
			sp.appendChild(p);
		}
	}());

	// Dismiss splash after 10 seconds
	setTimeout(function () {
		var sp = document.getElementById('rd-splash');
		if (sp) { sp.style.opacity = '0'; setTimeout(function () { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 500); }
	}, 10000);

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
		let rows = filterByDate(store[ui].rows, activeFilter);
		if (activeStatuses.length) {
			rows = rows.filter(function (r) {
				return activeStatuses.indexOf(r[UNITS[ui].status_field] || 'New Applicant') !== -1;
			});
		}
		const counts = {};
		rows.forEach(function (r) {
			const s = r[UNITS[ui].status_field] || 'New Applicant';
			counts[s] = (counts[s] || 0) + 1;
		});
		return { rows, counts };
	}

	function updateFrontStats() {
		let total = 0, offers = 0, rejects = 0, newApps = 0, inTeam = 0;
		const RW = ['reject', 'blocklist', 'regret'];
		const JW = ['join', 'accept'];

		// Collect all statuses for the multi-select menu
		const allStatuses = {};
		UNITS.forEach(function (unit, ui) {
			if (!store[ui]) return;
			filterByDate(store[ui].rows, activeFilter).forEach(function (r) {
				const s = r[unit.status_field] || 'New Applicant';
				allStatuses[s] = true;
			});
		});
		const sopts = document.getElementById('rd-status-opts');
		if (sopts) {
			const sortedStatuses = Object.keys(allStatuses).sort();
			sopts.innerHTML = sortedStatuses.length ? sortedStatuses.map(function (s) {
				const sel = activeStatuses.indexOf(s) !== -1 ? ' selected' : '';
				return '<div class="rd-ms-opt' + sel + '" data-val="' + s.replace(/"/g, '&quot;') + '">' +
					'<span class="rd-ms-optlbl">' + s + '</span>' +
					'<svg class="rd-ms-optchk" fill="none" stroke="currentColor" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' +
					'</div>';
			}).join('') : '<div class="rd-ms-empty">No statuses yet — data is loading</div>';
		}

		UNITS.forEach(function (unit, ui) {
			if (!store[ui]) return;
			const { rows, counts } = getFilteredData(ui);
			const card = document.querySelector('.rd-ucard[data-ui="' + ui + '"]');
			const hidden = activeUnits.length > 0 && activeUnits.indexOf(ui) === -1;
			if (card) card.style.display = hidden ? 'none' : '';
			const el = document.getElementById('unum-' + ui);
			if (el) countUp(el, hidden ? 0 : rows.length);
			if (!hidden) {
				total += rows.length;
				offers += unit.offerStatuses.reduce(function (s, st) { return s + (counts[st] || 0); }, 0);
				Object.keys(counts).forEach(function (s) {
					const sl = s.toLowerCase();
					if (RW.some(function (w) { return sl.includes(w); })) rejects += counts[s];
					if (JW.some(function (w) { return sl.includes(w); })) inTeam += counts[s];
					if (sl === 'new applicant') newApps += counts[s];
				});
			}
		});
		const totalEl = document.getElementById('gs-total');
		const offerEl = document.getElementById('gs-offers');
		const convEl = document.getElementById('gs-conv');
		if (totalEl) countUp(totalEl, total);
		if (offerEl) countUp(offerEl, offers);
		if (convEl) convEl.textContent = total > 0 ? (offers / total * 100).toFixed(1) + '%' : '—';

		const sumTotalEl = document.getElementById('gs-total-all');
		const sumOfferEl = document.getElementById('gs-offers-all');
		const sumRejectEl = document.getElementById('gs-rejects-all');
		const sumNewEl = document.getElementById('gs-new-all');
		const sumTeamEl = document.getElementById('gs-team-all');
		if (sumTotalEl) countUp(sumTotalEl, total);
		if (sumOfferEl) countUp(sumOfferEl, offers);
		if (sumRejectEl) countUp(sumRejectEl, rejects);
		if (sumNewEl) countUp(sumNewEl, newApps);
		if (sumTeamEl) countUp(sumTeamEl, inTeam);

		drawFrontCharts();
	}

	// ── Hub analytics charts (update with date filter) ────────────────────────
	function drawFrontCharts() {
		const FIN_M = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

		// Collect data across all units
		const unitLabels = UNITS.map(function (u) { return u.short; });
		const unitCounts = UNITS.map(function (_u, ui) {
			return store[ui] ? getFilteredData(ui).rows.length : 0;
		});

		// Monthly trend (all units combined)
		const monthMap = {};
		UNITS.forEach(function (_u, ui) {
			if (!store[ui]) return;
			getFilteredData(ui).rows.forEach(function (r) {
				if (!r.creation) return;
				const d = new Date(r.creation);
				const mi = d.getMonth(), yr = d.getFullYear();
				const mn = FIN_M[mi >= 3 ? mi - 3 : mi + 9];
				const yr2 = mi >= 3 ? yr : yr + 1;
				const k = mn + "'" + String(yr2).slice(2);
				monthMap[k] = (monthMap[k] || 0) + 1;
			});
		});
		const monthLabels = Object.keys(monthMap).sort(function (a, b) {
			function ord(lbl) {
				const p = lbl.split("'");
				const mi = FIN_M.indexOf(p[0]), yr2 = parseInt('20' + p[1]);
				return yr2 * 12 + (mi >= 9 ? mi - 9 : mi + 3);
			}
			return ord(a) - ord(b);
		});
		const monthValues = monthLabels.map(function (k) { return monthMap[k]; });

		// Status distribution (top 10 across all units)
		const statusMap = {};
		UNITS.forEach(function (_u, ui) {
			if (!store[ui]) return;
			const { counts } = getFilteredData(ui);
			Object.keys(counts).forEach(function (s) {
				statusMap[s] = (statusMap[s] || 0) + counts[s];
			});
		});
		const topStatuses = Object.keys(statusMap)
			.sort(function (a, b) { return statusMap[b] - statusMap[a]; })
			.slice(0, 10);
		const statusValues = topStatuses.map(function (s) { return statusMap[s]; });

		// Draw / redraw charts
		const unitEl = document.getElementById('hub-chart-unit');
		const trendEl = document.getElementById('hub-chart-trend');
		const statusEl = document.getElementById('hub-chart-status');

		if (unitEl && unitCounts.some(function (v) { return v > 0; })) {
			unitEl.innerHTML = '';
			try {
				new frappe.Chart(unitEl, {
					type: 'bar', height: 200,
					colors: [AC, '#2c7db8', '#4a9fd4', '#6bb5e0'],
					data: { labels: unitLabels, datasets: [{ name: 'Applications', values: unitCounts }] },
					barOptions: { spaceRatio: 0.4 },
					tooltipOptions: { formatTooltipY: function (v) { return v + ' applicants'; } }
				});
			} catch (e) { }
		}

		if (trendEl && monthLabels.length) {
			trendEl.innerHTML = '';
			try {
				new frappe.Chart(trendEl, {
					type: 'line', height: 220,
					colors: [AC],
					data: { labels: monthLabels, datasets: [{ name: 'Applications', values: monthValues }] },
					lineOptions: { regionFill: 1, hideDots: monthLabels.length > 24 ? 1 : 0 },
					tooltipOptions: { formatTooltipY: function (v) { return v + ' applications'; } }
				});
			} catch (e) { }
		}

		if (statusEl && topStatuses.length) {
			statusEl.innerHTML = '';
			try {
				new frappe.Chart(statusEl, {
					type: 'bar', height: 200,
					colors: ['#2c7db8'],
					data: { labels: topStatuses, datasets: [{ name: 'Count', values: statusValues }] },
					barOptions: { spaceRatio: 0.3 },
					tooltipOptions: { formatTooltipY: function (v) { return v + ' applicants'; } }
				});
			} catch (e) { }
		}
	}

	// ── Front page ────────────────────────────────────────────────────────────
	const CARD_WAVES = [
		'<path d="M0,35 C50,15 100,50 150,30 C185,15 210,38 240,25 L240,70 L0,70 Z" fill="rgba(255,255,255,.15)"/><path d="M0,48 C40,36 90,55 145,44 C178,36 205,50 240,44 L240,70 L0,70 Z" fill="rgba(255,255,255,.08)"/>',
		'<path d="M0,30 C55,46 95,18 148,36 C180,48 210,26 240,32 L240,70 L0,70 Z" fill="rgba(255,255,255,.15)"/><path d="M0,46 C48,38 88,54 140,45 C172,38 206,50 240,46 L240,70 L0,70 Z" fill="rgba(255,255,255,.08)"/>',
		'<path d="M0,28 C60,44 100,16 150,34 C182,46 210,24 240,30 L240,70 L0,70 Z" fill="rgba(255,255,255,.15)"/><path d="M0,44 C52,36 90,52 144,42 C174,34 206,48 240,44 L240,70 L0,70 Z" fill="rgba(255,255,255,.08)"/>',
		'<path d="M0,33 C48,17 92,48 144,28 C178,14 208,40 240,26 L240,70 L0,70 Z" fill="rgba(255,255,255,.15)"/><path d="M0,47 C44,37 88,56 140,46 C170,38 202,52 240,47 L240,70 L0,70 Z" fill="rgba(255,255,255,.08)"/>',
	];

	$front.html(`
		<div class="rd-header rd-anim-hdr">
			<div class="rd-header-top">
				<div class="rd-header-left">
					<div class="rd-header-badge">
						<span class="rd-pulse"></span>
						Azim Premji Foundation &mdash; Recruitment HQ
					</div>
					<div class="rd-header-title">Recruitment Dashboard</div>
				</div>
			</div>
			<div class="rd-filter-bar rd-anim-filter">
				<div class="rd-fitem">
					<span class="rd-drop-lbl">Date</span>
					<select class="rd-drop" id="rd-date-filter" style="min-width:130px">
						${DATE_FILTERS.map(function (f) { return '<option value="' + f.key + '">' + f.label + '</option>'; }).join('')}
					</select>
				</div>
				<div class="rd-fitem" id="rd-cdate" style="display:none">
					<span class="rd-drop-lbl">Range</span>
					<div class="rd-fitem-row">
						<input type="date" class="rd-dinput" id="rd-from" />
						<span class="rd-drop-lbl" style="margin:0">to</span>
						<input type="date" class="rd-dinput" id="rd-to" />
						<button class="rd-apply" id="rd-apply-custom">Apply</button>
					</div>
				</div>
				<div class="rd-filter-divider"></div>
				<div class="rd-fitem">
					<span class="rd-drop-lbl">Unit</span>
					<div class="rd-ms" id="rd-unit-ms">
						<div class="rd-ms-btn" id="rd-unit-btn">
							<span class="rd-ms-lbl">All Units</span>
							<span class="rd-ms-badge" id="rd-unit-badge"></span>
							<svg class="rd-ms-chev" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
						</div>
						<div class="rd-ms-panel" id="rd-unit-panel">
							<div class="rd-ms-srchwrap"><input class="rd-ms-srch" type="text" placeholder="Search units…" id="rd-unit-srch" autocomplete="off" /></div>
							<div class="rd-ms-opts" id="rd-unit-opts">
								${UNITS.map(function (u, i) {
		return '<div class="rd-ms-opt" data-val="' + i + '">' +
			'<span class="rd-ms-optlbl">' + u.label + '</span>' +
			'<svg class="rd-ms-optchk" fill="none" stroke="currentColor" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' +
			'</div>';
	}).join('')}
							</div>
							<div class="rd-ms-foot">
								<span class="rd-ms-selall" id="rd-unit-selall">Select all</span>
								<span class="rd-ms-clr" id="rd-unit-clr">Clear all</span>
							</div>
						</div>
					</div>
				</div>
				<div class="rd-fitem">
					<span class="rd-drop-lbl">Status</span>
					<div class="rd-ms" id="rd-status-ms">
						<div class="rd-ms-btn" id="rd-status-btn">
							<span class="rd-ms-lbl">All Statuses</span>
							<span class="rd-ms-badge" id="rd-status-badge"></span>
							<svg class="rd-ms-chev" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
						</div>
						<div class="rd-ms-panel" id="rd-status-panel">
							<div class="rd-ms-srchwrap"><input class="rd-ms-srch" type="text" placeholder="Search statuses…" id="rd-status-srch" autocomplete="off" /></div>
							<div class="rd-ms-opts" id="rd-status-opts"></div>
							<div class="rd-ms-foot">
								<span class="rd-ms-selall" id="rd-status-selall">Select all</span>
								<span class="rd-ms-clr" id="rd-status-clr">Clear all</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
		<div class="rd-body">
			<div class="rd-section-hdr">Overview</div>
			<div class="rd-sum-cards">
				<div class="rd-sum-card" id="sum-total">
					<div class="rd-sum-ico" style="background:#DDEBF7">
						<svg fill="none" stroke="#1F497D" stroke-width="2" viewBox="0 0 24 24" width="24" height="24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
					</div>
					<div class="rd-sum-body">
						<div class="rd-sum-v" id="gs-total-all">—</div>
						<div class="rd-sum-k">Total Applicants</div>
						<div class="rd-sum-hint">Click to view all &rarr;</div>
					</div>
				</div>
				<div class="rd-sum-card" id="sum-offers">
					<div class="rd-sum-ico" style="background:#dcfce7">
						<svg fill="none" stroke="#15803d" stroke-width="2" viewBox="0 0 24 24" width="24" height="24"><polyline points="20 6 9 17 4 12"/></svg>
					</div>
					<div class="rd-sum-body">
						<div class="rd-sum-v" id="gs-offers-all">—</div>
						<div class="rd-sum-k">Total Offers</div>
						<div class="rd-sum-hint">Click to view &rarr;</div>
					</div>
				</div>
				<div class="rd-sum-card" id="sum-rejects">
					<div class="rd-sum-ico" style="background:#fee2e2">
						<svg fill="none" stroke="#dc2626" stroke-width="2" viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
					</div>
					<div class="rd-sum-body">
						<div class="rd-sum-v" id="gs-rejects-all">—</div>
						<div class="rd-sum-k">Total Rejects</div>
						<div class="rd-sum-hint">Click to view &rarr;</div>
					</div>
				</div>
				<div class="rd-sum-card" id="sum-new">
					<div class="rd-sum-ico" style="background:#fef9c3">
						<svg fill="none" stroke="#ca8a04" stroke-width="2" viewBox="0 0 24 24" width="24" height="24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
					</div>
					<div class="rd-sum-body">
						<div class="rd-sum-v" id="gs-new-all">—</div>
						<div class="rd-sum-k">New Applicants</div>
						<div class="rd-sum-hint">Click to view &rarr;</div>
					</div>
				</div>
				<div class="rd-sum-card" id="sum-inteam">
					<div class="rd-sum-ico" style="background:#e0f2fe">
						<svg fill="none" stroke="#0369a1" stroke-width="2" viewBox="0 0 24 24" width="24" height="24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><polyline points="16 11 18 13 22 9"/></svg>
					</div>
					<div class="rd-sum-body">
						<div class="rd-sum-v" id="gs-team-all">—</div>
						<div class="rd-sum-k">In Team</div>
						<div class="rd-sum-hint">Joined &amp; accepted &rarr;</div>
					</div>
				</div>
			</div>
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
			<div class="rd-section-hdr" style="margin-top:8px">Analytics</div>
			<div class="rd-hub-charts">
				<div class="rd-chart-card span2">
					<div class="rd-chart-hdr">
						<div class="rd-chart-ttl">Applications Over Time</div>
						<div class="rd-chart-sub">Monthly trend — all units</div>
					</div>
					<div id="hub-chart-trend" style="min-height:180px"></div>
				</div>
				<div class="rd-chart-card">
					<div class="rd-chart-hdr">
						<div class="rd-chart-ttl">Applications by Unit</div>
					</div>
					<div id="hub-chart-unit" style="min-height:160px"></div>
				</div>
				<div class="rd-chart-card">
					<div class="rd-chart-hdr">
						<div class="rd-chart-ttl">Top Status Distribution</div>
					</div>
					<div id="hub-chart-status" style="min-height:160px"></div>
				</div>
			</div>
		</div>
	`);

	$front.on('click', '.rd-ucard', function (e) {
		var card = this;
		var ui = parseInt($(card).data('ui'));
		var unit = UNITS[ui];
		// Ripple effect
		var rect = card.getBoundingClientRect();
		var rip = document.createElement('div');
		rip.className = 'rd-ripple';
		rip.style.left = (e.clientX - rect.left) + 'px';
		rip.style.top = (e.clientY - rect.top) + 'px';
		card.appendChild(rip);
		setTimeout(function () { if (rip.parentNode) rip.parentNode.removeChild(rip); }, 700);
		// Welcome transition overlay
		showTransition('Welcome to', unit.label, unit.desc);
		showDetail(ui);
	});
	// Date select filter
	$front.on('change', '#rd-date-filter', function () {
		activeFilter = $(this).val();
		if (activeFilter === 'custom') {
			$('#rd-cdate').show();
		} else {
			$('#rd-cdate').hide();
			customFrom = ''; customTo = '';
			updateFrontStats();
		}
	});
	$front.on('click', '#rd-apply-custom', function () {
		customFrom = $('#rd-from').val();
		customTo = $('#rd-to').val();
		updateFrontStats();
	});

	// ── Multi-select helpers ──────────────────────────────────────────────────
	function syncUnitBtn() {
		var lbl = activeUnits.length === 0 ? 'All Units'
			: activeUnits.length === 1 ? UNITS[activeUnits[0]].label
				: activeUnits.length + ' Units';
		$('#rd-unit-btn .rd-ms-lbl').text(lbl);
		var $badge = $('#rd-unit-badge');
		activeUnits.length > 0 ? $badge.text(activeUnits.length).addClass('show') : $badge.removeClass('show');
	}
	function syncStatusBtn() {
		var lbl = activeStatuses.length === 0 ? 'All Statuses'
			: activeStatuses.length === 1 ? activeStatuses[0]
				: activeStatuses.length + ' Statuses';
		$('#rd-status-btn .rd-ms-lbl').text(lbl);
		var $badge = $('#rd-status-badge');
		activeStatuses.length > 0 ? $badge.text(activeStatuses.length).addClass('show') : $badge.removeClass('show');
	}
	function closeAllPanels() {
		$('.rd-ms-panel').removeClass('open');
		$('.rd-ms-btn').removeClass('open');
	}

	function positionPanel(btnId, panelId) {
		var btn = document.getElementById(btnId);
		var panel = document.getElementById(panelId);
		if (!btn || !panel) return;
		// Portal: move to body so no container stacking context can clip it
		if (panel.parentNode !== document.body) {
			document.body.appendChild(panel);
		}
		var rect = btn.getBoundingClientRect();
		var panelW = 300;
		var vw = window.innerWidth;
		var vh = window.innerHeight;
		var left = rect.left;
		if (left + panelW > vw - 12) left = vw - panelW - 12;
		if (left < 8) left = 8;
		var top = rect.bottom + 6;
		var maxPanelH = 340;
		if (top + maxPanelH > vh - 12) top = rect.top - maxPanelH - 6;
		if (top < 8) top = 8;
		panel.style.top = top + 'px';
		panel.style.left = left + 'px';
	}

	// Unit trigger toggle
	$front.on('click', '#rd-unit-btn', function (e) {
		e.stopPropagation();
		var isOpen = $('#rd-unit-panel').hasClass('open');
		closeAllPanels();
		if (!isOpen) {
			positionPanel('rd-unit-btn', 'rd-unit-panel');
			$('#rd-unit-panel').addClass('open');
			$('#rd-unit-btn').addClass('open');
			setTimeout(function () { $('#rd-unit-srch').focus(); }, 80);
		}
	});
	// Unit option click
	$(document).on('click', '#rd-unit-opts .rd-ms-opt', function (e) {
		e.stopPropagation();
		$(this).toggleClass('selected');
		var val = parseInt($(this).data('val'));
		var idx = activeUnits.indexOf(val);
		if (idx === -1) activeUnits.push(val); else activeUnits.splice(idx, 1);
		syncUnitBtn();
		updateFrontStats();
	});
	// Unit search filter
	$(document).on('input', '#rd-unit-srch', function () {
		var q = $(this).val().toLowerCase();
		$('#rd-unit-opts .rd-ms-opt').each(function () {
			$(this).toggle(!q || $(this).find('.rd-ms-optlbl').text().toLowerCase().includes(q));
		});
	});
	// Unit select all
	$(document).on('click', '#rd-unit-selall', function (e) {
		e.stopPropagation();
		activeUnits = UNITS.map(function (_u, i) { return i; });
		$('#rd-unit-opts .rd-ms-opt').addClass('selected');
		syncUnitBtn();
		updateFrontStats();
	});
	// Unit clear
	$(document).on('click', '#rd-unit-clr', function (e) {
		e.stopPropagation();
		activeUnits = [];
		$('#rd-unit-opts .rd-ms-opt').removeClass('selected');
		syncUnitBtn();
		updateFrontStats();
	});

	// Status trigger toggle
	$front.on('click', '#rd-status-btn', function (e) {
		e.stopPropagation();
		var isOpen = $('#rd-status-panel').hasClass('open');
		closeAllPanels();
		if (!isOpen) {
			positionPanel('rd-status-btn', 'rd-status-panel');
			$('#rd-status-panel').addClass('open');
			$('#rd-status-btn').addClass('open');
			setTimeout(function () { $('#rd-status-srch').focus(); }, 80);
		}
	});
	// Status option click
	$(document).on('click', '#rd-status-opts .rd-ms-opt', function (e) {
		e.stopPropagation();
		$(this).toggleClass('selected');
		var val = $(this).data('val');
		var idx = activeStatuses.indexOf(val);
		if (idx === -1) activeStatuses.push(val); else activeStatuses.splice(idx, 1);
		syncStatusBtn();
		updateFrontStats();
	});
	// Status search filter
	$(document).on('input', '#rd-status-srch', function () {
		var q = $(this).val().toLowerCase();
		$('#rd-status-opts .rd-ms-opt').each(function () {
			$(this).toggle(!q || $(this).find('.rd-ms-optlbl').text().toLowerCase().includes(q));
		});
	});
	// Status select all
	$(document).on('click', '#rd-status-selall', function (e) {
		e.stopPropagation();
		activeStatuses = [];
		$('#rd-status-opts .rd-ms-opt').each(function () {
			$(this).addClass('selected');
			activeStatuses.push($(this).data('val'));
		});
		syncStatusBtn();
		updateFrontStats();
	});
	// Status clear
	$(document).on('click', '#rd-status-clr', function (e) {
		e.stopPropagation();
		activeStatuses = [];
		$('#rd-status-opts .rd-ms-opt').removeClass('selected');
		syncStatusBtn();
		updateFrontStats();
	});

	// Summary card clicks
	$front.on('click', '#sum-total', function () { showTransition('Opening', 'All Applicants', 'Across all recruitment units'); showAllUnitRecords('all', 'All Applicants'); });
	$front.on('click', '#sum-offers', function () { showTransition('Opening', 'Total Offers', 'Offer stage candidates'); showAllUnitRecords('offer', 'Total Offers'); });
	$front.on('click', '#sum-rejects', function () { showTransition('Opening', 'Total Rejects', 'Rejected candidates'); showAllUnitRecords('reject', 'Total Rejects'); });
	$front.on('click', '#sum-new', function () { showTransition('Opening', 'New Applicants', 'Recently entered the pipeline'); showAllUnitRecords('new', 'New Applicants'); });
	$front.on('click', '#sum-inteam', function () { showTransition('Opening', 'In Team', 'Joined & accepted candidates'); showAllUnitRecords('inteam', 'In Team'); });

	// Close all panels on outside click
	$(document).on('click.rdms', function () { closeAllPanels(); });

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
					${unit.statuses.map(function (s, si) {
			const cnt = counts[s] || 0;
			const col = SC[sType(s)];
			const pct = total > 0 ? Math.round(cnt / total * 100) : 0;
			return '<div class="rd-scard' + (cnt === 0 ? ' zero' : '') + '" data-status="' + s + '" style="border-left-color:' + col.dot + ';animation-delay:' + Math.min(si * 0.04, 0.8) + 's">' +
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
			var status = $(this).data('status');
			showTransition('Viewing', status, unit.label);
			showRecords(unit, rows, status, th);
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
			return '<tr data-name="' + (r.name || '') + '" style="animation-delay:' + Math.min(i * 0.028, 0.6) + 's">' +
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

	// ── All-units records view (summary card clicks) ──────────────────────────
	function showAllUnitRecords(filterType, title) {
		const RW = ['reject', 'blocklist', 'regret'];
		const JW = ['join', 'accept'];
		var allRows = [];
		UNITS.forEach(function (unit, ui) {
			if (!store[ui]) return;
			var { rows } = getFilteredData(ui);
			if (filterType === 'offer') {
				rows = rows.filter(function (r) {
					return unit.offerStatuses.indexOf(r[unit.status_field] || 'New Applicant') !== -1;
				});
			} else if (filterType === 'reject') {
				rows = rows.filter(function (r) {
					var s = (r[unit.status_field] || 'New Applicant').toLowerCase();
					return RW.some(function (w) { return s.includes(w); });
				});
			} else if (filterType === 'new') {
				rows = rows.filter(function (r) {
					return (r[unit.status_field] || 'New Applicant').toLowerCase() === 'new applicant';
				});
			} else if (filterType === 'inteam') {
				rows = rows.filter(function (r) {
					var s = (r[unit.status_field] || '').toLowerCase();
					return JW.some(function (w) { return s.includes(w); });
				});
			}
			rows.forEach(function (r) {
				allRows.push(Object.assign({}, r, { _unit: unit, _ui: ui }));
			});
		});

		$front.hide();
		$records.show().html(`
			<div class="rd-nav">
				<button class="rd-back" id="rp-back">
					<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
					Dashboard
				</button>
				<span class="rd-crumb">Recruitment &rsaquo; <b>${title}</b></span>
				<span class="rd-nav-sp"></span>
				<span class="rd-nav-date">${fmtDate()}</span>
			</div>
			<div class="rd-body">
				<div class="rd-rpg-hero" style="background:linear-gradient(140deg,#0f172a 0%,#1F497D 55%,#2c7db8 100%);box-shadow:0 12px 40px rgba(31,73,125,.38)">
					<div class="rd-rpg-unit">All Recruitment Units</div>
					<div class="rd-rpg-title">${title}</div>
					<div class="rd-rpg-meta">${allRows.length.toLocaleString('en-IN')} total records across all units</div>
					<div class="rd-rpg-big">${allRows.length}</div>
				</div>
				<div class="rd-tcard">
					<div class="rd-toolbar">
						<span class="rd-tlabel">${title}</span>
						<span class="rd-tcnt" id="rp-cnt">${allRows.length} records</span>
						<input class="rd-srch" type="text" placeholder="Search name…" id="rp-srch" />
						<button class="rd-export-btn" id="rp-export">
							<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
							Export CSV
						</button>
					</div>
					<div class="rd-tbody-wrap" id="rp-body">${buildAllTable(allRows)}</div>
					<div class="rd-tfoot">
						<span id="rp-foot">Showing ${allRows.length} records</span>
						<span>Click any row to open applicant profile</span>
					</div>
				</div>
			</div>
		`);

		$records.find('#rp-back').on('click', function () {
			$records.hide(); $front.show();
			window.scrollTo({ top: 0, behavior: 'smooth' });
		});
		$records.find('#rp-srch').on('input', function () {
			var q = $(this).val().toLowerCase().trim();
			var f = q ? allRows.filter(function (r) {
				var unit = r._unit;
				var nameVal = (r[unit.nameField] || r.name || '').toLowerCase();
				return nameVal.includes(q) || unit.columns.some(function (c) { return (r[c.field] || '').toLowerCase().includes(q); });
			}) : allRows;
			$records.find('#rp-body').html(buildAllTable(f));
			$records.find('#rp-cnt').text(f.length + ' records');
			$records.find('#rp-foot').text('Showing ' + f.length + ' of ' + allRows.length + ' records');
		});
		$records.find('#rp-export').on('click', function () {
			var headers = ['#', 'Name', 'Unit', 'Status'];
			var lines = [headers.join(',')];
			allRows.forEach(function (r, i) {
				var unit = r._unit;
				var name = r[unit.nameField] || r.name || '';
				var status = r[unit.status_field] || 'New Applicant';
				lines.push([i + 1, '"' + name.replace(/"/g, '""') + '"', '"' + unit.short + '"', '"' + status.replace(/"/g, '""') + '"'].join(','));
			});
			var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
			var url = URL.createObjectURL(blob);
			var a = document.createElement('a');
			a.href = url; a.download = title.replace(/[^a-zA-Z0-9._-]/g, '_') + '.csv'; a.click();
			URL.revokeObjectURL(url);
		});
		$records.off('click', '.rd-tbl tbody tr').on('click', '.rd-tbl tbody tr', function () {
			var name = $(this).data('name');
			var ui = parseInt($(this).data('ui'));
			if (!name || isNaN(ui)) return;
			var unit = UNITS[ui];
			var th = THEMES[ui];
			var row = store[ui] && store[ui].rows.find(function (r) { return r.name === name; });
			var status = row ? (row[unit.status_field] || 'New Applicant') : title;
			showProfile(unit, name, status, th);
		});
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	function buildAllTable(rows) {
		if (!rows.length) return '<div class="rd-nodata">No records found.</div>';
		var trs = rows.map(function (r, i) {
			var unit = r._unit, ui = r._ui;
			var sv = r[unit.status_field] || 'New Applicant';
			var col = SC[sType(sv)];
			var pill = '<span class="rd-spill" style="background:' + col.bg + ';color:' + col.txt + ';border-color:' + col.brd + '">' + sv + '</span>';
			var unitPill = '<span class="rd-spill" style="background:#DDEBF7;color:#1F497D;border-color:#BDD7EE">' + unit.short + '</span>';
			var name = r[unit.nameField] || r.name || '—';
			return '<tr data-name="' + (r.name || '') + '" data-ui="' + ui + '" style="animation-delay:' + Math.min(i * 0.028, 0.6) + 's">' +
				'<td class="rd-tsno">' + (i + 1) + '</td>' +
				'<td class="rd-tname" title="' + name + '">' + name + '</td>' +
				'<td>' + unitPill + '</td>' +
				'<td>' + pill + '</td>' +
				'</tr>';
		}).join('');
		return '<table class="rd-tbl"><thead><tr><th>#</th><th>Name</th><th>Unit</th><th>Status</th></tr></thead><tbody>' + trs + '</tbody></table>';
	}

	// ── Keyboard navigation (Esc = go back) ──────────────────────────────────
	document.addEventListener('keydown', function (e) {
		if (e.key !== 'Escape') return;
		if ($profile.is(':visible')) { $profile.find('.rd-back').first().trigger('click'); }
		else if ($records.is(':visible')) { $records.find('.rd-back').first().trigger('click'); }
		else if ($detail.is(':visible')) { $detail.find('.rd-back').first().trigger('click'); }
	});
};


//testing