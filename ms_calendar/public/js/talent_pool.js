// Talent Pool — the same on every unit's registration form:
// Field, Philanthropy, Health, Scholarship, Enablers (+ Finance Fellowship).
//
//   Form: "Move to Talent Pool" button (any stage), or — while the status is
//         "Talent Pool" — "Resume from Talent Pool", plus a line at the top
//         with the date it was moved, by whom, the status before and past
//         stays in the pool.
//   List: Actions ▾ → "Move to Talent Pool" / "Resume from Talent Pool" for
//         the ticked applications.
//
// Server side: ms_calendar.api.talent_pool (changes the status, writes the
// Talent Pool Log, sends the candidate email). Loaded desk-wide through
// app_include_js — the unit forms are Custom DocTypes, which never load
// doctype_js. var/function only, safe to load twice.
(function () {
    if (window.ms_talent_pool) return;

    var TP_DOCTYPES = [
        'Field Registration Form',
        'Phil Registration Form',
        'Health Registration Form',
        'Scholarship Recruitment Form',
        'Enablers Registration Form',
    ];
    var TP = 'Talent Pool';
    var BEFORE = '__before__';
    var BEFORE_LABEL = __('Status before Talent Pool');
    var API = 'ms_calendar.api.talent_pool.';

    function statusOptions(doctype) {
        var df = frappe.meta.get_docfield(doctype, 'application_status');
        return ((df && df.options) || '').split('\n')
            .map(function (s) { return s.trim(); })
            .filter(function (s) { return s && s !== TP; });
    }

    function fmtDate(v) {
        return v ? frappe.datetime.str_to_user(String(v).slice(0, 10)) : '';
    }

    function esc(v) {
        return frappe.utils.escape_html(v == null ? '' : String(v));
    }

    // ── result popup ───────────────────────────────────────────────────
    function showResult(res, doneLabel) {
        if (!res) return;
        if (res.queued) {
            frappe.msgprint({
                title: __('Talent Pool'),
                indicator: 'blue',
                message: __('{0} applications are being updated in the background. You will get a message here when it is done.', [res.count]),
            });
            return;
        }
        var html = '<p><b>' + res.done.length + '</b> ' + esc(doneLabel) + '.</p>';
        [['skipped', __('Skipped')], ['failed', __('Failed')]].forEach(function (k) {
            var rows = res[k[0]] || [];
            if (!rows.length) return;
            html += '<p style="margin-top:10px">' + k[1] + ' (' + rows.length + '):</p><ul>';
            rows.slice(0, 100).forEach(function (r) {
                html += '<li><b>' + esc(r.name) + '</b>: ' + esc(r.reason || r.error) + '</li>';
            });
            html += '</ul>';
        });
        var bad = (res.failed || []).length;
        if (!bad && !(res.skipped || []).length) {
            frappe.show_alert({ message: res.done.length + ' ' + doneLabel, indicator: 'green' });
        } else {
            frappe.msgprint({ title: __('Talent Pool'), indicator: bad ? 'red' : 'orange', message: html });
        }
    }

    // ── Move ───────────────────────────────────────────────────────────
    function moveDialog(doctype, names, done) {
        if (!names || !names.length) {
            frappe.msgprint(__('Please tick at least one application.'));
            return;
        }
        var d = new frappe.ui.Dialog({
            title: names.length === 1 ? __('Move to Talent Pool')
                : __('Move {0} applications to Talent Pool', [names.length]),
            fields: [
                {
                    fieldtype: 'HTML',
                    options: '<p class="text-muted small" style="margin-bottom:4px">'
                        + __('The Application Status becomes "Talent Pool" and today is recorded as the date it was moved. '
                        + 'Days spent in the Talent Pool are left out of the Cycle Time report.') + '</p>',
                },
                { fieldname: 'remarks', fieldtype: 'Small Text', label: __('Remarks (optional)') },
                {
                    fieldname: 'send_email', fieldtype: 'Check', default: 1,
                    label: __('Send the Talent Pool email to the candidate'),
                    description: __('Subject: "Update on Your Application – Future Opportunities – <Job Title>", from Pathways. '
                        + 'Text: Email Template "Talent Pool - Candidate".'),
                },
            ],
            primary_action_label: __('Move to Talent Pool'),
            primary_action: function (v) {
                d.hide();
                frappe.call({
                    method: API + 'move_to_talent_pool',
                    args: { doctype: doctype, names: names, remarks: v.remarks || '', send_email: v.send_email ? 1 : 0 },
                    freeze: true,
                    freeze_message: __('Moving to Talent Pool…'),
                    callback: function (r) {
                        showResult(r.message, __('moved to Talent Pool'));
                        if (done) done();
                    },
                });
            },
        });
        d.show();
    }

    // ── Resume ─────────────────────────────────────────────────────────
    // `before` = the status this one application had before the pool
    // (form only); for several applications each goes back to its own.
    function resumeDialog(doctype, names, done, before) {
        if (!names || !names.length) {
            frappe.msgprint(__('Please tick at least one application.'));
            return;
        }
        var opts = statusOptions(doctype);
        var single = names.length === 1;
        var choices = [BEFORE_LABEL].concat(opts);
        var d = new frappe.ui.Dialog({
            title: single ? __('Resume from Talent Pool')
                : __('Resume {0} applications from Talent Pool', [names.length]),
            fields: [
                {
                    fieldtype: 'HTML',
                    options: '<p class="text-muted small" style="margin-bottom:4px">'
                        + __('Processing continues from the status you choose. Today becomes the start date for the next stage in the Cycle Time report.')
                        + (single && before ? '<br>' + __('Status before Talent Pool: <b>{0}</b>', [esc(before)]) : '')
                        + '</p>',
                },
                {
                    fieldname: 'resume_status', fieldtype: 'Select', reqd: 1,
                    label: __('Resume to status'),
                    options: choices.join('\n'),
                    default: (single && before && opts.indexOf(before) !== -1) ? before : BEFORE_LABEL,
                    description: single ? '' : __('"Status before Talent Pool" puts each application back to its own earlier status.'),
                },
                { fieldname: 'remarks', fieldtype: 'Small Text', label: __('Remarks (optional)') },
            ],
            primary_action_label: __('Resume'),
            primary_action: function (v) {
                d.hide();
                frappe.call({
                    method: API + 'resume_from_talent_pool',
                    args: {
                        doctype: doctype, names: names, remarks: v.remarks || '',
                        resume_status: v.resume_status === BEFORE_LABEL ? BEFORE : v.resume_status,
                    },
                    freeze: true,
                    freeze_message: __('Resuming…'),
                    callback: function (r) {
                        showResult(r.message, __('resumed from Talent Pool'));
                        if (done) done();
                    },
                });
            },
        });
        d.show();
    }

    // ── Records popup ──────────────────────────────────────────────────
    // Every Talent Pool stay of one application (the open one first), with
    // who moved / resumed it and the email result. Data comes from
    // get_talent_pool_info, so it works for anyone who can read the form,
    // even without read access to the Talent Pool Log DocType itself.
    function userName(u) {
        if (!u) return '';
        // user_info, not frappe.user.full_name, which shows "You" for oneself.
        var info = frappe.user_info ? frappe.user_info(u) : null;
        return (info && info.fullname) || u;
    }

    function recordsDialog(frm, logs) {
        var head = [__('Log'), __('Status'), __('Moved on'), __('Moved by'), __('Status before'),
            __('Remarks'), __('Email'), __('Resumed on'), __('Resumed by'), __('Resumed to'), __('Days')];
        var rows = logs.map(function (l) {
            var open = l.status === 'In Talent Pool';
            var days = open ? (l.days_so_far || 0) + ' ' + __('(so far)') : (l.days_in_pool || 0);
            var email = l.email_sent_on ? __('Sent {0}', [fmtDate(l.email_sent_on)])
                : (l.email_note || __('Not sent'));
            var pill = '<span class="indicator-pill ' + (open ? 'blue' : 'green') + '">'
                + esc(open ? __('In Talent Pool') : __('Resumed')) + '</span>';
            return '<tr>'
                + '<td><a href="/app/talent-pool-log/' + encodeURIComponent(l.name) + '" class="tp-log-link" data-name="'
                + esc(l.name) + '">' + esc(l.name) + '</a></td>'
                + '<td>' + pill + '</td>'
                + '<td>' + esc(fmtDate(l.moved_on)) + '</td>'
                + '<td>' + esc(userName(l.moved_by)) + '</td>'
                + '<td>' + esc(l.status_before || '—') + '</td>'
                + '<td>' + esc(l.remarks || '') + '</td>'
                + '<td>' + esc(email) + '</td>'
                + '<td>' + esc(fmtDate(l.resumed_on) || '—') + '</td>'
                + '<td>' + esc(userName(l.resumed_by)) + '</td>'
                + '<td>' + esc(l.resumed_to_status || '—') + '</td>'
                + '<td style="text-align:right">' + esc(days) + '</td>'
                + '</tr>';
        }).join('');
        var total = logs.reduce(function (s, l) {
            return s + (l.status === 'In Talent Pool' ? (l.days_so_far || 0) : (l.days_in_pool || 0));
        }, 0);

        var html = '<p class="text-muted small" style="margin-bottom:8px">'
            + __('{0} stay(s) in the Talent Pool, {1} day(s) in total. These days are left out of the Cycle Time report.',
                [logs.length, total]) + '</p>'
            + '<div style="overflow-x:auto"><table class="table table-bordered table-sm" style="font-size:12px;margin:0">'
            + '<thead><tr>' + head.map(function (h) { return '<th style="white-space:nowrap">' + esc(h) + '</th>'; }).join('')
            + '</tr></thead><tbody>' + rows + '</tbody></table></div>';

        var canLog = frappe.model.can_read('Talent Pool Log');
        var d = new frappe.ui.Dialog({
            title: __('Talent Pool Records – {0}', [frm.doc.name]),
            size: 'extra-large',
            fields: [{ fieldtype: 'HTML', fieldname: 'body', options: html }],
            primary_action_label: canLog ? __('Open in Talent Pool Log list') : __('Close'),
            primary_action: function () {
                d.hide();
                if (canLog) {
                    frappe.set_route('List', 'Talent Pool Log', {
                        reference_doctype: frm.doctype,
                        reference_name: frm.doc.name,
                    });
                }
            },
        });
        // Log IDs open in the desk (no full page reload); only when the
        // user may read the Talent Pool Log, otherwise plain text.
        d.$wrapper.on('click', '.tp-log-link', function (e) {
            e.preventDefault();
            if (!canLog) return;
            d.hide();
            frappe.set_route('Form', 'Talent Pool Log', $(this).attr('data-name'));
        });
        d.$wrapper.find('.tp-log-link').css(canLog
            ? { textDecoration: 'underline' }
            : { color: 'inherit', cursor: 'default' });
        d.show();
    }

    // ── Form ───────────────────────────────────────────────────────────
    function formSetup(frm) {
        if (frm.is_new() || !frm.fields_dict.application_status) return;
        var inPool = frm.doc.application_status === TP;
        frm._tp_before = null;

        if (frm.perm && frm.perm[0] && frm.perm[0].write) {
            if (inPool) {
                frm.add_custom_button(__('Resume from Talent Pool'), function () {
                    resumeDialog(frm.doctype, [frm.doc.name], function () { frm.reload_doc(); }, frm._tp_before);
                });
            } else {
                frm.add_custom_button(__('Move to Talent Pool'), function () {
                    if (frm.is_dirty()) {
                        frappe.msgprint(__('Please save the form first.'));
                        return;
                    }
                    moveDialog(frm.doctype, [frm.doc.name], function () { frm.reload_doc(); });
                });
            }
        }

        var docname = frm.doc.name;
        frappe.call({
            method: API + 'get_talent_pool_info',
            args: { doctype: frm.doctype, name: docname },
            callback: function (r) {
                var info = r.message;
                if (!info || frm.doc.name !== docname) return;
                var o = info.open;
                if (o) frm._tp_before = o.status_before || null;

                // "Talent Pool Records (N)" button whenever the application
                // has ever been in the pool (open stay first, then past ones).
                var logs = (o ? [o] : []).concat(info.history || []);
                if (logs.length) {
                    frm.add_custom_button(__('Talent Pool Records ({0})', [logs.length]), function () {
                        recordsDialog(frm, logs);
                    });
                    frm.$wrapper.off('click.tp_records').on('click.tp_records', '.tp-view-records', function (e) {
                        e.preventDefault();
                        recordsDialog(frm, logs);
                    });
                }

                var html = '';
                if (o && inPool) {
                    html = __('In Talent Pool since <b>{0}</b> ({1} day(s)), moved by {2}. Status before: <b>{3}</b>.', [
                        fmtDate(o.moved_on), o.days_so_far, esc(o.moved_by_name || o.moved_by), esc(o.status_before || '—'),
                    ]);
                    if (o.remarks) html += ' ' + __('Remarks: {0}', [esc(o.remarks)]);
                    html += ' ' + (o.email_sent_on
                        ? __('Talent Pool email sent on {0}.', [fmtDate(o.email_sent_on)])
                        : esc(o.email_note || __('Talent Pool email not sent.')));
                }
                if (info.history && info.history.length) {
                    var past = info.history.map(function (h) {
                        return fmtDate(h.moved_on) + ' → ' + fmtDate(h.resumed_on) + ' (' + (h.days_in_pool || 0) + 'd)';
                    }).join(', ');
                    html += (html ? '<br>' : '') + __('Earlier in Talent Pool: {0} — {1} day(s) in total, left out of cycle time.', [past, info.total_days]);
                }
                if (html) html += ' <a href="#" class="tp-view-records" style="font-weight:600">' + __('View records') + '</a>';
                if (html && frm.dashboard) frm.dashboard.add_comment(html, inPool ? 'blue' : 'gray', false);
            },
        });
    }

    TP_DOCTYPES.forEach(function (dt) {
        frappe.ui.form.on(dt, { refresh: formSetup });
    });

    // ── List: Actions ▾ menu ───────────────────────────────────────────
    // Added on the ListView class itself, so it works whatever list
    // settings / List Client Scripts each unit already has.
    var LV = frappe.views && frappe.views.ListView;
    if (LV && !LV.prototype._tp_patched) {
        LV.prototype._tp_patched = true;
        var orig = LV.prototype.get_actions_menu_items;
        LV.prototype.get_actions_menu_items = function () {
            var items = orig.apply(this, arguments) || [];
            var lv = this;
            if (TP_DOCTYPES.indexOf(lv.doctype) === -1 || !frappe.model.can_write(lv.doctype)) return items;
            var after = function () {
                lv.clear_checked_items();
                lv.refresh();
            };
            items.push({
                label: __('Move to Talent Pool'),
                action: function () { moveDialog(lv.doctype, lv.get_checked_items(true), after); },
                standard: false,
            });
            items.push({
                label: __('Resume from Talent Pool'),
                action: function () { resumeDialog(lv.doctype, lv.get_checked_items(true), after); },
                standard: false,
            });
            return items;
        };
    }

    window.ms_talent_pool = { move: moveDialog, resume: resumeDialog, doctypes: TP_DOCTYPES };
})();
