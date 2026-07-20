frappe.pages['-zayam-data-import'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Zwayam Data Import',
		single_column: true
	});

	render_import_card(page);
};

const DOCTYPE_CHOICES = [
	{ label: __('Select...'), value: '' },
	{ label: __('Grant'), value: 'Phil Registration Form' },
	{ label: __('Field'), value: 'Field Registration Form' }
];

function make_doctype_picker($container, opts) {
	const control = frappe.ui.form.make_control({
		parent: $container.get(0),
		df: {
			fieldtype: 'Select',
			fieldname: opts.fieldname,
			options: DOCTYPE_CHOICES.map((c) => ({ label: c.label, value: c.value })),
			change: () => {
				const value = control.get_value();
				if (value) opts.on_change(value);
			}
		},
		only_input: true,
		render_input: true
	});
	control.refresh();
	control.set_value(opts.default);
	return control;
}

const HOW_STEPS = [
	{ title: __('Fill in the data'), text: __('add one row per applicant. The Zwayam Id column is required; every other column is optional.') },
	{ title: __('Pick Grant or Field'), text: __('choose which registration form the file should be imported into.') },
	{ title: __('Columns are matched automatically'), text: __('every field on the chosen doctype (its name and its label) is a recognised Excel column header. If a column heading doesn\'t match any field, it\'s listed under "Unmatched Columns" instead of being silently dropped.') },
	{ title: __('Rows are matched by Zwayam Id'), text: __('an existing record with the same Zwayam Id is updated; a new Zwayam Id creates a new record.') },
	{ title: __('Each row is isolated'), text: __('if one row fails (e.g. a duplicate check or validation error), only that row is rolled back and its exact error is shown — earlier successful rows in the same import are not affected.') },
	{ title: __('PDF filenames encode the Zwayam Id'), text: `${__('the leading digits of each filename (e.g.')} <code>6213236-ClariceTPaul-Copy.pdf</code> → <code>6213236</code>) ${__('are used to find the matching record and attach the file to its resume field.')}` }
];

const ZAYAM_OVERRIDE_FIELDS = [
	{ key: 'geo', fieldname: 'geo', label: __('Geography'), options: 'Geo Master', doctypes: ['Phil Registration Form'] },
	{ key: 'themes', fieldname: 'themes', label: __('Theme'), options: 'Theme Master', doctypes: ['Phil Registration Form'] },
	{ key: 'location', fieldname: 'location', label: __('Location'), options: 'Recruitment Location', doctypes: ['Phil Registration Form', 'Field Registration Form'] },
	{ key: 'grant_role', fieldname: 'role', label: __('Role'), options: 'Recruitment Designation', doctypes: ['Phil Registration Form'] },
	{ key: 'field_role', fieldname: 'role', label: __('Role'), options: 'Field Role', doctypes: ['Field Registration Form'] },
	{ key: 'department', fieldname: 'department', label: __('Department'), options: 'Recruitment Department', doctypes: ['Field Registration Form'] }
];

function make_override_picker($container, opts) {
	const control = frappe.ui.form.make_control({
		parent: $container.get(0),
		df: {
			fieldtype: 'Link',
			fieldname: `zayam_override_${opts.key}`,
			options: opts.options,
			placeholder: __('Leave blank to keep each row\'s own {0}', [opts.label])
		},
		only_input: true,
		render_input: true
	});
	control.refresh();
	return control;
}

function activate_step(page, step) {
	const $stepper = $(page.body).find('.zayam-stepper');
	$stepper.find('.zayam-stepper-step').each(function () {
		const n = Number($(this).data('step'));
		$(this).toggleClass('is-active', n === step).toggleClass('is-done', n < step);
	});
	$stepper.find('.zayam-stepper-line').toggleClass('is-done', step > 1);
}

function update_records_link(page, link_class, doctype) {
	const route = frappe.router.slug(doctype);
	$(page.body).find(`.${link_class}`).attr('href', `/app/${route}`).text(doctype);
}

function entry_label(entry) {
	const id = entry.zayam_id || __('(no Zwayam Id)');
	return entry.name ? `${entry.name} — ${id}` : id;
}

function simple_list_group_html(cls, icon, label, items) {
	if (!items.length) return '';
	return `
		<div class="zayam-detail-group">
			<div class="zayam-detail-group-title ${cls}">${icon} ${label} (${items.length})</div>
			<ul class="zayam-detail-list">
				${items.map((item) => `<li><span>${frappe.utils.escape_html(item)}</span></li>`).join('')}
			</ul>
		</div>
	`;
}

function render_import_card(page) {
	$(page.body).html(`
		<style>
			:root {
				--zayam-accent-import: #4f46e5;
				--zayam-accent-import-soft: rgba(79, 70, 229, 0.12);
				--zayam-accent-pdf: #d97706;
				--zayam-accent-pdf-soft: rgba(217, 119, 6, 0.12);
			}
			@keyframes zayamFadeUp {
				from { opacity: 0; transform: translateY(10px); }
				to { opacity: 1; transform: translateY(0); }
			}
			.zayam-page { max-width: 1360px; margin: 0 auto; padding: 40px 20px 56px; }
			.zayam-page-title { font-size: 22px; font-weight: 700; color: var(--text-color); margin: 0 0 20px; }
			.zayam-grid {
				display: flex;
				flex-direction: column;
				gap: 24px;
			}
			.zayam-panel {
				display: flex;
				flex-direction: column;
				background: var(--card-bg);
				border: 1px solid var(--border-color);
				border-top: 3px solid var(--zayam-accent-import);
				border-radius: 14px;
				box-shadow: var(--shadow-base);
				overflow: hidden;
				animation: zayamFadeUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
				transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s cubic-bezier(0.16, 1, 0.3, 1);
			}
			.zayam-grid .zayam-panel:nth-child(2) { animation-delay: 0.1s; }
			.zayam-panel:hover { transform: translateY(-3px); box-shadow: var(--shadow-lg, 0 10px 28px rgba(0,0,0,0.14)); }
			.zayam-panel.panel-pdf { border-top-color: var(--zayam-accent-pdf); }
			.zayam-panel-header {
				display: flex;
				align-items: center;
				gap: 14px;
				padding: 22px 28px 18px;
				border-bottom: 1px solid var(--border-color);
				background: linear-gradient(180deg, var(--zayam-accent-import-soft) 0%, transparent 100%);
			}
			.zayam-panel.panel-pdf .zayam-panel-header {
				background: linear-gradient(180deg, var(--zayam-accent-pdf-soft) 0%, transparent 100%);
			}
			.zayam-panel-badge {
				flex-shrink: 0;
				width: 40px;
				height: 40px;
				border-radius: 10px;
				display: flex;
				align-items: center;
				justify-content: center;
				font-size: 19px;
				background: var(--zayam-accent-import-soft);
			}
			.zayam-panel.panel-pdf .zayam-panel-badge { background: var(--zayam-accent-pdf-soft); }
			.zayam-panel-header h3 { margin: 0 0 3px; font-size: 16px; letter-spacing: -0.01em; color: var(--zayam-accent-import); }
			.zayam-panel.panel-pdf .zayam-panel-header h3 { color: var(--zayam-accent-pdf); }
			.zayam-panel-header p { margin: 0; font-size: 12.5px; color: var(--text-muted); line-height: 1.5; }
			.zayam-panel-body { padding: 30px 34px 34px; flex: 1 1 auto; }
			.zayam-field-label {
				display: block;
				font-size: 13px;
				font-weight: 600;
				color: var(--text-muted);
				margin-bottom: 7px;
			}
			.zayam-panel-body .description {
				color: var(--text-muted);
				margin-bottom: 22px;
				font-size: 14px;
				line-height: 1.7;
			}
			.zayam-panel-body .description code {
				background: var(--zayam-accent-import-soft);
				color: var(--zayam-accent-import);
				padding: 1px 5px;
				border-radius: 4px;
				font-size: 12px;
			}
			.zayam-panel.panel-pdf .description code {
				background: var(--zayam-accent-pdf-soft);
				color: var(--zayam-accent-pdf);
			}
			.zayam-doctype-link { margin-bottom: 20px; position: relative; z-index: 1; }
			.zayam-doctype-link:focus-within { z-index: 30; }
			.zayam-doctype-link .form-control {
				font-size: 14px;
				padding: 8px 12px;
				height: auto;
				transition: border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1);
			}
			.zayam-doctype-link .awesomplete > [role="listbox"] {
				z-index: 30;
				background-color: var(--bg-color, #fff);
				box-shadow: var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.18));
			}
			.zayam-doctype-link .form-control:focus {
				border-color: var(--zayam-accent-import);
				box-shadow: 0 0 0 3px var(--zayam-accent-import-soft);
			}
			.panel-pdf .zayam-doctype-link .form-control:focus {
				border-color: var(--zayam-accent-pdf);
				box-shadow: 0 0 0 3px var(--zayam-accent-pdf-soft);
			}
			.zayam-override-panel {
				border: 1px dashed var(--border-color);
				border-radius: 10px;
				padding: 16px 18px 4px;
				margin-bottom: 20px;
				background: rgba(128, 128, 128, 0.1);
			}
			.zayam-override-panel-title {
				font-size: 12.5px;
				font-weight: 700;
				color: var(--text-color);
				margin-bottom: 14px;
			}
			.zayam-override-panel-title span {
				font-weight: 400;
				color: var(--text-muted);
				text-transform: none;
			}
			.zayam-override-grid {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
				gap: 16px;
				margin-bottom: 16px;
			}
			.zayam-override-grid .zayam-doctype-link { margin-bottom: 0; }
			.zayam-override-label {
				display: block;
				font-size: 12.5px;
				font-weight: 600;
				color: var(--text-muted);
				margin-bottom: 5px;
			}
			.zayam-import-btn-row { display: flex; gap: 10px; }
			.zayam-panel-body .btn-import,
			.zayam-panel-body .btn-attach-pdfs {
				padding: 13px 26px;
				border: none;
				border-radius: 8px;
				font-weight: 600;
				font-size: 14px;
				letter-spacing: 0.01em;
				box-shadow: 0 1px 2px rgba(0,0,0,0.08);
				transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.12s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1);
			}
			.zayam-panel-body .btn-attach-pdfs { width: 100%; color: #fff; }
			.zayam-import-btn-row .btn-import { flex: 1; color: #fff; width: 100%; }
			.zayam-panel-body .btn-import:hover,
			.zayam-panel-body .btn-attach-pdfs:hover {
				opacity: 0.9;
				box-shadow: 0 2px 6px rgba(0,0,0,0.14);
			}
			.zayam-panel-body .btn-import:active,
			.zayam-panel-body .btn-attach-pdfs:active { transform: translateY(1px); }
			.zayam-panel-body .btn-import { background: var(--zayam-accent-import); }
			.zayam-panel-body .btn-attach-pdfs { background: var(--zayam-accent-pdf); }
			.zayam-preview { margin-top: 22px; text-align: left; animation: zayamFadeUp 0.35s cubic-bezier(0.16, 1, 0.3, 1) both; }
			.zayam-preview-title { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
			.zayam-preview-unmatched {
				font-size: 12px;
				color: var(--yellow-600, #b45309);
				margin-bottom: 10px;
			}
			.btn-map-columns, .btn-map-columns-results {
				background: var(--subtle-fg, rgba(128, 128, 128, 0.1));
				color: var(--text-color);
				border: 1px solid var(--border-color);
				padding: 9px 18px;
				border-radius: 8px;
				font-size: 12.5px;
				font-weight: 600;
				cursor: pointer;
				transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1);
			}
			.btn-map-columns::before, .btn-map-columns-results::before { content: '🗺️ '; }
			.btn-map-columns:hover, .btn-map-columns-results:hover { opacity: 0.85; }
			.btn-map-columns { margin-right: auto; }
			.zayam-results-actions { margin-top: 14px; }
			.zayam-map-columns-dialog .modal-dialog { max-width: 760px; }
			.zayam-map-columns-dialog .form-group.frappe-control { margin-bottom: 20px; }
			.zayam-map-columns-dialog .control-label { font-size: 13.5px; font-weight: 600; padding-bottom: 2px; }
			.zayam-map-columns-dialog select.form-control {
				font-size: 14px;
				padding: 9px 12px;
				height: auto;
			}
			.zayam-map-columns-dialog .help-box {
				font-size: 12.5px !important;
				margin-top: 4px;
				color: var(--zayam-accent-import);
			}
			.zayam-map-columns-dialog .help-box .text-muted { color: var(--text-muted) !important; }
			.zayam-preview-table-wrap {
				max-height: 320px;
				overflow: auto;
				border: 1px solid var(--border-color);
				border-radius: 6px;
			}
			.zayam-preview-table { width: 100%; border-collapse: collapse; font-size: 13px; white-space: nowrap; }
			.zayam-preview-table th, .zayam-preview-table td {
				padding: 10px 16px;
				border-bottom: 1px solid var(--border-color);
				text-align: left;
			}
			.zayam-preview-table thead th {
				position: sticky;
				top: 0;
				background: var(--subtle-fg, rgba(128, 128, 128, 0.08));
				font-weight: 600;
			}
			.zayam-preview-field { font-weight: 400; color: var(--text-muted); font-size: 10.5px; }
			.zayam-preview-sr { color: var(--text-muted); }
			.zayam-preview-actions { display: flex; gap: 10px; margin-top: 14px; }
			.zayam-preview-actions .btn { flex: 1; padding: 8px 16px; font-size: 12.5px; border-radius: 8px; border: none; font-weight: 600; }
			.zayam-preview-actions .btn-preview-cancel { background: var(--subtle-fg, rgba(128, 128, 128, 0.12)); color: var(--text-color); }
			.zayam-preview-actions .btn-preview-confirm { background: var(--zayam-accent-import); color: #fff; }
			.zayam-import-results { margin-top: 22px; text-align: left; animation: zayamFadeUp 0.35s cubic-bezier(0.16, 1, 0.3, 1) both; }
			.zayam-pdf-preview { margin-top: 22px; text-align: left; animation: zayamFadeUp 0.35s cubic-bezier(0.16, 1, 0.3, 1) both; }
			.zayam-import-results .stat-row {
				display: flex;
				justify-content: space-between;
				padding: 8px 2px;
				border-bottom: 1px solid var(--border-color);
				font-size: 13px;
			}
			.zayam-import-results .stat-row:last-child { border-bottom: none; }
			.zayam-import-results .stat-row.is-failed .stat-value { color: var(--red-500); }
			.zayam-import-results .stat-row.is-created .stat-value,
			.zayam-import-results .stat-row.is-updated .stat-value { color: var(--green-500); }
			.zayam-import-results .stat-label { color: var(--text-muted); }
			.zayam-import-results .stat-value { font-weight: 700; }
			.zayam-preview-table td.is-attached { color: var(--green-500); font-weight: 600; }
			.zayam-preview-table td.is-failed { color: var(--red-500); font-weight: 600; }
			.zayam-rematch-input {
				font-size: 12.5px;
				padding: 4px 8px;
				border-radius: 6px;
				border: 1px solid var(--red-500);
				background: var(--control-bg, var(--card-bg));
				color: var(--text-color);
				width: 130px;
			}
			.zayam-rematch-input:focus {
				outline: none;
				box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.15);
			}
			.zayam-rematch-cell { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
			.btn-rematch {
				background: var(--red-500);
				color: #fff;
				border: none;
				padding: 4px 10px;
				border-radius: 6px;
				font-size: 11.5px;
				font-weight: 600;
				cursor: pointer;
			}
			.btn-rematch:hover { opacity: 0.9; }
			.zayam-detail-group { margin-top: 14px; }
			.zayam-detail-group-title {
				font-size: 11px;
				font-weight: 700;
				text-transform: uppercase;
				letter-spacing: 0.04em;
				color: var(--text-muted);
				margin-bottom: 4px;
			}
			.zayam-detail-group-title.is-created, .zayam-detail-group-title.is-updated, .zayam-detail-group-title.is-attached {
				color: var(--green-500);
			}
			.zayam-detail-group-title.is-failed { color: var(--red-500); }
			.zayam-detail-group-title.is-unmatched, .stat-row.is-unmatched .stat-value { color: var(--yellow-600, #b45309); }
			.zayam-detail-list {
				margin: 0;
				padding: 0;
				list-style: none;
				max-height: 140px;
				overflow-y: auto;
				border: 1px solid var(--border-color);
				border-radius: 6px;
			}
			.zayam-detail-list li {
				display: flex;
				flex-direction: column;
				gap: 2px;
				padding: 6px 10px;
				font-size: 12.5px;
				border-bottom: 1px solid var(--border-color);
			}
			.zayam-detail-list li:last-child { border-bottom: none; }
			.zayam-detail-error {
				font-size: 11px;
				color: var(--red-500);
			}
			.zayam-panel-footer {
				padding: 12px 28px;
				border-top: 1px solid var(--border-color);
				background: var(--subtle-fg, rgba(128, 128, 128, 0.04));
				font-size: 12px;
				color: var(--text-muted);
				text-align: center;
			}
			.zayam-panel-footer a { font-weight: 600; }
			.zayam-how {
				margin-bottom: 24px;
				background: var(--card-bg);
				border: 1px solid var(--border-color);
				border-radius: 12px;
				box-shadow: var(--shadow-base);
				overflow: hidden;
			}
			.zayam-how-summary {
				padding: 16px 24px;
				font-size: 13px;
				font-weight: 600;
				cursor: pointer;
				display: flex;
				align-items: center;
				gap: 8px;
				user-select: none;
			}
			.zayam-how-arrow {
				display: inline-block;
				color: var(--text-muted);
				transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
			}
			.zayam-how-summary.is-open .zayam-how-arrow { transform: rotate(90deg); }
			.zayam-how-body-wrap {
				max-height: 0;
				overflow: hidden;
				transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1);
			}
			.zayam-how-body {
				padding: 4px 24px 20px;
				border-top: 1px solid var(--border-color);
			}
			.zayam-step {
				display: flex;
				gap: 14px;
				margin-top: 14px;
			}
			.zayam-step-number {
				flex-shrink: 0;
				width: 62px;
				font-size: 11px;
				font-weight: 700;
				text-transform: uppercase;
				letter-spacing: 0.03em;
				color: var(--zayam-accent-import);
				background: var(--zayam-accent-import-soft);
				border-radius: 20px;
				padding: 4px 0;
				text-align: center;
				height: fit-content;
			}
			.zayam-step-text { font-size: 13px; color: var(--text-muted); line-height: 1.6; }
			.zayam-step-text b { color: var(--text-color); }
			.zayam-step-number-inline {
				display: inline-block;
				width: auto;
				padding: 2px 10px;
				margin-bottom: 6px;
			}
			.panel-pdf .zayam-step-number-inline { color: var(--zayam-accent-pdf); background: var(--zayam-accent-pdf-soft); }
			.zayam-stepper {
				display: flex;
				align-items: center;
				gap: 0;
				margin: 0 0 24px;
			}
			.zayam-stepper-step {
				display: flex;
				align-items: center;
				gap: 10px;
				opacity: 0.45;
				transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
			}
			.zayam-stepper-step.is-active, .zayam-stepper-step.is-done { opacity: 1; }
			.zayam-stepper-num {
				flex-shrink: 0;
				width: 28px;
				height: 28px;
				border-radius: 50%;
				display: flex;
				align-items: center;
				justify-content: center;
				font-size: 13px;
				font-weight: 700;
				background: var(--subtle-fg, rgba(128, 128, 128, 0.15));
				color: var(--text-muted);
				transition: background 0.25s cubic-bezier(0.4, 0, 0.2, 1), color 0.25s cubic-bezier(0.4, 0, 0.2, 1);
			}
			.zayam-stepper-step.is-active .zayam-stepper-num { background: var(--zayam-accent-import); color: #fff; }
			.zayam-stepper-step.is-done .zayam-stepper-num { background: var(--green-500); color: #fff; }
			.zayam-stepper-step[data-step="2"].is-active .zayam-stepper-num { background: var(--zayam-accent-pdf); }
			.zayam-stepper-label { font-size: 13.5px; font-weight: 600; color: var(--text-color); }
			.zayam-stepper-line {
				flex: 1 1 auto;
				height: 2px;
				min-width: 40px;
				margin: 0 14px;
				background: var(--border-color);
				position: relative;
			}
			.zayam-stepper-line.is-done { background: var(--green-500); }
			.zayam-how-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px; }
			.zayam-how-tab {
				border: 1px solid var(--border-color);
				background: var(--subtle-fg, rgba(128, 128, 128, 0.08));
				color: var(--text-muted);
				font-size: 11px;
				font-weight: 700;
				text-transform: uppercase;
				letter-spacing: 0.03em;
				padding: 6px 14px;
				border-radius: 20px;
				cursor: pointer;
				transition: background 0.2s cubic-bezier(0.4, 0, 0.2, 1), color 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1);
			}
			.zayam-how-tab:hover { opacity: 0.85; }
			.zayam-how-tab.is-active {
				background: var(--zayam-accent-import);
				border-color: var(--zayam-accent-import);
				color: #fff;
			}
			.zayam-how-tab-content { margin-top: 16px; }
			.zayam-how-tab-pane { display: none; font-size: 13px; color: var(--text-muted); line-height: 1.6; }
			.zayam-how-tab-pane.is-active { display: block; animation: zayamFadeUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) both; }
			.zayam-how-tab-pane b { color: var(--text-color); }
		</style>
		<div class="zayam-page">
			<h2 class="zayam-page-title">${__('Data Migration')}</h2>
			<div class="zayam-stepper">
				<div class="zayam-stepper-step is-active" data-step="1">
					<span class="zayam-stepper-num">1</span>
					<span class="zayam-stepper-label">${__('Zwayam Data Import')}</span>
				</div>
				<div class="zayam-stepper-line"></div>
				<div class="zayam-stepper-step" data-step="2">
					<span class="zayam-stepper-num">2</span>
					<span class="zayam-stepper-label">${__('Bulk Attach Resumes')}</span>
				</div>
			</div>
			<div class="zayam-how">
				<div class="zayam-how-summary"><span class="zayam-how-arrow">▸</span> ${__('How this works')}</div>
				<div class="zayam-how-body-wrap">
				<div class="zayam-how-body">
					<div class="zayam-how-tabs">
						${HOW_STEPS.map((_, i) => `<button class="zayam-how-tab${i === 0 ? ' is-active' : ''}" data-step="${i + 1}">${__('Step')} ${i + 1}</button>`).join('')}
					</div>
					<div class="zayam-how-tab-content">
						${HOW_STEPS.map(
			(s, i) => `
								<div class="zayam-how-tab-pane${i === 0 ? ' is-active' : ''}" data-step="${i + 1}">
									<b>${s.title}</b> — ${s.text}
								</div>
							`
		).join('')}
					</div>
				</div>
				</div>
			</div>

			<div class="zayam-grid">
				<div class="zayam-panel panel-import">
					<div class="zayam-panel-header">
						<div class="zayam-panel-badge">📥</div>
						<div>
							<span class="zayam-step-number zayam-step-number-inline">${__('Step 1')}</span>
							<h3>${__('Zwayam Data Import')}</h3>
							<p>${__('Bring Zwayam Excel exports into registration records.')}</p>
						</div>
					</div>
					<div class="zayam-panel-body">
						<label class="zayam-field-label">${__('Import into')}</label>
						<div class="zayam-doctype-link zayam-doctype-link-import"></div>
						<div class="zayam-override-panel" style="display: none;">
							<div class="zayam-override-panel-title">⚙️ ${__('Set for all rows')} <span>(${__('optional')})</span></div>
							<div class="zayam-override-grid">
								${ZAYAM_OVERRIDE_FIELDS.map(
		(f) => `
										<div class="zayam-override-wrap-${f.key}" style="display: none;">
											<span class="zayam-override-label">${f.label}</span>
											<div class="zayam-doctype-link zayam-override-${f.key}"></div>
										</div>
									`
	).join('')}
							</div>
						</div>
						<p class="description">
							${__('Upload a Zwayam Excel export (.xlsx/.xls). Rows are matched to existing records by Zwayam Id — matching rows are updated, new Zwayam Ids create new records. Any value set above is force-applied to every imported row, overriding whatever is in the file for that column.')}
						</p>
						<div class="zayam-import-btn-row">
							<button class="btn btn-import">${__('Choose File & Import')}</button>
						</div>
						<div class="zayam-preview" style="display: none;"></div>
						<div class="zayam-import-results" style="display: none;"></div>
					</div>
					<div class="zayam-panel-footer">
						${__('View records:')} <a class="zayam-records-link-import" href="/app/phil-registration-form" target="_blank">${__('Phil Registration Form')}</a>
					</div>
				</div>

				<div class="zayam-panel panel-pdf" style="display: none;">
					<div class="zayam-panel-header">
						<div class="zayam-panel-badge">📎</div>
						<div>
							<span class="zayam-step-number zayam-step-number-inline">${__('Step 2')}</span>
							<h3>${__('Bulk Attach Resumes (CV)')}</h3>
							<p>${__('Match applicant PDFs to records by filename.')}</p>
						</div>
					</div>
					<div class="zayam-panel-body">
						<label class="zayam-field-label">${__('Attach into')}</label>
						<div class="zayam-doctype-link zayam-doctype-link-pdf"></div>
						<p class="description">
							${__('Select all the PDF files at once — the Zwayam Id is read from the start of each filename, e.g.')}
							<code>6213236-ClariceTPaul-Copy.pdf</code> ${__('matches Zwayam Id')} <code>6213236</code>.
							${__('Each PDF is attached to that record\'s first Attach field.')}
						</p>
						<button class="btn btn-attach-pdfs">${__('Choose PDF Files')}</button>
						<div class="zayam-pdf-preview" style="display: none;"></div>
					</div>
					<div class="zayam-panel-footer">
						${__('View records:')} <a class="zayam-records-link-pdf" href="/app/phil-registration-form" target="_blank">${__('Phil Registration Form')}</a>
					</div>
				</div>
			</div>
		</div>
	`);

	$(page.body).find('.zayam-how-tab').on('click', function () {
		const step = $(this).data('step');
		$(page.body).find('.zayam-how-tab').removeClass('is-active');
		$(this).addClass('is-active');
		$(page.body).find('.zayam-how-tab-pane').removeClass('is-active');
		$(page.body).find(`.zayam-how-tab-pane[data-step="${step}"]`).addClass('is-active');
	});

	$(page.body).find('.zayam-how-summary').on('click', function () {
		const $summary = $(this);
		const $wrap = $summary.siblings('.zayam-how-body-wrap');
		const is_open = $summary.hasClass('is-open');

		if (is_open) {
			$wrap.css('max-height', $wrap[0].scrollHeight + 'px');
			// eslint-disable-next-line no-unused-expressions
			$wrap[0].offsetHeight; // force reflow so the collapse actually animates
			$wrap.css('max-height', '0px');
			$summary.removeClass('is-open');
		} else {
			$summary.addClass('is-open');
			$wrap.css('max-height', $wrap[0].scrollHeight + 'px');
			$wrap.one('transitionend', () => {
				if ($summary.hasClass('is-open')) $wrap.css('max-height', 'none');
			});
		}
	});

	const override_controls = {};
	ZAYAM_OVERRIDE_FIELDS.forEach((f) => {
		override_controls[f.key] = make_override_picker(
			$(page.body).find(`.zayam-override-${f.key}`),
			f
		);
	});

	function update_override_visibility(doctype) {
		const $panel = $(page.body).find('.zayam-override-panel');
		if (!doctype) {
			$panel.hide();
			return;
		}
		$panel.show();
		ZAYAM_OVERRIDE_FIELDS.forEach((f) => {
			const applies = f.doctypes.includes(doctype);
			$(page.body).find(`.zayam-override-wrap-${f.key}`).toggle(applies);
			if (!applies) override_controls[f.key].set_value('');
		});
	}

	const import_doctype = make_doctype_picker($(page.body).find('.zayam-doctype-link-import'), {
		fieldname: 'zayam_import_doctype',
		default: '',
		on_change: (doctype) => {
			update_records_link(page, 'zayam-records-link-import', doctype);
			update_override_visibility(doctype);
		}
	});

	function get_overrides() {
		const doctype = import_doctype.get_value();
		const overrides = {};
		ZAYAM_OVERRIDE_FIELDS.forEach((f) => {
			if (!f.doctypes.includes(doctype)) return;
			const value = override_controls[f.key].get_value();
			if (value) overrides[f.fieldname] = value;
		});
		return overrides;
	}
	const pdf_doctype = make_doctype_picker($(page.body).find('.zayam-doctype-link-pdf'), {
		fieldname: 'zayam_pdf_doctype',
		default: '',
		on_change: (doctype) => update_records_link(page, 'zayam-records-link-pdf', doctype)
	});
	update_records_link(page, 'zayam-records-link-import', 'Phil Registration Form');
	update_records_link(page, 'zayam-records-link-pdf', 'Phil Registration Form');

	$(page.body).find('.btn-import').on('click', () => {
		const doctype = import_doctype.get_value();
		if (!doctype) {
			frappe.msgprint(__('Please choose a doctype to import into.'));
			return;
		}
		$(page.body).find('.panel-pdf').show();
		activate_step(page, 2);
		const overrides = get_overrides();
		new frappe.ui.FileUploader({
			folder: 'Home',
			restrictions: { allowed_file_types: ['.xlsx', '.xls'] },
			on_success(file_doc) {
				$(page.body).find('.zayam-import-results').hide();
				frappe.call({
					method: 'ms_calendar.api.zayam_data_import.preview_excel',
					args: { file_url: file_doc.file_url, doctype, overrides },
					freeze: true,
					freeze_message: __('Reading file...'),
					callback(r) {
						if (!r.message) return;
						show_preview(page, file_doc.file_url, doctype, overrides, {}, r.message);
					}
				});
			}
		});
	});

	$(page.body).find('.btn-attach-pdfs').on('click', () => {
		const doctype = pdf_doctype.get_value();
		if (!doctype) {
			frappe.msgprint(__('Please choose a doctype to attach into.'));
			return;
		}
		const pending = [];
		$(page.body).find('.zayam-pdf-preview').empty().hide();
		new frappe.ui.FileUploader({
			folder: 'Home',
			allow_multiple: true,
			restrictions: { allowed_file_types: ['.pdf'] },
			on_success(file_doc) {
				frappe.call({
					method: 'ms_calendar.api.zayam_data_import.preview_pdf_match',
					args: { file_url: file_doc.file_url, file_name: file_doc.file_name, doctype },
					callback(r) {
						if (!r.message) return;
						pending.push({
							file_url: file_doc.file_url,
							file_name: file_doc.file_name,
							zayam_id: r.message.zayam_id,
							name: r.message.name,
							found: r.message.found,
							status: 'pending'
						});
						show_pdf_preview(page, doctype, pending);
					}
				});
			}
		});
	});
}

function open_map_columns_dialog(all_columns, assignable_fields, on_mapped) {
	all_columns = all_columns || [];
	assignable_fields = assignable_fields || [];
	if (!all_columns.length) {
		frappe.msgprint(__('No columns found in this file.'));
		return;
	}

	const fields = all_columns.map((col) => {
		const options = [
			{ label: __('— Ignore —'), value: '' },
			...assignable_fields.map((f) => ({ label: f.label, value: f.fieldname }))
		];
		return {
			fieldtype: 'Select',
			fieldname: `col_${col.index}`,
			label: col.header,
			options,
			default: col.fieldname || '',
			description: col.sample
				? `${__('Sample data')}: "${frappe.utils.escape_html(col.sample)}"`
				: `<span class="text-muted">${__('No data found in this column')}</span>`
		};
	});

	const dialog = new frappe.ui.Dialog({
		title: __('Map Columns'),
		size: 'large',
		fields,
		primary_action_label: __('Submit'),
		primary_action(values) {
			const new_mapping = {};
			all_columns.forEach((col) => {
				const value = values[`col_${col.index}`];
				if (value) new_mapping[col.index] = value;
			});
			dialog.hide();
			on_mapped(new_mapping);
		}
	});
	dialog.$wrapper.addClass('zayam-map-columns-dialog');
	dialog.show();
}

function show_preview(page, file_url, doctype, overrides, manual_mapping, { columns, rows, total_rows, all_columns, assignable_fields }) {
	const $preview = $(page.body).find('.zayam-preview');
	const shown = rows.length;
	const override_entries = Object.entries(overrides || {});

	const header_html = columns
		.map(
			(c) => `
				<th class="${c.manual ? 'is-manual-mapping' : ''}">
					${frappe.utils.escape_html(c.header)}${c.manual ? ' <span class="zayam-manual-badge" title="' + __('Manually mapped') + '">↻</span>' : ''}
					<br><span class="zayam-preview-field">${c.fieldname}</span>
				</th>
			`
		)
		.join('');
	const rows_html = rows
		.map(
			(row, i) => `
				<tr>
					<td class="zayam-preview-sr">${i + 1}</td>
					${row.map((cell) => `<td>${cell === null || cell === undefined ? '' : frappe.utils.escape_html(String(cell))}</td>`).join('')}
				</tr>
			`
		)
		.join('');

	$preview
		.html(`
			<div class="zayam-preview-title">${__('Preview')} — ${__('showing')} ${shown} ${__('of')} ${total_rows} ${__('rows')}</div>
			${override_entries.length
				? `<div class="zayam-preview-unmatched">${__('Every row below will be set to')}: ${override_entries
					.map(([fieldname, value]) => `<b>${frappe.utils.escape_html(fieldname)} = ${frappe.utils.escape_html(value)}</b>`)
					.join(', ')}</div>`
				: ''}
			<div class="zayam-preview-table-wrap">
				<table class="zayam-preview-table">
					<thead><tr><th class="zayam-preview-sr">${__('Sr. No')}</th>${header_html}</tr></thead>
					<tbody>${rows_html}</tbody>
				</table>
			</div>
			<div class="zayam-preview-actions">
				<button class="btn btn-map-columns">${__('Map Columns')}</button>
				<button class="btn btn-preview-cancel">${__('Cancel')}</button>
				<button class="btn btn-preview-confirm">${__('Confirm Import')} (${total_rows})</button>
			</div>
		`)
		.show();

	$preview.find('.btn-preview-cancel').on('click', () => {
		$preview.empty().hide();
	});

	$preview.find('.btn-map-columns').on('click', () => {
		open_map_columns_dialog(all_columns, assignable_fields, (new_mapping) => {
			const merged = Object.assign({}, manual_mapping, new_mapping);
			frappe.call({
				method: 'ms_calendar.api.zayam_data_import.preview_excel',
				args: { file_url, doctype, overrides, manual_mapping: merged },
				freeze: true,
				freeze_message: __('Reading file...'),
				callback(r) {
					if (!r.message) return;
					show_preview(page, file_url, doctype, overrides, merged, r.message);
				}
			});
		});
	});

	$preview.find('.btn-preview-confirm').on('click', () => {
		frappe.call({
			method: 'ms_calendar.api.zayam_data_import.import_from_excel',
			args: { file_url, doctype, overrides, manual_mapping },
			freeze: true,
			freeze_message: __('Importing Zwayam data...'),
			callback(r) {
				if (!r.message) return;
				$preview.empty().hide();
				show_import_results(page, file_url, doctype, overrides, manual_mapping, r.message);
			}
		});
	});
}

function data_table_group_html(cls, icon, label, entries, columns) {
	if (!entries.length) return '';
	const show_error = entries.some((e) => e.error);
	const header_html = columns
		.map(
			(c) => `<th class="${c.manual ? 'is-manual-mapping' : ''}">${frappe.utils.escape_html(c.header)}${c.manual ? ' <span class="zayam-manual-badge" title="' + __('Manually mapped') + '">↻</span>' : ''}</th>`
		)
		.join('');
	const rows_html = entries
		.map(
			(e) => `
				<tr>
					<td>${frappe.utils.escape_html(e.zayam_id || '')}</td>
					${columns
					.map((c) => {
						const value = e.data ? e.data[c.fieldname] : null;
						return `<td class="${c.manual ? 'is-manual-mapping' : ''}">${value === null || value === undefined ? '' : frappe.utils.escape_html(String(value))}</td>`;
					})
					.join('')}
					${show_error ? `<td class="zayam-detail-error">${e.error ? frappe.utils.escape_html(e.error) : ''}</td>` : ''}
				</tr>
			`
		)
		.join('');

	return `
		<div class="zayam-detail-group">
			<div class="zayam-detail-group-title ${cls}">${icon} ${label} (${entries.length})</div>
			<div class="zayam-preview-table-wrap">
				<table class="zayam-preview-table">
					<thead><tr><th>${__('Zwayam Id')}</th>${header_html}${show_error ? `<th>${__('Error')}</th>` : ''}</tr></thead>
					<tbody>${rows_html}</tbody>
				</table>
			</div>
		</div>
	`;
}

function show_import_results(page, file_url, doctype, overrides, manual_mapping, { created, updated, skipped, failed, unmatched_columns, columns, all_columns, new_master_entries, assignable_fields }) {
	unmatched_columns = unmatched_columns || [];
	columns = columns || [];
	new_master_entries = new_master_entries || {};
	const new_master_count = Object.values(new_master_entries).reduce((sum, values) => sum + values.length, 0);

	const counts = [
		{ cls: 'is-created', label: __('Created'), value: created.length },
		{ cls: 'is-updated', label: __('Updated'), value: updated.length },
		{ cls: '', label: __('Skipped (no Zwayam Id)'), value: skipped.length },
		{ cls: 'is-failed', label: __('Failed'), value: failed.length }
	];
	if (unmatched_columns.length) {
		counts.push({ cls: 'is-unmatched', label: __('Unmatched Columns'), value: unmatched_columns.length });
	}
	if (new_master_count) {
		counts.push({ cls: 'is-unmatched', label: __('New Master Values Added'), value: new_master_count });
	}

	const new_master_html = Object.entries(new_master_entries)
		.map(([dt, values]) => simple_list_group_html('is-unmatched', '➕', `${dt} — ${__('new values')}`, values))
		.join('');

	$(page.body).find('.panel-pdf').show();
	activate_step(page, 2);

	const $results = $(page.body).find('.zayam-import-results');
	$results
		.html(
			counts
				.map(
					(row) => `
						<div class="stat-row ${row.cls}">
							<span class="stat-label">${row.label}</span>
							<span class="stat-value">${row.value}</span>
						</div>
					`
				)
				.join('') +
			data_table_group_html('is-created', '✓', __('Created'), created, columns) +
			data_table_group_html('is-updated', '↻', __('Updated'), updated, columns) +
			data_table_group_html('is-failed', '⚠', __('Failed'), failed, columns) +
			new_master_html +
			`<div class="zayam-results-actions"><button class="btn btn-map-columns-results">${__('Map Columns')}</button></div>`
		)
		.show();

	$results.find('.btn-map-columns-results').on('click', () => {
		open_map_columns_dialog(all_columns, assignable_fields, (new_mapping) => {
			const merged = Object.assign({}, manual_mapping, new_mapping);
			frappe.call({
				method: 'ms_calendar.api.zayam_data_import.import_from_excel',
				args: { file_url, doctype, overrides, manual_mapping: merged },
				freeze: true,
				freeze_message: __('Re-importing with the updated mapping...'),
				callback(r) {
					if (!r.message) return;
					show_import_results(page, file_url, doctype, overrides, merged, r.message);
				}
			});
		});
	});
}

function pdf_row_status(row) {
	if (!row.found) return { text: __('No match'), cls: 'is-failed' };
	if (row.status === 'attaching') return { text: __('Attaching…'), cls: '' };
	if (row.status === 'attached') return { text: __('Attached'), cls: 'is-attached' };
	if (row.status === 'failed') return { text: row.error ? `${__('Failed')}: ${row.error}` : __('Failed'), cls: 'is-failed' };
	return { text: __('Ready'), cls: '' };
}

function show_pdf_preview(page, doctype, pending) {
	const $preview = $(page.body).find('.zayam-pdf-preview');
	const found_count = pending.filter((r) => r.found).length;
	const not_found_count = pending.length - found_count;
	const remaining = pending.filter((r) => r.found && r.status === 'pending').length;

	const rows_html = pending
		.map((row, i) => {
			const status = pdf_row_status(row);
			if (!row.found && row.status !== 'attached') {
				return `
					<tr>
						<td>${frappe.utils.escape_html(row.file_name)}</td>
						<td>
							<input
								type="text"
								class="zayam-rematch-input"
								data-idx="${i}"
								value="${frappe.utils.escape_html(row.zayam_id || '')}"
								placeholder="${__('Correct Zwayam Id')}"
							>
						</td>
						<td>—</td>
						<td class="is-failed">
							<div class="zayam-rematch-cell">
								<span>${status.text}</span>
								<button class="btn-rematch" data-idx="${i}">${__('Re-match')}</button>
							</div>
						</td>
					</tr>
				`;
			}
			return `
				<tr>
					<td>${frappe.utils.escape_html(row.file_name)}</td>
					<td>${frappe.utils.escape_html(row.zayam_id || '')}</td>
					<td>${row.name ? frappe.utils.escape_html(row.name) : '—'}</td>
					<td class="${status.cls}">${status.text}</td>
				</tr>
			`;
		})
		.join('');

	$preview
		.html(`
			<div class="zayam-preview-title">
				${__('Preview')} — ${pending.length} ${__('file(s) selected')}, ${found_count} ${__('matched')}, ${not_found_count} ${__('not found')}
			</div>
			<div class="zayam-preview-table-wrap">
				<table class="zayam-preview-table">
					<thead><tr><th>${__('File')}</th><th>${__('Zwayam Id')}</th><th>${__('Match')}</th><th>${__('Status')}</th></tr></thead>
					<tbody>${rows_html}</tbody>
				</table>
			</div>
			<div class="zayam-preview-actions">
				<button class="btn btn-preview-cancel">${__('Cancel')}</button>
				<button class="btn btn-preview-confirm" ${remaining === 0 ? 'disabled' : ''}>${__('Attach Matched Files')} (${remaining})</button>
			</div>
		`)
		.show();

	$preview.find('.btn-preview-cancel').on('click', () => {
		$preview.empty().hide();
	});

	$preview.find('.btn-preview-confirm').on('click', () => {
		attach_pdf_queue(page, doctype, pending);
	});

	$preview.find('.btn-rematch').on('click', function () {
		const idx = $(this).data('idx');
		const new_id = $preview.find(`.zayam-rematch-input[data-idx="${idx}"]`).val().trim();
		if (!new_id) return;
		frappe.call({
			method: 'ms_calendar.api.zayam_data_import.lookup_zayam_record',
			args: { doctype, zayam_id: new_id },
			freeze: true,
			freeze_message: __('Checking...'),
			callback(r) {
				if (!r.message) return;
				pending[idx].zayam_id = r.message.zayam_id;
				pending[idx].name = r.message.name;
				pending[idx].found = r.message.found;
				pending[idx].status = 'pending';
				frappe.show_alert({
					message: r.message.found
						? __('Matched to {0}', [entry_label(r.message)])
						: __('Still no record found for Zwayam Id {0}', [new_id]),
					indicator: r.message.found ? 'green' : 'red'
				});
				show_pdf_preview(page, doctype, pending);
			}
		});
	});
}

function attach_pdf_one(doctype, row) {
	return new Promise((resolve) => {
		frappe.call({
			method: 'ms_calendar.api.zayam_data_import.attach_application_pdf',
			args: { file_url: row.file_url, file_name: row.file_name, doctype },
			callback(r) {
				resolve(r);
			}
		});
	});
}

async function attach_pdf_queue(page, doctype, pending) {
	const queue = pending.filter((row) => row.found && row.status === 'pending');
	for (const row of queue) {
		row.status = 'attaching';
		show_pdf_preview(page, doctype, pending);

		const r = await attach_pdf_one(doctype, row);
		if (r.message) {
			if (r.message.status === 'attached') {
				row.status = 'attached';
				frappe.show_alert({ message: __('{0} attached successfully', [entry_label(row)]), indicator: 'green' });
			} else {
				row.status = 'failed';
				row.error = r.message.error;
				frappe.show_alert({ message: __('Failed to attach {0}', [entry_label(row)]), indicator: 'red' });
			}
		}
		show_pdf_preview(page, doctype, pending);
	}
}
