"""
Applicant Master sync — Health / Field / Philanthropy / Scholarship
=====================================================================

Applicant Master unifies common applicant data across four separate
registration forms (Health, Field, Philanthropy, Scholarship). Each field
that's shared across forms documents its per-form source fieldname directly
in its own `description` (e.g. "Common field. Source fields -> Health:
application_status; Field: application_status; ..."), and each form also
has its own "<Form> - Details" tab holding fields specific to that one
form. Every FIELD_MAPPING_* dict below was built the same way: parse those
descriptions/tab sections, then cross-check every candidate against that
form's ACTUAL live field list — not just trust the description text, since
several of those had drifted out of date (e.g. Field Registration Form's
"offer", "units", and "job_code" are declared as source fields in
Applicant Master's descriptions but no longer exist on that form at all,
so they're intentionally left unmapped rather than guessed at; same
pattern shows up for Phil and Scholarship below).

All four forms have a live "zayam_id" field, which is the primary match key
into Applicant Master's "zwayam_id" field — forced explicitly in each
mapping below rather than only relying on the description text, since
Health Registration Form's own field description doesn't mention "Health:"
for that field at all even though the field itself exists.

Zayam Id is normally assigned by a recruiter after the fact (it isn't even
present on the public web forms candidates fill in), so a brand new
submission has no Zayam Id yet. Rather than skip the sync entirely until
then, an unmatched submission falls back to matching by email address
against any other Applicant Master row that's likewise still unmatched
(zwayam_id == "", the explicit sentinel this sync writes for exactly this
case — never NULL, which is what pre-existing/unrelated Applicant Master
rows use, so this fallback can never collide with legacy data). That keeps
re-saving the same source form before a Zayam Id exists updating the same
row instead of piling up duplicates, and once a Zayam Id is later assigned,
the next save "upgrades" that same fallback-matched row in place rather
than leaving it behind as an orphan.

Whenever any of these four forms is saved, its sync_<form>_to_applicant_
master hook copies every mapped field's current value into the matching
Applicant Master record (matched by Zwayam Id, or by the email fallback
above), creating one if none exists yet. A save on the source form is
never blocked by a sync problem — failures are logged to Error Log
instead of raised.
"""

import frappe

# Applicant Master fieldname -> Field Registration Form fieldname.
# Deliberately excludes fields whose declared source no longer exists on
# Field Registration Form (offer_status<-offer, unit<-units, job_code) —
# see module docstring. Also excludes common fields with no Field-form
# source at all (state, district_city, total_experience, feedback_form)
# and a handful of Field-specific fields that don't have a live
# counterpart on the form (reason_decline, email_verified, phone_verified,
# preferred_location_form, department_change_reason, if_email_invite,
# employee_referral, ex_emplyee_name, if_recruiter_upload,
# preferred_test_mode, remarks, date_of_applied, cool_of_period,
# date_offer_field) — add these once/if the corresponding field is added
# to Field Registration Form.
FIELD_MAPPING = {
    "application_status": "application_status",
    "full_name": "full_name_aadhaar",
    "gender": "gender",
    "date_of_birth": "dob",
    "age": "age",
    "email_address": "email_address",
    "phone_number": "phone_number",
    "role": "role",
    "department": "department",
    "location": "location",
    "zwayam_id": "zayam_id",
    "resume": "resume_upload",
    "highest_education": "highest_education",
    "opportunity_source": "opportunity",
    "languages_known": "languages_known",
    "blocklist_reason": "blocklist_reason",
    "hold_reason": "hold_reason",
    "reasons_for_shortlist": "reasons_for_shortlist",
    "other_shortlist": "other_shortlist",
    "reasons_for_reject_field": "reasons_for_reject",
    "other_reject": "other_reject",
    "other_job": "other_job",
    "reason_otherjob": "reason_otherjob",
    "alternate_no": "alternate_no",
    "native_state": "native_state",
    "native_district": "native_district",
    "teaching_degrees": "teaching_degrees",
    "teaching_year": "teaching_year",
    "teachingexp_month": "teachingexp_month",
    "health_expyear": "health_expyear",
    "health_expmonth": "health_expmonth",
    "former_employee": "former_employee",
    "process_12": "process_12",
    "then_other": "then_other",
    "apf_associated": "apf_associated",
    "apf_family": "apf_family",
    "worklocation": "worklocation",
    "english_medium": "english_medium",
    "english_fluent": "english_fluent",
    "test_location": "test_location",
    "written_subject": "written_subject",
    "ctet_qualify": "ctet_qualify",
    "recruiter_round_feedback_form": "recruiter_round_feedback_form",
    "round_one_feedback_from": "round_one_feedback_from",
    "round_two_feedback_form": "round_two_feedback_form",
    "round_tree_feedback_form": "round_tree_feedback_form",
    "application_forms": "application_forms",
    "self_declaration_field": "self_declaration",
    "filed_merit_track_test": "filed_merit_track_test",
    "field_mail": "field_mail",
}



# Applicant Master fieldname -> Health Registration Form fieldname.
FIELD_MAPPING_HEALTH = {
    "zwayam_id": "zayam_id",  # forced — see module docstring
    "address1": "address1",
    "age": "age",
    "any_other_year": "any_other_year",
    "application_status": "application_status",
    "are_you_open": "are_you_open",
    "arealocality": "arealocality",
    "authorisation": "authorisation",
    "bengali": "bengali",
    "chhattisgarhi": "chhattisgarhi",
    "complete_mbbs": "complete_mbbs",
    "date_of_birth": "date_of_birth",
    "date_offer": "date_offer",
    "designation__role": "designation__role",
    "district__city": "district__city",
    "district_city": "taluk__district__city",
    "door_number": "door_number",
    "education_qualification": "education_qualification",
    "email_address": "email_address",
    "emp_enddate": "emp_enddate",
    "emp_startdate": "emp_startdate",
    "english": "english",
    "fbone_panel": "fbone_panel",
    "fbtwo_panel": "fbtwo_panel",
    "feedback_form": "feedback_form",
    "fellowship_mail": "fellowship_mail",
    "first_prefered": "first_prefered",
    "foundation_selection": "foundation_selection",
    "full_name": "full_name",
    "full_name_employer": "full_name_employer",
    "gujarati": "gujarati",
    "hindi": "hindi",
    "if_no_mention": "if_no_mention",
    "if_other": "if_other",
    "interested_in": "interested_in",
    "kannada": "kannada",
    "languages_known": "languages_known",
    "malayalam": "malayalam",
    "marathi": "marathi",
    "mbbs_college": "mbbs_college",
    "mbbs_experience": "mbbs_experience",
    "mbbs_institution": "mbbs_institution",
    "medical_fitness": "medical_fitness",
    "monthly_salary": "monthly_salary",
    "odia": "odia",
    "offer_status": "offer",
    "opportunity_source": "opportunity",
    "other_institution": "other_institution",
    "phone_number": "phone_number",
    "pincode": "pincode",
    "reasons_for_hold": "reasons_for_hold",
    "reasons_for_reject": "reasons_for_reject",
    "reasons_for_shorlist": "reasons_for_shorlist",
    "registration_form": "registration_form",
    "resume": "resume",
    "second_location": "second_location",
    "selection_process": "selection_process",
    "state": "state",
    "state_medical_council": "state_medical_council",
    "tamil": "tamil",
    "third_location": "third_location",
}


# Applicant Master fieldname -> Phil Registration Form fieldname.
FIELD_MAPPING_PHIL = {
    "zwayam_id": "zayam_id",  # forced — see module docstring
    "age": "age",
    "application_status": "application_status",
    "application_submission": "application_submission",
    "application_submission_date": "application_submission_date",
    "assignement_date": "assignement_date",
    "assignment": "assignment",
    "completion_year": "completion_year",
    "current_location": "current_location",
    "date_of_birth": "date_of_birth",
    "email_address": "email",
    "feedback_form": "feedback_form",
    "feedback_form_three": "feedback_form_three",
    "feedback_form_two": "feedback_form_two",
    "full_name": "name1",
    "geo": "geo",
    "highest_education": "highest_level_of_education",
    "location": "location",
    "phil_application_pdf": "phil_application_pdf",
    "philanthropy_mail": "philanthropy_mail",
    "phone_number": "phone",
    "position": "position",
    "resume": "cv_attach",
    "role": "role",
    "submitted_assignment": "submitted_assignment",
    "themes": "themes",
    "total_experience": "total_experience",
}


# Applicant Master fieldname -> Scholarship Recruitment Form fieldname.
FIELD_MAPPING_SCHOLARSHIP = {
    "zwayam_id": "zayam_id",  # forced — see module docstring
    "add_educational_qualification": "add_educational_qualification",
    "add_row": "add_row",
    "add_row2": "add_row2",
    "address": "address",
    "annual_salary": "annual_salary",
    "any_gaps": "any_gaps",
    "application_status": "application_status",
    "basic_formula": "basic_formula",
    "completion": "completion",
    "course": "course",
    "current_ctc": "current_ctc",
    "currently_employed": "currently_employed",
    "date_of_birth": "date_of_birth",
    "degree": "degree",
    "designation": "designation",
    "designation2": "designation2",
    "designation3": "designation3",
    "designation_role": "designation_role",
    "district2": "district2",
    "district3": "district3",
    "district_city": "district",
    "district_city1": "district_city1",
    "documents_status": "documents_status",
    "email_address": "email",
    "employed_date": "employed_date",
    "employed_from": "employed_from",
    "employed_from2": "employed_from2",
    "employed_from3": "employed_from3",
    "employed_to": "employed_to",
    "employed_to1": "employed_to1",
    "employed_to2": "employed_to2",
    "employed_to3": "employed_to3",
    "employer_name": "employer_name",
    "employment_city": "employment_city",
    "employment_state": "employment_state",
    "exp_years": "exp_years",
    "expected_ctc": "expected_ctc",
    "feedback_form": "feedback_one_pdf",
    "folder_path": "folder_path",
    "full_name": "full_name_as_per_aadhar",
    "functions": "functions",
    "gender": "gender",
    "highest_education": "highest_level_of_education",
    "if_no_experience_years": "if_no_experience_years",
    "info_yourself": "info_yourself",
    "institution": "institution",
    "jd_read": "jd_read",
    "languages_known": "languages_known",
    "location_applied": "location_applied",
    "marital_status": "marital_status",
    "mode_course": "mode_course",
    "mode_of_course": "mode_of_course",
    "modeofcourse": "modeofcourse",
    "month_applied": "month_applied",
    "name_of_the_degree": "name_of_the_degree",
    "name_of_the_institution": "name_of_the_institution",
    "name_of_the_university": "name_of_the_university",
    "notice_period": "notice_period",
    "noticeperiod": "noticeperiod",
    "opportunity_source": "opportunity",
    "organization2": "organization2",
    "organization3": "organization3",
    "organization_employer1": "organization_employer1",
    "part_full_time": "part_full_time",
    "part_fulltime": "part_fulltime",
    "parttime2": "parttime2",
    "parttime3": "parttime3",
    "permanent_address": "permanent_address",
    "permanent_district": "permanent_district",
    "permanent_state": "permanent_state",
    "pg_degree": "pg_degree",
    "pg_institute": "pg_institute",
    "pg_specialisation": "pg_specialisation",
    "pg_university": "pg_university",
    "pg_year": "pg_year",
    "phone_number": "phone_number",
    "pivot_charts": "pivot_charts",
    "prior_exp": "prior_exp",
    "project_location": "project_location",
    "qualification": "qualification",
    "religional_languages": "religional_languages",
    "relocation": "relocation",
    "resume": "resume__cv",
    "role": "role",
    "role_applied": "role_applied",
    "role_apply": "role_apply",
    "same_as_current_address": "same_as_current_address",
    "score_percentile": "score_percentile",
    "spreadsheet": "spreadsheet",
    "srt_mail": "srt_mail",
    "state": "state",
    "state1": "state1",
    "state2": "state2",
    "state3": "state3",
    "state_of_residence": "state_of_residence",
    "submission_status": "submission_status",
    "submit_cv": "submit_cv",
    "takehome_salary": "takehome_salary",
    "total_experience": "total_years_of_experience",
    "total_months_of_experience": "total_months_of_experience",
    "total_score": "total_score",
    "total_year_of_experience": "total_year_of_experience",
    "ug_degree": "ug_degree",
    "ug_institute": "ug_institute",
    "ug_specialisation": "ug_specialisation",
    "ug_university": "ug_university",
    "ug_year": "ug_year",
    "university": "university",
    "verification_code": "verification_code",
    "year_completion": "year_completion",
    "year_of_completion": "year_of_completion",
    "yes_gaps": "yes_gaps",
}

_MATCH_FIELD_SOURCE = "zayam_id"  # on all four forms
_MATCH_FIELD_TARGET = "zwayam_id"  # on Applicant Master

# Applicant Master fields that are Link fields, and what doctype they link
# to. The source forms store these as free text (e.g. role "Cluster
# Coordinator", department "Livelihood") which frequently won't match an
# actual Role/Department record — saving a Link field with a value that
# doesn't exist makes Frappe throw "Could not find {doctype}: {value}" at
# save time, which would otherwise fail this whole sync (and, same as the
# date-parsing issue found earlier, leaks a message to the user even
# though the exception itself gets caught below). Validating each one
# first and just skipping the field if it doesn't resolve avoids the error
# entirely instead of merely swallowing it after the fact.
_LINK_TARGETS = {
    "role": "Role",
    "department": "Department",
    "location": "Location",
    # "unit" is intentionally absent: Applicant Master's "unit" field is a
    # plain Data field, not a Link (no "Unit" doctype exists), so it never
    # needs existence validation.
}


def _drop_unresolvable_links(values):
    for fieldname, target_doctype in _LINK_TARGETS.items():
        value = values.get(fieldname)
        if value and not frappe.db.exists(target_doctype, value):
            del values[fieldname]


def _sanitize_scalar(value):
    """Every Applicant Master field this syncs into (see FIELD_MAPPING_*
    below) is a plain Data/Text/Select field, never a Table/Table
    MultiSelect — so it can only ever legally hold a scalar. Some source
    forms nonetheless hand back a Python list here (e.g. a checkbox-group
    widget like "Languages Known" that submits its selections as an array
    even though the underlying field is just a Data field storing a plain
    string). Passed straight through, a single list-valued field fails
    target.save() with "Value for X cannot be a list" and — because that
    save is one atomic call — takes every OTHER correctly-mapped field on
    this record down with it, not just the offending one. Flatten it to a
    comma-joined string instead so the rest of the sync still goes through.
    """
    if isinstance(value, list):
        return ", ".join(str(v) for v in value if v not in (None, ""))
    return value


def _sync_to_applicant_master(doc, field_mapping, source_label):
    """
    Shared by all four sync_<form>_to_applicant_master hooks below. Never
    lets a sync problem block the user's actual save — logs and returns
    instead of raising, since this is a background consistency step, not
    something that should stop someone from saving their own registration
    form.
    """
    match_value = doc.get(_MATCH_FIELD_SOURCE)

    # No Zayam Id yet — fall back to this record's own email address as a
    # match key (see module docstring). Only computed when needed: once a
    # Zayam Id exists it's still consulted below to upgrade a prior
    # fallback-matched row instead of leaving it as a duplicate orphan.
    email_src_field = field_mapping.get("email_address")
    fallback_email = doc.get(email_src_field) if email_src_field else None

    if not match_value and not fallback_email:
        # Nothing at all to key this record off of.
        return

    # Snapshot the message log so that if something below still fails
    # unexpectedly (despite the Link pre-check), any message queued as a
    # side effect of that failure (frappe.throw queues its message before
    # raising, so a plain try/except can't undo it) gets discarded along
    # with the exception — the caller never sees it either way.
    message_log = frappe.local.message_log
    snapshot_len = len(message_log)

    try:
        values = {
            am_field: _sanitize_scalar(doc.get(src_field))
            for am_field, src_field in field_mapping.items()
        }
        _drop_unresolvable_links(values)

        if match_value:
            # match_value itself is the authoritative Zwayam Id — set
            # explicitly rather than relying solely on the mapping table.
            values[_MATCH_FIELD_TARGET] = match_value
            existing = frappe.db.get_value(
                "Applicant Master", {_MATCH_FIELD_TARGET: match_value}
            )
            if not existing and fallback_email:
                existing = frappe.db.get_value(
                    "Applicant Master",
                    {"email_address": fallback_email, _MATCH_FIELD_TARGET: ""},
                )
        else:
            # Sentinel, not NULL — see module docstring on why that's safe.
            values[_MATCH_FIELD_TARGET] = ""
            existing = frappe.db.get_value(
                "Applicant Master",
                {"email_address": fallback_email, _MATCH_FIELD_TARGET: ""},
            )

        if existing:
            target = frappe.get_doc("Applicant Master", existing)
            target.update(values)
            target.save(ignore_permissions=True)
        else:
            target = frappe.get_doc({"doctype": "Applicant Master", **values})
            target.insert(ignore_permissions=True)
    except Exception:
        frappe.log_error(
            title="Applicant Master Sync Error",
            message=f"{source_label} {doc.name} ({match_value}): {frappe.get_traceback()}",
        )
        del message_log[snapshot_len:]


def sync_field_registration_to_applicant_master(doc, method=None):
    """doc_events hook: on_update of Field Registration Form."""
    _sync_to_applicant_master(doc, FIELD_MAPPING, "Field Registration Form")


def sync_health_registration_to_applicant_master(doc, method=None):
    """doc_events hook: on_update of Health Registration Form."""
    _sync_to_applicant_master(doc, FIELD_MAPPING_HEALTH, "Health Registration Form")


def sync_phil_registration_to_applicant_master(doc, method=None):
    """doc_events hook: on_update of Phil Registration Form."""
    _sync_to_applicant_master(doc, FIELD_MAPPING_PHIL, "Phil Registration Form")


def sync_scholarship_registration_to_applicant_master(doc, method=None):
    """doc_events hook: on_update of Scholarship Recruitment Form."""
    _sync_to_applicant_master(doc, FIELD_MAPPING_SCHOLARSHIP, "Scholarship Recruitment Form")


# ---------------------------------------------------------------------------
# ON-DEMAND BULK BACKFILL — "Fetch All Data" button on the Applicant Master
# list (see applicant_master_list.js). The on_update hooks above only ever
# sync a form's own record as it's saved; this walks every existing record
# of one chosen form and runs the same sync against each of them, for
# candidates who registered before this sync existed (or whose Applicant
# Master row needs rebuilding for any other reason). Safe to re-run any
# time — every sync call is match-and-upsert, never a blind insert.
# ---------------------------------------------------------------------------

_SOURCE_DOCTYPE_SYNC_FN = {
    "Field Registration Form": sync_field_registration_to_applicant_master,
    "Health Registration Form": sync_health_registration_to_applicant_master,
    "Phil Registration Form": sync_phil_registration_to_applicant_master,
    "Scholarship Recruitment Form": sync_scholarship_registration_to_applicant_master,
}


@frappe.whitelist()
def fetch_all_from_form(source_doctype):
    """Whitelisted entry point for the "Fetch All Data" button. Queues the
    actual work (run_backfill) on a background worker instead of running it
    inline — a form with 1000+ records takes long enough that doing this
    synchronously inside the HTTP request would hit the request timeout."""
    if source_doctype not in _SOURCE_DOCTYPE_SYNC_FN:
        frappe.throw(f"'{source_doctype}' is not one of the four registration forms.")

    frappe.enqueue(
        "ms_calendar.api.applicant_master_sync.run_backfill",
        queue="long",
        timeout=3600,
        job_name=f"applicant_master_backfill::{source_doctype}",
        source_doctype=source_doctype,
        requesting_user=frappe.session.user,
    )
    return {"queued": True}


def run_backfill(source_doctype, requesting_user=None):
    """The actual backfill, run on a background worker (see
    fetch_all_from_form above). Publishes progress + a final realtime event
    so the browser that clicked the button can show a progress bar and a
    finish summary without polling."""
    sync_fn = _SOURCE_DOCTYPE_SYNC_FN[source_doctype]
    names = frappe.get_all(source_doctype, pluck="name", order_by="creation asc")
    total = len(names)
    ok = 0
    errors = []

    for i, name in enumerate(names, start=1):
        try:
            doc = frappe.get_doc(source_doctype, name)
            sync_fn(doc)
            ok += 1
        except Exception:
            errors.append(f"{name}: {frappe.get_traceback()}")
            frappe.log_error(
                title="Applicant Master Backfill Error",
                message=f"{source_doctype} {name}: {frappe.get_traceback()}",
            )

        if i % 20 == 0 or i == total:
            # frappe.publish_progress() has no `user` param in this version
            # (it just uses frappe.session.user, which a background worker
            # may not have set to the button-clicker) — publish the same
            # "progress" event it would, but targeted explicitly.
            frappe.publish_realtime(
                "progress",
                {
                    "percent": (i / total * 100) if total else 100,
                    "title": f"Fetching {source_doctype} data",
                    "description": f"{i} / {total} processed",
                },
                user=requesting_user,
            )
        if i % 100 == 0:
            frappe.db.commit()

    frappe.db.commit()

    frappe.publish_realtime(
        "applicant_master_backfill_done",
        {
            "source_doctype": source_doctype,
            "total": total,
            "ok": ok,
            "error_count": len(errors),
            # first few only — the rest are in Error Log (see log_error above)
            "errors": errors[:10],
        },
        user=requesting_user,
    )
