// Master Data — /app/master-data
//
// The Field recruitment "Data or Master Tracker" Excel, filled from the
// system: Filters → cards → the two template sheets (Master Tracker /
// Offer Tracker) as tables → "Download Excel" (both sheets, template layout,
// every matching row).
//
// Filters / multiselects look and behave like the Pathways dashboard
// (Apply button, Select all / Clear, cascading Unit → Sub-unit → Job code
// options). Every number and row comes from permission-scoped server calls;
// the table pages and sorts on the server. Every value rendered into HTML
// goes through esc().

const MDT_API = 'ms_calendar.ms_calendar.page.master_data.master_data.';
const MDT_STORE_KEY = 'mdt-filters-v1';
const MDT_LIST_FILTERS = ['units', 'subunits', 'locations', 'job_codes', 'roles', 'statuses'];
const MDT_PAGE_SIZES = [25, 50, 100, 250, 500];

frappe.pages['master-data'].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __('Master Data'),
		single_column: true
	});
	wrapper.mdt = new MasterData(page, wrapper);
};

class MasterData {
	constructor(page, wrapper) {
		this.page = page;
		this.$root = $(wrapper).find('.page-content');
		this.data = null;
		this.filters = null;
		this.ms = {};
		this.st = { sheet: 'master', page: 1, page_size: 50, sort_by: 'app_date', sort_dir: 'desc', search: '', card: 'all' };
		this.render_shell();
		const saved = this.read_saved() || {};
		const [from_date, to_date] = this.preset_range('year');
		this.filters = Object.assign(this.empty_filters(), saved, { from_date, to_date });
		this.load();
	}

	// ── helpers ────────────────────────────────────────────────────────────
	esc(v) { return frappe.utils.escape_html(v === null || v === undefined ? '' : String(v)); }
	n(v) { return v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN'); }
	fmt(col, v) {
		if (v === null || v === undefined || v === '') return '';
		if (col.type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(String(v))) return this.esc(frappe.datetime.str_to_user(String(v).slice(0, 10)));
		if (col.type === 'number') return this.esc(Number(v).toLocaleString('en-IN'));
		return this.esc(v);
	}

	read_saved() {
		try { return JSON.parse(localStorage.getItem(MDT_STORE_KEY) || 'null'); } catch (e) { return null; }
	}
	// Dates are deliberately not remembered: the page always opens on "This year".
	save_filters(f) {
		try {
			const keep = {};
			MDT_LIST_FILTERS.forEach(k => { keep[k] = f[k] || []; });
			localStorage.setItem(MDT_STORE_KEY, JSON.stringify(keep));
		} catch (e) { /* private mode etc. */ }
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

	empty_filters() {
		return Object.fromEntries(MDT_LIST_FILTERS.map(k => [k, []]));
	}

	current_filters() {
		const $c = this.$root;
		return {
			from_date: $c.find('#mdt-from').val() || null,
			to_date: $c.find('#mdt-to').val() || null,
			...Object.fromEntries(MDT_LIST_FILTERS.map(k => [k, this.ms[k].val()]))
		};
	}

	args(extra = {}) {
		const f = this.filters;
		return Object.assign({
			from_date: f.from_date || null,
			to_date: f.to_date || null,
			...Object.fromEntries(MDT_LIST_FILTERS.map(k => [k, JSON.stringify(f[k] || [])])),
			search: this.st.search || '',
			card: this.st.card || 'all',
			sort_by: this.st.sort_by || '',
			sort_dir: this.st.sort_dir || ''
		}, extra);
	}

	// ── layout ─────────────────────────────────────────────────────────────
	render_shell() {
		this.$root.html(`
			<style>${MDT_CSS}</style>
			<div class="mdt-root">
				<div class="mdt-filters">
					<div class="mdt-topbar">
						<div class="mdt-presets">
							${[['month', __('This month')], ['last30', __('Last 30 days')], ['last90', __('Last 90 days')],
								['year', __('This year')], ['all', __('All time')]]
								.map(([k, l]) => `<button class="mdt-preset" data-p="${k}">${l}</button>`).join('')}
						</div>
						<span class="mdt-muted" id="mdt-sub"></span>
					</div>
					<div class="mdt-filter-row">
						<div class="mdt-f"><label title="${__('Application date from')}">${__('Applied from')}</label><input type="date" id="mdt-from"></div>
						<div class="mdt-f"><label>${__('To')}</label><input type="date" id="mdt-to"></div>
						<div class="mdt-f"><label>${__('Units')}</label><div class="mdt-ms" id="mdt-ms-units" data-placeholder="${__('All units')}"></div></div>
						<div class="mdt-f"><label>${__('Sub-units')}</label><div class="mdt-ms" id="mdt-ms-subunits" data-placeholder="${__('All sub-units')}"></div></div>
						<div class="mdt-f"><label>${__('Location')}</label><div class="mdt-ms" id="mdt-ms-locations" data-placeholder="${__('All locations')}"></div></div>
						<div class="mdt-f"><label>${__('Job code')}</label><div class="mdt-ms" id="mdt-ms-job_codes" data-placeholder="${__('All job codes')}"></div></div>
						<div class="mdt-f"><label>${__('Role')}</label><div class="mdt-ms" id="mdt-ms-roles" data-placeholder="${__('All roles')}"></div></div>
						<div class="mdt-f"><label>${__('Application status')}</label><div class="mdt-ms" id="mdt-ms-statuses" data-placeholder="${__('All statuses')}"></div></div>
						<div class="mdt-f mdt-f-btns">
							<button class="btn btn-primary btn-sm" id="mdt-apply">${__('Apply')}</button>
							<button class="btn btn-default btn-sm" id="mdt-reset">${__('Reset')}</button>
						</div>
					</div>
				</div>

				<div class="mdt-cards" id="mdt-cards"></div>

				<div class="mdt-panel">
					<div class="mdt-panel-head">
						<div class="mdt-tabs" role="tablist">
							<button class="mdt-tab is-on" data-sheet="master" role="tab" aria-selected="true">${__('Master Tracker')}</button>
							<button class="mdt-tab" data-sheet="offer" role="tab" aria-selected="false">${__('Offer Tracker')}</button>
						</div>
						<div class="mdt-tools">
							<span class="mdt-chip-card" id="mdt-card-chip" hidden></span>
							<input type="search" class="mdt-search" id="mdt-search" placeholder="${__('Search ID, name, email, phone, job code…')}">
							<button class="btn btn-primary btn-sm" id="mdt-download" title="${__('Both sheets, every row matching the filters, in the template layout')}">⤓ ${__('Download Excel')}</button>
						</div>
					</div>
					<div class="mdt-table-scroll" id="mdt-table"></div>
					<div class="mdt-pager" id="mdt-pager"></div>
				</div>
			</div>
		`);

		const $c = this.$root;
		MDT_LIST_FILTERS.forEach(k => {
			this.ms[k] = this.make_multiselect($c.find(`#mdt-ms-${k}`), { on_change: () => this.cascade(k) });
		});

		$c.find('#mdt-apply').on('click', () => { this.filters = this.current_filters(); this.st.page = 1; this.load(); });
		$c.find('#mdt-reset').on('click', () => {
			Object.values(this.ms).forEach(m => m.clear());
			const [f, t] = this.preset_range('year');
			this.filters = Object.assign(this.empty_filters(), { from_date: f, to_date: t });
			Object.assign(this.st, { page: 1, search: '', card: 'all' });
			$c.find('#mdt-search').val('');
			this.load();
		});
		// A date preset is a single click = the user is done choosing → apply at once.
		$c.find('.mdt-preset').on('click', (e) => {
			const [f, t] = this.preset_range($(e.currentTarget).data('p'));
			$c.find('#mdt-from').val(f || '');
			$c.find('#mdt-to').val(t || '');
			this.filters = this.current_filters();
			this.st.page = 1;
			this.load();
		});
		$c.find('.mdt-tab').on('click', (e) => {
			this.st.sheet = String($(e.currentTarget).data('sheet'));
			$c.find('.mdt-tab').each((_, el) => {
				const on = $(el).data('sheet') === this.st.sheet;
				$(el).toggleClass('is-on', on).attr('aria-selected', on ? 'true' : 'false');
			});
			this.render_table();
		});
		let timer = null;
		$c.find('#mdt-search').on('input', (e) => {
			clearTimeout(timer);
			timer = setTimeout(() => { this.st.search = e.currentTarget.value.trim(); this.st.page = 1; this.load(true); }, 400);
		});
		$c.find('#mdt-download').on('click', () => this.download());
		$c.on('click', '.mdt-card', (e) => {
			const k = String($(e.currentTarget).data('k'));
			this.st.card = this.st.card === k ? 'all' : k;
			this.st.page = 1;
			this.load(true);
		});
		$c.on('click', '.mdt-card .mdt-i', (e) => e.stopPropagation());
		$c.on('click', '#mdt-card-chip .x', () => { this.st.card = 'all'; this.st.page = 1; this.load(true); });
		$c.on('click', 'th.is-sortable', (e) => {
			const k = String($(e.currentTarget).data('k'));
			if (this.st.sort_by === k) this.st.sort_dir = this.st.sort_dir === 'asc' ? 'desc' : 'asc';
			else { this.st.sort_by = k; this.st.sort_dir = k === 'app_date' ? 'desc' : 'asc'; }
			this.st.page = 1;
			this.load(true);
		});
		$c.on('click', '.mdt-pg', (e) => {
			const p = parseInt($(e.currentTarget).data('p'), 10);
			if (p) { this.st.page = p; this.load(true); }
		});
		$c.on('change', '#mdt-size', (e) => { this.st.page_size = parseInt(e.currentTarget.value, 10) || 50; this.st.page = 1; this.load(true); });
		// Applicant ID → the applicant's full detail (profile, forms, interviews,
		// every feedback) on the Pathways dashboard; Ctrl/Cmd-click opens the form.
		$c.on('click', 'a.mdt-cand', (e) => {
			if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
			e.preventDefault();
			frappe.route_options = { pod_timeline: String($(e.currentTarget).data('id')), pod_program: 'Field' };
			frappe.set_route('pathways-overall-dashboard');
		});
		$(document).on('click.mdt', (e) => { if (!$(e.target).closest('.mdt-ms').length) $('.mdt-ms.open').removeClass('open'); });
	}

	// Cascading OPTIONS (never gating): Units narrow the Sub-unit list, and
	// Units + Sub-units narrow the Job-code list.
	cascade(changed) {
		if (!['units', 'subunits'].includes(changed) || !this.data) return;
		const combos = (this.data.options || {}).combos || [];
		const units = this.ms.units.val();
		const uniq = (a) => [...new Set(a.filter(Boolean))].sort();
		if (changed === 'units') {
			this.ms.subunits.setOptions(uniq(combos.filter(c => !units.length || units.includes(c[0])).map(c => c[1])));
		}
		const subs = this.ms.subunits.val();
		this.ms.job_codes.setOptions(uniq(combos
			.filter(c => (!units.length || units.includes(c[0])) && (!subs.length || subs.includes(c[1])))
			.map(c => c[2])));
	}

	// Same chip multiselect as the Pathways / Field dashboards (search,
	// Select all / Clear, checkbox list).
	make_multiselect($el, cfg = {}) {
		const changed = () => { if (cfg.on_change) cfg.on_change(); };
		const esc = (v) => this.esc(v);
		const placeholder = $el.data('placeholder') || __('All');
		let options = [];
		let selected = [];
		$el.html(`
			<div class="mdt-ms-box"></div>
			<div class="mdt-ms-panel">
				<div class="mdt-ms-search"><input type="text" placeholder="${__('Search…')}"></div>
				<div class="mdt-ms-actions"><a class="mdt-ms-all">${__('Select all')}</a><a class="mdt-ms-none">${__('Clear')}</a></div>
				<div class="mdt-ms-list"></div>
			</div>`);
		const $box = $el.find('.mdt-ms-box');
		const $search = $el.find('.mdt-ms-search input');
		const $list = $el.find('.mdt-ms-list');
		const render_box = () => {
			$box.empty();
			if (!selected.length) { $box.append(`<span class="mdt-ms-ph">${esc(placeholder)}</span>`); return; }
			selected.slice(0, 2).forEach(v => $box.append(
				`<span class="mdt-ms-chip" title="${esc(v)}"><span class="txt">${esc(v)}</span><span class="x" data-v="${esc(v)}">&times;</span></span>`));
			if (selected.length > 2) $box.append(`<span class="mdt-ms-more">+${selected.length - 2}</span>`);
		};
		const render_list = () => {
			const q = ($search.val() || '').toLowerCase();
			const matches = options.filter(v => v.toLowerCase().includes(q));
			$list.html(matches.length ? matches.map(v => `
				<label class="mdt-ms-opt"><input type="checkbox" data-v="${esc(v)}" ${selected.includes(v) ? 'checked' : ''}>
				<span>${esc(v)}</span></label>`).join('') : `<div class="mdt-ms-empty">${__('No matches')}</div>`);
		};
		$box.on('click', (e) => {
			if ($(e.target).hasClass('x')) return;
			const open = $el.hasClass('open');
			$('.mdt-ms.open').removeClass('open');
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
		$el.find('.mdt-ms-all').on('click', (e) => {
			e.stopPropagation();
			const q = ($search.val() || '').toLowerCase();
			selected = [...new Set([...selected, ...options.filter(v => v.toLowerCase().includes(q))])];
			render_box(); render_list(); changed();
		});
		$el.find('.mdt-ms-none').on('click', (e) => { e.stopPropagation(); selected = []; render_box(); render_list(); changed(); });
		render_box();
		return {
			setOptions(opts) { options = opts.slice(); render_box(); },
			setVal(vals) { selected = (vals || []).slice(); render_box(); },
			val() { return selected.slice(); },
			clear() { selected = []; render_box(); }
		};
	}

	// ── data ───────────────────────────────────────────────────────────────
	// table_only: paging / sorting / search / card — the filters didn't change.
	load(table_only = false) {
		const $c = this.$root;
		$c.find('#mdt-apply').prop('disabled', true).text(__('Loading…'));
		$c.addClass('mdt-loading');
		frappe.call({
			method: MDT_API + 'get_master_data',
			args: this.args({ page: this.st.page, page_size: this.st.page_size }),
			callback: (r) => {
				this.data = r.message || {};
				this.st.page = this.data.page || 1;
				if (!table_only) {
					this.filters = Object.assign({}, this.filters, this.data.filters || {});
					this.save_filters(this.filters);
					const f = this.filters;
					$c.find('#mdt-from').val(f.from_date || '');
					$c.find('#mdt-to').val(f.to_date || '');
					const o = this.data.options || {};
					this.ms.units.setOptions(o.units || []);
					this.ms.locations.setOptions(o.locations || []);
					this.ms.roles.setOptions(o.roles || []);
					this.ms.statuses.setOptions(o.statuses || []);
					['units', 'locations', 'roles', 'statuses', 'subunits', 'job_codes'].forEach(k => this.ms[k].setVal(f[k]));
					this.cascade('units');
					this.mark_preset();
				}
				this.render_cards();
				this.render_table();
			},
			always: () => {
				$c.find('#mdt-apply').prop('disabled', false).text(__('Apply'));
				$c.removeClass('mdt-loading');
			}
		});
	}

	mark_preset() {
		const f = this.filters;
		this.$root.find('.mdt-preset').each((_, el) => {
			const [a, b] = this.preset_range($(el).data('p'));
			$(el).toggleClass('is-on', (a || null) === (f.from_date || null) && (b || null) === (f.to_date || null));
		});
		const range = f.from_date || f.to_date
			? `${f.from_date ? frappe.datetime.str_to_user(f.from_date) : '…'} – ${f.to_date ? frappe.datetime.str_to_user(f.to_date) : '…'}`
			: __('All time');
		this.$root.find('#mdt-sub').text(`${__('Field Registration Forms applied')} ${range}`);
	}

	render_cards() {
		const cards = ((this.data.summary || {}).cards) || [];
		this.$root.find('#mdt-cards').html(cards.map(c => `
			<button class="mdt-card ${this.st.card === c.key ? 'is-on' : ''}" data-k="${this.esc(c.key)}"
				title="${this.esc(__('Click to show only these in the table'))}">
				<div class="mdt-card-top">
					<span class="mdt-card-label">${this.esc(__(c.label))}</span>
					<span class="mdt-i" tabindex="0" title="${this.esc(c.desc)}">ⓘ</span>
				</div>
				<div class="mdt-card-value">${this.n(c.value)}</div>
				<div class="mdt-card-sub">${c.pct !== null && c.pct !== undefined
					? this.esc((c.pct === 0 && c.value ? '<0.1' : c.pct) + '% ' + __('of applicants'))
					: this.esc(__('matching the filters'))}</div>
			</button>`).join(''));
		const on = cards.find(c => c.key === this.st.card && c.key !== 'all');
		const $chip = this.$root.find('#mdt-card-chip');
		if (on) $chip.html(`${this.esc(__('Showing'))}: <b>${this.esc(__(on.label))}</b> <span class="x" title="${this.esc(__('Show all'))}">&times;</span>`).prop('hidden', false);
		else $chip.empty().prop('hidden', true);
	}

	render_table() {
		const d = this.data || {};
		const meta = d.columns || {};
		const cols = (this.st.sheet === 'master' ? meta.master : meta.offer) || [];
		const rows = d.rows || [];
		const arrow = (k) => this.st.sort_by === k ? (this.st.sort_dir === 'asc' ? ' ▲' : ' ▼') : '';
		let head = '';
		if (this.st.sheet === 'master') {
			const spans = [];
			cols.forEach(c => {
				const last = spans[spans.length - 1];
				if (last && last.group === c.group) last.n += 1; else spans.push({ group: c.group, n: 1 });
			});
			const label = Object.fromEntries((meta.groups || []).map(g => [g.key, g.label]));
			head += `<tr class="mdt-grp">${spans.map(s =>
				`<th colspan="${s.n}" class="g-${this.esc(s.group)}"><span>${this.esc(label[s.group] || '')}</span></th>`).join('')}</tr>`;
		}
		head += `<tr class="mdt-hdr">${cols.map((c, i) =>
			`<th data-k="${this.esc(c.key)}" class="${c.sortable ? 'is-sortable' : ''} ${i === 0 ? 'mdt-sticky' : ''} ${c.group ? 'g-' + this.esc(c.group) : ''}"
				title="${this.esc(c.sortable ? __('Sort') : '')}">${this.esc(c.label)}${arrow(c.key)}</th>`).join('')}</tr>`;
		const body = rows.length ? rows.map(r => `<tr>${cols.map((c, i) => {
			if (i === 0) {
				return `<td class="mdt-sticky"><a class="mdt-cand" data-id="${this.esc(r.name)}"
					href="/app/field-registration-form/${encodeURIComponent(r.name)}"
					title="${this.esc(__('View applicant details'))}">${this.esc(r.name)}</a></td>`;
			}
			return `<td class="${c.type === 'number' ? 'num' : ''}">${this.fmt(c, r[c.key])}</td>`;
		}).join('')}</tr>`).join('')
			: `<tr><td class="mdt-empty" colspan="${cols.length}">${this.esc(__('No applicants match these filters.'))}</td></tr>`;
		this.$root.find('#mdt-table').html(`<table class="mdt-table"><thead>${head}</thead><tbody>${body}</tbody></table>`);
		this.render_pager();
	}

	render_pager() {
		const d = this.data || {};
		const total = d.total || 0;
		const from = total ? (d.page - 1) * d.page_size + 1 : 0;
		const to = Math.min(total, d.page * d.page_size);
		const pg = (p, l, dis) => `<button class="btn btn-default btn-xs mdt-pg" data-p="${p}" ${dis ? 'disabled' : ''}>${l}</button>`;
		this.$root.find('#mdt-pager').html(`
			<span class="mdt-muted">${this.esc(__('Showing {0}–{1} of {2}', [this.n(from), this.n(to), this.n(total)]))}</span>
			<span class="mdt-pager-btns">
				${pg(1, '«', d.page <= 1)}${pg(d.page - 1, '‹', d.page <= 1)}
				<span class="mdt-muted">${this.esc(__('Page {0} of {1}', [this.n(d.page), this.n(d.pages)]))}</span>
				${pg(d.page + 1, '›', d.page >= d.pages)}${pg(d.pages, '»', d.page >= d.pages)}
				<select id="mdt-size" class="mdt-size" aria-label="${this.esc(__('Rows per page'))}">
					${MDT_PAGE_SIZES.map(s => `<option value="${s}" ${s === d.page_size ? 'selected' : ''}>${s} / ${__('page')}</option>`).join('')}
				</select>
			</span>`);
	}

	download() {
		const q = this.args();
		const qs = Object.keys(q).filter(k => q[k] !== null && q[k] !== undefined && q[k] !== '')
			.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(q[k])}`).join('&');
		const a = document.createElement('a');
		a.href = `/api/method/${MDT_API}download_excel?${qs}`;
		a.rel = 'noopener';
		document.body.appendChild(a);
		a.click();
		a.remove();
		frappe.show_alert({
			message: __('Preparing Excel of {0} applicants (both sheets)…', [this.n((this.data || {}).total || 0)]),
			indicator: 'blue'
		}, 6);
	}
}

const MDT_CSS = `
.mdt-root { --page:#E9EFF6; --bg:#FFFFFF; --bg-soft:#F8FAFC; --border:#DDE3EA; --border-soft:#EDF1F5; --text:#1A2B3C;
	--text-2:#3E4C59; --muted:#6B7A8A; --link:#1F5FA6; --hover:#F5F8FB; --brand:#1F4E79; --shadow:0 1px 2px rgba(16,24,40,.04);
	--g-app:#1F4E79; --g-test:#7A4E12; --g-iv:#1F5C4A; --g-offer:#5B3A7A;
	color:var(--text); padding:18px 22px 48px; background:var(--page); min-height:calc(100vh - 60px); transition:opacity .15s; }
:root[data-theme="dark"] .mdt-root { --page:#141619; --bg:#1C1F24; --bg-soft:#22262C; --border:#343A42; --border-soft:#2A2F36;
	--text:#E8ECF1; --text-2:#C3CBD5; --muted:#8C98A6; --link:#8DB8E8; --hover:#23272E; --brand:#5B8FC7; --shadow:none;
	--g-app:#2D5E8E; --g-test:#8A6224; --g-iv:#2D6E5B; --g-offer:#6C4B8C; }
.mdt-root.mdt-loading { opacity:.6; }
.mdt-muted { font-size:12px; color:var(--muted); }
.mdt-filters { background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:12px 16px 14px; margin-bottom:16px; box-shadow:var(--shadow); }
.mdt-topbar { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:flex-start; gap:8px; }
.mdt-presets { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
.mdt-preset { border:1px solid var(--border); background:var(--bg-soft); color:var(--text-2); border-radius:20px; padding:3px 12px;
	font-size:12px; font-weight:600; cursor:pointer; }
.mdt-preset:hover { border-color:var(--brand); color:var(--brand); }
.mdt-preset.is-on { background:var(--brand); border-color:var(--brand); color:#fff; }
#mdt-apply, #mdt-download { background:var(--brand); border-color:var(--brand); color:#fff; }
#mdt-apply:hover, #mdt-download:hover { filter:brightness(1.08); }
.mdt-filter-row { display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; }
.mdt-f { display:flex; flex-direction:column; gap:3px; }
.mdt-f label { font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; margin:0; }
.mdt-f input[type=date] { height:32px; border:1px solid var(--border); border-radius:8px; padding:0 8px; font-size:12.5px; background:var(--bg); color:var(--text); }
.mdt-f-btns { flex-direction:row; gap:6px; margin-left:auto; }
.mdt-ms { position:relative; min-width:170px; max-width:240px; }
.mdt-ms-box { display:flex; flex-wrap:wrap; align-items:center; gap:4px; padding:3px 8px; border:1px solid var(--border);
	border-radius:8px; background:var(--bg); cursor:pointer; min-height:32px; }
.mdt-ms.open .mdt-ms-box { border-color:var(--brand); box-shadow:0 0 0 3px color-mix(in srgb, var(--brand) 18%, transparent); }
.mdt-ms-ph { font-size:12.5px; color:var(--muted); }
.mdt-ms-chip { display:inline-flex; align-items:center; gap:4px; background:color-mix(in srgb, var(--brand) 12%, transparent); color:var(--text-2); border-radius:6px;
	padding:1px 5px 1px 7px; font-size:11px; font-weight:600; max-width:120px; }
.mdt-ms-chip .txt { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.mdt-ms-chip .x { cursor:pointer; opacity:.7; }
.mdt-ms-more { font-size:11px; color:var(--muted); font-weight:600; }
.mdt-ms-panel { display:none; position:absolute; top:calc(100% + 4px); left:0; z-index:60; background:var(--bg);
	border:1px solid var(--border); border-radius:10px; box-shadow:0 10px 24px -8px rgba(16,24,40,.25);
	width:max(100%,270px); max-width:min(360px,90vw); max-height:300px; overflow-y:auto; }
.mdt-ms.open .mdt-ms-panel { display:block; }
.mdt-ms-search { position:sticky; top:0; background:var(--bg); padding:6px; border-bottom:1px solid var(--border-soft); }
.mdt-ms-search input { width:100%; padding:5px 8px; border:1px solid var(--border); border-radius:6px; font-size:12px; background:var(--bg); color:var(--text); }
.mdt-ms-actions { display:flex; justify-content:space-between; padding:5px 8px; border-bottom:1px solid var(--border-soft); font-size:11px; }
.mdt-ms-actions a { color:var(--link); cursor:pointer; font-weight:600; }
.mdt-ms-opt { display:flex; gap:8px; padding:6px 10px; font-size:12px; cursor:pointer; margin:0; font-weight:400; color:var(--text); }
.mdt-ms-opt:hover { background:var(--hover); }
.mdt-ms-empty { padding:10px; font-size:12px; color:var(--muted); text-align:center; }
/* cards: flat, bordered; the selected one carries the brand edge */
.mdt-cards { display:grid; grid-template-columns:repeat(5, minmax(0,1fr)); gap:12px; margin-bottom:16px; }
.mdt-card { text-align:left; background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:12px 14px;
	cursor:pointer; box-shadow:var(--shadow); color:var(--text); }
.mdt-card:hover { border-color:var(--brand); }
.mdt-card.is-on { border-color:var(--brand); box-shadow:inset 3px 0 0 var(--brand); }
.mdt-card-top { display:flex; justify-content:space-between; gap:6px; }
.mdt-card-label { font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }
.mdt-i { color:var(--muted); cursor:help; font-size:12px; }
.mdt-card-value { font-size:24px; font-weight:700; margin-top:4px; font-variant-numeric:tabular-nums; }
.mdt-card-sub { font-size:11.5px; color:var(--muted); }
/* sheet panel */
.mdt-panel { background:var(--bg); border:1px solid var(--border); border-radius:10px; box-shadow:var(--shadow); min-width:0; }
.mdt-panel-head { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:10px; padding:10px 14px;
	border-bottom:1px solid var(--border); }
.mdt-tabs { display:flex; gap:4px; }
.mdt-tab { border:1px solid var(--border); background:var(--bg-soft); color:var(--text-2); border-radius:8px; padding:5px 14px;
	font-size:12.5px; font-weight:600; cursor:pointer; }
.mdt-tab.is-on { background:var(--brand); border-color:var(--brand); color:#fff; }
.mdt-tools { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.mdt-search { height:30px; width:280px; max-width:100%; border:1px solid var(--border); border-radius:8px; padding:0 10px; font-size:12.5px;
	background:var(--bg); color:var(--text); }
.mdt-chip-card { font-size:12px; background:color-mix(in srgb, var(--brand) 12%, transparent); border-radius:6px; padding:3px 8px; }
.mdt-chip-card .x { cursor:pointer; margin-left:4px; opacity:.7; }
.mdt-table-scroll { overflow:auto; max-height:calc(100vh - 260px); }
.mdt-table { border-collapse:separate; border-spacing:0; font-size:12px; width:max-content; min-width:100%; }
.mdt-table th, .mdt-table td { border-bottom:1px solid var(--border-soft); border-right:1px solid var(--border-soft); padding:6px 10px;
	text-align:left; vertical-align:top; }
.mdt-table td { white-space:nowrap; max-width:280px; overflow:hidden; text-overflow:ellipsis; background:var(--bg); }
.mdt-table td.num { text-align:right; font-variant-numeric:tabular-nums; }
.mdt-table tbody tr:hover td { background:var(--hover); }
.mdt-table thead th { position:sticky; background:var(--bg-soft); z-index:2; }
.mdt-table tr.mdt-grp th { top:0; height:30px; color:#fff; font-weight:700; font-size:11.5px; white-space:nowrap; }
.mdt-table tr.mdt-grp th span { position:sticky; left:12px; }
.mdt-table tr.mdt-hdr th { top:0; font-weight:700; color:var(--text-2); min-width:120px; max-width:220px; white-space:normal; line-height:1.3;
	border-bottom:1px solid var(--border); }
.mdt-table thead tr.mdt-grp + tr.mdt-hdr th { top:30px; }
.mdt-table tr.mdt-hdr th.is-sortable { cursor:pointer; }
.mdt-table tr.mdt-hdr th.is-sortable:hover { color:var(--link); }
.mdt-table tr.mdt-grp th.g-app { background:var(--g-app); } .mdt-table tr.mdt-grp th.g-test { background:var(--g-test); }
.mdt-table tr.mdt-grp th.g-iv { background:var(--g-iv); } .mdt-table tr.mdt-grp th.g-offer { background:var(--g-offer); }
.mdt-table tr.mdt-hdr th.g-app { box-shadow:inset 0 3px 0 var(--g-app); } .mdt-table tr.mdt-hdr th.g-test { box-shadow:inset 0 3px 0 var(--g-test); }
.mdt-table tr.mdt-hdr th.g-iv { box-shadow:inset 0 3px 0 var(--g-iv); } .mdt-table tr.mdt-hdr th.g-offer { box-shadow:inset 0 3px 0 var(--g-offer); }
.mdt-table .mdt-sticky { position:sticky; left:0; z-index:1; }
.mdt-table thead .mdt-sticky { z-index:3; }
.mdt-table td.mdt-sticky { border-right:1px solid var(--border); font-weight:600; }
.mdt-table td.mdt-sticky a { color:var(--link); }
.mdt-empty { text-align:center !important; color:var(--muted); padding:24px !important; }
.mdt-pager { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px; padding:8px 14px;
	border-top:1px solid var(--border); }
.mdt-pager-btns { display:flex; gap:4px; align-items:center; }
.mdt-size { height:24px; border:1px solid var(--border); border-radius:6px; font-size:12px; background:var(--bg); color:var(--text); margin-left:6px; }
@media (max-width: 900px) { .mdt-cards { grid-template-columns:repeat(2, minmax(0,1fr)); } }
@media (max-width: 600px) { .mdt-root { padding:12px 16px 40px; } .mdt-ms { max-width:none; width:100%; } .mdt-f { width:100%; }
	.mdt-search { width:100%; } .mdt-tools { width:100%; } .mdt-f-btns { margin-left:0; } }
`;
