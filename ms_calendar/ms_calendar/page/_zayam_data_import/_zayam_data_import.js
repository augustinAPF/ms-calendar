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

function doctype_options_html(selected) {
	return ZAYAM_TARGET_DOCTYPES.map(
		(opt) => `<option value="${opt.value}" ${opt.value === selected ? 'selected' : ''}>${opt.label}</option>`
	).join('');
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
			.zayam-page { max-width: 1100px; margin: 0 auto; padding: 32px 20px 56px; }
			.zayam-hero {
				border-radius: 14px;
				padding: 28px 32px;
				margin-bottom: 28px;
				background: linear-gradient(135deg, var(--zayam-accent-import) 0%, var(--zayam-accent-pdf) 100%);
				color: #fff;
				box-shadow: var(--shadow-base);
			}
			.zayam-hero h2 { color: #fff; margin: 0 0 6px; font-size: 20px; }
			.zayam-hero p { margin: 0; color: rgba(255, 255, 255, 0.88); font-size: 13px; max-width: 640px; }
			.zayam-import-wrapper {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
				gap: 24px;
				align-items: start;
			}
			.zayam-import-card {
				background: var(--card-bg);
				border: 1px solid var(--border-color);
				border-top: 4px solid var(--zayam-accent-import);
				border-radius: 12px;
				width: 100%;
				padding: 32px;
				text-align: center;
				box-shadow: var(--shadow-base);
				transition: transform 0.15s ease, box-shadow 0.15s ease;
			}
			.zayam-import-card:hover { transform: translateY(-3px); box-shadow: var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.12)); }
			.zayam-import-card.card-pdf { border-top-color: var(--zayam-accent-pdf); }
			.zayam-eyebrow {
				display: inline-block;
				font-size: 11px;
				font-weight: 700;
				letter-spacing: 0.06em;
				text-transform: uppercase;
				color: var(--zayam-accent-import);
				background: var(--zayam-accent-import-soft);
				padding: 3px 10px;
				border-radius: 20px;
				margin-bottom: 14px;
			}
			.zayam-import-card.card-pdf .zayam-eyebrow { color: var(--zayam-accent-pdf); background: var(--zayam-accent-pdf-soft); }
			.zayam-import-icon {
				width: 52px;
				height: 52px;
				margin: 0 auto 16px;
				display: flex;
				align-items: center;
				justify-content: center;
				background: var(--zayam-accent-import-soft);
				border-radius: 14px;
				font-size: 24px;
			}
			.zayam-import-card.card-pdf .zayam-import-icon { background: var(--zayam-accent-pdf-soft); }
			.zayam-import-card h3 { margin-bottom: 8px; color: var(--zayam-accent-import); font-size: 17px; }
			.zayam-import-card.card-pdf h3 { color: var(--zayam-accent-pdf); }
			.zayam-import-card .description {
				color: var(--text-muted);
				margin-bottom: 20px;
				font-size: 13px;
				line-height: 1.65;
			}
			.zayam-import-card .description code {
				background: var(--zayam-accent-import-soft);
				color: var(--zayam-accent-import);
				padding: 1px 5px;
				border-radius: 4px;
				font-size: 12px;
			}
			.zayam-import-card.card-pdf .description code {
				background: var(--zayam-accent-pdf-soft);
				color: var(--zayam-accent-pdf);
			}
			.zayam-field-label {
				display: block;
				text-align: left;
				font-size: 12px;
				font-weight: 600;
				color: var(--text-muted);
				margin: 0 auto 6px;
				max-width: 320px;
			}
			.zayam-target-doctype {
				display: block;
				width: 100%;
				max-width: 320px;
				margin: 0 auto 18px;
				padding: 8px 12px;
				border-radius: 8px;
				border: 1px solid var(--border-color);
				background: var(--control-bg);
				color: var(--text-color);
				font-size: 13px;
			}
			.zayam-import-card .btn-import,
			.zayam-import-card .btn-attach-pdfs {
				width: 100%;
				max-width: 320px;
				padding: 10px 24px;
				border: none;
				border-radius: 8px;
				color: #fff;
				font-weight: 600;
				font-size: 13px;
				letter-spacing: 0.01em;
				transition: opacity 0.15s ease;
			}
			.zayam-import-card .btn-import { background: var(--zayam-accent-import); }
			.zayam-import-card .btn-import:hover { background: var(--zayam-accent-import); opacity: 0.88; color: #fff; }
			.zayam-import-card .btn-attach-pdfs { background: var(--zayam-accent-pdf); }
			.zayam-import-card .btn-attach-pdfs:hover { background: var(--zayam-accent-pdf); opacity: 0.88; color: #fff; }
			.zayam-import-results, .zayam-pdf-progress { margin-top: 24px; text-align: left; }
			.zayam-import-results .stat-row, .zayam-pdf-progress .stat-row {
				display: flex;
				justify-content: space-between;
				padding: 8px 4px;
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
		</style>
		<div class="zayam-page">
			<div class="zayam-hero">
				<h2>${__('Zayam Data Import & Attachment Center')}</h2>
				<p>${__('Bring Zayam Excel exports and applicant PDFs into the Foundation\'s registration records — pick a doctype below, then import data or attach resumes in bulk.')}</p>
			</div>
			<div class="zayam-import-wrapper">
				<div class="zayam-import-card card-import">
					<span class="zayam-eyebrow">${__('Step 1 · Data')}</span>
					<div class="zayam-import-icon">📥</div>
					<h3>${__('Zayam Data Import')}</h3>
					<p class="description">
						${__('Upload a Zayam Excel export (.xlsx/.xls). Rows are matched to existing records of the doctype below by Zayam Id — matching rows are updated, new Zayam Ids create new records.')}
					</p>
					<label class="zayam-field-label">${__('Import into')}</label>
					<select class="zayam-target-doctype select-import-doctype">${doctype_options_html('Phil Registration Form')}</select>
					<button class="btn btn-import">${__('Choose File & Import')}</button>
					<div class="zayam-import-results" style="display: none;"></div>
				</div>

				<div class="zayam-import-card card-pdf">
					<span class="zayam-eyebrow">${__('Step 2 · Resumes')}</span>
					<div class="zayam-import-icon">📎</div>
					<h3>${__('Bulk Attach Resumes (CV)')}</h3>
					<p class="description">
						${__('Select all the PDF files at once — the Zayam Id is read from the start of each filename, e.g.')}
						<code>6213236-ClariceTPaul-Copy.pdf</code> ${__('matches Zayam Id')} <code>6213236</code>.
						${__('Each PDF is attached as the resume field on that record.')}
					</p>
					<label class="zayam-field-label">${__('Attach into')}</label>
					<select class="zayam-target-doctype select-pdf-doctype">${doctype_options_html('Phil Registration Form')}</select>
					<button class="btn btn-attach-pdfs">${__('Choose PDF Files')}</button>
					<div class="zayam-pdf-progress" style="display: none;"></div>
				</div>
			</div>
		</div>
	`);

	$(page.body).find('.btn-import').on('click', () => {
		const doctype = $(page.body).find('.select-import-doctype').val();
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
		const doctype = $(page.body).find('.select-pdf-doctype').val();
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
