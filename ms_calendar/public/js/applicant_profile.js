// Applicant profile popup — one copy, shared by the Pathways Overall
// Dashboard (Applicant ID / name clicks) and the four registration
// DocTypes (list: click a name; form: "View profile" button).
//
//   pathways_applicant_profile.open(program, applicant_id, host)
//
// `host` is the dashboard page when called from there: it supplies the
// board's cards (pipeline-stage chips open that card's list) and the
// timeline popup. Elsewhere the chips are plain and "View timeline" opens
// the dashboard on that applicant's timeline. Data comes from
// get_candidate_detail, which checks read permission server-side.
// Loaded app-wide (hooks.py app_include_js); an IIFE + guard so nothing
// leaks into, or is re-declared in, the global scope.
(function () {
	if (window.pathways_applicant_profile) return;

	const POD_API = 'ms_calendar.ms_calendar.page.pathways_overall_dashboard.pathways_overall_dashboard.';
	const POD_PROGRAM_COLORS = {
		'Field': '#2a78d6', 'Health': '#eb6834', 'Philanthropy': '#1baf7a', 'Scholarship': '#eda100'
	};
	const POD_STAGE_COLORS = {
		'New': '#8A96A3', 'In process': '#2C5F8A', 'On hold': '#B7791F',
		'Offer / Selected': '#2F7D4F', 'Not selected': '#B83232'
	};
	const POD_TONES = {
		good: '#2F7D4F', bad: '#B83232', action: '#B7651B', info: '#2C5F8A', neutral: '#6B7A8A', time: '#A16207'
	};
	// Registration DocType → dashboard programme key.
	const AP_PROGRAMS = {
		'Field Registration Form': 'Field',
		'Health Registration Form': 'Health',
		'Phil Registration Form': 'Philanthropy',
		'Scholarship Recruitment Form': 'Scholarship',
	};

	class ApplicantProfile {
		constructor(host) { this.host = host || null; }

		// ── host hooks (dashboard only) ──
		get cards_by_key() { return (this.host && this.host.cards_by_key) || {}; }
		drill(kind, title, extra) { if (this.host) this.host.drill(kind, title, extra); }
		open_timeline(program, id) {
			if (this.host) return this.host.open_timeline(program, id);
			frappe.route_options = { pod_timeline: id, pod_program: program };
			frappe.set_route('pathways-overall-dashboard');
		}

		// ── helpers (same as the dashboard's) ──
		esc(v) { return frappe.utils.escape_html(v === null || v === undefined ? '' : String(v)); }
		fmt_date(d) { return d ? frappe.datetime.str_to_user(d) : ''; }
		// 'YYYY-MM-DD HH:MM' → user format, without the ':00' seconds.
		fmt_dt(d) { return d ? frappe.datetime.str_to_user(d).replace(/(\d{1,2}:\d{2}):\d{2}$/, '$1') : ''; }
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

		// ── candidate detail (level 2) ─────────────────────────────────────────
		// One applicant, everything on file, laid out like an applicant profile:
		// a left sidebar (who they are, current status, contact, key details,
		// actions) and a working area with tabs — Overview (stats, journey,
		// pipeline, recent activity), Registration (every filled-in field, laid
		// out like the form), Forms (each form's own content), Interviews &
		// feedback, Documents and History. "Open in Frappe" goes to the
		// registration record itself. All data is read-permission checked on the
		// server (get_candidate_detail).
		open_candidate(program, id) {
			frappe.call({
				method: POD_API + 'get_candidate_detail',
				args: { program, name: id },
				freeze: true,
				callback: (r) => {
					const c = r.message;
					if (!c) return;
					const esc = (v) => this.esc(v);
					this.c360_fill_from_profile(c);
					const doctype = Object.keys(AP_PROGRAMS).find(k => AP_PROGRAMS[k] === c.program);
					const ivs = c.interviews || [], fbs = c.feedback || [];
					const docs = c.documents || [], hist = c.history || [];
					const live_ivs = ivs.filter(i => !i.cancelled);
					const rel = c.related || [];
					const rel_of = (g) => rel.filter(x => x.group === g);
					const apps = rel_of('application'), tests = rel_of('assessment');
					const onb = rel_of('onboarding'), other = rel_of('other');
					const d = new frappe.ui.Dialog({ title: __('Applicant profile'), size: 'extra-large' });
					d.$wrapper.find('.modal-dialog').addClass('modal-dialog-centered pod-modal-wide pod-c360-dialog');

					const tabs = [
						['overview', __('Overview'), null],
						['registration', __('Registration'), null],
						['application', __('Application'), apps.length],
						['assessments', __('Assessments'), tests.length],
						['interviews', __('Interviews & feedback'), ivs.length + fbs.length],
						['onboarding', __('Onboarding'), onb.length],
						['documents', __('Documents'), docs.length],
						['history', __('History'), hist.length],
					];
					if (other.length) tabs.splice(tabs.length - 2, 0, ['other', __('Other records'), other.length]);

					// ── Overview ──
					const go = (html, tab) => html.replace('class="pod-step', `data-goto="${tab}" title="${esc(__('Show details'))}" class="pod-c360-go pod-step`);
					const last_iv = live_ivs.slice(-1)[0];
					const last_fb = fbs.slice(-1)[0];
					const activity = [
						...hist.map(h => ({ at: h.on, tab: 'history', kind: __('Status'), text: `${h.from || __('(none)')} → ${h.to}`, by: h.by })),
						...ivs.map(i => ({ at: i.date + (i.start ? ` ${i.start}` : ''), tab: 'interviews', kind: __('Interview'),
							text: `${i.cancelled ? __('Cancelled') + ': ' : ''}${i.round || __('Interview')}${i.mode ? ' · ' + i.mode : ''}`, by: i.interviewer })),
						...fbs.map(f => ({ at: f.submitted_on, tab: 'interviews', kind: __('Feedback'), text: f.result || __('Submitted'), by: f.by })),
						...rel.map(f => ({ at: f.date, tab: f.group === 'assessment' ? 'assessments' : f.group,
							kind: f.group === 'assessment' ? __('Test') : __('Form'), text: f.doctype, by: '' })),
					].filter(a => a.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 6);

					const overview = `
						<div class="pod-c360-stats">
							${(() => {
								// Latest test score when there is one, else the application.
								const t = tests.find(x => x.doctype === 'Field MeritTrac Test Result');
								const score = t && t.summary.find(s => s.label === 'Score');
								const out = t && t.summary.find(s => s.label === 'Out of');
								return t
									? this.c360_stat('assessments', '#2a78d6', __('Test score'), score ? score.value : '—',
										out ? `${__('out of')} ${out.value}` + ((t.summary.find(s => s.label === 'Percentile') || {}).value ? ` · ${t.summary.find(s => s.label === 'Percentile').value} ${__('percentile')}` : '') : t.doctype)
									: this.c360_stat('application', '#2a78d6', __('Forms on file'), rel.length,
										rel.length ? rel.map(f => f.doctype).filter((v, i, a) => a.indexOf(v) === i).join(', ') : __('None yet'));
							})()}
							${this.c360_stat('interviews', '#7c5cc4', __('Interviews'), live_ivs.length,
								last_iv ? `${last_iv.round || __('Interview')} · ${this.fmt_date(last_iv.date)}` : __('None scheduled'))}
							${this.c360_stat('interviews', '#1a9e63', __('Feedback'), fbs.length,
								last_fb ? `${last_fb.result || __('Submitted')}${last_fb.by ? ' · ' + last_fb.by : ''}` : __('None yet'))}
							${this.c360_stat('documents', '#c98500', __('Documents'), docs.length,
								docs.length ? docs.slice(0, 2).map(x => this.c360_file_name(x.url)).join(', ') : __('None attached'))}
						</div>
						<div class="pod-c360-card">
							<div class="pod-c360-card-h">${__('Journey')}</div>
							<div class="pod-journey pod-c360-journey">
								${go(this.step(__('Registered'), true), 'registration')}
								${c.applied === null ? '' : go(this.step(__('Application form'), c.applied), 'application')}
								${go(this.step(__('Interviewed'), live_ivs.length > 0), 'interviews')}
								${go(this.step(__('Feedback'), fbs.length > 0), 'interviews')}
								${go(this.step(c.stage === 'Not selected' ? __('Not selected') : __('Offer / Selected'),
									['Offer / Selected', 'Not selected'].includes(c.stage), c.stage === 'Not selected'), 'history')}
							</div>
						</div>
						${this.c360_key_details(c)}
						<div class="pod-c360-split">
							<div class="pod-c360-card">
								<div class="pod-c360-card-h">${__('Pipeline stages')}<span class="pod-c360-card-note">${__('Click to see everyone at a stage')}</span></div>
								<div class="pod-chips">${(c.milestones || []).map(m => {
									const key = Object.keys(this.cards_by_key || {}).find(k => this.cards_by_key[k].label === m);
									const col = POD_TONES[((this.cards_by_key || {})[key] || {}).tone] || POD_TONES.neutral;
									return key
										? `<button class="pod-pill pod-c360-chip" style="--c:${col}" data-card="${esc(key)}" data-label="${esc(m)}">${esc(__(m))}</button>`
										: `<span class="pod-pill" style="--c:${col}">${esc(__(m))}</span>`;
								}).join(' ') || `<span class="pod-muted">${__('No pipeline milestone yet')}</span>`}</div>
							</div>
							<div class="pod-c360-card">
								<div class="pod-c360-card-h">${__('Recent activity')}</div>
								${activity.length ? `<div class="pod-c360-acts">${activity.map(a => `
									<button class="pod-c360-act pod-c360-go" data-goto="${a.tab}">
										<span class="pod-c360-act-kind" style="--ac:${({ history: '#2c5282', interviews: '#7c5cc4', application: '#2a78d6', assessments: '#c2410c', onboarding: '#1a9e63', other: '#64748B' })[a.tab]}">${esc(a.kind)}</span>
										<span class="pod-c360-act-text">${esc(a.text)}${a.by ? `<span class="pod-muted"> · ${esc(a.by)}</span>` : ''}</span>
										<span class="pod-c360-act-at">${esc(this.fmt_dt(a.at))}</span>
									</button>`).join('')}</div>` : `<div class="pod-muted">${__('No activity yet')}</div>`}
							</div>
						</div>`;

					// ── Registration / Forms ──
					const registration = this.c360_sections(c.sections)
						|| `<div class="pod-c360-empty">${__('Nothing filled in')}</div>`;


					// ── Interviews & feedback ──
					const interviews = `
						<div class="pod-c360-h">${__('Interviews')} <span class="pod-c360-count">${ivs.length}</span></div>
						${ivs.length ? `<table class="pod-table pod-c360-list">
							<thead><tr><th>${__('Round')}</th><th>${__('Date')}</th><th>${__('Mode')}</th><th>${__('Interviewer')}</th><th>${__('Status')}</th><th></th></tr></thead>
							<tbody>${ivs.map(i => `<tr class="${i.cancelled ? 'is-cancelled' : ''}">
								<td><b>${esc(i.round || __('Interview'))}</b></td>
								<td>${esc(this.fmt_date(i.date))}${i.start ? ' ' + esc(i.start) : ''}</td>
								<td>${esc(i.mode || '—')}</td>
								<td>${esc(i.interviewer || '—')}</td>
								<td>${i.cancelled ? `<span class="pod-pill" style="--c:#64748B">${__('Cancelled')}</span>` : `<span class="pod-pill" style="--c:#2a78d6">${__('Scheduled')}</span>`}</td>
								<td class="pod-c360-right"><a target="_blank" rel="noopener" href="/app/${esc(i.route)}/${encodeURIComponent(i.name)}">${esc(i.name)} ↗</a></td>
							</tr>`).join('')}</tbody></table>` : `<div class="pod-c360-empty">${__('No interviews scheduled')}</div>`}
						<div class="pod-c360-h">${__('Feedback')} <span class="pod-c360-count">${fbs.length}</span></div>
						${fbs.map(f => this.feedback_body_html(f)).join('') || `<div class="pod-c360-empty">${__('No feedback yet')}</div>`}`;

					// ── Documents ── (upload labels are often long instructions —
					// the file name leads, the label is shortened underneath)
					const documents = docs.length ? `<div class="pod-c360-docgrid">${docs.map(x => {
						const url = String(x.url || '');
						const safe = /^(\/|https?:\/\/)/i.test(url);
						const file = this.c360_file_name(url) || __('File');
						const ext = (file.includes('.') ? file.split('.').pop() : '').toUpperCase().slice(0, 4);
						const label = x.label.length > 60 ? x.label.slice(0, 57) + '…' : x.label;
						const body = `<span class="pod-c360-ext">${esc(ext || 'FILE')}</span>
							<span class="pod-c360-docmeta"><b title="${esc(file)}">${esc(file)}</b>
							<span class="pod-muted" title="${esc(x.label)}">${esc(label)}</span>
							<span class="pod-c360-docsrc">${esc(x.source)}</span></span>`;
						return safe
							? `<a class="pod-c360-doc" target="_blank" rel="noopener" href="${esc(url)}">${body}<span class="pod-c360-open">${__('Open')} ↗</span></a>`
							: `<div class="pod-c360-doc">${body}</div>`;
					}).join('')}</div>` : `<div class="pod-c360-empty">${__('No documents attached')}</div>`;

					// ── History ──
					const history = hist.length ? `<div class="pod-c360-tl">${hist.slice().reverse().map(h => `
						<div class="pod-c360-tl-row">
							<span class="pod-c360-tl-dot"></span>
							<div class="pod-c360-tl-body">
								<div><span class="pod-muted">${esc(h.from || __('(none)'))}</span> → <b>${esc(h.to)}</b></div>
								<div class="pod-muted">${esc(this.fmt_dt(h.on))}${h.by ? ' · ' + esc(h.by) : ''}</div>
								${h.reason ? `<div class="pod-c360-tl-reason">${esc(h.reason)}</div>` : ''}
							</div>
						</div>`).join('')}</div>` : `<div class="pod-c360-empty">${__('No status changes logged yet')}</div>`;

					const panes = {
						overview, registration, interviews, documents, history,
						application: this.c360_related(apps, __('No application form submitted yet')),
						assessments: this.c360_related(tests, __('No tests or assessments yet')),
						onboarding: this.c360_related(onb, __('No onboarding forms yet')),
						other: this.c360_related(other, __('Nothing else on file')),
					};
					const facts = c.facts || [];
					const contact = facts.filter(f => ['Email', 'Phone'].includes(f.label));
					const details = facts.filter(f => !['Email', 'Phone'].includes(f.label));

					d.$body.html(`
						<style>${POD_CSS}</style>
						<div class="pod-root pod-detail pod-c360">
							<div class="pod-c360-layout">
								<aside class="pod-c360-side" style="--pc:${POD_PROGRAM_COLORS[c.program] || '#64748B'}">
									<div class="pod-c360-who">
										<div class="pod-c360-avatar">${esc(this.c360_initials(c.name))}</div>
										<div class="pod-c360-name">${esc(c.name)}</div>
										<button class="pod-c360-code" title="${esc(__('Copy Applicant ID'))}">${esc(c.id)} <span class="pod-c360-copy">⧉</span></button>
										<div class="pod-c360-pills">${this.program_pill(c.program)} ${this.stage_pill(c.stage)}</div>
									</div>
									${c.status ? `<button class="pod-c360-statusbox pod-c360-go" data-goto="history" title="${esc(__('See status history'))}"
										style="--sc:${POD_STAGE_COLORS[c.stage] || '#64748B'}">
										<span class="pod-c360-side-l">${__('Current status')}</span>
										<span class="pod-c360-statusv">${esc(c.status)}</span></button>` : ''}
									${contact.length ? `<div class="pod-c360-side-h">${__('Contact')}</div>${contact.map(f => this.c360_fact(f)).join('')}` : ''}
									<div class="pod-c360-side-h">${__('Details')}</div>
									${details.map(f => this.c360_fact(f)).join('')}
									<div class="pod-c360-actions">
										${doctype && frappe.model.can_write(doctype) ? `<button class="btn btn-sm btn-block pod-c360-edit">✎ ${__('Edit record')}</button>` : ''}
										<a class="btn btn-default btn-sm btn-block" target="_blank" rel="noopener"
											href="/app/${esc(c.route)}/${encodeURIComponent(c.id)}">${__('Open in new tab')} ↗</a>
										<button class="btn btn-default btn-sm btn-block pod-to-tl">${__('View timeline')}</button>
									</div>
									${c.modified ? `<div class="pod-c360-updated">${__('Record last updated')}<br>${esc(this.fmt_dt(c.modified))}</div>` : ''}
								</aside>
								<main class="pod-c360-main">
									<div class="pod-c360-tabs" role="tablist">${tabs.map(([k, l, n], i) => `
										<button class="pod-c360-tab ${i ? '' : 'is-on'}" data-t="${k}" role="tab">${esc(l)}${n === null ? '' : ` <span class="pod-c360-count">${n}</span>`}</button>`).join('')}
									</div>
									${tabs.map(([k], i) => `<div class="pod-c360-pane" data-p="${k}" ${i ? 'hidden' : ''}>${panes[k]}</div>`).join('')}
								</main>
							</div>
						</div>`);
					const show = (t) => {
						d.$body.find('.pod-c360-tab').each((_, b) => $(b).toggleClass('is-on', $(b).data('t') === t));
						d.$body.find('.pod-c360-pane').each((_, p) => { p.hidden = $(p).data('p') !== t; });
					};
					d.$body.find('.pod-c360-tab').on('click', (e) => show($(e.currentTarget).data('t')));
					d.$body.on('click', '.pod-c360-go', (e) => {
						e.preventDefault();
						show($(e.currentTarget).data('goto'));
						d.$body.find('.pod-c360-tabs')[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
					});
					// A pipeline stage → the dashboard's own list of everyone at it
					// (same filters as the board), for this programme.
					d.$body.find('.pod-c360-chip').on('click', (e) => {
						const $b = $(e.currentTarget);
						d.hide();
						this.drill('card', `${$b.data('label')} · ${c.unit || c.program}`, { card: $b.data('card'), programs: [c.program] });
					});
					d.$body.find('.pod-c360-code').on('click', () => {
						frappe.utils.copy_to_clipboard(c.id);
					});
					d.$body.find('.pod-to-tl').on('click', () => {
						d.hide();
						this.open_timeline(c.program, c.id);
					});
					// Edit → the registration form itself, in this tab (editable,
					// even if it was last opened with the list's read-only View).
					d.$body.find('.pod-c360-edit').on('click', () => {
						d.hide();
						frappe.frf_view_only = null;
						frappe.set_route('Form', doctype, c.id);
					});
					d.show();
				}
			});
		}

		// Linked records (application form, tests, onboarding…), newest first:
		// each opens to its headline numbers (scores) and full content. The
		// newest one is open by default.
		c360_related(list, empty) {
			const esc = (v) => this.esc(v);
			if (!list.length) return `<div class="pod-c360-empty">${esc(empty)}</div>`;
			return list.map((f, i) => `
				<details class="pod-c360-acc" ${i === 0 ? 'open' : ''}>
					<summary>
						<span class="pod-c360-acc-t"><b>${esc(f.doctype)}</b>
							<span class="pod-muted">${esc(f.name)}${f.date ? ' · ' + esc(this.fmt_dt(f.date)) : ''}</span>
							${(f.summary || []).slice(0, 2).map(s => `<span class="pod-c360-acc-chip">${esc(s.label)}: <b>${esc(s.value)}</b></span>`).join('')}</span>
						<a target="_blank" rel="noopener" href="/app/${esc(f.route)}/${encodeURIComponent(f.name)}">${__('Open in Frappe')} ↗</a>
					</summary>
					<div class="pod-c360-acc-b">
						${(f.summary || []).length ? `<div class="pod-c360-metrics">${f.summary.map(s => `
							<div class="pod-c360-metric"><span class="pod-c360-metric-l">${esc(s.label)}</span>
							<span class="pod-c360-metric-v">${esc(s.value)}</span></div>`).join('')}</div>` : ''}
						${this.c360_sections(f.sections) || `<div class="pod-c360-empty">${__('Nothing filled in')}</div>`}
					</div>
				</details>`).join('');
		}

		// Older servers (e.g. a site not yet on the latest get_candidate_detail)
		// send only `profile` — [{label, value}] of the filled-in fields. Build
		// the sidebar facts and the Registration tab from it so neither is empty.
		c360_fill_from_profile(c) {
			const prof = c.profile || [];
			if (!prof.length) return;
			const pv = (re) => (prof.find(p => re.test(p.label)) || {}).value;
			if (!c.facts) {
				c.facts = [['Email', /^email/i], ['Phone', /^phone/i], ['Role', /^role$/i], ['Location', /^location$/i],
					['Job code', /^job code$/i], ['Source', /^(source|opportunity)$/i], ['Applied on', /^application date$/i]]
					.map(([label, re]) => ({ label, value: pv(re) })).filter(f => f.value)
					.map(f => (f.label === 'Applied on' && /^\d{4}-\d{2}-\d{2}/.test(f.value)
						? { label: f.label, value: frappe.datetime.str_to_user(f.value.slice(0, 10)) } : f));
			}
			if (!c.sections) c.sections = [{ title: '', fields: prof.map(p => ({ label: p.label, value: p.value })), tables: [] }];
		}

		// Overview "Key details": the registration's own answers at a glance
		// (role, unit, test subject, gender, home state…) — everything except
		// contact details, name and status, which the sidebar already shows.
		c360_key_details(c) {
			const esc = (v) => this.esc(v);
			const skip = /status|e-?mail|phone|contact|full name|^name|mail$|resume|attach|upload/i;
			const seen = new Set();
			const rows = (c.profile || []).filter(p => {
				const v = String(p.value || '').trim();
				if (!v || v === 'None' || skip.test(p.label) || seen.has(p.label) || v.length > 80) return false;
				seen.add(p.label);
				return true;
			}).slice(0, 12);
			if (!rows.length) return '';
			return `<div class="pod-c360-card">
				<div class="pod-c360-card-h">${__('Key details')}<a href="#" class="pod-c360-card-note pod-c360-go" data-goto="registration">${__('See full registration')} →</a></div>
				<div class="pod-c360-keys">${rows.map(p => `
					<div class="pod-c360-keyv"><span class="pod-c360-k">${esc(p.label.replace(/\?$/, ''))}</span>
					<span class="pod-c360-v">${this.c360_value(/^\d{4}-\d{2}-\d{2}( |$)/.test(p.value) ? frappe.datetime.str_to_user(p.value.slice(0, 10)) : p.value)}</span></div>`).join('')}
				</div>
			</div>`;
		}

		// Coloured when there is something to see; a zero stays grey.
		c360_stat(tab, color, label, n, sub) {
			return `<button class="pod-c360-stat pod-c360-go ${n ? '' : 'is-zero'}" data-goto="${tab}" style="--tc:${color}">
				<span class="pod-c360-stat-l">${this.esc(label)}</span>
				<span class="pod-c360-stat-n">${this.esc(n)}</span>
				<span class="pod-c360-stat-s">${this.esc(sub)}</span></button>`;
		}

		c360_initials(name) {
			return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
		}

		c360_file_name(url) {
			try { return decodeURIComponent(String(url || '').split('?')[0].split('/').pop()); }
			catch (e) { return String(url || '').split('/').pop(); }
		}

		// Sidebar fact row: email → mail, phone → call, the rest plain.
		c360_fact(f) {
			const esc = (v) => this.esc(v);
			const v = String(f.value || '');
			let val = esc(v);
			if (f.label === 'Email' && /^\S+@\S+\.\S+$/.test(v)) val = `<a href="mailto:${esc(v)}">${esc(v)}</a>`;
			else if (f.label === 'Phone' && /^\+?[\d\s()-]{6,}$/.test(v)) val = `<a href="tel:${esc(v.replace(/[^\d+]/g, ''))}">${esc(v)}</a>`;
			return `<div class="pod-c360-fact"><span class="pod-c360-side-l">${esc(__(f.label))}</span><span class="pod-c360-fact-v">${val}</span></div>`;
		}

		// A record value as HTML: emails, phone numbers, web links and file paths
		// become clickable; everything else is escaped text.
		c360_value(v) {
			const esc = (x) => this.esc(x);
			const s = String(v || '').trim();
			if (/^\S+@\S+\.\S+$/.test(s)) return `<a href="mailto:${esc(s)}">${esc(s)}</a>`;
			if (/^https?:\/\/\S+$/i.test(s)) return `<a target="_blank" rel="noopener" href="${esc(s)}">${esc(s.length > 60 ? s.slice(0, 57) + '…' : s)} ↗</a>`;
			if (/^\/(private\/)?files\/\S+$/.test(s)) return `<a target="_blank" rel="noopener" href="${esc(s)}">${esc(this.c360_file_name(s))} ↗</a>`;
			if (/^\+?\d[\d\s-]{8,14}\d$/.test(s)) return `<a href="tel:${esc(s.replace(/[^\d+]/g, ''))}">${esc(s)}</a>`;
			return esc(s).replace(/\n/g, '<br>');
		}

		// Record sections from the server: [{title, fields:[{label, value, long}], tables:[{label, columns, rows}]}]
		// shown as label / value rows, two columns wide, long answers full width.
		c360_sections(sections) {
			const esc = (v) => this.esc(v);
			return (sections || []).map((s, i) => `
				<div class="pod-c360-card">
					<div class="pod-c360-card-h">${esc(s.title || (i ? __('More details') : __('Basic information')))}</div>
					${(s.fields || []).length ? `<div class="pod-c360-kvs">${s.fields.map(x => `
						<div class="pod-c360-kv ${x.long ? 'is-long' : ''}"><span class="pod-c360-k">${esc(x.label)}</span>
						<span class="pod-c360-v">${this.c360_value(x.value)}</span></div>`).join('')}</div>` : ''}
					${(s.tables || []).map(tb => `
						<div class="pod-c360-sub-h">${esc(tb.label)}</div>
						<div class="pod-c360-tbl"><table class="pod-table pod-c360-list"><thead><tr>${tb.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
						<tbody>${tb.rows.map(r => `<tr>${r.map(v => `<td>${this.c360_value(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`).join('')}
				</div>`).join('');
		}
	}

	const POD_CSS = `
.pod-root { --page:#E9EFF6; --bg:#FFFFFF; --bg-soft:#F8FAFC; --border:#DDE3EA; --border-soft:#EDF1F5; --text:#1A2B3C;
	--text-2:#3E4C59; --muted:#6B7A8A; --head:#1F3A5A; --head-2:#2C5282; --link:#1F5FA6; --hover:#F5F8FB; --grid:#E4E9EF;
	--brand:#1F4E79; --brand-2:#1F4E79; --shadow:0 1px 2px rgba(16,24,40,.04);
	color:var(--text); }
:root[data-theme="dark"] .pod-root { --page:#141619; --bg:#1C1F24; --bg-soft:#22262C; --border:#343A42; --border-soft:#2A2F36;
	--text:#E8ECF1; --text-2:#C3CBD5; --muted:#8C98A6; --head:#25364D; --head-2:#2F4A6B; --link:#8DB8E8; --hover:#23272E; --grid:#343A42;
	--brand:#5B8FC7; --brand-2:#5B8FC7; --shadow:none; }
.modal-body .pod-root { background:transparent; }
.modal-body .pod-root { padding: 0; }
.pod-detail-btns { display:flex; gap:6px; }
.modal-dialog.pod-modal-wide { max-width:min(1500px, 94vw); width:94vw; }
.pod-chips { display:flex; flex-wrap:wrap; gap:6px; }
.pod-table { width:100%; border-collapse:collapse; font-size:12.5px; color:var(--text); }
.pod-table th { position:sticky; top:0; z-index:2; background:var(--head); color:#fff; text-align:left; font-weight:600;
	padding:8px 10px; white-space:nowrap; cursor:pointer; user-select:none; font-size:11.5px; }
.pod-table td { padding:7px 10px; border-bottom:1px solid var(--border-soft); vertical-align:top; }
.pod-table tbody tr:hover td { background:var(--hover); }
.pod-pill { display:inline-block; border:1px solid color-mix(in srgb, var(--c) 45%, transparent); color:color-mix(in srgb, var(--c) 80%, #000);
	background:color-mix(in srgb, var(--c) 10%, transparent); border-radius:20px; padding:1px 8px; font-size:10.5px; font-weight:700; white-space:nowrap; }
.pod-muted { color:var(--muted); font-size:11px; }
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
.pod-fb-card { border:1px solid var(--border); border-radius:10px; background:var(--bg); padding:8px 14px; margin-bottom:8px; }
.pod-fb-card[open] { padding-bottom:12px; }
.pod-fb-head { display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center; font-size:12.5px; cursor:pointer; }
.pod-fb-card[open] .pod-fb-head { border-bottom:1px solid var(--border-soft); padding-bottom:7px; margin-bottom:6px; }
.pod-fb-sec-title { font-size:11px; font-weight:700; color:var(--link); text-transform:uppercase; letter-spacing:.05em; margin:8px 0 4px; }
.pod-fb-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:6px 16px; }
.pod-fb-grid > .is-long { grid-column:1 / -1; }
.pod-fb-val { font-size:12.5px; color:var(--text); font-weight:500; overflow-wrap:anywhere; }
.pod-fb-child th { position:static; cursor:default; }
.pod-table:not(.pod-fb-child) td { white-space:nowrap; max-width:260px; overflow:hidden; text-overflow:ellipsis; }
.pod-table:not(.pod-fb-child) tbody tr { height:38px; }
/* applicant profile (open_candidate) — two-column profile, flat bordered surfaces, colour only where it means something */
.pod-c360 button { font:inherit; }
.pod-c360 a { color:var(--link); }
.pod-c360 a:hover { text-decoration:underline; }
.pod-c360-layout { display:grid; grid-template-columns:290px minmax(0,1fr); gap:20px; align-items:start; }
/* sidebar */
.pod-c360-side { position:sticky; top:0; border:1px solid var(--border); border-radius:12px; background:var(--bg);
	padding:18px 16px 14px; border-top:4px solid var(--pc); }
.pod-c360-who { display:flex; flex-direction:column; align-items:center; text-align:center; gap:6px;
	padding-bottom:14px; border-bottom:1px solid var(--border-soft); }
.pod-c360-avatar { width:64px; height:64px; border-radius:50%; display:flex; align-items:center; justify-content:center;
	font-size:22px; font-weight:700; color:var(--pc); background:color-mix(in srgb, var(--pc) 10%, var(--bg));
	border:1px solid color-mix(in srgb, var(--pc) 30%, transparent); margin-bottom:2px; }
.pod-c360-name { font-size:17px; font-weight:700; color:var(--text); line-height:1.25; }
.pod-c360-code { font-weight:600; font-size:12px; color:var(--text-2); font-variant-numeric:tabular-nums; background:var(--bg-soft);
	border:1px solid var(--border); border-radius:6px; padding:2px 9px; cursor:pointer; }
.pod-c360-code:hover { border-color:var(--link); color:var(--link); }
.pod-c360-copy { font-size:11px; color:var(--muted); margin-left:2px; }
.pod-c360-pills { display:flex; gap:6px; flex-wrap:wrap; justify-content:center; }
.pod-c360-statusbox { width:100%; margin-top:14px; text-align:left; display:flex; flex-direction:column; gap:2px; cursor:pointer;
	border:1px solid var(--border); border-radius:8px; background:var(--bg-soft); padding:9px 12px; }
.pod-c360-statusbox:hover { border-color:var(--link); }
.pod-c360-statusv { font-size:14px; font-weight:700; color:var(--head); }
.pod-c360-side-h { font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.08em;
	margin:16px 0 6px; }
.pod-c360-side-l { font-size:11px; color:var(--muted); }
.pod-c360-fact { display:flex; flex-direction:column; gap:1px; padding:5px 0; border-bottom:1px dashed var(--border-soft); }
.pod-c360-fact:last-of-type { border-bottom:0; }
.pod-c360-fact-v { font-size:13px; font-weight:600; color:var(--text); overflow-wrap:anywhere; }
.pod-c360-actions { display:flex; flex-direction:column; gap:6px; margin-top:16px; }
.pod-c360-actions .btn { margin:0; }
.pod-c360-actions .pod-c360-edit { background:#1F3A5A; border:1px solid #1F3A5A; color:#fff; font-weight:600; }
.pod-c360-actions .pod-c360-edit:hover { background:#2C5282; border-color:#2C5282; color:#fff; }
/* overview key details: label over value, 3 across */
.pod-c360-keys { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:12px 20px; }
.pod-c360-keyv { display:flex; flex-direction:column; gap:3px; min-width:0; padding:8px 10px; border-radius:8px;
	background:var(--bg-soft); border:1px solid var(--border-soft); }
.pod-c360-keyv .pod-c360-k { font-size:11px; }
.pod-c360-keyv .pod-c360-v { font-size:13px; }
a.pod-c360-card-note { color:var(--link); text-decoration:none; }
.pod-c360-updated { margin-top:12px; font-size:11px; color:var(--muted); text-align:center; line-height:1.5; }
/* main */
.pod-c360-main { min-width:0; }
.pod-c360-tabs { display:flex; gap:4px; border-bottom:1px solid var(--border); overflow-x:auto; overflow-y:hidden; scrollbar-width:none; }
.pod-c360-tabs::-webkit-scrollbar { display:none; }
.pod-c360-tab { border:0; background:none; padding:10px 12px; font-size:13px; font-weight:600; color:var(--muted);
	border-bottom:2px solid transparent; white-space:nowrap; cursor:pointer; }
.pod-c360-tab:hover { color:var(--text); }
.pod-c360-tab.is-on { color:var(--head-2); border-bottom-color:var(--head-2); }
.pod-c360-count { display:inline-block; min-width:20px; padding:0 6px; margin-left:4px; border-radius:10px; font-size:11px;
	font-weight:700; line-height:18px; text-align:center; background:var(--bg-soft); border:1px solid var(--border); color:var(--text-2); }
.pod-c360-tab.is-on .pod-c360-count { background:color-mix(in srgb, var(--head-2) 10%, var(--bg)); border-color:color-mix(in srgb, var(--head-2) 30%, transparent); color:var(--head-2); }
.pod-c360-pane { padding-top:14px; min-height:360px; }
.pod-c360-card { border:1px solid var(--border); border-radius:10px; background:var(--bg); padding:14px 16px; margin-bottom:12px; }
.pod-c360-card-h { display:flex; align-items:baseline; justify-content:space-between; gap:8px; flex-wrap:wrap;
	font-size:13px; font-weight:700; color:var(--text); margin-bottom:10px; }
.pod-c360-card-note { font-size:11.5px; font-weight:500; color:var(--muted); }
.pod-c360-split { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:12px; }
.pod-c360-split > .pod-c360-card { margin-bottom:12px; }
.pod-c360-empty { padding:28px 12px; text-align:center; color:var(--muted); font-size:12.5px;
	border:1px dashed var(--border); border-radius:10px; background:var(--bg-soft); }
.pod-c360-h { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:var(--text); margin:4px 0 8px; }
.pod-c360-h ~ .pod-c360-h { margin-top:18px; }
/* overview stats */
.pod-c360-stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); border:1px solid var(--border); border-radius:10px;
	background:var(--bg); margin-bottom:12px; overflow:hidden; }
.pod-c360-stat { text-align:left; border:0; border-right:1px solid var(--border-soft); background:none; padding:12px 14px;
	display:flex; flex-direction:column; gap:2px; cursor:pointer; min-width:0; }
.pod-c360-stat:last-child { border-right:0; }
.pod-c360-stat:hover { background:var(--hover); }
.pod-c360-stat-l { font-size:11.5px; font-weight:600; color:var(--muted); }
.pod-c360-stat-n { font-size:24px; font-weight:700; color:var(--text); font-variant-numeric:tabular-nums; line-height:1.15; }
.pod-c360-stat-s { font-size:11.5px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pod-c360-journey .pod-c360-go { cursor:pointer; }
.pod-c360-journey .pod-c360-go:hover .pod-step-label { color:var(--link); }
.pod-c360-chip { cursor:pointer; }
.pod-c360-chip:hover { text-decoration:underline; }
.pod-c360-acts { display:flex; flex-direction:column; }
.pod-c360-act { display:grid; grid-template-columns:76px minmax(0,1fr) auto; gap:10px; align-items:center; text-align:left;
	border:0; border-bottom:1px solid var(--border-soft); background:none; padding:7px 4px; cursor:pointer; font-size:12.5px; }
.pod-c360-act:last-child { border-bottom:0; }
.pod-c360-act:hover { background:var(--hover); }
.pod-c360-act-kind { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--ac, var(--head-2));
	background:color-mix(in srgb, var(--ac, var(--head-2)) 10%, var(--bg)); border-radius:4px; padding:2px 6px; justify-self:start; }
/* soft page background behind the white cards (same family as the dashboard page colour) */
.pod-c360-dialog .modal-body { background:#EEF2F7; border-radius:0 0 var(--border-radius-lg, 12px) var(--border-radius-lg, 12px); }
:root[data-theme="dark"] .pod-c360-dialog .modal-body { background:#16191D; }
.pod-c360-dialog .modal-header { border-bottom:1px solid #DDE3EA; }
:root[data-theme="dark"] .pod-c360-dialog .modal-header { border-bottom-color:#343A42; }
.pod-c360-tabs { background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:0 8px; }
.pod-c360-tab { margin-bottom:-1px; }
.pod-c360-pane { padding-top:12px; }
.pod-c360-stats, .pod-c360-card, .pod-c360-acc, .pod-c360-doc, .pod-c360-side { box-shadow:0 1px 2px rgba(16,24,40,.04); }
.pod-c360-empty { background:var(--bg); }
/* colour that carries meaning: programme band, stage-tinted status, per-metric stats (grey when zero), section accents */
.pod-c360-side { padding-top:0; overflow:hidden; }
.pod-c360-who { margin:0 -16px; padding:18px 16px 14px;
	background:linear-gradient(color-mix(in srgb, var(--pc) 9%, var(--bg)), color-mix(in srgb, var(--pc) 9%, var(--bg))) top / 100% 58px no-repeat; }
.pod-c360-avatar { background:var(--bg); border:2px solid color-mix(in srgb, var(--pc) 45%, transparent); }
.pod-c360-statusbox { border-color:color-mix(in srgb, var(--sc) 35%, var(--border)); border-left:4px solid var(--sc);
	background:color-mix(in srgb, var(--sc) 7%, var(--bg)); }
.pod-c360-statusbox:hover { border-color:var(--sc); }
.pod-c360-statusv { color:color-mix(in srgb, var(--sc) 75%, var(--text)); }
.pod-c360-stat { box-shadow:inset 0 3px 0 var(--tc); }
.pod-c360-stat .pod-c360-stat-n { color:var(--tc); }
.pod-c360-stat:not(.is-zero):hover { background:color-mix(in srgb, var(--tc) 6%, var(--bg)); }
.pod-c360-stat.is-zero { box-shadow:inset 0 3px 0 var(--border); }
.pod-c360-stat.is-zero .pod-c360-stat-n { color:var(--muted); opacity:.7; }
.pod-c360-card-h::before { content:""; width:3px; height:14px; border-radius:2px; background:var(--head-2); margin-right:2px; align-self:center; }
.pod-c360-card-h { justify-content:flex-start; }
.pod-c360-card-note { margin-left:auto; }
.pod-c360-tab.is-on { color:var(--head-2); border-bottom-width:3px; }
.pod-c360-act-text { color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pod-c360-act-at { font-size:11.5px; color:var(--muted); white-space:nowrap; font-variant-numeric:tabular-nums; }
/* label / value rows */
.pod-c360-kvs { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); column-gap:28px; }
.pod-c360-kv { display:grid; grid-template-columns:minmax(110px,40%) minmax(0,1fr); gap:12px; padding:7px 0;
	border-bottom:1px solid var(--border-soft); font-size:12.5px; }
.pod-c360-kv.is-long { grid-column:1 / -1; grid-template-columns:minmax(110px,20%) minmax(0,1fr); }
.pod-c360-k { color:var(--muted); }
.pod-c360-v { color:var(--text); font-weight:600; overflow-wrap:anywhere; }
.pod-c360-sub-h { font-size:12px; font-weight:700; color:var(--text-2); margin:12px 0 6px; }
.pod-c360-tbl { overflow-x:auto; }
.pod-c360-list th, .pod-c360-list td { position:static; }
.pod-c360-list tr.is-cancelled td { color:var(--muted); }
.pod-c360-right { text-align:right; white-space:nowrap; }
/* forms accordion */
.pod-c360-acc { border:1px solid var(--border); border-radius:10px; background:var(--bg); margin-bottom:10px; }
.pod-c360-acc > summary { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:11px 14px;
	cursor:pointer; list-style:none; font-size:13px; }
.pod-c360-acc > summary::-webkit-details-marker { display:none; }
.pod-c360-acc > summary::before { content:"▸"; color:var(--muted); margin-right:2px; transition:transform .15s; }
.pod-c360-acc[open] > summary::before { transform:rotate(90deg); }
.pod-c360-acc[open] > summary { border-bottom:1px solid var(--border-soft); }
.pod-c360-acc-t { flex:1; display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }
.pod-c360-acc-b { padding:12px 14px 2px; background:var(--bg-soft); border-radius:0 0 10px 10px; }
.pod-c360-acc-chip { font-size:11.5px; color:var(--text-2); background:var(--bg-soft); border:1px solid var(--border);
	border-radius:6px; padding:1px 7px; }
.pod-c360-metrics { display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:8px; margin-bottom:12px; }
.pod-c360-metric { display:flex; flex-direction:column; gap:2px; background:var(--bg); border:1px solid var(--border);
	border-top:3px solid #c2410c; border-radius:8px; padding:9px 12px; }
.pod-c360-metric-l { font-size:11px; color:var(--muted); font-weight:600; }
.pod-c360-metric-v { font-size:18px; font-weight:700; color:var(--text); font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
/* documents */
.pod-c360-docgrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:10px; }
.pod-c360-doc { display:flex; align-items:center; gap:12px; border:1px solid var(--border); border-radius:10px; padding:12px 14px;
	background:var(--bg); color:var(--text) !important; text-decoration:none !important; }
a.pod-c360-doc:hover { background:var(--hover); border-color:var(--link); }
.pod-c360-ext { flex-shrink:0; width:42px; height:46px; border-radius:6px; display:flex; align-items:center; justify-content:center;
	font-size:10.5px; font-weight:700; color:var(--head-2); background:var(--bg-soft); border:1px solid var(--border); }
.pod-c360-docmeta { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; font-size:12px; }
.pod-c360-docmeta b, .pod-c360-docmeta .pod-muted { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pod-c360-docsrc { font-size:11px; color:var(--muted); }
.pod-c360-open { flex-shrink:0; font-size:12px; font-weight:600; color:var(--link); }
/* history */
.pod-c360-tl { position:relative; padding-left:4px; }
.pod-c360-tl-row { position:relative; display:flex; gap:12px; padding:0 0 14px 0; }
.pod-c360-tl-row:not(:last-child)::before { content:""; position:absolute; left:5px; top:14px; bottom:0; width:2px; background:var(--border); }
.pod-c360-tl-dot { flex-shrink:0; width:12px; height:12px; margin-top:4px; border-radius:50%; background:var(--bg);
	border:2px solid var(--head-2); position:relative; z-index:1; }
.pod-c360-tl-row:first-child .pod-c360-tl-dot { background:var(--head-2); }
.pod-c360-tl-body { font-size:12.5px; display:flex; flex-direction:column; gap:2px; }
.pod-c360-tl-reason { margin-top:4px; padding:6px 10px; border-left:3px solid var(--border); background:var(--bg-soft);
	border-radius:0 6px 6px 0; color:var(--text-2); }
@media (max-width:900px) {
	.pod-c360-layout { grid-template-columns:1fr; }
	.pod-c360-side { position:static; }
	.pod-c360-stats { grid-template-columns:repeat(2,minmax(0,1fr)); }
	.pod-c360-stat:nth-child(2) { border-right:0; }
	.pod-c360-kvs { grid-template-columns:1fr; }
}
`;

	window.pathways_applicant_profile = {
		programs: AP_PROGRAMS,
		open(program, id, host) { new ApplicantProfile(host).open_candidate(program, id); },
		open_for(doctype, name) {
			const program = AP_PROGRAMS[doctype];
			if (program && name) this.open(program, name);
		},
	};

	// Registration lists: clicking an applicant's name opens the profile
	// (Ctrl/Cmd/Shift-click or middle-click still opens the form in a tab).
	// Capture phase: Frappe's router handles link clicks on <body>, which
	// would otherwise navigate to the form before a bubbling handler runs.
	document.addEventListener('click', function (e) {
		const a = e.target && e.target.closest && e.target.closest('.frappe-list .list-row a[data-doctype][data-name]');
		if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
		const doctype = a.getAttribute('data-doctype');
		if (!AP_PROGRAMS[doctype]) return;
		e.preventDefault();
		e.stopPropagation();
		window.pathways_applicant_profile.open_for(doctype, a.getAttribute('data-name'));
	}, true);

	// ── Registration form summary header ──────────────────────────────────
	// A card at the top of a saved registration record: avatar + name, ID
	// (click to copy), Application Status pill in its stage colour (click →
	// the status field), role / job code / sub unit / location, clickable
	// email and phone, and when they applied. Reads only the form's own
	// values (no server call) — works the same on Frappe 15 and 16.
	var PW_HEAD_MAP = {
		'Field Registration Form': { program: 'Field', title: 'full_name_aadhaar', email: 'email_address', phone: 'phone_number',
			role: 'role', job_code: 'job_code', subunit: 'department', location: 'location', status: 'application_status', applied: 'application_date' },
		'Health Registration Form': { program: 'Health', title: 'full_name', email: 'email_address', phone: 'phone_number',
			role: 'role', job_code: 'job_code', subunit: 'department', location: 'location', status: 'application_status' },
		'Phil Registration Form': { program: 'Philanthropy', title: 'name1', email: 'email', phone: 'phone',
			role: 'role', job_code: 'job_code', location: 'location', status: 'application_status' },
		'Scholarship Recruitment Form': { program: 'Scholarship', title: 'full_name_as_per_aadhar', email: 'email', phone: 'phone_number',
			role: 'role', subunit: 'department', location: 'location', status: 'application_status' },
	};
	var PW_HEAD_PROGRAM_COLORS = { 'Field': '#2a78d6', 'Health': '#eb6834', 'Philanthropy': '#1baf7a', 'Scholarship': '#eda100' };
	var PW_HEAD_STAGE_COLORS = { 'New': '#8A96A3', 'In process': '#2C5F8A', 'On hold': '#B7791F', 'Offer / Selected': '#2F7D4F', 'Not selected': '#B83232' };
	var PW_HEAD_OFFER = ['offer', 'offered', 'offer accepted', 'joined', 'pre joining', 'document collection', 'document verification pass',
		'it team', 'compensation due', 'compensation approved', 'offer sent', 'offer not sent', 'addendum accepted', 'pre-join form submitted',
		'it email sent', 'it email not sent', 'erp id created', 'erp id not created'];
	var PW_HEAD_CLOSED = ['not selected', 'offer declined', 'document verification fail', 'blocklisted', 'blocklist', 'duplicated',
		'addendum declined', 'not joined'];

	// Same stage rules as the Pathways dashboard (_stage in pathways_overall_dashboard.py).
	function pw_head_stage(status) {
		const s = String(status || '').trim().toLowerCase();
		if (!s || s === 'new applicant') return 'New';
		if (PW_HEAD_CLOSED.includes(s) || /reject|regret|no show|no-show/.test(s)) return 'Not selected';
		if (PW_HEAD_OFFER.includes(s)) return 'Offer / Selected';
		if (s.includes('hold')) return 'On hold';
		return 'In process';
	}

	function pw_form_header(frm) {
		const m = PW_HEAD_MAP[frm.doctype];
		const $layout = $(frm.layout && frm.layout.wrapper);
		if (!m || !$layout.length) return;
		$layout.find('.pw-head').remove();
		pw_frf_skin(frm);
		if (frm.is_new()) return;
		if (!document.getElementById('pw-head-css')) {
			$('head').append(`<style id="pw-head-css">
.pw-head { display:flex; gap:16px; align-items:center; flex-wrap:wrap; margin:0 0 14px; padding:16px 18px;
	background:var(--card-bg, #fff); border:1px solid var(--border-color, #DDE3EA); border-left:5px solid var(--pc);
	border-radius:12px; box-shadow:0 1px 2px rgba(16,24,40,.04); }
.pw-head-av { width:54px; height:54px; flex-shrink:0; border-radius:50%; display:flex; align-items:center; justify-content:center;
	font-size:19px; font-weight:700; color:var(--pc); background:color-mix(in srgb, var(--pc) 10%, var(--card-bg, #fff));
	border:2px solid color-mix(in srgb, var(--pc) 40%, transparent); }
.pw-head-main { flex:1; min-width:240px; display:flex; flex-direction:column; gap:6px; }
.pw-head-top { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.pw-head-name { font-size:19px; font-weight:700; color:var(--heading-color, #1A2B3C); line-height:1.2; }
.pw-head-id { font-size:12px; font-weight:600; color:var(--text-muted, #3E4C59); background:var(--subtle-fg, #F3F6FA);
	border:1px solid var(--border-color, #DDE3EA); border-radius:6px; padding:1px 8px; cursor:pointer; font-variant-numeric:tabular-nums; }
.pw-head-id:hover { border-color:#2C5282; color:#2C5282; }
.pw-head-status { display:inline-flex; align-items:center; gap:6px; padding:3px 11px; border-radius:999px; font-size:12px; font-weight:700;
	color:color-mix(in srgb, var(--sc) 85%, #000); background:color-mix(in srgb, var(--sc) 11%, var(--card-bg, #fff));
	border:1px solid color-mix(in srgb, var(--sc) 35%, transparent); cursor:pointer; }
.pw-head-status::before { content:""; width:7px; height:7px; border-radius:50%; background:var(--sc); }
.pw-head-stage { font-size:11.5px; color:var(--text-muted, #6B7A8A); }
.pw-head-meta { display:flex; flex-wrap:wrap; gap:6px; }
.pw-head-chip { font-size:12px; color:var(--text-color, #1A2B3C); background:var(--subtle-fg, #F3F6FA); border:1px solid var(--border-color, #E4E9EF);
	border-radius:6px; padding:2px 9px; }
.pw-head-chip b { font-weight:600; color:var(--text-muted, #6B7A8A); margin-right:3px; }
.pw-head-side { display:flex; flex-direction:column; gap:4px; align-items:flex-end; font-size:12.5px; }
.pw-head-side a { color:#1F5FA6; font-weight:600; }
.pw-head-side a:hover { text-decoration:underline; }
.pw-head-applied { font-size:11.5px; color:var(--text-muted, #6B7A8A); }
:root[data-theme="dark"] .pw-head-side a { color:#8DB8E8; }
:root[data-theme="dark"] .pw-head-status { color:color-mix(in srgb, var(--sc) 70%, #fff); }
@media (max-width:768px) { .pw-head-side { align-items:flex-start; } }
</style>`);
		}
		const d = frm.doc;
		const esc = (x) => frappe.utils.escape_html(x === null || x === undefined ? '' : String(x));
		const val = (k) => (m[k] ? d[m[k]] : null);
		const name = val('title') || d.name;
		const status = val('status') || 'New Applicant';
		const stage = pw_head_stage(status);
		const initials = String(name).trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
		const applied = val('applied') || d.creation;
		const pretty = applied && frappe.datetime.prettyDate ? frappe.datetime.prettyDate(applied) : '';
		const chips = [['Role', val('role')], ['Job code', val('job_code')], ['Sub unit', val('subunit')], ['Location', val('location')]]
			.filter(([, v]) => v).map(([l, v]) => `<span class="pw-head-chip"><b>${esc(__(l))}</b>${esc(v)}</span>`).join('');
		const email = val('email'), phone = val('phone');
		const $h = $(`<div class="pw-head" style="--pc:${PW_HEAD_PROGRAM_COLORS[m.program] || '#64748B'}; --sc:${PW_HEAD_STAGE_COLORS[stage]}">
			<div class="pw-head-av">${esc(initials)}</div>
			<div class="pw-head-main">
				<div class="pw-head-top">
					<span class="pw-head-name">${esc(name)}</span>
					<span class="pw-head-id" title="${esc(__('Copy ID'))}">${esc(d.name)} ⧉</span>
					<span class="pw-head-status" title="${esc(__('Go to Application Status'))}">${esc(status)}</span>
					<span class="pw-head-stage">${esc(__(stage))}</span>
				</div>
				${chips ? `<div class="pw-head-meta">${chips}</div>` : ''}
			</div>
			<div class="pw-head-side">
				${email ? `<a href="mailto:${esc(email)}">✉ ${esc(email)}</a>` : ''}
				${phone ? `<a href="tel:${esc(String(phone).replace(/[^\d+]/g, ''))}">☎ ${esc(phone)}</a>` : ''}
				${applied ? `<span class="pw-head-applied">${esc(__('Applied'))} ${esc(frappe.datetime.str_to_user(String(applied).slice(0, 10)))}${pretty ? ' · ' + esc(pretty) : ''}</span>` : ''}
			</div>
		</div>`);
		$h.find('.pw-head-id').on('click', () => frappe.utils.copy_to_clipboard(d.name));
		$h.find('.pw-head-status').on('click', () => m.status && frm.scroll_to_field(m.status));
		if (frm.doctype === 'Field Registration Form') pw_frf_extras(frm, $h);
		$layout.prepend($h);
	}

	// ── Field Registration Form extras ────────────────────────────────────
	// In the header: a "Jump to" row of the form's sections. The page itself:
	// soft background, each section its own card.

	function pw_frf_extras(frm, $h) {
		const esc = (x) => frappe.utils.escape_html(x === null || x === undefined ? '' : String(x));
		// Labelled sections that are on screen (depends_on / empty ones are skipped).
		const secs = (frm.layout.sections || []).filter(s => s.df && s.df.label && s.wrapper && !s.df.hidden
			&& !s.wrapper.hasClass('hide-control') && !s.wrapper.hasClass('empty-section'));
		if (secs.length > 1) {
			$h.append(`<div class="pw-jump"><span class="pw-jump-l">${esc(__('Jump to'))}</span>${secs.map((s, i) =>
				`<button type="button" class="pw-jump-chip" data-i="${i}">${esc(__(s.df.label))}</button>`).join('')}</div>`);
		}
		// Linked records as a compact row under "Jump to": the site's own
		// connections panel (#custom-connections-panel — counts, "+" new record,
		// Test Results / Feedback Forms dropdowns) is moved in here. That script
		// redraws the panel on every refresh, whichever of the two runs first,
		// so an observer picks up each new copy. No panel (e.g. a site without
		// that script) → the row stays hidden and Frappe's own links are used.
		$h.append(`<div class="pw-links" hidden><span class="pw-jump-l">${esc(__('Linked'))}</span><div class="pw-links-slot"></div></div>`);
		const $layout = $(frm.layout.wrapper);
		const adopt = () => {
			const panel = $layout.find('#custom-connections-panel')[0];
			const slot = $h.find('.pw-links-slot')[0];
			if (!slot) return;
			if (panel && panel.parentElement !== slot) slot.appendChild(panel);
			$h.find('.pw-links')[0].hidden = !panel;
			// Each pill's record count ("3 records" / "No records", filled in
			// later by that script) → a number badge (data-n) + .pw-has when > 0.
			$(slot).find('.custom-conn-card, [id$="-group-toggle"]').each((_, card) => {
				const n = ($(card).find('.conn-count, [id$="-group-summary"]').text().match(/\d+/) || ['0'])[0];
				const label = card.children[1];
				if (label && label.getAttribute('data-n') !== n) label.setAttribute('data-n', n);
				card.classList.toggle('pw-has', n !== '0');
				// The connection's own colour (its icon's) as the tile accent.
				const ic = card.querySelector('i');
				if (ic && ic.style.color && !card.style.getPropertyValue('--lc')) card.style.setProperty('--lc', ic.style.color);
			});
		};
		if (frm._pw_conn_obs) frm._pw_conn_obs.disconnect();
		if (window.MutationObserver) {
			frm._pw_conn_obs = new MutationObserver(adopt);
			frm._pw_conn_obs.observe($layout[0], { childList: true, subtree: true });
		}
		setTimeout(adopt, 0);
		$h.on('click', '.pw-jump-chip', (e) => {
			const s = secs[+e.currentTarget.getAttribute('data-i')];
			if (!s) return;
			if (s.is_collapsed && s.is_collapsed()) s.collapse(false);
			s.wrapper[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
		});
		// "Back to top" — shown once the header card has scrolled out of view.
		frm.page.wrapper.find('.pw-top').remove();
		if (frm._pw_top_obs) frm._pw_top_obs.disconnect();
		const $top = $(`<button type="button" class="pw-top" title="${esc(__('Back to top'))}">↑ ${esc(__('Top'))}</button>`)
			.appendTo(frm.page.wrapper)
			.on('click', () => $h[0].scrollIntoView({ behavior: 'smooth', block: 'start' }));
		if (window.IntersectionObserver) {
			frm._pw_top_obs = new IntersectionObserver(([en]) => $top.toggleClass('is-on', !en.isIntersecting));
			frm._pw_top_obs.observe($h[0]);
		}
	}

	function pw_frf_skin(frm) {
		const on = frm.doctype === 'Field Registration Form';
		frm.page.wrapper.toggleClass('frf-form-skin', on);
		if (!on) return;
		// A section without a heading continues the card above it — the
		// nearest *shown* one (hidden sections can sit in between).
		let prev = null;
		$(frm.layout.wrapper).find('.form-section.card-section').each((_, el) => {
			el.classList.remove('pw-cont', 'pw-cont-prev');
			if (el.classList.contains('hide-control') || el.classList.contains('empty-section')) return;
			if (prev && !$(el).children('.section-head').length) {
				el.classList.add('pw-cont');
				prev.classList.add('pw-cont-prev');
			}
			prev = el;
		});
		if (document.getElementById('pw-frf-css')) return;
		$('head').append(`<style id="pw-frf-css">
/* jump row inside the header card */
.pw-jump { flex-basis:100%; display:flex; align-items:center; flex-wrap:wrap; gap:6px; padding-top:12px; border-top:1px solid var(--border-color, #EDF1F5); }
.pw-jump-l { font-size:10.5px; font-weight:700; color:var(--text-muted, #6B7A8A); text-transform:uppercase; letter-spacing:.07em; margin-right:4px; }
.pw-jump-chip { border:1px solid var(--border-color, #DDE3EA); background:var(--card-bg, #fff); color:var(--text-color, #1A2B3C);
	border-radius:999px; padding:3px 11px; font-size:12px; font-weight:600; cursor:pointer; }
.pw-jump-chip:hover { border-color:#2C5282; color:#2C5282; background:color-mix(in srgb, #2C5282 6%, var(--card-bg, #fff)); }
/* linked-records row: the connections panel squeezed into pills (overrides its inline styles) */
.pw-links { flex-basis:100%; display:flex; align-items:flex-start; gap:6px; padding-top:12px; border-top:1px solid var(--border-color, #EDF1F5); }
.pw-links[hidden] { display:none; }
.pw-links > .pw-jump-l { padding-top:7px; }
.pw-links-slot { flex:1; min-width:0; }
.pw-links #custom-connections-panel { margin:0 !important; padding:0 !important; }
.pw-links #custom-connections-panel > div:first-child { display:none !important; }
.pw-links #custom-connections-panel > div:nth-child(2) { display:flex !important; flex-wrap:wrap; gap:6px !important; align-items:flex-start !important; }
.pw-links #custom-connections-panel > div:nth-child(2) > div:not(.custom-conn-card) { position:relative; }
/* tiles, not pills — each with its connection's colour (--lc) as a left stripe, so the row reads
   differently from the neutral "Jump to" chips above it */
.pw-links .custom-conn-card, .pw-links [id$="-group-toggle"] {
	--lc:#64748B; height:36px; padding:0 6px 0 11px !important; gap:8px !important;
	border:1px solid color-mix(in srgb, var(--lc) 22%, var(--border-color, #DDE3EA)) !important; border-left:3px solid var(--lc) !important;
	border-radius:8px !important; background:color-mix(in srgb, var(--lc) 5%, var(--card-bg, #fff)) !important;
	transition:border-color .15s, background .15s, box-shadow .15s; }
.pw-links .custom-conn-card:hover, .pw-links [id$="-group-toggle"]:hover {
	border-color:color-mix(in srgb, var(--lc) 55%, transparent) !important; border-left-color:var(--lc) !important;
	background:color-mix(in srgb, var(--lc) 10%, var(--card-bg, #fff)) !important; box-shadow:0 2px 6px rgba(16,24,40,.08); }
/* records on file: stronger tint */
.pw-links .pw-has { background:color-mix(in srgb, var(--lc) 12%, var(--card-bg, #fff)) !important;
	border-color:color-mix(in srgb, var(--lc) 45%, transparent) !important; border-left-color:var(--lc) !important; }
/* no icon circle (its icon font isn't loaded) and no "No records" text — a count badge instead */
.pw-links .custom-conn-card > div:first-child, .pw-links [id$="-group-toggle"] > div:first-child,
.pw-links .conn-count, .pw-links [id$="-group-summary"] { display:none !important; }
.pw-links .custom-conn-card > div:nth-child(2), .pw-links [id$="-group-toggle"] > div:nth-child(2) {
	display:flex; align-items:center; gap:7px; flex:0 1 auto !important; }
.pw-links .custom-conn-card > div:nth-child(2) > div:first-child,
.pw-links [id$="-group-toggle"] > div:nth-child(2) > div:first-child {
	margin:0 !important; font-size:12.5px !important; font-weight:600 !important; white-space:nowrap; color:var(--text-color, #1A2B3C) !important; }
.pw-links [data-n]::after { content:attr(data-n); min-width:20px; height:18px; padding:0 6px; border-radius:5px; display:inline-flex;
	align-items:center; justify-content:center; font-size:11px; font-weight:700;
	background:var(--card-bg, #fff); border:1px solid color-mix(in srgb, var(--lc) 25%, var(--border-color, #DDE3EA)); color:#6B7A8A; }
.pw-links .pw-has [data-n]::after { background:var(--lc); border-color:var(--lc); color:#fff; }
.pw-links .conn-add-btn { width:24px !important; height:24px !important; border-radius:6px !important; font-size:15px !important;
	background:var(--card-bg, #fff) !important; border:1px solid color-mix(in srgb, var(--lc) 25%, var(--border-color, #DDE3EA)) !important;
	color:var(--lc) !important; }
.pw-links .conn-add-btn:hover { background:var(--lc) !important; border-color:var(--lc) !important; color:#fff !important; }
.pw-links [id$="-group-chevron"] { font-size:16px !important; padding:0 4px; }
:root[data-theme="dark"] .pw-links [data-n]::after { background:#2A2F36; color:#C3CBD5; }
.pw-links [id$="-group-rows"] { position:absolute !important; top:calc(100% + 4px); left:0; z-index:30; min-width:340px;
	margin:0 !important; border-radius:10px !important; border:1px solid var(--border-color, #DDE3EA) !important;
	box-shadow:0 12px 28px rgba(16,24,40,.14); }
/* the panel now lives in the header: Frappe's empty dashboard above the form goes too */
.frf-form-skin:has(.pw-links #custom-connections-panel) .form-layout .form-dashboard { display:none !important; }
/* full-width page (Frappe's default container is ~1290px) */
.frf-form-skin .container { max-width:96vw !important; }
/* no form sidebar (assign / attachments / tags / share) and no ☰ toggle for it — the form takes the width */
.frf-form-skin .layout-side-section, .frf-form-skin .sidebar-toggle-btn { display:none !important; }
.frf-form-skin .layout-main-section-wrapper { width:100% !important; max-width:100% !important; flex:1 1 100% !important; }
/* page: soft background, each section a white card with a navy-marked heading */
.frf-form-skin .form-layout { background:#EEF2F7; border-radius:12px; padding:12px; }
:root[data-theme="dark"] .frf-form-skin .form-layout { background:#16191D; }
.frf-form-skin .form-layout > .form-page { background:transparent !important; box-shadow:none !important; border:0 !important; }
.frf-form-skin .form-dashboard-section, .frf-form-skin .form-section.card-section {
	background:var(--card-bg, #fff); border:1px solid var(--border-color, #DDE3EA) !important; border-radius:10px;
	margin-bottom:12px; padding-bottom:14px; box-shadow:0 1px 2px rgba(16,24,40,.04); scroll-margin-top:80px; }
/* a section without a heading continues the card above it (classes set in pw_frf_skin) */
.frf-form-skin .form-section.pw-cont-prev { margin-bottom:0; border-bottom-left-radius:0; border-bottom-right-radius:0;
	border-bottom:1px dashed var(--border-color, #DDE3EA) !important; }
.frf-form-skin .form-section.pw-cont { border-top:0 !important; border-top-left-radius:0; border-top-right-radius:0; }
/* a collapsed section is just its heading */
.frf-form-skin .form-section.card-section:has(> .section-head.collapsed) { padding-bottom:0; }
.frf-form-skin .form-section > .section-head { display:flex; align-items:center; gap:8px; font-size:14px; font-weight:700; color:#1F3A5A; }
.frf-form-skin .form-section > .section-head::before { content:""; flex-shrink:0; width:3px; height:15px; border-radius:2px; background:#2C5282; }
:root[data-theme="dark"] .frf-form-skin .form-section > .section-head { color:#C9D8EA; }
/* connections block as one card — Frappe's own links when it has any, or the block a site
   script draws right after it (an unnamed div on some sites); an empty dashboard stays flat */
.frf-form-skin .form-layout .form-dashboard { background:transparent !important; }
.frf-form-skin .form-layout .form-dashboard:has(+ div:is(:not([class]), [class=""])) { display:none !important; }
.frf-form-skin .form-layout .form-dashboard:has(.form-links .transactions > *),
.frf-form-skin .form-layout > .form-page > div:is(:not([class]), [class=""]):has(*) {
	background:var(--card-bg, #fff) !important; border:1px solid var(--border-color, #DDE3EA);
	border-radius:10px; padding:4px 4px 10px; margin-bottom:12px; box-shadow:0 1px 2px rgba(16,24,40,.04); }
.frf-form-skin .form-dashboard .form-dashboard-section { border:0 !important; box-shadow:none; margin-bottom:0; padding-bottom:0; background:transparent; }
/* child tables (status log, job change log, languages…) with the list's navy header */
.frf-form-skin .form-grid { border-radius:8px; overflow:hidden; }
.frf-form-skin .form-grid .grid-heading-row, .frf-form-skin .form-grid .grid-heading-row .grid-row,
.frf-form-skin .form-grid .grid-heading-row .data-row { background:#1F3A5A !important; color:#fff; }
.frf-form-skin .form-grid .grid-heading-row .static-area, .frf-form-skin .form-grid .grid-heading-row .col,
.frf-form-skin .form-grid .grid-heading-row .row-index { color:#fff !important; font-weight:600; }
.frf-form-skin .form-grid .grid-heading-row svg { stroke:#fff; color:#fff; }
.frf-form-skin .form-grid .grid-heading-row .data-row > div { background:transparent !important; }
/* toolbar: one primary (Next Stage, navy) and matching outlined buttons — overrides the
   buttons' own inline colours from the status / CV / request scripts */
.frf-form-skin .page-actions .btn-move-status,
.frf-form-skin .page-actions .btn-all-status,
.frf-form-skin .page-actions button[data-label="CV%20Preview"],
.frf-form-skin .page-actions .resume-resubmission-btn {
	height:32px; padding:0 13px !important; border-radius:8px !important; font-size:13px !important; font-weight:600 !important;
	display:inline-flex !important; align-items:center; gap:6px; box-shadow:none !important;
	background:var(--card-bg, #fff) !important; border:1px solid #C9D5E3 !important; color:#1F3A5A !important; }
.frf-form-skin .page-actions .btn-all-status:hover,
.frf-form-skin .page-actions button[data-label="CV%20Preview"]:hover,
.frf-form-skin .page-actions .resume-resubmission-btn:hover { border-color:#2C5282 !important; background:#F1F5FA !important; }
.frf-form-skin .page-actions .btn-move-status { background:#1F3A5A !important; border-color:#1F3A5A !important; color:#fff !important; }
.frf-form-skin .page-actions .btn-move-status:hover { background:#2C5282 !important; border-color:#2C5282 !important; }
:root[data-theme="dark"] .frf-form-skin .page-actions .btn-all-status,
:root[data-theme="dark"] .frf-form-skin .page-actions button[data-label="CV%20Preview"],
:root[data-theme="dark"] .frf-form-skin .page-actions .resume-resubmission-btn { border-color:#343A42 !important; color:#C9D8EA !important; }
/* back to top */
.pw-top { position:fixed; right:28px; bottom:28px; z-index:1020; display:none; border:1px solid #C9D5E3; background:var(--card-bg, #fff);
	color:#1F3A5A; border-radius:999px; padding:7px 14px; font-size:12.5px; font-weight:700; cursor:pointer;
	box-shadow:0 4px 14px rgba(16,24,40,.12); }
.pw-top.is-on { display:inline-flex; }
.pw-top:hover { border-color:#2C5282; background:#F1F5FA; }
</style>`);
	}

	// Registration forms: summary header + "View profile" button on saved records.
	Object.keys(AP_PROGRAMS).forEach((doctype) => {
		frappe.ui.form.on(doctype, {
			refresh(frm) {
				pw_form_header(frm);
				if (frm.is_new()) return;
				frm.add_custom_button(__('View profile'), () => window.pathways_applicant_profile.open_for(doctype, frm.doc.name));
			},
		});
	});
})();
