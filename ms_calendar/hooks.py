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
    "Field Registration Form": {
        "after_insert": "ms_calendar.ms_calendar.sms_utils.send_registration_form_after_insert",
        "on_update": "ms_calendar.ms_calendar.sms_utils.send_registration_form_on_update",
    },
    "BGV Document": {
        "after_insert": "ms_calendar.ms_calendar.doctype.bgv_request.bgv_request.on_document_upload"
    },
    "Phil Registration Form": {
        "validate": "ms_calendar.api.resume_rename.on_phil_registration"
    },
    "Field Registration Form": {
        "validate": "ms_calendar.api.resume_rename.on_field_registration"
    },
    "Field Registration Form1": {
        "validate": "ms_calendar.api.resume_rename.on_field_registration"
    },
    "Health Registration Form": {
        "validate": "ms_calendar.api.resume_rename.on_health_registration"
    },
    "Scholarship Recruitment Form": {
        "validate": "ms_calendar.api.resume_rename.on_scholarship_registration"
    },
}

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
doctype_js = {"Job Opening": "public/js/job_opening.js"}
doctype_list_js = {"Field Registration Form": "public/js/field_registration_form_list.js"}
app_include_js = ["/assets/ms_calendar/js/field_registration_form_list.js"]
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

scheduler_events = {"daily": ["ms_calendar.api.authbridge_v2.poll_pending_cases"]}

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

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "ms_calendar.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
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
