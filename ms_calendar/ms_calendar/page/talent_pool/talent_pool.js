// Talent Pool — /desk/talent-pool
//
// One page for every unit's Talent Pool (Field, Philanthropy, Health,
// Scholarship, Enablers / Finance Fellowship).
//   Filters (Unit multiselect with Select all / Clear, Moved from / to,
//   Search) + Apply  →  cards (ⓘ on each, click = drilldown popup with
//   sortable columns + CSV)  →  table with In Talent Pool / Resumed / All
//   tabs, sortable, CSV, tick rows → "Resume selected", or "Resume" per row.
//   Application ID opens the form; the candidate's name opens the
//   applicant profile popup (forms without one open the form).
//
// All rows come from one permission-scoped server call
// (talent_pool.get_data); cards, table, drilldowns and CSV only ever use
// that result. Every value rendered into HTML goes through esc().

const TPP_API = 'ms_calendar.ms_calendar.page.talent_pool.talent_pool.';
const TPP_STORE_KEY = 'tpp-units-v1';

frappe.pages['talent-pool'].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __('Talent Pool'), single_column: true });
	wrapper.tpp = new TalentPoolPage(page, wrapper);
};
frappe.pages['talent-pool'].on_page_show = function (wrapper) {
	// Coming back from a form (e.g. after a Resume there): fresh numbers.
	if (wrapper.tpp && wrapper.tpp.loaded_once) wrapper.tpp.load();
};

class TalentPoolPage {
	constructor(page, wrapper) {
		this.page = page;
		this.$root = $(wrapper).find('.page-content');
		this.units = [];
		this.sel_units = this.read_units();
		this.rows = [];
		this.cards = {};
		this.long_wait_days = 90;
		this.tab = 'in_pool';
		this.sort = { key: 'moved_on', dir: 'desc' };
		this.checked = new Set();
		this.loaded_once = false;
		this.inject_css();
		this.render_shell();
		this.page.set_secondary_action(__('Talent Pool Log'), () => frappe.set_route('List', 'Talent Pool Log'));
		this.load();
	}

	// ── helpers ─────────────────────────────────────────────────────────
	esc(v) { return frappe.utils.escape_html(v === null || v === undefined ? '' : String(v)); }
	date(v) { return v ? frappe.datetime.str_to_user(String(v).slice(0, 10)) : ''; }
	n(v) { return v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN'); }
	read_units() {
		try { return JSON.parse(localStorage.getItem(TPP_STORE_KEY) || '[]') || []; } catch (e) { return []; }
	}
	save_units() {
		try { localStorage.setItem(TPP_STORE_KEY, JSON.stringify(this.sel_units)); } catch (e) { /* private window */ }
	}

	// ── column sets ─────────────────────────────────────────────────────
	columns(tab) {
		const c = {
			unit: { key: 'unit', label: __('Unit') },
			app_id: { key: 'app_id', label: __('Application ID') },
			candidate: { key: 'candidate', label: __('Candidate') },
			job_title: { key: 'job_title', label: __('Job Title') },
			status_before: { key: 'status_before', label: __('Status Before Pool') },
			moved_on: { key: 'moved_on', label: __('Moved On'), type: 'date' },
			moved_by: { key: 'moved_by', label: __('Moved By') },
			days: { key: 'days', label: __('Days in Pool'), type: 'number' },
			email_sent_on: { key: 'email_sent_on', label: __('Email Sent'), type: 'date' },
			resumed_on: { key: 'resumed_on', label: __('Resumed On'), type: 'date' },
			resumed_to_status: { key: 'resumed_to_status', label: __('Resumed To') },
			resumed_by: { key: 'resumed_by', label: __('Resumed By') },
			status: { key: 'status', label: __('Pool Status') },
			current_status: { key: 'current_status', label: __('Current Status') },
			remarks: { key: 'remarks', label: __('Remarks') },
			email: { key: 'email', label: __('Email') },
		};
		if (tab === 'resumed') {
			return [c.unit, c.app_id, c.candidate, c.job_title, c.status_before, c.moved_on, c.resumed_on, c.days,
				c.resumed_to_status, c.resumed_by, c.current_status];
		}
		if (tab === 'all') {
			return [c.unit, c.app_id, c.candidate, c.job_title, c.status, c.status_before, c.moved_on, c.resumed_on,
				c.days, c.current_status];
		}
		return [c.unit, c.app_id, c.candidate, c.job_title, c.status_before, c.moved_on, c.days, c.moved_by,
			c.email_sent_on, c.remarks];
	}
	csv_columns() {
		return this.columns('all').concat([
			{ key: 'email', label: __('Email') }, { key: 'moved_by', label: __('Moved By') },
			{ key: 'email_sent_on', label: __('Email Sent On'), type: 'date' }, { key: 'email_note', label: __('Email Note') },
			{ key: 'resumed_to_status', label: __('Resumed To') }, { key: 'resumed_by', label: __('Resumed By') },
			{ key: 'remarks', label: __('Remarks') }, { key: 'resume_remarks', label: __('Resume Remarks') },
		]);
	}

	// ── cards ───────────────────────────────────────────────────────────
	card_defs() {
		const lw = this.long_wait_days;
		return [
			{ k: 'in_pool', label: __('In Talent Pool'), tone: '#1A3550', sub: __('waiting now'),
				info: __('Applications whose Talent Pool stay is still open (not resumed yet), for the units, dates and search you chose. Click to list them.'),
				rows: r => r.status === 'In Talent Pool' },
			{ k: 'long_wait', label: __('Waiting over {0} days', [lw]), tone: '#B7651B', action: true, sub: __('review or resume'),
				info: __('Still in the Talent Pool and moved there more than {0} days ago. Worth a review: resume them for a suitable opening or leave them in the pool.', [lw]),
				rows: r => r.long_wait },
			{ k: 'no_email', label: __('Email not sent'), tone: '#B83232', action: true, sub: __('candidate not informed'),
				info: __('In the Talent Pool but the Talent Pool email was not sent (switched off when moving, no email address, or an error). The reason is in the Email Note column of the CSV / Talent Pool Log.'),
				rows: r => r.no_email },
			{ k: 'resumed', label: __('Resumed'), tone: '#2F7D4F', sub: __('back in process'),
				info: __('Talent Pool stays that were resumed: the application went back into the recruitment process. Moved-on dates follow the date filter.'),
				rows: r => r.status === 'Resumed' },
			{ k: 'avg_days', label: __('Avg. days in pool'), tone: '#2C5F8A', sub: __('of resumed stays'), decimal: true,
				info: __('Average number of days between Moved On and Resumed On for the resumed stays. These days are left out of the Cycle Time report.'),
				rows: r => r.status === 'Resumed', sort: { key: 'days', dir: 'desc' } },
		];
	}

	// ── shell ───────────────────────────────────────────────────────────
	render_shell() {
		this.$root.html(`
			<div class="tpp-root">
				<div class="tpp-filters">
					<div class="tpp-f">
						<label>${__('Unit')}</label>
						<div class="tpp-ms">
							<button type="button" class="tpp-ms-btn"><span class="tpp-ms-text">${__('All units')}</span><span class="tpp-caret">▾</span></button>
							<div class="tpp-ms-panel" hidden>
								<div class="tpp-ms-actions">
									<button type="button" class="btn btn-xs btn-default tpp-ms-all">${__('Select all')}</button>
									<button type="button" class="btn btn-xs btn-default tpp-ms-clear">${__('Clear')}</button>
								</div>
								<div class="tpp-ms-list"></div>
							</div>
						</div>
					</div>
					<div class="tpp-f"><label>${__('Moved from')}</label><input type="date" class="form-control input-sm tpp-from"></div>
					<div class="tpp-f"><label>${__('Moved to')}</label><input type="date" class="form-control input-sm tpp-to"></div>
					<div class="tpp-f tpp-f-search"><label>${__('Search')}</label>
						<input type="search" class="form-control input-sm tpp-search" placeholder="${__('Name, ID, email, job, remarks')}"></div>
					<div class="tpp-f tpp-f-btns">
						<button type="button" class="btn btn-sm btn-primary tpp-apply">${__('Apply')}</button>
						<button type="button" class="btn btn-sm btn-default tpp-reset">${__('Reset')}</button>
					</div>
				</div>
				<div class="tpp-cards-head">
					<span class="tpp-muted tpp-scope"></span>
					<button type="button" class="btn btn-xs btn-default tpp-guide">ⓘ ${__('Card guide')}</button>
				</div>
				<div class="tpp-cards"></div>
				<div class="tpp-panel">
					<div class="tpp-bar">
						<div class="tpp-tabs" role="tablist"></div>
						<div class="tpp-bar-right">
							<button type="button" class="btn btn-sm btn-primary tpp-resume-sel" hidden></button>
							<button type="button" class="btn btn-sm btn-default tpp-csv">${__('Export CSV')}</button>
						</div>
					</div>
					<div class="tpp-table-wrap"><div class="tpp-empty">${__('Loading…')}</div></div>
				</div>
			</div>`);

		const $r = this.$root;
		$r.find('.tpp-ms-btn').on('click', (e) => {
			e.stopPropagation();
			const $p = $r.find('.tpp-ms-panel');
			$p.prop('hidden', !$p.prop('hidden'));
		});
		$r.find('.tpp-ms-panel').on('click', (e) => e.stopPropagation());
		$(document).on('click.tpp', () => $r.find('.tpp-ms-panel').prop('hidden', true));
		$r.find('.tpp-ms-all').on('click', () => { $r.find('.tpp-ms-list input').prop('checked', true); this.ms_text(); });
		$r.find('.tpp-ms-clear').on('click', () => { $r.find('.tpp-ms-list input').prop('checked', false); this.ms_text(); });
		$r.find('.tpp-ms-list').on('change', 'input', () => this.ms_text());
		$r.find('.tpp-apply').on('click', () => this.apply());
		$r.find('.tpp-search').on('keydown', (e) => { if (e.key === 'Enter') this.apply(); });
		$r.find('.tpp-reset').on('click', () => {
			$r.find('.tpp-from, .tpp-to, .tpp-search').val('');
			$r.find('.tpp-ms-list input').prop('checked', false);
			this.ms_text();
			this.apply();
		});
		$r.find('.tpp-guide').on('click', () => this.show_guide());
		$r.find('.tpp-csv').on('click', () => {
			const rows = this.sorted(this.tab_rows(), this.sort);
			this.download_csv(rows, this.csv_columns(), 'talent_pool_' + this.tab);
		});
		$r.find('.tpp-resume-sel').on('click', () => this.resume_selected());
	}

	ms_text() {
		const picked = this.$root.find('.tpp-ms-list input:checked').map((i, el) => el.value).get();
		const txt = !picked.length || picked.length === this.units.length ? __('All units')
			: (picked.length <= 2 ? picked.join(', ') : __('{0} units', [picked.length]));
		this.$root.find('.tpp-ms-text').text(txt);
	}

	render_unit_options() {
		const keep = this.sel_units.filter(u => this.units.indexOf(u) !== -1);
		this.$root.find('.tpp-ms-list').html(this.units.map(u => `
			<label class="tpp-ms-item"><input type="checkbox" value="${this.esc(u)}" ${keep.indexOf(u) !== -1 ? 'checked' : ''}>
			<span>${this.esc(u)}</span></label>`).join(''));
		this.ms_text();
	}

	filters() {
		const $r = this.$root;
		const picked = $r.find('.tpp-ms-list input:checked').map((i, el) => el.value).get();
		return {
			units: picked.length === this.units.length ? [] : picked,
			from_date: $r.find('.tpp-from').val() || '',
			to_date: $r.find('.tpp-to').val() || '',
			search: ($r.find('.tpp-search').val() || '').trim(),
		};
	}

	apply() {
		this.sel_units = this.filters().units;
		this.save_units();
		this.$root.find('.tpp-ms-panel').prop('hidden', true);
		this.load();
	}

	// ── data ────────────────────────────────────────────────────────────
	load() {
		const f = this.units.length ? this.filters() : { units: this.sel_units };
		this.$root.find('.tpp-table-wrap').html(`<div class="tpp-empty">${__('Loading…')}</div>`);
		frappe.call({
			method: TPP_API + 'get_data',
			args: { filters: f },
			callback: (r) => {
				const d = r.message || {};
				const first = !this.units.length;
				this.units = d.units || [];
				if (first) this.render_unit_options();
				this.rows = d.rows || [];
				this.cards = d.cards || {};
				this.long_wait_days = d.long_wait_days || 90;
				this.checked.clear();
				this.loaded_once = true;
				this.render_scope(f);
				this.render_cards();
				this.render_table();
			},
			error: () => this.$root.find('.tpp-table-wrap').html(`<div class="tpp-empty">${__('Could not load. Please refresh.')}</div>`),
		});
	}

	render_scope(f) {
		const parts = [];
		parts.push(f.units && f.units.length ? f.units.join(', ') : __('All units'));
		if (f.from_date || f.to_date) {
			parts.push(__('moved {0} – {1}', [f.from_date ? this.date(f.from_date) : '…', f.to_date ? this.date(f.to_date) : '…']));
		} else {
			parts.push(__('all dates'));
		}
		if (f.search) parts.push(__('search "{0}"', [f.search]));
		this.$root.find('.tpp-scope').text(__('Showing: {0}', [parts.join(' · ')]));
	}

	render_cards() {
		const html = this.card_defs().map((d, i) => {
			const v = this.cards[d.k];
			const shown = d.decimal ? (v === null || v === undefined ? '—' : String(v)) : this.n(v);
			const click = d.decimal ? (this.cards.resumed > 0) : v > 0;
			return `
				<div class="tpp-card ${click ? 'is-click' : ''}" data-i="${i}" style="--c:${d.tone}" ${click ? 'role="button" tabindex="0"' : ''}>
					<div class="tpp-card-top">
						<span class="tpp-card-label"><i class="tpp-dot"></i>${this.esc(d.label)}</span>
						<span class="tpp-info" title="${this.esc(d.info)}">ⓘ</span>
					</div>
					<div class="tpp-card-value">${this.esc(shown)}${d.decimal && v !== null && v !== undefined ? `<small> ${__('days')}</small>` : ''}</div>
					<div class="tpp-card-sub">${this.esc(d.sub)}${d.action && v > 0 ? `<span class="tpp-tag">${__('Action')}</span>` : ''}</div>
				</div>`;
		}).join('');
		const $c = this.$root.find('.tpp-cards').html(html);
		const open = (el) => {
			const d = this.card_defs()[+$(el).data('i')];
			this.drilldown(d.label, this.rows.filter(d.rows), d.sort);
		};
		$c.find('.tpp-card.is-click').on('click', (e) => { if (!$(e.target).closest('.tpp-info').length) open(e.currentTarget); })
			.on('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e.currentTarget); } });
	}

	show_guide() {
		const html = this.card_defs().map(d => `<p><b>${this.esc(d.label)}</b><br>${this.esc(d.info)}</p>`).join('')
			+ `<p class="tpp-muted">${this.esc(__('All cards follow the filters at the top (Unit, Moved from / to, Search). Moved / Resumed dates come from the Talent Pool Log, written whenever an application\'s status moves into or out of "Talent Pool".'))}</p>`;
		frappe.msgprint({ title: __('Card guide'), message: html, wide: true });
	}

	// ── table ───────────────────────────────────────────────────────────
	tab_rows(tab) {
		tab = tab || this.tab;
		if (tab === 'in_pool') return this.rows.filter(r => r.status === 'In Talent Pool');
		if (tab === 'resumed') return this.rows.filter(r => r.status === 'Resumed');
		return this.rows.slice();
	}

	sorted(rows, sort) {
		const col = this.columns('all').concat(this.columns('in_pool'), this.columns('resumed')).find(c => c.key === sort.key) || {};
		const dir = sort.dir === 'asc' ? 1 : -1;
		return rows.slice().sort((a, b) => {
			let x = a[sort.key], y = b[sort.key];
			if (col.type === 'number') { x = +x || 0; y = +y || 0; return (x - y) * dir; }
			x = (x || '').toString().toLowerCase(); y = (y || '').toString().toLowerCase();
			if (x === y) return 0;
			if (!x) return 1;   // blanks last either way
			if (!y) return -1;
			return (x < y ? -1 : 1) * dir;
		});
	}

	render_table() {
		const counts = { in_pool: this.tab_rows('in_pool').length, resumed: this.tab_rows('resumed').length, all: this.rows.length };
		const tabs = [['in_pool', __('In Talent Pool')], ['resumed', __('Resumed')], ['all', __('All')]];
		this.$root.find('.tpp-tabs').html(tabs.map(([k, l]) =>
			`<button type="button" role="tab" class="tpp-tab ${this.tab === k ? 'is-on' : ''}" data-k="${k}" aria-selected="${this.tab === k}">
				${this.esc(l)} <span class="tpp-count">${this.n(counts[k])}</span></button>`).join(''));
		this.$root.find('.tpp-tab').on('click', (e) => {
			this.tab = $(e.currentTarget).data('k');
			this.checked.clear();
			this.render_table();
		});

		const rows = this.sorted(this.tab_rows(), this.sort);
		const $wrap = this.$root.find('.tpp-table-wrap');
		if (!rows.length) {
			$wrap.html(`<div class="tpp-empty">${this.tab === 'in_pool'
				? __('No applications in the Talent Pool for these filters. Move candidates from any unit\'s form or list (Actions ▾ → Move to Talent Pool).')
				: __('Nothing to show for these filters.')}</div>`);
			this.sync_resume_btn();
			return;
		}
		const can_resume = this.tab !== 'resumed';
		$wrap.html(this.table_html(rows, this.columns(this.tab), this.sort, { checkbox: can_resume, actions: can_resume }));
		this.bind_table($wrap, rows, this.columns(this.tab), (key) => {
			this.sort = { key, dir: this.sort.key === key && this.sort.dir === 'desc' ? 'asc' : 'desc' };
			this.render_table();
		});
		$wrap.on('change', '.tpp-chk', (e) => {
			const id = $(e.currentTarget).data('log');
			if (e.currentTarget.checked) this.checked.add(id); else this.checked.delete(id);
			this.sync_resume_btn();
		});
		$wrap.on('change', '.tpp-chk-all', (e) => {
			const on = e.currentTarget.checked;
			$wrap.find('.tpp-chk').each((i, el) => {
				el.checked = on;
				const id = $(el).data('log');
				if (on) this.checked.add(id); else this.checked.delete(id);
			});
			this.sync_resume_btn();
		});
		$wrap.on('click', '.tpp-resume-one', (e) => {
			const row = this.rows.find(r => r.log === $(e.currentTarget).data('log'));
			if (row) this.resume([row]);
		});
		this.sync_resume_btn();
	}

	table_html(rows, cols, sort, opt) {
		opt = opt || {};
		const arrow = (k) => sort && sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
		let h = '<table class="tpp-table"><thead><tr>';
		if (opt.checkbox) h += `<th class="tpp-c-chk"><input type="checkbox" class="tpp-chk-all" aria-label="${__('Select all')}"></th>`;
		cols.forEach(c => { h += `<th class="tpp-sort tpp-col-${c.key} ${c.type === 'number' ? 'is-num' : ''}" data-k="${c.key}">${this.esc(c.label)}${arrow(c.key)}</th>`; });
		if (opt.actions) h += '<th class="tpp-c-act"></th>';
		h += '</tr></thead><tbody>';
		rows.forEach(r => {
			const in_pool = r.status === 'In Talent Pool';
			h += `<tr class="${r.long_wait ? 'is-long' : ''}">`;
			if (opt.checkbox) {
				h += `<td class="tpp-c-chk">${in_pool ? `<input type="checkbox" class="tpp-chk" data-log="${this.esc(r.log)}" ${this.checked.has(r.log) ? 'checked' : ''}>` : ''}</td>`;
			}
			cols.forEach(c => { h += `<td class="tpp-col-${c.key} ${c.type === 'number' ? 'is-num' : ''} ${c.type === 'date' ? 'is-date' : ''}">${this.cell(r, c)}</td>`; });
			if (opt.actions) {
				h += `<td class="tpp-c-act">${in_pool ? `<button type="button" class="btn btn-xs btn-default tpp-resume-one" data-log="${this.esc(r.log)}">${__('Resume')}</button>` : ''}</td>`;
			}
			h += '</tr>';
		});
		return h + '</tbody></table>';
	}

	cell(r, c) {
		const v = r[c.key];
		if (c.key === 'app_id') {
			return `<a href="#" class="tpp-open-form" data-dt="${this.esc(r.doctype)}" data-name="${this.esc(v)}">${this.esc(v)}</a>`;
		}
		if (c.key === 'candidate') {
			return `<a href="#" class="tpp-open-profile" data-dt="${this.esc(r.doctype)}" data-name="${this.esc(r.app_id)}">${this.esc(v || '—')}</a>`
				+ (r.email ? `<div class="tpp-muted tpp-small">${this.esc(r.email)}</div>` : '');
		}
		if (c.key === 'status') {
			const cls = v === 'In Talent Pool' ? 'is-pool' : 'is-res';
			return `<span class="tpp-pill ${cls}">${this.esc(v)}</span>`;
		}
		if (c.key === 'days') {
			return this.esc(this.n(v)) + (r.long_wait ? ` <span class="tpp-tag">${__('{0}+', [this.long_wait_days])}</span>` : '');
		}
		if (c.key === 'email_sent_on') {
			return v ? this.esc(this.date(v)) : `<span class="tpp-bad" title="${this.esc(r.email_note || '')}">${__('Not sent')}</span>`;
		}
		if (c.type === 'date') return this.esc(this.date(v));
		return this.esc(v);
	}

	bind_table($wrap, rows, cols, on_sort) {
		$wrap.off('.tppt');
		$wrap.on('click.tppt', '.tpp-sort', (e) => on_sort($(e.currentTarget).data('k')));
		$wrap.on('click.tppt', '.tpp-open-form', (e) => {
			e.preventDefault();
			$('.modal.show').modal('hide');
			frappe.set_route('Form', $(e.currentTarget).data('dt'), String($(e.currentTarget).data('name')));
		});
		$wrap.on('click.tppt', '.tpp-open-profile', (e) => {
			e.preventDefault();
			const dt = $(e.currentTarget).data('dt'), name = String($(e.currentTarget).data('name'));
			const prof = window.pathways_applicant_profile;
			if (prof && prof.programs && prof.programs[dt]) prof.open_for(dt, name);
			else { $('.modal.show').modal('hide'); frappe.set_route('Form', dt, name); }
		});
		// The table is re-rendered on every change; drop the old row handlers.
		$wrap.off('change').off('click', '.tpp-resume-one');
	}

	sync_resume_btn() {
		const n = this.checked.size;
		this.$root.find('.tpp-resume-sel').prop('hidden', !n).text(__('Resume selected ({0})', [n]));
	}

	// ── drilldown popup ─────────────────────────────────────────────────
	drilldown(title, rows, sort) {
		let st = Object.assign({ key: 'moved_on', dir: 'desc' }, sort || {});
		const cols = this.columns('all').concat([{ key: 'moved_by', label: __('Moved By') }, { key: 'email_sent_on', label: __('Email Sent'), type: 'date' }]);
		const d = new frappe.ui.Dialog({ title: `${title} (${rows.length})`, size: 'extra-large' });
		const draw = () => {
			const $b = $(d.body);
			$b.html(`<div class="tpp-dd-bar"><button type="button" class="btn btn-xs btn-default tpp-dd-csv">${__('Export CSV')}</button></div>
				<div class="tpp-dd-scroll">${this.table_html(this.sorted(rows, st), cols, st)}</div>`);
			$b.find('.tpp-dd-csv').on('click', () => this.download_csv(this.sorted(rows, st), this.csv_columns(), 'talent_pool_' + title));
			this.bind_table($b, rows, cols, (key) => {
				st = { key, dir: st.key === key && st.dir === 'desc' ? 'asc' : 'desc' };
				draw();
			});
		};
		draw();
		d.$wrapper.addClass('tpp-dd');
		d.show();
	}

	// ── resume ──────────────────────────────────────────────────────────
	resume_selected() {
		const rows = this.rows.filter(r => this.checked.has(r.log) && r.status === 'In Talent Pool');
		if (rows.length) this.resume(rows);
	}

	resume(rows) {
		const tp = window.ms_talent_pool;
		const by_dt = {};
		rows.forEach(r => { (by_dt[r.doctype] = by_dt[r.doctype] || []).push(r); });
		const dts = Object.keys(by_dt);
		const done = () => this.load();
		if (dts.length === 1 && tp) {
			// One unit: the normal Resume dialog (pick the status to resume to).
			const dt = dts[0], list = by_dt[dt];
			frappe.model.with_doctype(dt, () => {
				tp.resume(dt, list.map(r => r.app_id), done, list.length === 1 ? list[0].status_before : null);
			});
			return;
		}
		// Several units: statuses differ per unit, so each goes back to its own earlier status.
		frappe.confirm(
			__('Resume {0} applications from {1} units? Each goes back to its status before the Talent Pool.', [rows.length, dts.length]),
			() => {
				const calls = dts.map(dt => frappe.xcall('ms_calendar.api.talent_pool.resume_from_talent_pool', {
					doctype: dt, names: by_dt[dt].map(r => r.app_id), resume_status: '__before__',
				}));
				frappe.dom.freeze(__('Resuming…'));
				Promise.all(calls).then((res) => {
					frappe.dom.unfreeze();
					const total = { done: [], skipped: [], failed: [] };
					let queued = 0;
					res.forEach(x => {
						if (!x) return;
						if (x.queued) { queued += x.count; return; }
						['done', 'skipped', 'failed'].forEach(k => { total[k] = total[k].concat(x[k] || []); });
					});
					let msg = `<p><b>${total.done.length}</b> ${__('resumed from Talent Pool')}.</p>`;
					if (queued) msg += `<p>${__('{0} more are being resumed in the background.', [queued])}</p>`;
					[['skipped', __('Skipped')], ['failed', __('Failed')]].forEach(([k, l]) => {
						if (!total[k].length) return;
						msg += `<p>${l} (${total[k].length}):</p><ul>` + total[k].slice(0, 100)
							.map(x => `<li><b>${this.esc(x.name)}</b>: ${this.esc(x.reason || x.error)}</li>`).join('') + '</ul>';
					});
					frappe.msgprint({ title: __('Talent Pool'), message: msg, indicator: total.failed.length ? 'orange' : 'green' });
					done();
				}).catch(() => { frappe.dom.unfreeze(); done(); });
			}
		);
	}

	// ── CSV (same scoped rows as on screen) ─────────────────────────────
	download_csv(rows, cols, name) {
		const safe = (v) => {
			let s = v === null || v === undefined ? '' : String(v);
			if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // no spreadsheet formulas
			return '"' + s.replace(/"/g, '""') + '"';
		};
		const lines = [cols.map(c => safe(c.label)).join(',')];
		rows.forEach(r => lines.push(cols.map(c => safe(c.type === 'date' ? this.date(r[c.key]) : r[c.key])).join(',')));
		const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + frappe.datetime.get_today() + '.csv';
		document.body.appendChild(a);
		a.click();
		setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
	}

	// ── styles ──────────────────────────────────────────────────────────
	inject_css() {
		if (document.getElementById('tpp-css')) return;
		$('head').append(`<style id="tpp-css">
.tpp-root, .tpp-dd { --tpp-navy:#1A3550; --tpp-border:var(--border-color, #E2E6EA); --tpp-bg:var(--card-bg, #fff);
	--tpp-text:var(--text-color, #1F2933); --tpp-muted:var(--text-muted, #6B7A8A); --tpp-hover:var(--fg-hover-color, #F3F5F7); }
.tpp-root { padding:4px 0 32px; color:var(--tpp-text); }
.tpp-muted { color:var(--tpp-muted); }
.tpp-small { font-size:11.5px; }
.tpp-filters { display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; background:var(--tpp-bg); border:1px solid var(--tpp-border);
	border-radius:8px; padding:12px 14px; margin-bottom:14px; }
.tpp-f { display:flex; flex-direction:column; gap:4px; min-width:150px; }
.tpp-f label { font-size:11.5px; font-weight:600; color:var(--tpp-muted); margin:0; }
.tpp-f-search { flex:1 1 220px; }
.tpp-f-btns { flex-direction:row; gap:8px; min-width:0; }
.tpp-ms { position:relative; }
.tpp-ms-btn { display:flex; justify-content:space-between; align-items:center; gap:8px; width:190px; height:30px; padding:0 10px;
	border:1px solid var(--tpp-border); border-radius:6px; background:var(--control-bg, #F4F5F6); color:var(--tpp-text); font-size:13px; }
.tpp-ms-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tpp-ms-panel { position:absolute; z-index:20; top:34px; left:0; width:230px; background:var(--tpp-bg); border:1px solid var(--tpp-border);
	border-radius:8px; box-shadow:0 6px 20px rgba(0,0,0,.08); padding:8px; }
.tpp-ms-actions { display:flex; gap:6px; margin-bottom:6px; }
.tpp-ms-item { display:flex; align-items:center; gap:8px; padding:5px 4px; margin:0; font-size:13px; font-weight:400; cursor:pointer; border-radius:4px; }
.tpp-ms-item:hover { background:var(--tpp-hover); }
.tpp-cards-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:12.5px; gap:8px; }
.tpp-cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:12px; margin-bottom:16px; }
.tpp-card { background:var(--tpp-bg); border:1px solid var(--tpp-border); border-radius:8px; padding:14px 16px 12px;
	display:flex; flex-direction:column; gap:6px; min-width:0; }
.tpp-card.is-click { cursor:pointer; }
.tpp-card.is-click:hover, .tpp-card.is-click:focus-visible { border-color:#9FB3C8; outline:none; }
.tpp-card-top { display:flex; justify-content:space-between; align-items:center; gap:8px; }
.tpp-card-label { font-size:13px; font-weight:650; display:flex; align-items:center; gap:7px; }
.tpp-dot { width:8px; height:8px; border-radius:50%; background:var(--c); display:inline-block; flex:none; }
.tpp-info { color:var(--tpp-muted); cursor:help; font-size:13px; }
.tpp-card-value { font-size:28px; font-weight:700; font-variant-numeric:tabular-nums; color:var(--tpp-text); line-height:1.1; }
.tpp-card-value small { font-size:13px; font-weight:500; color:var(--tpp-muted); }
.tpp-card-sub { font-size:12px; color:var(--tpp-muted); display:flex; align-items:center; gap:8px; }
.tpp-tag { display:inline-block; font-size:10.5px; font-weight:700; color:#B7651B; border:1px solid #E7C7A6; background:#FBF3EA;
	border-radius:4px; padding:0 5px; line-height:16px; }
.tpp-panel { background:var(--tpp-bg); border:1px solid var(--tpp-border); border-radius:8px; }
.tpp-bar { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; padding:10px 12px;
	border-bottom:1px solid var(--tpp-border); }
.tpp-tabs { display:flex; gap:4px; flex-wrap:wrap; }
.tpp-tab { border:1px solid transparent; background:none; border-radius:6px; padding:5px 12px; font-size:13px; font-weight:600; color:var(--tpp-muted); }
.tpp-tab:hover { background:var(--tpp-hover); }
.tpp-tab.is-on { color:var(--tpp-navy); border-color:var(--tpp-border); background:var(--tpp-hover); }
.tpp-count { font-weight:500; margin-left:4px; font-variant-numeric:tabular-nums; }
.tpp-bar-right { display:flex; gap:8px; }
.tpp-table-wrap { overflow:auto; max-height:calc(100vh - 360px); min-height:120px; }
.tpp-table { width:100%; border-collapse:collapse; font-size:12.5px; }
.tpp-table th { position:sticky; top:0; z-index:1; background:var(--tpp-hover); text-align:left; font-weight:650; padding:8px 10px;
	border-bottom:1px solid var(--tpp-border); white-space:nowrap; }
.tpp-table th.tpp-sort { cursor:pointer; user-select:none; }
.tpp-table td { padding:7px 10px; border-bottom:1px solid var(--tpp-border); vertical-align:top; }
.tpp-table tbody tr:hover { background:var(--tpp-hover); }
.tpp-table .is-num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
.tpp-c-chk { width:28px; }
.tpp-table .is-date, .tpp-table .tpp-col-app_id, .tpp-table .tpp-col-unit, .tpp-table .tpp-col-email_sent_on { white-space:nowrap; }
.tpp-table td.tpp-col-remarks { min-width:180px; max-width:280px; }
.tpp-table td.tpp-col-job_title, .tpp-table td.tpp-col-status_before, .tpp-table td.tpp-col-resumed_to_status,
.tpp-table td.tpp-col-current_status { min-width:120px; }
.tpp-table td.tpp-col-candidate { min-width:170px; }
.tpp-table .tpp-c-act { position:sticky; right:0; background:var(--tpp-bg); box-shadow:-1px 0 0 var(--tpp-border); white-space:nowrap; }
.tpp-table th.tpp-c-act { background:var(--tpp-hover); z-index:2; }
.tpp-pill { display:inline-block; font-size:11.5px; font-weight:600; border-radius:10px; padding:1px 8px; white-space:nowrap; }
.tpp-pill.is-pool { color:#1A3550; background:#E8EEF5; }
.tpp-pill.is-res { color:#2F7D4F; background:#E9F4EC; }
.tpp-bad { color:#B83232; font-weight:600; cursor:help; }
.tpp-empty { padding:32px 16px; text-align:center; color:var(--tpp-muted); }
.tpp-dd .modal-dialog { margin:3vh auto; max-width:min(1400px, 95vw); }
.tpp-dd .modal-body { padding-top:8px; }
.tpp-dd-bar { display:flex; justify-content:flex-end; margin-bottom:8px; }
.tpp-dd-scroll { max-height:70vh; overflow:auto; border:1px solid var(--tpp-border, #E2E6EA); border-radius:6px; }
@media (max-width: 640px) {
	.tpp-f, .tpp-ms-btn { width:100%; min-width:0; }
	.tpp-filters { padding:10px; }
	.tpp-table-wrap { max-height:none; }
}
</style>`);
	}
}
