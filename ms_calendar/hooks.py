# app_name = "ms_calendar"
# app_title = "Ms Calendar"
# app_publisher = "Augustin Moses"
# app_description = "A custom calendar app for managing events and schedules."
# app_email = "tech4socialsector@azimpremjifoundation.org"
# app_license = "mit"

# # Apps
# # ------------------


# doc_events = {
#     "Field Offline Result": {"after_insert": "ms_calendar.events.after_insert"},
#     # FIX: "Field Registration Form" used to appear as TWO separate keys in
#     # this dict (once here, once further down next to the "Field
#     # Registration Form1" note). A Python dict literal keeps only the LAST
#     # occurrence of a duplicate key — so the second definition (just the
#     # OTP validate hook) was silently discarding this ENTIRE first one,
#     # meaning send_registration_form_after_insert/on_update (SMS),
#     # resume_rename.on_field_registration, and
#     # check_registration_duplicate_on_save have not been firing on this
#     # doctype at all. Merged into one entry so all of them actually run.
#     "Field Registration Form": {
#         "after_insert": "ms_calendar.ms_calendar.sms_utils.send_registration_form_after_insert",
#         "on_update": [
#             "ms_calendar.ms_calendar.sms_utils.send_registration_form_on_update",
#             "ms_calendar.api.applicant_master_sync.sync_field_registration_to_applicant_master",
#         ],
#         "validate": [
#             "ms_calendar.api.resume_rename.on_field_registration",
#             "ms_calendar.api.ms_field.check_registration_duplicate_on_save",
#             "ms_calendar.api.otp.enforce_otp_verification",
#         ],
#     },
#     "File": {
#         "after_insert": "ms_calendar.api.ms_field.auto_match_resume_on_file_upload"
#     },
#     "Phil Registration Form": {
#         "validate": [
#             "ms_calendar.api.resume_rename.on_phil_registration",
#             "ms_calendar.api.ms_field.check_registration_duplicate_on_save",
#         ],
#         "on_update": "ms_calendar.api.applicant_master_sync.sync_phil_registration_to_applicant_master",
#     },
#     # NOTE: this site's live doctype is "Field Registration Form" (no "1") —
#     # this "1" variant is a mismatch left over from local vs. cloud naming
#     # and doesn't fire on this site at all. Left as-is (not this site's
#     # active doctype) rather than merged into the entry above.
#     "Field Registration Form1": {
#         "validate": [
#             "ms_calendar.api.resume_rename.on_field_registration",
#             "ms_calendar.api.ms_field.check_registration_duplicate_on_save",
#         ]
#     },
#     "Health Registration Form": {
#         "validate": [
#             "ms_calendar.api.resume_rename.on_health_registration",
#             "ms_calendar.api.ms_field.check_registration_duplicate_on_save",
#         ],
#         "on_update": "ms_calendar.api.applicant_master_sync.sync_health_registration_to_applicant_master",
#     },
#     "Health Document Collection": {
#         "on_update": "ms_calendar.api.resume_rename.on_health_document_collection"
#     },
#     "Scholarship Recruitment Form": {
#         "validate": "ms_calendar.api.resume_rename.on_scholarship_registration",
#         "on_update": "ms_calendar.api.applicant_master_sync.sync_scholarship_registration_to_applicant_master",
#     },
#     "Leader Final Round Feedback Form": {
#         "after_insert": [
#             "ms_calendar.api.ms_field.send_leader_final_round_feedback_pdf",
#             "ms_calendar.api.ms_field.send_leader_final_round_feedback_pdf_to_registration_form",
#         ]
#     },
#     "Recruiter Feedback Form": {
#         "after_insert": "ms_calendar.api.ms_field.send_recruiter_feedback_pdf_to_registration_form"
#     },
#     "Educational Capacity Interview - Feedback Form": {
#         "after_insert": "ms_calendar.api.ms_field.send_educational_capacity_feedback_pdf_to_registration_form"
#     },
#     "School Teacher Feedback Form": {
#         "after_insert": "ms_calendar.api.ms_field.send_school_teacher_feedback_pdf_to_registration_form"
#     },
#     "Demo Lesson Observation Feedback Form": {
#         "after_insert": "ms_calendar.api.ms_field.send_demo_lesson_observation_feedback_pdf_to_registration_form"
#     },
#     "Feedback Form - Associate Resource Person": {
#         "after_insert": "ms_calendar.api.ms_field.send_arp_feedback_pdf_to_registration_form"
#     },
#     "Recruiter Assessment Form": {
#         "after_insert": "ms_calendar.api.ms_field.send_recruiter_assessment_pdf_to_registration_form"
#     },
#     "Functional Round Feedback Form": {
#         "after_insert": "ms_calendar.api.ms_field.send_functional_round_feedback_pdf_to_registration_form"
#     },
#     "Final Round Feedback Form": {
#         "after_insert": "ms_calendar.api.ms_field.send_final_round_feedback_pdf_to_registration_form"
#     },
#     "Philanthrophy Feedback Form": {
#         "after_insert": "ms_calendar.api.feedback_merge.on_feedback_submitted"
#     },
# }

# # Runs on every outgoing email site-wide -- only acts on ones carrying the
# # X-Feedback-References marker set by feedback_merge.py, see that hook's
# # docstring for why this is needed instead of a plain doc_events entry.
# make_email_body_message = ["ms_calendar.api.feedback_merge.promote_references_header"]

# # Client Script records that must exist on any site running this app
# # (the four Registration Forms are custom doctypes, so their client-side
# # duplicate-check script lives as data, not a file — export/import via fixtures).
# fixtures = [
#     {
#         "dt": "Client Script",
#         "filters": [
#             [
#                 "name",
#                 "in",
#                 [
#                     "Field Registration Form Duplicate Check",
#                     "Field Registration Form1 Duplicate Check",
#                     "Health Registration Form Duplicate Check",
#                     "Phil Registration Form Duplicate Check",
#                     "Connections change",
#                 ],
#             ]
#         ],
#     },
#     # MeritTrac result doctypes were created as Custom DocTypes directly on
#     # ms.local's DB (no JSON/module file), so any other site running this
#     # app needs them shipped as a fixture too, or merit_trac.py's
#     # test_result_api() fails with a DocType import error on insert.
#     #
#     # Department and Location are the same situation: also created as
#     # Custom DocTypes directly on ms.local's DB, and used as Link targets
#     # on Applicant Master's "department"/"location" fields. Without this
#     # fixture, any other site (e.g. production) shows "Missing DocType —
#     # Field department is referring to non-existing doctype Department."
#     {
#         "dt": "DocType",
#         "filters": [
#             [
#                 "name",
#                 "in",
#                 [
#                     "MeritTrac Test Result",
#                     "Field MeritTrac Test Result",
#                     "Department",
#                     "Location",
#                 ],
#             ]
#         ],
#     },
#     # Actual Department/Location records (Applicant Master's Link fields
#     # need the rows to exist too, not just the DocType definition).
#     {"dt": "Department"},
#     {"dt": "Location"},
# ]

# # required_apps = []

# # Each item in the list will be shown as an app in the apps page
# # add_to_apps_screen = [
# # 	{
# # 		"name": "ms_calendar",
# # 		"logo": "/assets/ms_calendar/logo.png",
# # 		"title": "Ms Calendar",
# # 		"route": "/ms_calendar",
# # 		"has_permission": "ms_calendar.api.permission.has_app_permission"
# # 	}
# # ]

# # Includes in <head>
# # ------------------

# # include js, css files in header of desk.html
# # app_include_css = "/assets/ms_calendar/css/ms_calendar.css"
# # app_include_js = "/assets/ms_calendar/js/ms_calendar.js"

# # include js, css files in header of web template
# # web_include_css = "/assets/ms_calendar/css/ms_calendar.css"
# # web_include_js = "/assets/ms_calendar/js/ms_calendar.js"

# # include custom scss in every website theme (without file extension ".scss")
# # website_theme_scss = "ms_calendar/public/scss/website"

# # include js, css files in header of web form
# # webform_include_js = {"doctype": "public/js/doctype.js"}
# # webform_include_css = {"doctype": "public/css/doctype.css"}

# # include js in page
# # page_js = {"page" : "public/js/file.js"}

# # include js in doctype views
# doctype_js = {
#     "Job Opening": "public/js/job_opening.js",
#     "Health Document Collection": "public/js/health_document_collection.js",
#     "Philanthropy Interview Schedule": "public/js/philanthropy_interview_schedule.js",
# }
# doctype_list_js = {
#     "Field Registration Form": "public/js/frf_list.js",
#     "Phil Registration Form": "public/js/phil_registration_form_list.js",
# }
# app_include_js = [
#     "/assets/ms_calendar/js/frf_list.js",
#     "/assets/ms_calendar/js/phil_registration_form_list.js",
#     "/assets/ms_calendar/js/pathways_redirect.js",
# ]
# # doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# # doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# # Svg Icons
# # ------------------
# # include app icons in desk
# # app_include_icons = "ms_calendar/public/icons.svg"

# # Home Pages
# # ----------

# # application home page (will override Website Settings)
# # home_page = "login"

# # on_session_creation = "ms_calendar.overrides.redirect_to_pathways_dashboard"

# # website user home page (by Role)
# # role_home_page = {
# # 	"Role": "home_page"
# # }

# # Generators
# # ----------

# # automatically create page for each record of this doctype
# # website_generators = ["Web Page"]

# # automatically load and sync documents of this doctype from downstream apps
# # importable_doctypes = [doctype_1]

# # Jinja
# # ----------

# # add methods and filters to jinja environment
# # jinja = {
# # 	"methods": "ms_calendar.utils.jinja_methods",
# # 	"filters": "ms_calendar.utils.jinja_filters"
# # }

# # Installation
# # ------------

# before_migrate = ["ms_calendar.patches.fix_pkg_resources.execute"]

# # before_install = "ms_calendar.install.before_install"
# # after_install = "ms_calendar.install.after_install"

# # Uninstallation
# # ------------

# # before_uninstall = "ms_calendar.uninstall.before_uninstall"
# # after_uninstall = "ms_calendar.uninstall.after_uninstall"

# # Integration Setup
# # ------------------
# # To set up dependencies/integrations with other apps
# # Name of the app being installed is passed as an argument

# # before_app_install = "ms_calendar.utils.before_app_install"
# # after_app_install = "ms_calendar.utils.after_app_install"

# # Integration Cleanup
# # -------------------
# # To clean up dependencies/integrations with other apps
# # Name of the app being uninstalled is passed as an argument

# # before_app_uninstall = "ms_calendar.utils.before_app_uninstall"
# # after_app_uninstall = "ms_calendar.utils.after_app_uninstall"

# # Desk Notifications
# # ------------------
# # See frappe.core.notifications.get_notification_config

# # notification_config = "ms_calendar.notifications.get_notification_config"

# # Permissions
# # -----------
# # Permissions evaluated in scripted ways

# # permission_query_conditions = {
# # 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# # }
# #
# # has_permission = {
# # 	"Event": "frappe.desk.doctype.event.event.has_permission",
# # }

# # Document Events
# # ---------------
# # Hook on document methods and events

# # doc_events = {
# # 	"*": {
# # 		"on_update": "method",
# # 		"on_cancel": "method",
# # 		"on_trash": "method"
# # 	}
# # }

# # Scheduled Tasks
# # ---------------

# scheduler_events = {
# 	"daily": [
# 		"ms_calendar.api.ms_philanthropy.send_interviewer_feedback_reminders",
# 		"ms_calendar.api.ms_field.send_field_interview_feedback_reminders",
# 	],
# 	"cron": {
# 		"*/5 * * * *": [
# 			"ms_calendar.api.ms_field.send_field_interview_first_feedback_reminder",
# 		],
# 	},
# }

# # Testing
# # -------

# # before_tests = "ms_calendar.install.before_tests"

# # Extend DocType Class
# # ------------------------------
# #
# # Specify custom mixins to extend the standard doctype controller.
# # extend_doctype_class = {
# # 	"Task": "ms_calendar.custom.task.CustomTaskMixin"
# # }

# # Overriding Methods
# # ------------------------------
# #
# # override_whitelisted_methods = {
# # 	"frappe.desk.doctype.event.event.get_events": "ms_calendar.event.get_events"
# # }
# #
# # each overriding function accepts a `data` argument;
# # generated from the base implementation of the doctype dashboard,
# # along with any modifications made in other Frappe apps
# # override_doctype_dashboards = {
# # 	"Task": "ms_calendar.task.get_dashboard_data"
# # }

# # exempt linked doctypes from being automatically cancelled
# #
# # auto_cancel_exempted_doctypes = ["Auto Repeat"]

# # Ignore links to specified DocTypes when deleting documents
# # -----------------------------------------------------------

# # ignore_links_on_delete = ["Communication", "ToDo"]

# # Request Events
# # ----------------
# # before_request = ["ms_calendar.utils.before_request"]
# # after_request = ["ms_calendar.utils.after_request"]

# # Job Events
# # ----------
# # before_job = ["ms_calendar.utils.before_job"]
# # after_job = ["ms_calendar.utils.after_job"]

# # User Data Protection
# # --------------------

# # user_data_fields = [
# # 	{
# # 		"doctype": "{doctype_1}",
# # 		"filter_by": "{filter_by}",
# # 		"redact_fields": ["{field_1}", "{field_2}"],
# # 		"partial": 1,
# # 	},
# # 	{
# # 		"doctype": "{doctype_2}",
# # 		"filter_by": "{filter_by}",
# # 		"partial": 1,
# # 	},
# # 	{
# # 		"doctype": "{doctype_3}",
# # 		"strict": False,
# # 	},
# # 	{
# # 		"doctype": "{doctype_4}"
# # 	}
# # ]

# # Authentication and authorization
# # --------------------------------

# # auth_hooks = [
# # 	"ms_calendar.auth.validate"
# # ]

# # Automatically update python controller files with type annotations for this app.
# # export_python_type_annotations = True

# # default_log_clearing_doctypes = {
# # 	"Logging DocType Name": 30  # days to retain logs
# # }
# ## testing



app_name = "ms_calendar"
app_title = "Ms Calendar"
app_publisher = "Augustin Moses"
app_description = "A custom calendar app for managing events and schedules."
app_email = "tech4socialsector@azimpremjifoundation.org"
app_license = "mit"

# Apps
# ------------------


doc_events = {
    "Field Offline Result": {"after_insert": "ms_calendar.events.after_insert"},
    # FIX: "Field Registration Form" used to appear as TWO separate keys in
    # this dict (once here, once further down next to the "Field
    # Registration Form1" note). A Python dict literal keeps only the LAST
    # occurrence of a duplicate key — so the second definition (just the
    # OTP validate hook) was silently discarding this ENTIRE first one,
    # meaning send_registration_form_after_insert/on_update (SMS),
    # resume_rename.on_field_registration, and
    # check_registration_duplicate_on_save have not been firing on this
    # doctype at all. Merged into one entry so all of them actually run.
    # resume_rename.on_* hooks live on "on_update" (not "validate"): validate
    # fires BEFORE this save's own row commits, so a db.set_value the rename
    # does on this same doc/row there can get clobbered by Frappe's own
    # trailing UPDATE at the end of that save — see resume_rename.py's note
    # on _rename_resume for the resulting doc-vs-file-on-disk mismatch (File
    # list shows the doc as attached; the URL it points at 404s).
    "Field Registration Form": {
        "after_insert": "ms_calendar.ms_calendar.sms_utils.send_registration_form_after_insert",
        "on_update": [
            "ms_calendar.api.resume_rename.on_field_registration",
            "ms_calendar.ms_calendar.sms_utils.send_registration_form_on_update",
            "ms_calendar.api.applicant_master_sync.sync_field_registration_to_applicant_master",
        ],
        "validate": [
            # "ms_calendar.api.ms_field.check_registration_duplicate_on_save",
            "ms_calendar.api.otp.enforce_otp_verification",
        ],
    },
    "Phil Registration Form": {
        "validate": [
            "ms_calendar.api.ms_field.check_registration_duplicate_on_save",
        ],
        "on_update": [
            "ms_calendar.api.resume_rename.on_phil_registration",
            "ms_calendar.api.applicant_master_sync.sync_phil_registration_to_applicant_master",
        ],
    },
    # NOTE: this site's live doctype is "Field Registration Form" (no "1") —
    # this "1" variant is a mismatch left over from local vs. cloud naming
    # and doesn't fire on this site at all. Left as-is (not this site's
    # active doctype) rather than merged into the entry above.
    "Field Registration Form1": {
        "validate": [
            "ms_calendar.api.ms_field.check_registration_duplicate_on_save",
        ],
        "on_update": "ms_calendar.api.resume_rename.on_field_registration",
    },
    "Health Registration Form": {
        "validate": [
            "ms_calendar.api.ms_field.check_registration_duplicate_on_save",
            "ms_calendar.api.otp.enforce_otp_verification",
        ],
        "on_update": [
            "ms_calendar.api.resume_rename.on_health_registration",
            "ms_calendar.api.applicant_master_sync.sync_health_registration_to_applicant_master",
        ],
    },
    "Health Document Collection": {
        "on_update": "ms_calendar.api.resume_rename.on_health_document_collection"
    },
    "Philanthrophy Document Collection": {
        "on_update": "ms_calendar.api.resume_rename.on_philanthropy_document_collection"
    },
    "Philanthrophy Feedback Form": {
        "after_insert": "ms_calendar.api.feedback_merge.on_feedback_form_submitted"
    },
    # MBBS Fellowship's 4 feedback-round doctypes (applicant_id links to
    # Health Registration Form) -> its existing "feedback_form" field.
    # on_update (not after_insert, unlike Philanthropy's single-doctype
    # version above) so editing an already-saved round's feedback also
    # rebuilds the combined PDF.
    "Health Feedback Form one": {
        "on_update": "ms_calendar.api.ms_health.on_mbbs_feedback_form_submitted"
    },
    "Health FeedBack Form Two": {
        "on_update": "ms_calendar.api.ms_health.on_mbbs_feedback_form_submitted"
    },
    "Health Feedback Form Three": {
        "on_update": "ms_calendar.api.ms_health.on_mbbs_feedback_form_submitted"
    },
    "Health Center Visit Form": {
        "on_update": "ms_calendar.api.ms_health.on_mbbs_feedback_form_submitted"
    },
    "Scholarship Recruitment Form": {
        "on_update": [
            "ms_calendar.api.resume_rename.on_scholarship_registration",
            "ms_calendar.api.applicant_master_sync.sync_scholarship_registration_to_applicant_master",
        ],
    },
    "Leader Final Round Feedback Form": {
        "after_insert": [
            "ms_calendar.api.ms_field.send_leader_final_round_feedback_pdf",
            "ms_calendar.api.ms_field.send_leader_final_round_feedback_pdf_to_registration_form",
        ]
    },
    "Recruiter Feedback Form": {
        "after_insert": "ms_calendar.api.ms_field.send_recruiter_feedback_pdf_to_registration_form"
    },
    "Educational Capacity Interview - Feedback Form": {
        "after_insert": "ms_calendar.api.ms_field.send_educational_capacity_feedback_pdf_to_registration_form"
    },
    "School Teacher Feedback Form": {
        "after_insert": "ms_calendar.api.ms_field.send_school_teacher_feedback_pdf_to_registration_form"
    },
    "Demo Lesson Observation Feedback Form": {
        "after_insert": "ms_calendar.api.ms_field.send_demo_lesson_observation_feedback_pdf_to_registration_form"
    },
    "Feedback Form - Associate Resource Person": {
        "after_insert": "ms_calendar.api.ms_field.send_arp_feedback_pdf_to_registration_form"
    },
    "Recruiter Assessment Form": {
        "after_insert": "ms_calendar.api.ms_field.send_recruiter_assessment_pdf_to_registration_form"
    },
    "Functional Round Feedback Form": {
        "after_insert": "ms_calendar.api.ms_field.send_functional_round_feedback_pdf_to_registration_form"
    },
    "Final Round Feedback Form": {
        "after_insert": "ms_calendar.api.ms_field.send_final_round_feedback_pdf_to_registration_form"
    },
}

# Client Script records that must exist on any site running this app
# (the four Registration Forms are custom doctypes, so their client-side
# duplicate-check script lives as data, not a file — export/import via fixtures).
fixtures = [
    {
        "dt": "Client Script",
        "filters": [
            [
                "name",
                "in",
                [
                    "Field Registration Form Duplicate Check",
                    "Field Registration Form1 Duplicate Check",
                    "Health Registration Form Duplicate Check",
                    "Phil Registration Form Duplicate Check",
                    # Form JS for Custom DocTypes (see the doctype_js note
                    # above and ms_calendar.api.sync_client_scripts) — these
                    # get their `script` content refreshed automatically on
                    # migrate, but that only reaches sites that already
                    # have this fixture; a brand-new site needs the record
                    # itself to exist first.
                    "Philanthropy Interview Schedule",
                    "Health Interview Schedule",
                    "Health Document Collection",
                    "Philanthrophy Document Collection",
                ],
            ]
        ],
    },
    # MeritTrac result doctypes were created as Custom DocTypes directly on
    # ms.local's DB (no JSON/module file), so any other site running this
    # app needs them shipped as a fixture too, or merit_trac.py's
    # test_result_api() fails with a DocType import error on insert.
    #
    # Department and Location are the same situation: also created as
    # Custom DocTypes directly on ms.local's DB, and used as Link targets
    # on Applicant Master's "department"/"location" fields. Without this
    # fixture, any other site (e.g. production) shows "Missing DocType —
    # Field department is referring to non-existing doctype Department."
    {
        "dt": "DocType",
        "filters": [
            [
                "name",
                "in",
                [
                    "MeritTrac Test Result",
                    "Field MeritTrac Test Result",
                    "Department",
                    "Location",
                ],
            ]
        ],
    },
    # Actual Department/Location records (Applicant Master's Link fields
    # need the rows to exist too, not just the DocType definition).
    {"dt": "Department"},
    {"dt": "Location"},
]

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "ms_calendar",
# 		"logo": "/assets/ms_calendar/logo.png",
# 		"title": "Ms Calendar",
# 		"route": "/ms_calendar",
# 		"has_permission": "ms_calendar.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/ms_calendar/css/ms_calendar.css"
# app_include_js = "/assets/ms_calendar/js/ms_calendar.js"

# include js, css files in header of web template
# web_include_css = "/assets/ms_calendar/css/ms_calendar.css"
# web_include_js = "/assets/ms_calendar/js/ms_calendar.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "ms_calendar/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# NOTE: Health Document Collection, Philanthrophy Document Collection, and
# Philanthropy Interview Schedule are Custom DocTypes (custom=1) — Frappe's
# FormMeta.add_code() hard-skips doctype_js for any custom doctype, so
# entries for them here would silently never fire. Their form JS is
# instead synced into a "Client Script" record on every migrate — see
# ms_calendar.api.sync_client_scripts. The .js files themselves still live
# under public/js/ as the source of truth; only the *loading mechanism*
# differs from a normal (non-custom) doctype like "Job Opening" below.
doctype_js = {
    "Job Opening": "public/js/job_opening.js",
}
doctype_list_js = {
    "Field Registration Form": "public/js/frf_list.js",
    "Phil Registration Form": "public/js/phil_registration_form_list.js",
    "Scholarship Recruitment Form": "public/js/scholarship_recruitment_form_list.js",
}
app_include_js = [
    # frf_list.js carries a manual "?v=" cache-buster: this file has no
    # content hash in its URL (unlike webpack .bundle. assets, see
    # bundled_asset() in frappe/utils/jinja_globals.py), so browsers were
    # holding onto old copies for the full 12h Cache-Control max-age even
    # across hard reloads. Bump the number any time this file changes and
    # every browser is guaranteed a fresh fetch on next page load.
    "/assets/ms_calendar/js/frf_list.js?v=3",
    "/assets/ms_calendar/js/phil_registration_form_list.js",
    "/assets/ms_calendar/js/scholarship_recruitment_form_list.js",
    "/assets/ms_calendar/js/pathways_redirect.js",
]
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "ms_calendar/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# on_session_creation = "ms_calendar.overrides.redirect_to_pathways_dashboard"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# automatically load and sync documents of this doctype from downstream apps
# importable_doctypes = [doctype_1]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "ms_calendar.utils.jinja_methods",
# 	"filters": "ms_calendar.utils.jinja_filters"
# }

# Installation
# ------------

before_migrate = ["ms_calendar.patches.fix_pkg_resources.execute"]

# Custom DocTypes never load hooks.py's doctype_js (Frappe's own
# FormMeta.add_code() hard-skips it for custom=1 doctypes) — their form JS
# has to live in a Client Script record instead. This keeps those records
# synced from their actual .js source files on every migrate, so editing
# the file is enough. See ms_calendar.api.sync_client_scripts for the list
# of doctypes this covers.
after_migrate = ["ms_calendar.api.sync_client_scripts.sync_custom_doctype_client_scripts"]

# before_install = "ms_calendar.install.before_install"
# after_install = "ms_calendar.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "ms_calendar.uninstall.before_uninstall"
# after_uninstall = "ms_calendar.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "ms_calendar.utils.before_app_install"
# after_app_install = "ms_calendar.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "ms_calendar.utils.before_app_uninstall"
# after_app_uninstall = "ms_calendar.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "ms_calendar.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

scheduler_events = {
	"daily": [
		"ms_calendar.api.ms_philanthropy.send_interviewer_feedback_reminders",
		"ms_calendar.api.ms_philanthropy.send_candidate_interview_reminders",
		"ms_calendar.api.ms_field.send_field_interview_feedback_reminders",
		"ms_calendar.api.ms_health.send_interviewer_feedback_reminders",
	],
	"cron": {
		"*/5 * * * *": [
			"ms_calendar.api.ms_field.send_field_interview_first_feedback_reminder",
			# Moved off "daily" — that only checked once around midnight, so
			# whether a candidate got a real day's notice or just a few
			# hours depended entirely on what time their interview happened
			# to be at (a noon interview only got ~12 hours' notice, sent
			# while they were likely asleep). Checking every 5 minutes
			# instead means this fires close to exactly 24 hours before
			# the interview regardless of its time of day.
			# candidate_reminder_sent still guards against re-sending.
			"ms_calendar.api.ms_philanthropy.send_candidate_interview_reminders",
			# Health's version registered straight on the 5-minute cron from
			# the start, learning from the fix above — no reason to repeat
			# the once-daily mistake here.
			"ms_calendar.api.ms_health.send_candidate_interview_reminders",
		],
	},
}

# Testing
# -------

# before_tests = "ms_calendar.install.before_tests"

# Extend DocType Class
# ------------------------------
#
# Specify custom mixins to extend the standard doctype controller.
# extend_doctype_class = {
# 	"Task": "ms_calendar.custom.task.CustomTaskMixin"
# }
#
# Lets any logged-in staff member (System User role) open a CV/attachment
# on the resume-bearing forms without hitting File's own default 403 —
# see file_access.py for why that 403 happens in the first place.
extend_doctype_class = {
	"File": "ms_calendar.api.file_access.RelaxedAttachmentAccessMixin",
}

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "ms_calendar.event.get_events"
# }
#
# each overriding function accepts a data argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "ms_calendar.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["ms_calendar.utils.before_request"]
# after_request = ["ms_calendar.utils.after_request"]

# Job Events
# ----------
# before_job = ["ms_calendar.utils.before_job"]
# after_job = ["ms_calendar.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"ms_calendar.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }
## testing
