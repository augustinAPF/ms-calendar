"""
Headcount Plan — how many people a unit plans to hire in one financial year,
by DEPARTMENT (2026-11-26: department-wise only, not job / role wise).
One plan per Financial Year + Unit (named HC-<year>-<unit>, e.g. HC-2026-27-Field).

The form fills its rows with the unit's departments (Recruitment Department,
departments used on the unit's Job Openings, and the rows of its last plan);
the planner types a headcount on each and can add a new department from the
form. The Pathways Overall Dashboard "Headcount" tab reads these plans
(see page/pathways_overall_dashboard/headcount.py).
"""

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, nowdate

# The six units a plan can be made for, in the order the dashboard lists them.
HC_UNITS = [
    "Azim Premji University",
    "Field",
    "Grants",
    "Health",
    "Enablers",
    "Azim Premji Scholarship",
]


def fy_dates(fy):
    """'2026-27' → (date 2026-04-01, date 2027-03-31). Financial year = April to March."""
    start = int(str(fy)[:4])
    return getdate(f"{start}-04-01"), getdate(f"{start + 1}-03-31")


def current_fy(day=None):
    """The financial year a date falls in: 26-11-2026 → '2026-27', 15-02-2027 → '2026-27'."""
    d = getdate(day or nowdate())
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def previous_fy(fy):
    start = int(str(fy)[:4]) - 1
    return f"{start}-{str(start + 1)[-2:]}"


def _key(v):
    """Compare names the way MariaDB does: case-insensitive, outer spaces ignored."""
    return (v or "").strip().lower()


def split_roles(text):
    """'A\\nB, ' → ['A', 'B'] — one role per line, blanks and repeats dropped."""
    out, seen = [], set()
    for line in str(text or "").splitlines():
        r = " ".join(line.split())
        if r and _key(r) not in seen:
            seen.add(_key(r))
            out.append(r)
    return out


def _unit_roles(unit):
    """department key → sorted role names used on the unit's Job Openings."""
    out = {}
    for jo in frappe.get_all("Job Opening", filters={"unit": unit, "department": ["is", "set"],
                                                     "designation": ["is", "set"]},
                             fields=["department", "designation"]):
        out.setdefault(_key(jo.department), set()).add(jo.designation.strip())
    return {k: sorted(v, key=_key) for k, v in out.items()}


class HeadcountPlan(Document):
    def autoname(self):
        self.name = f"HC-{self.financial_year}-{self.unit}"

    def validate(self):
        if self.unit not in HC_UNITS:
            frappe.throw(_("Unit must be one of: {0}").format(", ".join(HC_UNITS)))
        if self.is_new() and frappe.db.exists("Headcount Plan", f"HC-{self.financial_year}-{self.unit}"):
            frappe.throw(_("A headcount plan for {0} in {1} already exists. Open that one and change it instead.")
                         .format(frappe.bold(self.unit), frappe.bold(self.financial_year)))

        # The same department twice would be counted twice on the dashboard.
        # New roles: every role used under a department on the unit's Job Openings
        # is added to that department's list automatically on each save.
        live = _unit_roles(self.unit)
        seen = {}
        for row in self.plan_details:
            k = _key(row.department)
            if k in seen:
                frappe.throw(_("Row {0} repeats row {1}: {2}. Keep one row and add the numbers together.")
                             .format(row.idx, seen[k], row.department))
            seen[k] = row.idx
            row.headcount = max(0, row.headcount or 0)
            row.roles = "\n".join(split_roles("\n".join([row.roles or ""] + live.get(k, []))))

        self.total_headcount = sum(r.headcount or 0 for r in self.plan_details)
        start, end = fy_dates(self.financial_year)
        self.period = f"{start.strftime('%d-%m-%Y')} to {end.strftime('%d-%m-%Y')}"


@frappe.whitelist()
def plan_units():
    """The six units (the Unit drop-down is limited to these) and the current financial year."""
    return {"units": HC_UNITS, "current_fy": current_fy()}


@frappe.whitelist()
def get_unit_rows(unit, financial_year=None):
    """
    The unit's departments with their roles: its Recruitment Departments, the
    departments used on its Job Openings and the rows of its latest earlier plan.
    Fills a new plan, and lets an open plan show new roles / departments as soon
    as they appear (the form reads it every time it opens).
    """
    frappe.has_permission("Headcount Plan", "read", throw=True)
    if unit not in HC_UNITS:
        frappe.throw(_("Unknown unit"))

    names, seen = [], set()
    roles = _unit_roles(unit)          # dept key → roles on Job Openings

    def add(dept, extra_roles=None):
        if not dept:
            return
        k = _key(dept)
        if k not in seen:
            seen.add(k)
            names.append(dept)
        if extra_roles:
            roles[k] = split_roles("\n".join(roles.get(k, []) + split_roles(extra_roles)))

    for d in frappe.get_all("Recruitment Department", filters={"unit": unit}, pluck="name"):
        add(d)
    for d in frappe.get_all("Job Opening", filters={"unit": unit, "department": ["is", "set"]},
                            pluck="department", distinct=True):
        add(d)
    prev = frappe.get_all("Headcount Plan", filters={"unit": unit, "financial_year": ["!=", financial_year or ""]},
                          fields=["name"], order_by="financial_year desc", limit=1)
    if prev:
        for r in frappe.get_all("Headcount Plan Detail", filters={"parent": prev[0].name,
                                                                  "parenttype": "Headcount Plan"},
                                fields=["department", "roles"], order_by="idx"):
            add(r.department, r.roles)

    names.sort(key=_key)
    return {"rows": [{"department": d, "roles": "\n".join(roles.get(_key(d), []))} for d in names],
            "previous_plan": prev[0].name if prev else None}


@frappe.whitelist()
def get_department_roles(unit, department):
    """Roles used under one department on the unit's Job Openings (for a row added by hand)."""
    frappe.has_permission("Headcount Plan", "read", throw=True)
    return "\n".join(_unit_roles(unit).get(_key(department), []))


@frappe.whitelist()
def get_previous_plan(unit, financial_year):
    """The rows (with headcount) of this unit's plan for the year before, to copy into a new plan."""
    frappe.has_permission("Headcount Plan", "create", throw=True)
    name = f"HC-{previous_fy(financial_year)}-{unit}"
    if not frappe.db.exists("Headcount Plan", name):
        return None
    doc = frappe.get_doc("Headcount Plan", name)
    doc.check_permission("read")
    return {"name": name, "rows": [{"department": r.department, "roles": r.roles or "", "headcount": r.headcount or 0,
                                    "remarks": r.remarks or ""} for r in doc.plan_details]}


@frappe.whitelist()
def add_department(department, unit):
    """
    "Add department" on the form: a new Recruitment Department for this unit
    (or the existing one with that name). Returns its name for the new row.
    """
    frappe.has_permission("Headcount Plan", "write", throw=True)
    if unit not in HC_UNITS:
        frappe.throw(_("Unknown unit"))
    name = " ".join(str(department or "").split())
    if not name or len(name) > 140:
        frappe.throw(_("Give a department name (up to 140 characters)."))
    existing = frappe.db.get_value("Recruitment Department", name, ["name", "unit"], as_dict=True)
    if existing:
        if existing.unit and existing.unit != unit:
            frappe.throw(_("{0} already exists under the unit {1}.").format(frappe.bold(existing.name),
                                                                            frappe.bold(existing.unit)))
        if not existing.unit:
            frappe.db.set_value("Recruitment Department", existing.name, "unit", unit)
        return {"name": existing.name, "created": False,
                "roles": "\n".join(_unit_roles(unit).get(_key(existing.name), []))}
    doc = frappe.get_doc({"doctype": "Recruitment Department", "unit": unit})
    doc.name = name
    doc.insert(ignore_permissions=True, set_name=name)
    return {"name": doc.name, "created": True, "roles": ""}
