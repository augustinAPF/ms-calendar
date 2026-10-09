// Field Interview Dashboard — /app/field-interview-dashboard
//
// Filters (Apply button + one-click date presets) → KPI cards → agenda
// (its own Last 7 days / Today / Next 7 days switch) → running tables
// (interviews, feedback, interviewer workload, departments).
//
// Every card and table number opens a centred
// drilldown with sortable columns and a CSV export; clicking an applicant
// there opens their full detail (profile, interviews, every feedback in
// full, PDFs on file).
//
// All numbers come from ONE permission-scoped server call
// (get_dashboard_data, which uses frappe.get_list), so cards, charts,
// drilldowns and CSV exports can never show more than the user may read.
// Every value rendered into HTML goes through esc().

const FID_API = 'ms_calendar.ms_calendar.page.field_interview_dashboard.field_interview_dashboard.';
const FID_STORE_KEY = 'fid-filters-v1';

frappe.pages['field-interview-dashboard'].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __('Field Interview Dashboard'),
		single_column: true
	});
	new FieldInterviewDashboard(page, wrapper);
};

class FieldInterviewDashboard {
	constructor(page, wrapper) {
		this.page = page;
		this.wrapper = wrapper;
		this.$root = $(wrapper).find('.page-content');
		this.rows = [];
		this.data = null;
		this.ms = {};
		this.charts = {};
		this.render_shell();
		const saved = this.read_saved();
		this.load(saved ? saved : null);
	}

	// ── helpers ────────────────────────────────────────────────────────────
	esc(v) { return frappe.utils.escape_html(v === null || v === undefined ? '' : String(v)); }
	fmt_date(d) { return d ? frappe.datetime.str_to_user(d) : ''; }
	pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }
	median(arr) {
		if (!arr.length) return null;
		const s = arr.slice().sort((a, b) => a - b);
		const m = Math.floor(s.length / 2);
		return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
	}

	read_saved() {
		let saved = null;
		try { saved = JSON.parse(localStorage.getItem(FID_STORE_KEY) || 'null'); } catch (e) { return null; }
		// Older versions saved dates too — never reopen with dates set.
		if (saved) { saved.from_date = null; saved.to_date = null; }
		return saved;
	}
	// Dates are deliberately NOT remembered: the page always opens with no
	// date filter (every interview); only department / round / interviewer /
	// mode carry over between visits.
	save_filters(f) {
		const keep = Object.assign({}, f, { from_date: null, to_date: null });
		try { localStorage.setItem(FID_STORE_KEY, JSON.stringify(keep)); } catch (e) { /* private mode etc. */ }
	}

	// ── layout ─────────────────────────────────────────────────────────────
	render_shell() {
		this.$root.html(`
			<style>${FID_CSS}</style>
			<div class="fid-root">
				<div class="fid-hero">
					<div class="fid-hero-circle" style="top:-50px;right:-40px;width:180px;height:180px;"></div>
					<div class="fid-hero-circle" style="bottom:-70px;right:160px;width:130px;height:130px;"></div>
					<div>
						<div class="fid-eyebrow">Interview Management System</div>
						<div class="fid-title">${__('Field Interview Dashboard')}</div>
						<div class="fid-sub" id="fid-sub">${__('Loading…')}</div>
					</div>
					<div class="fid-hero-right" id="fid-hero-right"></div>
				</div>

				<div class="fid-filters">
					<div class="fid-presets">
						${[['today', __('Today')], ['week', __('This week')], ['next7', __('Next 7 days')],
							['month', __('This month')], ['last30', __('Last 30 days')], ['last90', __('Last 90 days')],
							['all', __('All dates')]]
							.map(([k, l]) => `<button class="fid-preset" data-p="${k}">${l}</button>`).join('')}
					</div>
					<div class="fid-filter-row">
						<div class="fid-f"><label>${__('From')}</label><input type="date" id="fid-from"></div>
						<div class="fid-f"><label>${__('To')}</label><input type="date" id="fid-to"></div>
						<div class="fid-f"><label>${__('Department')}</label><div class="fid-ms" id="fid-ms-dept" data-placeholder="${__('All departments')}"></div></div>
						<div class="fid-f"><label>${__('Round')}</label><div class="fid-ms" id="fid-ms-round" data-placeholder="${__('All rounds')}"></div></div>
						<div class="fid-f"><label>${__('Interviewer')}</label><div class="fid-ms" id="fid-ms-iv" data-placeholder="${__('All interviewers')}"></div></div>
						<div class="fid-f"><label>${__('Mode')}</label><div class="fid-ms" id="fid-ms-mode" data-placeholder="${__('All modes')}"></div></div>
						<div class="fid-f fid-f-btns">
							<button class="btn btn-primary btn-sm" id="fid-apply">${__('Apply')}</button>
							<button class="btn btn-default btn-sm" id="fid-reset">${__('Reset')}</button>
						</div>
					</div>
				</div>

				<div class="fid-cards" id="fid-cards"></div>

				<div class="fid-panel">
					<div class="fid-panel-head">
						<div>
							<div class="fid-panel-title" id="fid-agenda-title">📅 ${__('Next 7 days')}</div>
							<div class="fid-panel-sub" id="fid-agenda-sub">${__('Interviews by day')}</div>
						</div>
						<div class="fid-panel-tools">
							<div class="fid-seg" id="fid-agenda-range">
								<button data-r="last7">${__('Last 7 days')}</button>
								<button data-r="today">${__('Today')}</button>
								<button data-r="next7" class="is-on">${__('Next 7 days')}</button>
							</div>
							<button class="btn btn-default btn-xs" id="fid-export-agenda">${__('Export CSV')}</button>
						</div>
					</div>
					<div class="fid-panel-body fid-scroll-md" id="fid-agenda"></div>
				</div>


				<div class="fid-panel">
					<div class="fid-panel-head">
						<div>
							<div class="fid-panel-title">${__('Interviews')}</div>
							<div class="fid-panel-sub">${__('Latest first · click a column to sort · click an applicant for full details')}</div>
						</div>
						<div class="fid-panel-tools">
							<input type="text" class="fid-search" id="fid-search" placeholder="${__('Search applicant, ID, role…')}">
							<button class="btn btn-default btn-xs" id="fid-export-main">${__('Export CSV')}</button>
						</div>
					</div>
					<div class="fid-table-scroll" id="fid-main-table"></div>
				</div>

				<div class="fid-panel">
					<div class="fid-panel-head">
						<div>
							<div class="fid-panel-title">${__('Feedback')}</div>
							<div class="fid-panel-sub">${__('Every feedback submitted for these interviews · click "View feedback" to read it here')}</div>
						</div>
						<div class="fid-panel-tools">
							<input type="text" class="fid-search" id="fid-fb-search" placeholder="${__('Search applicant, form, panelist…')}">
							<button class="btn btn-default btn-xs" id="fid-export-fb">${__('Export CSV')}</button>
						</div>
					</div>
					<div class="fid-table-scroll" id="fid-fb-table"></div>
				</div>

				<div class="fid-two">
					<div class="fid-panel">
						<div class="fid-panel-head"><div>
							<div class="fid-panel-title">${__('Interviewer workload')}</div>
							<div class="fid-panel-sub">${__('Click any number to see those interviews')}</div>
						</div></div>
						<div class="fid-table-scroll fid-short" id="fid-iv-table"></div>
					</div>
					<div class="fid-panel">
						<div class="fid-panel-head"><div>
							<div class="fid-panel-title">${__('By department')}</div>
							<div class="fid-panel-sub">${__('Click any number to see those interviews')}</div>
						</div></div>
						<div class="fid-table-scroll fid-short" id="fid-dept-table"></div>
					</div>
				</div>
			</div>
		`);

		const $c = this.$root;
		this.ms.dept = this.make_multiselect($c.find('#fid-ms-dept'));
		this.ms.round = this.make_multiselect($c.find('#fid-ms-round'));
		this.ms.iv = this.make_multiselect($c.find('#fid-ms-iv'));
		this.ms.mode = this.make_multiselect($c.find('#fid-ms-mode'));

		$c.find('#fid-apply').on('click', () => this.load(this.current_filters()));
		$c.find('#fid-reset').on('click', () => {
			Object.values(this.ms).forEach(m => m.clear());
			$c.find('#fid-from, #fid-to').val('');
			try { localStorage.removeItem(FID_STORE_KEY); } catch (e) { /* ignore */ }
			this.load(null);
		});
		// A preset is a single-value choice, so it applies straight away.
		$c.find('.fid-preset').on('click', (e) => {
			const [from, to] = this.preset_range($(e.currentTarget).data('p'));
			$c.find('#fid-from').val(from);
			$c.find('#fid-to').val(to);
			this.load(this.current_filters());
		});
		$c.find('#fid-from, #fid-to').on('keydown', (e) => { if (e.key === 'Enter') this.load(this.current_filters()); });
		$c.find('#fid-search').on('input', frappe.utils.debounce(() => this.render_main_table(), 200));
		$c.find('#fid-fb-search').on('input', frappe.utils.debounce(() => this.render_feedback_table(), 200));
		$c.find('#fid-export-main').on('click', () => this.export_csv('field-interviews', this.interview_columns(), this.filtered_main_rows()));
		$c.find('#fid-export-fb').on('click', () => this.export_csv('field-interview-feedback', this.feedback_columns(), this.filtered_feedback_rows()));
		// The agenda's own range switch — a single choice, so it applies at once.
		this.agenda_range = 'next7';
		try { this.agenda_range = localStorage.getItem('fid-agenda-range') || 'next7'; } catch (e) { /* ignore */ }
		$c.find('#fid-agenda-range button').on('click', (e) => {
			this.agenda_range = String($(e.currentTarget).data('r'));
			try { localStorage.setItem('fid-agenda-range', this.agenda_range); } catch (err) { /* ignore */ }
			this.render_agenda();
		});
		$c.find('#fid-export-agenda').on('click', () => this.export_csv('interviews-' + this.agenda_range, this.interview_columns(), this.agenda_rows()));

		$(document).off('click.fidMs').on('click.fidMs', (e) => {
			if (!$(e.target).closest('.fid-ms').length) $c.find('.fid-ms.open').removeClass('open');
		});
	}

	preset_range(p) {
		const fmt = (d) => moment(d).format('YYYY-MM-DD');
		const t = moment().startOf('day');
		switch (p) {
			case 'today': return [fmt(t), fmt(t)];
			case 'week': return [fmt(t.clone().startOf('isoWeek')), fmt(t.clone().endOf('isoWeek'))];
			case 'next7': return [fmt(t), fmt(t.clone().add(7, 'days'))];
			case 'month': return [fmt(t.clone().startOf('month')), fmt(t.clone().endOf('month'))];
			case 'last30': return [fmt(t.clone().subtract(30, 'days')), fmt(t)];
			case 'last90': return [fmt(t.clone().subtract(90, 'days')), fmt(t)];
			default: return ['', ''];  // "All dates" — no date filter
		}
	}

	current_filters() {
		const $c = this.$root;
		return {
			from_date: $c.find('#fid-from').val() || null,
			to_date: $c.find('#fid-to').val() || null,
			departments: this.ms.dept.val(),
			rounds: this.ms.round.val(),
			interviewers: this.ms.iv.val(),
			modes: this.ms.mode.val()
		};
	}

	// Same chip multiselect as the Reports page (search, Select all / Clear,
	// checkbox list) so filters look and behave alike across dashboards.
	make_multiselect($el) {
		const esc = (v) => this.esc(v);
		const placeholder = $el.data('placeholder') || __('All');
		let options = [];
		let selected = [];
		$el.html(`
			<div class="fid-ms-box"></div>
			<div class="fid-ms-panel">
				<div class="fid-ms-search"><input type="text" placeholder="${__('Search…')}"></div>
				<div class="fid-ms-actions"><a class="fid-ms-all">${__('Select all')}</a><a class="fid-ms-none">${__('Clear')}</a></div>
				<div class="fid-ms-list"></div>
			</div>`);
		const $box = $el.find('.fid-ms-box');
		const $search = $el.find('.fid-ms-search input');
		const $list = $el.find('.fid-ms-list');

		const render_box = () => {
			$box.empty();
			if (!selected.length) { $box.append(`<span class="fid-ms-ph">${esc(placeholder)}</span>`); return; }
			selected.slice(0, 2).forEach(v => $box.append(
				`<span class="fid-ms-chip" title="${esc(v)}"><span class="txt">${esc(v)}</span><span class="x" data-v="${esc(v)}">&times;</span></span>`));
			if (selected.length > 2) $box.append(`<span class="fid-ms-more">+${selected.length - 2}</span>`);
		};
		const render_list = () => {
			const q = ($search.val() || '').toLowerCase();
			const matches = options.filter(v => v.toLowerCase().includes(q));
			$list.html(matches.length ? matches.map(v => `
				<label class="fid-ms-opt"><input type="checkbox" data-v="${esc(v)}" ${selected.includes(v) ? 'checked' : ''}>
				<span>${esc(v)}</span></label>`).join('') : `<div class="fid-ms-empty">${__('No matches')}</div>`);
		};
		$box.on('click', (e) => {
			if ($(e.target).hasClass('x')) return;
			const open = $el.hasClass('open');
			$('.fid-ms.open').removeClass('open');
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
		$el.find('.fid-ms-all').on('click', (e) => {
			e.stopPropagation();
			const q = ($search.val() || '').toLowerCase();
			selected = [...new Set([...selected, ...options.filter(v => v.toLowerCase().includes(q))])];
			render_box(); render_list();
		});
		$el.find('.fid-ms-none').on('click', (e) => { e.stopPropagation(); selected = []; render_box(); render_list(); });
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
			rounds: JSON.stringify(f.rounds || []),
			interviewers: JSON.stringify(f.interviewers || []),
			modes: JSON.stringify(f.modes || [])
		} : {};
		$c.find('#fid-apply').prop('disabled', true).text(__('Loading…'));
		frappe.call({
			method: FID_API + 'get_dashboard_data',
			args,
			callback: (r) => {
				this.data = r.message || {};
				this.rows = this.data.rows || [];
				const o = this.data.options || {};
				this.ms.dept.setOptions(o.departments || []);
				this.ms.round.setOptions(o.rounds || []);
				this.ms.iv.setOptions(o.interviewers || []);
				this.ms.mode.setOptions(o.modes || []);
				if (filters) {
					this.ms.dept.setVal(f.departments); this.ms.round.setVal(f.rounds);
					this.ms.iv.setVal(f.interviewers); this.ms.mode.setVal(f.modes);
					this.save_filters(f);
				}
				$c.find('#fid-from').val(this.data.from_date);
				$c.find('#fid-to').val(this.data.to_date);
				const fd = this.data.from_date, td = this.data.to_date;
				const range = fd && td ? __('{0} to {1}', [this.fmt_date(fd), this.fmt_date(td)])
					: fd ? __('From {0}', [this.fmt_date(fd)])
					: td ? __('Up to {0}', [this.fmt_date(td)])
					: __('All dates');
				$c.find('#fid-sub').text(__('{0} · {1} interviews · updated {2}', [range, this.rows.length, frappe.datetime.now_time()])
					+ (this.data.truncated ? ' · ' + __('showing first 5000 — narrow the dates') : ''));
				this.render_all();
			},
			always: () => $c.find('#fid-apply').prop('disabled', false).text(__('Apply'))
		});
	}

	render_all() {
		this.render_hero_right();
		this.render_cards();
		this.render_agenda();
		this.render_main_table();
		this.render_feedback_table();
		this.render_interviewer_table();
		this.render_department_table();
	}

	// ── hero ───────────────────────────────────────────────────────────────
	render_hero_right() {
		const decided = this.rows.filter(r => r.outcome === 'Interview Select' || r.outcome === 'Interview Reject');
		const sel = decided.filter(r => r.outcome === 'Interview Select').length;
		const done = this.rows.filter(r => r.status === 'Completed');
		const fb = done.filter(r => r.feedback === 'Received').length;
		const need = done.filter(r => r.feedback === 'Received' || r.feedback === 'Pending').length;
		this.$root.find('#fid-hero-right').html(`
			<div class="fid-hero-stat"><div class="v">${this.pct(fb, need)}%</div><div class="l">${__('Feedback completion')}</div></div>
			<div class="fid-hero-stat"><div class="v">${decided.length ? this.pct(sel, decided.length) + '%' : '—'}</div><div class="l">${__('Selection rate')}</div></div>`);
	}

	// ── cards ──────────────────────────────────────────────────────────────
	card_defs() {
		const R = this.rows;
		const live = R.filter(r => r.status !== 'Cancelled');
		const decided = R.filter(r => r.outcome === 'Interview Select' || r.outcome === 'Interview Reject');
		const selected = R.filter(r => r.outcome === 'Interview Select');
		const turn = R.filter(r => r.turnaround_days !== null && r.turnaround_days !== undefined);
		const avg_turn = turn.length ? (turn.reduce((s, r) => s + r.turnaround_days, 0) / turn.length) : null;
		const med = this.median(turn.map(r => r.turnaround_days));
		return [
			{ key: 'total', label: __('Interviews'), hint: this.data.from_date || this.data.to_date ? __('In the selected dates') : __('All dates'), color: '#1F3A5F', rows: R },
			{ key: 'today', label: __('Today'), hint: __('Scheduled for today'), color: '#2a78d6', rows: R.filter(r => r.status === 'Today') },
			{ key: 'upcoming', label: __('Upcoming'), hint: __('After today'), color: '#4a3aa7', rows: R.filter(r => r.status === 'Upcoming') },
			{ key: 'pending', label: __('Feedback pending'), hint: __('Interview done, no feedback yet'), color: '#d03b3b', icon: '⚠', rows: R.filter(r => r.feedback === 'Pending') },
			{ key: 'overdue', label: __('Overdue > 2 days'), hint: __('Pending feedback, chase now'), color: '#b42318', icon: '⏰', rows: R.filter(r => r.feedback === 'Pending' && r.days_waiting > 2) },
			{ key: 'received', label: __('Feedback received'), hint: __('At least one submission'), color: '#0ca30c', icon: '✓', rows: R.filter(r => r.feedback === 'Received') },
			{ key: 'selrate', label: __('Selection rate'), hint: __('{0} select · {1} reject', [selected.length, decided.length - selected.length]), color: '#008300',
				value: decided.length ? this.pct(selected.length, decided.length) + '%' : '—', rows: decided },
			{ key: 'turn', label: __('Avg days to feedback'), hint: med === null ? __('No feedback yet') : __('Median {0} days', [med]), color: '#1c5cab',
				value: avg_turn === null ? '—' : avg_turn.toFixed(1), rows: turn },
			{ key: 'noinvite', label: __('Invite not sent'), hint: __('No calendar event created'), color: '#c98500', icon: '⚠', rows: live.filter(r => !r.invite_sent) },
			{ key: 'rescheduled', label: __('Rescheduled'), hint: __('Modified after scheduling'), color: '#0F766E', rows: R.filter(r => r.rescheduled) },
			{ key: 'cancelled', label: __('Cancelled'), hint: __('Within these filters'), color: '#64748B', rows: R.filter(r => r.status === 'Cancelled') },
			{ key: 'alltime', label: __('All-time interviews'), hint: __('ALL-TIME · ignores filters'), color: '#0F172A', value: this.data.all_time_total, rows: null }
		];
	}

	render_cards() {
		const $cards = this.$root.find('#fid-cards');
		const defs = this.card_defs();
		$cards.html(defs.map(d => `
			<div class="fid-card ${d.rows ? 'is-click' : ''}" data-key="${d.key}" style="--c:${d.color};">
				<div class="fid-card-top">
					<div class="fid-card-value">${this.esc(d.value !== undefined ? d.value : d.rows.length)}</div>
					${d.icon ? `<div class="fid-card-icon">${d.icon}</div>` : ''}
				</div>
				<div class="fid-card-label">${this.esc(d.label)}</div>
				<div class="fid-card-hint">${this.esc(d.hint)}</div>
			</div>`).join(''));
		$cards.find('.fid-card.is-click').on('click', (e) => {
			const d = defs.find(x => x.key === $(e.currentTarget).data('key'));
			this.open_drilldown(d.label, d.rows);
		});
	}

	// ── agenda (own range switch: last 7 days / today / next 7 days) ──────
	agenda_rows() {
		const today = this.data.today;
		const r = this.agenda_range;
		let from, to;
		if (r === 'last7') { from = moment(today).subtract(7, 'days').format('YYYY-MM-DD'); to = moment(today).subtract(1, 'days').format('YYYY-MM-DD'); }
		else if (r === 'today') { from = today; to = today; }
		else { from = today; to = moment(today).add(7, 'days').format('YYYY-MM-DD'); }
		this._agenda_span = [from, to];
		const rows = this.rows.filter(x => x.date && x.date >= from && x.date <= to);
		// Past week: most recent day first; today / upcoming: soonest first.
		const key = (x) => x.date + this.time_key(x.start);
		return rows.sort((a, b) => r === 'last7' ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b)));
	}

	render_agenda() {
		const today = this.data.today;
		const r = this.agenda_range;
		const rows = this.agenda_rows();
		const [from, to] = this._agenda_span;
		this.$root.find('#fid-agenda-range button').each((i, b) => $(b).toggleClass('is-on', $(b).data('r') === r));
		const titles = { last7: __('Last 7 days'), today: __('Today'), next7: __('Next 7 days') };
		this.$root.find('#fid-agenda-title').text('📅 ' + titles[r]);
		this.$root.find('#fid-agenda-sub').text(__('{0} to {1} · {2} {3}', [this.fmt_date(from), this.fmt_date(to), rows.length,
			rows.length === 1 ? __('interview') : __('interviews')]));

		const $el = this.$root.find('#fid-agenda');
		const in_range = (!this.data.from_date || this.data.from_date <= from) && (!this.data.to_date || this.data.to_date >= to);
		if (!rows.length) {
			$el.html(`<div class="fid-empty">${__('No interviews in this period.')}${in_range ? '' : ' ' + __('(Part of it is outside the From / To dates above — widen them to include it.)')}</div>`);
			return;
		}
		const by_day = {};
		rows.forEach(x => (by_day[x.date] = by_day[x.date] || []).push(x));
		$el.html(Object.keys(by_day).map(day => {
			const diff = moment(day).diff(moment(today), 'days');
			const label = diff === 0 ? __('Today') : diff === 1 ? __('Tomorrow') : diff === -1 ? __('Yesterday') : moment(day).format('dddd');
			return `<div class="fid-day">
				<div class="fid-day-head"><span>${this.esc(label)}</span><span class="fid-muted">${this.esc(this.fmt_date(day))} · ${by_day[day].length}</span></div>
				${by_day[day].map(x => `
					<div class="fid-agenda-row">
						<div class="fid-agenda-time">${this.esc(x.start || '—')}</div>
						<div class="fid-agenda-main">
							<a class="fid-cand" data-app="${this.esc(x.application_id)}">${this.esc(x.applicant || x.application_id)}</a>
							<span class="fid-muted"> · ${this.esc(x.round)}</span>
							<div class="fid-muted">${this.esc(x.department)} · ${this.esc(x.mode)}${(x.interviewers || []).length ? ' · ' + this.esc(x.interviewers.join(', ')) : ''}</div>
						</div>
						${x.status === 'Cancelled' ? this.status_pill('Cancelled') : ''}
						${x.status === 'Completed' ? this.status_pill(x.feedback) + this.status_pill(x.outcome) : ''}
						${x.status !== 'Completed' && x.status !== 'Cancelled' && !x.invite_sent ? `<span class="fid-pill" style="--c:#c98500;">⚠ ${__('No invite')}</span>` : ''}
					</div>`).join('')}
			</div>`;
		}).join(''));
		this.bind_candidate_links($el);
	}

	time_key(t) {
		const m = moment(String(t || ''), ['hh:mm:ss A', 'h:mm A', 'HH:mm:ss', 'HH:mm'], true);
		return m.isValid() ? m.format('HH:mm') : '99:99';
	}

	// ── tables ─────────────────────────────────────────────────────────────
	status_pill(v) {
		const c = { Upcoming: '#4a3aa7', Today: '#2a78d6', Completed: '#475569', Cancelled: '#64748B',
			Received: '#0ca30c', Pending: '#d03b3b', 'Not due': '#c98500', 'No form': '#64748B', '—': '#94A3B8',
			'Interview Select': '#0ca30c', 'Interview Reject': '#d03b3b', 'On Hold': '#c98500' }[v] || '#475569';
		if (!v) return '';
		const icon = { 'Interview Select': '✓ ', 'Interview Reject': '✕ ', 'On Hold': '⏸ ', Pending: '⚠ ', Received: '✓ ' }[v] || '';
		return `<span class="fid-pill" style="--c:${c};">${icon}${this.esc(v)}</span>`;
	}

	interview_columns() {
		return [
			{ key: 'date', label: __('Date'), nw: true, render: r => this.esc(this.fmt_date(r.date)), csv: r => r.date },
			{ key: 'start', label: __('Time'), nw: true, sort: r => this.time_key(r.start), render: r => this.esc(r.start + (r.end ? ' – ' + r.end : '')), csv: r => r.start + (r.end ? ' - ' + r.end : '') },
			{ key: 'applicant', label: __('Applicant'), render: r => `<a class="fid-cand" data-app="${this.esc(r.application_id)}">${this.esc(r.applicant || r.application_id)}</a><div class="fid-muted">${this.esc(r.application_id)}</div>`, csv: r => r.applicant },
			{ key: 'application_id', label: __('Application ID'), hidden: true },
			{ key: 'round', label: __('Round') },
			{ key: 'department', label: __('Department') },
			{ key: 'role', label: __('Role') },
			{ key: 'mode', label: __('Mode') },
			{ key: 'interviewers', label: __('Interviewers'), sort: r => (r.interviewers || []).join(', '), render: r => this.esc((r.interviewers || []).join(', ')), csv: r => (r.interviewers || []).join('; ') },
			{ key: 'status', label: __('Status'), render: r => this.status_pill(r.status) },
			{ key: 'rescheduled', label: __('Modified'), sort: r => r.rescheduled || 0,
				render: r => r.rescheduled ? `<span class="fid-pill" style="--c:#0F766E;">↻ ${__('Rescheduled')} ×${cint(r.rescheduled)}</span>` : '',
				csv: r => r.rescheduled ? `Rescheduled x${r.rescheduled}` : '' },
			{ key: 'feedback', label: __('Feedback'), render: r => this.status_pill(r.feedback) + (r.days_waiting ? `<div class="fid-muted">${cint(r.days_waiting)} ${__('days waiting')}</div>` : '') },
			{ key: 'outcome', label: __('Outcome'), render: r => this.status_pill(r.outcome) },
			{ key: 'turnaround_days', label: __('Days to feedback'), sort: r => r.turnaround_days === null ? 9999 : r.turnaround_days,
				render: r => r.turnaround_days === null || r.turnaround_days === undefined ? '' : this.esc(r.turnaround_days) },
			{ key: 'name', label: __('Schedule'), render: r => `<a href="/app/field-interview-schedule/${encodeURIComponent(r.name)}" target="_blank">${this.esc(r.name)}</a>` }
		];
	}

	filtered_main_rows() {
		const q = (this.$root.find('#fid-search').val() || '').toLowerCase().trim();
		if (!q) return this.rows;
		return this.rows.filter(r => [r.applicant, r.application_id, r.role, r.round, r.department, r.name]
			.join(' ').toLowerCase().includes(q));
	}

	render_main_table() {
		this.sortable_table(this.$root.find('#fid-main-table'), this.interview_columns(), this.filtered_main_rows());
	}

	// ── feedback panel ────────────────────────────────────────────────────
	feedback_columns() {
		return [
			{ key: 'submitted_on', label: __('Submitted'), nw: true, render: r => this.esc(frappe.datetime.str_to_user(r.submitted_on)), csv: r => r.submitted_on },
			{ key: 'applicant', label: __('Applicant'), render: r => `<a class="fid-cand" data-app="${this.esc(r.application_id)}">${this.esc(r.applicant || r.application_id)}</a><div class="fid-muted">${this.esc(r.application_id)}</div>`, csv: r => r.applicant },
			{ key: 'application_id', label: __('Application ID'), hidden: true },
			{ key: 'doctype', label: __('Feedback form') },
			{ key: 'by', label: __('Submitted by') },
			{ key: 'result', label: __('Result'), render: r => this.status_pill(r.result) },
			{ key: 'name', label: '', sort: r => r.name, render: r => `<a class="fid-fb-open" data-dt="${this.esc(r.doctype)}" data-name="${this.esc(r.name)}">${__('View feedback')} ▾</a>`, csv: r => r.name }
		];
	}

	filtered_feedback_rows() {
		const all = (this.data && this.data.feedback) || [];
		const q = (this.$root.find('#fid-fb-search').val() || '').toLowerCase().trim();
		if (!q) return all;
		return all.filter(r => [r.applicant, r.application_id, r.doctype, r.by, r.result].join(' ').toLowerCase().includes(q));
	}

	render_feedback_table() {
		const $el = this.$root.find('#fid-fb-table');
		this.sortable_table($el, this.feedback_columns(), this.filtered_feedback_rows(), { empty: __('No feedback submitted for these interviews yet.') });
		// "View feedback" opens the full feedback right under that row (click again to close).
		$el.off('click.fidfb').on('click.fidfb', '.fid-fb-open', (e) => {
			e.preventDefault();
			const $a = $(e.currentTarget);
			const $tr = $a.closest('tr');
			const $next = $tr.next('.fid-fb-detail-row');
			if ($next.length) { $next.remove(); $a.html(`${__('View feedback')} ▾`); return; }
			const span = $tr.children('td').length;
			const $row = $(`<tr class="fid-fb-detail-row"><td colspan="${span}"><div class="fid-muted">${__('Loading…')}</div></td></tr>`);
			$tr.after($row);
			$a.html(`${__('Hide')} ▴`);
			frappe.call({
				method: FID_API + 'get_feedback_detail',
				args: { doctype: String($a.data('dt')), name: String($a.data('name')) },
				callback: (r) => $row.find('td').html(this.feedback_body_html(r.message)),
				error: () => $row.find('td').html(`<div class="fid-muted">${__('Could not load this feedback.')}</div>`)
			});
		});
	}

	// Full content of one feedback submission — every value escaped.
	feedback_body_html(f) {
		if (!f) return '';
		const esc = (v) => this.esc(v);
		const slug = (dt) => dt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
		const sections = (f.sections || []).map(s => `
			<div class="fid-fb-sec">
				${s.title ? `<div class="fid-fb-sec-title">${esc(s.title)}</div>` : ''}
				<div class="fid-fb-grid">${(s.fields || []).map(x => `
					<div class="${x.long ? 'is-long' : ''}"><div class="fid-muted">${esc(x.label)}</div>
					<div class="fid-fb-val">${esc(x.value).replace(/\n/g, '<br>')}</div></div>`).join('')}
				</div>
				${(s.tables || []).map(tb => `
					<div class="fid-muted" style="margin-top:6px;">${esc(tb.label)}</div>
					<table class="fid-table fid-fb-child"><thead><tr>${tb.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
					<tbody>${tb.rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`).join('')}
			</div>`).join('');
		return `<div class="fid-fb-card">
			<div class="fid-fb-head">
				<div><b>${esc(f.doctype)}</b> · ${esc(frappe.datetime.str_to_user(f.submitted_on))} · ${__('by')} ${esc(f.by)} ${this.status_pill(f.result)}</div>
				<a target="_blank" href="/app/${slug(f.doctype)}/${encodeURIComponent(f.name)}">${__('Open record')} ↗</a>
			</div>
			${sections || `<div class="fid-muted">${__('No answers filled in.')}</div>`}
		</div>`;
	}

	// ── breakdown tables ──────────────────────────────────────────────────
	render_breakdown($el, first_label, groups, with_quality) {
		const metrics = [
			{ key: 'total', label: __('Total'), f: () => true },
			{ key: 'upcoming', label: __('Today + upcoming'), f: r => r.status === 'Today' || r.status === 'Upcoming' },
			{ key: 'done', label: __('Completed'), f: r => r.status === 'Completed' },
			{ key: 'pending', label: __('Feedback pending'), f: r => r.feedback === 'Pending' },
			{ key: 'cancelled', label: __('Cancelled'), f: r => r.status === 'Cancelled' }
		];
		const lines = Object.keys(groups).map(k => {
			const line = { label: k };
			metrics.forEach(m => { line[m.key] = groups[k].filter(m.f); });
			const turn = groups[k].filter(r => r.turnaround_days !== null && r.turnaround_days !== undefined).map(r => r.turnaround_days);
			line.avg_turn = turn.length ? turn.reduce((a, b) => a + b, 0) / turn.length : null;
			const dec = groups[k].filter(r => r.outcome === 'Interview Select' || r.outcome === 'Interview Reject');
			line.sel_rate = dec.length ? this.pct(dec.filter(r => r.outcome === 'Interview Select').length, dec.length) : null;
			return line;
		});
		let cols = [{ key: 'label', label: first_label }].concat(metrics.map(m => ({
			key: m.key, label: m.label,
			sort: l => l[m.key].length,
			csv: l => l[m.key].length,
			render: l => l[m.key].length
				? `<a class="fid-num ${m.key === 'pending' ? 'is-red' : ''}" data-label="${this.esc(l.label)}" data-metric="${m.key}">${l[m.key].length}</a>`
				: '<span class="fid-zero">0</span>'
		})));
		if (with_quality) {
			cols = cols.concat([
				{ key: 'avg_turn', label: __('Avg days to feedback'), sort: l => l.avg_turn === null ? 9999 : l.avg_turn,
					render: l => l.avg_turn === null ? '<span class="fid-zero">—</span>' : this.esc(l.avg_turn.toFixed(1)),
					csv: l => l.avg_turn === null ? '' : l.avg_turn.toFixed(1) },
				{ key: 'sel_rate', label: __('Selection rate'), sort: l => l.sel_rate === null ? -1 : l.sel_rate,
					render: l => l.sel_rate === null ? '<span class="fid-zero">—</span>' : `${cint(l.sel_rate)}%`,
					csv: l => l.sel_rate === null ? '' : l.sel_rate + '%' }
			]);
		}
		this.sortable_table($el, cols, lines, { default_sort: 'total', default_dir: -1 });
		$el.off('click.fidnum').on('click.fidnum', '.fid-num', (e) => {
			const $a = $(e.currentTarget);
			const line = lines.find(l => l.label === String($a.data('label')));
			const metric = metrics.find(m => m.key === $a.data('metric'));
			if (line) this.open_drilldown(`${line.label} · ${metric.label}`, line[metric.key]);
		});
	}

	render_interviewer_table() {
		const groups = {};
		this.rows.forEach(r => (r.interviewers.length ? r.interviewers : [__('(none)')])
			.forEach(iv => (groups[iv] = groups[iv] || []).push(r)));
		this.render_breakdown(this.$root.find('#fid-iv-table'), __('Interviewer'), groups, true);
	}

	render_department_table() {
		const groups = {};
		this.rows.forEach(r => { const k = r.department || __('(blank)'); (groups[k] = groups[k] || []).push(r); });
		this.render_breakdown(this.$root.find('#fid-dept-table'), __('Department'), groups, true);
	}

	// Generic sortable table. Clicking a header toggles asc/desc.
	sortable_table($el, columns, rows, opts = {}) {
		const cols = columns.filter(c => !c.hidden);
		let sort_key = $el.data('fid-sort') || opts.default_sort || null;
		let dir = $el.data('fid-dir') || opts.default_dir || 1;

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
				$el.html(`<div class="fid-empty">${this.esc(opts.empty || __('No interviews match these filters.'))}</div>`);
				return;
			}
			$el.html(`<table class="fid-table"><thead><tr>${cols.map(c => `
				<th data-key="${c.key}" class="${c.key === sort_key ? 'is-sorted' : ''}">${this.esc(c.label)}
				<span class="fid-sort">${c.key === sort_key ? (dir === 1 ? '▲' : '▼') : '↕'}</span></th>`).join('')}
				</tr></thead><tbody>${data.map(r => `<tr>${cols.map(c =>
					`<td${c.nw ? ' class="nw"' : ''}>${c.render ? c.render(r) : this.esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
		};
		$el.off('click.fidsort').on('click.fidsort', 'th', (e) => {
			const k = $(e.currentTarget).data('key');
			dir = sort_key === k ? -dir : 1;
			sort_key = k;
			$el.data('fid-sort', sort_key).data('fid-dir', dir);
			draw();
		});
		this.bind_candidate_links($el);
		draw();
	}

	bind_candidate_links($el) {
		$el.off('click.fidcand').on('click.fidcand', '.fid-cand', (e) => {
			e.preventDefault();
			const app = String($(e.currentTarget).data('app') || '');
			if (app) this.open_candidate(app);
		});
	}

	// ── drilldown (level 1) ───────────────────────────────────────────────
	open_drilldown(title, rows) {
		// Dialog titles are rendered as HTML — title can contain data
		// (department / interviewer), so escape it.
		const d = new frappe.ui.Dialog({ title: this.esc(title), size: 'extra-large' });
		d.$wrapper.find('.modal-dialog').addClass('modal-dialog-centered');
		d.$body.html(`
			<style>${FID_CSS}</style>
			<div class="fid-root">
				<div class="fid-dd-bar">
					<span class="fid-muted">${__('{0} interviews', [rows.length])}</span>
					<button class="btn btn-default btn-xs fid-dd-export">${__('Export CSV')}</button>
				</div>
				<div class="fid-table-scroll fid-dd-scroll"></div>
			</div>`);
		const cols = this.interview_columns();
		this.sortable_table(d.$body.find('.fid-dd-scroll'), cols, rows);
		d.$body.find('.fid-dd-export').on('click', () => this.export_csv(title, cols, rows));
		d.show();
	}

	// ── candidate detail (level 2) ─────────────────────────────────────────
	open_candidate(application_id) {
		frappe.call({
			method: FID_API + 'get_candidate_detail',
			args: { application_id },
			freeze: true,
			callback: (r) => {
				const c = r.message;
				if (!c) return;
				const esc = (v) => this.esc(v);
				const d = new frappe.ui.Dialog({ title: esc(`${c.name} · ${c.application_id}`), size: 'extra-large' });
				d.$wrapper.find('.modal-dialog').addClass('modal-dialog-centered');
				d.$body.html(`
					<style>${FID_CSS}</style>
					<div class="fid-root fid-detail">
						<div class="fid-detail-top">
							<a class="btn btn-default btn-xs" target="_blank"
								href="/app/field-registration-form/${encodeURIComponent(c.application_id)}">${__('Open Registration Form')} ↗</a>
						</div>
						<div class="fid-sec">${__('Profile')}</div>
						<div class="fid-profile">${c.profile.filter(p => p.value).map(p => `
							<div><div class="fid-muted">${esc(p.label)}</div><div class="fid-pv">${esc(p.value)}</div></div>`).join('')}
						</div>

						<div class="fid-sec">${__('Interview journey')} (${c.interviews.length})</div>
						<div class="fid-journey">${c.interviews.map(i => `
							<div class="fid-step ${i.cancelled ? 'is-cancelled' : ''}">
								<div class="fid-step-dot"></div>
								<div class="fid-step-round">${esc(i.round)}</div>
								<div class="fid-muted">${esc(this.fmt_date(i.date))} ${esc(i.start)}</div>
								<div class="fid-muted">${esc(i.mode)}${i.cancelled ? ' · ' + __('Cancelled') : ''}</div>
								<a class="fid-muted" target="_blank" href="/app/field-interview-schedule/${encodeURIComponent(i.name)}">${esc(i.name)} ↗</a>
							</div>`).join('') || `<div class="fid-muted">${__('None')}</div>`}
						</div>

						<div class="fid-sec">${__('Feedback')} (${c.feedback.length})</div>
						${c.feedback.map(f => this.feedback_body_html(f)).join('')
							|| `<div class="fid-muted">${__('No feedback yet')}</div>`}

						<div class="fid-sec">${__('PDFs on file')} (${c.pdfs.length})</div>
						<div class="fid-pdfs">${c.pdfs.map(p => `
							<a class="fid-pdf" target="_blank" rel="noopener" href="${encodeURI(p.url)}">📄 ${esc(p.label)}</a>`).join('')
							|| `<span class="fid-muted">${__('None')}</span>`}</div>
					</div>`);
				d.show();
			}
		});
	}

	// ── CSV ────────────────────────────────────────────────────────────────
	// Exports exactly the rows passed in (already permission-scoped by the
	// server). Cells starting with = + - @ are prefixed with ' so a
	// spreadsheet never evaluates them as formulas.
	export_csv(name, columns, rows) {
		const cols = columns;
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

// Colours are role tokens on .fid-root, re-stepped for Frappe's dark theme
// (html[data-theme="dark"]) rather than flipped automatically.
const FID_CSS = `
.fid-root { --bg:#ffffff; --bg-soft:#F8FAFC; --border:#E5E7EB; --border-soft:#F1F5F9; --text:#0F172A;
	--text-2:#334155; --muted:#64748B; --head:#1F3A5F; --head-2:#274C77; --link:#1D4ED8; --hover:#F8FAFC;
	color:var(--text); }
:root[data-theme="dark"] .fid-root { --bg:#1C1C1B; --bg-soft:#232322; --border:#3A3A38; --border-soft:#2C2C2A;
	--text:#F5F5F4; --text-2:#D6D5CF; --muted:#A8A7A1; --head:#2B3F5C; --head-2:#35517A; --link:#7FB2F5; --hover:#262625; }
.fid-root { padding: 18px 22px 48px; }
.modal-body .fid-root { padding: 0; }
.fid-hero { position:relative; overflow:hidden; display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap;
	background:linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 60%,#2563eb 100%); color:#fff; border-radius:14px; padding:18px 22px; margin-bottom:12px; }
.fid-hero-circle { position:absolute; border-radius:50%; background:rgba(255,255,255,.07); }
.fid-eyebrow { font-size:10.5px; letter-spacing:.09em; text-transform:uppercase; color:rgba(255,255,255,.72); font-weight:600; }
.fid-title { font-size:21px; font-weight:750; margin-top:2px; }
.fid-sub { font-size:12.5px; color:rgba(255,255,255,.86); margin-top:2px; }
.fid-hero-right { display:flex; gap:10px; position:relative; }
.fid-hero-stat { background:rgba(255,255,255,.14); border:1px solid rgba(255,255,255,.22); border-radius:12px; padding:8px 14px; min-width:120px; }
.fid-hero-stat .v { font-size:22px; font-weight:800; line-height:1.1; }
.fid-hero-stat .l { font-size:11px; color:rgba(255,255,255,.8); font-weight:600; }
.fid-filters { background:var(--bg); border:1px solid var(--border); border-radius:12px; padding:10px 14px 12px; margin-bottom:14px; }
.fid-presets { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
.fid-preset { border:1px solid var(--border); background:var(--bg-soft); color:var(--text-2); border-radius:20px; padding:3px 12px;
	font-size:12px; font-weight:600; cursor:pointer; }
.fid-preset:hover { border-color:#2a78d6; color:#2a78d6; }
.fid-filter-row { display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; }
.fid-f { display:flex; flex-direction:column; gap:3px; }
.fid-f label { font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; margin:0; }
.fid-f input[type=date] { height:32px; border:1px solid var(--border); border-radius:8px; padding:0 8px; font-size:12.5px; background:var(--bg); color:var(--text); }
.fid-f-btns { flex-direction:row; gap:6px; margin-left:auto; }
.fid-ms { position:relative; min-width:160px; max-width:230px; }
.fid-ms-box { display:flex; flex-wrap:wrap; align-items:center; gap:4px; padding:3px 8px; border:1px solid var(--border);
	border-radius:8px; background:var(--bg); cursor:pointer; min-height:32px; }
.fid-ms.open .fid-ms-box { border-color:#274C77; box-shadow:0 0 0 3px rgba(39,76,119,.15); }
.fid-ms-ph { font-size:12.5px; color:var(--muted); }
.fid-ms-chip { display:inline-flex; align-items:center; gap:4px; background:rgba(42,120,214,.12); color:var(--text-2); border-radius:6px;
	padding:1px 5px 1px 7px; font-size:11px; font-weight:600; max-width:120px; }
.fid-ms-chip .txt { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.fid-ms-chip .x { cursor:pointer; opacity:.7; }
.fid-ms-more { font-size:11px; color:var(--muted); font-weight:600; }
.fid-ms-panel { display:none; position:absolute; top:calc(100% + 4px); left:0; z-index:60; background:var(--bg);
	border:1px solid var(--border); border-radius:10px; box-shadow:0 10px 24px -8px rgba(16,24,40,.25);
	width:max(100%,270px); max-width:min(360px,90vw); max-height:300px; overflow-y:auto; }
.fid-ms.open .fid-ms-panel { display:block; }
.fid-ms-search { position:sticky; top:0; background:var(--bg); padding:6px; border-bottom:1px solid var(--border-soft); }
.fid-ms-search input { width:100%; padding:5px 8px; border:1px solid var(--border); border-radius:6px; font-size:12px; background:var(--bg); color:var(--text); }
.fid-ms-actions { display:flex; justify-content:space-between; padding:5px 8px; border-bottom:1px solid var(--border-soft); font-size:11px; }
.fid-ms-actions a { color:var(--link); cursor:pointer; font-weight:600; }
.fid-ms-opt { display:flex; gap:8px; padding:6px 10px; font-size:12px; cursor:pointer; margin:0; font-weight:400; color:var(--text); }
.fid-ms-opt:hover { background:var(--hover); }
.fid-ms-empty { padding:10px; font-size:12px; color:var(--muted); text-align:center; }
.fid-cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(165px,1fr)); gap:10px; margin-bottom:14px; }
.fid-card { position:relative; border:1px solid color-mix(in srgb, var(--c) 28%, transparent); border-left:5px solid var(--c);
	background:color-mix(in srgb, var(--c) 7%, var(--bg)); border-radius:12px; padding:11px 13px; }
.fid-card.is-click { cursor:pointer; transition:transform .12s ease, box-shadow .12s ease; }
.fid-card.is-click:hover { transform:translateY(-2px); box-shadow:0 8px 20px rgba(15,23,42,.12); }
.fid-card-top { display:flex; justify-content:space-between; align-items:flex-start; }
.fid-card-value { font-size:26px; font-weight:800; line-height:1.1; color:var(--text); }
.fid-card-icon { font-size:15px; color:var(--c); }
.fid-card-label { font-size:12.5px; font-weight:700; color:var(--text); margin-top:3px; }
.fid-card-hint { font-size:11px; color:var(--muted); }
.fid-panel { background:var(--bg); border:1px solid var(--border); border-radius:12px; margin-bottom:14px; overflow:hidden; min-width:0; }
.fid-panel-head { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;
	padding:11px 14px; border-bottom:1px solid var(--border-soft); }
.fid-panel-title { font-size:14px; font-weight:700; color:var(--text); }
.fid-panel-sub { font-size:11.5px; color:var(--muted); }
.fid-panel-tools { display:flex; gap:6px; align-items:center; }
.fid-panel-body { padding:10px 14px; }
.fid-scroll-md { max-height:340px; overflow:auto; }
.fid-search { height:28px; border:1px solid var(--border); border-radius:7px; padding:0 9px; font-size:12px; width:220px; background:var(--bg); color:var(--text); }
.fid-two { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.fid-two > .fid-panel { margin-bottom:14px; }
.fid-table-scroll { max-height:520px; overflow:auto; }
.fid-table-scroll.fid-short { max-height:340px; }
.fid-dd-scroll { max-height:65vh; overflow:auto; border:1px solid var(--border); border-radius:8px; }
.fid-table { width:100%; border-collapse:collapse; font-size:12.5px; color:var(--text); }
.fid-table th { position:sticky; top:0; z-index:2; background:var(--head); color:#fff; text-align:left; font-weight:600;
	padding:8px 10px; white-space:nowrap; cursor:pointer; user-select:none; font-size:11.5px; }
.fid-table th.is-sorted { background:var(--head-2); }
.fid-sort { opacity:.6; font-size:9px; margin-left:3px; }
.fid-table td { padding:7px 10px; border-bottom:1px solid var(--border-soft); vertical-align:top; }
.fid-table td.nw { white-space:nowrap; }
.fid-table tbody tr:hover td { background:var(--hover); }
.fid-pill { display:inline-block; border:1px solid color-mix(in srgb, var(--c) 45%, transparent); color:var(--c);
	background:color-mix(in srgb, var(--c) 10%, transparent); border-radius:20px; padding:1px 8px; font-size:10.5px; font-weight:700; white-space:nowrap; }
:root[data-theme="dark"] .fid-pill { color:color-mix(in srgb, var(--c) 70%, #fff); }
.fid-cand { font-weight:600; cursor:pointer; color:var(--link); }
.fid-muted { color:var(--muted); font-size:11px; }
.fid-num { font-weight:700; cursor:pointer; color:var(--link); }
.fid-num.is-red { color:#d03b3b; }
.fid-zero { color:var(--border); }
.fid-empty { padding:24px; text-align:center; color:var(--muted); font-size:13px; }
.fid-day { margin-bottom:10px; }
.fid-day-head { display:flex; justify-content:space-between; font-size:12px; font-weight:700; color:var(--text);
	border-bottom:1px solid var(--border-soft); padding-bottom:4px; margin-bottom:4px; }
.fid-agenda-row { display:flex; align-items:center; gap:10px; padding:6px 2px; border-bottom:1px dashed var(--border-soft); }
.fid-agenda-time { width:84px; flex-shrink:0; font-size:12px; font-weight:700; color:var(--text-2); }
.fid-agenda-main { flex:1; min-width:0; font-size:12.5px; }
.fid-seg { display:inline-flex; border:1px solid var(--border); border-radius:8px; overflow:hidden; }
.fid-seg button { border:0; background:var(--bg); color:var(--text-2); font-size:12px; font-weight:600; padding:4px 12px; cursor:pointer; }
.fid-seg button + button { border-left:1px solid var(--border); }
.fid-seg button.is-on { background:#2a78d6; color:#fff; }
.fid-agenda-row .fid-pill + .fid-pill { margin-left:4px; }
.fid-fb-open { cursor:pointer; font-weight:600; color:var(--link); white-space:nowrap; }
.fid-fb-detail-row > td { background:var(--bg-soft) !important; padding:10px 12px !important; }
.fid-fb-card { border:1px solid var(--border); border-radius:10px; background:var(--bg); padding:10px 14px; margin-bottom:10px; }
.fid-fb-head { display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center;
	font-size:12.5px; border-bottom:1px solid var(--border-soft); padding-bottom:7px; margin-bottom:6px; }
.fid-fb-sec { margin-top:6px; }
.fid-fb-sec-title { font-size:11px; font-weight:700; color:var(--link); text-transform:uppercase; letter-spacing:.05em; margin:8px 0 4px; }
.fid-fb-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:6px 16px; }
.fid-fb-grid > .is-long { grid-column:1 / -1; }
.fid-fb-val { font-size:12.5px; color:var(--text); font-weight:500; overflow-wrap:anywhere; }
.fid-fb-child { margin-top:4px; }
.fid-fb-child th { position:static; cursor:default; }
.fid-dd-bar { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
.fid-detail-top { display:flex; justify-content:flex-end; }
.fid-sec { font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.07em; margin:14px 0 6px; }
.fid-profile { display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:8px 16px;
	background:var(--bg-soft); border:1px solid var(--border); border-radius:10px; padding:12px 14px; }
.fid-pv { font-size:13px; font-weight:600; color:var(--text); overflow-wrap:anywhere; }
.fid-journey { display:flex; gap:0; overflow-x:auto; padding:6px 2px 4px; }
.fid-step { position:relative; min-width:150px; padding:18px 12px 4px 0; border-top:3px solid #2a78d6; margin-right:6px; }
.fid-step.is-cancelled { border-top-color:var(--border); opacity:.65; }
.fid-step-dot { position:absolute; top:-8px; left:0; width:13px; height:13px; border-radius:50%; background:#2a78d6; border:2px solid var(--bg); }
.fid-step.is-cancelled .fid-step-dot { background:var(--muted); }
.fid-step-round { font-size:12.5px; font-weight:700; color:var(--text); }
.fid-pdfs { display:flex; flex-wrap:wrap; gap:8px; }
.fid-pdf { border:1px solid rgba(42,120,214,.35); background:rgba(42,120,214,.08); color:var(--link); border-radius:8px; padding:5px 10px; font-size:12px; font-weight:600; }
@media (max-width: 1100px) { .fid-two { grid-template-columns:1fr; } }
@media (max-width: 900px) { .fid-f-btns { margin-left:0; } .fid-hero-right { width:100%; } }
@media (max-width: 600px) { .fid-root { padding:12px 10px 40px; } .fid-search { width:100%; } .fid-ms { max-width:none; width:100%; }
	.fid-f { width:100%; } `;
