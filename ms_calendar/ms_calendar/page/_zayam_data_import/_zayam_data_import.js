const ZAYAM_TARGET_DOCTYPES = [
	{ value: 'Phil Registration Form', label: __('Phil Registration Form') },
	{ value: 'Field Registration Form', label: __('Field Registration Form') }
];

frappe.pages['-zayam-data-import'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Zayam Data Import',
		single_column: true
	});

	render_import_card(page);
};

function doctype_toggle_html(toggle_class, selected) {
	const buttons = ZAYAM_TARGET_DOCTYPES.map(
		(opt) => `
			<button
				type="button"
				class="zayam-toggle-btn ${opt.value === selected ? 'active' : ''}"
				data-value="${opt.value}"
			>${opt.label}</button>
		`
	).join('');
	return `<div class="zayam-toggle ${toggle_class}" data-selected="${selected}">${buttons}</div>`;
}

function wire_toggle(page, toggle_class, on_change) {
	$(page.body)
		.find(`.${toggle_class} .zayam-toggle-btn`)
		.on('click', function () {
			const $btn = $(this);
			const $toggle = $btn.closest('.zayam-toggle');
			$toggle.find('.zayam-toggle-btn').removeClass('active');
			$btn.addClass('active');
			$toggle.attr('data-selected', $btn.data('value'));
			if (on_change) on_change($btn.data('value'));
		});
}

function selected_doctype(page, toggle_class) {
	return $(page.body).find(`.${toggle_class}`).attr('data-selected');
}

function update_records_link(page, link_class, doctype) {
	const route = frappe.router.slug(doctype);
	$(page.body).find(`.${link_class}`).attr('href', `/app/${route}`).text(doctype);
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
			.zayam-page { max-width: 1100px; margin: 0 auto; padding: 40px 20px 56px; }
			.zayam-grid {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
				gap: 24px;
				align-items: start;
			}
			.zayam-panel {
				background: var(--card-bg);
				border: 1px solid var(--border-color);
				border-top: 3px solid var(--zayam-accent-import);
				border-radius: 14px;
				box-shadow: var(--shadow-base);
				overflow: hidden;
				animation: zayamFadeUp 0.35s ease both;
				transition: transform 0.15s ease, box-shadow 0.15s ease;
			}
			.zayam-grid .zayam-panel:nth-child(2) { animation-delay: 0.08s; }
			.zayam-panel:hover { transform: translateY(-2px); box-shadow: var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.12)); }
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
			.zayam-panel-body { padding: 24px 28px 28px; }
			.zayam-field-label {
				display: block;
				font-size: 12px;
				font-weight: 600;
				color: var(--text-muted);
				margin-bottom: 6px;
			}
			.zayam-panel-body .description {
				color: var(--text-muted);
				margin-bottom: 20px;
				font-size: 13px;
				line-height: 1.65;
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
			.zayam-toggle {
				display: flex;
				margin: 0 0 20px;
				background: var(--subtle-fg, rgba(128, 128, 128, 0.08));
				border-radius: 8px;
				padding: 3px;
				gap: 3px;
			}
			.zayam-toggle-btn {
				flex: 1;
				border: none;
				background: transparent;
				color: var(--text-muted);
				font-size: 12px;
				font-weight: 600;
				padding: 7px 10px;
				border-radius: 6px;
				cursor: pointer;
				transition: background 0.15s ease, color 0.15s ease;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}
			.zayam-toggle-btn:focus-visible { outline: 2px solid var(--zayam-accent-import); outline-offset: 1px; }
			.panel-import .zayam-toggle-btn.active { background: var(--zayam-accent-import); color: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.12); }
			.panel-pdf .zayam-toggle-btn.active { background: var(--zayam-accent-pdf); color: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.12); }
			.zayam-panel-body .btn-import,
			.zayam-panel-body .btn-attach-pdfs {
				width: 100%;
				padding: 10px 24px;
				border: none;
				border-radius: 8px;
				color: #fff;
				font-weight: 600;
				font-size: 13px;
				letter-spacing: 0.01em;
				box-shadow: 0 1px 2px rgba(0,0,0,0.08);
				transition: opacity 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease;
			}
			.zayam-panel-body .btn-import:hover,
			.zayam-panel-body .btn-attach-pdfs:hover {
				opacity: 0.9;
				color: #fff;
				box-shadow: 0 2px 6px rgba(0,0,0,0.14);
			}
			.zayam-panel-body .btn-import:active,
			.zayam-panel-body .btn-attach-pdfs:active { transform: translateY(1px); }
			.zayam-panel-body .btn-import { background: var(--zayam-accent-import); }
			.zayam-panel-body .btn-attach-pdfs { background: var(--zayam-accent-pdf); }
			.zayam-import-results, .zayam-pdf-progress { margin-top: 22px; text-align: left; }
			.zayam-import-results .stat-row, .zayam-pdf-progress .stat-row {
				display: flex;
				justify-content: space-between;
				padding: 8px 2px;
				border-bottom: 1px solid var(--border-color);
				font-size: 13px;
			}
			.zayam-import-results .stat-row:last-child, .zayam-pdf-progress .stat-row:last-child { border-bottom: none; }
			.zayam-import-results .stat-row.is-failed .stat-value,
			.zayam-pdf-progress .stat-row.is-failed .stat-value { color: var(--red-500); }
			.zayam-import-results .stat-row.is-created .stat-value,
			.zayam-import-results .stat-row.is-updated .stat-value,
			.zayam-pdf-progress .stat-row.is-attached .stat-value { color: var(--green-500); }
			.zayam-import-results .stat-label, .zayam-pdf-progress .stat-label { color: var(--text-muted); }
			.zayam-import-results .stat-value, .zayam-pdf-progress .stat-value { font-weight: 700; }
			.zayam-import-results .failed-ids, .zayam-pdf-progress .not-found-ids {
				margin-top: 12px;
				font-size: 12px;
				color: var(--text-muted);
				word-break: break-word;
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
		</style>
		<div class="zayam-page">
			<div class="zayam-grid">
				<div class="zayam-panel panel-import">
					<div class="zayam-panel-header">
						<div class="zayam-panel-badge">📥</div>
						<div>
							<h3>${__('Zayam Data Import')}</h3>
							<p>${__('Bring Zayam Excel exports into registration records.')}</p>
						</div>
					</div>
					<div class="zayam-panel-body">
						<label class="zayam-field-label">${__('Import into')}</label>
						${doctype_toggle_html('toggle-import-doctype', 'Phil Registration Form')}
						<p class="description">
							${__('Upload a Zayam Excel export (.xlsx/.xls). Rows are matched to existing records by Zayam Id — matching rows are updated, new Zayam Ids create new records.')}
						</p>
						<button class="btn btn-import">${__('Choose File & Import')}</button>
						<div class="zayam-import-results" style="display: none;"></div>
					</div>
					<div class="zayam-panel-footer">
						${__('View records:')} <a class="zayam-records-link-import" href="/app/phil-registration-form" target="_blank">${__('Phil Registration Form')}</a>
					</div>
				</div>

				<div class="zayam-panel panel-pdf">
					<div class="zayam-panel-header">
						<div class="zayam-panel-badge">📎</div>
						<div>
							<h3>${__('Bulk Attach Resumes (CV)')}</h3>
							<p>${__('Match applicant PDFs to records by filename.')}</p>
						</div>
					</div>
					<div class="zayam-panel-body">
						<label class="zayam-field-label">${__('Attach into')}</label>
						${doctype_toggle_html('toggle-pdf-doctype', 'Phil Registration Form')}
						<p class="description">
							${__('Select all the PDF files at once — the Zayam Id is read from the start of each filename, e.g.')}
							<code>6213236-ClariceTPaul-Copy.pdf</code> ${__('matches Zayam Id')} <code>6213236</code>.
							${__('Each PDF is attached as the resume field on that record.')}
						</p>
						<button class="btn btn-attach-pdfs">${__('Choose PDF Files')}</button>
						<div class="zayam-pdf-progress" style="display: none;"></div>
					</div>
					<div class="zayam-panel-footer">
						${__('View records:')} <a class="zayam-records-link-pdf" href="/app/phil-registration-form" target="_blank">${__('Phil Registration Form')}</a>
					</div>
				</div>
			</div>
		</div>
	`);

	wire_toggle(page, 'toggle-import-doctype', (doctype) => update_records_link(page, 'zayam-records-link-import', doctype));
	wire_toggle(page, 'toggle-pdf-doctype', (doctype) => update_records_link(page, 'zayam-records-link-pdf', doctype));
	update_records_link(page, 'zayam-records-link-import', 'Phil Registration Form');
	update_records_link(page, 'zayam-records-link-pdf', 'Phil Registration Form');

	$(page.body).find('.btn-import').on('click', () => {
		const doctype = selected_doctype(page, 'toggle-import-doctype');
		new frappe.ui.FileUploader({
			folder: 'Home',
			restrictions: { allowed_file_types: ['.xlsx', '.xls'] },
			on_success(file_doc) {
				frappe.call({
					method: 'ms_calendar.api.zayam_data_import.import_from_excel',
					args: { file_url: file_doc.file_url, doctype },
					freeze: true,
					freeze_message: __('Importing Zayam data...'),
					callback(r) {
						if (!r.message) return;
						show_import_results(page, r.message);
					}
				});
			}
		});
	});

	$(page.body).find('.btn-attach-pdfs').on('click', () => {
		const doctype = selected_doctype(page, 'toggle-pdf-doctype');
		const tally = { attached: 0, not_found: 0, not_found_ids: [] };
		new frappe.ui.FileUploader({
			folder: 'Home',
			allow_multiple: true,
			restrictions: { allowed_file_types: ['.pdf'] },
			on_success(file_doc) {
				frappe.call({
					method: 'ms_calendar.api.zayam_data_import.attach_application_pdf',
					args: { file_url: file_doc.file_url, file_name: file_doc.file_name, doctype },
					callback(r) {
						if (!r.message) return;
						if (r.message.status === 'attached') {
							tally.attached += 1;
							frappe.show_alert({
								message: __('{0} attached successfully', [r.message.zayam_id]),
								indicator: 'green'
							});
						} else {
							tally.not_found += 1;
							tally.not_found_ids.push(r.message.zayam_id);
							frappe.show_alert({
								message: __('No record found for Zayam Id {0}', [r.message.zayam_id]),
								indicator: 'red'
							});
						}
						show_pdf_progress(page, tally);
					}
				});
			}
		});
	});
}

function show_import_results(page, { created, updated, skipped, failed }) {
	const rows = [
		{ cls: 'is-created', label: __('Created'), value: created.length },
		{ cls: 'is-updated', label: __('Updated'), value: updated.length },
		{ cls: '', label: __('Skipped (no Zayam Id)'), value: skipped.length },
		{ cls: 'is-failed', label: __('Failed'), value: failed.length }
	];

	const $results = $(page.body).find('.zayam-import-results');
	$results
		.html(
			rows
				.map(
					(row) => `
						<div class="stat-row ${row.cls}">
							<span class="stat-label">${row.label}</span>
							<span class="stat-value">${row.value}</span>
						</div>
					`
				)
				.join('') +
			(failed.length
				? `<div class="failed-ids">${__('Failed Zayam Ids')}: ${frappe.utils.escape_html(failed.join(', '))}</div>`
				: '')
		)
		.show();
}

function show_pdf_progress(page, { attached, not_found, not_found_ids }) {
	const rows = [
		{ cls: 'is-attached', label: __('Attached'), value: attached },
		{ cls: 'is-failed', label: __('No matching Zayam Id'), value: not_found }
	];

	const $progress = $(page.body).find('.zayam-pdf-progress');
	$progress
		.html(
			rows
				.map(
					(row) => `
						<div class="stat-row ${row.cls}">
							<span class="stat-label">${row.label}</span>
							<span class="stat-value">${row.value}</span>
						</div>
					`
				)
				.join('') +
			(not_found_ids.length
				? `<div class="not-found-ids">${__('Unmatched filenames')}: ${frappe.utils.escape_html(not_found_ids.join(', '))}</div>`
				: '')
		)
		.show();
}
