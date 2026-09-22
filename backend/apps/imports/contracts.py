"""Authoritative import/export workbook contracts (Phase H).

This module is the single source of truth for what the institutional
workbooks mean to AAMS:

- ``STUDENT_INSTITUTIONAL_HEADERS``  -- the real student roster column list as
  supplied by the institution (verbatim header text, column order preserved).
- ``STUDENT_HEADER_STATUS``          -- per-column classification used by the
  template builder, tests and the UI guidance.
- ``STUDENT_SYSTEM_EXPORT_HEADERS``  -- the AAMS canonical headers the server
  export writes (``STUDENT_EXPORT_HEADERS`` in ``exports.py``). Every header is
  an alias of the student importer so an exported workbook round-trips back
  into the import pipeline unchanged.
- ``TEACHER_SYSTEM_HEADERS``         -- the AAMS teacher template/export
  headers (alias-compatible with the teacher importer).
- ``TIMETABLE_SYSTEM_HEADERS``       -- the AAMS timetable template/export
  headers (alias-compatible with the timetable importer).

Honesty rules baked into this module:

- The **student** workbook is the *official institutional format* (the column
  list below). Do not rename or re-order it, and do not invent a 60th column
  that was not supplied.
- The **teacher** and **timetable** workbooks are the *current AAMS system
  template* -- no institutional workbook has been supplied for them yet.
  Nothing here guesses an institutional format; the templates are explicitly
  labelled as such (see ``templates.build_*template_bytes``).
- Column statuses are ruthlessly honest: ``required`` (blocks the import when
  missing), ``mapped`` (stored when present/parseable), ``informational``
  (read then discarded, and the importer says so), ``positional`` (a worksheet
  row marker, never data) and ``not_stored`` (accepted and *documented* as
  accepted-but-not-stored -- never silently dropped without a trace).
"""

# ---------------------------------------------------------------------------
# Student -- official institutional roster workbook (verbatim headers)
# ---------------------------------------------------------------------------

# EXACT header text from the institution's master list, in its original order.
# Treat as a verbatim contract: never re-word, re-order or pad this list.
STUDENT_INSTITUTIONAL_HEADERS = [
    "S.N.",
    "ID",
    "Name",
    "Roll Number",
    "Id Number",
    "National ID No.",
    "DOB (A.D.)",
    "DOB (B.S.)",
    "Gender",
    "Phone",
    "Email",
    "Perm. Address",
    "Temp. Address",
    "Type",
    "Program/Sec.",
    "Year/Semester",
    "Shift",
    "Previous School Name",
    "Familiar with Smartphone",
    "Religion",
    "Ethnic Group",
    "Blood Group",
    "Disability",
    "Mother Tongue",
    "EMIS ID",
    "Symbol No.",
    "Registration No.",
    "House",
    "Referred By",
    "Label",
    "Joined Date",
    "Father's Name",
    "Father's Phone",
    "Mother's Name",
    "Mother's Phone",
    "Local Guardian's Name",
    "Local Guardian's Phone",
    "Current Guardian",
    "Status",
    "Lunch",
    "Lunch Type",
    "Perm State",
    "Perm District",
    "Perm City",
    "Perm Municipality",
    "Perm Ward No.",
    "Perm House No.",
    "Perm Telephone No.",
    "Perm Street",
    "Temp State",
    "Temp District",
    "Temp City",
    "Temp Municipality",
    "Temp Ward No.",
    "Temp House No.",
    "Temp Telephone No.",
    "Temp Street",
    "Remarks",
    "Sponsor Name",
]

# Ordered student import pipelines accept these required fields; the template
# carries the full official list, but only these are mandatory for an import.
STUDENT_REQUIRED_FIELDS = ("student_id", "name", "email", "roll_no")

# Per-column classification. ``field`` is the canonical importer field name
# when the column maps to one; otherwise None (accepted-but-not-stored).
STUDENT_HEADER_STATUS = {
    "S.N.": "positional",
    "ID": "required",
    "Name": "required",
    "Roll Number": "required",
    "Id Number": "not_stored",        # secondary identity col; "ID" wins
    "National ID No.": "not_stored",
    "DOB (A.D.)": "mapped",
    "DOB (B.S.)": "mapped",           # parsed then flagged unconvertible
    "Gender": "informational",        # read, reported, never saved
    "Phone": "mapped",
    "Email": "required",
    "Perm. Address": "mapped",
    "Temp. Address": "not_stored",
    "Type": "not_stored",
    "Program/Sec.": "mapped",         # -> section
    "Year/Semester": "mapped",        # -> semester
    "Shift": "not_stored",
    "Previous School Name": "not_stored",
    "Familiar with Smartphone": "not_stored",
    "Religion": "not_stored",
    "Ethnic Group": "not_stored",
    "Blood Group": "not_stored",
    "Disability": "not_stored",
    "Mother Tongue": "not_stored",
    "EMIS ID": "not_stored",
    "Symbol No.": "not_stored",
    "Registration No.": "not_stored",
    "House": "not_stored",
    "Referred By": "not_stored",
    "Label": "not_stored",
    "Joined Date": "mapped",          # -> admission_year
    "Father's Name": "mapped",        # -> guardian_name
    "Father's Phone": "mapped",       # -> guardian_phone
    "Mother's Name": "not_stored",
    "Mother's Phone": "not_stored",
    "Local Guardian's Name": "not_stored",
    "Local Guardian's Phone": "not_stored",
    "Current Guardian": "not_stored",
    "Status": "mapped",
    "Lunch": "not_stored",
    "Lunch Type": "not_stored",
    "Perm State": "not_stored",
    "Perm District": "not_stored",
    "Perm City": "not_stored",
    "Perm Municipality": "not_stored",
    "Perm Ward No.": "not_stored",
    "Perm House No.": "not_stored",
    "Perm Telephone No.": "not_stored",
    "Perm Street": "not_stored",
    "Temp State": "not_stored",
    "Temp District": "not_stored",
    "Temp City": "not_stored",
    "Temp Municipality": "not_stored",
    "Temp Ward No.": "not_stored",
    "Temp House No.": "not_stored",
    "Temp Telephone No.": "not_stored",
    "Temp Street": "not_stored",
    "Remarks": "not_stored",
    "Sponsor Name": "not_stored",
}

# Canonical field for each mapped student column (template/UI guidance only;
# the authoritative alias table lives in ``student_import.FIELD_ALIASES``).
STUDENT_HEADER_FIELD = {
    "DOB (A.D.)": "dob",
    "DOB (B.S.)": "dob_bs",
    "Phone": "phone",
    "Perm. Address": "address",
    "Program/Sec.": "section",
    "Year/Semester": "semester",
    "Joined Date": "admission_year",
    "Father's Name": "guardian_name",
    "Father's Phone": "guardian_phone",
    "Status": "status",
}

# ---------------------------------------------------------------------------
# Teacher -- current AAMS system template (no institutional workbook supplied)
# ---------------------------------------------------------------------------

TEACHER_SYSTEM_HEADERS = [
    "Teacher ID",
    "Name",
    "Email",
    "Phone",
    "Department",
    "Designation",
    "Qualification",
    "Status",
]

TEACHER_REQUIRED_FIELDS = ("teacher_id", "name", "email")

TEACHER_HEADER_STATUS = {
    "Teacher ID": "required",
    "Name": "required",
    "Email": "required",
    "Phone": "mapped",
    "Department": "mapped",
    "Designation": "mapped",
    "Qualification": "mapped",
    "Status": "mapped",
}

# ---------------------------------------------------------------------------
# Timetable -- current AAMS system template (no institutional workbook supplied)
# ---------------------------------------------------------------------------

TIMETABLE_SYSTEM_HEADERS = [
    "Semester",
    "Section",
    "Day",
    "Start Time",
    "End Time",
    "Module Code",
    "Module Title",
    "Teacher ID",
    "Lecturer",
    "Class Type",
    "Room",
]

# The timetable importer's required logical groups (see
# ``timetable_import._validate_required_columns``).
TIMETABLE_REQUIRED_GROUPS = (
    "Semester", "Section", "Day", "Teacher ID/Lecturer",
    "Module Code/Module Title", "Start Time",
)

TIMETABLE_HEADER_STATUS = {
    "Semester": "required",
    "Section": "required",
    "Day": "required",
    "Start Time": "required",
    "End Time": "mapped",
    "Module Code": "mapped",      # either Module Code or Module Title required
    "Module Title": "mapped",
    "Teacher ID": "mapped",       # either Teacher ID or Lecturer required
    "Lecturer": "mapped",
    "Class Type": "mapped",
    "Room": "mapped",
}

# ---------------------------------------------------------------------------
# Labels shared by the templates + UI
# ---------------------------------------------------------------------------

STUDENT_TEMPLATE_LABEL = "AAMS Student Roster Template — Official Institutional Format"
TEACHER_TEMPLATE_LABEL = "AAMS Teacher Roster Template — CURRENT AAMS SYSTEM FORMAT"
TIMETABLE_TEMPLATE_LABEL = "AAMS Timetable Template — CURRENT AAMS SYSTEM FORMAT"

STUDENT_TEMPLATE_FILENAME = "aams_student_import_template.xlsx"
TEACHER_TEMPLATE_FILENAME = "aams_teacher_import_template.xlsx"
TIMETABLE_TEMPLATE_FILENAME = "aams_timetable_import_template.xlsx"

STUDENT_EXPORT_FILENAME = "aams_students_export.xlsx"
TEACHER_EXPORT_FILENAME = "aams_teachers_export.xlsx"
TIMETABLE_EXPORT_FILENAME = "aams_timetable_export.xlsx"

XLSX_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)