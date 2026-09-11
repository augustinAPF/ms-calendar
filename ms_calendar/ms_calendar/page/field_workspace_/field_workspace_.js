// Field WorkSpace — landing page for Field Registration Form data.
//
// Two views, toggled by hiding/showing their containers (no routing):
//   1. Cards view (.field-ws-cards-view) — hero banner with a live total
//      count + quick search, and the "Shortcuts by State / Department"
//      dashboard (job-code chips grouped by state/department, sourced from
//      field_workspace_.py's get_job_code_shortcuts_by_state/department).
//   2. Search view (.frs-view) — full keyword + multi-select filter search
//      (search_field_registration_forms), with a live sidebar facet,
//      paginated results table, CSV export, and "open selection in the
//      native List View". Reached via "Open Search" or any dashboard
//      shortcut (openInSearch(), which pre-applies one filter and switches
//      views).
//
// All server calls hit this page's own controller, field_workspace_.py —
// kept there rather than a shared api file since this search/facet logic
// only exists to back this one page.
frappe.pages['field-workspace-'].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Field WorkSpace ',
		single_column: true
	});

	const DOCTYPE = 'Field Registration Form';

	// Dotted paths to the whitelisted methods on this page's own controller
	// (field_workspace_.py) — kept there rather than a shared api file since
	// this search/facet logic only exists to back this page's Whole Data view.
	const SEARCH_METHOD = 'ms_calendar.ms_calendar.page.field_workspace_.field_workspace_.search_field_registration_forms';
	const FACET_METHOD = 'ms_calendar.ms_calendar.page.field_workspace_.field_workspace_.get_field_registration_facet_counts';
	const EXPORT_METHOD = 'ms_calendar.ms_calendar.page.field_workspace_.field_workspace_.export_field_registration_forms';

	// Sidebar: live-count checkbox facet(s).
	const FACETS = [
		{ field: 'application_status', label: 'By Application Status' }
	];

	// Above the results table: free-typed multi-select ("type a value, press
	// Enter/comma to add it as a pill") filters — narrows results the same
	// way as the sidebar facets (AND across fields, OR within one field's
	// picked values), just for fields with too many distinct values for a
	// checkbox list to make sense.
	const PILL_FILTERS = [
		{ field: 'name', label: 'Applicant ID' },
		{ field: 'email_address', label: 'Email' },
		{ field: 'role', label: 'Role' },
		{ field: 'department', label: 'Department' },
		{ field: 'job_code', label: 'Job Code' },
		{ field: 'location', label: 'State' } // uses the Location field, not Native State — see AUTOCOMPLETE_FIELDS note below
	];

	const ALL_FILTER_FIELDS = FACETS.map((f) => f.field).concat(PILL_FILTERS.map((f) => f.field));

	// With 126K+ records now local, fetching/rendering "all" by default is
	// too slow — start at a small page and let the user step up to bigger
	// ones (or All) explicitly, same idea as Frappe's own list view page
	// size buttons. Also used to build the Export size menu.
	const PAGE_SIZES = [500, 1000, 2000, 5000, 0]; // 0 = All
	function pageSizeLabel(n) { return n === 0 ? 'All' : n.toLocaleString(); }

	// These pill filters get a dropdown of the values that actually exist in
	// the field (sourced from the same facet-count endpoint as the sidebar),
	// instead of pure free typing — Applicant ID/Email stay free-typed since
	// almost every value there is unique to one record.
	// "State" uses the `location` field, not `native_state` — Location is
	// set on ~90,782 of 126K records (mostly clean state names like
	// "Karnataka", "Rajasthan, India"), Native State on only ~1,150.
	const AUTOCOMPLETE_FIELDS = new Set(['role', 'department', 'job_code', 'location']);

	// Same status -> colour mapping used on the Field Recruitment Dashboard,
	// reused here for a bit of colour on the Application Status column/badges.
	// Select/Pass statuses use a brighter blue (#2563eb) to stay visually
	// distinct from the "in progress" statuses (#1F497D) without using
	// green — this page is blue/red only, no green anywhere.
	const STATUS_COLORS = {
		'New Applicant': '#1F497D', 'On Hold': '#6b7280', 'Blocklisted': '#dc2626',
		'CV Shortlist': '#1F497D', 'CV Reject': '#dc2626',
		'Test Process': '#1F497D', 'Test Select': '#2563eb', 'Test Reject': '#dc2626',
		'Recruiter Round': '#1F497D', 'Recruiter Round Select': '#2563eb', 'Recruiter Round Reject': '#dc2626',
		'Education Capacity Round': '#1F497D', 'Education Capacity Select': '#2563eb', 'Education Capacity Reject': '#dc2626',
		'Subject Round': '#1F497D', 'Subject Round Select': '#2563eb', 'Subject Round Reject': '#dc2626',
		'Functional Round': '#1F497D', 'Functional Round Select': '#2563eb', 'Functional Round Reject': '#dc2626',
		'Demo Round': '#1F497D', 'Demo Round Select': '#2563eb', 'Demo Round Reject': '#dc2626',
		'Leader Round-1': '#1F497D', 'Leader Round-1 Select': '#2563eb', 'Leader Round-1 Reject': '#dc2626',
		'Leader Round-2': '#1F497D', 'Leader Round-2 Select': '#2563eb', 'Leader Round-2 Reject': '#dc2626',
		'Calibration Process': '#1F497D', 'Calibration Select': '#2563eb', 'Calibration Reject': '#dc2626',
		'Document Verification Pass': '#2563eb', 'Document Verification Fail': '#dc2626',
		'Fitment Stage': '#1F497D', 'Offer': '#ca8a04', 'Pre joining': '#ca8a04', 'IT Team': '#ca8a04'
	};
	function statusColor(status) {
		return STATUS_COLORS[status] || '#6b7280';
	}

	// Alternating accent for the state/department group cards — teal +
	// purple, a higher-contrast pairing than two shades of the same blue.
	const GROUP_PALETTE = ['#0f766e', '#6d28d9'];
	function groupAccent(idx) {
		return GROUP_PALETTE[idx % GROUP_PALETTE.length];
	}

	function openWholeData() {
		$cardsView.hide();
		$searchView.show();
		runSearch();
	}

	function backToCards() {
		$searchView.hide();
		$cardsView.show();
	}

	// ── Markup + styles ───────────────────────────────────────────────────

	$(wrapper).find('.page-content').append(`
		<style>
			.field-ws-cards-view {
				background: linear-gradient(180deg, #f7faf8 0%, #f5f7fb 220px, #f8fafc 100%);
				padding-bottom: 4px;
			}
			.fov-hero {
				margin: 20px;
				padding: 28px 32px;
				border-radius: 14px;
				background: linear-gradient(120deg, #1F497D 0%, #16385f 100%);
				color: #fff;
				box-shadow: 0 8px 24px rgba(31,73,125,0.25);
			}
			.fov-hero-top {
				display: flex;
				align-items: center;
				gap: 24px;
			}
			.fov-hero-text { flex: 1; min-width: 220px; }
			.fov-hero-text h2 {
				margin: 0 0 6px;
				font-size: 21px;
				font-weight: 700;
			}
			.fov-hero-text p {
				margin: 0;
				font-size: 12.5px;
				color: #cbd8ea;
				max-width: 480px;
			}
			.fov-hero-stat { text-align: right; padding: 0 16px; }
			.fov-hero-count {
				font-size: 34px;
				font-weight: 700;
				line-height: 1;
				color: #fff;
			}
			.fov-hero-count.is-loading { font-size: 15px; color: #cbd8ea; font-weight: 500; }
			@keyframes fovHeroCountPop {
				0%   { transform: scale(0.7); opacity: 0; }
				70%  { transform: scale(1.1); }
				100% { transform: scale(1);   opacity: 1; }
			}
			.fov-hero-count.is-loaded { animation: fovHeroCountPop 0.35s ease; }
			.fov-hero-count-label {
				font-size: 10.5px;
				text-transform: uppercase;
				letter-spacing: 0.05em;
				color: #cbd8ea;
				margin-top: 4px;
			}
			.fov-hero-btn {
				display: inline-flex;
				align-items: center;
				gap: 8px;
				background: #2563eb;
				color: #fff;
				border: none;
				border-radius: 8px;
				padding: 12px 22px;
				font-size: 13px;
				font-weight: 600;
				cursor: pointer;
				white-space: nowrap;
				transition: background 0.15s, transform 0.15s;
			}
			.fov-hero-btn:hover { background: #1d4ed8; transform: translateY(-1px); }
			.fov-hero-search {
				display: flex;
				align-items: center;
				gap: 10px;
				background: rgba(255,255,255,0.96);
				border-radius: 10px;
				padding: 6px 6px 6px 16px;
				margin-top: 20px;
			}
			.fov-hero-search-icon { color: #9ca3af; font-size: 14px; }
			.fov-hero-search-input {
				flex: 1;
				border: none;
				outline: none;
				background: transparent;
				font-size: 13.5px;
				color: #111827;
				padding: 8px 0;
			}
			.fov-hero-search-input::placeholder { color: #9ca3af; }
			@media (max-width: 700px) {
				.fov-hero-top { flex-wrap: wrap; }
				.fov-hero-stat { text-align: left; padding: 0; }
			}
			.fov-section-icon { color: #9ca3af; font-size: 13px; margin-right: 2px; }

			/* ── Field overview dashboard (Shortcuts by Department) —
			   mirrors the cloud "Field" workspace's role/job-code shortcuts ── */
			.fov-section {
				padding: 20px;
				margin: 0 20px 20px;
				background: #fff;
				border: 1px solid #e5e7eb;
				border-radius: 12px;
			}
			.fov-section h3 {
				display: flex;
				align-items: baseline;
				gap: 8px;
				font-size: 14px;
				font-weight: 700;
				color: #111827;
				margin: 0 0 14px;
			}
			.fov-section-sub {
				font-size: 11px;
				font-weight: 500;
				text-transform: uppercase;
				letter-spacing: 0.03em;
				color: #9ca3af;
			}
			#fov-role-groups, #fov-state-groups {
				display: grid;
				grid-template-columns: repeat(3, 1fr);
				gap: 12px;
				align-items: start;
			}
			@media (max-width: 900px) {
				#fov-role-groups, #fov-state-groups { grid-template-columns: repeat(2, 1fr); }
			}
			@media (max-width: 600px) {
				#fov-role-groups, #fov-state-groups { grid-template-columns: 1fr; }
			}
			.fov-dept-group {
				/* --accent set per-card in JS (groupAccent()) — alternates
				   between teal and purple (GROUP_PALETTE) so adjacent cards
				   are easy to tell apart at a glance. */
				--accent: #0f766e;
				background: #fafbfc;
				border: 1px solid #eef0f2;
				border-left: 4px solid var(--accent);
				border-radius: 10px;
				padding: 14px 16px;
				transition: box-shadow 0.2s, transform 0.2s, border-color 0.2s;
				opacity: 0;
				animation: fovCardIn 0.35s ease forwards;
				animation-delay: var(--stagger, 0s);
			}
			@keyframes fovCardIn {
				from { opacity: 0; transform: translateY(6px); }
				to   { opacity: 1; transform: translateY(0); }
			}
			.fov-dept-group:hover {
				box-shadow: 0 4px 16px rgba(31,73,125,0.12);
				transform: translateY(-2px);
			}
			.fov-dept-group.collapsed { padding-bottom: 14px; }
			.fov-dept-group-head {
				display: flex;
				align-items: center;
				gap: 8px;
				margin-bottom: 10px;
				cursor: pointer;
			}
			.fov-dept-group.collapsed .fov-dept-group-head { margin-bottom: 0; }
			.fov-dept-chevron {
				display: inline-flex;
				color: #9ca3af;
				transition: transform 0.25s ease;
				font-size: 10px;
			}
			.fov-dept-group.collapsed .fov-dept-chevron { transform: rotate(-90deg); }
			.fov-dept-group-head h4 {
				font-size: 13px;
				font-weight: 700;
				color: var(--accent);
				margin: 0;
			}
			.fov-dept-group-head:hover h4 { text-decoration: underline; }
			.fov-dept-group-head .fov-dept-total {
				font-size: 11px;
				color: #fff;
				background: var(--accent);
				border-radius: 999px;
				padding: 1px 9px;
				cursor: pointer;
				transition: filter 0.15s;
			}
			.fov-dept-group-head .fov-dept-total:hover { filter: brightness(0.85); }
			.fov-role-grid {
				display: grid;
				grid-template-rows: 1fr;
				gap: 8px;
				overflow: hidden;
				transition: grid-template-rows 0.25s ease, opacity 0.2s ease, margin-top 0.25s ease;
				margin-top: 2px;
			}
			.fov-role-grid > div { overflow: hidden; display: flex; flex-wrap: wrap; gap: 8px; }
			.fov-dept-group.collapsed .fov-role-grid {
				grid-template-rows: 0fr;
				opacity: 0;
				margin-top: 0;
			}
			.fov-role-chip {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				background: #eef2fb;
				border: 1px solid #d6e4f5;
				border-radius: 999px;
				padding: 5px 12px;
				font-size: 12px;
				color: #16385f;
				cursor: pointer;
				transition: background 0.15s, transform 0.15s;
			}
			.fov-role-chip:hover { background: #d6e4f5; transform: translateY(-1px); }
			.fov-role-chip .fov-role-count {
				background: #1F497D;
				color: #fff;
				border-radius: 999px;
				padding: 0 7px;
				font-size: 11px;
				font-weight: 700;
			}
			.fov-loading { font-size: 12px; color: #9ca3af; padding: 8px 0; }

			/* ── Whole Data search view ─────────────────────────────────── */
			.frs-view {
				padding: 16px 20px 24px;
				background: linear-gradient(180deg, #eef2fb 0%, #f5f7fb 45%, #f8fafc 100%);
			}
			.frs-back {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				font-size: 12.5px;
				font-weight: 600;
				color: #fff;
				background: #1F497D;
				border-radius: 999px;
				padding: 5px 14px 5px 10px;
				cursor: pointer;
				margin-bottom: 14px;
			}
			.frs-back:hover { background: #16385f; }
			.frs-searchbar {
				display: flex;
				gap: 10px;
				align-items: flex-start;
				background: #fff;
				border: 1px solid #e5e7eb;
				border-left: 4px solid #1F497D;
				border-radius: 10px;
				padding: 14px;
				box-shadow: 0 2px 10px rgba(31,73,125,0.06);
			}
			.frs-keywords {
				flex: 1;
				min-height: 40px;
				max-height: 90px;
				resize: vertical;
				border: 1px solid #d1d5db;
				border-radius: 6px;
				padding: 8px 10px;
				font-size: 13px;
			}
			.frs-keywords:focus { outline: none; border-color: #1F497D; }
			.frs-search-btn {
				background: #2563eb;
				color: #fff;
				border: none;
				border-radius: 6px;
				padding: 8px 18px;
				font-size: 13px;
				font-weight: 600;
				cursor: pointer;
				white-space: nowrap;
			}
			.frs-search-btn:hover { background: #1d4ed8; }
			.frs-toolbar {
				display: flex;
				align-items: center;
				gap: 12px;
				margin-top: 10px;
			}
			.frs-result-count {
				display: inline-block;
				font-size: 12px;
				color: #1F497D;
				background: #eef2fb;
				border-radius: 999px;
				padding: 4px 12px;
			}
			.frs-result-count b { color: #1F497D; font-size: 13px; }
			.frs-page-size {
				display: flex;
				gap: 4px;
				margin-left: auto;
			}
			.frs-page-size-btn {
				background: #fff;
				border: 1px solid #d1d5db;
				border-radius: 6px;
				padding: 4px 12px;
				font-size: 12px;
				color: #374151;
				cursor: pointer;
			}
			.frs-page-size-btn:hover { border-color: #1F497D; }
			.frs-page-size-btn.active {
				background: #1F497D;
				border-color: #1F497D;
				color: #fff;
				font-weight: 600;
			}
			.frs-open-list-btn {
				background: #1F497D;
				color: #fff;
				border: none;
				border-radius: 6px;
				padding: 5px 14px;
				font-size: 12px;
				font-weight: 600;
				cursor: pointer;
			}
			.frs-open-list-btn:hover { background: #16385f; }
			.frs-export { position: relative; }
			.frs-export-btn {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				background: #2563eb;
				color: #fff;
				border: none;
				border-radius: 6px;
				padding: 5px 14px;
				font-size: 12px;
				font-weight: 600;
				cursor: pointer;
			}
			.frs-export-btn:hover { background: #1d4ed8; }
			.frs-export-btn:disabled { opacity: 0.6; cursor: wait; }
			.frs-export-menu {
				display: none;
				position: absolute;
				top: calc(100% + 6px);
				right: 0;
				z-index: 20;
				background: #fff;
				border: 1px solid #d1d5db;
				border-radius: 8px;
				box-shadow: 0 6px 18px rgba(0,0,0,0.15);
				min-width: 160px;
				overflow: hidden;
			}
			.frs-export.open .frs-export-menu { display: block; }
			.frs-export-menu-item {
				display: flex;
				justify-content: space-between;
				gap: 8px;
				padding: 8px 14px;
				font-size: 12.5px;
				color: #374151;
				cursor: pointer;
			}
			.frs-export-menu-item:hover { background: #eef2fb; }
			.frs-export-menu-item .frs-export-menu-hint { color: #9ca3af; font-size: 11px; }
			.frs-pills {
				display: flex;
				flex-wrap: wrap;
				gap: 8px;
				align-items: center;
				margin: 10px 0 0;
			}
			.frs-pill {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				background: #eef2ff;
				color: #1F497D;
				border-radius: 999px;
				padding: 4px 10px;
				font-size: 12px;
			}
			.frs-pill .frs-pill-x {
				cursor: pointer;
				font-weight: 700;
				opacity: 0.6;
			}
			.frs-pill .frs-pill-x:hover { opacity: 1; }
			.frs-clear-all {
				font-size: 12px;
				color: #dc2626;
				cursor: pointer;
			}
			.frs-clear-all:hover { text-decoration: underline; }

			/* Multi-select pill filters above the table */
			.frs-filter-row {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
				gap: 10px;
				margin-top: 12px;
			}
			.frs-multiselect {
				position: relative;
				background: #fff;
				border: 1px solid #e5e7eb;
				border-radius: 8px;
				padding: 8px 10px;
				border-top: 3px solid #1F497D;
			}
			.frs-multiselect label {
				display: block;
				font-size: 10.5px;
				text-transform: uppercase;
				letter-spacing: 0.03em;
				color: #6b7280;
				margin-bottom: 5px;
			}
			.frs-multiselect input[type="text"] {
				width: 100%;
				border: 1px solid #d1d5db;
				border-radius: 5px;
				padding: 4px 7px;
				font-size: 12px;
			}
			.frs-multiselect input[type="text"]:focus { outline: none; border-color: #1F497D; }
			.frs-multiselect-chips {
				display: flex;
				flex-wrap: wrap;
				gap: 4px;
				margin-top: 6px;
			}
			.frs-chip {
				display: inline-flex;
				align-items: center;
				gap: 4px;
				background: #eef2fb;
				color: #1F497D;
				border-radius: 999px;
				padding: 2px 8px;
				font-size: 11px;
			}
			.frs-chip .frs-chip-x { cursor: pointer; font-weight: 700; opacity: 0.6; }
			.frs-chip .frs-chip-x:hover { opacity: 1; }

			/* Date Applied — From/To range box, same shell as the other
			   above-table filter boxes (.frs-multiselect) */
			.frs-date-range { display: flex; align-items: center; gap: 5px; }
			.frs-date-range input[type="date"] {
				flex: 1 1 0;
				min-width: 0;
				border: 1px solid #d1d5db;
				border-radius: 5px;
				padding: 4px 5px;
				font-size: 11.5px;
				color: #374151;
			}
			.frs-date-range input[type="date"]:focus { outline: none; border-color: #1F497D; }
			.frs-date-sep { color: #9ca3af; font-size: 11px; }

			/* Role / Department / Job Code — chip-box + dropdown panel
			   multiselect (same widget style as the Field Over All Dashboard) */
			.frs-ms { position: relative; }
			.frs-ms-box {
				display: flex;
				flex-wrap: wrap;
				align-items: center;
				gap: 4px;
				min-height: 22px;
				cursor: pointer;
			}
			.frs-ms-ph { font-size: 12px; color: #9ca3af; }
			.frs-ms-chip {
				display: inline-flex;
				align-items: center;
				gap: 4px;
				background: #eef2fb;
				color: #1F497D;
				border-radius: 4px;
				padding: 1px 5px 1px 7px;
				font-size: 11px;
				font-weight: 600;
				max-width: 120px;
			}
			.frs-ms-chip .txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.frs-ms-chip .x { cursor: pointer; font-size: 12px; line-height: 1; opacity: 0.7; }
			.frs-ms-chip .x:hover { opacity: 1; }
			.frs-ms-more { font-size: 11px; color: #6b7280; font-weight: 600; }
			.frs-ms-panel {
				display: none;
				position: absolute;
				top: calc(100% + 6px);
				left: 0; right: 0;
				z-index: 20;
				background: #fff;
				border: 1px solid #d1d5db;
				border-radius: 8px;
				box-shadow: 0 6px 18px rgba(0,0,0,0.15);
				max-height: 260px;
				overflow-y: auto;
			}
			.frs-ms.open .frs-ms-panel { display: block; }
			.frs-ms.open .frs-ms-box { outline: 2px solid rgba(31,73,125,0.15); border-radius: 4px; }
			.frs-ms-search { position: sticky; top: 0; background: #fff; padding: 6px; border-bottom: 1px solid #eee; }
			.frs-ms-search input { width: 100%; padding: 4px 7px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px; }
			.frs-ms-actions { display: flex; justify-content: space-between; padding: 5px 8px; border-bottom: 1px solid #eee; font-size: 11px; }
			.frs-ms-actions a { color: #1F497D; cursor: pointer; font-weight: 600; }
			.frs-ms-opt { display: flex; align-items: center; gap: 7px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
			.frs-ms-opt:hover { background: #eef2fb; }
			.frs-ms-opt input { margin: 0; cursor: pointer; }
			.frs-ms-opt-count { margin-left: auto; color: #9ca3af; }
			.frs-ms-empty { padding: 10px; font-size: 12px; color: #9ca3af; text-align: center; }

			.frs-body {
				display: grid;
				grid-template-columns: 1fr 260px;
				gap: 16px;
				margin-top: 16px;
				align-items: start;
			}
			.frs-results {
				background: #fff;
				border: 1px solid #e5e7eb;
				border-top: 3px solid #ca8a04;
				border-radius: 10px;
				overflow-x: auto;
				box-shadow: 0 2px 10px rgba(31,73,125,0.06);
			}
			.frs-results table {
				width: 100%;
				border-collapse: collapse;
				font-size: 12.5px;
			}
			.frs-results th {
				text-align: left;
				padding: 10px 12px;
				background: #1F497D;
				color: #fff;
				font-weight: 600;
				white-space: nowrap;
			}
			.frs-results td {
				padding: 9px 12px;
				border-bottom: 1px solid #f3f4f6;
				white-space: nowrap;
			}
			.frs-check-cell { width: 32px; text-align: center !important; padding-left: 14px !important; }
			.frs-check-cell input { cursor: pointer; }
			.frs-results tr:last-child td { border-bottom: none; }
			.frs-results tbody tr:nth-child(even) td { background: #f8fafc; }
			.frs-results tr:hover td { background: #eef2fb; }
			.frs-id-link { color: #1F497D; cursor: pointer; font-weight: 600; }
			.frs-id-link:hover { text-decoration: underline; }
			.frs-status-badge {
				display: inline-block;
				padding: 2px 9px;
				border-radius: 999px;
				font-size: 11px;
				font-weight: 600;
				color: #fff;
			}
			.frs-empty { padding: 30px; text-align: center; color: #9ca3af; font-size: 13px; }
			.frs-sidebar {
				display: flex;
				flex-direction: column;
				gap: 14px;
			}
			.frs-facet {
				background: #fff;
				border: 1px solid #e5e7eb;
				border-radius: 10px;
				padding: 14px;
				border-top: 3px solid #2563eb;
			}
			.frs-facet-head {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 8px;
				margin-bottom: 10px;
			}
			.frs-facet h4 {
				font-size: 12px;
				text-transform: uppercase;
				letter-spacing: 0.03em;
				color: #6b7280;
				margin: 0;
			}
			.frs-facet-selectall {
				display: flex;
				align-items: center;
				gap: 4px;
				font-size: 11px;
				font-weight: 600;
				color: #1F497D;
				cursor: pointer;
				white-space: nowrap;
			}
			.frs-facet-selectall input { cursor: pointer; }
			.frs-facet-options {
				display: flex;
				flex-direction: column;
				gap: 7px;
				max-height: 420px;
				overflow-y: auto;
			}
			.frs-facet-option {
				display: flex;
				align-items: center;
				gap: 8px;
				font-size: 12.5px;
				color: #374151;
				cursor: pointer;
			}
			.frs-facet-option input { cursor: pointer; }
			.frs-facet-dot {
				width: 8px;
				height: 8px;
				border-radius: 50%;
				flex-shrink: 0;
			}
			.frs-facet-option .frs-facet-count {
				margin-left: auto;
				background: #f3f4f6;
				color: #374151;
				border-radius: 999px;
				padding: 1px 8px;
				font-size: 11px;
				font-weight: 600;
			}
			.frs-facet-empty { font-size: 12px; color: #9ca3af; }
		</style>
		<div class="field-ws-cards-view">
			<div class="fov-hero">
				<div class="fov-hero-top">
					<div class="fov-hero-text">
						<h2>Field Registration Workspace</h2>
						<p>Search, filter and export every Field Registration Form record — or jump straight to a state or department below.</p>
					</div>
					<div class="fov-hero-stat">
						<div class="fov-hero-count is-loading">…</div>
						<div class="fov-hero-count-label">Total Records</div>
					</div>
				</div>
				<div class="fov-hero-search">
					<i class="octicon octicon-search fov-hero-search-icon"></i>
					<input type="text" class="fov-hero-search-input" placeholder="Search by ID, name, email, phone, role or job code…">
					<button class="fov-hero-btn"><i class="octicon octicon-search"></i> Search</button>
				</div>
			</div>

			<div class="fov-section">
				<h3><i class="octicon octicon-location fov-section-icon"></i> Shortcuts by State <span class="fov-section-sub">Job Code wise</span></h3>
				<div id="fov-state-groups"></div>
			</div>

			<div class="fov-section">
				<h3><i class="octicon octicon-organization fov-section-icon"></i> Shortcuts by Department <span class="fov-section-sub">Job Code wise</span></h3>
				<div id="fov-role-groups"></div>
			</div>
		</div>
		<div class="frs-view" style="display:none;">
			<div class="frs-back"><i class="octicon octicon-arrow-left"></i> Back to Field WorkSpace</div>
			<div class="frs-searchbar">
				<textarea class="frs-keywords" placeholder="Paste IDs, names, emails, phone numbers, roles or job codes — separated by space, comma, or newline"></textarea>
				<button class="frs-search-btn">Search</button>
			</div>
			<div class="frs-filter-row"></div>
			<div class="frs-toolbar">
				<div class="frs-result-count"></div>
				<div class="frs-page-size"></div>
				<div class="frs-export">
					<button class="frs-export-btn"><i class="octicon octicon-desktop-download"></i> Export</button>
					<div class="frs-export-menu"></div>
				</div>
				<button class="frs-open-list-btn" style="display:none;">Open in List View</button>
			</div>
			<div class="frs-pills"></div>
			<div class="frs-body">
				<div class="frs-results"></div>
				<div class="frs-sidebar"></div>
			</div>
		</div>
	`);

	const $cardsView = $(wrapper).find('.field-ws-cards-view');
	const $searchView = $(wrapper).find('.frs-view');
	const $keywords = $(wrapper).find('.frs-keywords');
	const $searchBtn = $(wrapper).find('.frs-search-btn');
	const $filterRow = $(wrapper).find('.frs-filter-row');
	const $resultCount = $(wrapper).find('.frs-result-count');
	const $pageSize = $(wrapper).find('.frs-page-size');
	const $export = $(wrapper).find('.frs-export');
	const $exportBtn = $(wrapper).find('.frs-export-btn');
	const $exportMenu = $(wrapper).find('.frs-export-menu');
	const $openListBtn = $(wrapper).find('.frs-open-list-btn');
	const $pills = $(wrapper).find('.frs-pills');
	const $results = $(wrapper).find('.frs-results');
	const $sidebar = $(wrapper).find('.frs-sidebar');

	$(wrapper).find('.frs-back').on('click', backToCards);
	$searchBtn.on('click', () => runSearch());
	$keywords.on('keydown', (e) => {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runSearch();
	});

	// ── Export dropdown: same size options as the page-size buttons ────────
	PAGE_SIZES.forEach((n) => {
		const $item = $(`
			<div class="frs-export-menu-item">
				<span>${pageSizeLabel(n)}</span>
				<span class="frs-export-menu-hint">rows</span>
			</div>
		`);
		$item.on('click', () => {
			$export.removeClass('open');
			exportCsv(n);
		});
		$exportMenu.append($item);
	});

	$exportBtn.on('click', (e) => {
		e.stopPropagation();
		$export.toggleClass('open');
	});
	$(document).off('click.frsExportOutside').on('click.frsExportOutside', (e) => {
		if ($(e.target).closest('.frs-export').length) return;
		$export.removeClass('open');
	});

	function exportCsv(limit) {
		const keywords = ($keywords.val() || '').trim();
		const originalLabel = $exportBtn.html();
		$exportBtn.prop('disabled', true).html('<i class="octicon octicon-sync"></i> Exporting…');

		frappe.call({
			method: EXPORT_METHOD,
			args: {
				keywords: keywords,
				filters: JSON.stringify(buildFilters()),
				limit: limit
			}
		}).then((r) => {
			const csvText = r.message || '';
			const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
			const url = URL.createObjectURL(blob);
			const stamp = frappe.datetime.now_datetime().replace(/[: ]/g, '-');
			const $a = $(`<a href="${url}" download="field_registration_form_${pageSizeLabel(limit).replace(',', '')}_${stamp}.csv"></a>`);
			$('body').append($a);
			$a[0].click();
			$a.remove();
			URL.revokeObjectURL(url);
		}).always(() => {
			$exportBtn.prop('disabled', false).html(originalLabel);
		});
	}

	// Front-page search bar — jumps into the Whole Data search view with
	// whatever was typed here already applied, instead of making people
	// click "Open Search" first and type it again there.
	const $heroSearchInput = $(wrapper).find('.fov-hero-search-input');
	function runHeroSearch() {
		$keywords.val($heroSearchInput.val());
		openWholeData();
	}
	$(wrapper).find('.fov-hero-btn').on('click', runHeroSearch);
	$heroSearchInput.on('keydown', (e) => {
		if (e.key === 'Enter') runHeroSearch();
	});

	const $heroCount = $(wrapper).find('.fov-hero-count');
	frappe.db.count(DOCTYPE).then((count) => {
		$heroCount.removeClass('is-loading').addClass('is-loaded').text(cint(count).toLocaleString());
	}).catch(() => {
		$heroCount.removeClass('is-loading').text('—');
	});

	// ── Field overview dashboard — mirrors the cloud "Field" workspace:
	// Candidate Screening stats, Sub Unit wise totals, and role shortcuts
	// grouped by department. Every card/chip opens inside our own Field
	// Registration Search view (Whole Data), scoped to just that filter,
	// rather than the plain native List View.

	// Populated once the pill-filter widgets below are built — lets a
	// dashboard shortcut click visually pre-fill the matching filter box
	// (not just apply the filter under the hood).
	const msControls = {}; // field -> {setSelected, getSelected} from makeMultiselect
	const chipWidgets = {}; // field -> $widget for the free-typed chip inputs

	function clearAllFilterUI() {
		$keywords.val('');
		ALL_FILTER_FIELDS.forEach((f) => state.filters[f].clear());
		Object.keys(msControls).forEach((f) => msControls[f].setSelected([]));
		Object.keys(chipWidgets).forEach((f) => renderChips(chipWidgets[f], f));
	}

	// A dashboard shortcut represents "show me just this" — clears every
	// other active filter/keyword first, then applies the one that was
	// clicked, and opens the search view scoped to it.
	function openInSearch(filterField, value) {
		$cardsView.hide();
		$searchView.show();

		clearAllFilterUI();
		state.filters[filterField].add(value);
		if (msControls[filterField]) msControls[filterField].setSelected([value]);
		if (chipWidgets[filterField]) renderChips(chipWidgets[filterField], filterField);

		runSearch();
	}

	// Shared renderer for both "Shortcuts by Department" and "Shortcuts by
	// State" — same shape from the backend ({<groupKey>, total, shortcuts}),
	// just a different group field and a different container to render into.
	function renderJobCodeGroups(method, containerId, groupKey, groupFilterField) {
		frappe.call({
			method: `ms_calendar.ms_calendar.page.field_workspace_.field_workspace_.${method}`
		}).then((r) => {
			const $wrap = $(wrapper).find(`#${containerId}`).empty();
			const groups = r.message || [];

			groups.forEach((group, idx) => {
				const groupValue = group[groupKey];
				const accent = groupAccent(idx);

				// Collapsed by default — with dozens of groups × up to 12
				// chips each, showing everything expanded made the page huge.
				const $card = $(`
					<div class="fov-dept-group collapsed" style="--accent:${accent}; --stagger:${Math.min(idx * 0.03, 0.6)}s">
						<div class="fov-dept-group-head">
							<i class="fov-dept-chevron octicon octicon-chevron-down"></i>
							<h4>${frappe.utils.escape_html(groupValue)}</h4>
							<span class="fov-dept-total" title="Open in search">${group.total.toLocaleString()}</span>
						</div>
						<div class="fov-role-grid"><div class="fov-role-grid-inner"></div></div>
					</div>
				`);
				$card.find('.fov-dept-group-head').on('click', (e) => {
					if ($(e.target).hasClass('fov-dept-total')) return; // handled below
					$card.toggleClass('collapsed');
				});
				$card.find('.fov-dept-total').on('click', (e) => {
					e.stopPropagation();
					openInSearch(groupFilterField, groupValue);
				});

				const $roleGrid = $card.find('.fov-role-grid-inner');
				group.shortcuts.forEach((s) => {
					// Label with the matching Job Opening's title when we have one
					// (e.g. "School Teacher - Yadgir (20020)"), else just the code.
					const label = s.job_title
						? `${s.job_title} (${s.job_code})`
						: s.job_code;
					const $chip = $(`
						<span class="fov-role-chip" title="Job Code ${frappe.utils.escape_html(s.job_code)}">
							${frappe.utils.escape_html(label)}
							<span class="fov-role-count">${s.count.toLocaleString()}</span>
						</span>
					`);
					$chip.on('click', (e) => {
						e.stopPropagation();
						openInSearch('job_code', s.job_code);
					});
					$roleGrid.append($chip);
				});

				$wrap.append($card);
			});
		});
	}

	renderJobCodeGroups('get_role_shortcuts_by_department', 'fov-role-groups', 'department', 'department');
	renderJobCodeGroups('get_job_code_shortcuts_by_state', 'fov-state-groups', 'state', 'location');

	// ── Field Registration Search state ────────────────────────────────────

	const state = {
		filters: {},
		// date_of_applied is a plain Date field, not a discrete set of
		// values like the other filters above, so it gets its own From/To
		// pair instead of living in state.filters as a Set.
		dateFilters: { date_of_applied: { from: '', to: '' } },
		selected: new Set(), // names of rows checked in the results table
		page_length: PAGE_SIZES[0]
	};
	ALL_FILTER_FIELDS.forEach((field) => { state.filters[field] = new Set(); });

	// Build the AND filter list from every field's picked values, optionally
	// leaving one field's own filter out (used when refreshing that field's
	// own facet/option list, so its other options don't zero out).
	function buildFilters(excludeField) {
		const filters = [];
		ALL_FILTER_FIELDS.forEach((field) => {
			if (field === excludeField) return;
			if (state.filters[field].size) {
				filters.push([field, 'in', Array.from(state.filters[field])]);
			}
		});
		const { from, to } = state.dateFilters.date_of_applied;
		if (from) filters.push(['date_of_applied', '>=', from]);
		if (to) filters.push(['date_of_applied', '<=', to]);
		return filters;
	}

	function fieldLabel(field) {
		const hit = FACETS.concat(PILL_FILTERS).find((f) => f.field === field);
		return hit ? hit.label.replace('By ', '') : field;
	}

	function renderPills() {
		$pills.empty();

		const keywords = ($keywords.val() || '').trim();
		if (keywords) {
			const $pill = $(`<span class="frs-pill">Keywords: ${frappe.utils.escape_html(keywords)} <span class="frs-pill-x">×</span></span>`);
			$pill.find('.frs-pill-x').on('click', () => {
				$keywords.val('');
				runSearch();
			});
			$pills.append($pill);
		}

		ALL_FILTER_FIELDS.forEach((field) => {
			state.filters[field].forEach((value) => {
				const $pill = $(`<span class="frs-pill">${frappe.utils.escape_html(fieldLabel(field))}: ${frappe.utils.escape_html(value)} <span class="frs-pill-x">×</span></span>`);
				$pill.find('.frs-pill-x').on('click', () => {
					state.filters[field].delete(value);
					runSearch();
				});
				$pills.append($pill);
			});
		});

		const { from: appliedFrom, to: appliedTo } = state.dateFilters.date_of_applied;
		if (appliedFrom || appliedTo) {
			const valueText = appliedFrom && appliedTo
				? `${appliedFrom} to ${appliedTo}`
				: appliedFrom ? `from ${appliedFrom}` : `to ${appliedTo}`;
			const $pill = $(`<span class="frs-pill">Date Applied: ${frappe.utils.escape_html(valueText)} <span class="frs-pill-x">×</span></span>`);
			$pill.find('.frs-pill-x').on('click', () => {
				state.dateFilters.date_of_applied = { from: '', to: '' };
				$(wrapper).find('.frs-date-from').val('');
				$(wrapper).find('.frs-date-to').val('');
				runSearch();
			});
			$pills.append($pill);
		}

		if (keywords || appliedFrom || appliedTo || Object.values(state.filters).some((s) => s.size)) {
			const $clear = $('<span class="frs-clear-all">Clear All</span>');
			$clear.on('click', () => {
				$keywords.val('');
				ALL_FILTER_FIELDS.forEach((field) => state.filters[field].clear());
				state.dateFilters.date_of_applied = { from: '', to: '' };
				$(wrapper).find('.frs-date-from').val('');
				$(wrapper).find('.frs-date-to').val('');
				runSearch();
			});
			$pills.append($clear);
		}
	}

	// Every matching row is fetched and rendered in one go (no "Load More" —
	// building one HTML string + delegated events instead of per-row jQuery
	// objects/handlers keeps this fast even for the full unfiltered set).
	function renderResults(rows, total) {
		$results.empty();

		if (!total) {
			$results.html('<div class="frs-empty">No matching records</div>');
			updateOpenListButton();
			return;
		}

		const $table = $(`
			<table>
				<thead>
					<tr>
						<th class="frs-check-cell"><input type="checkbox" class="frs-select-all-rows"></th>
						<th>ID</th>
						<th>Applicant Name</th>
						<th>Phone</th>
						<th>Email</th>
						<th>Role</th>
						<th>Department</th>
						<th>Job Code</th>
						<th>Application Status</th>
						<th>Applied On</th>
						<th>Date Applied</th>
					</tr>
				</thead>
				<tbody></tbody>
			</table>
		`);
		const $tbody = $table.find('tbody');

		const rowsHtml = rows.map((row) => {
			const statusHtml = row.application_status
				? `<span class="frs-status-badge" style="background:${statusColor(row.application_status)}">${frappe.utils.escape_html(row.application_status)}</span>`
				: '';
			const checked = state.selected.has(row.name);
			const name = frappe.utils.escape_html(row.name);
			return `
				<tr data-name="${name}">
					<td class="frs-check-cell"><input type="checkbox" class="frs-row-check" ${checked ? 'checked' : ''}></td>
					<td><span class="frs-id-link">${name}</span></td>
					<td>${frappe.utils.escape_html(row.full_name_aadhaar || '')}</td>
					<td>${frappe.utils.escape_html(row.phone_number || '')}</td>
					<td>${frappe.utils.escape_html(row.email_address || '')}</td>
					<td>${frappe.utils.escape_html(row.role || '')}</td>
					<td>${frappe.utils.escape_html(row.department || '')}</td>
					<td>${frappe.utils.escape_html(row.job_code || '')}</td>
					<td>${statusHtml}</td>
					<td>${frappe.datetime.str_to_user(row.creation)}</td>
					<td>${row.date_of_applied ? frappe.datetime.str_to_user(row.date_of_applied) : ''}</td>
				</tr>
			`;
		}).join('');
		$tbody.html(rowsHtml);

		// Delegated handlers (bound once on the table) instead of per-row —
		// matters once this table can hold thousands of rows.
		$table.on('change', '.frs-select-all-rows', function () {
			const checked = this.checked;
			$tbody.find('.frs-row-check').each(function () {
				this.checked = checked;
				const name = $(this).closest('tr').data('name').toString();
				if (checked) state.selected.add(name);
				else state.selected.delete(name);
			});
			updateOpenListButton();
		});
		$tbody.on('click', '.frs-id-link', function () {
			frappe.set_route('Form', DOCTYPE, $(this).closest('tr').data('name').toString());
		});
		$tbody.on('change', '.frs-row-check', function () {
			const name = $(this).closest('tr').data('name').toString();
			if (this.checked) state.selected.add(name);
			else state.selected.delete(name);
			updateOpenListButton();
		});

		$results.append($table);
		updateOpenListButton();
	}

	// ── Sidebar: Application Status facet (checkboxes + live counts) ──────

	function renderFacet(field, label, options) {
		let $facet = $sidebar.find(`.frs-facet[data-field="${field}"]`);
		if (!$facet.length) {
			$facet = $(`
				<div class="frs-facet" data-field="${field}">
					<div class="frs-facet-head">
						<h4>${label}</h4>
						<label class="frs-facet-selectall">
							<input type="checkbox" class="frs-select-all"> Select All
						</label>
					</div>
					<div class="frs-facet-options"></div>
				</div>
			`);
			$sidebar.append($facet);
		}

		const $optionsWrap = $facet.find('.frs-facet-options').empty();
		const $selectAll = $facet.find('.frs-select-all');

		if (!options.length) {
			$optionsWrap.append('<div class="frs-facet-empty">No data</div>');
			$selectAll.prop({ checked: false, indeterminate: false, disabled: true });
			return;
		}

		const allChecked = options.every((opt) => state.filters[field].has(opt.value));
		const someChecked = options.some((opt) => state.filters[field].has(opt.value));
		$selectAll
			.prop({ disabled: false, checked: allChecked, indeterminate: !allChecked && someChecked })
			.off('change')
			.on('change', function () {
				if (this.checked) options.forEach((opt) => state.filters[field].add(opt.value));
				else options.forEach((opt) => state.filters[field].delete(opt.value));
				runSearch();
			});

		options.forEach((opt) => {
			const checked = state.filters[field].has(opt.value);
			const dotColor = field === 'application_status' ? statusColor(opt.value) : '#1F497D';
			const $label = $(`
				<label class="frs-facet-option">
					<input type="checkbox" ${checked ? 'checked' : ''}>
					<span class="frs-facet-dot" style="background:${dotColor}"></span>
					<span>${frappe.utils.escape_html(opt.value)}</span>
					<span class="frs-facet-count">${opt.count}</span>
				</label>
			`);
			$label.find('input').on('change', function () {
				if (this.checked) state.filters[field].add(opt.value);
				else state.filters[field].delete(opt.value);
				runSearch();
			});
			$optionsWrap.append($label);
		});
	}

	function refreshFacets() {
		const keywords = ($keywords.val() || '').trim();
		FACETS.forEach(({ field, label }) => {
			frappe.call({
				method: FACET_METHOD,
				args: {
					field: field,
					keywords: keywords,
					filters: JSON.stringify(buildFilters(field))
				}
			}).then((r) => renderFacet(field, label, r.message || []));
		});
	}

	// ── Above-table: Applicant ID / Email — free-typed chip inputs ─────────
	// (no fixed value list to pick from, so this stays type-and-press-Enter)

	function renderChips($widget, field) {
		const $chips = $widget.find('.frs-multiselect-chips').empty();
		state.filters[field].forEach((value) => {
			const $chip = $(`<span class="frs-chip">${frappe.utils.escape_html(value)} <span class="frs-chip-x">×</span></span>`);
			$chip.find('.frs-chip-x').on('click', () => {
				state.filters[field].delete(value);
				renderChips($widget, field);
				runSearch();
			});
			$chips.append($chip);
		});
	}

	PILL_FILTERS.filter(({ field }) => !AUTOCOMPLETE_FIELDS.has(field)).forEach(({ field, label }) => {
		const $widget = $(`
			<div class="frs-multiselect" data-field="${field}">
				<label>${label}</label>
				<input type="text" placeholder="Type a value, press Enter">
				<div class="frs-multiselect-chips"></div>
			</div>
		`);
		const $input = $widget.find('input');

		$input.on('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ',') {
				e.preventDefault();
				const value = $input.val().trim().replace(/,$/, '');
				if (value) {
					state.filters[field].add(value);
					renderChips($widget, field);
					runSearch();
				}
				$input.val('');
			}
		});

		chipWidgets[field] = $widget;
		$filterRow.append($widget);
	});

	// ── Above-table: Role / Department / Job Code — chip-box + dropdown ───
	// panel multiselect (search box, Select all/Clear, checkbox list) —
	// same widget style already used on the Field Over All Dashboard page.

	function escHtml(v) {
		return frappe.utils.escape_html(v);
	}

	function makeMultiselect($el, { placeholder, fetchOptions, onChange }) {
		let options = []; // [{value, count}]
		let selected = new Set();

		$el.html(`
			<div class="frs-ms-box"><span class="frs-ms-ph">${escHtml(placeholder)}</span></div>
			<div class="frs-ms-panel">
				<div class="frs-ms-search"><input type="text" placeholder="Search…"></div>
				<div class="frs-ms-actions"><a class="frs-ms-all">Select all</a><a class="frs-ms-none">Clear</a></div>
				<div class="frs-ms-list"></div>
			</div>
		`);
		const $box = $el.find('.frs-ms-box');
		const $search = $el.find('.frs-ms-search input');
		const $list = $el.find('.frs-ms-list');

		function renderBox() {
			$box.empty();
			if (!selected.size) {
				$box.append(`<span class="frs-ms-ph">${escHtml(placeholder)}</span>`);
				return;
			}
			const shown = Array.from(selected).slice(0, 2);
			shown.forEach((v) => {
				$box.append(`
					<span class="frs-ms-chip" title="${escHtml(v)}">
						<span class="txt">${escHtml(v)}</span><span class="x" data-v="${escHtml(v)}">&times;</span>
					</span>
				`);
			});
			if (selected.size > shown.length) {
				$box.append(`<span class="frs-ms-more">+${selected.size - shown.length} more</span>`);
			}
		}

		function renderList(filterText) {
			const q = (filterText || '').toLowerCase();
			$list.empty();
			const matches = options.filter((opt) => opt.value.toLowerCase().includes(q));
			if (!matches.length) {
				$list.append('<div class="frs-ms-empty">No matches</div>');
				return;
			}
			matches.forEach((opt) => {
				const checked = selected.has(opt.value);
				$list.append(`
					<label class="frs-ms-opt">
						<input type="checkbox" data-v="${escHtml(opt.value)}" ${checked ? 'checked' : ''}>
						<span>${escHtml(opt.value)}</span>
						<span class="frs-ms-opt-count">${opt.count}</span>
					</label>
				`);
			});
		}

		function open() {
			if ($el.hasClass('open')) return;
			$('.frs-ms.open').removeClass('open');
			$el.addClass('open');
			$search.val('');
			$list.html('<div class="frs-ms-empty">Loading…</div>');
			fetchOptions().then((opts) => {
				options = opts;
				renderList('');
			});
		}
		function close() {
			$el.removeClass('open');
		}

		$box.on('click', (e) => {
			if ($(e.target).hasClass('x')) return;
			$el.hasClass('open') ? close() : open();
		});
		$box.on('click', '.x', (e) => {
			e.stopPropagation();
			selected.delete($(e.currentTarget).data('v').toString());
			renderBox();
			if ($el.hasClass('open')) renderList($search.val());
			onChange(Array.from(selected));
		});
		$search.on('input', () => renderList($search.val()));
		$search.on('click', (e) => e.stopPropagation());
		$list.on('click', '.frs-ms-opt', (e) => e.stopPropagation());
		$list.on('change', 'input[type=checkbox]', function () {
			const v = $(this).data('v').toString();
			if (this.checked) selected.add(v);
			else selected.delete(v);
			renderBox();
			onChange(Array.from(selected));
		});
		$el.find('.frs-ms-all').on('click', (e) => {
			e.stopPropagation();
			const q = ($search.val() || '').toLowerCase();
			options.filter((opt) => opt.value.toLowerCase().includes(q)).forEach((opt) => selected.add(opt.value));
			renderBox();
			renderList($search.val());
			onChange(Array.from(selected));
		});
		$el.find('.frs-ms-none').on('click', (e) => {
			e.stopPropagation();
			selected.clear();
			renderBox();
			renderList($search.val());
			onChange(Array.from(selected));
		});

		return {
			// Sync from outside (e.g. a dashboard shortcut click) without
			// firing onChange — the caller is already updating state.filters.
			setSelected: (vals) => {
				selected = new Set(vals);
				renderBox();
				if ($el.hasClass('open')) renderList($search.val());
			},
			getSelected: () => Array.from(selected)
		};
	}

	// Close any open panel when clicking elsewhere on the page.
	$(document).off('click.frsMsOutside').on('click.frsMsOutside', (e) => {
		if ($(e.target).closest('.frs-ms').length) return;
		$(wrapper).find('.frs-ms.open').removeClass('open');
	});

	PILL_FILTERS.filter(({ field }) => AUTOCOMPLETE_FIELDS.has(field)).forEach(({ field, label }) => {
		const $wrap = $(`
			<div class="frs-multiselect" data-field="${field}">
				<label>${label}</label>
				<div class="frs-ms"></div>
			</div>
		`);
		const $ms = $wrap.find('.frs-ms');

		msControls[field] = makeMultiselect($ms, {
			placeholder: `All ${label}s`,
			fetchOptions: () => frappe.call({
				method: FACET_METHOD,
				args: {
					field: field,
					keywords: ($keywords.val() || '').trim(),
					filters: JSON.stringify(buildFilters(field))
				}
			}).then((r) => r.message || []),
			onChange: (values) => {
				state.filters[field] = new Set(values);
				runSearch();
			}
		});

		$filterRow.append($wrap);
	});

	// ── Above-table: Date Applied — plain From/To date range ───────────────
	// (date_of_applied is a Date field, not a discrete value list, so this
	// is a simple range instead of a chip/checkbox multiselect.)
	(function () {
		const $wrap = $(`
			<div class="frs-multiselect frs-date-filter" data-field="date_of_applied">
				<label>Date Applied</label>
				<div class="frs-date-range">
					<input type="date" class="frs-date-from">
					<span class="frs-date-sep">–</span>
					<input type="date" class="frs-date-to">
				</div>
			</div>
		`);
		const $from = $wrap.find('.frs-date-from');
		const $to = $wrap.find('.frs-date-to');

		$from.on('change', () => {
			state.dateFilters.date_of_applied.from = $from.val() || '';
			runSearch();
		});
		$to.on('change', () => {
			state.dateFilters.date_of_applied.to = $to.val() || '';
			runSearch();
		});

		$filterRow.append($wrap);
	})();

	// Rows checked in the results table jump into the native Field
	// Registration Form List View, filtered to just those records.
	function updateOpenListButton() {
		const n = state.selected.size;
		if (!n) {
			$openListBtn.hide();
			return;
		}
		$openListBtn.text(`Open ${n} in List View`).show();
	}

	$openListBtn.on('click', () => {
		frappe.route_options = { name: ['in', Array.from(state.selected)] };
		frappe.set_route('List', DOCTYPE, 'List');
	});

	function renderPageSizeButtons() {
		$pageSize.empty();
		PAGE_SIZES.forEach((n) => {
			const $btn = $(`<button class="frs-page-size-btn">${pageSizeLabel(n)}</button>`);
			if (n === state.page_length) $btn.addClass('active');
			$btn.on('click', () => {
				state.page_length = n;
				runSearch({ keepSelection: true });
			});
			$pageSize.append($btn);
		});
	}

	// resetSelection: pass {keepSelection: true} when only the page size
	// changed (same search, just showing more/fewer rows) so checked rows
	// aren't lost.
	function runSearch(opts) {
		const keywords = ($keywords.val() || '').trim();
		if (!(opts && opts.keepSelection)) {
			state.selected.clear();
			updateOpenListButton();
		}

		renderPills();
		renderPageSizeButtons();
		$resultCount.text('Searching…');

		frappe.call({
			method: SEARCH_METHOD,
			args: {
				keywords: keywords,
				filters: JSON.stringify(buildFilters()),
				start: 0,
				page_length: state.page_length // 0 = All
			}
		}).then((r) => {
			const { rows, total } = r.message || { rows: [], total: 0 };
			const shown = state.page_length === 0 ? total : Math.min(state.page_length, rows.length);
			$resultCount.html(
				state.page_length === 0 || rows.length >= total
					? `<b>${total.toLocaleString()}</b> profile${total === 1 ? '' : 's'} found`
					: `Showing <b>${shown.toLocaleString()}</b> of <b>${total.toLocaleString()}</b> profiles`
			);
			renderResults(rows, total);
		});

		refreshFacets();
	}
};
