"""Finance Fellowship fields on the Enablers Registration Form.

Generated from the former Finance Fellowship Registration Form DocType.
Fellowship applicants are Enablers Registration Forms with sub-unit
"Finance Fellowship"; ms_enablers.ensure_enablers_schema() adds these
fields (shown only for that sub-unit). Fields both forms already had
(name, email, resume, ug_/pg_ degree/year/university, workflow dates …)
are shared, not repeated. Selects / Data are length-capped to keep the
custom table's row size in MariaDB's 64 KB limit.
"""

FELLOWSHIP_FIELDS = [{'fieldname': 'fellowship_tab',
  'fieldtype': 'Tab Break',
  'label': 'Fellowship',
  'depends_on': 'eval:doc.department=="Finance Fellowship"'},
 {'fieldname': 'application_section',
  'fieldtype': 'Section Break',
  'label': 'Application',
  'depends_on': 'eval:doc.department=="Finance Fellowship"'},
 {'fieldname': 'application_date',
  'fieldtype': 'Datetime',
  'label': 'Application Date',
  'default': 'now',
  'read_only': 1},
 {'fieldname': 'column_break_status', 'fieldtype': 'Column Break'},
 {'fieldname': 'reason_for_regret',
  'fieldtype': 'Select',
  'label': 'Reason for regret',
  'options': '\n'
             'Communication / Languages\n'
             'Compensation\n'
             'Documents\n'
             'Duplicate\n'
             'Education / Qualification\n'
             'Interest in role / Foundation\n'
             'Location / Travel\n'
             'Subject knowledge\n'
             'Work experience\n'
             'No show\n'
             'Withdrawn by applicant\n'
             'Others',
  'depends_on': 'eval:(doc.application_status||"").startsWith("Regret")',
  'length': 60},
 {'fieldname': 'reason_for_hold',
  'fieldtype': 'Select',
  'label': 'Reason for hold',
  'options': '\n'
             'Communication / Languages\n'
             'Compensation\n'
             'Documents\n'
             'Duplicate\n'
             'Education / Qualification\n'
             'Interest in role / Foundation\n'
             'Location / Travel\n'
             'Subject knowledge\n'
             'Work experience\n'
             'No show\n'
             'Withdrawn by applicant\n'
             'Others',
  'depends_on': 'eval:(doc.application_status||"").startsWith("On hold")',
  'length': 60},
 {'fieldname': 'recruiter_remarks', 'fieldtype': 'Small Text', 'label': 'Recruiter remarks'},
 {'fieldname': 'gender',
  'fieldtype': 'Select',
  'label': 'Gender',
  'options': '\nMale\nFemale\nOther',
  'in_standard_filter': 1,
  'length': 60},
 {'fieldname': 'background_section',
  'fieldtype': 'Section Break',
  'depends_on': 'eval:doc.department=="Finance Fellowship"'},
 {'fieldname': 'foundation_selection',
  'fieldtype': 'Select',
  'label': 'Have you been part of the Foundation’s selection process in the past?',
  'options': '\nYes\nNo',
  'length': 60},
 {'fieldname': 'previous_application_details',
  'fieldtype': 'Small Text',
  'label': 'Please mention the details of your previous application',
  'depends_on': 'eval:doc.foundation_selection=="Yes"',
  'mandatory_depends_on': 'eval:doc.foundation_selection=="Yes"'},
 {'fieldname': 'column_break_background', 'fieldtype': 'Column Break'},
 {'fieldname': 'foundation_association',
  'fieldtype': 'Select',
  'label': 'Are you/your family or your current employer associated with Azim Premji Foundation in any way?',
  'options': '\nYes\nNo',
  'length': 60},
 {'fieldname': 'association_details',
  'fieldtype': 'Small Text',
  'label': 'Please mention the details of the association with us',
  'depends_on': 'eval:doc.foundation_association=="Yes"',
  'mandatory_depends_on': 'eval:doc.foundation_association=="Yes"'},
 {'fieldname': 'ug_section',
  'fieldtype': 'Section Break',
  'label': 'Under Graduation (UG)',
  'depends_on': 'eval:doc.department=="Finance Fellowship"'},
 {'fieldname': 'ug_degree_other',
  'fieldtype': 'Data',
  'label': "Please mention your Bachelor's degree",
  'depends_on': 'eval:doc.ug_degree=="Others"',
  'mandatory_depends_on': 'eval:doc.ug_degree=="Others"',
  'length': 120},
 {'fieldname': 'ug_year_other',
  'fieldtype': 'Int',
  'label': 'Please mention the year of UG completion',
  'depends_on': 'eval:doc.ug_year=="Other"',
  'mandatory_depends_on': 'eval:doc.ug_year=="Other"'},
 {'fieldname': 'ug_institution',
  'fieldtype': 'Data',
  'label': 'Name of the Institution where you completed your UG',
  'length': 120},
 {'fieldname': 'column_break_ug', 'fieldtype': 'Column Break'},
 {'fieldname': 'ug_state',
  'fieldtype': 'Select',
  'label': 'Name of the State where you studied your UG',
  'options': '\n'
             'Andaman and Nicobar Islands\n'
             'Andhra Pradesh\n'
             'Arunachal Pradesh\n'
             'Assam\n'
             'Bihar\n'
             'Chandigarh\n'
             'Chhattisgarh\n'
             'Dadra and Nagar Haveli and Daman and Diu\n'
             'Delhi\n'
             'Goa\n'
             'Gujarat\n'
             'Haryana\n'
             'Himachal Pradesh\n'
             'Jammu and Kashmir\n'
             'Jharkhand\n'
             'Karnataka\n'
             'Kerala\n'
             'Ladakh\n'
             'Lakshadweep\n'
             'Madhya Pradesh\n'
             'Maharashtra\n'
             'Manipur\n'
             'Meghalaya\n'
             'Mizoram\n'
             'Nagaland\n'
             'Odisha\n'
             'Puducherry\n'
             'Punjab\n'
             'Rajasthan\n'
             'Sikkim\n'
             'Tamil Nadu\n'
             'Telangana\n'
             'Tripura\n'
             'Uttar Pradesh\n'
             'Uttarakhand\n'
             'West Bengal\n'
             'Other',
  'length': 60},
 {'fieldname': 'ug_state_other',
  'fieldtype': 'Data',
  'label': 'Please mention the State where you studied your UG',
  'depends_on': 'eval:doc.ug_state=="Other"',
  'mandatory_depends_on': 'eval:doc.ug_state=="Other"',
  'length': 120},
 {'fieldname': 'ug_location',
  'fieldtype': 'Data',
  'label': 'Name of the Location where you pursued your UG',
  'length': 120},
 {'fieldname': 'ug_mode',
  'fieldtype': 'Select',
  'label': 'Mode of Graduation',
  'options': '\nRegular\nDistance',
  'length': 60},
 {'fieldname': 'pg_section',
  'fieldtype': 'Section Break',
  'label': 'Post Graduation (PG)',
  'depends_on': 'eval:doc.department=="Finance Fellowship"'},
 {'fieldname': 'pg_degree_other',
  'fieldtype': 'Data',
  'label': "Please mention your Master's degree",
  'depends_on': 'eval:doc.pg_degree=="Others"',
  'mandatory_depends_on': 'eval:doc.pg_degree=="Others"',
  'length': 120},
 {'fieldname': 'pg_duration',
  'fieldtype': 'Select',
  'label': 'Duration of the PG course',
  'options': '\n2 Years\n3 Years\n4 Years\nOther',
  'length': 60},
 {'fieldname': 'pg_duration_other',
  'fieldtype': 'Data',
  'label': 'Please mention the duration of the course',
  'depends_on': 'eval:doc.pg_duration=="Other"',
  'mandatory_depends_on': 'eval:doc.pg_duration=="Other"',
  'length': 120},
 {'fieldname': 'pg_year_other',
  'fieldtype': 'Int',
  'label': 'Please mention the year of PG completion',
  'depends_on': 'eval:doc.pg_year=="Other"',
  'mandatory_depends_on': 'eval:doc.pg_year=="Other"'},
 {'fieldname': 'pg_institution',
  'fieldtype': 'Data',
  'label': 'Name of the Institution where you completed your PG',
  'length': 120},
 {'fieldname': 'column_break_pg', 'fieldtype': 'Column Break'},
 {'fieldname': 'pg_state',
  'fieldtype': 'Select',
  'label': 'Name of the State where you studied your PG',
  'options': '\n'
             'Andaman and Nicobar Islands\n'
             'Andhra Pradesh\n'
             'Arunachal Pradesh\n'
             'Assam\n'
             'Bihar\n'
             'Chandigarh\n'
             'Chhattisgarh\n'
             'Dadra and Nagar Haveli and Daman and Diu\n'
             'Delhi\n'
             'Goa\n'
             'Gujarat\n'
             'Haryana\n'
             'Himachal Pradesh\n'
             'Jammu and Kashmir\n'
             'Jharkhand\n'
             'Karnataka\n'
             'Kerala\n'
             'Ladakh\n'
             'Lakshadweep\n'
             'Madhya Pradesh\n'
             'Maharashtra\n'
             'Manipur\n'
             'Meghalaya\n'
             'Mizoram\n'
             'Nagaland\n'
             'Odisha\n'
             'Puducherry\n'
             'Punjab\n'
             'Rajasthan\n'
             'Sikkim\n'
             'Tamil Nadu\n'
             'Telangana\n'
             'Tripura\n'
             'Uttar Pradesh\n'
             'Uttarakhand\n'
             'West Bengal\n'
             'Other',
  'length': 60},
 {'fieldname': 'pg_state_other',
  'fieldtype': 'Data',
  'label': 'Please mention the State where you studied your PG',
  'depends_on': 'eval:doc.pg_state=="Other"',
  'mandatory_depends_on': 'eval:doc.pg_state=="Other"',
  'length': 120},
 {'fieldname': 'pg_location',
  'fieldtype': 'Data',
  'label': 'Name of the Location where you pursued your PG',
  'length': 120},
 {'fieldname': 'pg_mode',
  'fieldtype': 'Select',
  'label': 'Mode of Post Graduation',
  'options': '\nRegular\nDistance',
  'length': 60},
 {'fieldname': 'professional_section',
  'fieldtype': 'Section Break',
  'label': 'CA (Inter) / CMA (ICWA) / CS (Inter)',
  'depends_on': 'eval:doc.department=="Finance Fellowship"'},
 {'fieldname': 'professional_qualification',
  'fieldtype': 'Select',
  'label': 'This Fellowship is for CA (Inter)/ CMA (ICWA)/CS (Inter) only. Please provide the details of your '
           'qualification',
  'options': '\nCA (Inter)\nCMA (ICWA)\nCS (Inter)\nOthers',
  'in_standard_filter': 1,
  'length': 60},
 {'fieldname': 'professional_qualification_other',
  'fieldtype': 'Data',
  'label': 'Please mention your qualification',
  'depends_on': 'eval:doc.professional_qualification=="Others"',
  'mandatory_depends_on': 'eval:doc.professional_qualification=="Others"',
  'length': 120},
 {'fieldname': 'professional_year',
  'fieldtype': 'Select',
  'label': 'In which year did you complete your CA (Inter)/ CMA (ICWA)/CS (Inter)?',
  'options': '\n2025\n2024\n2023\n2022\n2021\n2020\n2019\n2018\nOther',
  'length': 60},
 {'fieldname': 'professional_year_other',
  'fieldtype': 'Int',
  'label': 'Please mention the year of completion',
  'depends_on': 'eval:doc.professional_year=="Other"',
  'mandatory_depends_on': 'eval:doc.professional_year=="Other"'},
 {'fieldname': 'professional_duration',
  'fieldtype': 'Select',
  'label': 'Duration of the CA (Inter)/ CMA (ICWA)/CS (Inter) course',
  'options': '\n2 Years\n3 Years\nOther',
  'length': 60},
 {'fieldname': 'professional_duration_other',
  'fieldtype': 'Data',
  'label': 'Please mention the duration of the course',
  'depends_on': 'eval:doc.professional_duration=="Other"',
  'mandatory_depends_on': 'eval:doc.professional_duration=="Other"',
  'length': 120},
 {'fieldname': 'professional_institution',
  'fieldtype': 'Data',
  'label': 'Name of the Institution where you completed your CA (Inter)/ CMA (ICWA)/CS (Inter)',
  'length': 120},
 {'fieldname': 'column_break_professional', 'fieldtype': 'Column Break'},
 {'fieldname': 'professional_university',
  'fieldtype': 'Data',
  'label': 'Name of the University / Institute where you pursued your CA (Inter)/ CMA (ICWA)/CS (Inter)',
  'length': 120},
 {'fieldname': 'professional_state',
  'fieldtype': 'Select',
  'label': 'Name of the State where you studied your CA (Inter)/ CMA (ICWA)/CS (Inter)',
  'options': '\n'
             'Andaman and Nicobar Islands\n'
             'Andhra Pradesh\n'
             'Arunachal Pradesh\n'
             'Assam\n'
             'Bihar\n'
             'Chandigarh\n'
             'Chhattisgarh\n'
             'Dadra and Nagar Haveli and Daman and Diu\n'
             'Delhi\n'
             'Goa\n'
             'Gujarat\n'
             'Haryana\n'
             'Himachal Pradesh\n'
             'Jammu and Kashmir\n'
             'Jharkhand\n'
             'Karnataka\n'
             'Kerala\n'
             'Ladakh\n'
             'Lakshadweep\n'
             'Madhya Pradesh\n'
             'Maharashtra\n'
             'Manipur\n'
             'Meghalaya\n'
             'Mizoram\n'
             'Nagaland\n'
             'Odisha\n'
             'Puducherry\n'
             'Punjab\n'
             'Rajasthan\n'
             'Sikkim\n'
             'Tamil Nadu\n'
             'Telangana\n'
             'Tripura\n'
             'Uttar Pradesh\n'
             'Uttarakhand\n'
             'West Bengal\n'
             'Other',
  'length': 60},
 {'fieldname': 'professional_state_other',
  'fieldtype': 'Data',
  'label': 'Please mention the State',
  'depends_on': 'eval:doc.professional_state=="Other"',
  'mandatory_depends_on': 'eval:doc.professional_state=="Other"',
  'length': 120},
 {'fieldname': 'professional_location',
  'fieldtype': 'Data',
  'label': 'Name of the Location where you pursued your CA (Inter)/ CMA (ICWA)/CS (Inter)',
  'length': 120},
 {'fieldname': 'experience_section',
  'fieldtype': 'Section Break',
  'label': 'Experience and Preferences',
  'depends_on': 'eval:doc.department=="Finance Fellowship"'},
 {'fieldname': 'work_experience',
  'fieldtype': 'Select',
  'label': 'Total years of work experience',
  'options': '\nFresher\n1 year\n2 years\n3 years\n4 years\n5 years\n6 years\n7 years or more',
  'in_standard_filter': 1,
  'length': 60},
 {'fieldname': 'last_drawn_salary',
  'fieldtype': 'Select',
  'label': 'What is your last drawn monthly compensation/salary?',
  'options': '\n'
             'Not applicable (Fresher)\n'
             'Less than 50,000\n'
             '50,001 - 60,000\n'
             '60,001 - 70,000\n'
             '70,001 - 80,000\n'
             '80,001 - 90,000\n'
             '90,001 - 1,00,000\n'
             '1,00,001 - 1,10,000\n'
             '1,10,001 - 1,20,000\n'
             '1,20,001 - 1,30,000\n'
             '1,30,001 - 1,40,000\n'
             '1,40,001 - 1,50,000\n'
             'More than 1,50,000',
  'length': 60},
 {'fieldname': 'why_interested', 'fieldtype': 'Text', 'label': 'Why are you interested in this Fellowship?'},
 {'fieldname': 'column_break_experience', 'fieldtype': 'Column Break'},
 {'fieldname': 'open_to_bangalore',
  'fieldtype': 'Select',
  'label': 'Are you open to be placed in Bangalore?',
  'options': '\nYes\nNo',
  'length': 60},
 {'fieldname': 'open_to_travel',
  'fieldtype': 'Select',
  'label': 'Are you open to travel?',
  'options': '\nYes\nNo',
  'length': 60},
 {'fieldname': 'languages_section',
  'fieldtype': 'Section Break',
  'label': 'Please mention all the languages you know (Speak)',
  'description': 'Choose at least two languages.',
  'depends_on': 'eval:doc.department=="Finance Fellowship"'},
 {'fieldname': 'lang_english', 'fieldtype': 'Check', 'label': 'English'},
 {'fieldname': 'lang_bengali', 'fieldtype': 'Check', 'label': 'Bengali'},
 {'fieldname': 'lang_chhattisgarhi', 'fieldtype': 'Check', 'label': 'Chhattisgarhi'},
 {'fieldname': 'lang_gujarati', 'fieldtype': 'Check', 'label': 'Gujarati'},
 {'fieldname': 'lang_hindi', 'fieldtype': 'Check', 'label': 'Hindi'},
 {'fieldname': 'column_break_languages', 'fieldtype': 'Column Break'},
 {'fieldname': 'lang_kannada', 'fieldtype': 'Check', 'label': 'Kannada'},
 {'fieldname': 'lang_malayalam', 'fieldtype': 'Check', 'label': 'Malayalam'},
 {'fieldname': 'lang_marathi', 'fieldtype': 'Check', 'label': 'Marathi'},
 {'fieldname': 'lang_odia', 'fieldtype': 'Check', 'label': 'Odia'},
 {'fieldname': 'lang_tamil', 'fieldtype': 'Check', 'label': 'Tamil'},
 {'fieldname': 'source_section',
  'fieldtype': 'Section Break',
  'depends_on': 'eval:doc.department=="Finance Fellowship"'},
 {'fieldname': 'opportunity_source',
  'fieldtype': 'Select',
  'label': 'How did you get to know about this opportunity?',
  'options': '\n'
             'LinkedIn\n'
             'Indeed\n'
             'WhatsApp\n'
             'Facebook\n'
             'Instagram\n'
             'X (Twitter)\n'
             'Reddit\n'
             'College / Alumni\n'
             'Referral from employee of Azim Premji Foundation\n'
             'Others',
  'in_standard_filter': 1,
  'length': 60},
 {'fieldname': 'referral_details',
  'fieldtype': 'Data',
  'label': 'Please mention the full name, role and location of the employee',
  'depends_on': 'eval:doc.opportunity_source=="Referral from employee of Azim Premji Foundation"',
  'mandatory_depends_on': 'eval:doc.opportunity_source=="Referral from employee of Azim Premji Foundation"',
  'length': 120},
 {'fieldname': 'source_other',
  'fieldtype': 'Small Text',
  'label': 'Please mention how you got to know about this opportunity',
  'depends_on': 'eval:doc.opportunity_source=="Others"',
  'mandatory_depends_on': 'eval:doc.opportunity_source=="Others"'},
 {'fieldname': 'declaration_section',
  'fieldtype': 'Section Break',
  'label': 'Self-declaration',
  'depends_on': 'eval:doc.department=="Finance Fellowship"'},
 {'fieldname': 'authorisation',
  'fieldtype': 'Check',
  'label': 'Authorisation',
  'description': 'I authorise Azim Premji Foundation or its agency to verify the information provided in this form and '
                 'if found to be false, I could be denied Fellowship / my Fellowship could be discontinued'},
 {'fieldname': 'selection_tab',
  'fieldtype': 'Tab Break',
  'label': 'Fellowship Selection',
  'depends_on': 'eval:doc.department=="Finance Fellowship"'},
 {'fieldname': 'documents_section',
  'fieldtype': 'Section Break',
  'label': 'Documents',
  'depends_on': 'eval:doc.department=="Finance Fellowship"'},
 {'fieldname': 'application_form_requested_on',
  'fieldtype': 'Datetime',
  'label': 'Application Form requested on',
  'read_only': 1,
  'no_copy': 1},
 {'fieldname': 'application_form_received_on',
  'fieldtype': 'Datetime',
  'label': 'Application Form received on',
  'read_only': 1,
  'no_copy': 1},
 {'fieldname': 'fitment_section',
  'fieldtype': 'Section Break',
  'label': 'Salary Fitment (Compensation)',
  'depends_on': 'eval:doc.department=="Finance Fellowship"'},
 {'fieldname': 'fellow_category',
  'fieldtype': 'Select',
  'label': 'Fellow category',
  'options': '\nAssociate Fellow (0-2 years)\nFellow (more than 2 years)',
  'description': "Suggested from the applicant's work experience; change it if needed.",
  'length': 60},
 {'fieldname': 'monthly_stipend', 'fieldtype': 'Currency', 'label': 'Monthly stipend (INR)', 'options': 'INR'},
 {'fieldname': 'column_break_fitment', 'fieldtype': 'Column Break'},
 {'fieldname': 'fitment_remarks', 'fieldtype': 'Small Text', 'label': 'Fitment remarks'},
 {'fieldname': 'fitment_done_by',
  'fieldtype': 'Link',
  'label': 'Fitment done by',
  'options': 'User',
  'read_only': 1,
  'no_copy': 1},
 {'fieldname': 'fitment_done_on', 'fieldtype': 'Datetime', 'label': 'Fitment done on', 'read_only': 1, 'no_copy': 1},
 {'fieldname': 'offer_section',
  'fieldtype': 'Section Break',
  'label': 'Offer',
  'depends_on': 'eval:doc.department=="Finance Fellowship"'},
 {'fieldname': 'offer_letter', 'fieldtype': 'Attach', 'label': 'Offer letter', 'no_copy': 1},
 {'fieldname': 'offer_released_on',
  'fieldtype': 'Datetime',
  'label': 'Offer released on',
  'read_only': 1,
  'no_copy': 1},
 {'fieldname': 'date_of_joining', 'fieldtype': 'Date', 'label': 'Date of joining', 'no_copy': 1},
 {'fieldname': 'column_break_offer', 'fieldtype': 'Column Break'},
 {'fieldname': 'offer_response',
  'fieldtype': 'Select',
  'label': 'Offer response',
  'options': '\nAccepted\nDeclined',
  'read_only': 1,
  'no_copy': 1,
  'length': 60},
 {'fieldname': 'offer_response_on',
  'fieldtype': 'Datetime',
  'label': 'Offer response on',
  'read_only': 1,
  'no_copy': 1},
 {'fieldname': 'offer_decline_reason',
  'fieldtype': 'Small Text',
  'label': 'Reason for declining',
  'read_only': 1,
  'no_copy': 1,
  'depends_on': 'eval:doc.offer_response=="Declined"'}]
