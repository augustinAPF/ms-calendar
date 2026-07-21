import frappe
from frappe import _
from frappe.utils import getdate
from frappe.model.naming import set_name_from_naming_options
from frappe.utils.data import pretty_date
from frappe.website.website_generator import WebsiteGenerator


class JobOpening(WebsiteGenerator):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        closed_on: DF.Date | None
        closes_on: DF.Date | None
        unit: DF.Link
        currency: DF.Link | None
        department: DF.Link | None
        description: DF.TextEditor | None
        designation: DF.Link
        employment_type: DF.Link | None
        job_application_route: DF.Data | None
        job_opening_template: DF.Link | None
        job_title: DF.Data
        location: DF.Link | None
        lower_range: DF.Currency
        posted_on: DF.Datetime | None
        publish: DF.Check
        publish_applications_received: DF.Check
        publish_salary_range: DF.Check
        route: DF.Data | None
        salary_per: DF.Literal["Month", "Year"]
        status: DF.Literal["Open", "Closed"]
        upper_range: DF.Currency
        vacancies: DF.Int
        theme: DF.Data | None
        geo: DF.Data | None
    # end: auto-generated types

    website = frappe._dict(
        template="templates/generators/job_opening.html",
        condition_field="publish",
        page_title_field="job_title",
    )

    def autoname(self):
        set_name_from_naming_options(frappe.get_meta(self.doctype).autoname, self)

    # Maps unit_lower (must match a real "Recruitment Units" record name,
    # lowercased) → careers.frappe.cloud form slug
    _UNIT_FORM_MAP = {
        "school education - field": "field-registration-form",
        "grants":                   "philanthropy-registration-form",
        "scholarship":              "scholarship-recruitment-form",
    }

    def _auto_set_job_application_route(self):
        from urllib.parse import urlencode
        unit_key = (self.unit or "").strip().lower()
        form_slug = self._UNIT_FORM_MAP.get(unit_key)
        if not form_slug:
            return
        params = {}
        if self.designation:
            params["role"] = self.designation
        if self.location:
            params["location"] = self.location
        if self.department:
            params["department"] = self.department
        if getattr(self, "theme", None):
            params["themes"] = self.theme
        if getattr(self, "geo", None):
            params["geo"] = self.geo
        if getattr(self, "job_code", None):
            params["job_code"] = self.job_code
        if getattr(self, "preferred_location", None) and self.location and "/" in self.location:
            options = [part.strip() for part in self.location.split("/") if part.strip()]
            if options:
                params["preferred_location_options"] = ",".join(options)
        url = f"https://careers.frappe.cloud/{form_slug}/new"
        if params:
            url += "?" + urlencode(params)
        self.job_application_route = url

    def validate(self):
        if not self.route:
            slug = frappe.scrub(self.job_title or "job").replace("_", "-")
            doc_id = (self.name or "").lower().replace("/", "-")
            unit_slug = frappe.scrub(self.unit) if self.unit else "general"
            self.route = f"jobs/{unit_slug}/{slug}-{doc_id}"
        self._auto_set_job_application_route()
        self.update_closing_date()
        self.validate_dates()

    def on_update(self):
        self.update_job_requisition_status()

    def update_closing_date(self):
        old_doc = self.get_doc_before_save()
        if not old_doc:
            return

        if old_doc.status == "Open" and self.status == "Closed":
            self.closes_on = None
            if not self.closes_on:
                self.closes_on = getdate()

        elif old_doc.status == "Closed" and self.status == "Open":
            self.closes_on = None

    def validate_dates(self):
        if self.status == "Open":
            self.validate_from_to_dates("posted_on", "closes_on")
        if self.status == "Closed":
            self.validate_from_to_dates("posted_on", "closed_on")

    def update_job_requisition_status(self):
        pass

    def get_context(self, context):
        context.no_of_applications = 0
        context.parents = [{"route": "jobs", "title": _("All Jobs")}]
        context.posted_on = pretty_date(self.posted_on)


def close_expired_job_openings():
    today = getdate()

    Opening = frappe.qb.DocType("Job Opening")
    openings = (
        frappe.qb.from_(Opening)
        .select(Opening.name)
        .where((Opening.status == "Open") & (Opening.closes_on.isnotnull()) & (Opening.closes_on < today))
    ).run(pluck=True)

    for d in openings:
        doc = frappe.get_doc("Job Opening", d)
        doc.status = "Closed"
        doc.flags.ignore_permissions = True
        doc.flags.ignore_mandatory = True
        doc.save()
