import frappe
from frappe.utils import escape_html
from frappe.utils.file_manager import save_file
from frappe.utils.pdf import get_pdf


@frappe.whitelist()
def generate_feedback_pdf(applicant_id):

    if not applicant_id:
        return {"status": "error", "message": "Applicant ID required"}

    if not frappe.has_permission("Phil Registration Form", "write"):
        frappe.throw(
            "You don't have permission to generate feedback PDFs.",
            frappe.PermissionError,
        )

    try:
        # ---------------------------
        # 1️⃣ Fetch Feedbacks
        # ---------------------------
        feedbacks = frappe.get_all(
            "Philanthrophy Feedback Form",
            filters={"applicant_id": applicant_id},
            fields=[
                "name",
                "application_status",
                "interviewer_name",
                "phil_feedback",
                "feedback_date",
                "interview_status"
            ],
            order_by="creation asc"
        )

        if not feedbacks:
            return {"status": "error", "message": "No feedback found"}

        # ---------------------------
        # 2️⃣ Get Registration Doc (IMPORTANT FIX)
        # ---------------------------
        reg_name = frappe.db.get_value(
            "Phil Registration Form",
            {"applicant_id": applicant_id}
        )

        if not reg_name:
            return {"status": "error", "message": "Registration not found"}

        health_reg = frappe.get_doc("Phil Registration Form", reg_name)

        applicant_name = health_reg.name1 or applicant_id
        role = health_reg.role or "N/A"

        # ---------------------------
        # 3️⃣ Build HTML
        # ---------------------------
        html = f"""
        <h1>Interview Feedback Summary</h1>
        <p><b>Applicant ID:</b> {applicant_id}</p>
        <p><b>Applicant Name:</b> {applicant_name}</p>
        <p><b>Role:</b> {role}</p>
        <hr>
        """

        for fb in feedbacks:
            html += f"""
            <p><b>Round:</b> {fb.application_status}</p>
            <p><b>Interviewer:</b> {fb.interviewer_name}</p>
            <p><b>Date:</b> {fb.feedback_date or ''}</p>
            <p><b>Status:</b> {fb.interview_status}</p>
            <p><b>Feedback:</b> {fb.phil_feedback}</p>
            <hr>
            """

        # ---------------------------
        # 4️⃣ Generate PDF
        # ---------------------------
        pdf = get_pdf(html)

        filename = f"feedback_{applicant_id}.pdf"

        # ---------------------------
        # 5️⃣ Delete Old File
        # ---------------------------
        old_files = frappe.get_all(
            "File",
            filters={
                "file_name": filename,
                "attached_to_doctype": "Phil Registration Form",
                "attached_to_name": reg_name
            },
            pluck="name"
        )

        for f in old_files:
            frappe.delete_doc("File", f, force=True)

        # ---------------------------
        # 6️⃣ Save New File (PATH CREATED HERE)
        # ---------------------------
        file_doc = save_file(
            fname=filename,
            content=pdf,
            dt="Phil Registration Form",
            dn=reg_name,
            is_private=1
        )

        # 👉 THIS IS YOUR FILE PATH
        file_url = file_doc.file_url

        # Debug
        frappe.logger().info(f"Generated File URL: {file_url}")

        # ---------------------------
        # 7️⃣ Update Doc (PATH SET HERE)
        # ---------------------------
        health_reg.feedback_form = file_url

        health_reg.save(ignore_permissions=True)

        frappe.db.commit()

        return {
            "status": "success",
            "file_url": file_url,
            "message": "PDF generated and attached successfully"
        }

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Feedback PDF Error")
        return {
            "status": "error",
            "message": str(e)
        }