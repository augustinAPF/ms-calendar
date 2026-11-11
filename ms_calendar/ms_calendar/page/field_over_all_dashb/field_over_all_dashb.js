frappe.pages['field-over-all-dashb'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Field Over All Dashboard',
		single_column: true
	});

	// ── Stage / row definitions ───────────────────────────────────────────
	// Stages, rows and the status → row mapping follow the Field
	// Registration Form workflow and come from the server
	// (ms_calendar.api.reports.get_report_meta, with_pipeline=1) — the same
	// definitions the Excel download uses, so screen and file always match.
	// Each interview round has Select / Reject, plus Scheduled / Feedback
	// Pending / Pending for candidates still in it, decided from their
	// interview date on Field Interview Schedule (see pipelineKey).
	let _meta = null;
	let STAGES = [];

	const DATA_COLS = ['RP', 'ST', 'HL', 'LH'];
	const SUB_COLS = ['RP', 'ST', 'HL', 'LH', 'Total'];

	function getCol(rec) {
		// department is the standardized, reliable field — check it first.
		// Exact-match here ("health" / "livelihood(s)") missed real live
		// values like "Health - Field", "Health Urban", "Livelihoods -
		// Field" and dropped ~15,500 records from this table entirely
		// (not miscounted — absent). Substring match instead, same fix
		// already applied to the role fallback below.
		const dept = (rec.department || '').toLowerCase().trim();
		if (dept.includes('health')) return 'HL';
		if (dept.includes('livelihood')) return 'LH';
		if (dept.includes('teacher')) return 'ST';
		if (dept.includes('resource person')) return 'RP';
		// department blank/unrecognized — fall back to role. Requiring an
		// exact role string ("School Teacher" / one of 3 exact Resource
		// Person variants) meant every other real value — "School Teacher
		// - Barmer", "Cluster..." with different casing, etc. — fell
		// through to `return null` too. Confirmed live: ~38,000 teacher
		// records and ~12,000 resource-person records outside that exact
		// list. Substring match here too.
		const role = (rec.role || '').toLowerCase();
		if (role.includes('teacher')) return 'ST';
		if (role.includes('resource person')) return 'RP';
		return null;
	}

	// State of the JOB applied for (job location on the application, else
	// the linked Job Opening's location) — never the candidate's own
	// native_state. Same matching as job_state() in api/reports.py.
	function statesIn(text) {
		var s = (text || '').toLowerCase();
		if (!s) return [];
		var found = _meta.states.filter(function (st) { return s.indexOf(st.toLowerCase()) !== -1; });
		if (!found.length) {
			found = Object.keys(_meta.aliases).filter(function (st) {
				return _meta.aliases[st].some(function (k) { return s.indexOf(k) !== -1; });
			});
		}
		return found;
	}
	function getRecState(r) {
		if (r._state) return r._state;
		var multi = false;
		var texts = [r.location, _meta.jo[r.job_title]];
		for (var i = 0; i < texts.length; i++) {
			var found = statesIn(texts[i]);
			if (found.length === 1) return (r._state = found[0]);
			if (found.length || /all states/i.test(texts[i] || '')) multi = true;
		}
		return (r._state = multi ? _meta.multi : _meta.none);
	}

	// Applied date ('YYYY-MM-DD'): Date of Applied, else Application Date,
	// else creation. Bulk imports carry a recent creation date for old
	// applications, so creation can't be used for the date filter.
	function appliedOf(r) {
		return String(r.date_of_applied || r.application_date || r.creation || '').slice(0, 10);
	}
	function fyStart() {
		var t = new Date();
		var y = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;
		return y + '-04-01';
	}

	// Pipeline row key for a record — mirrors pipeline_row_key() in
	// api/reports.py. "In a round" statuses split by the candidate's latest
	// interview date for that round (or a sibling EC/Subject/Technical/
	// Functional round): none → Pending, today or later → Scheduled,
	// earlier → Feedback Pending.
	function pipelineKey(r) {
		if (r._pk) return r._pk;
		var status = (r.application_status || '').trim();
		var key = _meta.status_to_key[status];
		var rnd = _meta.in_round[status];
		if (!key && rnd) {
			var dates = _meta.fis[r.name] || {};
			var d = dates[rnd];
			if (!d) {
				Object.keys(dates).forEach(function (k) {
					if (_meta.round_rank[k] === _meta.round_rank[rnd] && (!d || dates[k] > d)) d = dates[k];
				});
			}
			var slug = rnd.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
			key = slug + (!d ? '_pending' : (d >= _meta.today ? '_scheduled' : '_feedback'));
		}
		return (r._pk = key || 'other');
	}

	let _allRecs = [], _states = [], _data = {};
	let _ssSrcRecs = []; // records the currently-displayed summary cards were built from — read fresh at click time, not captured in a per-render closure (see renderSummary)

	const ALL_HEADERS = [
		'ID','Full Name','Status','Role','Department',
		'Job State','Job Location','Native State','Native District','Source',
		'Email','Phone','Alt Phone','Gender','DOB','Age',
		'Education','Teaching Degree','Teaching Exp (Yr)','Teaching Exp (Mo)',
		'Health Exp (Yr)','Health Exp (Mo)','Languages','Written Subject',
		'Test Location','APF Associated','Former Employee',
		'Shortlist Reason','Reject Reason','Hold Reason','Blocklist Reason','Applied On'
	];

	function fullRow(r) {
		return [
			r.name, r.full_name_aadhaar, r.application_status, r.role, r.department,
			getRecState(r), r.location, r.native_state, r.native_district, r.opportunity,
			r.email_address, r.phone_number, r.alternate_no, r.gender, r.dob, r.age,
			r.highest_education, r.teaching_degrees, r.teaching_year, r.teachingexp_month,
			r.health_expyear, r.health_expmonth, r.languages_known, r.written_subject,
			r.test_location, r.apf_associated, r.former_employee,
			r.reasons_for_shortlist, r.reasons_for_reject, r.hold_reason, r.blocklist_reason,
			appliedOf(r)
		];
	}

	// ── Styles ────────────────────────────────────────────────────────────
	$(wrapper).find('.page-content').append(`
	<style>
		.fod-bar{padding:12px 20px;background:#fff;border-bottom:1px solid #e5e7eb}
		.fod-filters-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
		.fod-filters-div{width:1px;align-self:stretch;background:#e5e7eb;margin:0 2px}
		.fod-bar label{font-size:12px;font-weight:600;color:#374151}
		.fod-bar input[type=date],.fod-bar select{padding:5px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;color:#111;background:#fff;min-width:120px}
		.fod-dt{font-size:12px;color:#9ca3af}
		.fod-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:6px;font-weight:600;font-size:12px;border:none;cursor:pointer;transition:background .15s,box-shadow .15s,transform .1s}
		.btn-blue{background:#1e40af;color:#fff}.btn-blue:hover{background:#1d3a8a}
		.btn-grey{background:#f3f4f6;color:#374151;border:1px solid #d1d5db}.btn-grey:hover{background:#e5e7eb}
		.fod-xl-btn{display:inline-flex;align-items:center;gap:8px;padding:8px 18px;border-radius:7px;font-weight:700;font-size:13px;border:none;cursor:pointer;background:linear-gradient(180deg,#3b9eff,#1e7fe0);color:#fff;box-shadow:0 2px 5px rgba(30,127,224,.35);transition:box-shadow .15s,transform .1s}
		.fod-xl-btn:hover{box-shadow:0 4px 10px rgba(30,127,224,.45);transform:translateY(-1px)}
		.fod-xl-btn:active{transform:translateY(0);box-shadow:0 2px 4px rgba(30,127,224,.35)}
		.fod-xl-btn:disabled{opacity:.7;cursor:wait;transform:none}
		.fod-xl-btn .ic{display:inline-flex;font-size:14px}
		.fod-xl-btn .spin{display:inline-block;width:13px;height:13px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:fod-spin .7s linear infinite}
		@keyframes fod-spin{to{transform:rotate(360deg)}}
		.fod-wrap{overflow:auto;padding:0 20px 10px;max-height:calc(100vh - 160px)}
		.fod-load{padding:60px;text-align:center;color:#9ca3af;font-size:14px}
		.fod-tbl{border-collapse:collapse;font-size:11px;white-space:nowrap}
		.fod-tbl th,.fod-tbl td{border:1px solid #bbb;padding:3px 7px;text-align:center;vertical-align:middle}
		.fod-tbl .c-stage{min-width:110px;font-weight:700;white-space:normal;position:sticky;left:0;z-index:12}
		.fod-tbl .c-status{min-width:250px;text-align:left;white-space:normal;position:sticky;left:111px;z-index:12;box-shadow:3px 0 6px -3px rgba(0,0,0,.25)}
		.fod-tbl thead .c-stage,.fod-tbl thead .c-status{z-index:25}
		.fod-tbl .c-num{min-width:36px;font-variant-numeric:tabular-nums;cursor:pointer}
		.fod-tbl .c-num:hover{filter:brightness(0.88)}
		.fod-tbl .c-tot{font-weight:700;background:#BDD7EE!important;color:#1F497D!important}
		.fod-tbl .r-total .c-stage,.fod-tbl .r-total .c-status{background:#BDD7EE!important;font-weight:700;color:#1F497D!important}
		.fod-tbl .r-total .c-num{background:#BDD7EE!important;font-weight:700;color:#1F497D!important}
		.fod-tbl .r-total .c-tot{background:#9ab8d4!important;color:#1F497D!important}
		.fod-tbl thead th{position:sticky;top:0;z-index:20;font-weight:700}
		.fod-tbl thead tr:nth-child(2) th{top:32px;z-index:19}
		.fod-ms{position:relative;min-width:150px;max-width:230px}
		.fod-ms-box{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:3px 6px;border:1px solid #d1d5db;border-radius:5px;background:#fff;cursor:pointer;min-height:26px}
		.fod-ms-box:hover{border-color:#9ca3af}
		.fod-ms.open .fod-ms-box{border-color:#1e40af;box-shadow:0 0 0 2px rgba(30,64,175,.12)}
		.fod-ms-ph{font-size:12px;color:#9ca3af;padding:2px 2px}
		.fod-ms-chip{display:inline-flex;align-items:center;gap:4px;background:#e0e7ff;color:#1e3a8a;border-radius:4px;padding:1px 5px 1px 7px;font-size:11px;font-weight:600;max-width:120px}
		.fod-ms-chip span.txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
		.fod-ms-chip .x{cursor:pointer;font-size:12px;line-height:1;opacity:.7;padding:0 1px}
		.fod-ms-chip .x:hover{opacity:1}
		.fod-ms-more{font-size:11px;color:#6b7280;font-weight:600;padding:1px 4px}
		.fod-ms-panel{display:none;position:absolute;top:calc(100% + 4px);left:0;z-index:60;background:#fff;border:1px solid #d1d5db;border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,.15);width:max(100%,270px);max-width:min(360px,90vw);max-height:300px;overflow-y:auto;overflow-x:hidden}
		.fod-ms.open .fod-ms-panel{display:block}
		.fod-ms-search{position:sticky;top:0;background:#fff;padding:6px;border-bottom:1px solid #eee}
		.fod-ms-search input{width:100%;padding:4px 7px;border:1px solid #d1d5db;border-radius:4px;font-size:12px}
		.fod-ms-actions{display:flex;justify-content:space-between;padding:5px 8px;border-bottom:1px solid #eee;font-size:11px}
		.fod-ms-actions a{color:#1e40af;cursor:pointer;font-weight:600}
		.fod-ms-opt{display:flex;align-items:flex-start;gap:8px;padding:6px 10px;font-size:12px;cursor:pointer;white-space:normal;line-height:1.35}
		.fod-ms-opt:hover{background:#f3f4f6}
		.fod-ms-opt input{margin:2px 0 0;flex:none}
		.fod-ms-opt span{overflow-wrap:anywhere}
		.fod-ms-empty{padding:10px;font-size:12px;color:#9ca3af;text-align:center}
		.ss-wrap{padding:18px 20px 28px}
		.ss-title{font-size:13px;font-weight:700;color:#1e3a5f;margin-bottom:10px;padding-bottom:5px;border-bottom:2px solid #1e3a5f}
		.ss-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
		.ss-card{background:#fff;border:1px solid #e5e7eb;border-radius:7px;padding:12px 14px;text-align:center;box-shadow:0 1px 2px rgba(0,0,0,.05);transition:box-shadow .15s,transform .1s;display:flex;flex-direction:column;justify-content:center;min-height:64px}
		.ss-card:hover{box-shadow:0 3px 10px rgba(0,0,0,.15);transform:translateY(-1px)}
		.ss-card .n{font-size:26px;font-weight:700;line-height:1.2}.ss-card .l{font-size:11px;color:#6b7280;font-weight:500;line-height:1.3;margin-top:2px}
		.fod-recs-dialog{padding:0!important}
		.fod-recs-dialog .modal-dialog{max-width:95vw!important;width:95vw!important;height:92vh!important;margin:4vh auto!important}
		.fod-recs-dialog .modal-content{height:92vh!important;border-radius:8px!important;display:flex;flex-direction:column}
		.fod-recs-dialog .modal-body{flex:1 1 auto;overflow:hidden;display:flex;flex-direction:column}
		.fod-recs-dialog .msgprint{flex:1 1 auto;display:flex;flex-direction:column;min-height:0}
		.fod-recs-dialog .fod-rec-scroll{flex:1 1 auto;min-height:0;max-height:none!important}
	</style>
	<div class="fod-bar">
		<div class="fod-filters-row">
			<label>From:</label><input type="date" id="f-from"/>
			<label>To:</label><input type="date" id="f-to"/>
			<div class="fod-ms" id="f-state" data-placeholder="All States"></div>
			<div class="fod-ms" id="f-district" data-placeholder="All Districts"></div>
			<div class="fod-ms" id="f-source" data-placeholder="All Sources"></div>
			<div class="fod-ms" id="f-role" data-placeholder="All Roles"></div>
			<div class="fod-ms" id="f-department" data-placeholder="All Departments"></div>
			<div class="fod-ms" id="f-location" data-placeholder="All Locations"></div>
			<div class="fod-filters-div"></div>
			<button class="fod-btn btn-blue" id="f-apply">Apply</button>
			<button class="fod-btn btn-grey"  id="f-clear">Clear</button>
			<button class="fod-xl-btn" id="f-xl"><span class="ic">&#8659;</span> Download Excel</button>
			<div class="fod-filters-div"></div>
			<span class="fod-dt" id="f-dt"></span>
		</div>
	</div>
	<div class="ss-wrap" id="ss-wrap" style="display:none">
		<div class="ss-title">Application Status Summary</div>
		<div class="ss-grid" id="ss-grid"></div>
	</div>
	<div class="fod-wrap" id="f-wrap"><div class="fod-load">Loading…</div></div>`);

	// Escapes text for both HTML content and (double-quoted) attribute
	// contexts — option values come straight from DB fields (district,
	// role, department, ...) with no guarantee they're free of < > & ",
	// and were previously inserted as raw HTML/attribute text.
	function escHtml(s) {
		return (s == null ? '' : String(s))
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	// ── Multiselect (tag/chip) widget ─────────────────────────────────────
	// Each filter is a plain div#f-xxx; this turns it into a chip-input
	// multiselect and exposes get/setOptions/val via $.data(el, 'fodMs').
	function makeMultiselect($el, onChange) {
		var placeholder = $el.data('placeholder') || 'All';
		var options = []; // full list of selectable string values
		var selected = []; // currently-selected string values

		$el.html(
			'<div class="fod-ms-box"><span class="fod-ms-ph">' + escHtml(placeholder) + '</span></div>' +
			'<div class="fod-ms-panel">' +
				'<div class="fod-ms-search"><input type="text" placeholder="Search…"/></div>' +
				'<div class="fod-ms-actions"><a class="fod-ms-all">Select all</a><a class="fod-ms-none">Clear</a></div>' +
				'<div class="fod-ms-list"></div>' +
			'</div>'
		);
		var $box = $el.find('.fod-ms-box');
		var $panel = $el.find('.fod-ms-panel');
		var $search = $el.find('.fod-ms-search input');
		var $list = $el.find('.fod-ms-list');

		function renderBox() {
			$box.empty();
			if (!selected.length) {
				$box.append('<span class="fod-ms-ph">' + escHtml(placeholder) + '</span>');
				return;
			}
			var shown = selected.slice(0, 2);
			shown.forEach(function (v) {
				var esc = escHtml(v);
				$box.append(
					'<span class="fod-ms-chip" title="' + esc + '">' +
						'<span class="txt">' + esc + '</span><span class="x" data-v="' + esc + '">&times;</span>' +
					'</span>'
				);
			});
			if (selected.length > shown.length) {
				$box.append('<span class="fod-ms-more">+' + (selected.length - shown.length) + ' more</span>');
			}
		}

		function renderList(filterText) {
			var q = (filterText || '').toLowerCase();
			$list.empty();
			var matches = options.filter(function (v) { return v.toLowerCase().indexOf(q) !== -1; });
			if (!matches.length) {
				$list.append('<div class="fod-ms-empty">No matches</div>');
				return;
			}
			matches.forEach(function (v) {
				var checked = selected.indexOf(v) !== -1;
				var esc = escHtml(v);
				$list.append(
					'<label class="fod-ms-opt"><input type="checkbox" data-v="' + esc + '"' + (checked ? ' checked' : '') + '/>' +
						'<span>' + esc + '</span></label>'
				);
			});
		}

		function open() {
			if ($el.hasClass('open')) return;
			$('.fod-ms.open').each(function () { $(this).removeClass('open'); });
			$el.addClass('open');
			renderList($search.val());
			$search.val('').trigger('focus');
		}
		function close() { $el.removeClass('open'); }

		$box.on('click', function (e) {
			if ($(e.target).hasClass('x')) return; // handled below
			$el.hasClass('open') ? close() : open();
		});
		$box.on('click', '.x', function (e) {
			e.stopPropagation();
			var v = $(this).data('v').toString();
			selected = selected.filter(function (s) { return s !== v; });
			renderBox();
			if ($el.hasClass('open')) renderList($search.val());
			onChange(selected.slice());
		});
		$search.on('input', function () { renderList($(this).val()); });
		$search.on('click', function (e) { e.stopPropagation(); });
		$list.on('click', '.fod-ms-opt', function (e) {
			e.stopPropagation();
		});
		$list.on('change', 'input[type=checkbox]', function () {
			var v = $(this).data('v').toString();
			if (this.checked) {
				if (selected.indexOf(v) === -1) selected.push(v);
			} else {
				selected = selected.filter(function (s) { return s !== v; });
			}
			renderBox();
			onChange(selected.slice());
		});
		$el.find('.fod-ms-all').on('click', function (e) {
			e.stopPropagation();
			var q = ($search.val() || '').toLowerCase();
			var visible = options.filter(function (v) { return v.toLowerCase().indexOf(q) !== -1; });
			visible.forEach(function (v) { if (selected.indexOf(v) === -1) selected.push(v); });
			renderBox(); renderList($search.val());
			onChange(selected.slice());
		});
		$el.find('.fod-ms-none').on('click', function (e) {
			e.stopPropagation();
			selected = [];
			renderBox(); renderList($search.val());
			onChange(selected.slice());
		});

		var api = {
			setOptions: function (opts) {
				options = opts.slice();
				selected = selected.filter(function (s) { return options.indexOf(s) !== -1; });
				renderBox();
				if ($el.hasClass('open')) renderList($search.val());
			},
			val: function () { return selected.slice(); },
			setVal: function (vals) {
				selected = (vals || []).filter(function (s) { return options.indexOf(s) !== -1; });
				renderBox();
			},
			clear: function () { selected = []; renderBox(); }
		};
		$el.data('fodMs', api);
		return api;
	}

	// Global: close any open multiselect when clicking elsewhere on the page.
	// Unbind first in case on_page_load runs again for this same page instance.
	$(document).off('click.fodMsOutside').on('click.fodMsOutside', function (e) {
		if ($(e.target).closest('.fod-ms').length) return;
		$(wrapper).find('.fod-ms.open').removeClass('open');
	});

	const MS_IDS = ['f-state', 'f-district', 'f-source', 'f-role', 'f-department', 'f-location'];
	const _msWidgets = {};
	MS_IDS.forEach(function (id) {
		_msWidgets[id] = makeMultiselect($(wrapper).find('#' + id), function () {
			var filtered = getFilteredRecs();
			var res = aggregate(filtered);
			_states = res.states; _data = res.data;
			renderTable();
			renderSummary(filtered);
		});
	});
	function msVal(id) { return _msWidgets[id].val(); }

	// ── Event handlers ────────────────────────────────────────────────────
	// Bound once here (not inside renderSummary, which re-runs on every
	// filter change) — always reads _ssSrcRecs fresh at click time instead
	// of a value captured by whichever render happened to bind last.
	$(wrapper).find('#ss-grid').on('click', '.ss-card', function () {
		var status = $(this).data('status');
		var matched = status
			? _ssSrcRecs.filter(function (r) { return (r.application_status || 'Unknown') === status; })
			: _ssSrcRecs;
		if (!matched.length) { frappe.msgprint('No records found.'); return; }
		showRecordsDialog(status || 'Overall', matched, ALL_HEADERS, fullRow);
	});
	$(wrapper).find('#f-apply').on('click', loadData);
	$(wrapper).find('#f-clear').on('click', function () {
		$(wrapper).find('#f-from,#f-to').val('');
		MS_IDS.forEach(function (id) { _msWidgets[id].clear(); });
		loadData();
	});
	$(wrapper).find('#f-xl').on('click', function () {
		const $btn = $(this);
		if ($btn.prop('disabled')) return;
		const from = $(wrapper).find('#f-from').val();
		const to = $(wrapper).find('#f-to').val();
		let url = '/api/method/ms_calendar.api.ms_field.download_field_overall_excel';
		const p = [];
		if (from) p.push('from_date=' + encodeURIComponent(from));
		if (to) p.push('to_date=' + encodeURIComponent(to));
		var paramName = { 'f-state': 'state', 'f-district': 'district', 'f-source': 'source', 'f-role': 'role', 'f-department': 'department', 'f-location': 'location' };
		MS_IDS.forEach(function (id) {
			var vals = msVal(id);
			if (vals.length) p.push(paramName[id] + '=' + encodeURIComponent(JSON.stringify(vals)));
		});
		if (p.length) url += '?' + p.join('&');

		// Visual feedback while the file generates — the request is a plain
		// navigation (needed so the browser's download/save-as flow kicks
		// in), so there's no XHR "done" event to key off; re-enable after a
		// fixed delay just to restore the button for a possible re-click.
		var origHtml = $btn.html();
		$btn.prop('disabled', true).html('<span class="spin"></span> Preparing file…');
		setTimeout(function () { $btn.prop('disabled', false).html(origHtml); }, 3000);

		window.location.href = url;
	});

	// get_list or_filters that over-fetch every record whose applied date
	// could fall in the From..To range; loadData() keeps the exact ones.
	function buildOrFilters() {
		const from = $(wrapper).find('#f-from').val();
		const to = $(wrapper).find('#f-to').val();
		if (!from && !to) return [];
		function rng(field, isDt) {
			var a = from ? from + (isDt ? ' 00:00:00' : '') : null, b = to ? to + (isDt ? ' 23:59:59' : '') : null;
			if (a && b) return [field, 'between', [a, b]];
			return a ? [field, '>=', a] : [field, '<=', b];
		}
		return [rng('date_of_applied', false), rng('application_date', true), rng('creation', true)];
	}

	function getFilteredRecs() {
		var selState = msVal('f-state');
		var selDist  = msVal('f-district');
		var selSrc   = msVal('f-source');
		var selRole  = msVal('f-role');
		var selDept  = msVal('f-department');
		var selLoc   = msVal('f-location');
		return _allRecs.filter(function (r) {
			if (selState.length && selState.indexOf(getRecState(r)) === -1) return false;
			if (selDist.length && selDist.indexOf((r.native_district || '').trim()) === -1) return false;
			if (selSrc.length && selSrc.indexOf((r.opportunity || '').trim()) === -1) return false;
			if (selRole.length && selRole.indexOf((r.role || '').trim()) === -1) return false;
			if (selDept.length && selDept.indexOf((r.department || '').trim()) === -1) return false;
			if (selLoc.length && selLoc.indexOf((r.location || '').trim()) === -1) return false;
			return true;
		});
	}

	// ── Load ──────────────────────────────────────────────────────────────
	function loadData() {
		if (!_meta) {
			$(wrapper).find('#f-wrap').html('<div class="fod-load">Loading dashboard…</div>');
			frappe.call({
				method: 'ms_calendar.api.reports.get_report_meta',
				args: { with_pipeline: 1 },
				callback: function (r) {
					_meta = r.message;
					STAGES = _meta.stages;
					loadData();
				},
				error: function () {
					$(wrapper).find('#f-wrap').html('<div class="fod-load">Failed to load. Please refresh.</div>');
				}
			});
			return;
		}
		$(wrapper).find('#f-wrap').html('<div class="fod-load">Loading dashboard…</div>');
		$(wrapper).find('#ss-wrap').hide();
		$(wrapper).find('#f-dt').text('Date of Report: ' + frappe.datetime.now_date());
		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Field Registration Form',
				fields: ['name', 'full_name_aadhaar', 'application_status', 'role', 'department',
					'location', 'job_title', 'worklocation', 'native_state', 'native_district', 'opportunity',
					'email_address', 'phone_number', 'alternate_no', 'gender', 'dob', 'age',
					'highest_education', 'teaching_degrees', 'teaching_year', 'teachingexp_month',
					'health_expyear', 'health_expmonth', 'languages_known', 'written_subject',
					'test_location', 'apf_associated', 'former_employee',
					'reasons_for_shortlist', 'reasons_for_reject', 'hold_reason', 'blocklist_reason',
					'date_of_applied', 'application_date', 'creation'],
				filters: [['docstatus', '!=', '2']],
				or_filters: buildOrFilters(),
				limit_page_length: 0,
				order_by: 'creation asc'
			},
			callback: function (r) {
				var from = $(wrapper).find('#f-from').val(), to = $(wrapper).find('#f-to').val();
				_allRecs = (r.message || []).filter(function (rec) {
					var d = appliedOf(rec);
					return (!from || d >= from) && (!to || d <= to);
				});
				// Populate dropdowns
				var stSet = {}, diSet = {}, srcSet = {}, roleSet = {}, deptSet = {}, locSet = {};
				_allRecs.forEach(function (rec) {
					var st = getRecState(rec);
					if (st) stSet[st] = true;
					if (rec.native_district) diSet[rec.native_district.trim()] = true;
					if (rec.opportunity) srcSet[rec.opportunity.trim()] = true;
					if (rec.role) roleSet[rec.role.trim()] = true;
					if (rec.department) deptSet[rec.department.trim()] = true;
					if (rec.location) locSet[rec.location.trim()] = true;
				});
				_msWidgets['f-state'].setOptions(Object.keys(stSet).sort());
				_msWidgets['f-district'].setOptions(Object.keys(diSet).sort());
				_msWidgets['f-source'].setOptions(Object.keys(srcSet).sort());
				_msWidgets['f-role'].setOptions(Object.keys(roleSet).sort());
				_msWidgets['f-department'].setOptions(Object.keys(deptSet).sort());
				_msWidgets['f-location'].setOptions(Object.keys(locSet).sort());

				var res = aggregate(_allRecs);
				_states = res.states; _data = res.data;
				renderTable();
				renderSummary(_allRecs);
			},
			error: function () {
				$(wrapper).find('#f-wrap').html('<div class="fod-load">Failed to load. Please refresh.</div>');
			}
		});
	}

	// ── Aggregate ─────────────────────────────────────────────────────────
	function aggregate(records) {
		const april1 = fyStart();
		const stSet = new Set();
		const data = {}, summ = {};

		function inc(e, c, k) {
			if (!data[e]) data[e] = {};
			if (!data[e][c]) data[e][c] = {};
			data[e][c][k] = (data[e][c][k] || 0) + 1;
		}

		records.forEach(function (r) {
			const state = getRecState(r) || 'Unknown';
			const col = getCol(r);
			if (!col) return;
			stSet.add(state);

			const applied = appliedOf(r);
			const sk = pipelineKey(r);
			summ[r.application_status || 'Unknown'] = (summ[r.application_status || 'Unknown'] || 0) + 1;

			[state, 'Grand Total'].forEach(function (e) {
				inc(e, col, 'total');
				applied < april1 ? inc(e, col, 'carried_forward') : inc(e, col, 'received_this_year');
				inc(e, col, sk);
			});
		});

		return { states: Array.from(stSet).sort(), data, statusSummary: summ };
	}

	function cnt(s, c, k) { return ((_data[s] || {})[c] || {})[k] || 0; }
	function stTot(s, k) { return DATA_COLS.reduce(function (a, c) { return a + cnt(s, c, k); }, 0); }

	// ── Render count table with clickable cells ───────────────────────────
	function renderTable() {
		const groups = _states.concat(['Grand Total']);
		const HDR = '#1F497D', COL_A = '#DDEBF7', COL_B = '#BDD7EE', GRAND = '#1F497D';

		let h = '<table class="fod-tbl"><thead><tr>';
		h += `<th class="c-stage" rowspan="2" style="background:${HDR};color:#fff;top:0;z-index:25">Stages</th>`;
		h += `<th class="c-status" rowspan="2" style="background:${HDR};color:#fff;top:0;z-index:25">Status</th>`;
		groups.forEach(function (g, gi) {
			const isG = gi === groups.length - 1;
			const bg = isG ? GRAND : (gi % 2 === 0 ? COL_A : COL_B);
			const fg = isG ? '#fff' : '#1e293b';
			h += `<th colspan="${SUB_COLS.length}" style="background:${bg};color:${fg}">${g}</th>`;
		});
		h += '</tr><tr>';
		groups.forEach(function (_, gi) {
			const isG = gi === groups.length - 1;
			const bg = isG ? GRAND : (gi % 2 === 0 ? COL_A : COL_B);
			const fg = isG ? '#fff' : '#374151';
			SUB_COLS.forEach(function (sc) {
				h += `<th class="c-num" style="background:${bg};color:${fg};${sc === 'Total' ? 'font-weight:700' : ''};">${sc}</th>`;
			});
		});
		h += '</tr></thead><tbody>';

		STAGES.forEach(function (st) {
			st.rows.forEach(function (row, ri) {
				const isTot = row.total;
				const rbg = isTot ? '#BDD7EE' : '#ffffff';
				const rfg = '#1F497D';
				h += `<tr${isTot ? ' class="r-total"' : ''}>`;
				if (ri === 0) {
					h += `<td class="c-stage" rowspan="${st.rows.length}" style="background:#ffffff;color:#1F497D">${st.stage}</td>`;
				}
				h += `<td class="c-status" style="background:${rbg};color:${rfg}">${row.label}</td>`;

				groups.forEach(function (g, gi) {
					const isG = gi === groups.length - 1;
					const nbg = isG ? '#1F497D' : rbg;
					const nfg = isG ? '#fff' : rfg;

					DATA_COLS.forEach(function (col) {
						const v = cnt(g, col, row.key);
						const attr = 'data-state="' + g + '" data-col="' + col + '" data-rowkey="' + row.key + '"';
						h += `<td class="c-num fod-cell" ${attr} style="background:${nbg};color:${nfg}">${v || ''}</td>`;
					});
					const t = stTot(g, row.key);
					const tbg = isG ? '#1F497D' : '#BDD7EE';
					h += `<td class="c-num c-tot fod-cell" data-state="${g}" data-col="Total" data-rowkey="${row.key}" style="background:${tbg};color:${isG ? '#fff' : '#000'}">${t || ''}</td>`;
				});
				h += '</tr>';
			});
		});

		h += '</tbody></table>';
		$(wrapper).find('#f-wrap').html(h);
		// Second header row sits right under the first — its real height,
		// not a fixed 32px (the gap let body rows show through when scrolled).
		var $hr = $(wrapper).find('#f-wrap thead tr');
		$hr.eq(1).children('th').css('top', $hr.eq(0).outerHeight() + 'px');

		// Click handler on number cells
		$(wrapper).find('#f-wrap').off('click.fodCell').on('click.fodCell', '.fod-cell', function () {
			var state  = $(this).data('state');
			var col    = $(this).data('col');
			var rowkey = $(this).data('rowkey');
			if (!$(this).text().trim()) return;

			var base = getFilteredRecs();
			var april1 = fyStart();

			var matched = base.filter(function (r) {
				// state filter
				if (state !== 'Grand Total') {
					if (getRecState(r) !== state) return false;
				}
				// col filter
				if (col !== 'Total') {
					if (getCol(r) !== col) return false;
				}
				// rowkey filter
				if (rowkey === 'total') return true;
				if (rowkey === 'carried_forward') return appliedOf(r) < april1;
				if (rowkey === 'received_this_year') return appliedOf(r) >= april1;
				return pipelineKey(r) === rowkey;
			});

			if (!matched.length) { frappe.msgprint('No records found.'); return; }

			var title = (state === 'Grand Total' ? 'All States' : state)
				+ ' | ' + col + ' | ' + rowkey.replace(/_/g, ' ');

			showRecordsDialog(title, matched, ALL_HEADERS, fullRow);
		});
	}

	// ── Application Status summary cards ──────────────────────────────────
	function renderSummary(recs) {
		var srcRecs = recs || _allRecs;
		_ssSrcRecs = srcRecs;
		var summ = {};
		srcRecs.forEach(function (r) {
			var k = r.application_status || 'Unknown';
			summ[k] = (summ[k] || 0) + 1;
		});
		const entries = Object.entries(summ).sort(function (a, b) { return b[1] - a[1]; });
		if (!entries.length) return;
		const overallTotal = entries.reduce(function (sum, e) { return sum + e[1]; }, 0);
		const palette = ['#1F497D', '#2c7db8'];
		// Overall card first — every status card below is a slice of this
		// same total (current filters applied), so it's the one number that
		// lets you sanity-check the rest at a glance. data-status="" (empty)
		// means "no status filter" for the click handler below, same
		// convention the Overall card's total already uses.
		let html = `<div class="ss-card" data-status="" style="background:#1e3a5f;border-color:#1e3a5f;cursor:pointer;">
			<div class="n" style="color:#fff">${overallTotal}</div>
			<div class="l" style="color:#c7d7ea;font-weight:700;">Overall</div></div>`;
		entries.forEach(function (e, i) {
			html += `<div class="ss-card" data-status="${e[0].replace(/"/g, '&quot;')}" style="cursor:pointer;">
				<div class="n" style="color:${palette[i%palette.length]}">${e[1]}</div><div class="l">${e[0]}</div></div>`;
		});
		$(wrapper).find('#ss-grid').html(html);
		$(wrapper).find('#ss-wrap').show();
		// Click handling for these cards is bound once, outside this
		// function (see the "Event handlers" section near the top) — it
		// reads _ssSrcRecs (set just above) fresh at click time.
	}

	// ── Records dialog: CSV + Print/PDF + open in Frappe ─────────────────
	function showRecordsDialog(title, records, headers, rowFn) {
		function csvDownload() {
			var lines = [headers.join(',')];
			records.forEach(function (r) {
				lines.push(rowFn(r).map(function (v) {
					return '"' + (v || '').toString().replace(/"/g, '""') + '"';
				}).join(','));
			});
			var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
			var url = URL.createObjectURL(blob);
			var a = document.createElement('a'); a.href = url;
			a.download = title.replace(/[^a-z0-9]/gi, '_').slice(0, 40) + '.csv';
			document.body.appendChild(a); a.click();
			document.body.removeChild(a); URL.revokeObjectURL(url);
		}

		var thCells = headers.map(function (h) {
			return '<th style="padding:6px 8px;white-space:nowrap;position:sticky;top:0;background:#1F497D;color:#fff;z-index:1;">' + h + '</th>';
		}).join('');

		var rows = records.map(function (r) {
			var vals = rowFn(r);
			var formUrl = frappe.utils.get_url_to_form
				? frappe.utils.get_url_to_form('Field Registration Form', r.name)
				: '/app/field-registration-form/' + encodeURIComponent(r.name);
			return '<tr>' + vals.map(function (v, i) {
				return i === 0
					? '<td style="padding:4px 8px;white-space:nowrap;"><a href="' + formUrl + '" target="_blank" style="color:#1F497D;font-weight:600;">' + (v || '') + '</a></td>'
					: '<td style="padding:4px 8px;">' + (v || '') + '</td>';
			}).join('') + '</tr>';
		}).join('');

		var html = '<div style="margin-bottom:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
			+ '<button id="rec-csv-btn" style="padding:5px 14px;background:#166534;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;">⬇ Download CSV/Excel</button>'
			+ '<button id="rec-print-btn" style="padding:5px 14px;background:#1e40af;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;">🖨 Print / PDF</button>'
			+ '<span style="font-size:11px;color:#6b7280;">Click the ID to open record in Frappe</span>'
			+ '</div>'
			+ '<div class="fod-rec-scroll" style="overflow:auto;max-height:65vh;">'
			+ '<table id="rec-dlg-tbl" style="width:100%;border-collapse:collapse;font-size:12px;">'
			+ '<thead><tr>' + thCells + '</tr></thead>'
			+ '<tbody>' + rows + '</tbody></table></div>';

		// Full-screen popup. Use the dialog msgprint returns: a ':visible'
		// lookup runs before the fade-in ends, so the class was never added.
		var dlg = frappe.msgprint({ title: title + ' (' + records.length + ')', wide: true, message: html });
		var $modal = (dlg && dlg.$wrapper) ? dlg.$wrapper : $('.modal.msgprint-dialog').last();
		$modal.addClass('fod-recs-dialog');
		// msgprint reuses one dialog: drop the full-screen class when it closes
		// so later normal messages on this page are not full screen.
		$modal.one('hidden.bs.modal', function () { $modal.removeClass('fod-recs-dialog'); });

		setTimeout(function () {
			$('#rec-csv-btn').off('click').on('click', csvDownload);
			$('#rec-print-btn').off('click').on('click', function () {
				var tbl = document.getElementById('rec-dlg-tbl');
				var w = window.open('', '_blank');
				w.document.open();
				w.document.write('<html><head><title>' + title + '</title>'
					+ '<style>body{font-family:sans-serif}table{border-collapse:collapse;font-size:12px;width:100%}'
					+ 'th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}'
					+ 'th{background:#1F497D;color:#fff}a{color:#1F497D}</style></head><body>'
					+ '<h3>' + title + ' (' + records.length + ')</h3>'
					+ (tbl ? tbl.outerHTML : '') + '</body></html>');
				w.document.close(); w.focus(); w.print();
			});
		}, 100);
	}

	loadData();
};
