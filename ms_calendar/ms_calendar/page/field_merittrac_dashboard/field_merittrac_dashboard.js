// Field MeritTrac Dashboard — /app/field-merittrac-dashboard
//
// "Field Meritrac Test URL" (links sent) + "Field MeritTrac Test Result"
// (results MeritTrac posted back), one row per applicant.
//
// Filters (Apply button + one-click date presets) → KPI cards → test
// windows → candidates table → full data (every field of both doctypes,
// CSV / Excel download) → by subject / by department → section-wise
// performance → test funnel and score distribution.
//
// Every card, bar and table number opens a centred drilldown with sortable
// columns and a CSV export; clicking an applicant there opens their full
// test detail (links, results, section scores, written answers, evaluator
// marks).
//
// All numbers come from ONE permission-scoped server call
// (get_dashboard_data, which uses frappe.get_list), so cards, charts,
// drilldowns and CSV exports can never show more than the user may read.
// Every value rendered into HTML goes through esc().

const FMD_API = 'ms_calendar.ms_calendar.page.field_merittrac_dashboard.field_merittrac_dashboard.';
const FMD_STORE_KEY = 'fmd-filters-v1';

// Score bands — Question Paper Master: 40% & above / 25% – 39.5% / below 25%.
const FMD_BANDS = [
	{ key: '40% & above', color: '#0ca30c', icon: '✓' },
	{ key: '25% – 39.5%', color: '#c98500', icon: '≈' },
	{ key: 'Below 25%', color: '#d03b3b', icon: '✕' }
];

// Application statuses shown as a red pill.
const FMD_NEGATIVE = /reject|regret|not selected|no show|blocklist|on hold/i;

frappe.pages['field-merittrac-dashboard'].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __('Field MeritTrac Dashboard'),
		single_column: true
	});
	new FieldMeritTracDashboard(page, wrapper);
};

class FieldMeritTracDashboard {
	constructor(page, wrapper) {
		this.page = page;
		this.wrapper = wrapper;
		this.$root = $(wrapper).find('.page-content');
		this.rows = [];
		this.data = null;
		this.ms = {};
		this.render_shell();
		this.load(this.read_saved());
	}

	// ── helpers ────────────────────────────────────────────────────────────
	esc(v) { return frappe.utils.escape_html(v === null || v === undefined ? '' : String(v)); }
	fmt_date(d) { return d ? frappe.datetime.str_to_user(d) : ''; }
	fmt_dt(d) { return d ? moment(d).format('DD MMM YYYY, h:mm A') : ''; }
	pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }
	num(v) { return v === null || v === undefined || v === '' ? '' : String(Math.round(v * 10) / 10); }
	avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }
	band_of(key) { return FMD_BANDS.find(b => b.key === key); }

	read_saved() {
		try {
			const saved = JSON.parse(localStorage.getItem(FMD_STORE_KEY) || 'null');
			// Dates are never remembered — the page always opens on all dates.
			if (saved) { saved.from_date = null; saved.to_date = null; }
			return saved;
		} catch (e) { return null; }
	}
	save_filters(f) {
		try { localStorage.setItem(FMD_STORE_KEY, JSON.stringify(Object.assign({}, f, { from_date: null, to_date: null }))); } catch (e) { /* private mode etc. */ }
	}

	// ── layout ─────────────────────────────────────────────────────────────
	render_shell() {
		this.$root.html(`
			<style>${FMD_CSS}</style>
			<div class="fmd-root">
				<div class="fmd-hero">
					<div class="fmd-hero-circle" style="top:-60px;right:-40px;width:200px;height:200px;"></div>
					<div class="fmd-hero-circle" style="bottom:-80px;right:200px;width:150px;height:150px;"></div>
					<div class="fmd-hero-left">
						<div class="fmd-hero-icon">
							<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
						</div>
						<div>
							<div class="fmd-eyebrow">Field Recruitment · Written Test</div>
							<div class="fmd-title">${__('MeritTrac Test Dashboard')}</div>
							<div class="fmd-sub" id="fmd-sub">${__('Loading…')}</div>
						</div>
					</div>
					<div class="fmd-hero-right" id="fmd-hero-right"></div>
				</div>

				<div class="fmd-filters">
					<div class="fmd-presets">
						${[['week', __('This week')], ['month', __('This month')], ['last30', __('Last 30 days')],
							['last90', __('Last 90 days')], ['year', __('This year')], ['all', __('All dates')]]
							.map(([k, l]) => `<button class="fmd-preset" data-p="${k}">${l}</button>`).join('')}
						<span class="fmd-muted fmd-presets-note">${__('Dates = day the test was taken (or window start if not taken)')}</span>
					</div>
					<div class="fmd-filter-row">
						<div class="fmd-f"><label>${__('From')}</label><input type="date" id="fmd-from"></div>
						<div class="fmd-f"><label>${__('To')}</label><input type="date" id="fmd-to"></div>
						<div class="fmd-f"><label>${__('Department')}</label><div class="fmd-ms" id="fmd-ms-dept" data-placeholder="${__('All departments')}"></div></div>
						<div class="fmd-f"><label>${__('Role')}</label><div class="fmd-ms" id="fmd-ms-role" data-placeholder="${__('All roles')}"></div></div>
						<div class="fmd-f"><label>${__('Subject')}</label><div class="fmd-ms" id="fmd-ms-subject" data-placeholder="${__('All subjects')}"></div></div>
						<div class="fmd-f"><label>${__('Application status')}</label><div class="fmd-ms" id="fmd-ms-status" data-placeholder="${__('All statuses')}"></div></div>
						<div class="fmd-f fmd-f-btns">
							<button class="btn btn-primary btn-sm" id="fmd-apply">${__('Apply')}</button>
							<button class="btn btn-default btn-sm" id="fmd-reset">${__('Reset')}</button>
						</div>
					</div>
				</div>

				<div class="fmd-group-label">${__('Test progress')}</div>
				<div class="fmd-cards" id="fmd-cards-progress"></div>
				<div class="fmd-group-label">${__('Scores')}</div>
				<div class="fmd-cards" id="fmd-cards-scores"></div>
				<div class="fmd-group-label">${__('Needs action')}</div>
				<div class="fmd-cards" id="fmd-cards-action"></div>


				<div class="fmd-panel">
					<div class="fmd-panel-head">
						<div>
							<div class="fmd-panel-title">${__('Test windows')}</div>
							<div class="fmd-panel-sub">${__('Each batch of links sent together · click any number to see those candidates')}</div>
						</div>
						<div class="fmd-panel-tools"><button class="btn btn-default btn-xs" id="fmd-export-win">${__('Export CSV')}</button></div>
					</div>
					<div class="fmd-table-scroll fmd-short" id="fmd-win-table"></div>
				</div>

				<div class="fmd-panel">
					<div class="fmd-panel-head">
						<div>
							<div class="fmd-panel-title">${__('Candidates')}</div>
							<div class="fmd-panel-sub">${__('Latest test first · click a column to sort · click an applicant for the full test detail')}</div>
						</div>
						<div class="fmd-panel-tools">
							<input type="text" class="fmd-search" id="fmd-search" placeholder="${__('Search applicant, ID, subject…')}">
							<button class="btn btn-default btn-xs" id="fmd-export-main">${__('Export CSV')}</button>
						</div>
					</div>
					<div class="fmd-table-scroll" id="fmd-main-table"></div>
				</div>


				<div class="fmd-panel" id="fmd-full">
					<div class="fmd-panel-head">
						<div>
							<div class="fmd-panel-title">${__('Full data')}</div>
							<div class="fmd-panel-sub">${__('Every field of every record in the filters above · Test date = window start for a link, day taken for a result')}</div>
						</div>
						<div class="fmd-panel-tools fmd-dl">
							<button class="btn btn-default btn-xs" id="fmd-raw-csv">${__('CSV (this tab)')}</button>
							<button class="btn btn-default btn-xs" id="fmd-raw-xlsx">${__('Excel (this tab)')}</button>
							<button class="btn btn-primary btn-xs" id="fmd-raw-xlsx-both">⬇ ${__('Excel — both')}</button>
						</div>
					</div>
					<div class="fmd-tabs-bar">
						<div class="fmd-tabs" id="fmd-raw-tabs">
							<button data-t="links" class="is-on">${__('Field Meritrac Test URL')} <span class="fmd-badge" id="fmd-raw-n-links">0</span></button>
							<button data-t="results">${__('Field MeritTrac Test Result')} <span class="fmd-badge" id="fmd-raw-n-results">0</span></button>
						</div>
						<input type="text" class="fmd-search" id="fmd-raw-search" placeholder="${__('Search any field…')}">
					</div>
					<div class="fmd-table-scroll fmd-raw" id="fmd-raw-table"></div>
				</div>

				<div class="fmd-stack">
					<div class="fmd-panel">
						<div class="fmd-panel-head"><div>
							<div class="fmd-panel-title">${__('By subject')}</div>
							<div class="fmd-panel-sub">${__('Click any number to see those candidates')}</div>
						</div></div>
						<div class="fmd-table-scroll fmd-short" id="fmd-subject-table"></div>
					</div>
					<div class="fmd-panel">
						<div class="fmd-panel-head"><div>
							<div class="fmd-panel-title">${__('By department')}</div>
							<div class="fmd-panel-sub">${__('Click any number to see those candidates')}</div>
						</div></div>
						<div class="fmd-table-scroll fmd-short" id="fmd-dept-table"></div>
					</div>
				</div>

				<div class="fmd-panel">
					<div class="fmd-panel-head"><div>
						<div class="fmd-panel-title">${__('Section-wise performance')}</div>
						<div class="fmd-panel-sub">${__('Average score per test section, for the results shown · click a row to see those candidates')}</div>
					</div></div>
					<div class="fmd-panel-body" id="fmd-sections"></div>
				</div>

				<div class="fmd-two">
					<div class="fmd-panel">
						<div class="fmd-panel-head"><div>
							<div class="fmd-panel-title">${__('Test funnel')}</div>
							<div class="fmd-panel-sub">${__('Candidates who were sent a link · click a bar to see them')}</div>
						</div></div>
						<div class="fmd-panel-body" id="fmd-funnel"></div>
					</div>
					<div class="fmd-panel">
						<div class="fmd-panel-head"><div>
							<div class="fmd-panel-title">${__('Score distribution')}</div>
							<div class="fmd-panel-sub">${__('Latest result per candidate, in 5% steps · click a bar to see them')}</div>
						</div>
						<div class="fmd-legend" id="fmd-legend"></div></div>
						<div class="fmd-panel-body" id="fmd-hist"></div>
					</div>
				</div>
			</div>
			<div class="fmd-tip" id="fmd-tip"></div>
		`);

		const $c = this.$root;
		this.ms.dept = this.make_multiselect($c.find('#fmd-ms-dept'));
		this.ms.role = this.make_multiselect($c.find('#fmd-ms-role'));
		this.ms.subject = this.make_multiselect($c.find('#fmd-ms-subject'));
		this.ms.status = this.make_multiselect($c.find('#fmd-ms-status'));

		$c.find('#fmd-apply').on('click', () => this.load(this.current_filters()));
		$c.find('#fmd-reset').on('click', () => {
			Object.values(this.ms).forEach(m => m.clear());
			$c.find('#fmd-from, #fmd-to').val('');
			try { localStorage.removeItem(FMD_STORE_KEY); } catch (e) { /* ignore */ }
			this.load(null);
		});
		// A preset is a single-value choice, so it applies straight away.
		$c.find('.fmd-preset').on('click', (e) => {
			const [from, to] = this.preset_range($(e.currentTarget).data('p'));
			$c.find('#fmd-from').val(from);
			$c.find('#fmd-to').val(to);
			this.load(this.current_filters());
		});
		$c.find('#fmd-from, #fmd-to').on('keydown', (e) => { if (e.key === 'Enter') this.load(this.current_filters()); });
		$c.find('#fmd-search').on('input', frappe.utils.debounce(() => this.render_main_table(), 200));
		$c.find('#fmd-export-main').on('click', () => this.export_csv('field-merittrac-candidates', this.candidate_columns(), this.filtered_main_rows()));
		$c.find('#fmd-export-win').on('click', () => this.export_csv('field-merittrac-test-windows', this._win_cols || [], this._win_lines || []));

		// Full data tabs — switching tab is a single choice, so it applies at once.
		this.raw_tab = 'links';
		try { this.raw_tab = localStorage.getItem('fmd-raw-tab') || 'links'; } catch (e) { /* ignore */ }
		$c.find('#fmd-raw-tabs button').on('click', (e) => {
			this.raw_tab = String($(e.currentTarget).data('t'));
			try { localStorage.setItem('fmd-raw-tab', this.raw_tab); } catch (err) { /* ignore */ }
			$c.find('#fmd-raw-table').removeData('fmd-sort').removeData('fmd-dir');
			this.render_raw();
		});
		$c.find('#fmd-raw-search').on('input', frappe.utils.debounce(() => this.render_raw(), 250));
		$c.find('#fmd-raw-csv').on('click', () => {
			const t = this.raw_tab;
			this.export_csv(`field-merittrac-${t === 'links' ? 'test-url' : 'test-result'}-${this.range_slug()}`,
				this.raw_columns(t), this.filtered_raw_rows(t));
		});
		$c.find('#fmd-raw-xlsx').on('click', () => this.download_xlsx(this.raw_tab));
		$c.find('#fmd-raw-xlsx-both').on('click', () => this.download_xlsx('both'));

		$(document).off('click.fmdMs').on('click.fmdMs', (e) => {
			if (!$(e.target).closest('.fmd-ms').length) $c.find('.fmd-ms.open').removeClass('open');
		});

		// One shared hover tooltip for the funnel / histogram / section bars.
		const $tip = $c.find('#fmd-tip');
		$c.on('mouseenter', '[data-tip]', (e) => { $tip.html($(e.currentTarget).attr('data-tip')).addClass('show'); });
		$c.on('mousemove', '[data-tip]', (e) => { $tip.css({ left: e.clientX + 14, top: e.clientY + 14 }); });
		$c.on('mouseleave', '[data-tip]', () => $tip.removeClass('show'));
	}

	preset_range(p) {
		const fmt = (d) => moment(d).format('YYYY-MM-DD');
		const t = moment().startOf('day');
		switch (p) {
			case 'week': return [fmt(t.clone().startOf('isoWeek')), fmt(t.clone().endOf('isoWeek'))];
			case 'month': return [fmt(t.clone().startOf('month')), fmt(t.clone().endOf('month'))];
			case 'last30': return [fmt(t.clone().subtract(30, 'days')), fmt(t)];
			case 'last90': return [fmt(t.clone().subtract(90, 'days')), fmt(t)];
			case 'year': return [fmt(t.clone().startOf('year')), fmt(t.clone().endOf('year'))];
			default: return ['', ''];
		}
	}

	current_filters() {
		const $c = this.$root;
		return {
			from_date: $c.find('#fmd-from').val() || null,
			to_date: $c.find('#fmd-to').val() || null,
			departments: this.ms.dept.val(),
			roles: this.ms.role.val(),
			subjects: this.ms.subject.val(),
			statuses: this.ms.status.val()
		};
	}

	// Same chip multiselect as the Field Interview Dashboard / Reports page
	// (search, Select all / Clear, checkbox list), so filters look and
	// behave alike across dashboards.
	make_multiselect($el) {
		const esc = (v) => this.esc(v);
		const placeholder = $el.data('placeholder') || __('All');
		let options = [];
		let selected = [];
		$el.html(`
			<div class="fmd-ms-box"></div>
			<div class="fmd-ms-panel">
				<div class="fmd-ms-search"><input type="text" placeholder="${__('Search…')}"></div>
				<div class="fmd-ms-actions"><a class="fmd-ms-all">${__('Select all')}</a><a class="fmd-ms-none">${__('Clear')}</a></div>
				<div class="fmd-ms-list"></div>
			</div>`);
		const $box = $el.find('.fmd-ms-box');
		const $search = $el.find('.fmd-ms-search input');
		const $list = $el.find('.fmd-ms-list');

		const render_box = () => {
			$box.empty();
			if (!selected.length) { $box.append(`<span class="fmd-ms-ph">${esc(placeholder)}</span>`); return; }
			selected.slice(0, 2).forEach(v => $box.append(
				`<span class="fmd-ms-chip" title="${esc(v)}"><span class="txt">${esc(v)}</span><span class="x" data-v="${esc(v)}">&times;</span></span>`));
			if (selected.length > 2) $box.append(`<span class="fmd-ms-more">+${selected.length - 2}</span>`);
		};
		const render_list = () => {
			const q = ($search.val() || '').toLowerCase();
			const matches = options.filter(v => v.toLowerCase().includes(q));
			$list.html(matches.length ? matches.map(v => `
				<label class="fmd-ms-opt"><input type="checkbox" data-v="${esc(v)}" ${selected.includes(v) ? 'checked' : ''}>
				<span>${esc(v)}</span></label>`).join('') : `<div class="fmd-ms-empty">${__('No matches')}</div>`);
		};
		$box.on('click', (e) => {
			if ($(e.target).hasClass('x')) return;
			const open = $el.hasClass('open');
			$('.fmd-ms.open').removeClass('open');
			if (!open) { $el.addClass('open'); $search.val(''); render_list(); $search.trigger('focus'); }
		});
		$box.on('click', '.x', (e) => {
			e.stopPropagation();
			const v = String($(e.currentTarget).data('v'));
			selected = selected.filter(s => s !== v);
			render_box(); render_list();
		});
		$search.on('input', render_list);
		$list.on('change', 'input', (e) => {
			const v = String($(e.currentTarget).data('v'));
			selected = e.currentTarget.checked ? [...new Set([...selected, v])] : selected.filter(s => s !== v);
			render_box();
		});
		$el.find('.fmd-ms-all').on('click', (e) => {
			e.stopPropagation();
			const q = ($search.val() || '').toLowerCase();
			selected = [...new Set([...selected, ...options.filter(v => v.toLowerCase().includes(q))])];
			render_box(); render_list();
		});
		$el.find('.fmd-ms-none').on('click', (e) => { e.stopPropagation(); selected = []; render_box(); render_list(); });
		render_box();
		return {
			setOptions(opts) { options = opts.slice(); selected = selected.filter(s => options.includes(s)); render_box(); },
			setVal(vals) { selected = (vals || []).filter(s => options.includes(s)); render_box(); },
			val() { return selected.slice(); },
			clear() { selected = []; render_box(); }
		};
	}

	// ── data ───────────────────────────────────────────────────────────────
	load(filters) {
		const $c = this.$root;
		const f = filters || {};
		const args = filters ? {
			from_date: f.from_date || null,
			to_date: f.to_date || null,
			departments: JSON.stringify(f.departments || []),
			roles: JSON.stringify(f.roles || []),
			subjects: JSON.stringify(f.subjects || []),
			statuses: JSON.stringify(f.statuses || [])
		} : {};
		$c.find('#fmd-apply').prop('disabled', true).text(__('Loading…'));
		frappe.call({
			method: FMD_API + 'get_dashboard_data',
			args,
			callback: (r) => {
				this.data = r.message || {};
				this.rows = this.data.rows || [];
				// What the page now shows — the Excel download sends exactly these.
				this.applied = args;
				const o = this.data.options || {};
				this.ms.dept.setOptions(o.departments || []);
				this.ms.role.setOptions(o.roles || []);
				this.ms.subject.setOptions(o.subjects || []);
				this.ms.status.setOptions(o.statuses || []);
				if (filters) {
					this.ms.dept.setVal(f.departments); this.ms.role.setVal(f.roles);
					this.ms.subject.setVal(f.subjects); this.ms.status.setVal(f.statuses);
					this.save_filters(f);
				}
				$c.find('#fmd-from').val(this.data.from_date);
				$c.find('#fmd-to').val(this.data.to_date);
				const fd = this.data.from_date, td = this.data.to_date;
				const range = fd && td ? __('{0} to {1}', [this.fmt_date(fd), this.fmt_date(td)])
					: fd ? __('From {0}', [this.fmt_date(fd)])
					: td ? __('Up to {0}', [this.fmt_date(td)])
					: __('All dates');
				$c.find('#fmd-sub').text(__('{0} · {1} candidates · updated {2}', [range, this.rows.length, frappe.datetime.now_time()])
					+ (this.data.truncated ? ' · ' + __('showing the first 20,000 records') : ''));
				this.render_all();
			},
			always: () => $c.find('#fmd-apply').prop('disabled', false).text(__('Apply'))
		});
	}

	render_all() {
		this.render_hero_right();
		this.render_cards();
		this.render_funnel();
		this.render_histogram();
		this.render_window_table();
		this.render_main_table();
		this.render_raw();
		this.render_subject_table();
		this.render_department_table();
		this.render_sections();
	}

	// ── hero ───────────────────────────────────────────────────────────────
	render_hero_right() {
		const R = this.rows;
		const invited = R.filter(r => r.links_sent);
		const due = invited.filter(r => r.test_state === 'Completed' || r.test_state === 'Not attempted');
		const done = R.filter(r => r.pct !== null && r.pct !== undefined);
		const passed = done.filter(r => r.band === FMD_BANDS[0].key);
		const avg = this.avg(done.map(r => r.pct));
		this.$root.find('#fmd-hero-right').html(`
			<div class="fmd-hero-stat"><div class="v">${due.length ? this.pct(due.filter(r => r.test_state === 'Completed').length, due.length) + '%' : '—'}</div>
				<div class="l">${__('Turn-up rate')}</div></div>
			<div class="fmd-hero-stat"><div class="v">${done.length ? this.pct(passed.length, done.length) + '%' : '—'}</div>
				<div class="l">${__('Scored 40%+')}</div></div>
			<div class="fmd-hero-stat"><div class="v">${avg === null ? '—' : this.esc(this.num(avg)) + '%'}</div>
				<div class="l">${__('Average score')}</div></div>`);
	}

	// ── cards ──────────────────────────────────────────────────────────────
	card_defs() {
		const R = this.rows;
		const at = this.data.all_time || {};
		const dated = this.data.from_date || this.data.to_date;
		const invited = R.filter(r => r.links_sent);
		const links_total = invited.reduce((s, r) => s + r.links_sent, 0);
		const completed = R.filter(r => r.test_state === 'Completed');
		const scored = R.filter(r => r.pct !== null && r.pct !== undefined);
		const avg = this.avg(scored.map(r => r.pct));
		const due = invited.filter(r => r.test_state === 'Completed' || r.test_state === 'Not attempted');
		const by_band = (k) => scored.filter(r => r.band === k);
		return {
			progress: [
				{ key: 'invited', label: __('Sent a test link'), hint: __('{0} links in total', [links_total]), color: '#1F3A5F', rows: invited },
				{ key: 'completed', label: __('Test completed'), hint: __('{0}% of those due', [this.pct(completed.filter(r => r.links_sent).length, due.length)]), color: '#0ca30c', icon: '✓', rows: completed },
				{ key: 'noshow', label: __('Not attempted'), hint: __('Window closed, no result'), color: '#d03b3b', icon: '⚠', rows: R.filter(r => r.test_state === 'Not attempted') },
				{ key: 'open', label: __('Window open now'), hint: __('Link live, not taken yet'), color: '#2a78d6', icon: '●', rows: R.filter(r => r.test_state === 'Window open') },
				{ key: 'upcoming', label: __('Test not started'), hint: __('Window opens later'), color: '#4a3aa7', rows: R.filter(r => r.test_state === 'Upcoming') }
			],
			scores: [
				{ key: 'avg', label: __('Average score'), hint: __('{0} results', [scored.length]), color: '#1c5cab', value: avg === null ? '—' : this.num(avg) + '%', rows: scored },
				{ key: 'b1', label: __('Scored 40% & above'), hint: __('Meets selection criteria'), color: FMD_BANDS[0].color, icon: '✓', rows: by_band(FMD_BANDS[0].key) },
				{ key: 'b2', label: __('Scored 25% – 39.5%'), hint: __('Between the cut-offs'), color: FMD_BANDS[1].color, icon: '≈', rows: by_band(FMD_BANDS[1].key) },
				{ key: 'b3', label: __('Scored below 25%'), hint: __('Lowest band'), color: FMD_BANDS[2].color, icon: '✕', rows: by_band(FMD_BANDS[2].key) },
				{ key: 'multi', label: __('More than one attempt'), hint: __('Several results received'), color: '#64748B', rows: R.filter(r => r.attempts > 1) }
			],
			action: [
				{ key: 'stale', label: __('Status not updated'), hint: __('Result in, still New Applicant / Test Process'), color: '#b42318', icon: '⚠', rows: R.filter(r => r.status_stale) },
				{ key: 'evalpending', label: __('Evaluator marks pending'), hint: __('Paper needs an evaluator, no marks yet'), color: '#c98500', icon: '⏳', rows: R.filter(r => r.eval_state === 'Marks pending') },
				{ key: 'nolink', label: __('Result without a link'), hint: __('No Test URL record found'), color: '#64748B', rows: R.filter(r => r.test_state === 'No link') },
				{ key: 'unknown', label: __('Test window unreadable'), hint: __('Start / end time not a date'), color: '#64748B', rows: R.filter(r => r.test_state === 'Window unknown') },
				{ key: 'at_results', label: __('All-time results'), hint: __('ALL-TIME · ignores filters'), color: '#0F172A', value: at.results || 0, rows: null },
				{ key: 'at_links', label: __('All-time links sent'), hint: __('ALL-TIME · ignores filters · {0} candidates', [at.applicants || 0]), color: '#0F172A', value: at.links || 0, rows: null }
			],
			dated
		};
	}

	render_cards() {
		const defs = this.card_defs();
		['progress', 'scores', 'action'].forEach(group => {
			const $cards = this.$root.find('#fmd-cards-' + group);
			const list = defs[group];
			$cards.html(list.map(d => `
				<div class="fmd-card ${d.rows ? 'is-click' : ''}" data-key="${d.key}" style="--c:${d.color};">
					<div class="fmd-card-top">
						<div class="fmd-card-value">${this.esc(d.value !== undefined ? d.value : d.rows.length)}</div>
						${d.icon ? `<div class="fmd-card-icon">${d.icon}</div>` : ''}
					</div>
					<div class="fmd-card-label">${this.esc(d.label)}</div>
					<div class="fmd-card-hint">${this.esc(d.hint)}</div>
				</div>`).join(''));
			$cards.find('.fmd-card.is-click').on('click', (e) => {
				const d = list.find(x => x.key === $(e.currentTarget).data('key'));
				this.open_drilldown(d.label, d.rows);
			});
		});
	}

	// ── funnel ─────────────────────────────────────────────────────────────
	render_funnel() {
		const invited = this.rows.filter(r => r.links_sent);
		const steps = [
			{ label: __('Sent a test link'), rows: invited },
			{ label: __('Test window reached'), rows: invited.filter(r => r.test_state === 'Completed' || r.test_state === 'Not attempted' || r.test_state === 'Window open') },
			{ label: __('Took the test'), rows: invited.filter(r => r.test_state === 'Completed') },
			{ label: __('Scored 40% & above'), rows: invited.filter(r => r.band === FMD_BANDS[0].key) }
		];
		const top = steps[0].rows.length;
		const $el = this.$root.find('#fmd-funnel');
		if (!top) { $el.html(`<div class="fmd-empty">${__('No test links in these filters.')}</div>`); return; }
		$el.html(steps.map((s, i) => {
			const n = s.rows.length;
			const w = Math.max(this.pct(n, top), n ? 2 : 0);
			const prev = i ? steps[i - 1].rows.length : 0;
			const tip = `<b>${this.esc(s.label)}</b><br>${n} ${__('candidates')} · ${this.pct(n, top)}% ${__('of those sent a link')}`
				+ (i ? `<br>${this.pct(n, prev)}% ${__('of the step before')}` : '');
			return `<div class="fmd-fun-row" data-i="${i}" data-tip="${this.esc(tip)}">
				<div class="fmd-fun-label">${this.esc(s.label)}</div>
				<div class="fmd-fun-track"><div class="fmd-fun-bar" style="width:${w}%;opacity:${1 - i * 0.13};"></div></div>
				<div class="fmd-fun-val"><b>${n}</b> <span class="fmd-muted">${this.pct(n, top)}%</span></div>
			</div>`;
		}).join(''));
		$el.find('.fmd-fun-row').on('click', (e) => {
			const s = steps[cint($(e.currentTarget).data('i'))];
			this.open_drilldown(s.label, s.rows);
		});
	}

	// ── score histogram (5% buckets, coloured by band) ────────────────────
	render_histogram() {
		const scored = this.rows.filter(r => r.pct !== null && r.pct !== undefined);
		this.$root.find('#fmd-legend').html(FMD_BANDS.map(b =>
			`<span class="fmd-leg"><span class="sw" style="background:${b.color};"></span>${b.icon} ${this.esc(b.key)}</span>`).join(''));
		const $el = this.$root.find('#fmd-hist');
		if (!scored.length) { $el.html(`<div class="fmd-empty">${__('No results in these filters.')}</div>`); return; }
		const buckets = Array.from({ length: 20 }, (_, i) => ({ from: i * 5, to: i * 5 + 5, rows: [] }));
		scored.forEach(r => buckets[Math.min(19, Math.max(0, Math.floor(r.pct / 5)))].rows.push(r));
		const max = Math.max(...buckets.map(b => b.rows.length));
		const sel = this.data.thresholds || { select: 40, low: 25 };
		const color = (from) => from >= sel.select ? FMD_BANDS[0].color : from >= sel.low ? FMD_BANDS[1].color : FMD_BANDS[2].color;
		$el.html(`
			<div class="fmd-hist">
				<div class="fmd-hist-grid">${[1, 0.5].map(f => `<div class="fmd-hist-gl" style="bottom:${f * 100}%;"><span>${Math.round(max * f)}</span></div>`).join('')}</div>
				${buckets.map((b, i) => `
					<div class="fmd-hist-col ${b.rows.length ? 'is-click' : ''}" data-i="${i}"
						data-tip="${this.esc(`<b>${b.from}% – ${b.to === 100 ? 100 : b.to - 0.01}%</b><br>${b.rows.length} ${__('candidates')}`)}">
						${b.rows.length ? `<div class="fmd-hist-n">${b.rows.length}</div>` : ''}
						<div class="fmd-hist-bar" style="height:${max ? (b.rows.length / max) * 100 : 0}%;background:${color(b.from)};"></div>
					</div>`).join('')}
				<div class="fmd-hist-cut" style="left:${sel.low}%;"><span>${sel.low}%</span></div>
				<div class="fmd-hist-cut" style="left:${sel.select}%;"><span>${sel.select}%</span></div>
			</div>
			<div class="fmd-hist-axis">${[0, 20, 40, 60, 80, 100].map(v => `<span style="left:${v}%;">${v}%</span>`).join('')}</div>`);
		$el.find('.fmd-hist-col.is-click').on('click', (e) => {
			const b = buckets[cint($(e.currentTarget).data('i'))];
			this.open_drilldown(__('Scored {0}% – {1}%', [b.from, b.to]), b.rows);
		});
	}

	// ── tables ─────────────────────────────────────────────────────────────
	pill(v, c, icon) {
		if (!v) return '';
		return `<span class="fmd-pill" style="--c:${c};">${icon ? icon + ' ' : ''}${this.esc(v)}</span>`;
	}
	state_pill(v) {
		const m = {
			Completed: ['#0ca30c', '✓'], 'Not attempted': ['#d03b3b', '⚠'], 'Window open': ['#2a78d6', '●'],
			Upcoming: ['#4a3aa7', ''], 'No link': ['#64748B', ''], 'Window unknown': ['#64748B', '?'],
			Open: ['#2a78d6', '●'], Closed: ['#475569', ''], Unknown: ['#64748B', '?']
		}[v] || ['#475569', ''];
		return this.pill(v, m[0], m[1]);
	}
	band_pill(v) {
		const b = this.band_of(v);
		return b ? this.pill(v, b.color, b.icon) : '';
	}
	eval_pill(v) {
		return v === 'Marks pending' ? this.pill(v, '#c98500', '⏳') : v === 'Marks submitted' ? this.pill(v, '#0ca30c', '✓') : '';
	}
	status_pill(r) {
		if (!r.app_status) return '';
		const c = /select|offer|joined/i.test(r.app_status) ? '#0ca30c' : FMD_NEGATIVE.test(r.app_status) ? '#d03b3b' : '#475569';
		return this.pill(r.app_status, c) + (r.status_stale ? `<div class="fmd-warn">⚠ ${__('Not updated after the test')}</div>` : '');
	}
	score_cell(r) {
		if (r.pct === null || r.pct === undefined) return '';
		const b = this.band_of(r.band);
		return `<div class="fmd-score"><b>${this.esc(this.num(r.pct))}%</b>
			<div class="fmd-score-track"><div style="width:${Math.min(100, Math.max(0, r.pct))}%;background:${b ? b.color : '#94A3B8'};"></div></div></div>`;
	}
	window_cell(r) {
		if (!r.window_start) return `<span class="fmd-muted">${this.esc(r.window_label || '')}</span>`;
		return `${this.esc(moment(r.window_start).format('DD MMM YYYY · h:mm A'))}`
			+ (r.window_end ? `<div class="fmd-muted">→ ${this.esc(moment(r.window_end).format('DD MMM YYYY · h:mm A'))}</div>` : '');
	}
	window_text(r) {
		if (r.window_start) return this.fmt_dt(r.window_start) + (r.window_end ? ' → ' + this.fmt_dt(r.window_end) : '');
		return r.window_label || '';
	}

	candidate_columns() {
		return [
			{ key: 'test_date', label: __('Test date'), nw: true, render: r => this.esc(this.fmt_date(r.test_date)), csv: r => r.test_date },
			{ key: 'applicant', label: __('Applicant'), render: r => `<a class="fmd-cand" data-app="${this.esc(r.application_id)}">${this.esc(r.applicant || r.application_id)}</a><div class="fmd-muted">${this.esc(r.application_id)}</div>`, csv: r => r.applicant },
			{ key: 'application_id', label: __('Application ID'), hidden: true },
			{ key: 'email', label: __('Email'), hidden: true },
			{ key: 'department', label: __('Department') },
			{ key: 'role', label: __('Role') },
			{ key: 'subject', label: __('Subject') },
			{ key: 'window_start', label: __('Test window'), nw: true, sort: r => r.window_start || '', render: r => this.window_cell(r), csv: r => this.window_text(r) },
			{ key: 'test_state', label: __('Test'), render: r => this.state_pill(r.test_state) },
			{ key: 'links_sent', label: __('Links'), sort: r => r.links_sent || 0 },
			{ key: 'pct', label: __('Score %'), sort: r => r.pct === null ? -1 : r.pct, render: r => this.score_cell(r), csv: r => r.pct === null ? '' : r.pct },
			{ key: 'score', label: __('Marks'), sort: r => r.score === null ? -1 : r.score, nw: true,
				render: r => r.score === null ? '' : `${this.esc(this.num(r.score))}<span class="fmd-muted"> / ${this.esc(this.num(r.max_score))}</span>`,
				csv: r => r.score === null ? '' : `${r.score} / ${r.max_score}` },
			{ key: 'band', label: __('Band'), render: r => this.band_pill(r.band) },
			{ key: 'attempted', label: __('Answered'), sort: r => r.attempted === null ? -1 : r.attempted, nw: true,
				render: r => r.attempted === null ? '' : `${cint(r.attempted)}<span class="fmd-muted"> / ${cint(r.questions)}</span>`,
				csv: r => r.attempted === null ? '' : `${r.attempted} / ${r.questions}` },
			{ key: 'dq_score', label: __('DQ score'), sort: r => r.dq_score === null ? -1 : r.dq_score, render: r => this.esc(this.num(r.dq_score)) },
			{ key: 'attempts', label: __('Attempts'), sort: r => r.attempts || 0, render: r => r.attempts > 1 ? `<b class="fmd-red">${cint(r.attempts)}</b>` : this.esc(r.attempts || '') },
			{ key: 'eval_state', label: __('Evaluator'), render: r => this.eval_pill(r.eval_state) + (r.eval_result ? ' ' + this.pill(r.eval_result, r.eval_result === 'Select' ? '#0ca30c' : '#d03b3b') : '') + (r.evaluator ? `<div class="fmd-muted">${this.esc(r.evaluator)}</div>` : ''),
				csv: r => [r.eval_state, r.eval_result, r.evaluator].filter(Boolean).join(' · ') },
			{ key: 'app_status', label: __('Application status'), render: r => this.status_pill(r), csv: r => r.app_status + (r.status_stale ? ' (not updated)' : '') },
			{ key: 'result_name', label: __('Records'), sort: r => r.result_name || r.link_name, render: r => [
				r.result_name ? `<a href="/app/field-merittrac-test-result/${encodeURIComponent(r.result_name)}" target="_blank">${this.esc(r.result_name)}</a>` : '',
				r.link_name ? `<a class="fmd-muted" href="/app/field-meritrac-test-url/${encodeURIComponent(r.link_name)}" target="_blank">${__('Link')} ↗</a>` : ''
			].filter(Boolean).join('<br>'), csv: r => r.result_name }
		];
	}

	filtered_main_rows() {
		const q = (this.$root.find('#fmd-search').val() || '').toLowerCase().trim();
		if (!q) return this.rows;
		return this.rows.filter(r => [r.applicant, r.application_id, r.role, r.subject, r.department, r.email, r.app_status]
			.join(' ').toLowerCase().includes(q));
	}

	render_main_table() {
		this.sortable_table(this.$root.find('#fmd-main-table'), this.candidate_columns(), this.filtered_main_rows());
	}

	// ── breakdown tables ──────────────────────────────────────────────────
	breakdown_metrics() {
		return [
			{ key: 'total', label: __('Candidates'), f: () => true },
			{ key: 'completed', label: __('Took test'), f: r => r.test_state === 'Completed' },
			{ key: 'noshow', label: __('Not attempted'), f: r => r.test_state === 'Not attempted', red: true },
			{ key: 'open', label: __('Open / not started'), f: r => r.test_state === 'Window open' || r.test_state === 'Upcoming' },
			{ key: 'b1', label: __('40%+'), f: r => r.band === FMD_BANDS[0].key },
			{ key: 'b3', label: __('Below 25%'), f: r => r.band === FMD_BANDS[2].key, red: true }
		];
	}

	render_breakdown($el, first, groups, opts = {}) {
		const metrics = this.breakdown_metrics();
		const lines = Object.keys(groups).map(k => {
			const line = { label: k, sort_key: opts.sort_key ? opts.sort_key(k) : k };
			metrics.forEach(m => { line[m.key] = groups[k].filter(m.f); });
			const scores = groups[k].filter(r => r.pct !== null && r.pct !== undefined).map(r => r.pct);
			line.avg = this.avg(scores);
			const due = line.completed.length + line.noshow.length;
			line.turnup = due ? this.pct(line.completed.length, due) : null;
			return line;
		});
		const cols = [{ key: 'label', label: first.label, sort: l => l.sort_key, render: first.render ? l => first.render(l) : null }]
			.concat(metrics.map(m => ({
				key: m.key, label: m.label,
				sort: l => l[m.key].length,
				csv: l => l[m.key].length,
				render: l => l[m.key].length
					? `<a class="fmd-num ${m.red ? 'is-red' : ''}" data-label="${this.esc(l.label)}" data-metric="${m.key}">${l[m.key].length}</a>`
					: '<span class="fmd-zero">0</span>'
			})))
			.concat([
				{ key: 'turnup', label: __('Turn-up'), sort: l => l.turnup === null ? -1 : l.turnup,
					render: l => l.turnup === null ? '<span class="fmd-zero">—</span>' : `${cint(l.turnup)}%`,
					csv: l => l.turnup === null ? '' : l.turnup + '%' },
				{ key: 'avg', label: __('Avg score'), sort: l => l.avg === null ? -1 : l.avg,
					render: l => l.avg === null ? '<span class="fmd-zero">—</span>' : this.score_cell({ pct: l.avg, band: l.avg >= 40 ? FMD_BANDS[0].key : l.avg >= 25 ? FMD_BANDS[1].key : FMD_BANDS[2].key }),
					csv: l => l.avg === null ? '' : this.num(l.avg) }
			]);
		this.sortable_table($el, cols, lines, { default_sort: opts.default_sort || 'total', default_dir: -1, empty: __('Nothing in these filters.') });
		$el.off('click.fmdnum').on('click.fmdnum', '.fmd-num', (e) => {
			const $a = $(e.currentTarget);
			const line = lines.find(l => l.label === String($a.data('label')));
			const metric = metrics.find(m => m.key === $a.data('metric'));
			if (line) this.open_drilldown(`${opts.title ? opts.title(line) : line.label} · ${metric.label}`, line[metric.key]);
		});
		return { cols, lines };
	}

	group_by(rows, keyfn) {
		const groups = {};
		rows.forEach(r => { const k = keyfn(r); if (k !== null) (groups[k] = groups[k] || []).push(r); });
		return groups;
	}

	render_window_table() {
		const rows = this.rows.filter(r => r.links_sent);
		const label_of = {};
		const groups = this.group_by(rows, r => {
			const k = r.window_start || ('?' + (r.window_label || ''));
			label_of[k] = r.window_start ? this.window_text(r) : __('Unreadable window: "{0}"', [r.window_label || '']);
			return k;
		});
		const res = this.render_breakdown(this.$root.find('#fmd-win-table'), {
			label: __('Test window'),
			render: l => `<span class="fmd-nw">${this.esc(label_of[l.label])}</span>`
		}, groups, { default_sort: 'label', title: l => label_of[l.label] });
		this._win_cols = res.cols.map(c => c.key === 'label' ? Object.assign({}, c, { csv: l => label_of[l.label] }) : c);
		this._win_lines = res.lines;
	}

	render_subject_table() {
		this.render_breakdown(this.$root.find('#fmd-subject-table'), { label: __('Subject') },
			this.group_by(this.rows, r => r.subject || __('(blank)')));
	}

	render_department_table() {
		this.render_breakdown(this.$root.find('#fmd-dept-table'), { label: __('Department') },
			this.group_by(this.rows, r => r.department || __('(blank)')));
	}

	// ── full data (every field of both doctypes) ──────────────────────────
	range_slug() {
		return [this.data.from_date, this.data.to_date].filter(Boolean).join('_to_') || 'all-dates';
	}

	raw_columns(t) {
		const esc = (v) => this.esc(v);
		const defs = (t === 'links' ? this.data.link_columns : this.data.result_columns) || [];
		const route = t === 'links' ? 'field-meritrac-test-url' : 'field-merittrac-test-result';
		const long = ['Small Text', 'Text', 'Long Text', 'Text Editor', 'Code'];
		const text = (v) => v === null || v === undefined ? '' : String(v);
		return defs.map(d => {
			const f = d.fieldname;
			const col = { key: f, label: d.label, csv: r => text(r[f]) };
			if (f === 'name') {
				col.render = r => `<a href="/app/${route}/${encodeURIComponent(r.name)}" target="_blank">${esc(r.name)}</a>`;
			} else if (f === 'applicant_id') {
				col.render = r => r[f] ? `<a class="fmd-cand" data-app="${esc(r[f])}">${esc(r[f])}</a>` : '';
			} else if (d.fieldtype === 'Datetime') {
				col.nw = true;
				col.render = r => r[f] ? esc(moment(r[f]).format('DD MMM YYYY, h:mm A')) : '';
			} else if (d.fieldtype === 'Date') {
				col.nw = true;
				col.render = r => esc(this.fmt_date(r[f]));
			} else {
				col.render = r => {
					const v = text(r[f]).trim();
					if (!v) return '';
					// Real http(s) links open in a new tab; anything else stays text.
					if (/^https?:\/\//i.test(v)) {
						return `<a class="fmd-trunc" href="${encodeURI(v)}" target="_blank" rel="noopener noreferrer" title="${esc(v)}">${esc(v)}</a>`;
					}
					return long.includes(d.fieldtype) || v.length > 60
						? `<div class="fmd-trunc" title="${esc(v)}">${esc(v)}</div>`
						: esc(v);
				};
			}
			return col;
		});
	}

	raw_records(t) {
		return (t === 'links' ? this.data.link_records : this.data.result_records) || [];
	}

	filtered_raw_rows(t) {
		const all = this.raw_records(t);
		const q = (this.$root.find('#fmd-raw-search').val() || '').toLowerCase().trim();
		if (!q) return all;
		const keys = ((t === 'links' ? this.data.link_columns : this.data.result_columns) || []).map(c => c.fieldname);
		return all.filter(r => keys.some(k => r[k] !== null && r[k] !== undefined && String(r[k]).toLowerCase().includes(q)));
	}

	render_raw() {
		if (!this.data) return;
		const $c = this.$root;
		const t = this.raw_tab;
		$c.find('#fmd-raw-tabs button').each((i, b) => $(b).toggleClass('is-on', $(b).data('t') === t));
		$c.find('#fmd-raw-n-links').text((this.data.link_records || []).length);
		$c.find('#fmd-raw-n-results').text((this.data.result_records || []).length);
		const cols = this.raw_columns(t);
		const $el = $c.find('#fmd-raw-table');
		if (!cols.length) {
			$el.html(`<div class="fmd-empty">${__('You do not have permission to read this data.')}</div>`);
			return;
		}
		this.sortable_table($el, cols, this.filtered_raw_rows(t), {
			default_sort: '_test_date', default_dir: -1, limit: 200,
			empty: __('No records in these filters.')
		});
	}

	// Excel built on the server from the SAME filters the page last loaded
	// (not unapplied edits in the filter bar), permission-scoped there too.
	download_xlsx(kind) {
		const params = { kind };
		Object.entries(this.applied || {}).forEach(([k, v]) => {
			if (v !== null && v !== undefined && v !== '' && v !== '[]') params[k] = v;
		});
		open_url_post('/api/method/' + FMD_API + 'download_data', params);
		frappe.show_alert({ message: __('Preparing Excel…'), indicator: 'blue' }, 3);
	}

	// ── section-wise performance ──────────────────────────────────────────
	render_sections() {
		const $el = this.$root.find('#fmd-sections');
		const secs = (this.data.sections || []).map(s => Object.assign({}, s, { pct: s.max ? (s.score / s.max) * 100 : null }));
		if (!secs.length) {
			$el.html(`<div class="fmd-empty">${__('No section-wise scores for these results. (MeritTrac sends them with newer results only.)')}</div>`);
			return;
		}
		const by_result = {};
		this.rows.forEach(r => { if (r.result_name) by_result[r.result_name] = r; });
		const sel = this.data.thresholds || { select: 40, low: 25 };
		const color = (p) => p >= sel.select ? FMD_BANDS[0].color : p >= sel.low ? FMD_BANDS[1].color : FMD_BANDS[2].color;
		$el.html(`<div class="fmd-secs">${secs.map((s, i) => `
			<div class="fmd-sec-row" data-i="${i}" data-tip="${this.esc(`<b>${this.esc(s.section)}</b><br>${s.count} ${__('results')} · ${__('avg')} ${this.num(s.score / s.count)} / ${this.num(s.max / s.count)}`)}">
				<div class="fmd-sec-name">${this.esc(s.section)}<span class="fmd-muted"> · ${s.count}</span></div>
				<div class="fmd-fun-track"><div class="fmd-fun-bar" style="width:${s.pct === null ? 0 : Math.min(100, s.pct)}%;background:${s.pct === null ? '#94A3B8' : color(s.pct)};"></div></div>
				<div class="fmd-fun-val"><b>${s.pct === null ? '—' : this.esc(this.num(s.pct)) + '%'}</b></div>
			</div>`).join('')}</div>`);
		$el.find('.fmd-sec-row').on('click', (e) => {
			const s = secs[cint($(e.currentTarget).data('i'))];
			const rows = [...new Set(s.results)].map(n => by_result[n]).filter(Boolean);
			this.open_drilldown(__('Section: {0}', [s.section]), rows);
		});
	}

	// Generic sortable table. Clicking a header toggles asc/desc.
	sortable_table($el, columns, rows, opts = {}) {
		const cols = columns.filter(c => !c.hidden);
		let sort_key = $el.data('fmd-sort') || opts.default_sort || null;
		let dir = $el.data('fmd-dir') || opts.default_dir || 1;
		// Long tables draw the first `limit` rows, with a "Show all" button.
		let show_all = false;

		const value_of = (c, r) => c.sort ? c.sort(r) : r[c.key];
		const draw = () => {
			let data = rows.slice();
			if (sort_key) {
				const c = cols.find(x => x.key === sort_key) || cols[0];
				data.sort((a, b) => {
					const x = value_of(c, a), y = value_of(c, b);
					if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
					return String(x || '').localeCompare(String(y || ''), undefined, { numeric: true }) * dir;
				});
			}
			if (!data.length) {
				$el.html(`<div class="fmd-empty">${this.esc(opts.empty || __('No candidates match these filters.'))}</div>`);
				return;
			}
			const total = data.length;
			const cut = opts.limit && !show_all && total > opts.limit;
			if (cut) data = data.slice(0, opts.limit);
			$el.html(`<table class="fmd-table"><thead><tr>${cols.map(c => `
				<th data-key="${c.key}" class="${c.key === sort_key ? 'is-sorted' : ''}">${this.esc(c.label)}
				<span class="fmd-sort">${c.key === sort_key ? (dir === 1 ? '▲' : '▼') : '↕'}</span></th>`).join('')}
				</tr></thead><tbody>${data.map(r => `<tr>${cols.map(c =>
					`<td${c.nw ? ' class="nw"' : ''}>${c.render ? c.render(r) : this.esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`
				+ (cut ? `<div class="fmd-more">${__('Showing {0} of {1} rows', [opts.limit, total])}
					<button class="btn btn-default btn-xs fmd-show-all">${__('Show all')}</button>
					<span class="fmd-muted">${__('— downloads always include every row')}</span></div>` : ''));
		};
		$el.off('click.fmdmore').on('click.fmdmore', '.fmd-show-all', () => { show_all = true; draw(); });
		$el.off('click.fmdsort').on('click.fmdsort', 'th', (e) => {
			const k = $(e.currentTarget).data('key');
			dir = sort_key === k ? -dir : 1;
			sort_key = k;
			$el.data('fmd-sort', sort_key).data('fmd-dir', dir);
			draw();
		});
		this.bind_candidate_links($el);
		draw();
	}

	bind_candidate_links($el) {
		$el.off('click.fmdcand').on('click.fmdcand', '.fmd-cand', (e) => {
			e.preventDefault();
			const app = String($(e.currentTarget).data('app') || '');
			if (app) this.open_candidate(app);
		});
	}

	// ── drilldown (level 1) ───────────────────────────────────────────────
	open_drilldown(title, rows) {
		// Dialog titles are rendered as HTML — the title can hold data
		// (subject / department / window), so escape it.
		const d = new frappe.ui.Dialog({ title: this.esc(title), size: 'extra-large' });
		d.$wrapper.find('.modal-dialog').addClass('modal-dialog-centered');
		d.$body.html(`
			<style>${FMD_CSS}</style>
			<div class="fmd-root">
				<div class="fmd-dd-bar">
					<span class="fmd-muted">${__('{0} candidates', [rows.length])}</span>
					<button class="btn btn-default btn-xs fmd-dd-export">${__('Export CSV')}</button>
				</div>
				<div class="fmd-table-scroll fmd-dd-scroll"></div>
			</div>`);
		const cols = this.candidate_columns();
		this.sortable_table(d.$body.find('.fmd-dd-scroll'), cols, rows);
		d.$body.find('.fmd-dd-export').on('click', () => this.export_csv(title, cols, rows));
		d.show();
	}

	// ── candidate detail (level 2) ─────────────────────────────────────────
	open_candidate(application_id) {
		frappe.call({
			method: FMD_API + 'get_candidate_detail',
			args: { application_id },
			freeze: true,
			callback: (r) => {
				const c = r.message;
				if (!c) return;
				const esc = (v) => this.esc(v);
				const d = new frappe.ui.Dialog({ title: esc(`${c.name} · ${c.application_id}`), size: 'extra-large' });
				d.$wrapper.find('.modal-dialog').addClass('modal-dialog-centered');
				d.$body.html(`
					<style>${FMD_CSS}</style>
					<div class="fmd-root fmd-detail">
						<div class="fmd-detail-top">
							${c.pdf ? `<a class="btn btn-default btn-xs" target="_blank" rel="noopener" href="${encodeURI(c.pdf)}">📄 ${__('MeritTrac result PDF')}</a>` : ''}
							<a class="btn btn-default btn-xs" target="_blank"
								href="/app/field-registration-form/${encodeURIComponent(c.application_id)}">${__('Open Registration Form')} ↗</a>
						</div>
						<div class="fmd-sec">${__('Profile')}</div>
						<div class="fmd-profile">${c.profile.filter(p => p.value).map(p => `
							<div><div class="fmd-muted">${esc(p.label)}</div><div class="fmd-pv">${esc(p.value)}</div></div>`).join('')}
						</div>

						<div class="fmd-sec">${__('Test links sent')} (${c.links.length})</div>
						<div class="fmd-journey">${c.links.map(l => `
							<div class="fmd-step ${l.state === 'Closed' ? 'is-done' : ''}">
								<div class="fmd-step-dot"></div>
								<div class="fmd-step-title">${esc(l.start || '—')}</div>
								<div class="fmd-muted">${__('until')} ${esc(l.end || '—')}</div>
								<div style="margin:3px 0;">${this.state_pill(l.state)}</div>
								<div class="fmd-muted">${esc(l.sa_code)}${l.subject ? ' · ' + esc(l.subject) : ''}</div>
								${l.assessment_set ? `<div class="fmd-muted" title="${esc(l.assessment_set)}">${esc(l.assessment_set.replace(/^Azim Premji Foundation_/, ''))}</div>` : ''}
								<a class="fmd-muted" target="_blank" href="/app/field-meritrac-test-url/${encodeURIComponent(l.name)}">${__('Sent')} ${esc(l.sent_on)} ↗</a>
							</div>`).join('') || `<div class="fmd-muted">${__('No links found')}</div>`}
						</div>

						<div class="fmd-sec">${__('Results')} (${c.results.length})</div>
						${c.results.map(x => this.result_card_html(x, c.thresholds)).join('')
							|| `<div class="fmd-muted">${__('No result received yet')}</div>`}
					</div>`);
				d.show();
			}
		});
	}

	// One result in full — every value escaped; links only if http(s).
	result_card_html(x, th) {
		const esc = (v) => this.esc(v);
		const b = this.band_of(x.band);
		const pct = x.pct === null || x.pct === undefined ? null : x.pct;
		const ring = pct === null ? '' : `
			<div class="fmd-ring" style="--p:${Math.min(100, Math.max(0, pct))};--c:${b ? b.color : '#94A3B8'};">
				<div class="fmd-ring-in"><b>${esc(this.num(pct))}%</b><span>${esc(x.band)}</span></div>
			</div>`;
		const stat = (label, value) => value === '' || value === null || value === undefined ? ''
			: `<div><div class="fmd-muted">${esc(label)}</div><div class="fmd-pv">${esc(value)}</div></div>`;
		const color = (p) => p >= th.select ? FMD_BANDS[0].color : p >= th.low ? FMD_BANDS[1].color : FMD_BANDS[2].color;
		const sections = (x.sections || []).map(s => {
			const p = s.max ? (s.score / s.max) * 100 : null;
			return `<div class="fmd-sec-row is-static">
				<div class="fmd-sec-name">${esc(s.section)}</div>
				<div class="fmd-fun-track"><div class="fmd-fun-bar" style="width:${p === null ? 0 : Math.min(100, p)}%;background:${p === null ? '#94A3B8' : color(p)};"></div></div>
				<div class="fmd-fun-val"><b>${esc(this.num(s.score))}</b><span class="fmd-muted"> / ${esc(this.num(s.max))}</span></div>
			</div>`;
		}).join('');
		const m = x.marks;
		return `<div class="fmd-res">
			<div class="fmd-res-head">
				<div><b>${esc(x.name)}</b> · ${__('taken')} ${esc(x.taken_on || '—')} ${x.attempt_status ? this.pill(x.attempt_status, '#475569') : ''}</div>
				<div class="fmd-res-links">
					${x.report_url ? `<a target="_blank" rel="noopener noreferrer" href="${encodeURI(x.report_url)}">${__('Score report')} ↗</a>` : ''}
					${x.tn_report_url ? `<a target="_blank" rel="noopener noreferrer" href="${encodeURI(x.tn_report_url)}">${__('TN report')} ↗</a>` : ''}
					<a target="_blank" href="/app/field-merittrac-test-result/${encodeURIComponent(x.name)}">${__('Open record')} ↗</a>
				</div>
			</div>
			<div class="fmd-res-body">
				${ring}
				<div class="fmd-res-stats">
					${stat(__('Marks'), x.score !== '' ? `${x.score} / ${x.max_score}` : '')}
					${stat(__('Questions answered'), x.attempted !== '' ? `${x.attempted} / ${x.questions}` : '')}
					${stat(__('DQ score'), x.dq_score)}
				</div>
			</div>
			${sections ? `<div class="fmd-sub-title">${__('Section-wise scores')}</div><div class="fmd-secs">${sections}</div>` : ''}
			${x.proctor_comment ? `<div class="fmd-sub-title">${__('Proctor comment')}</div><div class="fmd-note">${esc(x.proctor_comment)}</div>` : ''}
			${(x.answers || []).length ? `<details class="fmd-answers"><summary>${__('Written answers')} (${x.answers.length})</summary>
				${x.answers.map((a, i) => `<div class="fmd-qa"><div class="fmd-q">Q${i + 1}. ${esc(a.q)}</div>
					<div class="fmd-a">${esc(a.a) || `<i class="fmd-muted">${__('Not answered')}</i>`}</div></div>`).join('')}
			</details>` : ''}
			${m ? `<div class="fmd-sub-title">${__('Evaluator marks')}</div>
				<div class="fmd-note">${this.pill(m.result || __('No decision'), m.result === 'Select' ? '#0ca30c' : m.result ? '#d03b3b' : '#64748B')}
					<b>${esc(this.num(m.total))}</b><span class="fmd-muted"> / ${esc(this.num(m.max))}</span>
					· ${esc(m.evaluator)} · ${esc(m.on)}
					· <a target="_blank" href="/app/field-evaluator-marks/${encodeURIComponent(m.name)}">${__('Open')} ↗</a>
					${m.comments ? `<div style="margin-top:4px;">${esc(m.comments)}</div>` : ''}</div>` : ''}
		</div>`;
	}

	// ── CSV ────────────────────────────────────────────────────────────────
	// Exports exactly the rows passed in (already permission-scoped by the
	// server). Cells starting with = + - @ are prefixed with ' so a
	// spreadsheet never evaluates them as formulas.
	export_csv(name, columns, rows) {
		const cell = (v) => {
			let s = v === null || v === undefined ? '' : String(v);
			if (/^[=+\-@]/.test(s)) s = "'" + s;
			return '"' + s.replace(/"/g, '""') + '"';
		};
		const lines = [columns.map(c => cell(c.label)).join(',')].concat(rows.map(r =>
			columns.map(c => cell(c.csv ? c.csv(r) : (Array.isArray(r[c.key]) ? r[c.key].length : r[c.key]))).join(',')));
		const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = String(name).replace(/[^\w\-]+/g, '_').slice(0, 80) + '.csv';
		document.body.appendChild(a);
		a.click();
		setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
	}
}

// Colours are role tokens on .fmd-root, re-stepped for Frappe's dark theme
// (html[data-theme="dark"]) rather than flipped automatically. Same look as
// the Field Interview Dashboard (fid-*), so the two read as one product.
const FMD_CSS = `
.fmd-root { --bg:#ffffff; --bg-soft:#F8FAFC; --border:#E5E7EB; --border-soft:#F1F5F9; --text:#0F172A;
	--text-2:#334155; --muted:#64748B; --head:#1F3A5F; --head-2:#274C77; --link:#1D4ED8; --hover:#F8FAFC; --track:#EEF2F7;
	color:var(--text); }
:root[data-theme="dark"] .fmd-root { --bg:#1C1C1B; --bg-soft:#232322; --border:#3A3A38; --border-soft:#2C2C2A;
	--text:#F5F5F4; --text-2:#D6D5CF; --muted:#A8A7A1; --head:#2B3F5C; --head-2:#35517A; --link:#7FB2F5; --hover:#262625; --track:#2C2C2A; }
.fmd-root { padding: 18px 22px 48px; }
.modal-body .fmd-root { padding: 0; }
.fmd-hero { position:relative; overflow:hidden; display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap;
	background:linear-gradient(135deg,#1e1b4b 0%,#3730a3 45%,#1d4ed8 100%); color:#fff; border-radius:16px; padding:20px 24px; margin-bottom:12px;
	box-shadow:0 10px 30px -12px rgba(30,27,75,.55); }
.fmd-hero-circle { position:absolute; border-radius:50%; background:rgba(255,255,255,.07); }
.fmd-hero-left { display:flex; align-items:center; gap:14px; position:relative; }
.fmd-hero-icon { width:46px; height:46px; border-radius:12px; background:rgba(255,255,255,.15); border:1px solid rgba(255,255,255,.25);
	display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.fmd-eyebrow { font-size:10.5px; letter-spacing:.09em; text-transform:uppercase; color:rgba(255,255,255,.72); font-weight:600; }
.fmd-title { font-size:22px; font-weight:750; margin-top:2px; }
.fmd-sub { font-size:12.5px; color:rgba(255,255,255,.86); margin-top:2px; }
.fmd-hero-right { display:flex; gap:10px; position:relative; flex-wrap:wrap; }
.fmd-hero-stat { background:rgba(255,255,255,.13); border:1px solid rgba(255,255,255,.22); border-radius:12px; padding:9px 15px; min-width:118px; }
.fmd-hero-stat .v { font-size:24px; font-weight:800; line-height:1.1; }
.fmd-hero-stat .l { font-size:11px; color:rgba(255,255,255,.8); font-weight:600; }
.fmd-filters { background:var(--bg); border:1px solid var(--border); border-radius:12px; padding:10px 14px 12px; margin-bottom:14px; }
.fmd-presets { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; align-items:center; }
.fmd-presets-note { margin-left:auto; }
.fmd-preset { border:1px solid var(--border); background:var(--bg-soft); color:var(--text-2); border-radius:20px; padding:3px 12px;
	font-size:12px; font-weight:600; cursor:pointer; }
.fmd-preset:hover { border-color:#2a78d6; color:#2a78d6; }
.fmd-filter-row { display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; }
.fmd-f { display:flex; flex-direction:column; gap:3px; }
.fmd-f label { font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; margin:0; }
.fmd-f input[type=date] { height:32px; border:1px solid var(--border); border-radius:8px; padding:0 8px; font-size:12.5px; background:var(--bg); color:var(--text); }
.fmd-f-btns { flex-direction:row; gap:6px; margin-left:auto; }
.fmd-ms { position:relative; min-width:160px; max-width:230px; }
.fmd-ms-box { display:flex; flex-wrap:wrap; align-items:center; gap:4px; padding:3px 8px; border:1px solid var(--border);
	border-radius:8px; background:var(--bg); cursor:pointer; min-height:32px; }
.fmd-ms.open .fmd-ms-box { border-color:#274C77; box-shadow:0 0 0 3px rgba(39,76,119,.15); }
.fmd-ms-ph { font-size:12.5px; color:var(--muted); }
.fmd-ms-chip { display:inline-flex; align-items:center; gap:4px; background:rgba(42,120,214,.12); color:var(--text-2); border-radius:6px;
	padding:1px 5px 1px 7px; font-size:11px; font-weight:600; max-width:120px; }
.fmd-ms-chip .txt { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.fmd-ms-chip .x { cursor:pointer; opacity:.7; }
.fmd-ms-more { font-size:11px; color:var(--muted); font-weight:600; }
.fmd-ms-panel { display:none; position:absolute; top:calc(100% + 4px); left:0; z-index:60; background:var(--bg);
	border:1px solid var(--border); border-radius:10px; box-shadow:0 10px 24px -8px rgba(16,24,40,.25);
	width:max(100%,270px); max-width:min(360px,90vw); max-height:300px; overflow-y:auto; }
.fmd-ms.open .fmd-ms-panel { display:block; }
.fmd-ms-search { position:sticky; top:0; background:var(--bg); padding:6px; border-bottom:1px solid var(--border-soft); }
.fmd-ms-search input { width:100%; padding:5px 8px; border:1px solid var(--border); border-radius:6px; font-size:12px; background:var(--bg); color:var(--text); }
.fmd-ms-actions { display:flex; justify-content:space-between; padding:5px 8px; border-bottom:1px solid var(--border-soft); font-size:11px; }
.fmd-ms-actions a { color:var(--link); cursor:pointer; font-weight:600; }
.fmd-ms-opt { display:flex; gap:8px; padding:6px 10px; font-size:12px; cursor:pointer; margin:0; font-weight:400; color:var(--text); }
.fmd-ms-opt:hover { background:var(--hover); }
.fmd-ms-empty { padding:10px; font-size:12px; color:var(--muted); text-align:center; }
.fmd-group-label { font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.08em; margin:4px 2px 6px; }
.fmd-cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(170px,1fr)); gap:10px; margin-bottom:12px; }
.fmd-card { position:relative; border:1px solid color-mix(in srgb, var(--c) 28%, transparent); border-left:5px solid var(--c);
	background:color-mix(in srgb, var(--c) 7%, var(--bg)); border-radius:12px; padding:11px 13px; }
.fmd-card.is-click { cursor:pointer; transition:transform .12s ease, box-shadow .12s ease; }
.fmd-card.is-click:hover { transform:translateY(-2px); box-shadow:0 8px 20px rgba(15,23,42,.12); }
.fmd-card-top { display:flex; justify-content:space-between; align-items:flex-start; }
.fmd-card-value { font-size:26px; font-weight:800; line-height:1.1; color:var(--text); }
.fmd-card-icon { font-size:15px; color:var(--c); }
.fmd-card-label { font-size:12.5px; font-weight:700; color:var(--text); margin-top:3px; }
.fmd-card-hint { font-size:11px; color:var(--muted); }
.fmd-panel { background:var(--bg); border:1px solid var(--border); border-radius:12px; margin-bottom:14px; overflow:hidden; min-width:0; }
.fmd-panel-head { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;
	padding:11px 14px; border-bottom:1px solid var(--border-soft); }
.fmd-panel-title { font-size:14px; font-weight:700; color:var(--text); }
.fmd-panel-sub { font-size:11.5px; color:var(--muted); }
.fmd-panel-tools { display:flex; gap:6px; align-items:center; }
.fmd-panel-body { padding:12px 14px; }
.fmd-search { height:28px; border:1px solid var(--border); border-radius:7px; padding:0 9px; font-size:12px; width:220px; background:var(--bg); color:var(--text); }
.fmd-two { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.fmd-two > .fmd-panel { margin-bottom:14px; }
.fmd-table-scroll { max-height:520px; overflow:auto; }
.fmd-table-scroll.fmd-short { max-height:360px; }
.fmd-dd-scroll { max-height:65vh; overflow:auto; border:1px solid var(--border); border-radius:8px; }
.fmd-table { width:100%; border-collapse:collapse; font-size:12.5px; color:var(--text); }
.fmd-table th { position:sticky; top:0; z-index:2; background:var(--head); color:#fff; text-align:left; font-weight:600;
	padding:8px 10px; white-space:nowrap; cursor:pointer; user-select:none; font-size:11.5px; }
.fmd-table th.is-sorted { background:var(--head-2); }
.fmd-sort { opacity:.6; font-size:9px; margin-left:3px; }
.fmd-table td { padding:7px 10px; border-bottom:1px solid var(--border-soft); vertical-align:top; }
.fmd-table td.nw, .fmd-nw { white-space:nowrap; }
.fmd-table tbody tr:hover td { background:var(--hover); }
.fmd-pill { display:inline-block; border:1px solid color-mix(in srgb, var(--c) 45%, transparent); color:var(--c);
	background:color-mix(in srgb, var(--c) 10%, transparent); border-radius:20px; padding:1px 8px; font-size:10.5px; font-weight:700; white-space:nowrap; }
:root[data-theme="dark"] .fmd-pill { color:color-mix(in srgb, var(--c) 70%, #fff); }
.fmd-warn { color:#b42318; font-size:10.5px; font-weight:700; margin-top:2px; white-space:nowrap; }
.fmd-red { color:#d03b3b; }
.fmd-cand { font-weight:600; cursor:pointer; color:var(--link); }
.fmd-muted { color:var(--muted); font-size:11px; }
.fmd-num { font-weight:700; cursor:pointer; color:var(--link); }
.fmd-num.is-red { color:#d03b3b; }
.fmd-zero { color:var(--border); }
.fmd-empty { padding:24px; text-align:center; color:var(--muted); font-size:13px; }
.fmd-score { min-width:84px; }
.fmd-score b { font-size:12.5px; }
.fmd-score-track { height:5px; background:var(--track); border-radius:99px; overflow:hidden; margin-top:3px; }
.fmd-score-track > div { height:100%; border-radius:99px; }
/* full data tabs */
.fmd-tabs-bar { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;
	padding:10px 14px; border-bottom:1px solid var(--border-soft); background:var(--bg-soft); }
.fmd-tabs { display:inline-flex; gap:4px; background:var(--track); padding:3px; border-radius:10px; flex-wrap:wrap; }
.fmd-tabs button { border:0; background:transparent; color:var(--text-2); font-size:12.5px; font-weight:650; padding:6px 14px;
	border-radius:8px; cursor:pointer; display:inline-flex; align-items:center; gap:7px; }
.fmd-tabs button.is-on { background:var(--bg); color:var(--text); box-shadow:0 1px 3px rgba(15,23,42,.14); }
.fmd-badge { background:#2a78d6; color:#fff; border-radius:20px; padding:0 7px; font-size:10.5px; font-weight:700; line-height:17px; }
.fmd-tabs button:not(.is-on) .fmd-badge { background:var(--muted); }
.fmd-dl { flex-wrap:wrap; }
.fmd-raw .fmd-table td { white-space:nowrap; }
.fmd-trunc { display:block; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
a.fmd-trunc { color:var(--link); }
.fmd-more { display:flex; align-items:center; gap:10px; padding:10px 14px; font-size:12px; color:var(--text-2);
	border-top:1px solid var(--border-soft); background:var(--bg-soft); position:sticky; left:0; }
/* funnel / section bars */
.fmd-fun-row, .fmd-sec-row { display:grid; grid-template-columns:minmax(120px,190px) 1fr 86px; align-items:center; gap:10px;
	padding:6px 6px; border-radius:8px; cursor:pointer; }
.fmd-fun-row:hover, .fmd-sec-row:hover { background:var(--hover); }
.fmd-sec-row.is-static { cursor:default; grid-template-columns:minmax(120px,240px) 1fr 86px; }
.fmd-fun-label, .fmd-sec-name { font-size:12.5px; font-weight:600; color:var(--text-2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.fmd-fun-track { height:22px; background:var(--track); border-radius:6px; overflow:hidden; }
.fmd-fun-bar { height:100%; border-radius:0 4px 4px 0; background:#2a78d6; transition:width .5s ease; }
.fmd-fun-val { font-size:12.5px; text-align:right; white-space:nowrap; }
/* histogram */
.fmd-legend { display:flex; gap:12px; flex-wrap:wrap; }
.fmd-leg { display:inline-flex; align-items:center; gap:5px; font-size:11px; color:var(--text-2); font-weight:600; }
.fmd-leg .sw { width:10px; height:10px; border-radius:3px; }
.fmd-hist { position:relative; height:190px; display:flex; align-items:flex-end; gap:2px; margin:16px 0 0 22px;
	border-bottom:1px solid var(--border); }
.fmd-hist-grid { position:absolute; inset:0; pointer-events:none; }
.fmd-hist-gl { position:absolute; left:0; right:0; border-top:1px dashed var(--border-soft); }
.fmd-hist-gl span { position:absolute; left:-24px; top:-7px; font-size:10px; color:var(--muted); width:20px; text-align:right; }
.fmd-hist-col { position:relative; flex:1; height:100%; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; }
.fmd-hist-col.is-click { cursor:pointer; }
.fmd-hist-col.is-click:hover .fmd-hist-bar { filter:brightness(1.12); }
.fmd-hist-bar { width:100%; border-radius:4px 4px 0 0; min-height:0; transition:height .5s ease; }
.fmd-hist-n { font-size:10px; font-weight:700; color:var(--text-2); margin-bottom:2px; }
.fmd-hist-cut { position:absolute; top:-12px; bottom:0; border-left:1.5px dashed var(--muted); pointer-events:none; }
.fmd-hist-cut span { position:absolute; top:-4px; left:4px; font-size:10px; font-weight:700; color:var(--muted); }
.fmd-hist-axis { position:relative; height:16px; margin:3px 0 0 22px; }
.fmd-hist-axis span { position:absolute; transform:translateX(-50%); font-size:10px; color:var(--muted); }
.fmd-hist-axis span:first-child { transform:none; }
.fmd-hist-axis span:last-child { transform:translateX(-100%); }
.fmd-tip { position:fixed; z-index:1100; pointer-events:none; background:#0F172A; color:#fff; font-size:11.5px; line-height:1.45;
	padding:6px 9px; border-radius:7px; box-shadow:0 6px 18px rgba(0,0,0,.25); opacity:0; transition:opacity .1s ease; max-width:280px; }
.fmd-tip.show { opacity:1; }
/* drilldown + detail */
.fmd-dd-bar { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
.fmd-detail-top { display:flex; justify-content:flex-end; gap:6px; }
.fmd-sec { font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.07em; margin:14px 0 6px; }
.fmd-profile { display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:8px 16px;
	background:var(--bg-soft); border:1px solid var(--border); border-radius:10px; padding:12px 14px; }
.fmd-pv { font-size:13px; font-weight:600; color:var(--text); overflow-wrap:anywhere; }
.fmd-journey { display:flex; gap:0; overflow-x:auto; padding:6px 2px 4px; }
.fmd-step { position:relative; min-width:200px; max-width:240px; padding:18px 12px 4px 0; border-top:3px solid #2a78d6; margin-right:6px; }
.fmd-step.is-done { border-top-color:#94A3B8; }
.fmd-step-dot { position:absolute; top:-8px; left:0; width:13px; height:13px; border-radius:50%; background:#2a78d6; border:2px solid var(--bg); }
.fmd-step.is-done .fmd-step-dot { background:#94A3B8; }
.fmd-step-title { font-size:12.5px; font-weight:700; color:var(--text); }
.fmd-res { border:1px solid var(--border); border-radius:12px; background:var(--bg); padding:12px 14px; margin-bottom:10px; }
.fmd-res-head { display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center; font-size:12.5px;
	border-bottom:1px solid var(--border-soft); padding-bottom:8px; margin-bottom:10px; }
.fmd-res-links { display:flex; gap:12px; }
.fmd-res-links a { font-weight:600; color:var(--link); }
.fmd-res-body { display:flex; gap:20px; align-items:center; flex-wrap:wrap; }
.fmd-res-stats { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px 16px; flex:1; min-width:220px; }
.fmd-ring { width:104px; height:104px; border-radius:50%; flex-shrink:0;
	background:conic-gradient(var(--c) calc(var(--p) * 1%), var(--track) 0); display:flex; align-items:center; justify-content:center; }
.fmd-ring-in { width:80px; height:80px; border-radius:50%; background:var(--bg); display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; }
.fmd-ring-in b { font-size:19px; line-height:1.1; }
.fmd-ring-in span { font-size:9.5px; color:var(--muted); font-weight:600; padding:0 6px; }
.fmd-sub-title { font-size:11px; font-weight:700; color:var(--link); text-transform:uppercase; letter-spacing:.05em; margin:12px 0 4px; }
.fmd-note { background:var(--bg-soft); border:1px solid var(--border-soft); border-radius:8px; padding:8px 10px; font-size:12.5px; white-space:pre-wrap; overflow-wrap:anywhere; }
.fmd-answers { margin-top:10px; }
.fmd-answers summary { cursor:pointer; font-size:11px; font-weight:700; color:var(--link); text-transform:uppercase; letter-spacing:.05em; }
.fmd-qa { border-left:3px solid var(--border); padding:4px 0 4px 10px; margin:8px 0; }
.fmd-q { font-size:12.5px; font-weight:700; color:var(--text); white-space:pre-wrap; }
.fmd-a { font-size:12.5px; color:var(--text-2); white-space:pre-wrap; overflow-wrap:anywhere; margin-top:3px; }
@media (max-width: 1100px) { .fmd-two { grid-template-columns:1fr; } }
@media (max-width: 900px) { .fmd-f-btns { margin-left:0; } .fmd-hero-right { width:100%; } .fmd-presets-note { margin-left:0; } }
@media (max-width: 600px) { .fmd-root { padding:12px 10px 40px; } .fmd-search { width:100%; } .fmd-ms { max-width:none; width:100%; }
	.fmd-f { width:100%; } .fmd-fun-row, .fmd-sec-row, .fmd-sec-row.is-static { grid-template-columns:110px 1fr 70px; } }
`;
