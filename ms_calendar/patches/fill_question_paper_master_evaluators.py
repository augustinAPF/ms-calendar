import frappe

# Copies the "Test result Selection Criteria", "Evaluator Name" and
# "Evaluator Email" columns of the Recruitment Team's "Test Subjects and SA
# Numbers.xlsx" (2026-10-08) onto Question Paper Master, which until now only
# had the earlier columns of that sheet. A row with an Evaluator Email gets the
# candidate's written answers emailed to that evaluator as soon as the
# candidate's Field MeritTrac result arrives
# (field_merit_trac.send_result_to_evaluator).
#
# Only fills fields that are still empty, so values edited from the Desk
# afterwards are never overwritten.

_SEND_TO_EVALUATORS = "The test papers should be sent to the evaluators for evaluation."
_DEFAULT_SELECTION_CRITERIA = "40% & Above"

_MALAVIKA = ("Malavika Rajnarayan", "malavika.rajnarayan@azimpremjifoundation.org")
_SAYONIKA = ("Sayonika Sengupta", "sayonika.sengupta@azimpremjifoundation.org")

# (test_subject, qp_set) -> (selection criteria, evaluator name, evaluator email)
_ROWS = {
    ("Secondary/High School English", 1): (
        _SEND_TO_EVALUATORS,
        "Sonalika Garai",
        "sonalika.garai@azimpremjifoundation.org",
    ),
    ("Secondary/High School Hindi", 1): (
        _SEND_TO_EVALUATORS,
        "Khajan Singh",
        "khajan.singh@azimpremjifoundation.org",
    ),
    # The sheet marks these two for evaluator review but leaves the evaluator
    # blank — fill it in from the Desk when one is assigned.
    ("Sr.Secondary/PU English", 1): (_SEND_TO_EVALUATORS, None, None),
    ("Sr.Secondary/PU Hindi", 1): (_SEND_TO_EVALUATORS, None, None),
    ("Sr.Secondary/PU Psychology", 0): (
        _SEND_TO_EVALUATORS,
        "Ophelia Eugene Lobo",
        "ophelia.lobo@azimpremjifoundation.org",
    ),
    ("Music", 1): (_SEND_TO_EVALUATORS, *_MALAVIKA),
    ("Music", 2): (_SEND_TO_EVALUATORS, *_MALAVIKA),
    ("Physical Education", 1): (_SEND_TO_EVALUATORS, *_MALAVIKA),
    ("Physical Education", 2): (_SEND_TO_EVALUATORS, *_MALAVIKA),
    ("Visual Art", 1): (_SEND_TO_EVALUATORS, *_MALAVIKA),
    ("Visual Art", 2): (_SEND_TO_EVALUATORS, *_MALAVIKA),
    ("Special Education", 1): (_SEND_TO_EVALUATORS, *_SAYONIKA),
    ("Special Education", 2): (_SEND_TO_EVALUATORS, *_SAYONIKA),
    # No criteria at all in the sheet.
    ("Student counsellor", 0): (None, None, None),
}


def execute():
    if not frappe.db.exists("DocType", "Question Paper Master"):
        return
    # The fields were added on each site directly (cloud's copy is a Custom
    # DocType in module "Field") — no reload_doc, which would move it to this
    # app's module. Skip on a site that doesn't have them yet.
    if not frappe.get_meta("Question Paper Master").has_field("evaluator_email"):
        return

    for row in frappe.get_all(
        "Question Paper Master",
        fields=[
            "name",
            "test_subject",
            "qp_set",
            "test_result_selection_criteria",
            "evaluator_name",
            "evaluator_email",
        ],
        limit_page_length=0,
    ):
        criteria, evaluator_name, evaluator_email = _ROWS.get(
            (row.test_subject, row.qp_set or 0),
            (_DEFAULT_SELECTION_CRITERIA, None, None),
        )
        updates = {}
        if criteria and not row.test_result_selection_criteria:
            updates["test_result_selection_criteria"] = criteria
        if evaluator_name and not row.evaluator_name:
            updates["evaluator_name"] = evaluator_name
        if evaluator_email and not row.evaluator_email:
            updates["evaluator_email"] = evaluator_email
        if updates:
            frappe.db.set_value(
                "Question Paper Master", row.name, updates, update_modified=False
            )
