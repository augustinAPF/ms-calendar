// Pathways Overall Dashboard — /app/pathways-overall-dashboard
//
// The four hiring programmes in one place (Field, Health, Philanthropy,
// Scholarship): registrations → application forms →
// interviews → feedback → outcome.
//
// Filters (application date, programme, units, sub-units, location, job
// code, role, stage — Apply button + one-click date presets) → headline KPIs
// → the hiring-pipeline board (screening → interviews → feedback → offer →
// onboarding, as pairs like Offer Accepted | Declined) → stage mix →
// programme funnel → weekly trend → running tables (upcoming interviews,
// latest feedback, status breakdown, latest registrations).
//
// Every card / number opens a centred drilldown. There is NO row cap: every
// table pages, sorts and searches on the server, and "Export all (CSV)"
// streams every matching row (works for 10 lakh+ records);
// clicking an applicant there opens their full detail (profile, forms,
// interview journey, every feedback in full).
//
// All numbers come from permission-scoped server calls (aggregated in SQL,
// cached 90 s per user), so nothing here can show more than the user may
// read. Every value rendered into HTML goes through esc().

const POD_API = 'ms_calendar.ms_calendar.page.pathways_overall_dashboard.pathways_overall_dashboard.';
const POD_STORE_KEY = 'pod-filters-v2';
// Multi-select filters (all sent as JSON lists, all remembered between visits).
// No Programme filter (the user asked): Units covers the same split — each
// programme's Unit field holds one value (Field / Health / Grants /
// Azim Premji Scholarship). Programme is still sent as [] = all.
const POD_LIST_FILTERS = ['units', 'subunits', 'locations', 'job_codes', 'job_openings', 'roles', 'stages'];

// Programme identity colours (categorical slots, fixed order) — always shown
// with the programme name, never colour alone.
const POD_PROGRAM_COLORS = {
	'Field': '#2a78d6', 'Health': '#eb6834', 'Philanthropy': '#1baf7a',
	'Scholarship': '#eda100'
};
// Stage = status meaning (reserved status colours + label).
// Registration form route per programme (Applicant ID links).
const POD_REG_ROUTE = {
	'Field': 'field-registration-form', 'Health': 'health-registration-form',
	'Philanthropy': 'phil-registration-form', 'Scholarship': 'scholarship-recruitment-form'
};
const POD_STAGE_COLORS = {
	'New': '#8A96A3', 'In process': '#2C5F8A', 'On hold': '#B7791F',
	'Offer / Selected': '#2F7D4F', 'Not selected': '#B83232'
};

// Line icons (24px grid, stroke = currentColor) for the KPI cards.
const POD_ICONS = {
	users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
	file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/>',
	hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
	mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
	calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
	message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>',
	alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
	award: '<circle cx="12" cy="8" r="6"/><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11"/>',
	xcircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
	calx: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M10 14l4 4M14 14l-4 4"/>',
	arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
	check: '<path d="M20 6 9 17l-5-5"/>',
	filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
	clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
	pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
	coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/>',
	send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
	handshake: '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/>',
	filesign: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/>',
	mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>',
	door: '<path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3"/><path d="M13 20h9"/><path d="M10 12v.01"/><path d="M13 4.56v16.88a.5.5 0 0 1-.6.49l-6.4-1.28A1 1 0 0 1 5 19.67V5.78a2 2 0 0 1 1.6-1.96l5.2-1.04a1 1 0 0 1 1.2.98z"/>',
	idcard: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M14 10h4M14 14h4"/>',
	ruler: '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2"/>',
	crown: '<path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M5 20h14"/>',
	clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'
};

// Tone = what the colour means (same everywhere on the page). Muted,
// print-safe steps: colour marks meaning, never decoration.
const POD_TONES = {
	good: '#2F7D4F', bad: '#B83232', action: '#B7651B', info: '#2C5F8A', neutral: '#6B7A8A', time: '#A16207'
};
// Board tiles: title + icon for each pair / single (keyed by its first card).
const POD_TILES = {
	new: ['New Applicant', 'users'], cv_shortlist: ['CV screening', 'filter'], test_select: ['Test', 'pen'],
	recruiter: ['Recruiter Round', 'mic'], functional: ['Functional Round', 'mic'], leadership: ['Leadership Round', 'crown'],
	iv_today: ['Interviews Today', 'clock'], iv_next7: ['Next 7 Days', 'calendar'],
	fb_done: ['Feedback', 'message'], doc_collection: ['Document Collection', 'clipboard'], fitment: ['Fitment', 'ruler'],
	comp_approved: ['Compensation', 'coins'], offer_sent: ['Offer letter', 'send'], offer_accepted: ['Offer response', 'handshake'],
	addendum_accepted: ['Addendum', 'filesign'], prejoin_done: ['Pre-joining form', 'clipboard'], it_sent: ['IT email', 'mail'],
	joined: ['Joining', 'door'], erp_created: ['ERP ID', 'idcard']
};
// Which board cards each top card shows when clicked (all = every card).
// Select and Reject have their own step-wise view (POD_STEP_VIEWS).
const POD_VIEWS = {
	offer: ['doc_collection', 'fitment', 'comp_approved', 'comp_due', 'offer_sent', 'offer_not_sent',
		'offer_accepted', 'offer_declined'],
	joined: ['addendum_accepted', 'addendum_declined', 'prejoin_done', 'prejoin_pending', 'it_sent', 'it_not_sent',
		'joined', 'not_joined', 'erp_created', 'erp_not_created']
};
// Timeline tab cards → which applicants the list below shows.
const POD_TL_VIEWS = {
	all: {},
	select: { stages: ['In process', 'On hold', 'Offer / Selected'] },
	reject: { stages: ['Not selected'] },
	new: { stages: ['New'] },
	offer: { card: 'offer_process' },
	joined: { card: 'reach_joined' }
};
// Top cards that open a step-wise view (server STEP_SETS) instead of filtering the board.
const POD_STEP_VIEWS = {
	select: { cols: 6, title: __('Selected'), by_unit: __('Selected by step and unit'),
		sections: { result: __('Select at each round — all units'), process: __('Still in process — no result yet, or a later stage') },
		of_all: __('of all selected'), pct_col: __('% of selected'), total: __('Total selected'),
		empty: __('No selected applicants for these filters.') },
	reject: { cols: 5, title: __('Rejected'), by_unit: __('Rejected by step and unit'),
		sections: { result: __('Reject at each round — all units'), process: __('Other rejects') },
		of_all: __('of all rejects'), pct_col: __('% of rejects'), total: __('Total rejected'),
		empty: __('No rejected applicants for these filters.') }
};
// Days-in-pipeline filter choices ("min-max", empty max = no upper limit).
const POD_DAY_RANGES = [
	['0-7', '0–7 days'], ['8-15', '8–15 days'], ['16-30', '16–30 days'], ['31-60', '31–60 days'],
	['61-90', '61–90 days'], ['91-', '90+ days'], ['31-', 'Over 30 days']
];
// India state shapes (DataMeet, Survey of India boundaries), loaded once on
// first use from the app's public folder and shared by every redraw.
const POD_INDIA_URL = '/assets/ms_calendar/data/india_states.json';
let POD_INDIA_MAP = null;
const POD_GROUP_COLORS = {
	screening: '#4F46E5', interviews: '#0891B2', selection: '#0D9488', offer: '#16A34A', onboarding: '#7C3AED'
};
const pod_icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${POD_ICONS[k] || ''}</svg>`;

frappe.pages['pathways-overall-dashboard'].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __('Pathways Overall Dashboard'),
		single_column: true
	});
	wrapper.pod = new PathwaysOverallDashboard(page, wrapper);
};

// Arriving from an applicant profile opened in a registration list / form
// ("View timeline" there routes here with the applicant in route_options).
frappe.pages['pathways-overall-dashboard'].on_page_show = function (wrapper) {
	const ro = frappe.route_options || {};
	if (ro.pod_timeline && ro.pod_program && wrapper.pod) {
		frappe.route_options = null;
		wrapper.pod.open_timeline(ro.pod_program, ro.pod_timeline);
	}
};

class PathwaysOverallDashboard {
	constructor(page, wrapper) {
		this.page = page;
		this.$root = $(wrapper).find('.page-content');
		this.data = null;
		this.filters = null;
		this.ms = {};
		this.render_shell();
		const saved = this.read_saved() || {};
		const [from_date, to_date] = this.preset_range('year');
		this.load(Object.assign(this.empty_filters(), saved, { from_date, to_date }));
	}

	// ── helpers ────────────────────────────────────────────────────────────
	esc(v) { return frappe.utils.escape_html(v === null || v === undefined ? '' : String(v)); }
	fmt_date(d) { return d ? frappe.datetime.str_to_user(d) : ''; }
	// 'YYYY-MM-DD HH:MM' → user format, without the ':00' seconds.
	fmt_dt(d) { return d ? frappe.datetime.str_to_user(d).replace(/(\d{1,2}:\d{2}):\d{2}$/, '$1') : ''; }
	n(v) { return v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN'); }
	pct(a, b) { return b ? Math.round((a / b) * 1000) / 10 : 0; }
	sum(key) { return (this.data.funnel || []).reduce((s, f) => s + (f[key] || 0), 0); }
	has(key) { return (this.data.funnel || []).some(f => f[key] !== null && f[key] !== undefined); }

	read_saved() {
		let saved = null;
		try { saved = JSON.parse(localStorage.getItem(POD_STORE_KEY) || 'null'); } catch (e) { return null; }
		// A Programme choice saved before the filter was removed would filter
		// the page invisibly — drop it.
		if (saved) delete saved.programs;
		return saved;
	}
	// Dates are deliberately not remembered: the page always opens on "This year".
	save_filters(f) {
		try {
			const keep = {};
			POD_LIST_FILTERS.forEach(k => { keep[k] = f[k] || []; });
			localStorage.setItem(POD_STORE_KEY, JSON.stringify(keep));
		} catch (e) { /* private mode etc. */ }
	}

	program_pill(p) {
		return `<span class="pod-pill" style="--c:${POD_PROGRAM_COLORS[p] || '#64748B'}">${this.esc(p)}</span>`;
	}
	stage_pill(s) {
		return s ? `<span class="pod-pill" style="--c:${POD_STAGE_COLORS[s] || '#64748B'}">${this.esc(s)}</span>` : '';
	}
	result_pill(v) {
		if (!v) return '';
		const s = String(v).toLowerCase();
		const c = /reject|regret/.test(s) ? '#d03b3b' : /hold/.test(s) ? '#c98500' : /select/.test(s) ? '#0ca30c' : '#64748B';
		return `<span class="pod-pill" style="--c:${c}">${this.esc(v)}</span>`;
	}
	cand_link(r) {
		return `<a class="pod-cand" data-prog="${this.esc(r.program)}" data-id="${this.esc(r.id)}">${this.esc(r.name || r.id)}</a>`;
	}
	slug(dt) { return String(dt || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
	// Applicant ID → the applicant's full detail page (open_candidate), which
	// has the "Open in Frappe" button. Ctrl/Cmd-click or middle-click still
	// opens the registration record in a new tab via the href.
	id_col() {
		return { key: 'id', label: __('Applicant ID'), nw: true,
			render: (r) => r.id ? `<a class="pod-idlink pod-cand" data-prog="${this.esc(r.program)}" data-id="${this.esc(r.id)}"
				href="/app/${POD_REG_ROUTE[r.program] || 'field-registration-form'}/${encodeURIComponent(r.id)}"
				title="${this.esc(__('View applicant details'))}">${this.esc(r.id)}</a>` : '' };
	}

	doc_link(dt, name) {
		return `<a target="_blank" href="/app/${this.slug(dt)}/${encodeURIComponent(name)}">${this.esc(name)} ↗</a>`;
	}

	// ── layout ─────────────────────────────────────────────────────────────
	render_shell() {
		this.$root.html(`
			<style>${POD_CSS}</style>
			<div class="pod-root">
				<div class="pod-tabs" role="tablist">
					<button class="pod-tab is-on" data-tab="dash" role="tab" aria-selected="true">${__('Dashboard')}</button>
					<button class="pod-tab" data-tab="timeline" role="tab" aria-selected="false">${__('Timeline')}</button>
					<button class="pod-tab" data-tab="funnel" role="tab" aria-selected="false">${__('Hiring Funnel')}</button>
					<button class="pod-tab" data-tab="analytics" role="tab" aria-selected="false">${__('Analytics')}</button>
				</div>
				<div class="pod-filters">
					<div class="pod-topbar">
						<div class="pod-presets">
							${[['month', __('This month')], ['last30', __('Last 30 days')], ['last90', __('Last 90 days')],
								['year', __('This year')], ['all', __('All time')]]
								.map(([k, l]) => `<button class="pod-preset" data-p="${k}">${l}</button>`).join('')}
						</div>
						<div class="pod-topbar-right">
							<span class="pod-muted" id="pod-alltime" title="${__('Ignores every filter')}">${__('All-time registrations')}: <b class="v">—</b></span>
							<span class="pod-muted" id="pod-sub"></span>
							<button class="btn btn-default btn-xs" id="pod-guide" title="${__('What each number means')}">ⓘ ${__('Card guide')}</button>
							<button class="btn btn-default btn-xs" id="pod-refresh" title="${__('Fetch fresh numbers')}">⟳ ${__('Refresh')}</button>
							<button class="btn btn-primary btn-xs" id="pod-ai-open" title="${__('Ask a question about these numbers')}">${__('Ask AI')}</button>
						</div>
					</div>
					<div class="pod-filter-row">
						<div class="pod-f"><label title="${__('Application date from')}">${__('Applied from')}</label><input type="date" id="pod-from"></div>
						<div class="pod-f"><label>${__('To')}</label><input type="date" id="pod-to"></div>
						<div class="pod-f"><label>${__('Units')}</label><div class="pod-ms" id="pod-ms-units" data-placeholder="${__('All units')}"></div></div>
						<div class="pod-f"><label>${__('Sub-units')}</label><div class="pod-ms" id="pod-ms-subunits" data-placeholder="${__('All sub-units')}"></div></div>
						<div class="pod-f"><label>${__('Location')}</label><div class="pod-ms" id="pod-ms-locations" data-placeholder="${__('All locations')}"></div></div>
						<div class="pod-f"><label>${__('Job code')}</label><div class="pod-ms" id="pod-ms-job_codes" data-placeholder="${__('All job codes')}"></div></div>
						<div class="pod-f"><label title="${__('Applicants of the chosen Job Openings (Job Opening link, job code, or role + unit)')}">${__('Job opening')}</label><div class="pod-ms" id="pod-ms-job_openings" data-placeholder="${__('All job openings')}"></div></div>
						<div class="pod-f"><label>${__('Role')}</label><div class="pod-ms" id="pod-ms-roles" data-placeholder="${__('All roles')}"></div></div>
						<div class="pod-f"><label>${__('Stage')}</label><div class="pod-ms" id="pod-ms-stages" data-placeholder="${__('All stages')}"></div></div>
						<div class="pod-f pod-f-btns">
							<button class="btn btn-primary btn-sm" id="pod-apply">${__('Apply')}</button>
							<button class="btn btn-default btn-sm" id="pod-reset">${__('Reset')}</button>
						</div>
					</div>
				</div>

				<div class="pod-pane" data-pane="timeline" hidden>
					<div class="pod-cards pod-tl-cards" id="pod-tl-cards"></div>
					<div class="pod-panel pod-tl-list">
						<div class="pod-panel-head"><div>
							<div class="pod-panel-title">${__('Applicant timeline')}</div>
							<div class="pod-panel-sub">${__('Everyone matching the filters above · search, then click a name to open their timeline, start to end')}</div>
						</div></div>
						<div class="pod-tl-tools" id="pod-tl-tools"></div>
						<div id="pod-tl-list"></div>
					</div>
				</div>

				<div class="pod-pane" data-pane="funnel" hidden>
					<div class="pod-panel">
						<div class="pod-panel-head"><div>
							<div class="pod-panel-title">${__('Hiring funnel')}</div>
							<div class="pod-panel-sub">${__('How many people reach each step · bar length = share of all registrations · hover for detail, click a step for its list')}</div>
						</div></div>
						<div class="pod-panel-body" id="pod-funbars"></div>
					</div>
					<div class="pod-panel">
						<div class="pod-panel-head"><div>
							<div class="pod-panel-title">${__('Funnel by unit')}</div>
							<div class="pod-panel-sub">${__('The same steps for each unit · % = share of the step before · click a number for its list')}</div>
						</div></div>
						<div class="pod-table-scroll pod-short" id="pod-fununits"></div>
					</div>
					<div class="pod-panel">
						<div class="pod-panel-head"><div>
							<div class="pod-panel-title">${__('Pipeline & offers')}</div>
							<div class="pod-panel-sub">${__('How long applicants have been in the process, and where offers stand · for the filters above · click any number or bar for its list')}</div>
						</div></div>
						<div class="pod-tl-charts" id="pod-tl-charts"></div>
						<div class="pod-tl-charts pod-offers" id="pod-tl-offers"></div>
					</div>

					<div class="pod-panel">
						<div class="pod-panel-head">
							<div>
								<div class="pod-panel-title">${__('Programme funnel')}</div>
								<div class="pod-panel-sub">${__('Registration → application → interview → feedback → outcome · every number opens its list')}</div>
							</div>
							<div class="pod-panel-tools"><button class="btn btn-default btn-xs" id="pod-export-funnel">${__('Export CSV')}</button></div>
						</div>
						<div class="pod-table-scroll pod-short" id="pod-funnel"></div>
					</div>

					<div class="pod-stack">
						<div class="pod-panel">
							<div class="pod-panel-head">
								<div>
									<div class="pod-panel-title">${__('Interviews')}</div>
									<div class="pod-panel-sub">${__('Every interview — past, upcoming and cancelled · filtered by interview date')}</div>
								</div>
								${this.range_tools('iv')}
							</div>
							<div id="pod-upcoming"></div>
						</div>
						<div class="pod-panel">
							<div class="pod-panel-head">
								<div>
									<div class="pod-panel-title">${__('Feedback forms')}</div>
									<div class="pod-panel-sub">${__('Every feedback form submitted, newest first · filtered by submitted date · click an applicant to read it in full')}</div>
								</div>
								${this.range_tools('fb')}
							</div>
							<div id="pod-feedback"></div>
						</div>
					</div>


					<div class="pod-panel">
						<div class="pod-panel-head">
							<div>
								<div class="pod-panel-title">${__('All registrations')}</div>
								<div class="pod-panel-sub">${__('Every registration in scope, newest first · page, sort, search and export all of them')}</div>
							</div>
						</div>
						<div id="pod-reg"></div>
					</div>
					<div class="pod-panel" id="pod-log-panel" style="display:none">
						<div class="pod-panel-head">
							<div>
								<div class="pod-panel-title">${__('Status change log')}</div>
								<div class="pod-panel-sub">${__('Every application-status change (from → to, who, when, why) for applicants in scope')}</div>
							</div>
						</div>
						<div id="pod-log"></div>
					</div>

					<div class="pod-grid-2">
						<div class="pod-panel">
							<div class="pod-panel-head"><div>
								<div class="pod-panel-title">${__('Where applicants are')}</div>
								<div class="pod-panel-sub">${__('Current stage of every registration in scope · click a bar for the list')}</div>
							</div></div>
							<div class="pod-panel-body" id="pod-stages"></div>
						</div>
						<div class="pod-panel">
							<div class="pod-panel-head"><div>
								<div class="pod-panel-title">${__('Registrations per week')}</div>
								<div class="pod-panel-sub">${__('Week starting Monday · hover for numbers · click a bar for that week')}</div>
							</div></div>
							<div class="pod-panel-body" id="pod-trend"></div>
						</div>
					</div>
				</div>

				<div class="pod-pane" data-pane="analytics" hidden>
					<div class="pod-an" id="pod-an"></div>
				</div>

				<div class="pod-pane" data-pane="dash">
				<div class="pod-cards" id="pod-cards"></div>
				<div class="pod-board" id="pod-board"></div>
				</div>
				<div class="pod-tip" id="pod-tip"></div>
				<aside class="pod-ai" id="pod-ai" aria-label="${__('Ask AI')}" hidden>
					<div class="pod-ai-head">
						<div>
							<div class="pod-ai-title">${__('Ask AI')}</div>
							<div class="pod-ai-sub">${__('Answers from the dashboard numbers for the filters applied above. Counts only — no names or contact details are sent.')}</div>
						</div>
						<button class="btn btn-default btn-xs" id="pod-ai-clear" title="${__('Start a new chat')}">${__('Clear')}</button>
						<button class="btn btn-default btn-xs" id="pod-ai-close" aria-label="${__('Close')}">✕</button>
					</div>
					<div class="pod-ai-log" id="pod-ai-log" aria-live="polite"></div>
					<div class="pod-ai-input">
						<textarea id="pod-ai-q" rows="2" maxlength="2000" placeholder="${__('Ask about the numbers… e.g. How many Test Select in each unit?')}"></textarea>
						<button class="btn btn-primary btn-sm" id="pod-ai-send">${__('Send')}</button>
					</div>
				</aside>
			</div>
		`);

		const $c = this.$root;
		POD_LIST_FILTERS.forEach(k => {
			this.ms[k] = this.make_multiselect($c.find(`#pod-ms-${k}`), { on_change: () => this.cascade(k) });
		});

		$c.find('#pod-apply').on('click', () => this.load(this.current_filters()));
		$c.find('#pod-refresh').on('click', () => this.load(this.filters || this.current_filters(), true));
		$c.find('#pod-reset').on('click', () => {
			Object.values(this.ms).forEach(m => m.clear());
			const [f, t] = this.preset_range('year');
			this.load(Object.assign(this.empty_filters(), { from_date: f, to_date: t }));
		});
		// A date preset is a single click = the user is done choosing → apply at once.
		$c.find('.pod-preset:not(.pod-rpreset)').on('click', (e) => {
			const [f, t] = this.preset_range($(e.currentTarget).data('p'));
			$c.find('#pod-from').val(f || '');
			$c.find('#pod-to').val(t || '');
			this.load(this.current_filters());
		});
		$c.find('#pod-guide').on('click', () => this.open_guide());
		this.bind_ai($c);
		$c.find('.pod-tab').on('click', (e) => this.show_tab(String($(e.currentTarget).data('tab'))));
		$(document).on('click.pod', (e) => { if (!$(e.target).closest('.pod-ms').length) $('.pod-ms.open').removeClass('open'); });
		this.bind_candidate_links($c);
	}

	preset_range(p) {
		const today = frappe.datetime.get_today();
		const d = (n) => frappe.datetime.add_days(today, n);
		switch (p) {
			case 'month': return [frappe.datetime.month_start(), today];
			case 'last30': return [d(-29), today];
			case 'last90': return [d(-89), today];
			case 'year': return [today.slice(0, 4) + '-01-01', today];
			default: return [null, null];
		}
	}

	current_filters() {
		const $c = this.$root;
		return {
			from_date: $c.find('#pod-from').val() || null,
			to_date: $c.find('#pod-to').val() || null,
			...Object.fromEntries(POD_LIST_FILTERS.map(k => [k, this.ms[k].val()]))
		};
	}

	empty_filters() {
		return Object.fromEntries(POD_LIST_FILTERS.map(k => [k, []]));
	}

	// Cascading OPTIONS (never gating): Units narrow the Sub-unit list, and
	// Units + Sub-units narrow the Job-code list. Every filter stays usable
	// on its own — pick a job code directly without choosing a unit first.
	cascade(changed) {
		if (!['units', 'subunits'].includes(changed) || !this.data) return;
		const combos = (this.data.options || {}).combos || [];
		const units = this.ms.units.val();
		const subs = this.ms.subunits.val();
		const uniq = (a) => [...new Set(a.filter(Boolean))].sort();
		if (changed === 'units') {
			this.ms.subunits.setOptions(uniq(combos.filter(c => !units.length || units.includes(c[0])).map(c => c[1])));
		}
		this.ms.job_codes.setOptions(uniq(combos
			.filter(c => (!units.length || units.includes(c[0])) && (!this.ms.subunits.val().length || this.ms.subunits.val().includes(c[1])))
			.map(c => c[2])));
		// Job openings of the chosen units (an opening with no unit stays listed).
		this.ms.job_openings.setOptions(((this.data.options || {}).job_openings || [])
			.filter(o => !units.length || !o.unit || units.includes(o.unit)));
	}

	args(f, extra = {}) {
		return Object.assign({
			from_date: f.from_date || null,
			to_date: f.to_date || null,
			programs: JSON.stringify(f.programs || []),
			...Object.fromEntries(POD_LIST_FILTERS.filter(k => k !== 'programs').map(k => [k, JSON.stringify(f[k] || [])]))
		}, extra);
	}

	// Same chip multiselect as the Field dashboards (search, Select all /
	// Clear, checkbox list) so filters look and behave alike everywhere.
	make_multiselect($el, cfg = {}) {
		const changed = () => { if (cfg.on_change) cfg.on_change(); };
		const esc = (v) => this.esc(v);
		const placeholder = $el.data('placeholder') || __('All');
		let options = [];
		let selected = [];
		const labels = {};          // value → label (options given as {value, label})
		const lab = (v) => labels[v] || v;
		$el.html(`
			<div class="pod-ms-box"></div>
			<div class="pod-ms-panel">
				<div class="pod-ms-search"><input type="text" placeholder="${__('Search…')}"></div>
				<div class="pod-ms-actions"><a class="pod-ms-all">${__('Select all')}</a><a class="pod-ms-none">${__('Clear')}</a></div>
				<div class="pod-ms-list"></div>
			</div>`);
		const $box = $el.find('.pod-ms-box');
		const $search = $el.find('.pod-ms-search input');
		const $list = $el.find('.pod-ms-list');
		const render_box = () => {
			$box.empty();
			if (!selected.length) { $box.append(`<span class="pod-ms-ph">${esc(placeholder)}</span>`); return; }
			selected.slice(0, 2).forEach(v => $box.append(
				`<span class="pod-ms-chip" title="${esc(lab(v))}"><span class="txt">${esc(lab(v))}</span><span class="x" data-v="${esc(v)}">&times;</span></span>`));
			if (selected.length > 2) $box.append(`<span class="pod-ms-more">+${selected.length - 2}</span>`);
		};
		const render_list = () => {
			const q = ($search.val() || '').toLowerCase();
			const matches = options.filter(v => lab(v).toLowerCase().includes(q) || v.toLowerCase().includes(q));
			$list.html(matches.length ? matches.map(v => `
				<label class="pod-ms-opt"><input type="checkbox" data-v="${esc(v)}" ${selected.includes(v) ? 'checked' : ''}>
				<span>${esc(lab(v))}</span></label>`).join('') : `<div class="pod-ms-empty">${__('No matches')}</div>`);
		};
		$box.on('click', (e) => {
			if ($(e.target).hasClass('x')) return;
			const open = $el.hasClass('open');
			$('.pod-ms.open').removeClass('open');
			if (!open) { $el.addClass('open'); $search.val(''); render_list(); $search.trigger('focus'); }
		});
		$box.on('click', '.x', (e) => {
			e.stopPropagation();
			const v = String($(e.currentTarget).data('v'));
			selected = selected.filter(s => s !== v);
			render_box(); render_list(); changed();
		});
		$search.on('input', render_list);
		$list.on('change', 'input', (e) => {
			const v = String($(e.currentTarget).data('v'));
			selected = e.currentTarget.checked ? [...new Set([...selected, v])] : selected.filter(s => s !== v);
			render_box(); changed();
		});
		$el.find('.pod-ms-all').on('click', (e) => {
			e.stopPropagation();
			const q = ($search.val() || '').toLowerCase();
			selected = [...new Set([...selected, ...options.filter(v => lab(v).toLowerCase().includes(q) || v.toLowerCase().includes(q))])];
			render_box(); render_list(); changed();
		});
		$el.find('.pod-ms-none').on('click', (e) => { e.stopPropagation(); selected = []; render_box(); render_list(); changed(); });
		render_box();
		return {
			setOptions(opts) {
				options = (opts || []).map(o => {
					if (o && typeof o === 'object') { labels[o.value] = o.label || o.value; return String(o.value); }
					return o;
				});
				render_box();
			},
			setVal(vals) { selected = (vals || []).slice(); render_box(); },
			val() { return selected.slice(); },
			clear() { selected = []; render_box(); }
		};
	}

	// ── data ───────────────────────────────────────────────────────────────
	load(filters, refresh = false) {
		const $c = this.$root;
		$c.find('#pod-apply').prop('disabled', true).text(__('Loading…'));
		$c.addClass('pod-loading');
		frappe.call({
			method: POD_API + 'get_dashboard_data',
			args: this.args(filters, { refresh: refresh ? 1 : 0 }),
			callback: (r) => {
				// Refresh also bypasses the Analytics tab's 10-minute cache (now, or when it is next opened).
				if (refresh) this.an_refresh = true;
				this.data = r.message || {};
				this.filters = Object.assign({}, filters, this.data.filters || {});
				this.save_filters(this.filters);
				const f = this.filters;
				$c.find('#pod-from').val(f.from_date || '');
				$c.find('#pod-to').val(f.to_date || '');
				const o = this.data.options || {};
				this.ms.units.setOptions(o.units || []);
				this.ms.locations.setOptions(o.locations || []);
				this.ms.roles.setOptions(o.roles || []);
				this.ms.stages.setOptions(this.data.stages || []);
				['units', 'locations', 'roles', 'stages'].forEach(k => this.ms[k].setVal(f[k]));
				// Sub-unit / job-code lists depend on the chosen units.
				this.ms.subunits.setVal(f.subunits);
				this.ms.job_codes.setVal(f.job_codes);
				this.ms.job_openings.setVal(f.job_openings);
				this.cascade('units');
				this.render_all();
			},
			always: () => {
				$c.find('#pod-apply').prop('disabled', false).text(__('Apply'));
				$c.removeClass('pod-loading');
			}
		});
	}

	render_all() {
		const f = this.filters;
		const range = f.from_date || f.to_date
			? `${f.from_date ? this.fmt_date(f.from_date) : '…'} – ${f.to_date ? this.fmt_date(f.to_date) : '…'}`
			: __('All time');
		const extra = [];
		[['units', __('unit(s)')], ['subunits', __('sub-unit(s)')], ['locations', __('location(s)')],
			['job_codes', __('job code(s)')], ['job_openings', __('job opening(s)')], ['roles', __('role(s)')]].forEach(([k, l]) => {
			if ((f[k] || []).length) extra.push(f[k].length === 1 ? f[k][0] : `${f[k].length} ${l}`);
		});
		if ((f.stages || []).length) extra.push(f.stages.join(', '));
		this.$root.find('#pod-sub').text(
			`${__('Updated')} ${String(this.data.generated_at || '').slice(11, 16)}`);
		this.$root.find('#pod-alltime .v').text(this.n(this.data.all_time_registrations));
		this.mark_preset();
		this.render_cards();
		this.render_stages();
		this.render_trend();
		this.render_funnel();
		// The Hiring Funnel tab's lists and charts each need their own server
		// calls, and the Timeline list too — load them only when their tab is
		// open (now, or the next time it is opened), so the Dashboard tab
		// comes up with a single call.
		this.fun_dirty = true;
		if (this.tab === 'funnel') this.render_funnel_tab();
		this.tl_dirty = true;
		if (this.tab === 'timeline') this.render_tl_list();
		this.an_dirty = true;
		if (this.tab === 'analytics') this.render_analytics();
	}

	render_funnel_tab() {
		this.fun_dirty = false;
		this.render_upcoming();
		this.render_feedback();
		this.render_reg_table();
		this.render_status_log();
		this.render_tl_charts({});
	}

	render_status_log() {
		const $p = this.$root.find('#pod-log-panel');
		$p.toggle(!!this.data.has_status_log);
		if (!this.data.has_status_log) return;
		this.server_table(this.$root.find('#pod-log'), 'status_log', {},
			{ columns: this.log_columns(), title: 'status_change_log', page_size: 50, compact: true,
				empty: __('No status changes recorded for applicants in scope yet.') });
	}

	// ── cards ──────────────────────────────────────────────────────────────
	stage_total(stage) {
		return (this.data.funnel || []).reduce((s, f) => s + ((f.stages || {})[stage] || 0), 0);
	}

	// Headline row — the hiring funnel, left to right: Registrations →
	// CV shortlisted → Leadership round → Offer accepted → Joined. Each step
	// counts everyone who got at least that far, so the row only narrows.
	// Every % on the cards is the share of Total registrations (as on all
	// other cards). The step-to-step % ("300 leader round = 50% of the 600
	// CV shortlisted") is kept as `step` for the (i) and the Hiring funnel
	// bars. The board below shows where people are now.
	card_defs() {
		const regs = this.sum('registrations');
		const fc = Object.fromEntries((this.data.funnel_cards || []).map(c => [c.key, c]));
		const defs = [
			{ k: 'registrations', tone: 'info', label: __('Total registrations'), v: regs,
				share: regs ? 100 : null, share_of: __('of total registrations'),
				units: this.headline_units(f => f.registrations),
				hint: __('in the selected period'),
				desc: __('Every registration whose application date is in the selected range, after all the filters above.') }
		];
		['reach_cv', 'reach_leader', 'reach_accepted', 'reach_joined'].forEach(k => {
			const c = fc[k];
			if (!c) return;
			const prev = defs[defs.length - 1];
			const v = c.value || 0;
			defs.push({ k: 'card:' + k, tone: c.tone, label: __(c.label), v: c.value, units: c.by_unit,
				share: regs ? this.pct(v, regs) : null, share_of: __('of total registrations'),
				step: prev.v ? this.pct(v, prev.v) : null,
				of_reg: regs ? this.pct(v, regs) : null, prev_v: prev.v, prev_label: prev.label,
				hint: prev.v ? __('{0}% of {1}', [this.pct(v, prev.v), prev.label]) : '',
				desc: c.desc });
		});
		// Set apart from the funnel (no arrow into it): everyone rejected at
		// any step, with where they dropped out.
		const rej = this.stage_total('Not selected');
		const where = this.reject_breakdown();
		defs.push({ k: 'stage:Not selected', tone: 'bad', label: __('All rejected'), v: rej, aside: true,
			share: regs ? this.pct(rej, regs) : null, share_of: __('of total registrations'),
			units: this.headline_units(f => f.stages['Not selected']),
			hint: where.slice(0, 3).map(w => `${w.label} ${this.n(w.n)}`).join(' · '),
			desc: __('Everyone whose journey ended without selection: any Reject / Regret / No Show status, Not Selected, Offer declined, Not joined, Duplicated or Blocklisted.')
				+ (where.length ? '\n\n' + __('Where they dropped out') + ':\n' + where.map(w => `${w.label}: ${this.n(w.n)} (${this.pct(w.n, rej)}%)`).join('\n') : '') });
		return defs;
	}

	// Top row (2026-11-24): 5 cards. Clicking one shows only its cards on the
	// board below (POD_VIEWS); "View list" above the board opens the list.
	// Applicants = New + Select + Reject.
	top_defs() {
		const regs = this.sum('registrations');
		const fc = Object.fromEntries((this.data.funnel_cards || []).map(c => [c.key, c]));
		const share = (v) => regs ? this.pct(v || 0, regs) : null;
		const of_reg = __('of total registrations');
		const stage_units = (...st) => this.headline_units(f => st.reduce((s, x) => s + ((f.stages || {})[x] || 0), 0));
		const sel_st = ['In process', 'On hold', 'Offer / Selected'];
		const sel = sel_st.reduce((s, x) => s + this.stage_total(x), 0);
		const rej = this.stage_total('Not selected');
		const where = this.reject_breakdown();
		const defs = [
			{ k: 'registrations', view: 'all', tone: 'info', label: __('Total Applicants'), v: regs,
				share: regs ? 100 : null, share_of: of_reg, sub: __('in the selected period'),
				units: this.headline_units(f => f.registrations),
				desc: __('Every registration whose application date is in the selected range, after all the filters above. Click to show all cards.') },
			{ k: 'stages:' + sel_st.join('|'), view: 'select', tone: 'good', label: __('Total Select'), v: sel,
				share: share(sel), share_of: of_reg, units: stage_units(...sel_st),
				desc: __('Moved past CV screening and not rejected: in the test or an interview round, on hold, in the offer process or joined. Click to show the select cards.') },
			{ k: 'stage:Not selected', view: 'reject', tone: 'bad', label: __('Total Reject'), v: rej,
				share: share(rej), share_of: of_reg, units: stage_units('Not selected'),
				desc: __('Everyone whose journey ended without selection: any Reject / Regret / No Show status, Not Selected, Offer declined, Not joined, Duplicated or Blocklisted. Click to show the reject cards.')
					+ (where.length ? '\n\n' + __('Where they dropped out') + ':\n' + where.map(w => `${w.label}: ${this.n(w.n)} (${this.pct(w.n, rej)}%)`).join('\n') : '') },
		];
		[['offer_process', 'offer', __('Click to show the offer cards.')],
			['reach_joined', 'joined', __('Click to show the onboarding and joining cards.')]].forEach(([key, view, tip]) => {
			const c = fc[key];
			if (!c) return;
			defs.push({ k: 'card:' + key, view, tone: 'good', label: key === 'reach_joined' ? __('Total Joined') : __(c.label),
				v: c.value, units: c.by_unit, share: share(c.value), share_of: of_reg, desc: `${c.desc} ${tip}` });
		});
		return defs;
	}

	// Rejected applicants grouped by the step they dropped out at, from the
	// status counts already loaded (same scope + filters as the cards).
	reject_breakdown() {
		const phase = (s) => {
			const x = String(s || '').toLowerCase();
			if (/no.?show/.test(x)) return __('No show');
			if (/\bcv\b|application reject/.test(x)) return __('CV');
			if (/test/.test(x)) return __('Test');
			if (/offer|join|addendum/.test(x)) return __('Offer / joining');
			if (/round|r\d|recruiter|leader|calibration|fitment|interview|document/.test(x)) return __('Interview');
			return __('Other');
		};
		const out = {};
		(this.data.status_rows || []).filter(r => r.stage === 'Not selected').forEach(r => {
			const p = phase(r.status);
			out[p] = (out[p] || 0) + r.count;
		});
		return Object.entries(out).map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
	}

	unit_of(program) {
		const u = (this.data.units_in_scope || []).find(x => x.program === program);
		return u ? u.unit : program;
	}

	headline_units(fn) {
		return (this.data.funnel || []).map(f => ({ program: f.program, unit: this.unit_of(f.program), value: fn(f) }))
			.filter(u => u.value !== null && u.value !== undefined);
	}

	info_html(text) {
		return text ? `<span class="pod-info" tabindex="0" role="note" aria-label="${this.esc(text)}" data-tip="${this.esc(text)}">i</span>` : '';
	}

	// ── animation helpers ─────────────────────────────────────────────────
	// A number that counts up from 0 when the cards appear (the final value
	// is already in the markup, so it is correct even without animation).
	count_html(v) {
		const zero = v !== null && v !== undefined && Number(v) === 0;
		return `<span class="pod-count ${zero ? 'is-zero' : ''}" data-v="${v === null || v === undefined ? '' : Number(v)}">${this.n(v)}</span>`;
	}

	count_up($scope) {
		if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const els = $scope.find('.pod-count').toArray().filter(el => el.dataset.v !== '' && +el.dataset.v > 0);
		if (!els.length) return;
		const t0 = performance.now(), dur = 700;
		const ease = (t) => 1 - Math.pow(1 - t, 3);
		const step = (now) => {
			const t = Math.min(1, (now - t0) / dur);
			els.forEach(el => { el.textContent = this.n(Math.round(+el.dataset.v * ease(t))); });
			if (t < 1) requestAnimationFrame(step);
		};
		requestAnimationFrame(step);
	}

	// A card shows only its name, the count and the percentage. What the %
	// is "of", the unit split and the extra notes live in the (i) and in the
	// popup (which opens with one card per unit).
	card_html(d, i, active = this.view) {
		const col = POD_TONES[d.tone] || POD_TONES.neutral;
		const click = d.v ? 'is-click' : '';
		const has_share = d.share !== null && d.share !== undefined;
		const desc = [d.desc, has_share && d.share_of ? `${d.share}% = ${d.share_of}` : '', d.hint ? `${d.hint}` : '']
			.filter(Boolean).join('\n\n');
		return `
			<div class="pod-kpi ${click} ${d.aside ? 'is-aside' : ''} ${d.view && d.view === active ? 'is-on' : ''}" style="--c:${col};--i:${i}" data-i="${i}" data-k="${this.esc(d.k)}" data-l="${this.esc(d.label)}"
				${d.v ? `role="button" tabindex="0"${d.view ? ` aria-pressed="${d.view === active}"` : ''}` : ''}>
				<div class="pod-kpi-top">
					<span class="pod-kpi-label">${d.tone !== 'info' ? `<i class="pod-dot" style="--c:${col}"></i>` : ''}${this.esc(d.label)}</span>
					${this.info_html(desc)}
				</div>
				<div class="pod-kpi-value">${this.count_html(d.v)}${has_share
					? `<span class="pod-share" title="${this.esc(d.share_of || '')}">${d.share}%</span>` : ''}</div>
				<div class="pod-kpi-sub">${this.esc(d.sub || (d.k === 'registrations' ? __('in the selected period') : (d.share_of || '')))}</div>
			</div>`;
	}

	bind_click($els, open) {
		const own = (e) => $(e.target).closest('.pod-info, .pod-u').length;
		$els.on('click', (e) => { if (!own(e)) open(e.currentTarget); })
			.on('keydown', (e) => {
				if ((e.key === 'Enter' || e.key === ' ') && !own(e)) { e.preventDefault(); open(e.currentTarget); }
			});
	}

	render_cards() {
		const $el = this.$root.find('#pod-cards');
		const defs = this.top_defs();
		this.view = this.view || 'all';
		this.top_by_view = Object.fromEntries(defs.map(d => [d.view, d]));
		$el.html(`<div class="pod-headline is-five">${defs.map((d, i) => this.card_html(d, i)).join('')}</div>`);
		// Every list opens in the popup, which starts with one card per unit.
		const open = (k, label, extra = {}) => {
			if (k.startsWith('card:')) this.drill('card', label, Object.assign({ card: k.slice(5) }, extra));
			else if (k.startsWith('stage:')) this.drill('registrations', label, Object.assign({ stage: k.slice(6) }, extra));
			else if (k.startsWith('stages:')) {
				// Several stages: narrow the page's own Stage filter (if any) to them.
				const want = k.slice(7).split('|');
				const page = (this.filters || {}).stages || [];
				const stages = page.length ? want.filter(s => page.includes(s)) : want;
				this.drill('registrations', label, Object.assign({ stages }, extra));
			}
			else this.drill(k, label, extra);
		};
		this.open_top = open;
		// A top card picks which cards the board shows (click again = all).
		this.bind_click($el.find('.pod-kpi.is-click'), (el) => {
			const d = defs[+$(el).data('i')];
			this.view = d.view === this.view ? 'all' : d.view;
			$el.find('.pod-kpi').each((_, k) => {
				const on = defs[+$(k).data('i')].view === this.view;
				$(k).toggleClass('is-on', on);
				if ($(k).is('[aria-pressed]')) $(k).attr('aria-pressed', String(on));
			});
			this.render_board();
			this.count_up(this.$root.find('#pod-board'));
		});
		this.render_funnel_bars(open);
		this.render_funnel_units(open);
		this.render_board();
		this.count_up(this.$root.find('.pod-pane[data-pane="dash"]'));
	}

	// "Funnel by unit" (Hiring Funnel tab): one row per unit, the funnel
	// steps as columns, each count with its share of the step before.
	render_funnel_units(open) {
		const $el = this.$root.find('#pod-fununits');
		const defs = this.card_defs().filter(d => !d.aside);
		const progs = (this.data.units_in_scope || []);
		if (!progs.length) { $el.html(`<div class="pod-empty">${__('You have no access to any programme.')}</div>`); return; }
		const val = (d, p) => {
			const u = (d.units || []).find(x => x.program === p);
			return u ? u.value : null;
		};
		const rows = progs.map(u => ({ program: u.program, unit: u.unit, vals: defs.map(d => val(d, u.program)) }));
		$el.html(`<table class="pod-table pod-fun-table"><thead><tr><th>${__('Unit')}</th>${defs.map(d => `<th>${this.esc(d.label)}</th>`).join('')}</tr></thead>
			<tbody>${rows.map(r => `<tr><td><b>${this.esc(r.unit)}</b></td>${r.vals.map((v, i) => {
				if (v === null || v === undefined) return `<td><span class="pod-zero">—</span></td>`;
				const prev = i ? r.vals[i - 1] : null;
				const pct = i && prev ? `<span class="pod-muted">${this.pct(v, prev)}%</span>` : '';
				return `<td>${v ? `<a class="pod-num" data-i="${i}" data-prog="${this.esc(r.program)}" data-unit="${this.esc(r.unit)}">${this.n(v)}</a>` : '<span class="pod-zero">0</span>'} ${pct}</td>`;
			}).join('')}</tr>`).join('')}</tbody></table>`);
		$el.off('click.podfu').on('click.podfu', '.pod-num', (e) => {
			const $a = $(e.currentTarget);
			const d = defs[+$a.data('i')];
			open(d.k, `${d.label} · ${$a.data('unit')}`, { units: d.units, unit_on: String($a.data('prog')) });
		});
	}

	// Funnel bars under the cards — one series, so one hue and no legend.
	// Bars start at the same left edge (length = share of all registrations,
	// a tiny step still gets a visible sliver); each row also says how many
	// moved on from the step before and how many dropped off there.
	render_funnel_bars(open) {
		const $el = this.$root.find('#pod-funbars');
		const defs = this.card_defs().filter(d => !d.aside);   // the funnel steps only
		const regs = defs[0].v || 0;
		if (!regs) { $el.html(`<div class="pod-empty">${__('No registrations in this period.')}</div>`); return; }
		$el.html(`<div class="pod-fun">${defs.map((d, i) => {
			const v = d.v || 0;
			const w = Math.max(v ? 0.6 : 0, (v / regs) * 100);
			const lost = i ? Math.max(0, (d.prev_v || 0) - v) : 0;
			return `<div class="pod-fun-row ${v ? 'is-click' : ''}" data-i="${i}" ${v ? 'role="button" tabindex="0"' : ''}>
				<div class="pod-fun-label">${this.esc(d.label)}</div>
				<div class="pod-fun-track"><div class="pod-fun-bar" style="width:${w}%"></div></div>
				<div class="pod-fun-val"><b>${this.n(v)}</b></div>
				<div class="pod-fun-pct">${i ? `<b>${d.step ?? 0}%</b> ${__('of previous')}` : `<b>100%</b>`}</div>
				<div class="pod-fun-pct pod-muted">${i ? __('{0}% of all', [d.of_reg ?? 0]) : ''}</div>
				<div class="pod-fun-lost">${i && lost ? `−${this.n(lost)} ${__('did not reach')}` : ''}</div>
			</div>`;
		}).join('')}</div>`);
		const $tip = this.$root.find('#pod-tip');
		$el.find('.pod-fun-row').on('mousemove', (e) => {
			const d = defs[$(e.currentTarget).data('i')];
			const i = $(e.currentTarget).data('i');
			$tip.html(`<b>${this.esc(d.label)}</b> · ${this.esc(this.n(d.v))}<br>
				<span class="pod-muted">${i
					? this.esc(__('{0}% of {1} ({2}) · {3}% of all registrations', [d.step ?? 0, d.prev_label, this.n(d.prev_v), d.of_reg ?? 0]))
					: this.esc(__('All registrations in the selected period'))}</span>`)
				.css({ display: 'block', left: e.clientX + 14, top: e.clientY + 14 });
		}).on('mouseleave', () => $tip.hide());
		this.bind_click($el.find('.pod-fun-row.is-click'), (row) => {
			$tip.hide();
			const d = defs[$(row).data('i')];
			open(d.k, d.label, { units: d.units });
		});
	}

	// ── the hiring-pipeline board (whiteboard) ─────────────────────────────
	// Sections in pipeline order. A tile is one count, or a PAIR (outcome |
	// the outcome that needs attention) with a bar showing their split. Each
	// row is laid out on its own grid (max 6 columns) so rows always fill
	// the width; each number opens its own drilldown.
	render_board() {
		const $el = this.$root.find('#pod-board');
		this.cards_by_key = {};
		const regs = this.sum('registrations');
		// Only the count and a percentage: its share of Total registrations,
		// for pairs and singles alike (interview tiles count interviews, not
		// people, so they show the count only).
		const half = (c, is_pair, total) => {
			this.cards_by_key[c.key] = c;
			const col = POD_TONES[c.tone] || POD_TONES.neutral;
			const na = c.value === null || c.value === undefined;
			const flag = !na && c.value > 0 && (c.tone === 'action' || c.tone === 'time');
			const share = na || c.kind !== 'card' || !regs ? null : this.pct(c.value, regs);
			const share_of = __('of total registrations');
			return `<div class="pod-half ${!na && c.value ? 'is-click' : ''} ${flag ? 'is-flag' : ''} ${na ? 'is-na' : ''}"
					style="--c:${col}" data-card="${this.esc(c.key)}" ${!na && c.value ? 'role="button" tabindex="0"' : ''}
					${na ? `title="${this.esc(__('Not tracked for these units'))}"` : ''}>
				${is_pair ? `<div class="pod-half-label"><i class="pod-dot" style="--c:${col}"></i>${this.esc(__(c.label))}
					${flag ? `<span class="pod-flag">${c.tone === 'time' ? __('Today') : __('Action')}</span>` : ''}</div>` : ''}
				<div class="pod-half-value">${na ? '—' : this.count_html(c.value)}${share !== null ? `<span class="pod-share" title="${this.esc(share_of)}">${!share && c.value ? '&lt;0.1' : share}%</span>` : ''}</div>
				<div class="pod-half-hint">${this.esc(na ? __('not tracked here') : __(c.hint || (!is_pair && share !== null ? 'of total registrations' : '')))}</div>
			</div>`;
		};
		let tile_i = 0;          // stagger order for the rise-in animation
		const tile = (it) => {
			const first = it.cards[0];
			const pair = it.layout === 'pair';
			// A pair cut to one half (e.g. CV Shortlist without CV Regret) is titled by that card.
			const [title] = it.split ? [first.label] : (POD_TILES[first.key] || [first.label]);
			const vals = it.cards.map(c => c.value || 0);
			const total = vals.reduce((a, b) => a + b, 0);
			const desc = it.cards.map(c => (pair ? `${__(c.label)}: ` : '') + (c.desc || '')).join('\n\n')
				+ '\n\n' + (first.kind === 'card' ? __('% = share of total registrations.') : '');
			// "Action" badge only: "Interviews Today" already says today (and its
			// number is in the today colour), and the badge would cut its title.
			const single_flag = !pair && first.value > 0 && first.tone === 'action';
			return `<div class="pod-tile ${pair ? 'is-pair' : ''}" style="grid-column:span ${pair ? 2 : 1};--i:${tile_i++}">
				<div class="pod-tile-head">
					<span class="pod-tile-title">${this.esc(__(title))}</span>
					${single_flag ? `<span class="pod-flag" style="--c:${POD_TONES[first.tone]}">${first.tone === 'time' ? __('Today') : __('Action')}</span>` : ''}
					${this.info_html(desc)}
				</div>
				<div class="pod-halves">${it.cards.map(c => half(c, pair, total)).join('')}</div>

			</div>`;
		};
		// rows of at most 6 columns (pair = 2, single = 1)
		const rows_of = (items) => {
			const rows = [[]];
			let used = 0;
			items.forEach(it => {
				const w = it.layout === 'pair' ? 2 : 1;
				if (used + w > 6) { rows.push([]); used = 0; }
				rows[rows.length - 1].push(it);
				used += w;
			});
			return rows;
		};
		// The top card picked decides which cards show (POD_VIEWS).
		const view = this.view || 'all';
		const keep = POD_VIEWS[view] ? new Set(POD_VIEWS[view]) : null;
		const groups = (this.data.board || []).map(g => ({ ...g, items: !keep ? g.items : g.items.map(it => {
			const cards = it.cards.filter(c => keep.has(c.key));
			if (!cards.length) return null;
			return cards.length === it.cards.length ? it : { layout: 'single', split: true, cards };
		}).filter(Boolean) })).filter(g => g.items.length);
		const top = (this.top_by_view || {})[view];
		const bar = top ? `<div class="pod-view-bar">
				<span class="pod-view-title">${this.esc(top.label)}</span>
				<span class="pod-view-n">${this.n(top.v)}${top.share !== null && top.share !== undefined && view !== 'all'
					? ` · ${!top.share && top.v ? '&lt;0.1' : top.share}% ${this.esc(__('of total registrations'))}` : ''}</span>
				${top.v ? `<button class="btn btn-xs btn-default pod-view-list">${__('View list')}</button>` : ''}
				${view !== 'all' ? `<button class="btn btn-xs btn-default pod-view-all">${__('Show all cards')}</button>` : ''}
			</div>` : '';
		const bind_bar = () => {
			$el.find('.pod-view-list').on('click', () => {
				if (top && this.open_top) this.open_top(top.k, top.label, { units: top.units });
			});
			$el.find('.pod-view-all').on('click', () => {
				this.$root.find('#pod-cards .pod-kpi[data-k="registrations"]').trigger('click');
			});
		};
		if (POD_STEP_VIEWS[view]) {
			$el.html(bar + this.steps_html(view));
			bind_bar();
			this.bind_steps($el, view);
			return;
		}
		$el.html(bar + groups.map(g => `
			<section class="pod-bgroup">
				<div class="pod-group-title">${this.esc(__(g.title))}</div>
				${rows_of(g.items).map(row => {
					const cols = row.reduce((a, it) => a + (it.layout === 'pair' ? 2 : 1), 0);
					return `<div class="pod-row" style="--cols:${cols}">${row.map(tile).join('')}</div>`;
				}).join('')}
			</section>`).join(''));
		this.bind_click($el.find('.pod-half.is-click'), (el) => {
			const c = this.cards_by_key[String($(el).data('card'))];
			if (c) this.drill_card(c);
		});
		bind_bar();
	}

	// Reject view: every rejected applicant in exactly one step (server
	// REJECT_GROUPS, so the steps add up to Total Reject), as step cards in
	// pipeline order plus a step × unit table. Every number opens its list.
	steps_html(view) {
		const t = POD_STEP_VIEWS[view];
		const groups = (this.data.step_groups || {})[view] || [];
		const total = groups.reduce((s, g) => s + (g.value || 0), 0);
		const regs = this.sum('registrations');
		const pct = (v, of) => !of ? 0 : (v && this.pct(v, of) === 0 ? '<0.1' : this.pct(v, of));
		const units = this.data.units_in_scope || [];
		if (!total) return `<div class="pod-empty">${t.empty}</div>`;
		const card = (g, i) => {
			const desc = `${g.desc}\n\n${__('Counts Application Status')}:\n`
				+ (g.statuses.length ? g.statuses.map(([s, n]) => `${s}: ${this.n(n)}`).join('\n') : __('none in this period'))
				+ `\n\n${pct(g.value, total)}% ${t.of_all} · ${__('{0}% of total registrations', [pct(g.value, regs)])}`;
			return `<div class="pod-tile pod-rej ${g.value ? 'is-click' : 'is-empty'}" style="--i:${i}" data-rg="${this.esc(g.key)}"
					${g.value ? 'role="button" tabindex="0"' : ''}>
				<div class="pod-tile-head">
					<span class="pod-rej-step">${String(i + 1).padStart(2, '0')}</span>
					<span class="pod-tile-title">${this.esc(__(g.label))}</span>
					${this.info_html(desc)}
				</div>
				<div class="pod-half-value">${this.count_html(g.value)}<span class="pod-share" title="${this.esc(t.of_all)}">${pct(g.value, total)}%</span></div>
				<div class="pod-half-hint">${this.esc(__(g.hint || t.of_all))}</div>
			</div>`;
		};
		const cell = (g, u, v) => v
			? `<a class="pod-num" data-rg="${this.esc(g.key)}" data-prog="${this.esc(u.program)}" data-unit="${this.esc(u.unit)}">${this.n(v)}</a>`
			: '<span class="pod-zero">0</span>';
		const uval = (g, p) => ((g.by_unit || []).find(x => x.program === p) || {}).value || 0;
		const utot = (p) => groups.reduce((s, g) => s + uval(g, p), 0);
		// Two sections: the Select / Reject result of each round, then the rest.
		// Numbering runs on across both, in pipeline order.
		const idx = new Map(groups.map((g, i) => [g.key, i]));
		const sections = ['result', 'process'].map(sec => {
			const list = groups.filter(g => (g.section || 'process') === sec);
			if (!list.length) return '';
			const cols = sec === 'result' ? list.length : t.cols;
			return `<section class="pod-bgroup">
				<div class="pod-group-title">${t.sections[sec]}</div>
				<div class="pod-rej-grid" style="--cols:${Math.min(cols, 6)}">${list.map(g => card(g, idx.get(g.key))).join('')}</div>
			</section>`;
		}).join('');
		// Where every number comes from: card → unit → form + field → status values (count).
		const src_rows = groups.filter(g => g.value).map((g, gi) => (g.sources || []).map((src, si) => `<tr>
				${si === 0 ? `<td rowspan="${g.sources.length}" class="pod-src-card"><span class="pod-rej-step">${String(idx.get(g.key) + 1).padStart(2, '0')}</span><b>${this.esc(__(g.label))}</b>
					<div class="pod-muted">${this.n(g.value)} ${__('applicants')}</div></td>` : ''}
				<td class="nw">${this.esc(src.unit)}</td>
				<td class="nw"><span class="pod-muted">${this.esc(src.doctype)}</span> · <code>${this.esc(src.field)}</code></td>
				<td>${src.statuses.length
					? src.statuses.map(([st, n]) => `<span class="pod-src-chip ${n ? '' : 'is-zero'}">${this.esc(st)} <b>${this.n(n)}</b></span>`).join('')
					: `<span class="pod-muted">${__('This form has no such status, so nothing is counted here')}</span>`}</td>
				<td class="is-num">${this.n(src.statuses.reduce((a, x) => a + x[1], 0))}</td>
			</tr>`).join('')).join('');
		return sections + `
			<section class="pod-bgroup">
				<div class="pod-group-title">${t.by_unit}</div>
				<div class="pod-rej-table-wrap">
					<table class="pod-table pod-rej-table">
						<thead><tr><th>${__('Step')}</th>${units.map(u => `<th class="is-num">${this.esc(u.unit)}</th>`).join('')}
							<th class="is-num">${__('Total')}</th><th class="is-num">${t.pct_col}</th></tr></thead>
						<tbody>${groups.map((g, i) => `<tr class="${g.value ? '' : 'is-zero-row'}">
							<td><span class="pod-rej-step">${String(i + 1).padStart(2, '0')}</span>${this.esc(__(g.label))}</td>
							${units.map(u => `<td class="is-num">${cell(g, u, uval(g, u.program))}</td>`).join('')}
							<td class="is-num">${g.value ? `<a class="pod-num" data-rg="${this.esc(g.key)}">${this.n(g.value)}</a>` : '<span class="pod-zero">0</span>'}</td>
							<td class="is-num pod-muted">${pct(g.value, total)}%</td></tr>`).join('')}</tbody>
						<tfoot><tr><td>${t.total}</td>${units.map(u => `<td class="is-num">${this.n(utot(u.program))}</td>`).join('')}
							<td class="is-num">${this.n(total)}</td><td class="is-num">100%</td></tr></tfoot>
					</table>
				</div>
			</section>
			<section class="pod-bgroup">
				<div class="pod-group-title">${__('How each card is counted — status values used, by unit and field')}</div>
				<div class="pod-rej-table-wrap">
					<table class="pod-table pod-rej-table pod-src-table">
						<thead><tr><th>${__('Card')}</th><th>${__('Unit')}</th><th>${__('Form · field')}</th>
							<th>${__('Application Status values counted (applicants)')}</th><th class="is-num">${__('Count')}</th></tr></thead>
						<tbody>${src_rows}</tbody>
					</table>
				</div>
			</section>`;
	}

	bind_steps($el, view) {
		const t = POD_STEP_VIEWS[view];
		const groups = Object.fromEntries(((this.data.step_groups || {})[view] || []).map(g => [g.key, g]));
		const open = (key, prog, unit) => {
			const g = groups[key];
			if (!g) return;
			this.drill('registrations', `${t.title} · ${__(g.label)}${unit ? ` · ${unit}` : ''}`,
				{ step_group: `${view}:${key}`, units: g.by_unit, unit_on: prog || '' });
		};
		this.bind_click($el.find('.pod-rej.is-click'), (el) => open(String($(el).data('rg'))));
		$el.find('.pod-rej-table .pod-num').on('click', (e) => {
			const $a = $(e.currentTarget);
			open(String($a.data('rg')), $a.data('prog') ? String($a.data('prog')) : '', $a.data('unit') ? String($a.data('unit')) : '');
		});
	}

	// ── Ask AI (chat over the dashboard numbers; server: ai_chat.py) ──────────
	bind_ai($c) {
		this.ai_history = [];
		const $panel = $c.find('#pod-ai');
		const $q = $c.find('#pod-ai-q');
		const open = () => {
			$panel.prop('hidden', false);
			if (!this.ai_history.length) this.ai_render();
			setTimeout(() => $q.trigger('focus'), 50);
		};
		$c.find('#pod-ai-open').on('click', () => ($panel.prop('hidden') ? open() : $panel.prop('hidden', true)));
		$c.find('#pod-ai-close').on('click', () => $panel.prop('hidden', true));
		$c.find('#pod-ai-clear').on('click', () => { this.ai_history = []; this.ai_render(); $q.trigger('focus'); });
		$c.find('#pod-ai-send').on('click', () => this.ai_send());
		$q.on('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.ai_send(); }
			if (e.key === 'Escape') $panel.prop('hidden', true);
		});
		$c.find('#pod-ai-log').on('click', '.pod-ai-chip', (e) => {
			$q.val($(e.currentTarget).text());
			this.ai_send();
		});
	}

	// Model text is escaped before markdown, so it can never inject HTML.
	ai_md(text) {
		const safe = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		return frappe.markdown ? frappe.markdown(safe) : `<p>${safe.replace(/\n/g, '<br>')}</p>`;
	}

	ai_render(pending) {
		const $log = this.$root.find('#pod-ai-log');
		const tool_names = { get_dashboard_summary: __('Dashboard summary'), get_step_breakdown: __('Select / Reject steps'),
			get_status_counts: __('Status counts'), get_analytics: __('Analytics'),
			offline: __('Dashboard numbers (free offline mode, no AI)') };
		const used = (steps) => (steps || []).length
			? `<div class="pod-ai-used">${__('Looked up')}: ${(steps || []).map(s => this.esc(
				(tool_names[s.tool] || s.tool) + (s.input && (s.input.view || s.input.section) ? ` (${s.input.view || s.input.section})` : ''))).join(', ')}</div>` : '';
		if (!this.ai_history.length && !pending) {
			const ideas = [__('How many Test Select are there in each unit?'), __('Which step rejects the most applicants?'),
				__('Compare Recruiter Round Reject across units'), __('Top 5 job openings by number of applicants'),
				__('Offer Sent by unit this year'), __('Where do most applicants come from?'), __('Help')];
			$log.html(`<div class="pod-ai-empty">
				<p>${__('Ask about the hiring numbers — name a card, step or status, a unit and a period (e.g. "Test Reject in Health last month"). The answer uses the dates and units applied on the dashboard unless you name others.')}</p>
				<div class="pod-ai-chips">${ideas.map(i => `<button class="pod-ai-chip">${this.esc(i)}</button>`).join('')}</div>
			</div>`);
			return;
		}
		$log.html(this.ai_history.map(m => m.role === 'user'
			? `<div class="pod-ai-msg is-user">${this.esc(m.content)}</div>`
			: `<div class="pod-ai-msg is-ai ${m.error ? 'is-error' : ''}">${this.ai_md(m.content)}${used(m.steps)}</div>`).join('')
			+ (pending ? `<div class="pod-ai-msg is-ai is-pending"><span class="pod-ai-dots"><i></i><i></i><i></i></span> ${__('Looking up the numbers…')}</div>` : ''));
		$log.scrollTop($log[0].scrollHeight);
	}

	ai_send() {
		const $q = this.$root.find('#pod-ai-q');
		const q = String($q.val() || '').trim();
		if (!q || this.ai_busy) return;
		const history = this.ai_history.filter(m => !m.error).map(m => ({ role: m.role, content: m.content }));
		this.ai_history.push({ role: 'user', content: q });
		$q.val('');
		this.ai_busy = true;
		this.$root.find('#pod-ai-send').prop('disabled', true);
		this.ai_render(true);
		const f = this.filters || this.current_filters();
		const filters = { from_date: f.from_date || null, to_date: f.to_date || null };
		['units', 'subunits', 'locations', 'job_codes', 'job_openings', 'roles'].forEach(k => { filters[k] = f[k] || []; });
		frappe.call({
			method: 'ms_calendar.ms_calendar.page.pathways_overall_dashboard.ai_chat.ask',
			args: { question: q, history: JSON.stringify(history), filters: JSON.stringify(filters) },
			callback: (r) => {
				const m = r.message || {};
				this.ai_history.push(m.error
					? { role: 'assistant', content: m.message || __('Something went wrong.'), error: true }
					: { role: 'assistant', content: m.answer || '', steps: m.steps });
			},
			error: () => this.ai_history.push({ role: 'assistant', content: __('The request failed. Please try again.'), error: true }),
			always: () => {
				this.ai_busy = false;
				this.$root.find('#pod-ai-send').prop('disabled', false);
				this.ai_render();
				$q.trigger('focus');
			}
		});
	}

	// "Card guide": every card's definition in one place.
	open_guide() {
		const esc = (v) => this.esc(v);
		const head = this.top_defs();
		const d = new frappe.ui.Dialog({ title: __('Card guide — what each number means'), size: 'extra-large' });
		d.$wrapper.find('.modal-dialog').addClass('pod-modal-wide');
		d.$wrapper.find('.modal-dialog').addClass('modal-dialog-centered');
		d.$body.html(`<style>${POD_CSS}</style><div class="pod-root pod-guide">
			<p class="pod-muted" style="font-size:12.5px">${__('Every card counts applicants who are at that point <b>right now</b>, for the filters you applied (application date, programme, unit, sub-unit, location, job code, role, stage) and only for records you are allowed to see. Click any number on the dashboard to open the list behind it; click a name for the full applicant record.')}</p>
			<div class="pod-guide-sec">${__('Units')}</div>
			<div class="pod-guide-row"><b>${__('Where the numbers come from')}</b><span>${__('Every card adds up these Units (from each registration form\'s Unit field):')}
				${(this.data.units_in_scope || []).map(u => `<br><b>${esc(u.unit)}</b> — ${esc(__(u.program))} ${__('registrations')}`).join('')}
				<br>${__('Click any card: the popup opens with one card per unit (count and share) above the list; click a unit to see only its applicants. A unit is left out of a card when that unit has no such step (e.g. Compensation is tracked only for Field).')}</span></div>
			<div class="pod-guide-sec">${__('Headline')}</div>
			${head.map(h => `<div class="pod-guide-row"><b>${esc(h.label)}</b><span>${esc(h.desc)}</span></div>`).join('')}
			${(this.data.board || []).map(g => `
				<div class="pod-guide-sec">${esc(__(g.title))}</div>
				${g.items.flatMap(it => it.cards).map(c => `
					<div class="pod-guide-row"><b><i class="pod-dot" style="--c:${POD_TONES[c.tone] || POD_TONES.neutral}"></i>${esc(__(c.label))}</b>
					<span>${esc(c.desc)}<br><span class="pod-muted">${__('Units')}: ${esc((c.by_unit || []).map(u => u.unit).join(', ') || __('none in scope'))}</span></span></div>`).join('')}`).join('')}
			<div class="pod-guide-sec">${__('Colours')}</div>
			<div class="pod-guide-row"><b>${__('Colour key')}</b><span>
				<i class="pod-dot" style="--c:${POD_TONES.good}"></i>${__('positive outcome')} &nbsp;
				<i class="pod-dot" style="--c:${POD_TONES.bad}"></i>${__('rejected / declined')} &nbsp;
				<i class="pod-dot" style="--c:${POD_TONES.action}"></i>${__('needs action (marked "Action" when above 0)')} &nbsp;
				<i class="pod-dot" style="--c:${POD_TONES.time}"></i>${__('happening today')} &nbsp;
				<i class="pod-dot" style="--c:${POD_TONES.info}"></i>${__('in progress')}</span></div>
		</div>`);
		d.show();
	}

	drill_card(c) {
		this.drill(c.kind === 'card' ? 'card' : c.kind, __(c.label),
			{ card: c.key, date_label: c.date_label, units: c.by_unit });
	}

	// Highlight the date preset that matches the applied range.
	mark_preset() {
		const f = this.filters || {};
		this.$root.find('.pod-preset:not(.pod-rpreset)').each((_, b) => {
			const [a, z] = this.preset_range($(b).data('p'));
			$(b).toggleClass('is-on', (a || null) === (f.from_date || null) && (z || null) === (f.to_date || null));
		});
	}

	// ── stage mix (horizontal bars, status colours + labels) ───────────────
	render_stages() {
		const total = this.sum('registrations');
		const rows = (this.data.stages || []).map(s => ({ s, v: this.stage_total(s) }));
		const max = Math.max(1, ...rows.map(r => r.v));
		const $el = this.$root.find('#pod-stages');
		$el.html(rows.map(r => `
			<div class="pod-bar-row ${r.v ? 'is-click' : ''}" data-s="${this.esc(r.s)}">
				<div class="pod-bar-label"><span class="pod-dot" style="--c:${POD_STAGE_COLORS[r.s]}"></span>${this.esc(r.s)}</div>
				<div class="pod-bar-track"><div class="pod-bar" style="width:${Math.max(r.v ? 1.5 : 0, (r.v / max) * 100)}%;--c:${POD_STAGE_COLORS[r.s]}"></div></div>
				<div class="pod-bar-val"><b>${this.n(r.v)}</b> <span class="pod-muted">${this.pct(r.v, total)}%</span></div>
			</div>`).join(''));
		$el.find('.pod-bar-row.is-click').on('click', (e) => {
			const s = String($(e.currentTarget).data('s'));
			this.drill('registrations', s, { stage: s });
		});
	}

	// ── weekly trend (single series → no legend; hover tooltip) ───────────
	render_trend() {
		const $el = this.$root.find('#pod-trend');
		const pts = this.data.trend || [];
		if (!pts.length) { $el.html(`<div class="pod-empty">${__('No registrations in this period.')}</div>`); return; }
		const W = 640, H = 220, L = 46, R = 10, T = 12, B = 34;
		const max = Math.max(...pts.map(p => p[1]));
		const nice = (v) => { const m = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1)))); return Math.ceil(v / m) * m; };
		const top = nice(max);
		const bw = (W - L - R) / pts.length;
		const gap = Math.min(2, bw * 0.2);
		const y = (v) => T + (H - T - B) * (1 - v / top);
		const ticks = [0, top / 2, top];
		const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
		const every = Math.ceil(pts.length / 8);
		const bars = pts.map(([wk, v], i) => {
			const x = L + i * bw + gap / 2, w = Math.max(1, bw - gap), yy = y(v), h = (H - B) - yy;
			const rr = Math.min(4, w / 2, h);
			// rounded data-end (top), square at the baseline
			const d = `M${x},${H - B} V${yy + rr} Q${x},${yy} ${x + rr},${yy} H${x + w - rr} Q${x + w},${yy} ${x + w},${yy + rr} V${H - B} Z`;
			return `<g class="pod-tbar" data-i="${i}">
				<rect x="${L + i * bw}" y="${T}" width="${bw}" height="${H - B - T}" fill="transparent"></rect>
				<path d="${d}" fill="#2C5F8A"></path></g>`;
		}).join('');
		const labels = pts.map(([wk], i) => i % every ? '' :
			`<text x="${L + i * bw + bw / 2}" y="${H - B + 16}" text-anchor="middle" class="pod-axis">${this.esc(frappe.datetime.str_to_user(wk).slice(0, 5))}</text>`).join('');
		$el.html(`<svg viewBox="0 0 ${W} ${H}" class="pod-svg" role="img" aria-label="${__('Registrations per week')}">
			${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="pod-grid"></line>
				<text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" class="pod-axis">${this.esc(compact.format(t))}</text>`).join('')}
			${bars}${labels}</svg>`);
		const $tip = this.$root.find('#pod-tip');
		$el.find('.pod-tbar').on('mousemove', (e) => {
			const [wk, v] = pts[$(e.currentTarget).data('i')];
			$tip.html(`<b>${this.esc(this.n(v))}</b> ${__('registrations')}<br><span class="pod-muted">${__('Week of')} ${this.esc(this.fmt_date(wk))}</span>`)
				.css({ display: 'block', left: e.clientX + 14, top: e.clientY + 14 });
		}).on('mouseleave', () => $tip.hide()).on('click', (e) => {
			$tip.hide();
			const [wk] = pts[$(e.currentTarget).data('i')];
			const end = frappe.datetime.add_days(wk, 6);
			const f = this.filters;
			const from = f.from_date && f.from_date > wk ? f.from_date : wk;
			const to = f.to_date && f.to_date < end ? f.to_date : end;
			this.drill('registrations', __('Registered week of {0}', [this.fmt_date(wk)]), { from_date: from, to_date: to });
		});
	}

	// ── programme funnel ───────────────────────────────────────────────────
	funnel_columns() {
		const num = (key, kind, opts = {}) => ({
			key, label: opts.label, sort: (r) => r[key] === null ? -1 : r[key],
			render: (r) => {
				const v = opts.get ? opts.get(r) : r[key];
				if (v === null || v === undefined) return `<span class="pod-zero">—</span>`;
				if (!v) return `<span class="pod-zero">0</span>`;
				return `<a class="pod-num ${opts.red ? 'is-red' : ''}" data-kind="${kind}" data-prog="${this.esc(r.program)}"
					data-stage="${this.esc(opts.stage || '')}" data-l="${this.esc(opts.label)}">${this.n(v)}</a>`;
			},
			csv: (r) => (opts.get ? opts.get(r) : r[key]) ?? ''
		});
		return [
			{ key: 'program', label: __('Programme'), render: (r) => this.program_pill(r.program), csv: (r) => r.program },
			num('registrations', 'registrations', { label: __('Registrations') }),
			num('applications', 'applications', { label: __('Application forms') }),
			num('new', 'registrations', { label: __('Awaiting screening'), stage: 'New', get: (r) => r.stages['New'] }),
			num('interviewed', 'interviews', { label: __('Interviewed (applicants)') }),
			num('interviews', 'interviews', { label: __('Interviews') }),
			num('feedback', 'feedback', { label: __('Feedback') }),
			num('pending', 'pending', { label: __('Feedback pending'), red: true }),
			num('offer', 'registrations', { label: __('Offer / Selected'), stage: 'Offer / Selected', get: (r) => r.stages['Offer / Selected'] }),
			num('rejected', 'registrations', { label: __('Not selected'), stage: 'Not selected', get: (r) => r.stages['Not selected'] }),
			{ key: 'conv', label: __('Conversion'), sort: (r) => this.pct(r.stages['Offer / Selected'], r.registrations),
				render: (r) => r.registrations ? `<b>${this.pct(r.stages['Offer / Selected'], r.registrations)}%</b>` : '<span class="pod-zero">—</span>',
				csv: (r) => r.registrations ? this.pct(r.stages['Offer / Selected'], r.registrations) + '%' : '' }
		];
	}

	render_funnel() {
		const rows = (this.data.funnel || []).map(r => Object.assign({}, r, {
			new: r.stages['New'], offer: r.stages['Offer / Selected'], rejected: r.stages['Not selected']
		}));
		const cols = this.funnel_columns();
		const $el = this.$root.find('#pod-funnel');
		this.sortable_table($el, cols, rows, { empty: __('You have no access to any programme.') });
		$el.off('click.podnum').on('click.podnum', '.pod-num', (e) => {
			const $a = $(e.currentTarget);
			const prog = String($a.data('prog'));
			const stage = String($a.data('stage') || '');
			this.drill(String($a.data('kind')), `${prog} · ${$a.data('l')}`, Object.assign({ programs: [prog] }, stage ? { stage } : {}));
		});
		this.$root.find('#pod-export-funnel').off('click').on('click', () => this.export_csv('pathways_programme_funnel', cols, rows));
	}

	// ── running tables ─────────────────────────────────────────────────────
	interview_columns() {
		return [
			this.id_col(),
			{ key: 'date', label: __('Date'), nw: true, render: (r) => this.esc(this.fmt_date(r.date)) },
			{ key: 'time', label: __('Time'), nw: true },
			{ key: 'program', label: __('Programme'), render: (r) => this.program_pill(r.program), csv: (r) => r.program },
			{ key: 'name', label: __('Applicant'), render: (r) => this.cand_link(r) },
			{ key: 'round', label: __('Round') },
			{ key: 'mode', label: __('Mode') },
			{ key: 'interviewer', label: __('Interviewer') },
			{ key: 'days', label: __('Days pending'), pending_only: true,
				render: (r) => r.days === '' ? '' : `<b class="${+r.days > 2 ? 'pod-red' : ''}">${this.esc(r.days)}</b>` },
			{ key: 'cancelled', label: __('Cancelled'), render: (r) => r.cancelled ? `<span class="pod-pill" style="--c:#B83232">${__('Cancelled')}</span>` : '' },
			{ key: 'status', label: __('Current status') },
			{ key: 'interview', label: __('Interview'), nw: true, render: (r) => this.doc_link(r.doctype, r.interview) }
		];
	}
	feedback_columns() {
		return [
			this.id_col(),
			{ key: 'submitted_on', label: __('Submitted'), nw: true, render: (r) => this.esc(this.fmt_dt(r.submitted_on)) },
			{ key: 'program', label: __('Programme'), render: (r) => this.program_pill(r.program), csv: (r) => r.program },
			{ key: 'name', label: __('Applicant'), render: (r) => this.cand_link(r) },
			{ key: 'doctype', label: __('Form') },
			{ key: 'result', label: __('Result'), render: (r) => this.result_pill(r.result) },
			{ key: 'by', label: __('By') },
			{ key: 'feedback', label: __('Record'), nw: true, render: (r) => this.doc_link(r.doctype, r.feedback) }
		];
	}
	reg_columns(with_form = false, date_label = '') {
		const cols = [
			this.id_col(),
			{ key: 'created', label: __('Applied on'), nw: true, render: (r) => this.esc(this.fmt_date(r.created)) },
			{ key: 'program', label: __('Programme'), render: (r) => this.program_pill(r.program), csv: (r) => r.program },
			{ key: 'name', label: __('Applicant'), render: (r) => this.cand_link(r) },
			{ key: 'email', label: __('Email') },
			{ key: 'phone', label: __('Phone'), nw: true },
			{ key: 'role', label: __('Role') },
			{ key: 'subunit', label: __('Sub-unit') },
			{ key: 'location', label: __('Location') },
			{ key: 'job_code', label: __('Job code'), nw: true },
			{ key: 'status', label: __('Status') },
			{ key: 'stage', label: __('Stage'), render: (r) => this.stage_pill(r.stage) }
		];
		if (date_label) {
			cols.splice(2, 0, { key: 'key_date', label: __(date_label), nw: true,
				render: (r) => `<b>${this.esc(this.fmt_date(r.key_date))}</b>` });
		}
		if (with_form) {
			cols.push({ key: 'form_date', label: __('Form submitted'), nw: true, render: (r) => this.esc(this.fmt_dt(r.form_date)) });
			cols.push({ key: 'form', label: __('Form'), nw: true, render: (r) => this.doc_link(r.form_doctype, r.form) });
		}
		return cols;
	}

	log_columns() {
		return [
			this.id_col(),
			{ key: 'changed_on', label: __('Changed on'), nw: true, render: (r) => this.esc(this.fmt_dt(r.changed_on)) },
			{ key: 'program', label: __('Programme'), render: (r) => this.program_pill(r.program), csv: (r) => r.program },
			{ key: 'name', label: __('Applicant'), render: (r) => this.cand_link(r) },
			{ key: 'previous_status', label: __('From') },
			{ key: 'new_status', label: __('To'), render: (r) => `<b>${this.esc(r.new_status)}</b>` },
			{ key: 'changed_by', label: __('Changed by') },
			{ key: 'reason', label: __('Reason') },
			{ key: 'status', label: __('Current status') }
		];
	}

	// Running tables page through the server (no row cap) — same engine as
	// the drilldowns, so every row in scope is reachable and exportable.
	// Interviews / Feedback tables have their own date filter (interview
	// date / submitted date). The top Application-date filter is not applied
	// to them; every other top filter is.
	range_tools(key) {
		const presets = [['all', __('All')], ['today', __('Today')], ['next7', __('Next 7 days')],
			['last7', __('Last 7 days')], ['month', __('This month')]];
		return `<div class="pod-range" data-range="${key}">
			<div class="pod-range-presets">${presets.map(([k, l]) =>
				`<button type="button" class="pod-preset pod-rpreset ${k === 'all' ? 'is-on' : ''}" data-rp="${k}">${l}</button>`).join('')}</div>
			<label class="pod-range-f">${__('From')} <input type="date" class="pod-range-from"></label>
			<label class="pod-range-f">${__('To')} <input type="date" class="pod-range-to"></label>
		</div>`;
	}

	range_of(key) {
		const $r = this.$root.find(`.pod-range[data-range="${key}"]`);
		return { date_from: $r.find('.pod-range-from').val() || null, date_to: $r.find('.pod-range-to').val() || null };
	}

	bind_range(key, draw) {
		const $r = this.$root.find(`.pod-range[data-range="${key}"]`);
		if ($r.data('bound')) return;
		$r.data('bound', 1);
		const today = frappe.datetime.get_today();
		const d = (n) => frappe.datetime.add_days(today, n);
		const ranges = {
			all: [null, null], today: [today, today], next7: [today, d(7)], last7: [d(-7), today],
			month: [frappe.datetime.month_start(), frappe.datetime.month_end()]
		};
		// A preset or a date is a single choice → apply straight away.
		$r.on('click', '.pod-rpreset', (e) => {
			const k = $(e.currentTarget).data('rp');
			const [a, b] = ranges[k];
			$r.find('.pod-range-from').val(a || '');
			$r.find('.pod-range-to').val(b || '');
			$r.find('.pod-rpreset').removeClass('is-on');
			$(e.currentTarget).addClass('is-on');
			draw();
		});
		$r.on('change', 'input[type=date]', () => { $r.find('.pod-rpreset').removeClass('is-on'); draw(); });
	}

	render_upcoming() {
		const draw = () => this.server_table(this.$root.find('#pod-upcoming'), 'all_interviews',
			Object.assign({ own_dates: 1 }, this.range_of('iv')),
			{ columns: this.interview_columns().filter(c => !c.pending_only), title: 'interviews',
				page_size: 50, compact: true, empty: __('No interviews in this date range.') });
		this.bind_range('iv', draw);
		draw();
	}

	render_feedback() {
		const draw = () => this.server_table(this.$root.find('#pod-feedback'), 'feedback',
			Object.assign({ own_dates: 1 }, this.range_of('fb')),
			{ columns: this.feedback_columns(), title: 'feedback_forms', page_size: 50, compact: true,
				empty: __('No feedback forms in this date range.') });
		this.bind_range('fb', draw);
		draw();
	}

	render_reg_table() {
		this.server_table(this.$root.find('#pod-reg'), 'registrations', {},
			{ columns: this.reg_columns(), title: 'registrations', empty: __('No registrations match these filters.') });
	}

	// ── generic sortable table ─────────────────────────────────────────────
	sortable_table($el, columns, rows, opts = {}) {
		const cols = columns.filter(c => !c.hidden);
		let sort_key = $el.data('pod-sort') || opts.default_sort || null;
		let dir = $el.data('pod-dir') || opts.default_dir || 1;
		const value_of = (c, r) => c.sort ? c.sort(r) : r[c.key];
		const draw = () => {
			let data = rows.slice();
			if (sort_key) {
				const c = cols.find(x => x.key === sort_key) || cols[0];
				data.sort((a, b) => {
					const x = value_of(c, a), y = value_of(c, b);
					if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
					return String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true }) * dir;
				});
			}
			if (!data.length) {
				$el.html(`<div class="pod-empty">${this.esc(opts.empty || __('Nothing to show.'))}</div>`);
				return;
			}
			$el.html(`<table class="pod-table"><thead><tr>${cols.map(c => `
				<th data-key="${c.key}" class="${c.key === sort_key ? 'is-sorted' : ''}">${this.esc(c.label)}
				<span class="pod-sort">${c.key === sort_key ? (dir === 1 ? '▲' : '▼') : '↕'}</span></th>`).join('')}
				</tr></thead><tbody>${data.map(r => `<tr>${cols.map(c =>
					`<td${c.nw ? ' class="nw"' : ''}${c.render ? '' : ` title="${this.esc(r[c.key])}"`}>${c.render ? c.render(r) : this.esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
		};
		$el.off('click.podsort').on('click.podsort', 'th', (e) => {
			const k = $(e.currentTarget).data('key');
			dir = sort_key === k ? -dir : 1;
			sort_key = k;
			$el.data('pod-sort', sort_key).data('pod-dir', dir);
			draw();
		});
		draw();
	}

	bind_candidate_links($el) {
		$el.off('click.podcand').on('click.podcand', '.pod-cand', (e) => {
			// Ctrl/Cmd/Shift-click on an Applicant ID → the browser opens its href.
			if (e.ctrlKey || e.metaKey || e.shiftKey) return;
			e.preventDefault();
			const prog = String($(e.currentTarget).data('prog') || '');
			const id = String($(e.currentTarget).data('id') || '');
			if (prog && id) this.open_candidate(prog, id);
		});
	}

	// ── server-paged table (no row cap) ────────────────────────────────────
	// Sorting, search and paging all run in SQL on the server; the browser
	// only ever holds one page. "Export CSV" downloads EVERY matching row
	// (streamed by the server through the same permission-scoped query).
	server_table($el, kind, extra = {}, opts = {}) {
		const f = Object.assign({}, this.filters, extra);
		const base = this.args(f, { kind });
		if (extra.stage) base.stage = extra.stage;
		if (extra.status !== undefined) base.status = extra.status;
		if (extra.card) base.card = extra.card;
		if (extra.step_group) base.step_group = extra.step_group;
		['pipe', 'days_min', 'days_max'].forEach(k => { if (extra[k] !== undefined && extra[k] !== '') base[k] = extra[k]; });
		// One Analytics value (source / gender / age group …) — the server filters on the same expression it grouped by.
		if (extra.dim) { base.dim = extra.dim; base.dim_value = extra.dim_value === undefined ? '' : extra.dim_value; }
		if (extra.own_dates) {
			base.own_dates = 1;
			base.from_date = null;
			base.to_date = null;
			if (extra.date_from) base.date_from = extra.date_from;
			if (extra.date_to) base.date_to = extra.date_to;
		}
		const cols = opts.columns;
		const st = { page: 1, page_size: opts.page_size || 100, sort_by: opts.sort_by || null,
			sort_dir: opts.sort_dir || null, search: opts.search || '' };
		const seq = { n: 0 };
		$el.html(`
			<div class="pod-st-bar">
				<label class="pod-sbox">
					<span class="pod-sbox-ic" aria-hidden="true">
						<svg class="pod-sbox-glass" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
						<span class="pod-sbox-spin"></span>
					</span>
					<input type="text" class="pod-st-search" placeholder="${__('Search name, ID, email, role, location…')}" aria-label="${__('Search all rows')}">
				</label>
				<span class="pod-st-info pod-muted"></span>
				<span class="pod-st-tools">
					<button class="btn btn-default btn-xs pod-st-export">⬇ ${__('Export all (CSV)')}</button>
				</span>
			</div>
			<div class="pod-table-scroll ${opts.compact ? 'pod-short' : ''} ${opts.modal ? 'pod-dd-scroll' : ''} pod-st-body"></div>
			<div class="pod-st-pager">
				<span class="pod-st-size">${__('Rows per page')}
					<select>${[50, 100, 250, 500, 1000].map(n => `<option value="${n}" ${n === st.page_size ? 'selected' : ''}>${n}</option>`).join('')}</select>
				</span>
				<span class="pod-st-nav">
					<button class="btn btn-default btn-xs" data-go="first">«</button>
					<button class="btn btn-default btn-xs" data-go="prev">‹</button>
					<span>${__('Page')} <input type="number" min="1" class="pod-st-page"> <span class="pod-st-of"></span></span>
					<button class="btn btn-default btn-xs" data-go="next">›</button>
					<button class="btn btn-default btn-xs" data-go="last">»</button>
				</span>
			</div>`);
		const $body = $el.find('.pod-st-body');
		$el.find('.pod-st-search').val(st.search);
		let last_page = 1;

		const draw = (m) => {
			const rows = m.rows || [];
			st.page = m.page; st.sort_by = m.sort_by; st.sort_dir = m.sort_dir;
			last_page = Math.max(1, Math.ceil((m.total || 0) / st.page_size));
			const from = m.total ? (st.page - 1) * st.page_size + 1 : 0;
			$el.find('.pod-st-info').text(m.total
				? __('Rows {0}–{1} of {2}', [this.n(from), this.n(from + rows.length - 1), this.n(m.total)])
				: '');
			$el.find('.pod-st-page').val(st.page).attr('max', last_page);
			$el.find('.pod-st-of').text(__('of {0}', [this.n(last_page)]));
			$el.find('[data-go=first],[data-go=prev]').prop('disabled', st.page <= 1);
			$el.find('[data-go=next],[data-go=last]').prop('disabled', st.page >= last_page);
			$el.find('.pod-st-pager').toggle(last_page > 1 || st.page_size !== (opts.page_size || 100));
			$el.find('.pod-st-export').prop('disabled', !m.total);
			if (!rows.length) {
				$body.html(`<div class="pod-empty">${this.esc(st.search ? __('No rows match "{0}".', [st.search]) : (opts.empty || __('Nothing to show.')))}</div>`);
				return;
			}
			const sort_key = st.sort_by === 'status' && cols.some(c => c.key === 'stage') && !cols.some(c => c.key === 'status') ? 'stage' : st.sort_by;
			const up = st.sort_dir === 'asc';
			$body.html(`<table class="pod-table"><thead><tr>${cols.map(c => `
				<th data-key="${c.key}" class="${c.key === sort_key ? 'is-sorted' : ''}">${this.esc(c.label)}
				<span class="pod-sort">${c.key === sort_key ? (up ? '▲' : '▼') : '↕'}</span></th>`).join('')}
				</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c =>
					`<td${c.nw ? ' class="nw"' : ''}${c.render ? '' : ` title="${this.esc(r[c.key])}"`}>${c.render ? c.render(r) : this.esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
			$body.scrollTop(0);
		};

		const fetch = () => {
			const my = ++seq.n;
			$el.addClass('pod-st-loading');
			frappe.call({
				method: POD_API + 'get_drilldown',
				args: Object.assign({}, base, {
					page: st.page, page_size: st.page_size, search: st.search,
					sort_by: st.sort_by, sort_dir: st.sort_dir
				}),
				callback: (r) => { if (my === seq.n) draw(r.message || {}); },
				always: () => { if (my === seq.n) $el.removeClass('pod-st-loading'); }
			});
		};

		$body.on('click', 'th', (e) => {
			let k = String($(e.currentTarget).data('key'));
			if (k === 'stage') k = 'status';
			st.sort_dir = st.sort_by === k && st.sort_dir === 'asc' ? 'desc' : 'asc';
			st.sort_by = k;
			st.page = 1;
			fetch();
		});
		// Search is one text box: run it once typing pauses (or on Enter).
		let timer = null;
		$el.find('.pod-st-search').on('input keydown', (e) => {
			clearTimeout(timer);
			const go = () => { st.search = e.currentTarget.value.trim(); st.page = 1; fetch(); };
			if (e.type === 'keydown') { if (e.key === 'Enter') go(); return; }
			timer = setTimeout(go, 450);
		});
		$el.find('[data-go]').on('click', (e) => {
			const g = $(e.currentTarget).data('go');
			st.page = g === 'first' ? 1 : g === 'prev' ? st.page - 1 : g === 'next' ? st.page + 1 : last_page;
			fetch();
		});
		$el.find('.pod-st-page').on('change', (e) => {
			st.page = Math.min(last_page, Math.max(1, parseInt(e.currentTarget.value, 10) || 1));
			fetch();
		});
		$el.find('.pod-st-size select').on('change', (e) => {
			st.page_size = parseInt(e.currentTarget.value, 10) || 100;
			st.page = 1;
			fetch();
		});
		$el.find('.pod-st-export').on('click', () => {
			const q = Object.assign({}, base, {
				search: st.search, sort_by: st.sort_by || '', sort_dir: st.sort_dir || '',
				title: opts.title || kind
			});
			const qs = Object.keys(q).filter(k => q[k] !== null && q[k] !== undefined)
				.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(q[k])}`).join('&');
			const a = document.createElement('a');
			a.href = `/api/method/${POD_API}export_drilldown_csv?${qs}`;
			a.rel = 'noopener';
			document.body.appendChild(a);
			a.click();
			a.remove();
			frappe.show_alert({ message: __('Preparing CSV of every matching row…'), indicator: 'blue' }, 5);
		});
		this.bind_candidate_links($el);
		fetch();
	}

	// ── drilldown (level 1) ───────────────────────────────────────────────
	drill(kind, title, extra = {}) {
		let cols;
		if (kind === 'registrations') cols = this.reg_columns();
		else if (kind === 'card') cols = this.reg_columns(false, extra.date_label || '');
		else if (kind === 'applications') cols = this.reg_columns(true);
		else if (kind === 'feedback') cols = this.feedback_columns();
		else if (kind === 'status_log') cols = this.log_columns();
		else cols = this.interview_columns().filter(c => kind === 'pending' || !c.pending_only);
		// One card per unit on top (the split that used to sit on the
		// dashboard card): "All units" + each unit with its count and share.
		// Clicking a unit narrows the list below to that unit.
		const units = (extra.units || []).filter(u => u.value !== null && u.value !== undefined);
		const unit_on = extra.unit_on || '';
		const base = Object.assign({}, extra);
		const sort = extra.sort_by ? { sort_by: extra.sort_by, sort_dir: extra.sort_dir } : {};
		if (extra.search) sort.search = extra.search;
		if (extra.show_days) cols = cols.concat([{ key: 'days', label: __('In pipeline'), nw: true,
			render: (r) => r.days === '' ? '' : `<b class="pod-days">${this.esc(__('{0} days', [this.n(r.days)]))}</b>` }]);
		['units', 'unit_on', 'show_days', 'sort_by', 'sort_dir', 'search'].forEach(k => delete base[k]);
		const total = units.reduce((a, u) => a + (u.value || 0), 0);
		const d = new frappe.ui.Dialog({ title: this.esc(title), size: 'extra-large' });
		d.$wrapper.find('.modal-dialog').addClass('modal-dialog-centered pod-modal-wide');
		const ucard = (p, label, v) => `
			<button type="button" class="pod-dd-unit ${p === unit_on ? 'is-on' : ''}" data-p="${this.esc(p)}" ${v ? '' : 'disabled'}>
				<span class="pod-dd-unit-name">${this.esc(label)}</span>
				<span class="pod-dd-unit-v"><b>${this.n(v)}</b>${total ? `<small>${p ? this.pct(v, total) : 100}%</small>` : ''}</span>
			</button>`;
		d.$body.html(`<style>${POD_CSS}</style><div class="pod-root">
			${units.length > 1 ? `<div class="pod-dd-units">${ucard('', __('All units'), total)}${units.map(u => ucard(u.program, u.unit, u.value)).join('')}</div>` : ''}
			<div class="pod-dd"></div></div>`);
		const draw = (prog) => this.server_table(d.$body.find('.pod-dd'), kind,
			Object.assign({}, base, prog ? { programs: [prog] } : {}), Object.assign({ columns: cols, title, modal: true }, sort));
		d.$body.find('.pod-dd-unit').on('click', (e) => {
			const p = String($(e.currentTarget).data('p') || '');
			d.$body.find('.pod-dd-unit').removeClass('is-on');
			$(e.currentTarget).addClass('is-on');
			const u = units.find(x => x.program === p);
			d.set_title(this.esc(u ? `${title} · ${u.unit}` : title));
			draw(p);
		});
		draw(unit_on);
		d.show();
	}

	// ── candidate detail (level 2) ─────────────────────────────────────────
	// The applicant profile popup lives in public/js/applicant_profile.js —
	// one copy shared with the registration lists / forms. This page passes
	// itself as host so stage chips open its card lists and the timeline.
	open_candidate(program, id) {
		if (window.pathways_applicant_profile) {
			window.pathways_applicant_profile.open(program, id, this);
		} else {
			// applicant_profile.js not loaded on this site (app not fully
			// deployed yet) — fall back to this page's own popup.
			this.open_candidate_basic(program, id);
		}
	}

	open_candidate_basic(program, id) {
		frappe.call({
			method: POD_API + 'get_candidate_detail',
			args: { program, name: id },
			freeze: true,
			callback: (r) => {
				const c = r.message;
				if (!c) return;
				const esc = (v) => this.esc(v);
				const d = new frappe.ui.Dialog({ title: esc(`${c.name} · ${c.id}`), size: 'extra-large' });
				d.$wrapper.find('.modal-dialog').addClass('modal-dialog-centered pod-modal-wide');
				d.$body.html(`
					<style>${POD_CSS}</style>
					<div class="pod-root pod-detail">
						<div class="pod-detail-top">
							<div>${this.program_pill(c.program)} ${this.stage_pill(c.stage)} <span class="pod-muted">${esc(c.status)}</span></div>
							<span class="pod-detail-btns">
								<button class="btn btn-default btn-xs pod-to-tl">${__('View timeline')}</button>
								<a class="btn btn-default btn-xs" target="_blank" href="/app/${esc(c.route)}/${encodeURIComponent(c.id)}">${__('Open registration')} ↗</a>
							</span>
						</div>

						<div class="pod-sec">${__('Journey')}</div>
						<div class="pod-journey">
							${this.step(__('Registered'), true)}
							${c.applied === null ? '' : this.step(__('Application form'), c.applied)}
							${this.step(__('Interviewed'), c.interviews.some(i => !i.cancelled))}
							${this.step(__('Feedback'), c.feedback.length > 0)}
							${this.step(c.stage === 'Not selected' ? __('Not selected') : __('Offer / Selected'),
								['Offer / Selected', 'Not selected'].includes(c.stage), c.stage === 'Not selected')}
						</div>

						<div class="pod-sec">${__('Where on the pipeline')}</div>
						<div class="pod-chips">${(c.milestones || []).map(m => {
							const card = Object.values(this.cards_by_key || {}).find(x => x.label === m);
							const col = POD_TONES[(card || {}).tone] || POD_TONES.neutral;
							return `<span class="pod-pill" style="--c:${col}">${esc(__(m))}</span>`;
						}).join(' ') || `<span class="pod-muted">${__('No pipeline milestone yet')}</span>`}</div>

						<div class="pod-sec">${__('Status history')} (${(c.history || []).length})</div>
						${(c.history || []).length ? `<div class="pod-history">${c.history.map(h => `
							<div class="pod-hist-row">
								<span class="pod-hist-dot"></span>
								<div><b>${esc(h.from || __('(none)'))}</b> → <b>${esc(h.to)}</b>
									<div class="pod-muted">${esc(this.fmt_dt(h.on))}${h.by ? ' · ' + esc(h.by) : ''}${h.reason ? ' · ' + esc(h.reason) : ''}</div></div>
							</div>`).join('')}</div>` : `<div class="pod-muted">${__('No status changes logged yet')}</div>`}

						<div class="pod-sec">${__('Profile')}</div>
						<div class="pod-profile">${c.profile.map(p => `
							<div><div class="pod-muted">${esc(p.label)}</div><div class="pod-pv">${esc(p.value)}</div></div>`).join('')
							|| `<div class="pod-muted">${__('Nothing filled in')}</div>`}
						</div>

						<div class="pod-sec">${__('Forms on file')} (${c.forms.length})</div>
						<div class="pod-pdfs">${c.forms.map(f => `
							<a class="pod-pdf" target="_blank" href="/app/${esc(f.route)}/${encodeURIComponent(f.name)}">📄 ${esc(f.doctype)} · ${esc(f.name)}</a>`).join('')
							|| `<span class="pod-muted">${__('None')}</span>`}</div>

						<div class="pod-sec">${__('Interviews')} (${c.interviews.length})</div>
						<div class="pod-ivs">${c.interviews.map(i => `
							<div class="pod-iv ${i.cancelled ? 'is-cancelled' : ''}">
								<div class="pod-iv-round">${esc(i.round || __('Interview'))}</div>
								<div class="pod-muted">${[this.fmt_date(i.date) + (i.start ? ' ' + i.start : ''), i.mode, i.cancelled ? __('Cancelled') : ''].filter(Boolean).map(esc).join(' · ')}</div>
								${i.interviewer ? `<div class="pod-muted">${esc(i.interviewer)}</div>` : ''}
								<a class="pod-muted" target="_blank" href="/app/${esc(i.route)}/${encodeURIComponent(i.name)}">${esc(i.name)} ↗</a>
							</div>`).join('') || `<div class="pod-muted">${__('None')}</div>`}
						</div>

						<div class="pod-sec">${__('Feedback')} (${c.feedback.length})</div>
						${c.feedback.map(f => this.feedback_body_html(f)).join('') || `<div class="pod-muted">${__('No feedback yet')}</div>`}
					</div>`);
				d.$body.find('.pod-to-tl').on('click', () => {
					d.hide();
					this.open_timeline(c.program, c.id);
				});
				d.show();
			}
		});
	}

	// ── Timeline tab ───────────────────────────────────────────────────────
	show_tab(tab) {
		this.tab = tab;
		const $c = this.$root;
		$c.find('.pod-tab').each((_, b) => {
			const on = $(b).data('tab') === tab;
			$(b).toggleClass('is-on', on).attr('aria-selected', on ? 'true' : 'false');
		});
		$c.find('.pod-pane').each((_, p) => { p.hidden = $(p).data('pane') !== tab; });
		if (tab === 'timeline' && this.tl_dirty && this.data) this.render_tl_list();
		if (tab === 'funnel' && this.fun_dirty && this.data) this.render_funnel_tab();
		if (tab === 'analytics' && this.an_dirty && this.data) this.render_analytics();
	}

	// Every applicant in scope (same filters, paged / searched on the
	// server), full width. Clicking a name opens that applicant's timeline
	// in a centred popup.
	//
	// The list's own bar narrows it further without touching the top
	// filters: Sort by, Programme, Stage and Status. Each is a single choice,
	// so it applies at once. Options only offer what the top filters allow,
	// and Status lists the statuses actually present (with counts).
	// Timeline tab cards: the Dashboard's top cards + New Applicant. A click
	// shows that group in the timeline list below (click again = everyone).
	render_tl_cards(tl) {
		const $el = this.$root.find('#pod-tl-cards');
		const regs = this.sum('registrations');
		const n_new = this.stage_total('New');
		const defs = this.top_defs().concat([{ k: 'stage:New', view: 'new', tone: 'neutral', label: __('New Applicant'), v: n_new,
			share: regs ? this.pct(n_new, regs) : null, share_of: __('of total registrations'),
			desc: __('Nobody has screened the CV yet. Click to list them below.') }]);
		$el.html(`<div class="pod-headline is-six">${defs.map((d, i) => this.card_html(d, i, tl.view)).join('')}</div>`);
		this.bind_click($el.find('.pod-kpi.is-click'), (el) => {
			const d = defs[+$(el).data('i')];
			tl.view = d.view === tl.view ? 'all' : d.view;
			tl.status = '';
			this.render_tl_list();
		});
	}

	render_tl_list() {
		this.tl_dirty = false;
		const $tools = this.$root.find('#pod-tl-tools');
		const f = this.filters || {};
		const progs = (this.data.units_in_scope || []).map(u => u.program);
		const stages = (f.stages || []).length ? f.stages : (this.data.stages || []);
		const tl = this.tl_state = Object.assign({ sort: 'created:desc', program: '', stage: '', status: '', pipe: '', days: '', view: 'all' },
			this.tl_state || {});
		this.render_tl_cards(tl);
		if (tl.program && !progs.includes(tl.program)) tl.program = '';
		if (tl.stage && !stages.includes(tl.stage)) tl.stage = '';
		// A blank status is sent as "(blank)" ('' means "all statuses").
		const statuses = () => {
			const n = {};
			(this.data.status_rows || []).forEach(r => {
				if ((tl.program && r.program !== tl.program) || (tl.stage && r.stage !== tl.stage)) return;
				const k = r.raw || '(blank)';
				n[k] = (n[k] || 0) + r.count;
			});
			return Object.entries(n).sort((a, b) => b[1] - a[1]);
		};
		if (tl.status && !statuses().some(([s]) => s === tl.status)) tl.status = '';
		const sorts = [['created:desc', __('Newest applied first')], ['created:asc', __('Oldest applied first')],
			['days:desc', __('Longest in pipeline first')], ['days:asc', __('Shortest in pipeline first')],
			['name:asc', __('Name A → Z')], ['name:desc', __('Name Z → A')], ['status:asc', __('Status A → Z')],
			['program:asc', __('Programme')], ['role:asc', __('Role A → Z')], ['location:asc', __('Location A → Z')]];
		const opt = (v, l, sel) => `<option value="${this.esc(v)}" ${v === sel ? 'selected' : ''}>${this.esc(l)}</option>`;
		const active = ['program', 'stage', 'status', 'pipe', 'days'].filter(k => tl[k]).length + (tl.view !== 'all' ? 1 : 0);
		$tools.html(`
			<label class="pod-tl-tool"><span>${__('Sort by')}</span>
				<select data-k="sort">${sorts.map(([v, l]) => opt(v, l, tl.sort)).join('')}</select></label>
			<label class="pod-tl-tool"><span>${__('Programme')}</span>
				<select data-k="program">${opt('', __('All programmes'), tl.program)}${progs.map(p => opt(p, this.unit_of(p) === p ? __(p) : `${__(p)} (${this.unit_of(p)})`, tl.program)).join('')}</select></label>
			<label class="pod-tl-tool"><span>${__('Stage')}</span>
				<select data-k="stage">${opt('', __('All stages'), tl.stage)}${stages.map(s => opt(s, __(s), tl.stage)).join('')}</select></label>
			<label class="pod-tl-tool pod-tl-tool-wide"><span>${__('Status')}</span>
				<select data-k="status">${opt('', __('All statuses'), tl.status)}${statuses().map(([s, n]) =>
					opt(s, `${s} · ${this.n(n)}`, tl.status)).join('')}</select></label>
			<label class="pod-tl-tool"><span>${__('Pipeline')}</span>
				<select data-k="pipe">${opt('', __('Everyone'), tl.pipe)}${opt('open', __('Still in pipeline'), tl.pipe)}${opt('ended', __('Ended (joined / not selected)'), tl.pipe)}</select></label>
			<label class="pod-tl-tool"><span>${__('Days in pipeline')}</span>
				<select data-k="days">${opt('', __('Any'), tl.days)}${POD_DAY_RANGES.map(([v, l]) => opt(v, l, tl.days)).join('')}</select></label>
			${active ? `<button type="button" class="btn btn-default btn-xs pod-tl-clear">${__('Clear {0} filter(s)', [active])}</button>` : ''}`);
		$tools.find('select').on('change', (e) => {
			const k = String($(e.currentTarget).data('k'));
			tl[k] = e.currentTarget.value;
			// a different programme / stage has its own statuses
			if (k === 'program' || k === 'stage') tl.status = '';
			this.render_tl_list();
		});
		$tools.find('.pod-tl-clear').on('click', () => {
			Object.assign(tl, { program: '', stage: '', status: '', pipe: '', days: '', view: 'all' });
			this.render_tl_list();
		});

		const extra = {};
		// The card picked above the table (Timeline cards).
		let kind = 'registrations';
		const vw = POD_TL_VIEWS[tl.view];
		if (vw && vw.stages) {
			const page = (this.filters || {}).stages || [];
			extra.stages = page.length ? vw.stages.filter(x => page.includes(x)) : vw.stages;
			// Nothing left after the page's Stage filter → ask for a stage outside it (= no rows).
			if (!extra.stages.length) { extra.stages = page; extra.stage = vw.stages[0]; }
		}
		if (vw && vw.card) { kind = 'card'; extra.card = vw.card; }
		if (tl.program) extra.programs = [tl.program];
		if (tl.stage) extra.stage = tl.stage;
		if (tl.status !== '') extra.status = tl.status;
		if (tl.pipe) extra.pipe = tl.pipe;
		if (tl.days) {
			const [a, b] = tl.days.split('-');
			extra.days_min = a;
			if (b) extra.days_max = b;
		}
		const [sort_by, sort_dir] = tl.sort.split(':');
		// keep the search text across re-draws
		const search = this.$root.find('#pod-tl-list .pod-st-search').val() || '';
		const $el = this.$root.find('#pod-tl-list');
		const cols = [
			this.id_col(),
			{ key: 'name', label: __('Applicant'), render: (r) => this.cand_link(r) },
			{ key: 'program', label: __('Programme'), render: (r) => this.program_pill(r.program), csv: (r) => r.program },
			{ key: 'role', label: __('Role') },
			{ key: 'location', label: __('Location') },
			{ key: 'status', label: __('Status') },
			{ key: 'stage', label: __('Stage'), render: (r) => this.stage_pill(r.stage) },
			{ key: 'created', label: __('Applied on'), nw: true, render: (r) => this.esc(this.fmt_date(r.created)) },
			{ key: 'days', label: __('In pipeline'), nw: true,
				render: (r) => r.days === '' ? '' : `<b class="pod-days ${+r.days > 30 && r.stage !== 'Not selected' ? 'is-long' : ''}">${this.esc(__('{0} days', [this.n(r.days)]))}</b>` }
		];
		this.server_table($el, kind, extra, { columns: cols, title: 'applicants', page_size: 50,
			sort_by, sort_dir, search, empty: __('No applicants match these filters.') });
		$el.find('.pod-st-search').val(search);
		// Here a name opens the timeline, not the detail popup (the page-wide
		// handler on the root would open that, so stop the click here).
		$el.off('click.podcand').on('click.podcand', '.pod-cand', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.open_timeline(String($(e.currentTarget).data('prog') || ''), String($(e.currentTarget).data('id') || ''));
		});
	}

	// "Days in pipeline" + "Offer update" charts on the Hiring Funnel tab, for
	// the page filters (same permission-scoped server queries):
	//   • 4 headline numbers (avg days, still in pipeline, waiting > 30 days, ended);
	//   • "Days in pipeline" — stacked columns per age bucket: still in the
	//     pipeline (dark blue) vs ended (light blue), legend on top, totals on
	//     the columns, hover for the split;
	//   • "Average days by current stage" — one bar per stage, in the stage
	//     colours, with the number of people beside it.
	// Every number / bar / segment opens its list in a popup.
	render_tl_charts(extra) {
		const $c = this.$root.find('#pod-tl-charts');
		const tl = null;
		const args = this.args(Object.assign({}, this.filters, extra.programs ? { programs: extra.programs } : {}));
		['stage', 'status', 'pipe', 'days_min', 'days_max'].forEach(k => { if (extra[k] !== undefined && extra[k] !== '') args[k] = extra[k]; });
		const my = this.tl_chart_seq = (this.tl_chart_seq || 0) + 1;
		$c.addClass('pod-st-loading');
		frappe.call({
			method: POD_API + 'get_pipeline_stats',
			args,
			callback: (r) => { if (my === this.tl_chart_seq && r.message) this.draw_tl_charts($c, r.message); },
			always: () => { if (my === this.tl_chart_seq) $c.removeClass('pod-st-loading'); }
		});
		// Offer update charts below, same filters.
		const $o = this.$root.find('#pod-tl-offers').addClass('pod-st-loading');
		frappe.call({
			method: POD_API + 'get_offer_stats',
			args,
			callback: (r) => { if (my === this.tl_chart_seq && r.message) this.draw_offer_charts($o, r.message, tl); },
			always: () => { if (my === this.tl_chart_seq) $o.removeClass('pod-st-loading'); }
		});
	}

	// ── Offer update (below the pipeline charts) ───────────────────────────
	// Everyone who has been made an offer, within the same filters: offers
	// per unit, where each offer stands, gender, median days from application
	// to offer, how they heard about the opening and the posting state.
	// Clicking a unit's bars filters the list to that programme.
	draw_offer_charts($o, s, tl) {
		const esc = (v) => this.esc(v);
		const units = (s.units || []).filter(u => u.offers);
		const set = (patch) => {
			const u = units.find(x => x.program === patch.program);
			this.drill('card', `${__('Offers')} · ${u ? u.unit : patch.program}`, { card: 'reach_offer', programs: [patch.program] });
		};
		const box = (title, sub, body, legend = '', tip = '') => `
			<div class="pod-tl-chart">
				<div class="pod-tl-chart-head">
					<div><div class="pod-tl-chart-title">${esc(title)} ${this.info_html(tip)}</div>
						<div class="pod-panel-sub">${esc(sub)}</div></div>
					${legend}
				</div>${body}</div>`;
		const legend = (series) => `<div class="pod-legend">${series.map(x =>
			`<span><i style="background:${x.color}"></i>${esc(x.label)}</span>`).join('')}</div>`;
		const empty = `<div class="pod-empty">${__('No offers for these filters.')}</div>`;
		const cats = units.map(u => ({ key: u.program, label: u.unit }));

		// 1. number of offers per unit (one series → no legend)
		const c1 = units.length ? this.svg_bars(cats, [{ key: 'offers', label: __('Offers'), color: 'var(--pipe-open)' }],
			units.map(u => ({ offers: u.offers }))) : empty;

		// 2. where each offer stands (validated order: green · amber · blue · red)
		const OC = { joined: POD_TONES.good, awaiting: POD_TONES.time, accepted: '#256ABF', declined: POD_TONES.bad };
		const s2 = (s.groups || []).map(g => ({ key: g.key, label: __(g.label), color: OC[g.key] }));
		const c2 = units.length ? this.svg_bars(cats, s2, units) : empty;

		// 3. gender (violet · aqua · yellow); a unit whose form has no gender field is marked
		const s3 = [{ key: 'Female', label: __('Female'), color: '#6250D6' }, { key: 'Male', label: __('Male'), color: '#1BAF7A' },
			{ key: 'Other', label: __('Other'), color: '#EDA100' }];
		const gunits = units.filter(u => u.has_gender);
		const not_given = gunits.reduce((a, u) => a + ((u.gender || {})['Not given'] || 0), 0);
		const c3 = gunits.length ? this.svg_bars(gunits.map(u => ({ key: u.program, label: u.unit })), s3, gunits.map(u => u.gender || {}))
			+ `<div class="pod-tl-note pod-muted">${[not_given ? __('{0} offers have no gender filled in', [this.n(not_given)]) : '',
				units.some(u => !u.has_gender) ? __('Not captured on the form: {0}', [units.filter(u => !u.has_gender).map(u => u.unit).join(', ')]) : '']
				.filter(Boolean).map(esc).join(' · ')}</div>` : empty;

		// 4. median days from application to offer (dot per unit)
		const munits = units.filter(u => u.median_days !== null);
		const estimated = munits.some(u => (u.median_from_history || 0) < (u.median_n || 0));
		const c4 = munits.length ? this.svg_dots(munits.map(u => ({ key: u.program, label: u.unit })), munits.map(u => u.median_days))
			+ (estimated ? `<div class="pod-tl-note pod-muted">${esc(__('Where no status change to an offer is recorded yet, the day the record was last updated is used — so these are estimates until changes are logged.'))}</div>` : '')
			: empty;

		// 5. how they heard about the opening (donut, top 4 + Other)
		const SC = ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100'];
		const src = (s.sources || []).map((x, i) => Object.assign({}, x, { color: x.label === 'Other' ? '#8A96A3' : SC[i] }));
		const c5 = src.length ? this.svg_donut(src) : empty;

		// 6. posting location by state (map of India, drawn once the shapes load)
		const c6 = s.total ? `<div class="pod-india"><div class="pod-empty">${__('Loading map…')}</div></div>` : empty;

		$o.html(`
			<div class="pod-offers-head">
				<div class="pod-tl-chart-title">${__('Offer update')}</div>
				<div class="pod-panel-sub">${esc(__('{0} applicants have been made an offer, within the filters above · click a unit\'s bars to list its offers', [this.n(s.total)]))}</div>
			</div>
			<div class="pod-grid-3">
				${box(__('Number of offers'), __('Per unit'), c1, '', __('Applicants whose status is at offer or beyond: offer made, accepted, declined, onboarding, joined.'))}
				${box(__('Offer status'), __('Where each offer stands now'), c2, legend(s2), __('Joined = joined or ERP ID stage. Awaiting reply = offer sent. Accepted = accepted / addendum / pre-joining / IT email. Declined / did not join = offer declined or not joined.'))}
				${box(__('Gender'), __('Of the applicants made an offer'), c3, legend(s3))}
				${box(__('Median days to offer'), __('From application date to offer, per unit'), c4, '', __('Half the offers took fewer days than this, half took more. The offer day is when the Application Status first changed to an offer status.'))}
				${box(__('Source of information'), __('How they heard about the opening'), c5)}
				${box(__('Posting location — state'), __('Offers per state · darker = more offers · hover a state'), c6, '', __('The state comes from the Location on the registration (e.g. "Itki, Ranchi, Jharkhand, India" → Jharkhand). Map boundaries: DataMeet, following the Survey of India.'))}
			</div>`);

		// interactions: hover tooltips + click a unit to filter the list
		const $tip = this.$root.find('#pod-tip');
		const tipon = (e, html) => $tip.html(html).css({ display: 'block', left: e.clientX + 14, top: e.clientY + 14 });
		$o.find('[data-tip-html]').on('mousemove', (e) => tipon(e, $(e.currentTarget).attr('data-tip-html')))
			.on('mouseleave', () => $tip.hide());
		$o.find('[data-cat]').on('click', (e) => { $tip.hide(); set({ program: String($(e.currentTarget).data('cat')) }); });
		if (s.total) this.india_map($o.find('.pod-india'), s.states || [], tipon, $tip);
	}

	// Map of India by state (official Survey of India boundaries, via
	// DataMeet), shaded on one blue ramp by number of offers, count on each
	// state that has any. Non-state buckets (not given / all states / other)
	// are listed underneath.
	india_map($el, states, tipon, $tip, noun = __('offers')) {
		const esc = (v) => this.esc(v);
		const key = (v) => String(v || '').toLowerCase().replace(/&/g, 'and').replace(/\s+islands?$/, '').replace(/\s+/g, ' ').trim();
		if (!POD_INDIA_MAP) {
			POD_INDIA_MAP = fetch(POD_INDIA_URL, { credentials: 'same-origin' })
				.then(r => (r.ok ? r.json() : Promise.reject(r.status)))
				.catch((e) => { POD_INDIA_MAP = null; throw e; });
		}
		POD_INDIA_MAP.then((geo) => {
			if (!$el.closest('body').length) return;            // redrawn meanwhile
			const n = {};
			states.forEach(x => { n[key(x.state)] = x.n; });
			const shapes = geo.states || [];
			const max = Math.max(1, ...shapes.map(sh => n[key(sh.name)] || 0));
			const ramp = ['#CDE2FB', '#9EC5F4', '#6DA7EC', '#3987E5', '#1C5CAB'];
			const step = (v) => (v ? Math.min(4, Math.floor((v / max) * 5 - 1e-9)) : -1);
			const paths = shapes.map(sh => {
				const v = n[key(sh.name)] || 0;
				const st = step(v);
				return `<path d="${sh.d}" fill="${st < 0 ? 'var(--border)' : ramp[st]}" class="pod-state"
					data-tip-html="${esc(`<b>${esc(sh.name)}</b>: ${esc(this.n(v))} ${esc(noun)}`)}"></path>`;
			}).join('');
			const labels = shapes.filter(sh => n[key(sh.name)]).map(sh => {
				const v = n[key(sh.name)];
				return `<text x="${sh.cx}" y="${sh.cy + 4}" text-anchor="middle" class="pod-state-n ${step(v) >= 3 ? 'is-dark' : ''}">${esc(this.n(v))}</text>`;
			}).join('');
			const known = new Set(shapes.map(sh => key(sh.name)));
			const extra = states.filter(x => !known.has(key(x.state)));
			$el.html(`<svg viewBox="0 0 ${geo.w} ${geo.h}" class="pod-india-svg" role="img" aria-label="${esc(__('{0} by state, map of India', [noun]))}">${paths}${labels}</svg>
				<div class="pod-tile-legend"><span class="pod-muted">${__('Fewer')}</span>${ramp.map(c => `<i style="background:${c}"></i>`).join('')}<span class="pod-muted">${__('More')}</span></div>
				${extra.length ? `<div class="pod-tl-note pod-muted">${extra.map(x => `${esc(__(x.state))}: ${esc(this.n(x.n))}`).join(' · ')}</div>` : ''}
				<div class="pod-map-credit">${__('Map')}: <a href="https://github.com/datameet/maps" target="_blank" rel="noopener">DataMeet India community</a>
					(<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>), ${__('Survey of India boundaries')}</div>`);
			$el.find('[data-tip-html]').on('mousemove', (e) => tipon(e, $(e.currentTarget).attr('data-tip-html')))
				.on('mouseleave', () => $tip.hide());
		}).catch(() => {
			$el.html(`<div class="pod-empty">${__('Could not load the map.')}</div>`);
		});
	}

	// Grouped columns: one group per category, one bar per series, 2px gap
	// between bars, value on top, rounded data end. Hover a group for all its
	// values; the group carries data-cat for click-to-filter.
	svg_bars(cats, series, rows) {
		const esc = (v) => this.esc(v);
		const W = 420, H = 230, L = 34, R = 6, T = 18, B = 42;
		const ph = H - T - B;
		const max = Math.max(1, ...rows.flatMap(r => series.map(x => +r[x.key] || 0)));
		const nice = (v) => { const m = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1)))); const f = v / m;
			return (f <= 1 ? 1 : f <= 1.25 ? 1.25 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * m; };
		const top = nice(max);
		const band = (W - L - R) / Math.max(1, cats.length);
		const inner = Math.min(band * 0.78, series.length * 34);
		const bw = Math.max(3, inner / series.length - 2);
		const y = (v) => T + ph * (1 - v / top);
		const bar = (x, v, color) => {
			const yy = y(v), h = T + ph - yy;
			if (h <= 0) return '';
			const r = Math.min(3, bw / 2, h);
			return `<path d="M${x},${T + ph} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${T + ph} Z" fill="${color}"></path>`;
		};
		const wrap = (label, cx) => {
			const words = String(label).split(' ');
			const lines = [''];
			words.forEach(w => { if ((lines[lines.length - 1] + ' ' + w).trim().length > 13 && lines[lines.length - 1]) lines.push(w); else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + w).trim(); });
			return `<text x="${cx}" y="${T + ph + 14}" text-anchor="middle" class="pod-axis">${lines.slice(0, 2).map((l, i) =>
				`<tspan x="${cx}" dy="${i ? 12 : 0}">${esc(l)}</tspan>`).join('')}</text>`;
		};
		const groups = cats.map((c, i) => {
			const x0 = L + i * band + (band - inner) / 2;
			const r = rows[i] || {};
			const tip = `<b>${esc(c.label)}</b>` + series.map(x => `<br><span class="pod-legend-dot" style="background:${x.color}"></span>${esc(x.label)}: <b>${esc(this.n(+r[x.key] || 0))}</b>`).join('');
			return `<g class="pod-tbar" data-cat="${esc(c.key)}" data-tip-html="${esc(tip)}">
				<rect x="${L + i * band}" y="${T}" width="${band}" height="${ph + 30}" fill="transparent"></rect>
				${series.map((x, j) => {
					const v = +r[x.key] || 0;
					const bx = x0 + j * (bw + 2);
					return bar(bx, v, x.color) + (v ? `<text x="${bx + bw / 2}" y="${y(v) - 4}" text-anchor="middle" class="pod-axis pod-axis-v">${esc(this.n(v))}</text>` : '');
				}).join('')}
				${wrap(c.label, L + i * band + band / 2)}
			</g>`;
		}).join('');
		return `<svg viewBox="0 0 ${W} ${H}" class="pod-svg" role="img">
			${[0, top / 2, top].map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="pod-grid"></line>
				<text x="${L - 5}" y="${y(t) + 4}" text-anchor="end" class="pod-axis">${esc(this.n(Math.round(t)))}</text>`).join('')}
			${groups}</svg>`;
	}

	// One dot per category on a shared scale (a dot, not a line: units are
	// separate categories, not a sequence), value beside each dot.
	svg_dots(cats, vals) {
		const esc = (v) => this.esc(v);
		const W = 420, H = 230, L = 34, R = 6, T = 18, B = 42;
		const ph = H - T - B;
		const max = Math.max(1, ...vals);
		const top = Math.ceil(max / 10) * 10 || 10;
		const band = (W - L - R) / Math.max(1, cats.length);
		const y = (v) => T + ph * (1 - v / top);
		return `<svg viewBox="0 0 ${W} ${H}" class="pod-svg" role="img">
			${[0, top / 2, top].map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="pod-grid"></line>
				<text x="${L - 5}" y="${y(t) + 4}" text-anchor="end" class="pod-axis">${esc(this.n(Math.round(t)))}</text>`).join('')}
			${cats.map((c, i) => {
				const cx = L + i * band + band / 2, v = vals[i];
				const tip = `<b>${esc(c.label)}</b><br>${esc(__('Median: {0} days', [this.n(v)]))}`;
				return `<g class="pod-tbar" data-cat="${esc(c.key)}" data-tip-html="${esc(tip)}">
					<rect x="${L + i * band}" y="${T}" width="${band}" height="${ph + 30}" fill="transparent"></rect>
					<line x1="${cx}" x2="${cx}" y1="${T + ph}" y2="${y(v)}" stroke="var(--pipe-ended)" stroke-width="2"></line>
					<circle cx="${cx}" cy="${y(v)}" r="5" fill="var(--pipe-open)" stroke="var(--bg)" stroke-width="2"></circle>
					<text x="${cx}" y="${y(v) - 10}" text-anchor="middle" class="pod-axis pod-axis-v">${esc(this.n(v))}</text>
					<text x="${cx}" y="${T + ph + 14}" text-anchor="middle" class="pod-axis">${String(c.label).split(' ').reduce((acc, w) => {
						const last = acc[acc.length - 1];
						if (last && (last + ' ' + w).length <= 13) acc[acc.length - 1] = last + ' ' + w; else acc.push(w);
						return acc; }, []).slice(0, 2).map((l, k) => `<tspan x="${cx}" dy="${k ? 12 : 0}">${esc(l)}</tspan>`).join('')}</text>
				</g>`;
			}).join('')}</svg>`;
	}

	// Donut (≤ 5 slices: top 4 + Other) with a legend that carries the
	// numbers, so nothing is read from angle alone; 2px surface gap between slices.
	svg_donut(items) {
		const esc = (v) => this.esc(v);
		const total = items.reduce((a, x) => a + x.n, 0) || 1;
		const R = 80, r = 48, C = 90;
		let a0 = -Math.PI / 2;
		const pt = (rad, ang) => `${C + rad * Math.cos(ang)},${C + rad * Math.sin(ang)}`;
		const arcs = items.map(x => {
			const a1 = a0 + (x.n / total) * Math.PI * 2;
			const large = a1 - a0 > Math.PI ? 1 : 0;
			const d = items.length === 1
				? `M${C},${C - R} A${R},${R} 0 1 1 ${C - 0.01},${C - R} L${C - 0.01},${C - r} A${r},${r} 0 1 0 ${C},${C - r} Z`
				: `M${pt(R, a0)} A${R},${R} 0 ${large} 1 ${pt(R, a1)} L${pt(r, a1)} A${r},${r} 0 ${large} 0 ${pt(r, a0)} Z`;
			const tip = `<b>${esc(x.label)}</b>: ${esc(this.n(x.n))} (${this.pct(x.n, total)}%)` +
				(x.parts ? x.parts.map(p => `<br><span class="pod-muted">${esc(p.label)}: ${esc(this.n(p.n))}</span>`).join('') : '');
			a0 = a1;
			return `<path d="${d}" fill="${x.color}" stroke="var(--bg)" stroke-width="2" class="pod-slice" data-tip-html="${esc(tip)}"></path>`;
		}).join('');
		return `<div class="pod-donut">
			<svg viewBox="0 0 180 180" class="pod-donut-svg" role="img">${arcs}
				<text x="${C}" y="${C - 2}" text-anchor="middle" class="pod-donut-total">${esc(this.n(total))}</text>
				<text x="${C}" y="${C + 14}" text-anchor="middle" class="pod-axis">${__('offers')}</text></svg>
			<div class="pod-donut-legend">${items.map(x => `
				<div data-tip-html="${esc(`<b>${esc(x.label)}</b>` + (x.parts ? x.parts.map(p => `<br>${esc(p.label)}: ${esc(this.n(p.n))}`).join('') : ''))}">
					<i style="background:${x.color}"></i><span class="lbl">${esc(x.label)}</span>
					<b>${esc(this.n(x.n))}</b><span class="pod-muted">${this.pct(x.n, total)}%</span></div>`).join('')}</div>
		</div>`;
	}

	draw_tl_charts($c, s) {
		const esc = (v) => this.esc(v);
		// patch = { pipe, days: 'min-max', stage } → that list, longest in pipeline first
		const set = (patch, label) => {
			const ex = { show_days: 1, sort_by: 'days', sort_dir: 'desc' };
			if (patch.pipe) ex.pipe = patch.pipe;
			if (patch.stage) ex.stage = patch.stage;
			if (patch.days) {
				const [a, b] = String(patch.days).split('-');
				ex.days_min = a;
				if (b) ex.days_max = b;
			}
			this.drill('registrations', label, ex);
		};
		const kpi = (label, value, sub, tone, patch, tip) => `
			<div class="pod-tl-kpi ${patch ? 'is-click' : ''}" style="--c:${POD_TONES[tone]}" ${patch ? `role="button" tabindex="0" data-patch="${esc(JSON.stringify(patch))}"` : ''}>
				<div class="pod-tl-kpi-top"><span>${esc(label)}</span>${this.info_html(tip)}</div>
				<b>${value}</b><small>${esc(sub || '')}</small>
			</div>`;
		const pct = (a) => s.total ? `${this.pct(a, s.total)}%` : '';
		const kpis = [
			kpi(__('Average days in pipeline'), s.avg_days === null ? '—' : esc(__('{0} days', [this.n(s.avg_days)])),
				s.avg_open_days === null ? '' : __('{0} days for those still in it', [this.n(s.avg_open_days)]), 'info', null,
				__('From the application date to today, or — for applicants who joined or were not selected — to the day their record was last updated.')),
			kpi(__('Still in pipeline'), esc(this.n(s.open)), __('{0} of these applicants', [pct(s.open)]), 'info', { pipe: 'open', days: '' },
				__('Not joined yet and not rejected: still somewhere between registration and joining. Click to list them.')),
			kpi(__('Waiting over 30 days'), esc(this.n(s.open_over30)), __('still in pipeline, 30+ days'), s.open_over30 ? 'action' : 'neutral',
				s.open_over30 ? { pipe: 'open', days: '31-' } : null,
				__('Still in the pipeline and applied more than 30 days ago — the ones to follow up first. Click to list them, longest first.')),
			kpi(__('Ended'), esc(this.n(s.ended)), __('{0} joined or not selected', [pct(s.ended)]), 'neutral', { pipe: 'ended', days: '' },
				__('Journey is over: joined (or ERP ID stage) or not selected (reject / regret / no-show / declined / duplicate / blocklisted).'))
		];

		// ── chart 1: days in pipeline, stacked (open | ended) per bucket ──
		const bk = s.buckets || [];
		const W = 600, H = 240, L = 46, R = 8, T = 22, B = 30;
		// round the axis top up to 1 / 2 / 2.5 / 5 / 10 × a power of ten (10.8K → 12.5K, not 20K)
		const nice = (v) => {
			const m = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))));
			const f = v / m;
			return (f <= 1 ? 1 : f <= 1.25 ? 1.25 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * m;
		};
		const top = nice(Math.max(1, ...bk.map(b => b.open + b.ended)));
		const ph = H - B - T;
		const band = (W - L - R) / Math.max(1, bk.length);
		const bw = Math.min(64, band * 0.62);
		const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
		// a segment with only its top corners rounded (data end), square at the base
		const seg = (x, y, w, h, round) => {
			if (h <= 0) return '';
			const r = round ? Math.min(4, w / 2, h) : 0;
			return `M${x},${y + h} V${y + r} ${r ? `Q${x},${y} ${x + r},${y}` : ''} H${x + w - r} ${r ? `Q${x + w},${y} ${x + w},${y + r}` : ''} V${y + h} Z`;
		};
		const ticks = [0, top / 2, top];
		const cols = bk.map((b, i) => {
			const x = L + i * band + (band - bw) / 2;
			const ho = (b.open / top) * ph, he = (b.ended / top) * ph;
			const gap = ho > 0 && he > 0 ? 2 : 0;
			const yo = H - B - ho, ye = yo - gap - he;
			const total = b.open + b.ended;
			const range = `${b.min}-${b.max === null ? '' : b.max}`;
			return `<g class="pod-tbar" data-i="${i}" data-range="${range}">
				<rect x="${L + i * band}" y="${T}" width="${band}" height="${ph}" fill="transparent"></rect>
				<path data-pipe="open" d="${seg(x, yo, bw, ho, he <= 0)}" fill="var(--pipe-open)"></path>
				<path data-pipe="ended" d="${seg(x, ye, bw, he, true)}" fill="var(--pipe-ended)"></path>
				${total ? `<text x="${x + bw / 2}" y="${Math.min(yo, ye) - 6}" text-anchor="middle" class="pod-axis pod-axis-v">${esc(compact.format(total))}</text>` : ''}
				<text x="${L + i * band + band / 2}" y="${H - B + 16}" text-anchor="middle" class="pod-axis">${esc(__(b.label))}</text>
			</g>`;
		}).join('');
		const chart1 = `<svg viewBox="0 0 ${W} ${H}" class="pod-svg" role="img" aria-label="${esc(__('Applicants by days in pipeline'))}">
			${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${T + ph * (1 - t / top)}" y2="${T + ph * (1 - t / top)}" class="pod-grid"></line>
				<text x="${L - 6}" y="${T + ph * (1 - t / top) + 4}" text-anchor="end" class="pod-axis">${esc(compact.format(t))}</text>`).join('')}
			${cols}</svg>`;

		// ── chart 2: average days by current stage ──
		const st = (s.stages || []).filter(x => x.count);
		const maxavg = Math.max(1, ...st.map(x => x.avg || 0));
		const chart2 = st.length ? st.map(x => `
			<div class="pod-bar-row is-click" data-stage="${esc(x.stage)}" role="button" tabindex="0">
				<div class="pod-bar-label"><span class="pod-dot" style="--c:${POD_STAGE_COLORS[x.stage]}"></span>${esc(__(x.stage))}</div>
				<div class="pod-bar-track"><div class="pod-bar" style="width:${Math.max(1.5, (x.avg / maxavg) * 100)}%;--c:${POD_STAGE_COLORS[x.stage]}"></div></div>
				<div class="pod-bar-val"><b>${esc(__('{0} days', [this.n(x.avg)]))}</b> <span class="pod-muted">${esc(__('avg · {0} people', [this.n(x.count)]))}</span></div>
			</div>`).join('') : `<div class="pod-empty">${__('Nobody matches these filters.')}</div>`;

		$c.html(`
			<div class="pod-tl-kpis">${kpis.join('')}</div>
			<div class="pod-grid-2">
				<div class="pod-tl-chart">
					<div class="pod-tl-chart-head">
						<div><div class="pod-tl-chart-title">${__('Days in pipeline')}</div>
							<div class="pod-panel-sub">${__('How long applicants have been in the process · click a column (or one colour of it) to list them')}</div></div>
						<div class="pod-legend">
							<span><i style="background:var(--pipe-open)"></i>${__('Still in pipeline')}</span>
							<span><i style="background:var(--pipe-ended)"></i>${__('Ended')}</span>
						</div>
					</div>
					${s.total ? chart1 : `<div class="pod-empty">${__('Nobody matches these filters.')}</div>`}
				</div>
				<div class="pod-tl-chart">
					<div class="pod-tl-chart-head"><div>
						<div class="pod-tl-chart-title">${__('Average days by current stage')}</div>
						<div class="pod-panel-sub">${__('Where the time goes · click a stage to list its applicants')}</div></div>
					</div>
					<div class="pod-tl-stagebars">${chart2}</div>
				</div>
			</div>`);

		// interactions
		this.bind_click($c.find('.pod-tl-kpi.is-click'), (el) =>
			set(JSON.parse($(el).attr('data-patch')), $(el).find('.pod-tl-kpi-top span').first().text()));
		this.bind_click($c.find('.pod-tl-stagebars .pod-bar-row'), (el) =>
			set({ stage: String($(el).data('stage')) }, __('{0} · days in pipeline', [__(String($(el).data('stage')))])));
		const $tip = this.$root.find('#pod-tip');
		$c.find('.pod-tbar').on('mousemove', (e) => {
			const b = bk[$(e.currentTarget).data('i')];
			const tot = b.open + b.ended;
			$tip.html(`<b>${esc(__(b.label))}</b> · ${esc(this.n(tot))} ${__('applicants')}<br>
				<span class="pod-legend-dot" style="background:var(--pipe-open)"></span>${__('Still in pipeline')}: <b>${esc(this.n(b.open))}</b><br>
				<span class="pod-legend-dot" style="background:var(--pipe-ended)"></span>${__('Ended')}: <b>${esc(this.n(b.ended))}</b>`)
				.css({ display: 'block', left: e.clientX + 14, top: e.clientY + 14 });
		}).on('mouseleave', () => $tip.hide()).on('click', (e) => {
			$tip.hide();
			const $g = $(e.currentTarget);
			const p = $(e.target).closest('path[data-pipe]').data('pipe');
			const b = bk[$g.data('i')];
			set({ days: String($g.data('range')), pipe: p ? String(p) : '' },
				`${__(b.label)} ${__('in pipeline')}${p ? ' · ' + (p === 'open' ? __('Still in pipeline') : __('Ended')) : ''}`);
		});
	}

	// ── Analytics tab ──────────────────────────────────────────────────────
	// The next level after the counts: the same filtered, permission-scoped
	// registrations sliced by unit, job description, source, referrer,
	// gender, education, age and home state; time per step and who it waits
	// on; feedback turnaround; interviewer outcomes; recorded reasons; and
	// how complete the underlying data is. One server call (cached 10 min,
	// Refresh bypasses it), made only while this tab is open. Every number
	// with a list behind it opens that list (same drilldown as everywhere).
	// Second batch of the management review (server: analytics_extra.py) — loads after the main charts.
	load_analytics_extra($a) {
		const my = this.an_x_seq = (this.an_x_seq || 0) + 1;
		frappe.call({
			method: 'ms_calendar.ms_calendar.page.pathways_overall_dashboard.analytics_extra.get_analytics_extra',
			args: this.args(this.filters || this.current_filters(), { refresh: this.an_x_refresh ? 1 : 0 }),
			callback: (r) => { if (my === this.an_x_seq && r.message) this.draw_analytics_extra($a, r.message); },
			error: () => $a.find('#pod-an-x-div, #pod-an-x-dist, #pod-an-x-com').html(`<div class="pod-empty">${__('Could not load this section.')}</div>`)
		});
		this.an_x_refresh = false;
	}

	draw_analytics_extra($a, x) {
		const esc = (v) => this.esc(v);
		const n = (v) => this.n(v);
		const pc = (a, b) => (b ? `${this.pct(a, b)}%` : '<span class="pod-muted">—</span>');
		const empty = (t) => `<div class="pod-empty">${esc(t)}</div>`;

		// diversity by unit
		const dv = x.diversity || [];
		$a.find('#pod-an-x-div').html(!dv.length ? empty(__('No units in scope.')) : `<div class="pod-table-scroll"><table class="pod-table">
			<thead><tr><th>${__('Unit')}</th><th>${__('Applicants')}</th><th>${__('Women')}</th><th>${__('Women at offer')}</th>
				<th>${__('Home states')}</th><th>${__('Smaller districts')}</th></tr></thead>
			<tbody>${dv.map(u => {
				const w1 = u.gender_known ? u.women / u.gender_known : null;
				const w2 = u.offers_gender_known ? u.offers_women / u.offers_gender_known : null;
				const trend = w1 !== null && w2 !== null ? (w2 >= w1 ? '<span class="pod-an-up">▲</span>' : '<span class="pod-an-down">▼</span>') : '';
				return `<tr><td><b>${esc(u.unit)}</b></td><td>${n(u.reg)}</td>
					<td>${u.gender_known ? pc(u.women, u.gender_known) : `<span class="pod-muted">${__('not recorded')}</span>`}</td>
					<td>${u.offers_gender_known ? `${pc(u.offers_women, u.offers_gender_known)} ${trend}` : '<span class="pod-muted">—</span>'}
						<small class="pod-muted">${u.offers ? esc(__('of {0} offers', [n(u.offers)])) : ''}</small></td>
					<td>${u.states === null ? `<span class="pod-muted">${__('not recorded')}</span>` : n(u.states)}</td>
					<td title="${esc(u.district_known ? __('{0} of {1} applicants with a home district', [n(u.smaller_districts), n(u.district_known)]) : '')}">${u.smaller_districts === null
						? `<span class="pod-muted">${__('not recorded')}</span>` : pc(u.smaller_districts, u.district_known)}</td></tr>`;
			}).join('')}</tbody></table></div>`);

		// home district type
		const ds = x.districts || {};
		const known = (ds.rows || []).filter(r => r.key);
		const known_tot = known.reduce((a, r) => a + r.reg, 0);
		const not_given = (ds.rows || []).find(r => !r.key) || { reg: 0 };
		$a.find('#pod-an-x-dist').html(!(ds.captured_units || []).length ? empty(__('No unit in scope records the home district.'))
			: !known_tot ? empty(__('Home district is not filled in for these applicants.')) : `<div class="pod-table-scroll"><table class="pod-table">
			<thead><tr><th>${__('District type')}</th><th>${__('Applicants')}</th><th>${__('Share')}</th><th>${__('CV shortlisted')}</th><th>${__('Offers')}</th><th>${__('Joined')}</th></tr></thead>
			<tbody>${known.map(r => `<tr><td><b>${esc(__(r.label))}</b></td><td>${n(r.reg)}</td><td>${pc(r.reg, known_tot)}</td>
				<td>${n(r.reach_cv)} <small class="pod-muted">${r.reg ? this.pct(r.reach_cv, r.reg) + '%' : ''}</small></td>
				<td>${n(r.reach_offer)}</td><td>${n(r.reach_joined)}</td></tr>`).join('')}</tbody></table></div>
			<div class="pod-an-note pod-muted">${esc(__('{0} of {1} applicants ({2}) have a home district recorded — {3}.',
				[n(known_tot), n(known_tot + not_given.reg), this.pct(known_tot, known_tot + not_given.reg) + '%', (ds.captured_units || []).join(', ')]))}</div>`);

		// interviewer comment themes
		const c = x.comments || {};
		const bo = c.by_outcome || {};
		if (!c.total) {
			$a.find('#pod-an-x-com').html(empty(__('No interviewer comments recorded on the feedback forms for these applicants.')));
			return;
		}
		const themes = (c.themes || []).filter(t => t.n).sort((a, b) => b.n - a.n);
		// Comparing selects with rejects only means something with enough comments on both sides.
		const enough = (bo.Select || 0) >= 10 && (bo.Reject || 0) >= 10;
		const diff = (t) => (!enough || t.pct_select === null || t.pct_reject === null ? null : t.pct_select - t.pct_reject);
		const row = (t) => {
			const d = diff(t);
			return `<tr><td><b>${esc(__(t.label))}</b></td><td>${n(t.n)} <small class="pod-muted">${this.pct(t.n, c.total)}%</small></td>
				<td>${t.pct_select === null ? '—' : `${t.pct_select}%`}</td><td>${t.pct_reject === null ? '—' : `${t.pct_reject}%`}</td>
				<td>${d === null ? '<span class="pod-muted">—</span>' : d >= 5 ? `<span class="pod-an-up">${esc(__('more in selects'))}</span>`
					: d <= -5 ? `<span class="pod-an-down">${esc(__('more in rejects'))}</span>` : `<span class="pod-muted">${esc(__('similar'))}</span>`}</td></tr>`;
		};
		const looks_for = themes.filter(t => t.key !== 'concern' && (diff(t) || 0) >= 5).slice(0, 3).map(t => __(t.label));
		const words = c.words || [];
		$a.find('#pod-an-x-com').html(`
			<div class="pod-tl-kpis">
				${[[__('Comments analysed'), n(c.total), Object.entries(c.per_unit || {}).map(([u, v]) => `${u} ${n(v)}`).join(' · ')],
					[__('On selected applicants'), n(bo.Select || 0), pc(bo.Select || 0, c.total) + ' ' + __('of comments')],
					[__('On rejected applicants'), n(bo.Reject || 0), pc(bo.Reject || 0, c.total) + ' ' + __('of comments')],
					[__('What managers look for'), looks_for.length ? esc(looks_for.join(', ')) : '—',
						looks_for.length ? __('mentioned more often for selected applicants')
							: enough ? __('no theme stands out yet') : __('needs at least 10 comments on both selected and rejected applicants')]]
					.map(([l, v, sub]) => `<div class="pod-tl-kpi" style="--c:${POD_TONES.info}"><div class="pod-tl-kpi-top"><span>${esc(l)}</span></div>
						<b>${v}</b><small>${sub}</small></div>`).join('')}
			</div>
			<div class="pod-grid-2">
				<div class="pod-tl-chart"><div class="pod-tl-chart-head"><div><div class="pod-tl-chart-title">${esc(__('Themes in the comments'))}
					${this.info_html(__('Each comment is checked for words that belong to a theme (e.g. Communication: communicate, articulate, fluent, English…). % = share of comments on selected / rejected applicants that mention the theme. A theme mentioned much more for selected applicants is what panels reward; "Concerns raised" more often for rejects shows what they turn down. Keyword-based, not AI — read it as a pointer for HR, not a verdict.'))}</div>
					<div class="pod-panel-sub">${esc(__('Share of comments mentioning each theme, for selected vs rejected applicants'))}</div></div></div>
					${themes.length ? `<div class="pod-table-scroll"><table class="pod-table"><thead><tr><th>${__('Theme')}</th><th>${__('Comments')}</th>
						<th>${__('Selected')}</th><th>${__('Rejected')}</th><th>${__('Pattern')}</th></tr></thead><tbody>${themes.map(row).join('')}</tbody></table></div>`
						: empty(__('No known themes found in these comments.'))}
				</div>
				<div class="pod-tl-chart"><div class="pod-tl-chart-head"><div><div class="pod-tl-chart-title">${esc(__('Most used words'))}
					${this.info_html(__('Words used in the most comments (common words and anything that looks like a name are left out).'))}</div>
					<div class="pod-panel-sub">${esc(__('Number of comments using the word'))}</div></div></div>
					${words.length ? `<div class="pod-an-words">${words.map(w => `<span class="pod-an-word" title="${esc(__('{0} comments · {1} on selects · {2} on rejects', [n(w.n), n(w.Select), n(w.Reject)]))}">${esc(w.word)} <b>${n(w.n)}</b></span>`).join('')}</div>`
						: empty(__('Not enough comments yet.'))}
				</div>
			</div>
			<div class="pod-an-note pod-muted">${esc(__('Free keyword analysis on this server — no comment text leaves the system. A deeper AI reading of the comments (patterns in what managers look for, in their own words) can be switched on later with a paid AI key, the same one the Ask AI chat uses.'))}</div>`);
	}

	render_analytics() {
		this.an_dirty = false;
		const refresh = !!this.an_refresh;
		this.an_refresh = false;
		if (refresh) this.an_x_refresh = true;
		const $a = this.$root.find('#pod-an');
		if (!$a.children().length) $a.html(`<div class="pod-empty">${__('Loading analytics…')}</div>`);
		$a.addClass('pod-st-loading');
		const my = this.an_seq = (this.an_seq || 0) + 1;
		frappe.call({
			method: POD_API + 'get_analytics',
			args: this.args(this.filters || this.current_filters(), { refresh: refresh ? 1 : 0 }),
			callback: (r) => { if (my === this.an_seq && r.message) this.draw_analytics($a, r.message); },
			always: () => { if (my === this.an_seq) $a.removeClass('pod-st-loading'); }
		});
	}

	draw_analytics($a, s) {
		const esc = (v) => this.esc(v);
		const n = (v) => this.n(v);
		const ms = s.milestones || [];
		const steps = [{ key: 'reg', label: __('Registered') }].concat(ms.map(m => ({ key: m.key, label: __(m.label) })));
		const label_of = (k) => (steps.find(x => x.key === k) || {}).label || k;
		const units = s.units || [];
		const pc =(a, b) => (b ? `${this.pct(a, b)}%` : '—');
		const days = (v) => (v === null || v === undefined ? '—' : __('{0} d', [n(Math.round(v * 10) / 10)]));
		const OWN = { hr: 'var(--an-hr)', unit: 'var(--an-unit)', approver: 'var(--an-appr)', candidate: 'var(--an-cand)' };
		const GEN = { Female: 'var(--an-f)', Male: 'var(--an-m)', Other: 'var(--an-o)' };
		// light → dark blue ramp; dark text on the light steps, white on the dark ones
		const RAMP = ['#E3EEFC', '#CDE2FB', '#9EC5F4', '#6DA7EC', '#3987E5', '#1C5CAB'];
		const heat = (t) => {
			const i = Math.max(0, Math.min(RAMP.length - 1, Math.floor(t * RAMP.length - 1e-9)));
			return `background:${RAMP[i]};color:${i >= 4 ? '#fff' : '#1A2B3C'}`;
		};
		// a drillable element: data-drill = {kind, title, extra} → this.drill()
		const dd = (kind, title, extra = {}) =>
			`data-drill="${esc(JSON.stringify({ kind, title, extra }))}" role="button" tabindex="0"`;
		const ms_drill = (k, title, extra = {}) => (k === 'reg' ? dd('registrations', title, extra)
			: dd('card', title, Object.assign({ card: k }, extra)));
		const box = (title, sub, body, tip = '', tools = '', cls = '') => `
			<div class="pod-tl-chart ${cls}">
				<div class="pod-tl-chart-head">
					<div><div class="pod-tl-chart-title">${esc(title)} ${this.info_html(tip)}</div>
						${sub ? `<div class="pod-panel-sub">${esc(sub)}</div>` : ''}</div>
					${tools}
				</div>${body}</div>`;
		const group = (title, lead, id = '') => `<div class="pod-group-title" ${id ? `id="pod-an-g-${id}"` : ''}>${esc(title)}</div>
			${lead ? `<div class="pod-an-lead">${esc(lead)}</div>` : ''}`;
		const empty = (t) => `<div class="pod-empty">${esc(t || __('No data for these filters.'))}</div>`;
		const legend = (items) => `<div class="pod-legend">${items.map(x =>
			`<span><i style="background:${x.color}"></i>${esc(x.label)}</span>`).join('')}</div>`;
		// horizontal bars: label | bar | value (+ muted note); optional drill on the row
		const hbars = (items, opts = {}) => {
			if (!items.length) return empty(opts.empty);
			const max = Math.max(1, ...items.map(x => x.v || 0));
			return `<div class="pod-an-bars">${items.map(x => `
				<div class="pod-bar-row ${x.drill ? 'is-click' : ''}" ${x.drill || ''}>
					<div class="pod-bar-label" title="${esc(x.label)}">${x.dot ? `<span class="pod-dot" style="--c:${x.dot}"></span>` : ''}${esc(x.label)}</div>
					<div class="pod-bar-track">${x.v ? `<div class="pod-bar" style="width:${Math.max(1.5, (x.v / max) * 100)}%;--c:${x.color || 'var(--pipe-open)'}"></div>` : ''}</div>
					<div class="pod-bar-val"><b>${esc(x.vtext === undefined ? n(x.v) : x.vtext)}</b>${x.note ? ` <span class="pod-muted">${esc(x.note)}</span>` : ''}</div>
				</div>`).join('')}</div>`;
		};
		// one 100% bar split into parts, 2px gaps; hover a part for its number
		const stack = (parts) => {
			const tot = parts.reduce((a, p) => a + (p.v || 0), 0);
			if (!tot) return `<div class="pod-an-stack is-empty"></div>`;
			return `<div class="pod-an-stack">${parts.filter(p => p.v).map(p => `<span style="flex:${p.v};background:${p.color}"
				data-tip-html="${esc(`<b>${esc(p.label)}</b>: ${esc(n(p.v))} (${this.pct(p.v, tot)}%)`)}"></span>`).join('')}</div>`;
		};

		// ── 1. Conversion by unit ────────────────────────────────────────
		const all = { program: '', unit: __('All units') };
		steps.forEach(st => { all[st.key] = units.reduce((a, u) => a + (u[st.key] || 0), 0); });
		const conv_rows = (units.length > 1 ? [all] : []).concat(units);
		const conv = !all.reg ? empty() : `<div class="pod-table-scroll"><table class="pod-table pod-an-conv">
			<thead><tr><th>${__('Unit')}</th>${steps.map(st => `<th>${esc(st.label)}</th>`).join('')}<th>${__('Registered → joined')}</th></tr></thead>
			<tbody>${conv_rows.map(u => `<tr class="${u.program ? '' : 'is-total'}"><td><b>${esc(u.unit)}</b></td>${steps.map((st, i) => {
				const v = u[st.key] || 0;
				const prev = i ? (u[steps[i - 1].key] || 0) : null;
				const rate = prev ? v / prev : null;
				const title = i ? __('{0} of {1} {2} reached {3}', [n(v), n(prev), steps[i - 1].label, st.label]) : '';
				const extra = u.program ? { programs: [u.program] } : {};
				return `<td class="pod-an-cell ${v ? 'is-click' : ''}" ${v ? ms_drill(st.key, `${st.label} · ${u.unit}`, extra) : ''}
					${rate !== null ? `style="${heat(rate)}"` : ''} title="${esc(title)}"><b>${n(v)}</b>${prev ? `<small>${this.pct(v, prev)}%</small>` : ''}</td>`;
			}).join('')}<td>${pc(u.reach_joined, u.reg)}</td></tr>`).join('')}</tbody></table></div>
			<div class="pod-an-ramp"><span class="pod-muted">${__('Share who moved on from the step before')}:</span>
				${['0–17%', '17–33%', '33–50%', '50–67%', '67–83%', '83–100%'].map((l, i) => `<i style="background:${RAMP[i]}"></i><span class="pod-muted">${l}</span>`).join('')}</div>`;

		// ── 2. Job descriptions ──────────────────────────────────────────
		const jds = (s.jds || []).map((j, i) => Object.assign({ i }, j, {
			label: [j.role || __('(no role)'), j.job_code].filter(Boolean).join(' · '),
			sl_rate: j.reg ? j.reach_cv / j.reg : 0,
			acc_rate: (j.reach_accepted + j.declined) ? j.reach_accepted / (j.reach_accepted + j.declined) : null
		}));
		const jd_extra = (j) => Object.assign({ programs: [j.program] }, j.job_code ? { job_codes: [j.job_code] } : {},
			j.role ? { roles: [j.role] } : {});
		const jd_ok = (j) => !!(j.job_code || j.role);
		const jd_cell = (j, k, title) => {
			const v = j[k] || 0;
			return v && jd_ok(j) ? `<a class="pod-an-num" ${ms_drill(k, `${title} · ${j.label}`, jd_extra(j))}>${n(v)}</a>` : n(v);
		};
		const most = jds.slice(0, 10);
		const fewest = jds.filter(j => j.reg > 0).slice(-10).reverse();
		const jd_bar = (j) => ({ label: j.label, v: j.reg, note: j.unit,
			drill: jd_ok(j) ? dd('registrations', `${__('Applications')} · ${j.label}`, jd_extra(j)) : '' });
		const hm = s.jd_heat || { months: [], rows: [] };
		const hmax = Math.max(1, ...hm.rows.flatMap(r => r.cells));
		const mon = (m) => frappe.datetime.str_to_obj(m + '-01').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
		const heat_tbl = !hm.rows.length ? empty() : `<div class="pod-table-scroll"><table class="pod-table pod-an-heat">
			<thead><tr><th>${__('Job description')}</th>${hm.months.map(m => `<th>${esc(mon(m))}</th>`).join('')}</tr></thead>
			<tbody>${hm.rows.map(r => `<tr><td title="${esc(r.unit)}"><b>${esc([r.role || __('(no role)'), r.job_code].filter(Boolean).join(' · '))}</b></td>${r.cells.map((c, i) =>
				`<td class="pod-an-hcell" style="${c ? heat(c / hmax) : ''}" title="${esc(`${mon(hm.months[i])}: ${n(c)} ${__('applications')}`)}">${c ? n(c) : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

		// ── 3. Time ──────────────────────────────────────────────────────
		const tt = Object.fromEntries((s.time_to || []).map(t => [t.key, t]));
		const cov = s.coverage || {};
		const hist_pct = cov.moved ? this.pct(cov.history_docs, cov.moved) : 0;
		const kpi = (label, value, sub, tip) => `
			<div class="pod-tl-kpi" style="--c:${POD_TONES.info}">
				<div class="pod-tl-kpi-top"><span>${esc(label)}</span>${this.info_html(tip)}</div>
				<b>${esc(value)}</b><small>${esc(sub || '')}</small>
			</div>`;
		const tkpi = (k, label) => {
			const t = (tt[k] || {}).all || [null, null, 0];
			return kpi(label, days(t[0]), t[2] ? __('median · {0} applicants · avg {1}', [n(t[2]), days(t[1])]) : __('no recorded changes yet'),
				__('Half the applicants took fewer days than this, half took more — from the application date to the day their Application Status first reached this step (from the change history).'));
		};
		const time_kpis = `<div class="pod-tl-kpis">
			${tkpi('reach_offer', __('Application → offer'))}
			${tkpi('reach_accepted', __('Application → offer accepted'))}
			${tkpi('reach_joined', __('Application → joined'))}
			${kpi(__('Change history available'), `${hist_pct}%`, __('{0} of {1} applicants past "New"', [n(cov.history_docs), n(cov.moved)]),
				__('Time is measured from the Application Status change history (Version). Applicants moved before changes were tracked, or bulk-updated outside the form, have no history and are left out of the time figures.'))}
		</div>`;
		const to_rows = (units.length > 1 ? [{ program: '', unit: __('All units') }] : []).concat(units);
		const to_tbl = `<div class="pod-table-scroll"><table class="pod-table pod-an-conv">
			<thead><tr><th>${__('Unit')}</th>${(s.time_to || []).map(t => `<th>${esc(__(t.label))}</th>`).join('')}</tr></thead>
			<tbody>${to_rows.map(u => `<tr class="${u.program ? '' : 'is-total'}"><td><b>${esc(u.unit)}</b></td>${(s.time_to || []).map(t => {
				const v = u.program ? (t.units || {})[u.program] : t.all;
				return `<td title="${esc(v && v[2] ? __('median of {0} applicants · average {1}', [n(v[2]), days(v[1])]) : '')}">${v && v[2]
					? `<b>${esc(days(v[0]))}</b><small>${esc(__('n={0}', [n(v[2])]))}</small>` : '<span class="pod-muted">—</span>'}</td>`;
			}).join('')}</tr>`).join('')}</tbody></table></div>`;
		const st = s.steps || [];
		const owners = s.owners || [];
		const step_bars = hbars(st.map(x => ({
			label: __(x.label), v: x.median || 0, vtext: x.n ? days(x.median) : '—', color: OWN[x.owner], dot: OWN[x.owner],
			note: x.n ? __('avg {0} · {1} stays', [days(x.avg), n(x.n)]) + (x.open ? ' · ' + __('{0} there now', [n(x.open)]) : '')
				: (x.open ? __('{0} there now', [n(x.open)]) : __('no recorded stays'))
		})), { empty: __('No status changes recorded for these applicants yet.') });
		const own_tot = owners.map(o => ({ key: o.key, label: __(o.label), color: OWN[o.key],
			v: st.filter(x => x.owner === o.key).reduce((a, x) => a + (x.total_days || 0), 0) }));
		const own_sum = own_tot.reduce((a, o) => a + o.v, 0);
		const owner_box = !own_sum ? empty(__('No status changes recorded for these applicants yet.')) : `
			${stack(own_tot)}
			<div class="pod-an-ownlist">${own_tot.map(o => `<div><i style="background:${o.color}"></i><span>${esc(o.label)}</span>
				<b>${this.pct(o.v, own_sum)}%</b><span class="pod-muted">${esc(__('{0} applicant-days', [n(o.v)]))}</span></div>`).join('')}</div>`;
		const ta = s.turnaround || [];
		const ta_tbl = !ta.length ? empty(__('No interviews with feedback forms for these filters.')) : `<div class="pod-table-scroll"><table class="pod-table">
			<thead><tr><th>${__('Unit')}</th><th>${__('Median')}</th><th>${__('Average')}</th><th>${__('Within 2 days')}</th><th>${__('No feedback yet')}</th></tr></thead>
			<tbody>${ta.map(t => `<tr><td><b>${esc(t.unit)}</b></td><td>${esc(days(t.median))}</td><td>${esc(days(t.avg))}</td>
				<td>${t.n ? `${this.pct(t.within2, t.n)}%` : '—'} <span class="pod-muted">${esc(__('of {0}', [n(t.n)]))}</span></td>
				<td>${t.pending ? `<a class="pod-an-num" ${dd('pending', `${__('Feedback pending')} · ${t.unit}`, { programs: [t.program] })}>${n(t.pending)}</a>` : '0'}</td></tr>`).join('')}
			</tbody></table></div>`;

		// ── 4. Sources & referrals ──────────────────────────────────────
		const src = s.sources || [];
		const src_tot = src.reduce((a, x) => a + x.reg, 0);
		const src_max = Math.max(1, ...src.map(x => x.reg));
		const dim_num = (dim, row, k, title) => {
			const v = row[k] || 0;
			return v ? `<a class="pod-an-num" ${ms_drill(k, `${title} · ${row.label}`, { dim, dim_value: row.value })}>${n(v)}</a>` : '0';
		};
		const src_tbl = !src.length ? empty() : `<div class="pod-table-scroll pod-short"><table class="pod-table">
			<thead><tr><th>${__('Source')}</th><th>${__('Applicants')}</th><th>${__('CV shortlisted')}</th><th>${__('Offers')}</th><th>${__('Joined')}</th><th>${__('Offer rate')}</th></tr></thead>
			<tbody>${src.map(x => `<tr><td title="${esc(x.label)}"><b>${esc(x.label)}</b></td>
				<td><span class="pod-an-inbar"><i style="width:${(x.reg / src_max) * 100}%"></i></span>${dim_num('source', x, 'reg', __('Applicants'))} <span class="pod-muted">${pc(x.reg, src_tot)}</span></td>
				<td>${dim_num('source', x, 'reach_cv', __('CV shortlisted'))} <span class="pod-muted">${pc(x.reach_cv, x.reg)}</span></td>
				<td>${dim_num('source', x, 'reach_offer', __('Offers'))}</td>
				<td>${dim_num('source', x, 'reach_joined', __('Joined'))}</td>
				<td>${x.reg ? esc(__('{0} per 1,000', [n(Math.round((x.reach_offer / x.reg) * 10000) / 10)])) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
		const refs = s.referrers || [];
		const ref_tbl = !refs.length ? empty(__('No applicant named an employee referrer for these filters.')) : `<div class="pod-table-scroll pod-short"><table class="pod-table">
			<thead><tr><th>${__('Referred by')}</th><th>${__('Referred')}</th><th>${__('CV shortlisted')}</th><th>${__('Offers')}</th><th>${__('Joined')}</th></tr></thead>
			<tbody>${refs.map(x => `<tr><td title="${esc(x.value)}"><b>${esc(x.label)}</b></td>
				<td>${dim_num('referrer', x, 'reg', __('Referred'))}</td>
				<td>${dim_num('referrer', x, 'reach_cv', __('CV shortlisted'))} <span class="pod-muted">${pc(x.reach_cv, x.reg)}</span></td>
				<td>${dim_num('referrer', x, 'reach_offer', __('Offers'))}</td><td>${dim_num('referrer', x, 'reach_joined', __('Joined'))}</td></tr>`).join('')}</tbody></table></div>`;

		// ── 5. Diversity ─────────────────────────────────────────────────
		const g = Object.fromEntries((s.gender || []).map(x => [x.value, x]));
		const gkeys = ['Female', 'Male', 'Other'];
		const g_rows = steps.map(stp => {
			const parts = gkeys.map(k => ({ label: __(k), v: (g[k] || {})[stp.key] || 0, color: GEN[k] }));
			const known = parts.reduce((a, p) => a + p.v, 0);
			return `<div class="pod-an-grow"><span class="pod-an-glabel">${esc(stp.label)}</span>${stack(parts)}
				<span class="pod-an-gval">${known ? `<b>${this.pct(parts[0].v, known)}%</b> ${esc(__('women'))}` : '—'}</span></div>`;
		}).join('');
		const g_missing = (g[''] || {}).reg || 0;
		const g_box = !(s.gender || []).length ? empty(__('Gender is not captured for the units in scope.')) : `${g_rows}
			${g_missing ? `<div class="pod-tl-note pod-muted">${esc(__('{0} applicants have no gender filled in; they are left out of the shares.', [n(g_missing)]))}</div>` : ''}`;
		const gu_keys = ['reg', 'reach_cv', 'reach_offer', 'reach_joined'];
		const w_share = (rows, k) => {
			const f = (rows.Female || {})[k] || 0;
			const known = gkeys.reduce((a, x) => a + ((rows[x] || {})[k] || 0), 0);
			return known ? { pct: this.pct(f, known), f, known } : null;
		};
		const gu_tbl = `<div class="pod-table-scroll"><table class="pod-table pod-an-conv">
			<thead><tr><th>${__('Unit')}</th>${gu_keys.map(k => `<th>${esc(label_of(k))}</th>`).join('')}<th title="${esc(__('Change in the share of women from registration to offer'))}">${__('Change')}</th></tr></thead>
			<tbody>${(s.gender_units || []).map(u => {
				if (!u.captured) return `<tr><td><b>${esc(u.unit)}</b></td><td colspan="${gu_keys.length + 1}" class="pod-muted">${__('Gender is not captured on this unit\'s form')}</td></tr>`;
				const sh = gu_keys.map(k => w_share(u.rows, k));
				const d = sh[0] && sh[2] ? Math.round((sh[2].pct - sh[0].pct) * 10) / 10 : null;
				return `<tr><td><b>${esc(u.unit)}</b></td>${sh.map((x, i) => `<td title="${esc(x ? __('{0} women of {1} with gender filled in', [n(x.f), n(x.known)]) : '')}">${x
					? `<a class="pod-an-num" ${ms_drill(gu_keys[i], `${label_of(gu_keys[i])} · ${__('Women')} · ${u.unit}`, { programs: [u.program], dim: 'gender', dim_value: 'Female' })}>${x.pct}%</a>`
					: '—'}</td>`).join('')}
					<td>${d === null ? '—' : `<b class="${d < 0 ? 'pod-an-down' : ''}">${d > 0 ? '+' : ''}${d} ${__('pts')}</b>`}</td></tr>`;
			}).join('')}</tbody></table></div>`;
		// filled-in values as bars (biggest first); past `top`, the rest fold into one "Other" bar
		const dim_bars = (dim, rows, title, top = 8) => {
			const filled = rows.filter(x => x.value);
			const items = filled.slice(0, top).map(x => ({
				label: __(x.label), v: x.reg, note: __('{0} shortlisted', [pc(x.reach_cv, x.reg)]),
				drill: dd('registrations', `${title} · ${x.label}`, { dim, dim_value: x.value })
			}));
			const rest = filled.slice(top);
			if (rest.length) {
				const v = rest.reduce((a, x) => a + x.reg, 0);
				const cv = rest.reduce((a, x) => a + x.reach_cv, 0);
				items.push({ label: __('Other ({0} values)', [rest.length]), v, note: __('{0} shortlisted', [pc(cv, v)]) });
			}
			return hbars(items, { empty: __('Not filled in for these applicants.') });
		};
		const not_given = (rows) => {
			const x = rows.find(r => !r.value);
			return x && x.reg ? `<div class="pod-tl-note pod-muted">${esc(__('Not filled in: {0}', [n(x.reg)]))}</div>` : '';
		};
		const edu = s.education || [];
		const age = s.age_band || [];
		const hs = (s.home_state || []).filter(x => x.value);

		// ── 6. Interviewers ──────────────────────────────────────────────
		const ivs = (s.interviewers || []).filter(x => x.forms);
		const iv_dec = ivs.reduce((a, x) => a + x.decided, 0);
		const iv_sel = ivs.reduce((a, x) => a + x.Select, 0);
		const iv_avg = iv_dec ? (iv_sel / iv_dec) * 100 : null;

		// ── 7. Reasons ───────────────────────────────────────────────────
		const decl = (s.decline || []).map(x => ({ label: x.value, v: x.n,
			drill: dd('registrations', `${__('Decline reason')} · ${x.value}`, { stage: 'Not selected', dim: 'decline_reason', dim_value: x.value }) }));
		const rej = (s.reject || []).map(x => ({ label: x.value, v: x.n, note: __(x.phase),
			drill: dd('registrations', `${__('Rejection reason')} · ${x.value}`, { stage: 'Not selected', dim: 'reject_reason', dim_value: x.value }) }));

		// ── 8. Data coverage ─────────────────────────────────────────────
		const FIELD_LABELS = { source: __('How they heard (source)'), gender: __('Gender'), education: __('Education'),
			age_band: __('Age (age / date of birth)'), home_state: __('Home state'), referrer: __('Employee referrer'),
			decline_reason: __('Offer decline reason'), reject_reason: __('Rejection reason') };
		const FIELD_NOTES = { referrer: __('Only filled when someone was referred.'),
			decline_reason: __('Share of declined offers / not joined with a reason.'), reject_reason: __('Share of rejected applicants with a reason.') };
		const all_units = cov.all_units || [];
		const cov_rows = (cov.fields || []).map(x => ({
			what: FIELD_LABELS[x.key] || x.key,
			where: x.units.length ? (x.units.length === all_units.length ? __('All units') : x.units.join(', ')) : __('Not captured'),
			missing: all_units.filter(u => !x.units.includes(u)).join(', '),
			pct: x.total ? this.pct(x.filled, x.total) : null, filled: x.filled, total: x.total, note: FIELD_NOTES[x.key] || ''
		})).concat([
			{ what: __('Application Status change history'), where: __('All units'), pct: hist_pct, filled: cov.history_docs, total: cov.moved,
				note: __('Needed for every time figure above.') },
			{ what: __('Interviewer named on the interview'), where: __('All units'), pct: cov.interviews ? this.pct(cov.interviews_named, cov.interviews) : null,
				filled: cov.interviews_named, total: cov.interviews, note: '' },
			{ what: __('Urban / rural, city tier (1, 2, 3)'), where: __('Not captured'), missing: '', pct: null, filled: 0, total: 0,
				note: __('No form asks for it yet — add a field to analyse it.') }
		]);
		const cov_tbl = `<div class="pod-table-scroll"><table class="pod-table pod-an-cov">
			<thead><tr><th>${__('Data')}</th><th>${__('Captured on')}</th><th>${__('Filled in')}</th><th>${__('Note')}</th></tr></thead>
			<tbody>${cov_rows.map(r => `<tr><td><b>${esc(r.what)}</b></td>
				<td title="${esc(r.missing ? __('Not on: {0}', [r.missing]) : '')}">${esc(r.where)}${r.missing && r.where !== __('Not captured') ? ` <span class="pod-muted">· ${esc(__('not on {0}', [r.missing]))}</span>` : ''}</td>
				<td>${r.pct === null ? '<span class="pod-muted">—</span>' : `<span class="pod-an-inbar ${r.pct < 50 ? 'is-low' : ''}"><i style="width:${r.pct}%"></i></span><b>${r.pct}%</b> <span class="pod-muted">${esc(__('{0} of {1}', [n(r.filled), n(r.total)]))}</span>`}</td>
				<td class="pod-muted" title="${esc(r.note)}">${esc(r.note)}</td></tr>`).join('')}</tbody></table></div>`;

		// ── Management review (2026-11-24): offer acceptance by unit ─────
		const acc_u = {};
		jds.forEach(j => {
			const u = acc_u[j.unit] = acc_u[j.unit] || { unit: j.unit, program: j.program, offers: 0, accepted: 0, declined: 0 };
			u.offers += j.reach_offer || 0; u.accepted += j.reach_accepted || 0; u.declined += j.declined || 0;
		});
		const acc_rows = Object.values(acc_u).filter(u => u.offers).sort((a, b) => b.offers - a.offers);
		const acc_tbl = !acc_rows.length ? empty(__('No offers made within these filters.')) : `<div class="pod-table-scroll"><table class="pod-table">
			<thead><tr><th>${__('Unit')}</th><th>${__('Offers made')}</th><th>${__('Accepted')}</th><th>${__('Declined / not joined')}</th>
				<th>${__('Still deciding')}</th><th>${__('Acceptance')}</th></tr></thead>
			<tbody>${acc_rows.map(u => {
				const decided = u.accepted + u.declined;
				return `<tr><td><b>${esc(u.unit)}</b></td>
					<td><a class="pod-an-num" ${dd('card', `${__('Offers')} · ${u.unit}`, { card: 'reach_offer', programs: [u.program] })}>${n(u.offers)}</a></td>
					<td><a class="pod-an-num" ${dd('card', `${__('Accepted')} · ${u.unit}`, { card: 'reach_accepted', programs: [u.program] })}>${n(u.accepted)}</a></td>
					<td>${n(u.declined)}</td><td>${n(Math.max(0, u.offers - decided))}</td>
					<td>${decided ? `<b>${this.pct(u.accepted, decided)}%</b>` : '<span class="pod-muted">—</span>'}</td></tr>`;
			}).join('')}</tbody></table></div>`;

		// ── where time could be saved (from the step + feedback numbers) ──
		const own_label = Object.fromEntries((s.owners || []).map(o => [o.key, __(o.label)]));
		const slow = (s.steps || []).filter(x => x.n && x.total_days).sort((a, b) => (b.total_days || 0) - (a.total_days || 0)).slice(0, 3);
		const fb_late = (s.turnaround || []).filter(t => t.n && t.median !== null && t.median > 2);
		const fb_pending = (s.turnaround || []).reduce((a, t) => a + (t.pending || 0), 0);
		const tips = [];
		slow.forEach(x => tips.push(__('<b>{0}</b>: {1} applicant-days of waiting in total — {2} stays, {3} on average each — owned by {4}.',
			[esc(__(x.label)), esc(n(x.total_days)), esc(n(x.n)), esc(days(x.avg)), esc(own_label[x.owner] || x.owner)])));
		fb_late.forEach(t => tips.push(__('<b>{0}</b>: feedback takes a median of {1} after the interview (target: within 2 days).',
			[esc(t.unit), esc(days(t.median))])));
		if (fb_pending) tips.push(__('<b>{0}</b> interviews have no feedback form yet — chasing these shortens the interview stage directly.', [esc(n(fb_pending))]));
		const save_box = tips.length ? `<ul class="pod-an-tips">${tips.map(t => `<li>${t}</li>`).join('')}</ul>`
			: empty(__('Not enough recorded status changes yet to point at a slow step.'));

		// ── review checklist: every point of the management review and where it is answered ──
		const RV = { done: __('Built'), new: __('New'), data: __('Needs data'), free: __('Free version'), review: __('To review') };
		const review = [
			['review', __('Box titles make sense to users'), __('Every card has an ⓘ and the Card guide; titles still to be checked with users'), ''],
			['done', __('(i) Time at each stage, and application → acceptance for each successful candidate'), __('Time taken'), 'time'],
			['done', __('(ii) Conversion rate at each stage'), __('Conversion'), 'conversion'],
			['done', __('(iii) Conversion by unit'), __('Conversion'), 'conversion'],
			['new', __('(iv) Offer → acceptance for each job description and each unit'), __('Job descriptions (by JD and, new, by unit)'), 'jd'],
			[decl.length ? 'done' : 'data', __('(v) Why applicants declined the offer'), __('Reasons — fill "Decline Reason" when marking Offer Declined'), 'reasons'],
			['done', __('(vi) Sources and influencers (referrers)'), __('Sources & referrals'), 'sources'],
			['new', __('(viii) Diversity: gender, education, home state, urban / rural'), __('Diversity & inclusion (home district type is new; few forms record the district)'), 'diversity'],
			['done', __('(ix) Application density per job over time; most / fewest applications'), __('Job descriptions'), 'jd'],
			['done', __('(x) Success rate by interviewer'), __('Interviewers'), 'interviewers'],
			['new', __('(xi) Which unit does more for diversity and inclusion'), __('Diversity & inclusion → Diversity by unit'), 'diversity'],
			['new', __('(xii) HR vs unit time, and where it can be made faster'), __('Time taken → Where time could be saved'), 'time'],
			['free', __('Anonymised analysis of interviewer comments'), __('Interviewer comments (keyword themes; AI analysis needs a paid API key)'), 'comments']
		];
		const review_box = `<details class="pod-an-review"><summary>${esc(__('Management review — where each point is answered ({0} points)', [review.length]))}</summary>
			<table class="pod-table"><thead><tr><th>${__('Point')}</th><th>${__('Where on this tab')}</th><th>${__('Status')}</th></tr></thead>
			<tbody>${review.map(([st, pt, where, id]) => `<tr><td>${esc(pt)}</td>
				<td>${id ? `<a class="pod-an-goto" data-goto="${id}">${esc(where)}</a>` : esc(where)}</td>
				<td><span class="pod-an-st is-${st}">${esc(RV[st])}</span></td></tr>`).join('')}</tbody></table></details>`;

		const updated = String(s.generated_at || '').slice(11, 16);
		$a.html(`
			<div class="pod-an-head pod-muted">${esc(__('Every chart follows the filters above · click any number or bar for its list · numbers cached up to 10 minutes (Refresh for fresh ones) · updated {0}', [updated]))}</div>

			${review_box}

			${group(__('Conversion'), __('How many applicants move on from each step, and how that differs between units.'), 'conversion')}
			${box(__('Step-by-step conversion, by unit'), __('Number reaching each step; small % = share of the step before; darker = more moved on'), conv,
				__('Each step counts everyone who got at least that far, even if rejected later, so the numbers only narrow left to right. The % under a number is the share of the step before who reached it — compare a column across units to see where one unit loses more applicants.'))}

			${group(__('Job descriptions'), __('Which openings draw applications, and how their offers turn out.'), 'jd')}
			${box(__('Offer acceptance by unit'), __('Offers made, accepted and declined per unit'), acc_tbl,
				__('Acceptance = accepted (including everyone now onboarding or joined) ÷ (accepted + declined / not joined). "Still deciding" = offers with no answer yet, left out of the rate.'))}
			${box(__('Applications, offers and acceptance by job description'), __('Every job code / role in scope · click a column to sort, a number for its list'),
				`<div class="pod-an-tools"><input type="search" class="pod-an-jdsearch" placeholder="${esc(__('Filter by role, job code or unit…'))}" aria-label="${esc(__('Filter job descriptions'))}"></div><div class="pod-table-scroll pod-short" id="pod-an-jd"></div>`,
				__('Acceptance = offers accepted (including everyone now onboarding or joined) ÷ (accepted + declined / not joined). Offers still awaiting a reply are left out of it. Months = calendar months in which this job received applications.'))}
			<div class="pod-grid-2">
				${box(__('Most applications'), __('Top 10 job descriptions'), hbars(most.map(jd_bar)))}
				${box(__('Fewest applications'), __('Bottom 10 job descriptions (with at least one)'), hbars(fewest.map(jd_bar)))}
			</div>
			${box(__('Applications per month'), __('The 10 most-applied job descriptions · darker = more applications that month'), heat_tbl)}

			${group(__('Time taken'), __('How long each part of the process takes, and who the waiting is on.'), 'time')}
			${time_kpis}
			${box(__('Days from application to each step, by unit'), __('Median days · n = applicants with a recorded change'), to_tbl,
				__('From the application date to the day the Application Status first reached that step. Reaching a later step counts as having reached the earlier ones by then.'))}
			<div class="pod-grid-2">
				${box(__('Time spent at each step'), __('Median days per stay, coloured by who the step waits on'), step_bars,
					__('A stay = from the day an applicant entered a step until their status moved to a different step. Consecutive statuses of the same step (e.g. Recruiter Round → Scheduled → Select) are one stay. "There now" = still at that step.'),
					legend(owners.map(o => ({ label: __(o.label), color: OWN[o.key] }))))}
				${box(__('Who the waiting is on'), __('Share of all recorded days applicants spent waiting'), owner_box,
					__('All completed stays added up per owner. HR team = screening, test, recruiter round, documents, offer letter, onboarding. Interview panel (unit) = functional and leadership rounds. Approvers = compensation approval. Candidate = deciding on the offer. This split is a starting assumption — tell us if a step belongs to someone else.'))}
			</div>
			${box(__('Where time could be saved'), __('Read from the numbers on this tab — the biggest waits first'), save_box,
				__('The steps with the most applicant-days of waiting, feedback that takes more than 2 days, and interviews still without feedback. A starting point for a conversation with HR and the units, not a verdict.'))}
			${box(__('Feedback turnaround'), __('Days from the interview to the first feedback form submitted after it'), ta_tbl,
				__('For every interview held (not cancelled): the days until the applicant\'s first feedback form dated on or after the interview day. "No feedback yet" = no form since that interview; click it for the list.'))}
			${box(__('Successful candidates'), __('Everyone who accepted an offer · days from application · click a name for their profile'),
				`<div class="pod-table-scroll pod-short" id="pod-an-succ"></div>`,
				__('Days come from the status change history; "—" means the change was not recorded.'))}

			${group(__('Sources & referrals'), __('Where applicants heard about the opening, and which sources and employees bring people who get through.'), 'sources')}
			${box(__('Source quality'), __('Applicants per source and how far they get'), src_tbl,
				__('Offer rate = offers made per 1,000 applicants from that source, so small and large sources compare fairly.'))}
			${box(__('Employee referrers'), (s.referrer_count || 0) > refs.length ? __('Top {0} of {1} employees who referred someone', [refs.length, s.referrer_count]) : __('Employees named as the referrer'), ref_tbl,
				__('From "If yes — employee name" on the registration (Field). The people who bring in applicants who get shortlisted and hired are your strongest influencers.'))}

			${group(__('Diversity & inclusion'), __('Who applies, and whether that mix holds as applicants move through the process.'), 'diversity')}
			<div class="pod-grid-2">
				${box(__('Diversity by unit'), __('Which unit reaches a wider mix of applicants, and keeps it through to the offer'),
					`<div id="pod-an-x-div">${empty(__('Loading…'))}</div>`,
					__('Women = share of applicants with gender filled in. "At offer" = the same share among applicants made an offer — a unit whose share holds or rises is doing more for gender balance. Home states = how many states its applicants come from. Smaller districts = share of applicants whose home district is not a metro or large city (only where the form records the district).'))}
				${box(__('Home district type (urban / rural)'), __('Applicants by the kind of district they come from'),
					`<div id="pod-an-x-dist">${empty(__('Loading…'))}</div>`,
					__('No form asks "urban or rural" directly, so this groups the home district: Metro (Tier 1: Mumbai, Delhi, Bengaluru Urban, Chennai, Kolkata, Hyderabad, Pune, Ahmedabad), Large city (Tier 2, about 100 big-city districts) and Other districts (smaller towns and rural areas). Field: Native District · Health: City / District. Grants and Scholarship do not record a district.'))}
			</div>
			<div class="pod-grid-2">
				${box(__('Gender at each step'), __('Share of women, men and other at each step (gender filled in)'), g_box, '',
					legend(gkeys.map(k => ({ label: __(k), color: GEN[k] }))))}
				${box(__('Women\'s share by unit'), __('% women at each step · last column = change from registration to offer'), gu_tbl,
					__('A unit whose share of women rises (or holds) from registration to offer is doing more for gender balance than one where it falls. Click a % for those women.'))}
			</div>
			<div class="pod-grid-3">
				${box(__('Education'), __('Highest qualification · click for the list'), dim_bars('education', edu, __('Education')) + not_given(edu))}
				${box(__('Age group'), __('At application · click for the list'), dim_bars('age_band', age, __('Age')) + not_given(age),
					__('From the Age field, or the date of birth on the application date. Placeholder values (0, 1900-01-01, future dates) count as not filled in.'))}
				${box(__('Home state'), __('Where applicants come from · darker = more'), hs.length ? '<div class="pod-india pod-an-map"></div>' : empty(__('Home state is not filled in for these applicants.')),
					__('Field: Native State · Health: State / Union territory · Scholarship: State of residence. Grants does not capture it.'))}
			</div>

			${group(__('Interviewers'), __('How outcomes vary between interviewers — names hidden by default.'), 'interviewers')}
			${box(__('Interviewer outcomes'), iv_avg === null ? '' : __('Average select rate across all interviewers: {0}%', [Math.round(iv_avg * 10) / 10]),
				`<div class="pod-table-scroll pod-short" id="pod-an-iv"></div>`,
				__('From the result on each feedback form, per panelist. Select rate = Select ÷ (Select + Reject + On hold). Interviewers see different candidates and rounds, so read a big difference as a prompt for a calibration conversation, not a verdict; fewer than 5 decisions is too few to compare.'),
				`<label class="pod-an-toggle"><input type="checkbox" class="pod-an-names"> ${__('Show names')}</label>`)}

			${group(__('Interviewer comments'), __('What interviewers write about applicants — anonymised: only themes and common words are shown, never a comment, an applicant or an interviewer.'), 'comments')}
			<div id="pod-an-x-com">${empty(__('Loading…'))}</div>

			${group(__('Reasons'), __('What is recorded about why applicants decline or are turned down.'), 'reasons')}
			<div class="pod-grid-2">
				${box(__('Why offers were declined'), __('Decline reason recorded on the registration'),
					hbars(decl, { empty: __('No decline reasons recorded yet. Filling "Decline Reason" when marking Offer Declined makes this chart work (compensation, location, another offer…).') }))}
				${box(__('Recorded rejection reasons'), __('"Reasons for reject" / "Reason for regret" on the registration'), hbars(rej, { empty: __('No rejection reasons recorded for these applicants.') }))}
			</div>

			${group(__('Data coverage'), __('How complete the data behind these charts is — the gaps to close for better analytics.'), 'coverage')}
			${box(__('What is captured, and how much is filled in'), __('For the applicants in scope'), cov_tbl)}
		`);

		$a.find('.pod-an-goto').on('click', (e) => {
			const el = $a.find(`#pod-an-g-${$(e.currentTarget).data('goto')}`)[0];
			if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
		});
		this.load_analytics_extra($a);

		// job descriptions table (client-side sort + filter over all rows)
		const jd_cols = [
			{ key: 'unit', label: __('Unit') },
			{ key: 'job_code', label: __('Job code'), nw: true },
			{ key: 'role', label: __('Role') },
			{ key: 'reg', label: __('Applications'), render: (j) => jd_cell(j, 'reg', __('Applications')) },
			{ key: 'reach_cv', label: __('CV shortlisted'), render: (j) => `${jd_cell(j, 'reach_cv', __('CV shortlisted'))} <span class="pod-muted">${pc(j.reach_cv, j.reg)}</span>` },
			{ key: 'reach_offer', label: __('Offers'), render: (j) => jd_cell(j, 'reach_offer', __('Offers')) },
			{ key: 'reach_accepted', label: __('Accepted'), render: (j) => jd_cell(j, 'reach_accepted', __('Accepted')) },
			{ key: 'declined', label: __('Declined'), render: (j) => n(j.declined) },
			{ key: 'acc_rate', label: __('Acceptance'), sort: (j) => (j.acc_rate === null ? -1 : j.acc_rate),
				render: (j) => (j.acc_rate === null ? '<span class="pod-muted">—</span>' : `<b>${Math.round(j.acc_rate * 1000) / 10}%</b>`) },
			{ key: 'active_months', label: __('Months'), render: (j) => `${n(j.active_months)} <span class="pod-muted">${esc(j.first ? `${mon(j.first)} – ${mon(j.last)}` : '')}</span>` }
		];
		const $jd = $a.find('#pod-an-jd');
		const draw_jd = () => {
			const q = String($a.find('.pod-an-jdsearch').val() || '').toLowerCase().trim();
			const rows = q ? jds.filter(j => `${j.unit} ${j.job_code} ${j.role}`.toLowerCase().includes(q)) : jds;
			this.sortable_table($jd, jd_cols, rows, { default_sort: 'reg', default_dir: -1, empty: __('No job descriptions match.') });
		};
		draw_jd();
		let jt = null;
		$a.find('.pod-an-jdsearch').on('input', () => { clearTimeout(jt); jt = setTimeout(draw_jd, 200); });

		// successful candidates
		this.sortable_table($a.find('#pod-an-succ'), [
			{ key: 'name', label: __('Applicant'), render: (r) => this.cand_link(r) },
			{ key: 'unit', label: __('Unit') },
			{ key: 'role', label: __('Role') },
			{ key: 'applied', label: __('Applied'), nw: true, render: (r) => esc(this.fmt_date(r.applied)) },
			...[['to_offer', __('Days to offer')], ['to_accept', __('Days to accept')], ['to_join', __('Days to join')]].map(([k, l]) => ({
				key: k, label: l, nw: true, sort: (r) => (r[k] === null || r[k] === undefined ? 1e9 : r[k]),
				render: (r) => (r[k] === null || r[k] === undefined ? '<span class="pod-muted">—</span>' : `<b>${n(r[k])}</b>`) })),
			{ key: 'status', label: __('Status') }
		], s.successes || [], { default_sort: 'applied', default_dir: -1, empty: __('Nobody has accepted an offer within these filters.') });

		// interviewers (anonymised unless "Show names" is ticked)
		const draw_iv = () => {
			const show = $a.find('.pod-an-names').prop('checked');
			const rows = ivs.map((x, i) => Object.assign({}, x, {
				who: show ? x.label : __('Interviewer {0}', [String(i + 1).padStart(2, '0')]),
				rate: x.decided ? (x.Select / x.decided) * 100 : null
			}));
			this.sortable_table($a.find('#pod-an-iv'), [
				{ key: 'who', label: __('Interviewer'), render: (r) => (show && r.by
					? `<a class="pod-an-num" ${dd('feedback', `${__('Feedback by')} ${r.label}`, { search: r.by })}>${esc(r.who)}</a>` : `<b>${esc(r.who)}</b>`) },
				{ key: 'units', label: __('Units'), render: (r) => esc((r.units || []).join(', ')) },
				{ key: 'forms', label: __('Feedback forms'), render: (r) => n(r.forms) },
				{ key: 'Select', label: __('Select'), render: (r) => n(r.Select) },
				{ key: 'Reject', label: __('Reject'), render: (r) => n(r.Reject) },
				{ key: 'On hold', label: __('On hold'), render: (r) => n(r['On hold']) },
				{ key: 'rate', label: __('Select rate'), sort: (r) => (r.rate === null ? -1 : r.rate), render: (r) => (r.rate === null ? '<span class="pod-muted">—</span>'
					: `<b>${Math.round(r.rate * 10) / 10}%</b>${r.decided < 5 ? ` <span class="pod-muted">${esc(__('only {0}', [n(r.decided)]))}</span>` : ''}`) },
				{ key: 'diff', label: __('vs average'), sort: (r) => (r.rate === null || iv_avg === null ? -1e9 : r.rate - iv_avg), render: (r) => {
					if (r.rate === null || iv_avg === null || r.decided < 5) return '<span class="pod-muted">—</span>';
					const d = Math.round((r.rate - iv_avg) * 10) / 10;
					return `<span class="${d < 0 ? 'pod-an-down' : ''}">${d > 0 ? '+' : ''}${d} ${__('pts')}</span>`;
				} }
			], rows, { default_sort: 'forms', default_dir: -1, empty: __('No feedback forms for these filters.') });
		};
		draw_iv();
		$a.find('.pod-an-names').on('change', draw_iv);

		// home state map
		const $tip = this.$root.find('#pod-tip');
		const tipon = (e, html) => $tip.html(html).css({ display: 'block', left: e.clientX + 14, top: e.clientY + 14 });
		if (hs.length) this.india_map($a.find('.pod-an-map'), hs.map(x => ({ state: x.value, n: x.reg })), tipon, $tip, __('applicants'));

		// interactions: hover tooltips, and every [data-drill] opens its list
		$a.find('[data-tip-html]').on('mousemove', (e) => tipon(e, $(e.currentTarget).attr('data-tip-html')))
			.on('mouseleave', () => $tip.hide());
		const open = (el) => {
			try {
				const d = JSON.parse(el.getAttribute('data-drill'));
				$tip.hide();
				this.drill(d.kind, d.title, d.extra || {});
			} catch (err) { /* malformed attribute — ignore */ }
		};
		$a.off('click.pan keydown.pan')
			.on('click.pan', '[data-drill]', (e) => { if (!$(e.target).closest('.pod-info').length) open(e.currentTarget); })
			.on('keydown.pan', '[data-drill]', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e.currentTarget); } });
		// applicant names (.pod-cand) are already handled by the page root's delegated click
	}

	open_timeline(program, id) {
		if (!program || !id) return;
		frappe.call({
			method: POD_API + 'get_candidate_timeline',
			args: { program, name: id },
			freeze: true,
			callback: (r) => { if (r.message) this.timeline_dialog(r.message); }
		});
	}

	// Timeline popup, oldest first, grouped by day: the time, then a card
	// whose colour says what kind of event it is (registration, form, status
	// change, interview, feedback). Outcomes (new status, feedback result)
	// are pills in the meaning colours used on the cards. "N days later"
	// shows the wait between days; a "Today" line separates interviews still
	// to come.
	timeline_dialog(t) {
		const esc = (v) => this.esc(v);
		const KINDS = {
			registered: [__('Registration'), '#64748B'], form: [__('Form'), '#2C5F8A'],
			status: [__('Status change'), '#6D4FA3'], interview: [__('Interview'), '#0F7A8A'],
			feedback: [__('Feedback'), '#2F7D4F']
		};
		const day = (at) => String(at || '').slice(0, 10);
		const evs = t.events || [];
		const today = day(t.now);
		const first = evs.length ? day(evs[0].at) : null;
		const past = evs.filter(e => day(e.at) <= today);
		const last = past.length ? day(past[past.length - 1].at) : first;
		const span = first ? frappe.datetime.get_diff(t.ended ? last : today, first) : 0;
		const counts = {};
		evs.forEach(e => { counts[e.kind] = (counts[e.kind] || 0) + 1; });
		const pill = (v, tone) => `<span class="pod-pill" style="--c:${POD_TONES[tone] || POD_TONES.neutral}">${esc(v || __('(blank)'))}</span>`;

		const item = (e) => {
			const [kl, kc] = KINDS[e.kind] || [e.kind, POD_TONES.neutral];
			const future = day(e.at) > today;
			let title, body = '';
			if (e.kind === 'status') {
				// one line: old → new (the reason, if any, underneath)
				title = `<span class="pod-tli-flow is-inline">${pill(e.old, 'neutral')}<span class="pod-tli-arrow">→</span>${pill(e.new, e.tone)}</span>`;
				body = e.reason ? `<div class="pod-tli-meta">${esc(__('Reason'))}: ${esc(e.reason)}</div>` : '';
			} else if (e.kind === 'feedback') {
				title = esc(e.form || __('Feedback'));
				body = e.result ? `<div class="pod-tli-flow">${pill(e.result, e.tone)}</div>` : `<div class="pod-tli-meta">${__('No result recorded')}</div>`;
			} else {
				title = esc(e.title);
				if (e.detail) body = `<div class="pod-tli-meta">${esc(e.detail)}</div>`;
			}
			const flags = (e.cancelled ? `<span class="pod-flag" style="--c:${POD_TONES.bad}">${__('Cancelled')}</span>` : '')
				+ (future && !e.cancelled ? `<span class="pod-flag" style="--c:${POD_TONES.time}">${__('Upcoming')}</span>` : '');
			// "by …" underneath; the record link sits at the right of the title row
			const foot = e.by ? __('by {0}', [esc(e.by)]) : '';
			const link = e.doc ? `<a class="pod-tli-doc" target="_blank" rel="noopener" href="/app/${esc(e.route)}/${encodeURIComponent(e.doc)}"
				title="${esc(__('Open record'))}">${esc(e.doc)} ↗</a>` : '';
			return `<div class="pod-tli ${future ? 'is-future' : ''} ${e.cancelled ? 'is-cancelled' : ''}" data-kind="${esc(e.kind)}" style="--k:${kc}">
				<div class="pod-tli-time">${e.date_only ? '' : esc(String(e.at).slice(11, 16))}</div>
				<div class="pod-tli-card">
					<div class="pod-tli-top"><span class="pod-tli-kind">${esc(kl)}</span><span class="pod-tli-title">${title}</span>${flags}${link}</div>
					${body}
					${foot ? `<div class="pod-tli-foot">${foot}</div>` : ''}
				</div>
			</div>`;
		};

		// group by day
		const groups = [];
		evs.forEach(e => {
			const g = groups[groups.length - 1];
			if (g && g.day === day(e.at)) g.items.push(e);
			else groups.push({ day: day(e.at), items: [e] });
		});
		const fmt_day = (d) => {
			const m = moment(d);
			return `<b>${esc(m.format('DD MMM'))}</b><span>${esc(m.format('YYYY · ddd'))}</span>`;
		};
		let html = '', prev = null, today_drawn = false;
		const gap_html = (n) => n > 0 ? `<div class="pod-tlg-gap">${n === 1 ? __('1 day later') : __('{0} days later', [this.n(n)])}</div>` : '';
		groups.forEach(g => {
			if (!today_drawn && g.day > today) {
				html += gap_html(prev ? frappe.datetime.get_diff(today, prev) : 0);
				html += `<div class="pod-tl-today"><span>${__('Today')} · ${esc(this.fmt_date(today))}</span></div>`;
				today_drawn = true;
				prev = today;
			}
			html += gap_html(prev ? frappe.datetime.get_diff(g.day, prev) : 0);
			prev = g.day;
			html += `<div class="pod-tlg"><div class="pod-tlg-date">${fmt_day(g.day)}</div>
				<div class="pod-tlg-items">${g.items.map(item).join('')}</div></div>`;
		});
		if (!today_drawn && !t.ended && prev) html += gap_html(frappe.datetime.get_diff(today, prev));
		const end_tone = t.stage === 'Not selected' ? 'bad' : t.ended ? 'good' : 'info';
		html += `<div class="pod-tlg pod-tlg-end"><div class="pod-tlg-date"><b>${t.ended ? __('End') : __('Now')}</b></div>
			<div class="pod-tlg-items"><div class="pod-tli" style="--k:${POD_TONES[end_tone]}"><div class="pod-tli-time"></div>
				<div class="pod-tli-card"><div class="pod-tli-top"><span class="pod-tli-kind">${t.ended ? __('Final status') : __('Current status')}</span></div>
				<div class="pod-tli-flow">${pill(t.status, end_tone)}</div></div></div></div></div>`;

		// where they got to on the funnel (same steps as the top cards)
		const reached = t.reached || [];
		const steps = [this.step(__('Registered'), true)]
			.concat((t.steps || []).map(s => this.step(__(s.label), reached.includes(s.key))));
		if (t.stage === 'Not selected') steps.push(this.step(__('Not selected'), true, true));

		const d = new frappe.ui.Dialog({ title: esc(`${t.name} · ${__('Timeline')}`), size: 'extra-large' });
		d.$wrapper.find('.modal-dialog').addClass('modal-dialog-centered pod-modal-tl');
		d.$body.html(`<style>${POD_CSS}</style>
			<div class="pod-root pod-tlp">
				<div class="pod-tlp-head">
					<div class="pod-tlp-who">
						<div class="pod-tlp-avatar" style="--c:${POD_PROGRAM_COLORS[t.program] || '#64748B'}">${esc(String(t.name || '?').trim().charAt(0).toUpperCase())}</div>
						<div>
							<div class="pod-tlp-name">${esc(t.name)}
								<a class="pod-idlink" target="_blank" rel="noopener" href="/app/${esc(t.route)}/${encodeURIComponent(t.id)}">${esc(t.id)} ↗</a></div>
							<div class="pod-tlp-pills">${this.program_pill(t.program)} ${this.stage_pill(t.stage)} <span class="pod-muted">${esc(t.status)}</span></div>
						</div>
					</div>
					<button class="btn btn-default btn-xs pod-tl-detail">${__('Full details')}</button>
				</div>
				<div class="pod-tlp-stats">
					<div style="--c:#64748B"><span>${__('Started')}</span><b>${first ? esc(this.fmt_date(first)) : '—'}</b></div>
					<div style="--c:#2C5F8A"><span>${t.ended ? __('Ended') : __('Last activity')}</span><b>${last ? esc(this.fmt_date(last)) : '—'}</b></div>
					<div style="--c:#A16207"><span>${t.ended ? __('Total time') : __('In pipeline')}</span><b>${first ? __('{0} days', [this.n(span)]) : '—'}</b></div>
					<div style="--c:#0F7A8A"><span>${__('Events')}</span><b>${this.n(evs.length)}</b></div>
				</div>
				<div class="pod-journey pod-tlp-journey">${steps.join('')}</div>
				<div class="pod-tlp-filter">
					<button type="button" class="pod-tlf is-on" data-k="all">${__('All')} <span>${this.n(evs.length)}</span></button>
					${['status', 'interview', 'feedback', 'form'].map(k => `
						<button type="button" class="pod-tlf" data-k="${k}" style="--k:${KINDS[k][1]}" ${counts[k] ? '' : 'disabled'}>
							<i class="pod-dot" style="--c:${KINDS[k][1]}"></i>${esc(KINDS[k][0])} <span>${counts[k] || 0}</span></button>`).join('')}
				</div>
				<div class="pod-tlp-scroll"><div class="pod-tl2">${html}</div>
					${!counts.status ? `<div class="pod-tl-note pod-muted">${__('No status changes are recorded for this applicant yet — they are logged from now on whenever the Application Status is edited.')}</div>` : ''}
				</div>
			</div>`);
		d.$body.find('.pod-tl-detail').on('click', () => { d.hide(); this.open_candidate(t.program, t.id); });
		d.$body.find('.pod-tlp-filter').on('click', '.pod-tlf', (e) => {
			const k = String($(e.currentTarget).data('k'));
			d.$body.find('.pod-tlf').removeClass('is-on');
			$(e.currentTarget).addClass('is-on');
			const $tl = d.$body.find('.pod-tl2').toggleClass('is-filtered', k !== 'all');
			$tl.find('.pod-tli[data-kind]').each((_, el) => { $(el).toggleClass('is-hidden', k !== 'all' && $(el).data('kind') !== k); });
			$tl.find('.pod-tlg:not(.pod-tlg-end)').each((_, g) => { $(g).toggleClass('is-hidden', !$(g).find('.pod-tli:not(.is-hidden)').length); });
		});
		d.show();
	}

	step(label, done, bad = false) {
		return `<div class="pod-step ${done ? 'is-done' : ''} ${bad ? 'is-bad' : ''}">
			<div class="pod-step-dot">${done ? (bad ? '✖' : '✓') : ''}</div><div class="pod-step-label">${this.esc(label)}</div></div>`;
	}

	feedback_body_html(f) {
		const esc = (v) => this.esc(v);
		const sections = (f.sections || []).map(s => `
			<div class="pod-fb-sec">
				${s.title ? `<div class="pod-fb-sec-title">${esc(s.title)}</div>` : ''}
				<div class="pod-fb-grid">${(s.fields || []).map(x => `
					<div class="${x.long ? 'is-long' : ''}"><div class="pod-muted">${esc(x.label)}</div>
					<div class="pod-fb-val">${esc(x.value).replace(/\n/g, '<br>')}</div></div>`).join('')}
				</div>
				${(s.tables || []).map(tb => `
					<div class="pod-muted" style="margin-top:6px;">${esc(tb.label)}</div>
					<table class="pod-table pod-fb-child"><thead><tr>${tb.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
					<tbody>${tb.rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`).join('')}
			</div>`).join('');
		return `<details class="pod-fb-card">
			<summary class="pod-fb-head">
				<span><b>${esc(f.doctype)}</b> · ${esc(this.fmt_dt(f.submitted_on))} · ${__('by')} ${esc(f.by)} ${this.result_pill(f.result)}</span>
				<a target="_blank" href="/app/${esc(f.route)}/${encodeURIComponent(f.name)}">${__('Open record')} ↗</a>
			</summary>
			${sections || `<div class="pod-muted">${__('No answers filled in.')}</div>`}
		</details>`;
	}

	// ── CSV ────────────────────────────────────────────────────────────────
	// Exports exactly the rows passed in (already permission-scoped by the
	// server). Cells starting with = + - @ are prefixed with ' so a
	// spreadsheet never evaluates them as formulas.
	export_csv(name, columns, rows) {
		const cols = columns.filter(c => !c.hidden);
		const cell = (v) => {
			let s = v === null || v === undefined ? '' : String(v);
			if (/^[=+\-@]/.test(s)) s = "'" + s;
			return '"' + s.replace(/"/g, '""') + '"';
		};
		const lines = [cols.map(c => cell(c.label)).join(',')].concat(rows.map(r =>
			cols.map(c => cell(c.csv ? c.csv(r) : r[c.key])).join(',')));
		const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = String(name).replace(/[^\w\-]+/g, '_').slice(0, 80) + '.csv';
		document.body.appendChild(a);
		a.click();
		setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
	}
}

// Colours are role tokens on .pod-root, re-stepped for Frappe's dark theme
// (html[data-theme="dark"]) rather than flipped automatically.
const POD_CSS = `
.pod-root { --page:#E9EFF6; --bg:#FFFFFF; --bg-soft:#F8FAFC; --border:#DDE3EA; --border-soft:#EDF1F5; --text:#1A2B3C;
	--text-2:#3E4C59; --muted:#6B7A8A; --head:#1F3A5A; --head-2:#2C5282; --link:#1F5FA6; --hover:#F5F8FB; --grid:#E4E9EF;
	--brand:#1F4E79; --brand-2:#1F4E79; --shadow:0 1px 2px rgba(16,24,40,.04);
	color:var(--text); }
:root[data-theme="dark"] .pod-root { --page:#141619; --bg:#1C1F24; --bg-soft:#22262C; --border:#343A42; --border-soft:#2A2F36;
	--text:#E8ECF1; --text-2:#C3CBD5; --muted:#8C98A6; --head:#25364D; --head-2:#2F4A6B; --link:#8DB8E8; --hover:#23272E; --grid:#343A42;
	--brand:#5B8FC7; --brand-2:#5B8FC7; --shadow:none; }
.pod-root { padding: 18px 22px 48px; transition: opacity .15s; background:var(--page); min-height:100%; }
.modal-body .pod-root { background:transparent; }
.pod-root.pod-loading, .pod-loading .pod-root { opacity:.6; }
.modal-body .pod-root { padding: 0; }
.pod-filters { background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:12px 16px 14px; margin-bottom:16px; box-shadow:var(--shadow); }
#pod-apply { background:var(--brand); border-color:var(--brand); color:#fff; }
#pod-apply:hover { filter:brightness(1.08); }
.pod-preset.is-on { background:var(--brand); border-color:var(--brand); color:#fff; }
.pod-presets { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
.pod-preset { border:1px solid var(--border); background:var(--bg-soft); color:var(--text-2); border-radius:20px; padding:3px 12px;
	font-size:12px; font-weight:600; cursor:pointer; }
.pod-preset:hover { border-color:var(--brand); color:var(--brand); }
.pod-preset.is-on:hover { color:#fff; }
.pod-filter-row { display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; }
.pod-f { display:flex; flex-direction:column; gap:3px; }
.pod-f label { font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; margin:0; }
.pod-f input[type=date] { height:32px; border:1px solid var(--border); border-radius:8px; padding:0 8px; font-size:12.5px; background:var(--bg); color:var(--text); }
.pod-f-btns { flex-direction:row; gap:6px; margin-left:auto; }
.pod-ms { position:relative; min-width:170px; max-width:240px; }
.pod-ms-box { display:flex; flex-wrap:wrap; align-items:center; gap:4px; padding:3px 8px; border:1px solid var(--border);
	border-radius:8px; background:var(--bg); cursor:pointer; min-height:32px; }
.pod-ms.open .pod-ms-box { border-color:var(--brand); box-shadow:0 0 0 3px color-mix(in srgb, var(--brand) 18%, transparent); }
.pod-ms-ph { font-size:12.5px; color:var(--muted); }
.pod-ms-chip { display:inline-flex; align-items:center; gap:4px; background:color-mix(in srgb, var(--brand) 12%, transparent); color:var(--text-2); border-radius:6px;
	padding:1px 5px 1px 7px; font-size:11px; font-weight:600; max-width:120px; }
.pod-ms-chip .txt { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pod-ms-chip .x { cursor:pointer; opacity:.7; }
.pod-ms-more { font-size:11px; color:var(--muted); font-weight:600; }
.pod-ms-panel { display:none; position:absolute; top:calc(100% + 4px); left:0; z-index:60; background:var(--bg);
	border:1px solid var(--border); border-radius:10px; box-shadow:0 10px 24px -8px rgba(16,24,40,.25);
	width:max(100%,270px); max-width:min(360px,90vw); max-height:300px; overflow-y:auto; }
.pod-ms.open .pod-ms-panel { display:block; }
.pod-ms-search { position:sticky; top:0; background:var(--bg); padding:6px; border-bottom:1px solid var(--border-soft); }
.pod-ms-search input { width:100%; padding:5px 8px; border:1px solid var(--border); border-radius:6px; font-size:12px; background:var(--bg); color:var(--text); }
.pod-ms-actions { display:flex; justify-content:space-between; padding:5px 8px; border-bottom:1px solid var(--border-soft); font-size:11px; }
.pod-ms-actions a { color:var(--link); cursor:pointer; font-weight:600; }
.pod-ms-opt { display:flex; gap:8px; padding:6px 10px; font-size:12px; cursor:pointer; margin:0; font-weight:400; color:var(--text); }
.pod-ms-opt:hover { background:var(--hover); }
.pod-ms-empty { padding:10px; font-size:12px; color:var(--muted); text-align:center; }
/* ── cards: flat, bordered, colour only where it means something ── */
.pod-cards { margin-bottom:18px; }
.pod-headline { display:grid; grid-template-columns:repeat(6, minmax(0,1fr)); gap:12px; }
/* the rejects card sits beside the funnel, not in it: no arrow into it, red top line */
.pod-headline.is-funnel .pod-kpi:has(+ .is-aside)::after { display:none; }
/* funnel: a small chevron between steps */
.pod-headline.is-funnel { column-gap:18px; }
.pod-headline.is-funnel .pod-kpi:not(:last-child)::after { content:'›'; position:absolute; right:-14px; top:38px; width:10px;
	text-align:center; font-size:20px; line-height:1; color:var(--muted); pointer-events:none; }
.pod-kpi-value .pod-share { font-size:15px; color:var(--text-2); margin-left:8px; }
/* funnel bars */
.pod-fun { display:flex; flex-direction:column; gap:2px; }
.pod-fun-row { display:grid; grid-template-columns:150px minmax(0,1fr) 80px 120px 90px 150px; align-items:center; gap:12px;
	padding:6px 6px; border-radius:6px; font-size:12.5px; color:var(--text); }
.pod-fun-row.is-click { cursor:pointer; }
.pod-fun-row.is-click:hover, .pod-fun-row.is-click:focus-visible { background:var(--hover); outline:none; }
.pod-fun-label { font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pod-fun-track { height:18px; background:var(--border-soft); border-radius:0 4px 4px 0; overflow:hidden; }
.pod-fun-bar { height:100%; background:#2C5F8A; border-radius:0 4px 4px 0; }
:root[data-theme="dark"] .pod-fun-bar { background:#5B8FC7; }
.pod-fun-row.is-click:hover .pod-fun-bar { opacity:.85; }
.pod-fun-val { text-align:right; font-variant-numeric:tabular-nums; font-size:13px; }
.pod-fun-pct { white-space:nowrap; font-variant-numeric:tabular-nums; }
.pod-fun-pct.pod-muted { font-size:12px; }
.pod-fun-lost { font-size:11.5px; color:var(--muted); white-space:nowrap; font-variant-numeric:tabular-nums; }
@media (max-width: 900px) { .pod-fun-row { grid-template-columns:110px minmax(0,1fr) 64px; row-gap:2px; }
	.pod-fun-pct, .pod-fun-lost { grid-column:2 / -1; } .pod-fun-pct:empty, .pod-fun-lost:empty { display:none; } }
/* card names a little bigger */
.pod-root .pod-kpi-label, .pod-root .pod-tile-title { font-size:13.5px; font-weight:650; color:var(--text); }
.pod-root .pod-half-label { font-size:12.5px; color:var(--text); }
.pod-headline.is-funnel .pod-kpi::after { top:30px; }
/* unit cards at the top of a drilldown popup */
.pod-dd-units { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:8px; margin-bottom:12px; }
.pod-dd-unit { display:flex; flex-direction:column; align-items:flex-start; gap:2px; text-align:left; cursor:pointer;
	border:1px solid var(--border); border-radius:8px; background:var(--bg); padding:8px 12px; color:var(--text); }
.pod-dd-unit:hover:not(:disabled) { border-color:var(--brand); }
.pod-dd-unit.is-on { border-color:var(--brand); box-shadow:inset 0 0 0 1px var(--brand);
	background:color-mix(in srgb, var(--brand) 7%, var(--bg)); }
.pod-dd-unit:disabled { opacity:.5; cursor:default; }
.pod-dd-unit-name { font-size:12px; font-weight:600; color:var(--text-2); }
.pod-dd-unit-v { display:flex; align-items:baseline; gap:6px; }
.pod-dd-unit-v b { font-size:18px; font-variant-numeric:tabular-nums; }
.pod-dd-unit-v small { font-size:11.5px; color:var(--muted); }
.pod-fun-table td { white-space:nowrap; }
/* tabs */
.pod-tabs { display:flex; gap:2px; margin-bottom:12px; border-bottom:1px solid var(--border); }
.pod-tab { background:none; border:0; border-bottom:2px solid transparent; margin-bottom:-1px; padding:7px 16px;
	font-size:13px; font-weight:600; color:var(--muted); cursor:pointer; }
.pod-tab:hover { color:var(--text); }
.pod-tab.is-on { color:var(--brand); border-bottom-color:var(--brand); }
.pod-tab:focus-visible { outline:2px solid var(--brand); outline-offset:-2px; }
.pod-pane[hidden] { display:none !important; }
/* timeline tab: full-width list; the timeline itself opens in a popup */
/* timeline tab charts */
.pod-root { --pipe-open:#256ABF; --pipe-ended:#9EC5F4; }
:root[data-theme="dark"] .pod-root { --pipe-open:#5598E7; --pipe-ended:#2B4C78; }
.pod-tl-charts { padding:14px; border-top:1px solid var(--border-soft); transition:opacity .15s; }
.pod-tl-charts.pod-st-loading { opacity:.55; }
.pod-tl-charts:empty { display:none; }
.pod-tl-charts .pod-grid-2 { gap:12px; }
.pod-tl-kpis { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:12px; margin-bottom:12px; }
.pod-tl-kpi { border:1px solid var(--border); border-top:3px solid var(--c); border-radius:8px; padding:10px 12px; background:var(--bg);
	display:flex; flex-direction:column; gap:2px; min-width:0; }
.pod-tl-kpi.is-click { cursor:pointer; }
.pod-tl-kpi.is-click:hover, .pod-tl-kpi.is-click:focus-visible { background:var(--hover); outline:none; }
.pod-tl-kpi-top { display:flex; align-items:center; gap:6px; }
.pod-tl-kpi-top span { font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
.pod-tl-kpi b { font-size:22px; color:var(--text); font-variant-numeric:tabular-nums; letter-spacing:-.01em; }
.pod-tl-kpi small { font-size:11.5px; color:var(--muted); }
.pod-tl-chart { border:1px solid var(--border); border-radius:8px; padding:12px 14px; background:var(--bg); min-width:0; }
.pod-tl-chart-head { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:8px; }
.pod-tl-chart-title { font-size:13.5px; font-weight:700; color:var(--text); }
.pod-legend { display:flex; gap:12px; font-size:11.5px; color:var(--text-2); }
.pod-legend span { display:inline-flex; align-items:center; gap:5px; white-space:nowrap; }
.pod-legend i, .pod-legend-dot { display:inline-block; width:10px; height:10px; border-radius:2px; }
.pod-legend-dot { margin-right:5px; vertical-align:-1px; }
.pod-svg .pod-axis-v { fill:var(--text-2); font-weight:600; }
.pod-tl-stagebars .pod-bar-row { grid-template-columns:120px minmax(0,1fr) 190px; }
.pod-days { font-weight:600; font-variant-numeric:tabular-nums; }
.pod-days.is-long { color:#B7651B; }
@media (max-width: 900px) { .pod-tl-kpis { grid-template-columns:repeat(2, minmax(0,1fr)); } }
@media (max-width: 600px) { .pod-tl-stagebars .pod-bar-row { grid-template-columns:90px minmax(0,1fr); }
	.pod-tl-stagebars .pod-bar-val { grid-column:1 / -1; text-align:left; } }
/* offer update charts */
.pod-offers-head { margin:0 2px 10px; }
.pod-grid-3 { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:12px; }
.pod-tl-chart-title .pod-info { margin-left:6px; display:inline-block; vertical-align:-2px; }
.pod-offers [data-cat] { cursor:pointer; }
.pod-offers [data-cat]:hover rect:first-child { fill:var(--hover); }
.pod-donut { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
.pod-donut-svg { width:170px; height:170px; flex:none; }
.pod-donut-svg .pod-slice:hover { opacity:.85; }
.pod-donut-total { font-size:20px; font-weight:700; fill:var(--text); }
.pod-donut-legend { flex:1; min-width:150px; display:flex; flex-direction:column; gap:6px; font-size:12px; color:var(--text-2); }
.pod-donut-legend > div { display:grid; grid-template-columns:10px minmax(0,1fr) auto 42px; align-items:center; gap:8px; }
.pod-donut-legend i { width:10px; height:10px; border-radius:2px; }
.pod-donut-legend .lbl { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pod-donut-legend b { color:var(--text); font-variant-numeric:tabular-nums; }
.pod-donut-legend .pod-muted { text-align:right; }
.pod-india-svg { display:block; width:100%; max-height:420px; margin:0 auto; }
.pod-state { stroke:var(--bg); stroke-width:0.8; stroke-linejoin:round; }
.pod-state:hover { stroke:var(--text); stroke-width:1.4; }
.pod-state-n { font-size:24px; font-weight:700; fill:#1A2B3C; paint-order:stroke; stroke:rgba(255,255,255,.75); stroke-width:5px;
	pointer-events:none; font-variant-numeric:tabular-nums; }
.pod-state-n.is-dark { fill:#fff; stroke:rgba(16,40,80,.55); }
.pod-map-credit { font-size:10.5px; color:var(--muted); text-align:right; margin-top:4px; }
.pod-map-credit a { color:var(--muted); text-decoration:underline; }
.pod-tile-legend { display:flex; align-items:center; gap:3px; justify-content:center; margin-top:6px; }
.pod-tile-legend i { width:20px; height:8px; border-radius:2px; }
.pod-tile-legend span { margin:0 4px; }
@media (max-width: 1250px) { .pod-grid-3 { grid-template-columns:repeat(2, minmax(0,1fr)); } }
@media (max-width: 760px) { .pod-grid-3 { grid-template-columns:minmax(0,1fr); } }
.pod-tl-tools { display:flex; align-items:flex-end; gap:10px; flex-wrap:wrap; padding:10px 14px; border-bottom:1px solid var(--border-soft);
	background:var(--bg-soft); }
.pod-tl-tool { display:flex; flex-direction:column; gap:3px; margin:0; }
.pod-tl-tool span { font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }
.pod-tl-tool select { height:32px; min-width:170px; max-width:260px; border:1px solid var(--border); border-radius:8px; padding:0 8px;
	font-size:12.5px; background:var(--bg); color:var(--text); }
.pod-tl-tool-wide select { min-width:240px; max-width:340px; }
.pod-tl-tool select:focus { border-color:var(--brand); outline:none; box-shadow:0 0 0 3px color-mix(in srgb, var(--brand) 16%, transparent); }
.pod-tl-clear { height:32px; }
@media (max-width: 600px) { .pod-tl-tool, .pod-tl-tool select { width:100%; max-width:none; } }
.pod-tl-list .pod-cand { text-decoration:underline; text-decoration-color:color-mix(in srgb, var(--link) 35%, transparent); text-underline-offset:3px; }
.modal-dialog.pod-modal-tl { max-width:min(1040px, 94vw); width:94vw; }
.pod-tlp-head { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
.pod-tlp-who { display:flex; align-items:center; gap:12px; min-width:0; }
.pod-tlp-avatar { flex:none; width:42px; height:42px; border-radius:50%; display:grid; place-items:center; font-size:17px; font-weight:700;
	color:color-mix(in srgb, var(--c) 85%, #000); background:color-mix(in srgb, var(--c) 14%, var(--bg));
	border:1px solid color-mix(in srgb, var(--c) 35%, transparent); }
:root[data-theme="dark"] .pod-tlp-avatar { color:color-mix(in srgb, var(--c) 70%, #fff); }
.pod-tlp-name { font-size:16px; font-weight:700; color:var(--text); display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
.pod-tlp-name .pod-idlink { font-size:12.5px; }
.pod-tlp-pills { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:4px; }
.pod-tlp-stats { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:10px; }
.pod-tlp-stats > div { border:1px solid var(--border); border-top:3px solid var(--c); border-radius:8px; padding:9px 12px;
	background:color-mix(in srgb, var(--c) 4%, var(--bg)); display:flex; flex-direction:column; gap:2px; }
.pod-tlp-stats span { font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
.pod-tlp-stats b { font-size:16px; color:var(--text); font-variant-numeric:tabular-nums; }
.pod-tlp-journey { margin:16px 0 6px; }
.pod-tlp-filter { display:flex; gap:6px; flex-wrap:wrap; padding:10px 0; border-top:1px solid var(--border-soft); margin-top:8px; }
.pod-tlf { display:inline-flex; align-items:center; border:1px solid var(--border); background:var(--bg); color:var(--text-2);
	border-radius:20px; padding:3px 11px; font-size:12px; font-weight:600; cursor:pointer; }
.pod-tlf .pod-dot { width:7px; height:7px; margin-right:6px; }
.pod-tlf span { margin-left:5px; color:var(--muted); font-weight:500; font-variant-numeric:tabular-nums; }
.pod-tlf:hover:not(:disabled) { border-color:var(--k, var(--brand)); }
.pod-tlf.is-on { background:color-mix(in srgb, var(--k, var(--brand)) 12%, var(--bg)); border-color:var(--k, var(--brand)); color:var(--text); }
.pod-tlf:disabled { opacity:.45; cursor:default; }
.pod-tlp-scroll { max-height:58vh; overflow:auto; overscroll-behavior:contain; border:1px solid var(--border); border-radius:10px;
	background:var(--bg-soft); padding:16px 18px 6px; }
.pod-tlg { display:grid; grid-template-columns:86px minmax(0,1fr); gap:14px; }
.pod-tlg.is-hidden, .pod-tli.is-hidden, .pod-tl2.is-filtered .pod-tlg-gap { display:none; }
.pod-tlg-date { text-align:right; padding-top:9px; display:flex; flex-direction:column; line-height:1.25; }
.pod-tlg-date b { font-size:13.5px; color:var(--text); }
.pod-tlg-date span { font-size:11px; color:var(--muted); }
.pod-tlg-items { border-left:2px solid var(--border); padding:0 0 4px 18px; display:flex; flex-direction:column; gap:8px; }
.pod-tlg-end .pod-tlg-items { border-left-style:dashed; padding-bottom:12px; }
.pod-tli { position:relative; display:grid; grid-template-columns:40px minmax(0,1fr); gap:8px; align-items:start; }
.pod-tli::before { content:''; position:absolute; left:-25px; top:12px; width:12px; height:12px; border-radius:50%;
	background:var(--k); border:2px solid var(--bg-soft); box-shadow:0 0 0 1px var(--k); }
.pod-tli.is-future::before { background:var(--bg-soft); border:2px dashed var(--k); box-shadow:none; }
.pod-tli-time { font-size:11.5px; color:var(--muted); padding-top:10px; font-variant-numeric:tabular-nums; }
.pod-tli-card { background:var(--bg); border:1px solid var(--border); border-left:3px solid var(--k); border-radius:8px; padding:8px 12px; min-width:0; }
.pod-tli.is-cancelled .pod-tli-card { opacity:.7; }
.pod-tli-top { display:flex; align-items:center; gap:4px 8px; flex-wrap:wrap; }
.pod-tli-kind { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:color-mix(in srgb, var(--k) 85%, #000);
	background:color-mix(in srgb, var(--k) 11%, transparent); border-radius:4px; padding:1px 6px; }
:root[data-theme="dark"] .pod-tli-kind { color:color-mix(in srgb, var(--k) 65%, #fff); }
.pod-tli-title { font-size:13px; font-weight:650; color:var(--text); }
.pod-tli-top .pod-flag { margin-left:0; }
.pod-tli-flow { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:5px; }
.pod-tli-flow.is-inline { display:inline-flex; margin-top:0; }
/* tighter, calmer timeline cards */
.pod-tlg-items { gap:6px; }
.pod-tli-card { padding:7px 12px; border-color:var(--border-soft); border-left-width:3px; }
.pod-tli[data-kind="status"] .pod-tli-card { padding:6px 12px; background:var(--bg); }
.pod-tli-top { gap:4px 8px; }
.pod-tli-meta { font-size:12px; margin-top:2px; }
.pod-tli-foot { margin-top:2px; }
.pod-tli-time { padding-top:8px; }
.pod-tli::before { top:10px; }
.pod-tli-doc { margin-left:auto; font-size:11.5px; color:var(--link); white-space:nowrap; font-variant-numeric:tabular-nums; }
.pod-tli-doc:hover { text-decoration:underline; }
.pod-tli-arrow { color:var(--muted); font-size:13px; }
.pod-tli-meta { font-size:12px; color:var(--text-2); margin-top:3px; overflow-wrap:anywhere; }
.pod-tli-foot { font-size:11.5px; color:var(--muted); margin-top:4px; overflow-wrap:anywhere; }
.pod-tli-foot a { color:var(--link); }
.pod-tlg-gap { margin:6px 0 6px 100px; padding-left:18px; font-size:11px; color:var(--muted); font-style:italic; }
.pod-tl-today { position:relative; margin:8px 0 12px; text-align:center; }
.pod-tl-today::before { content:''; position:absolute; left:0; right:0; top:50%; border-top:1px dashed #A16207; }
.pod-tl-today span { position:relative; background:var(--bg-soft); padding:0 10px; font-size:11px; font-weight:700; color:#A16207;
	text-transform:uppercase; letter-spacing:.05em; }
.pod-tl-note { padding:4px 0 10px; }
.pod-detail-btns { display:flex; gap:6px; }
@media (max-width: 600px) { .pod-tlp-stats { grid-template-columns:repeat(2, minmax(0,1fr)); }
	.pod-tlg { grid-template-columns:minmax(0,1fr); gap:4px; } .pod-tlg-date { text-align:left; flex-direction:row; gap:6px; padding-top:0; }
	.pod-tlg-gap { margin-left:0; } .pod-tlp-scroll { padding:12px 10px 4px 14px; } .pod-tli { grid-template-columns:minmax(0,1fr); }
	.pod-tli-time:empty { display:none; } .pod-tli-time { padding-top:0; } }
.pod-kpi, .pod-tile { position:relative; background:var(--bg); border:1px solid var(--border); border-radius:8px;
	box-shadow:var(--shadow); min-width:0; }
.pod-kpi { padding:14px 16px 12px; display:flex; flex-direction:column; gap:6px; }
.pod-kpi.is-click, .pod-half.is-click { cursor:pointer; }
.pod-kpi.is-click:hover, .pod-kpi.is-click:focus-visible { border-color:#9FB3C8; outline:none; }
.pod-kpi.is-click:focus-visible, .pod-half.is-click:focus-visible { box-shadow:0 0 0 2px var(--brand); }
.pod-kpi-top, .pod-tile-head { display:flex; align-items:center; gap:8px; min-width:0; }
.pod-kpi-label, .pod-tile-title { font-size:12px; font-weight:600; color:var(--text-2); display:flex; align-items:center; min-width:0;
	white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pod-kpi-value { font-size:28px; font-weight:700; letter-spacing:-.02em; line-height:1.15; color:var(--text);
	font-variant-numeric:tabular-nums; }
.pod-dot { display:inline-block; flex:none; width:8px; height:8px; border-radius:50%; background:var(--c); margin-right:7px; }

/* unit breakdown under a number */
.pod-units { display:flex; flex-wrap:wrap; gap:3px 12px; margin-top:6px;
	font-size:11px; color:var(--muted); }
.pod-u { white-space:nowrap; }
.pod-u b { color:var(--text-2); font-weight:600; font-variant-numeric:tabular-nums; }
.pod-u.is-zero b { color:var(--muted); font-weight:500; }
.pod-u.is-click { cursor:pointer; border-radius:3px; }
.pod-u.is-click:hover, .pod-u.is-click:focus-visible { color:var(--link); outline:none; text-decoration:underline; }
.pod-u.is-click:hover b { color:var(--link); }
.pod-units-line { margin-top:2px; font-weight:600; color:var(--text-2); }

/* info (i) with a plain tooltip */
.pod-info { margin-left:auto; flex:none; width:16px; height:16px; border-radius:50%; border:1px solid var(--border);
	color:var(--muted); font:600 10px/14px Georgia, serif; text-align:center; font-style:italic; cursor:help; position:relative; }
.pod-info:hover, .pod-info:focus { color:var(--brand); border-color:var(--brand); outline:none; }
.pod-info::after { content:attr(data-tip); position:absolute; right:-6px; top:calc(100% + 8px); z-index:30; width:max-content; max-width:440px;
	white-space:pre-line; text-align:left; font:400 13px/1.5 var(--font-stack, system-ui, sans-serif); font-style:normal;
	color:#F0F4F8; background:#1A2B3C; border-radius:8px; padding:12px 14px; box-shadow:0 6px 18px rgba(16,24,40,.25);
	opacity:0; visibility:hidden; transition:opacity .12s; pointer-events:none; }
.pod-info:hover::after, .pod-info:focus::after { opacity:1; visibility:visible; }

/* hiring-pipeline board */
.pod-range { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.pod-range-presets { display:flex; gap:6px; flex-wrap:wrap; }
.pod-range-f { display:flex; align-items:center; gap:6px; margin:0; font-size:11px; font-weight:700; color:var(--muted);
	text-transform:uppercase; letter-spacing:.04em; }
.pod-range-f input { height:30px; border:1px solid var(--border); border-radius:6px; padding:0 8px; font-size:12.5px;
	background:var(--bg); color:var(--text); text-transform:none; letter-spacing:0; font-weight:400; }
.pod-range-f input:focus { border-color:var(--brand); outline:none; box-shadow:0 0 0 3px color-mix(in srgb, var(--brand) 16%, transparent); }
.pod-topbar { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px; }
.pod-topbar .pod-presets { margin-bottom:0; }
.pod-topbar-right { display:flex; align-items:center; gap:14px; flex-wrap:wrap; font-size:12px; }
.pod-topbar-right b { color:var(--text); font-variant-numeric:tabular-nums; }
/* wider popups: drilldowns, candidate detail, card guide */
.modal-dialog.pod-modal-wide { max-width:min(1500px, 94vw); width:94vw; }
.pod-board-title { font-size:15px; font-weight:700; color:var(--text); }
.pod-board { display:flex; flex-direction:column; gap:16px; margin-bottom:18px; }
.pod-bgroup { min-width:0; }
.pod-group-title { font-size:11px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:var(--muted);
	margin:0 2px 8px; }
.pod-row { display:grid; grid-template-columns:repeat(var(--cols), minmax(0,1fr)); gap:12px; }
.pod-row + .pod-row { margin-top:12px; }
.pod-tile { padding:12px 14px 12px; display:flex; flex-direction:column; gap:6px; }
.pod-halves { display:flex; align-items:stretch; gap:24px; }
.pod-half { flex:1; min-width:0; border-radius:6px; padding:4px 6px; margin:-4px -6px; }
.pod-half.is-click:hover { background:var(--hover); }
.pod-half-label { display:flex; align-items:center; gap:0; font-size:11.5px; font-weight:600; color:var(--text-2);
	white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pod-half-value { font-size:26px; font-weight:700; letter-spacing:-.02em; line-height:1.2; color:var(--text);
	font-variant-numeric:tabular-nums; display:flex; align-items:baseline; gap:8px; }
.pod-share { font-size:12px; font-weight:600; color:var(--muted); letter-spacing:0; }
.pod-half.is-flag .pod-half-value { color:var(--c); }
.pod-half.is-na .pod-half-value { color:var(--muted); }
.pod-half-hint { font-size:11px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-height:15px; }
.pod-flag { margin-left:8px; flex:none; font-size:10px; font-weight:700; letter-spacing:.03em; text-transform:uppercase; color:var(--c);
	border:1px solid color-mix(in srgb, var(--c) 45%, transparent); border-radius:3px; padding:0 5px; line-height:15px; }
.pod-red { color:#B83232; }
.pod-chips { display:flex; flex-wrap:wrap; gap:6px; }
.pod-history { border-left:2px solid var(--border); margin-left:6px; padding-left:14px; display:flex; flex-direction:column; gap:10px; }
.pod-hist-row { position:relative; font-size:12.5px; color:var(--text); }
.pod-hist-dot { position:absolute; left:-21px; top:4px; width:10px; height:10px; border-radius:50%; background:var(--brand); border:2px solid var(--bg); }
.pod-guide-sec { font-size:11px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:var(--muted);
	margin:16px 0 4px; padding-bottom:4px; border-bottom:1px solid var(--border); }
.pod-guide-row { display:grid; grid-template-columns:200px minmax(0,1fr); gap:12px; padding:7px 0; border-bottom:1px solid var(--border-soft);
	font-size:12.5px; color:var(--text-2); }
.pod-guide-row b { color:var(--text); display:flex; align-items:center; }
@media (max-width: 1250px) { .pod-headline { grid-template-columns:repeat(3, minmax(0,1fr)); }
	.pod-headline.is-funnel .pod-kpi:nth-child(3n)::after { display:none; }
	.pod-row { grid-template-columns:repeat(auto-fill, minmax(200px,1fr)); } }
@media (max-width: 600px) { .pod-row { grid-template-columns:minmax(0,1fr); } .pod-tile { grid-column:auto !important; }
	.pod-headline { grid-template-columns:minmax(0,1fr); } .pod-headline.is-funnel .pod-kpi::after { display:none; }
	.pod-guide-row { grid-template-columns:minmax(0,1fr); gap:2px; } .pod-info::after { max-width:240px; } }
.pod-grid-2 { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:14px; }
.pod-panel { background:var(--bg); border:1px solid var(--border); border-radius:10px; margin-bottom:16px; overflow:hidden; min-width:0; box-shadow:var(--shadow); }
.pod-panel-head { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;
	padding:11px 14px; border-bottom:1px solid var(--border-soft); }
.pod-panel-title { font-size:14px; font-weight:750; color:var(--text); display:flex; align-items:center; gap:8px; }
.pod-panel-sub { font-size:11.5px; color:var(--muted); }
.pod-panel-tools { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
.pod-panel-body { padding:12px 14px; }
.pod-search { height:28px; border:1px solid var(--border); border-radius:7px; padding:0 9px; font-size:12px; width:220px; background:var(--bg); color:var(--text); }
.pod-bar-row { display:grid; grid-template-columns:130px minmax(0,1fr) 110px; align-items:center; gap:10px; padding:7px 4px; border-radius:8px; }
.pod-bar-row.is-click { cursor:pointer; }
.pod-bar-row.is-click:hover { background:var(--hover); }
.pod-bar-label { font-size:12.5px; font-weight:600; color:var(--text); white-space:nowrap; }
.pod-bar-track { height:14px; background:var(--border-soft); border-radius:0 4px 4px 0; overflow:hidden; }
.pod-bar { height:100%; background:var(--c); border-radius:0 4px 4px 0; }
.pod-bar-val { font-size:12.5px; text-align:right; color:var(--text); white-space:nowrap; }
.pod-dot { display:inline-block; width:9px; height:9px; border-radius:50%; background:var(--c); margin-right:7px; }
.pod-svg { width:100%; height:auto; max-height:280px; display:block; margin:0 auto; }
.pod-svg .pod-grid { stroke:var(--grid); stroke-width:1; }
.pod-svg .pod-axis { fill:var(--muted); font-size:10.5px; }
.pod-svg .pod-tbar { cursor:pointer; }
.pod-svg .pod-tbar:hover path { opacity:.8; }
.pod-tip { display:none; position:fixed; z-index:1100; pointer-events:none; background:var(--bg); color:var(--text); border:1px solid var(--border);
	box-shadow:0 8px 20px rgba(15,23,42,.18); border-radius:8px; padding:6px 10px; font-size:12px; }
.pod-table-scroll { max-height:520px; overflow:auto; }
.pod-table-scroll.pod-short { max-height:360px; }
.pod-dd-scroll { max-height:72vh; overflow:auto; border:1px solid var(--border); border-radius:8px; overscroll-behavior:contain; }
.pod-table { width:100%; border-collapse:collapse; font-size:12.5px; color:var(--text); }
.pod-table th { position:sticky; top:0; z-index:2; background:var(--head); color:#fff; text-align:left; font-weight:600;
	padding:8px 10px; white-space:nowrap; cursor:pointer; user-select:none; font-size:11.5px; }
.pod-table th.is-sorted { background:var(--head-2); }
.pod-sort { opacity:.6; font-size:9px; margin-left:3px; }
.pod-table td { padding:7px 10px; border-bottom:1px solid var(--border-soft); vertical-align:top; }
.pod-table td.nw { white-space:nowrap; }
.pod-table tbody tr:hover td { background:var(--hover); }
.pod-pill { display:inline-block; border:1px solid color-mix(in srgb, var(--c) 45%, transparent); color:color-mix(in srgb, var(--c) 80%, #000);
	background:color-mix(in srgb, var(--c) 10%, transparent); border-radius:20px; padding:1px 8px; font-size:10.5px; font-weight:700; white-space:nowrap; }
:root[data-theme="dark"] .pod-pill { color:color-mix(in srgb, var(--c) 70%, #fff); }
.pod-cand { font-weight:600; cursor:pointer; color:var(--link); }
.pod-idlink { font-weight:600; color:var(--link); white-space:nowrap; font-variant-numeric:tabular-nums; }
.pod-idlink:hover { text-decoration:underline; }
.pod-muted { color:var(--muted); font-size:11px; }
.pod-num { font-weight:700; cursor:pointer; color:var(--link); }
.pod-num.is-red { color:#d03b3b; }
.pod-zero { color:var(--muted); opacity:.6; }
.pod-empty { padding:24px; text-align:center; color:var(--muted); font-size:13px; }
.pod-dd-bar { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:8px; }
.pod-dd-tools { display:flex; gap:6px; align-items:center; }
.pod-detail-top { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; }
.pod-sec { font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.07em; margin:16px 0 6px; }
.pod-journey { display:flex; gap:0; overflow-x:auto; padding:4px 2px; }
.pod-step { flex:1; min-width:110px; position:relative; text-align:center; }
.pod-step::before { content:''; position:absolute; top:13px; left:-50%; width:100%; height:3px; background:var(--border); z-index:0; }
.pod-step:first-child::before { display:none; }
.pod-step.is-done::before { background:#0ca30c; }
.pod-step-dot { position:relative; z-index:1; width:28px; height:28px; margin:0 auto 4px; border-radius:50%; background:var(--bg);
	border:3px solid var(--border); color:#fff; font-size:13px; font-weight:800; line-height:22px; }
.pod-step.is-done .pod-step-dot { background:#0ca30c; border-color:#0ca30c; }
.pod-step.is-bad .pod-step-dot { background:#d03b3b; border-color:#d03b3b; }
.pod-step-label { font-size:11.5px; font-weight:600; color:var(--text-2); }
.pod-profile { display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:8px 16px;
	background:var(--bg-soft); border:1px solid var(--border); border-radius:10px; padding:12px 14px; max-height:300px; overflow:auto; }
.pod-pv { font-size:13px; font-weight:600; color:var(--text); overflow-wrap:anywhere; }
.pod-pdfs { display:flex; flex-wrap:wrap; gap:8px; }
.pod-pdf { border:1px solid rgba(42,120,214,.35); background:rgba(42,120,214,.08); color:var(--link); border-radius:8px; padding:5px 10px; font-size:12px; font-weight:600; }
.pod-ivs { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:8px; }
.pod-iv { border:1px solid var(--border); border-left:4px solid #2a78d6; border-radius:8px; padding:8px 10px; background:var(--bg); }
.pod-iv.is-cancelled { border-left-color:var(--muted); opacity:.65; }
.pod-iv-round { font-size:12.5px; font-weight:700; color:var(--text); }
.pod-fb-card { border:1px solid var(--border); border-radius:10px; background:var(--bg); padding:8px 14px; margin-bottom:8px; }
.pod-fb-card[open] { padding-bottom:12px; }
.pod-fb-head { display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center; font-size:12.5px; cursor:pointer; }
.pod-fb-card[open] .pod-fb-head { border-bottom:1px solid var(--border-soft); padding-bottom:7px; margin-bottom:6px; }
.pod-fb-sec-title { font-size:11px; font-weight:700; color:var(--link); text-transform:uppercase; letter-spacing:.05em; margin:8px 0 4px; }
.pod-fb-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:6px 16px; }
.pod-fb-grid > .is-long { grid-column:1 / -1; }
.pod-fb-val { font-size:12.5px; color:var(--text); font-weight:500; overflow-wrap:anywhere; }
.pod-fb-child th { position:static; cursor:default; }
.pod-st-bar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:8px 14px; border-bottom:1px solid var(--border-soft); }
.modal-body .pod-st-bar { padding:0 0 8px; border:0; }
.pod-st-info { flex:1; font-size:11.5px; }
/* search box: bigger, icon, widens + glows on focus, spinner while loading */
.pod-sbox { position:relative; display:flex; align-items:center; margin:0; width:380px; max-width:100%;
	transition:width .25s ease; }
.pod-sbox:focus-within { width:500px; }
.pod-sbox-sm { width:260px; } .pod-sbox-sm:focus-within { width:340px; }
.pod-sbox input { width:100%; height:38px; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--text);
	padding:0 12px 0 38px; font-size:13.5px; outline:none;
	transition:border-color .2s ease, box-shadow .2s ease, background-color .2s ease; }
.pod-sbox input::placeholder { color:var(--muted); }
.pod-sbox input:hover { border-color:#B8C4D0; }
.pod-sbox input:focus { border-color:var(--brand); box-shadow:0 0 0 3px color-mix(in srgb, var(--brand) 16%, transparent); }
.pod-sbox-ic { position:absolute; left:12px; width:16px; height:16px; color:var(--muted); pointer-events:none;
	transition:color .2s ease, transform .2s ease; }
.pod-sbox:focus-within .pod-sbox-ic { color:var(--brand); transform:scale(1.1); }
.pod-sbox-glass { width:16px; height:16px; display:block; transition:opacity .15s ease; }
.pod-sbox-spin { position:absolute; inset:0; border:2px solid color-mix(in srgb, var(--brand) 25%, transparent);
	border-top-color:var(--brand); border-radius:50%; opacity:0; transition:opacity .15s ease; }
.pod-st-loading .pod-sbox-glass { opacity:0; }
.pod-st-loading .pod-sbox-spin { opacity:1; animation:pod-spin .7s linear infinite; }
@keyframes pod-spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .pod-sbox, .pod-sbox input, .pod-sbox-ic { transition:none; }
	.pod-st-loading .pod-sbox-spin { animation:none; } }
@media (max-width: 600px) { .pod-sbox, .pod-sbox:focus-within { width:100%; } }
.pod-st-tools { display:flex; gap:6px; }
.pod-st-pager { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; padding:8px 14px;
	border-top:1px solid var(--border-soft); font-size:12px; color:var(--text-2); }
.modal-body .pod-st-pager { padding:8px 0 0; border:0; }
.pod-st-nav { display:flex; align-items:center; gap:4px; }
.pod-st-page { width:72px; height:26px; border:1px solid var(--border); border-radius:6px; padding:0 6px; font-size:12px; background:var(--bg); color:var(--text); }
.pod-st-size select { height:26px; border:1px solid var(--border); border-radius:6px; font-size:12px; background:var(--bg); color:var(--text); margin-left:4px; }
.pod-st-loading .pod-st-body { opacity:.5; pointer-events:none; }
@media (max-width: 1000px) { .pod-grid-2 { grid-template-columns:minmax(0,1fr); } }
@media (max-width: 900px) { .pod-f-btns { margin-left:0; } }
@media (max-width: 600px) { .pod-root { padding:12px 10px 40px; } .pod-search { width:100%; } .pod-ms { max-width:none; width:100%; }
	.pod-f { width:100%; } .pod-bar-row { grid-template-columns:100px minmax(0,1fr) 80px; } }

/* ── every card the same size ──
   The board uses the top row's grid (6 equal columns, same gaps), so a
   single card is exactly as wide as a top-row card and a pair exactly two;
   rows no longer stretch to fill the width. All cards share one height and
   the number sits at the bottom, so numbers line up across a row. */
.pod-row { grid-template-columns:repeat(6, minmax(0,1fr)); column-gap:18px; row-gap:12px; }
/* card size: roomy padding, large numbers, one short grey line under each */
.pod-kpi, .pod-tile { min-height:116px; padding:14px 18px; gap:5px; }
.pod-root .pod-kpi-label, .pod-root .pod-tile-title { font-size:14px; }
.pod-root .pod-half-label { font-size:13px; overflow:visible; }
.pod-half-label .pod-flag { margin-left:6px; padding:0 4px; }
.pod-kpi-value { font-size:28px; line-height:1.15; }
.pod-half-value { font-size:26px; line-height:1.15; }
.pod-kpi-value .pod-share, .pod-half-value .pod-share { font-size:13px; }
.pod-kpi-sub, .pod-half-hint { font-size:12px; color:var(--muted); min-height:16px; line-height:16px;
	white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pod-half-label { margin-bottom:1px; }
.pod-headline.is-funnel .pod-kpi::after { top:44px; }
.pod-kpi-value { margin-top:auto; }
.pod-tile .pod-halves { margin-top:auto; }
@media (max-width: 1250px) { .pod-row { grid-template-columns:repeat(3, minmax(0,1fr)); } }
@media (max-width: 600px) { .pod-row { grid-template-columns:minmax(0,1fr); } }

/* ── full width on every Frappe version: v15 caps the page body at ~1,260 px
   (v16 already uses the full width), which squeezed the cards ── */
#page-pathways-overall-dashboard .page-body.container,
#page-pathways-overall-dashboard .page-head .container { max-width:none !important; width:100% !important; }
/* columns follow the space the dashboard actually gets (sidebar open, v15's
   narrower page, small laptops), not the screen width: 6 per row when wide,
   3 below ~1,200 px, 1 on a phone. The container is each tab pane (not
   .pod-root), so the fixed-position hover tooltip keeps working. */
.pod-pane { container-type:inline-size; container-name:podpane; }
@container podpane (max-width: 1200px) {
	.pod-headline { grid-template-columns:repeat(3, minmax(0,1fr)); }
	.pod-headline.is-funnel .pod-kpi:nth-child(3n)::after,
	.pod-headline.is-funnel .pod-kpi:has(+ .is-aside)::after { display:none; }
	.pod-row { grid-template-columns:repeat(3, minmax(0,1fr)); }
}
@container podpane (max-width: 560px) {
	.pod-headline, .pod-row { grid-template-columns:minmax(0,1fr); }
	.pod-tile { grid-column:auto !important; }
	.pod-headline.is-funnel .pod-kpi::after { display:none !important; }
}
.pod-kpi-value, .pod-half-value { flex-wrap:wrap; row-gap:2px; }
/* card names and the grey line wrap onto a second line instead of being cut */
.pod-root .pod-kpi-label, .pod-root .pod-tile-title { white-space:normal; overflow:visible; text-overflow:clip; line-height:1.25; }
.pod-kpi-sub, .pod-half-hint { white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }

/* ── whole-page finish ── */
/* the page background reaches the bottom of the screen on short tabs */
.pod-root { min-height:calc(100vh - 60px); }
/* filters: one even grid (one row on a wide screen, wrapping evenly when narrower) */
.pod-filter-row { display:grid; grid-template-columns:repeat(auto-fit, minmax(132px, 1fr)); gap:10px; align-items:end; }
.pod-filter-row .pod-f { min-width:0; width:auto; }
.pod-filter-row .pod-ms { min-width:0; max-width:none; width:100%; }
.pod-filter-row .pod-f input[type=date] { width:100%; min-width:0; }
.pod-filter-row .pod-f-btns { margin-left:0; justify-content:flex-end; flex-direction:row; }
.pod-topbar-right .btn { white-space:nowrap; }
/* tables: one line per row; long text is shortened and shown in full on hover */
.pod-table:not(.pod-fb-child) td { white-space:nowrap; max-width:260px; overflow:hidden; text-overflow:ellipsis; }
.pod-table:not(.pod-fb-child) tbody tr { height:38px; }
/* India map: sized to sit level with the charts beside it */
.pod-india-svg { max-height:250px; }

/* ── card polish: soft corners and shadow, % as a quiet pill ── */
.pod-kpi, .pod-tile { border-radius:12px; border-color:#E1E7EE; box-shadow:0 1px 2px rgba(16,24,40,.05), 0 1px 1px rgba(16,24,40,.03); }
:root[data-theme="dark"] .pod-kpi, :root[data-theme="dark"] .pod-tile { border-color:var(--border); box-shadow:none; }
.pod-root .pod-kpi-label, .pod-root .pod-tile-title { color:var(--text-2); font-weight:600; letter-spacing:.005em; }
.pod-kpi-value, .pod-half-value { font-weight:750; letter-spacing:-.025em; display:flex; align-items:center; gap:8px; }
.pod-kpi-value .pod-share, .pod-half-value .pod-share { display:inline-block; font-size:12px; font-weight:600; letter-spacing:0;
	color:var(--text-2); background:var(--bg-soft); border:1px solid var(--border-soft); border-radius:999px; padding:1px 8px; line-height:18px; }
.pod-half.is-click:hover { background:var(--bg-soft); }

/* ── card finish: one number size everywhere, divider in pair cards,
   section headings with a hairline, quiet zeros ── */
.pod-root .pod-kpi-label, .pod-root .pod-tile-title { color:var(--text); font-weight:600; }
.pod-kpi-value, .pod-half-value { font-size:28px; }
.pod-tile.is-pair .pod-halves { gap:0; }
.pod-tile.is-pair .pod-half { margin:-4px 0; padding:4px 14px 4px 0; border-radius:6px; }
.pod-tile.is-pair .pod-half + .pod-half { border-left:1px solid var(--border-soft); padding-left:18px; border-radius:0 6px 6px 0; }
.pod-group-title { display:flex; align-items:center; gap:10px; margin:6px 2px 10px; }
.pod-group-title::after { content:''; flex:1; height:1px; background:var(--border); }
.pod-count.is-zero { color:var(--muted); font-weight:600; }
.pod-half.is-flag .pod-count.is-zero { color:var(--muted); }
.pod-kpi:focus-visible, .pod-half.is-click:focus-visible { outline:2px solid var(--brand); outline-offset:2px; }

/* ── motion: subtle, quick, and off for anyone who prefers reduced motion ── */
@keyframes pod-rise { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
@keyframes pod-fade { from { opacity:0; } to { opacity:1; } }
@keyframes pod-grow-x { from { transform:scaleX(0); } to { transform:scaleX(1); } }
@keyframes pod-grow-y { from { transform:scaleY(0); } to { transform:scaleY(1); } }
/* cards rise in one after another */
.pod-kpi, .pod-tile { animation:pod-rise .45s cubic-bezier(.2,.7,.2,1) both; animation-delay:calc(var(--i, 0) * 45ms); }
/* clickable cards lift a little on hover */
.pod-kpi, .pod-tile { transition:transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
.pod-kpi.is-click:hover, .pod-tile:has(.pod-half.is-click):hover { transform:translateY(-3px);
	box-shadow:0 10px 22px -12px rgba(16,24,40,.35); border-color:#B8C7D6; }
.pod-half { transition:background-color .15s ease; }
/* bars grow from the left, chart columns rise from the baseline */
.pod-fun-bar, .pod-bar { transform-origin:left center; animation:pod-grow-x .7s cubic-bezier(.2,.7,.2,1) both; }
.pod-svg .pod-tbar path { transform-box:fill-box; transform-origin:bottom; animation:pod-grow-y .6s cubic-bezier(.2,.7,.2,1) both; }
.pod-svg .pod-tbar:nth-child(n+2) path { animation-delay:.05s; }
.pod-svg .pod-tbar:nth-child(n+4) path { animation-delay:.1s; }
.pod-svg .pod-tbar:nth-child(n+6) path { animation-delay:.15s; }
.pod-svg circle { animation:pod-fade .5s ease .3s both; }
.pod-donut-svg, .pod-india-svg, .pod-donut-legend, .pod-tl-kpi { animation:pod-fade .5s ease both; }
/* switching tabs fades the content in */
.pod-pane:not([hidden]) { animation:pod-fade .25s ease both; }
/* popups: unit cards fade in */
.pod-dd-unit { animation:pod-rise .35s cubic-bezier(.2,.7,.2,1) both; }
@media (prefers-reduced-motion: reduce) {
	.pod-root *, .pod-root *::before, .pod-root *::after { animation:none !important; transition:none !important; }
	.pod-kpi.is-click:hover, .pod-tile:hover { transform:none; }
}

/* ── Analytics tab ── */
/* categorical slots (validated, light + dark steps): who a step waits on, and gender */
.pod-root { --an-hr:#2A78D6; --an-unit:#1BAF7A; --an-appr:#EDA100; --an-cand:#6250D6;
	--an-f:#6250D6; --an-m:#1BAF7A; --an-o:#EDA100; --an-down:#B83232; }
:root[data-theme="dark"] .pod-root { --an-hr:#3987E5; --an-unit:#199E70; --an-appr:#C98500; --an-cand:#9085E9;
	--an-f:#9085E9; --an-m:#199E70; --an-o:#C98500; --an-down:#E66767; }
.pod-an { transition:opacity .15s; }
.pod-an.pod-st-loading { opacity:.55; pointer-events:none; }
.pod-an > .pod-tl-chart, .pod-an > .pod-grid-2, .pod-an > .pod-grid-3, .pod-an > .pod-tl-kpis { margin-bottom:12px; }
.pod-an .pod-grid-2, .pod-an .pod-grid-3 { gap:12px; }
.pod-an .pod-group-title { margin:20px 2px 2px; }
.pod-an-head { font-size:12px; color:var(--muted); margin:0 2px 2px; }
.pod-an-lead { font-size:12.5px; color:var(--text-2); margin:0 2px 10px; }
.pod-an-review { background:var(--bg); border:1px solid var(--border); border-radius:8px; margin:4px 0 6px; }
.pod-an-review > summary { cursor:pointer; padding:10px 14px; font-size:13px; font-weight:650; color:var(--text); }
.pod-an-review[open] > summary { border-bottom:1px solid var(--border-soft); }
.pod-an-review .pod-table td { white-space:normal !important; max-width:none !important; vertical-align:middle; }
.pod-an-goto { cursor:pointer; color:var(--link); }
.pod-an-st { display:inline-block; padding:1px 8px; border-radius:999px; font-size:11px; font-weight:600; border:1px solid var(--border); white-space:nowrap; }
.pod-an-st.is-done { color:#2F7D4F; border-color:#B9DCC6; background:#F1F8F3; }
.pod-an-st.is-new { color:#1F5FA6; border-color:#BCD3EE; background:#F1F6FC; }
.pod-an-st.is-data, .pod-an-st.is-review { color:#9A5A12; border-color:#EBD3B2; background:#FCF6EE; }
.pod-an-st.is-free { color:#5B4BA0; border-color:#D5CFEE; background:#F6F4FC; }
.pod-an-tips { margin:4px 0 0; padding-left:18px; font-size:13px; line-height:1.6; color:var(--text); }
.pod-an-up { color:#2F7D4F; font-weight:600; } .pod-an-down { color:#B83232; font-weight:600; }
.pod-an-note { font-size:12px; margin:8px 2px 0; }
.pod-an-words { display:flex; flex-wrap:wrap; gap:6px; }
.pod-an-word { border:1px solid var(--border); border-radius:999px; padding:2px 9px; font-size:12px; color:var(--text-2); background:var(--bg); }
.pod-an-word b { color:var(--text); margin-left:2px; font-variant-numeric:tabular-nums; }
.pod-an-bars .pod-bar-row { grid-template-columns:minmax(110px, 36%) minmax(0,1fr) auto; padding:5px 4px; }
.pod-an-bars .pod-bar-label { overflow:hidden; text-overflow:ellipsis; }
.pod-an-bars .pod-bar-val { font-variant-numeric:tabular-nums; }
.pod-an-bars .pod-bar-val .pod-muted { font-size:11.5px; }
.pod-an .pod-bar-row:focus-visible, .pod-an-cell:focus-visible, .pod-an-num:focus-visible { outline:2px solid var(--brand); outline-offset:-2px; }
/* conversion / time tables: the number, then its small % */
.pod-an-conv td b { font-variant-numeric:tabular-nums; }
.pod-an-conv td small { margin-left:6px; font-size:11px; opacity:.85; }
.pod-an-conv tr.is-total td { font-weight:600; border-bottom:2px solid var(--border); }
.pod-an-cell.is-click { cursor:pointer; }
.pod-an-cell.is-click:hover { box-shadow:inset 0 0 0 2px var(--brand); }
.pod-an-ramp { display:flex; flex-wrap:wrap; align-items:center; gap:4px 6px; margin-top:8px; }
.pod-an-ramp i { display:inline-block; width:14px; height:10px; border-radius:2px; border:1px solid var(--border-soft); }
.pod-an-heat th, .pod-an-heat td { text-align:center; }
.pod-an-heat th:first-child, .pod-an-heat td:first-child { text-align:left; }
.pod-an-hcell { font-size:11.5px; min-width:46px; font-variant-numeric:tabular-nums; }
.pod-an-num { color:var(--link); cursor:pointer; font-weight:600; font-variant-numeric:tabular-nums; }
.pod-an-num:hover { text-decoration:underline; color:var(--link); }
.pod-an-inbar { display:inline-block; width:56px; height:6px; margin-right:8px; vertical-align:middle; overflow:hidden;
	background:var(--border-soft); border-radius:0 3px 3px 0; }
.pod-an-inbar i { display:block; height:100%; background:var(--pipe-open); border-radius:0 3px 3px 0; }
.pod-an-inbar.is-low i { background:#B7651B; }
.pod-an-down { color:var(--an-down); }
/* one 100% bar split into parts (2px surface gaps) */
.pod-an-stack { display:flex; gap:2px; height:16px; min-width:0; overflow:hidden; border-radius:0 4px 4px 0; }
.pod-an-stack.is-empty { background:var(--border-soft); }
.pod-an-stack span { display:block; min-width:2px; }
.pod-an-grow { display:grid; grid-template-columns:130px minmax(0,1fr) 92px; align-items:center; gap:10px; padding:6px 2px; }
.pod-an-glabel { font-size:12.5px; font-weight:600; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pod-an-gval { font-size:12.5px; text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
.pod-an-ownlist { display:grid; gap:7px; margin-top:14px; }
.pod-an-ownlist div { display:grid; grid-template-columns:12px minmax(0,1fr) auto minmax(110px, auto); gap:8px; align-items:center; font-size:12.5px; }
.pod-an-ownlist i { width:10px; height:10px; border-radius:2px; }
.pod-an-ownlist .pod-muted { text-align:right; font-size:11.5px; }
.pod-an-tools { margin-bottom:8px; }
.pod-an-tools input { width:min(340px, 100%); height:30px; border:1px solid var(--border); border-radius:8px; padding:0 10px;
	font-size:12.5px; background:var(--bg); color:var(--text); }
.pod-an-toggle { display:flex; align-items:center; gap:6px; margin:0; font-size:12px; font-weight:600; color:var(--text-2); cursor:pointer; }
@media (max-width: 600px) {
	.pod-an-grow { grid-template-columns:90px minmax(0,1fr); }
	.pod-an-gval { grid-column:1 / -1; text-align:left; }
	.pod-an-bars .pod-bar-row { grid-template-columns:minmax(80px, 40%) minmax(0,1fr); }
	.pod-an-bars .pod-bar-val { grid-column:1 / -1; text-align:left; }
}
/* Top row = 5 cards (2026-11-24); the picked card filters the board below. */
.pod-headline.is-five { grid-template-columns:repeat(5, minmax(0,1fr)); }
.pod-headline.is-six { grid-template-columns:repeat(6, minmax(0,1fr)); }
.pod-tl-cards { margin-bottom:14px; }
.pod-headline.is-six .pod-kpi.is-on { border-color:var(--c); box-shadow:inset 0 3px 0 var(--c); }
.pod-headline.is-five .pod-kpi.is-on { border-color:var(--c); box-shadow:inset 0 3px 0 var(--c); }
.pod-view-bar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:10px 14px; background:var(--bg);
	border:1px solid var(--border); border-radius:8px; }
.pod-view-title { font-size:14px; font-weight:650; color:var(--text); }
.pod-view-n { font-size:13px; color:var(--text-2); font-variant-numeric:tabular-nums; margin-right:auto; }
/* Reject view: step cards + step × unit table. */
.pod-rej-grid { display:grid; grid-template-columns:repeat(var(--cols, 5), minmax(0,1fr)); gap:12px; }
.pod-rej { min-height:108px; }
.pod-rej.is-click { cursor:pointer; }
.pod-rej.is-click:hover, .pod-rej.is-click:focus-visible { border-color:#9FB3C8; outline:none; }
.pod-rej.is-empty .pod-half-value, .pod-rej.is-empty .pod-tile-title { color:var(--muted); }
.pod-rej .pod-tile-head { min-height:36px; align-items:flex-start; }
.pod-rej .pod-tile-head .pod-tile-title { line-height:18px; }
.pod-rej .pod-half-value { margin-top:2px; }
.pod-rej .pod-half-hint { line-height:16px; min-height:16px; white-space:normal; }
.pod-rej-step { display:inline-flex; align-items:center; justify-content:center; min-width:24px; height:20px; padding:0 5px;
	margin-right:8px; border-radius:4px; background:var(--bg-soft); border:1px solid var(--border); color:var(--muted);
	font-size:11px; font-weight:600; font-variant-numeric:tabular-nums; }
.pod-rej-table-wrap { background:var(--bg); border:1px solid var(--border); border-radius:8px; overflow:auto; }
.pod-rej-table th.is-num, .pod-rej-table td.is-num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
.pod-rej-table td { vertical-align:middle; padding:8px 12px; }
.pod-rej-table th { padding:9px 12px; }
.pod-rej-table tr.is-zero-row td { color:var(--muted); }
.pod-rej-table tfoot td { font-weight:700; background:var(--bg-soft); border-top:1px solid var(--border); border-bottom:0; }
.pod-rej-table .pod-num { color:var(--link); }
.pod-src-table td { vertical-align:top; white-space:normal !important; max-width:none !important; overflow:visible !important;
	text-overflow:clip !important; }
.pod-src-table td.nw { white-space:nowrap !important; }
.pod-src-table td.pod-src-card { min-width:220px; background:var(--bg-soft); border-right:1px solid var(--border-soft); }
.pod-src-table td.pod-src-card .pod-muted { font-size:12px; margin:2px 0 0 32px; }
.pod-src-table code { font-size:11.5px; color:var(--text-2); background:var(--bg-soft); padding:1px 5px; border-radius:4px; }
.pod-src-chip { display:inline-block; margin:0 6px 4px 0; padding:2px 8px; border:1px solid var(--border); border-radius:999px;
	font-size:12px; color:var(--text-2); background:var(--bg); white-space:nowrap; }
.pod-src-chip b { color:var(--text); font-variant-numeric:tabular-nums; margin-left:2px; }
.pod-src-chip.is-zero { color:var(--muted); border-style:dashed; }
/* Ask AI side panel */
.pod-ai { position:fixed; top:64px; right:16px; bottom:16px; width:min(440px, calc(100vw - 32px)); z-index:1030;
	display:flex; flex-direction:column; background:var(--bg); border:1px solid var(--border); border-radius:10px;
	box-shadow:0 8px 28px rgba(16,24,40,.16); }
.pod-ai[hidden] { display:none; }
.pod-ai-head { display:flex; align-items:flex-start; gap:8px; padding:12px 14px; border-bottom:1px solid var(--border-soft); }
.pod-ai-head > div { flex:1; min-width:0; }
.pod-ai-title { font-size:15px; font-weight:700; color:var(--text); }
.pod-ai-sub { font-size:11.5px; color:var(--muted); line-height:15px; margin-top:2px; }
.pod-ai-log { flex:1; overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:10px; background:var(--bg-soft); }
.pod-ai-msg { max-width:92%; padding:9px 12px; border-radius:10px; font-size:13px; line-height:1.5; color:var(--text);
	overflow-wrap:anywhere; }
.pod-ai-msg.is-user { align-self:flex-end; background:var(--head); color:#fff; white-space:pre-wrap; }
.pod-ai-msg.is-ai { align-self:flex-start; background:var(--bg); border:1px solid var(--border); }
.pod-ai-msg.is-error { border-color:#E8B4B4; color:#8A2C2C; }
.pod-ai-msg.is-pending { color:var(--muted); }
.pod-ai-msg p { margin:0 0 6px; } .pod-ai-msg p:last-child { margin-bottom:0; }
.pod-ai-msg ul, .pod-ai-msg ol { margin:0 0 6px; padding-left:18px; }
.pod-ai-msg table { border-collapse:collapse; margin:6px 0; font-size:12px; width:100%; }
.pod-ai-msg th, .pod-ai-msg td { border:1px solid var(--border); padding:4px 7px; text-align:left; }
.pod-ai-msg th { background:var(--bg-soft); font-weight:600; }
.pod-ai-used { margin-top:6px; padding-top:6px; border-top:1px dashed var(--border); font-size:11px; color:var(--muted); }
.pod-ai-empty p { font-size:12.5px; color:var(--text-2); margin:0 0 10px; }
.pod-ai-chips { display:flex; flex-wrap:wrap; gap:6px; }
.pod-ai-chip { border:1px solid var(--border); background:var(--bg); color:var(--text-2); border-radius:999px; padding:4px 10px;
	font-size:12px; cursor:pointer; text-align:left; }
.pod-ai-chip:hover { border-color:#9FB3C8; color:var(--text); }
.pod-ai-input { display:flex; gap:8px; align-items:flex-end; padding:10px 12px; border-top:1px solid var(--border-soft); }
.pod-ai-input textarea { flex:1; resize:none; border:1px solid var(--border); border-radius:8px; padding:7px 10px; font-size:13px;
	background:var(--bg); color:var(--text); outline:none; max-height:120px; }
.pod-ai-input textarea:focus { border-color:var(--brand); }
.pod-ai-dots { display:inline-flex; gap:3px; vertical-align:middle; }
.pod-ai-dots i { width:5px; height:5px; border-radius:50%; background:var(--muted); animation:pod-ai-dot 1s infinite ease-in-out; }
.pod-ai-dots i:nth-child(2) { animation-delay:.15s; } .pod-ai-dots i:nth-child(3) { animation-delay:.3s; }
@keyframes pod-ai-dot { 0%, 80%, 100% { opacity:.25; } 40% { opacity:1; } }
@media (prefers-reduced-motion: reduce) { .pod-ai-dots i { animation:none; opacity:.6; } }
.pod-src-chip.is-zero b { color:var(--muted); }
@container podpane (max-width: 1200px) { .pod-headline.is-five, .pod-headline.is-six { grid-template-columns:repeat(3, minmax(0,1fr)); }
	.pod-rej-grid { grid-template-columns:repeat(3, minmax(0,1fr)) !important; } }
@container podpane (max-width: 560px) { .pod-headline.is-five, .pod-headline.is-six, .pod-rej-grid { grid-template-columns:minmax(0,1fr) !important; } }
`;
