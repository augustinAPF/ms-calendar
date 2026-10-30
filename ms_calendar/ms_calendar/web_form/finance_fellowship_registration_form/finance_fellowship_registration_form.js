// Finance Fellowship application (public). Rendered through Jinja by
// frappe, so keep curly-brace pairs out of this file.
// The server re-checks everything here (controller + otp.enforce_otp_verification);
// this is only so applicants see problems before clicking Submit.
const FF_LANGUAGES = [
	"lang_english", "lang_bengali", "lang_chhattisgarhi", "lang_gujarati", "lang_hindi",
	"lang_kannada", "lang_malayalam", "lang_marathi", "lang_odia", "lang_tamil",
];

// Runs after frappe's own web form setup (registered earlier), so
// frappe.web_form is the live form here. A plain after_load assignment in
// this file would land on the placeholder object frappe replaces.
frappe.ready(() => {
	// ---- Age from date of birth (shown on the form)
	frappe.web_form.on("date_of_birth", (field, value) => {
		if (!value) return frappe.web_form.set_value("age", null);
		const dob = moment(value);
		frappe.web_form.set_value("age", moment().diff(dob, "years"));
	});

	// ---- Email OTP (same widget as the Field / Health registration forms)
	const RESEND_COOLDOWN_SECS = 60;
	const SEND_BTN_STYLE = "background:#1f3a5f;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12.5px;font-weight:600;cursor:pointer;";
	const VERIFY_BTN_STYLE = "background:#2e7d4f;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12.5px;font-weight:600;cursor:pointer;margin-left:6px;";

	function setup_email_otp() {
		const wrapper = document.querySelector('[data-fieldname="email_address"]');
		const input = wrapper && wrapper.querySelector("input");
		if (!input) return () => false;

		let verified = false;
		let cooldownTimer = null;
		const box = document.createElement("div");
		box.style.marginTop = "8px";
		box.innerHTML = `
			<button type="button" class="otp-send-btn" style="${SEND_BTN_STYLE}">Generate OTP</button>
			<span class="otp-status" style="margin-left:10px;font-size:12px;font-weight:600;"></span>
			<div class="otp-verify-row" style="display:none;margin-top:8px;">
				<input type="text" class="form-control otp-code-input" placeholder="Enter OTP" style="max-width:160px;display:inline-block;">
				<button type="button" class="otp-verify-btn" style="${VERIFY_BTN_STYLE}">Verify</button>
			</div>`;
		wrapper.appendChild(box);

		const sendBtn = box.querySelector(".otp-send-btn");
		const status = box.querySelector(".otp-status");
		const verifyRow = box.querySelector(".otp-verify-row");
		const codeInput = box.querySelector(".otp-code-input");
		const verifyBtn = box.querySelector(".otp-verify-btn");

		const set_status = (msg, ok) => {
			status.textContent = msg;
			status.style.color = ok ? "#2e7d4f" : "#c0392b";
		};
		const set_disabled = (btn, disabled) => {
			btn.disabled = disabled;
			btn.style.opacity = disabled ? "0.6" : "1";
		};
		const stop_cooldown = () => {
			if (cooldownTimer) clearInterval(cooldownTimer);
			cooldownTimer = null;
		};
		const start_cooldown = () => {
			stop_cooldown();
			let remaining = RESEND_COOLDOWN_SECS;
			set_disabled(sendBtn, true);
			sendBtn.textContent = `Resend OTP (${remaining}s)`;
			cooldownTimer = setInterval(() => {
				remaining -= 1;
				if (remaining <= 0) {
					stop_cooldown();
					set_disabled(sendBtn, false);
					sendBtn.textContent = "Resend OTP";
				} else {
					sendBtn.textContent = `Resend OTP (${remaining}s)`;
				}
			}, 1000);
		};

		input.addEventListener("input", () => {
			if (!verified) return;
			verified = false;
			set_status("", true);
			sendBtn.style.display = "";
			set_disabled(sendBtn, false);
			sendBtn.textContent = "Generate OTP";
		});

		sendBtn.addEventListener("click", () => {
			const email = input.value.trim();
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return set_status("Enter a valid email address.", false);
			set_disabled(sendBtn, true);
			sendBtn.textContent = "Sending...";
			frappe.call({
				method: "ms_calendar.api.otp.send_email_otp",
				args: { email, doctype: "Finance Fellowship Registration Form" },
				callback: (r) => {
					if (r.message && r.message.success) {
						set_status(r.message.message || "OTP sent.", true);
						verifyRow.style.display = "block";
						start_cooldown();
					} else {
						set_disabled(sendBtn, false);
						sendBtn.textContent = "Generate OTP";
						set_status((r.message && r.message.message) || "Failed to send OTP.", false);
					}
				},
				error: () => {
					set_disabled(sendBtn, false);
					sendBtn.textContent = "Generate OTP";
					set_status("Failed to send OTP. Please try again.", false);
				},
			});
		});

		verifyBtn.addEventListener("click", () => {
			const code = codeInput.value.trim();
			if (!code) return set_status("Please enter the OTP.", false);
			set_disabled(verifyBtn, true);
			frappe.call({
				method: "ms_calendar.api.otp.verify_email_otp",
				args: { email: input.value.trim(), otp: code },
				callback: (r) => {
					set_disabled(verifyBtn, false);
					if (r.message && r.message.success) {
						verified = true;
						stop_cooldown();
						verifyRow.style.display = "none";
						sendBtn.style.display = "none";
						status.innerHTML = '<span style="background:#e7f4ec;color:#1f5f3a;border:1px solid #9fd0b3;border-radius:999px;padding:3px 12px;font-weight:700;">&#10003; Verified</span>';
					} else {
						set_status((r.message && r.message.message) || "Incorrect OTP.", false);
					}
				},
				error: () => {
					set_disabled(verifyBtn, false);
					set_status("Verification failed. Please try again.", false);
				},
			});
		});
		return () => verified;
	}

	let isEmailVerified = () => false;
	setTimeout(() => (isEmailVerified = setup_email_otp()), 500);

	frappe.web_form.validate = () => {
		const v = frappe.web_form.get_values(true) || {};
		const phone = String(v.phone_number || "").replace(/\D/g, "").replace(/^91(\d{10})$/, "$1");
		if (phone.length !== 10) {
			frappe.msgprint("Please enter a valid 10-digit phone number.");
			return false;
		}
		const resume = String(v.resume || "").split("?")[0].toLowerCase();
		if (resume && !/\.(pdf|doc|docx)$/.test(resume)) {
			frappe.msgprint("Please upload your resume as a PDF, DOC or DOCX file.");
			return false;
		}
		if (FF_LANGUAGES.filter((f) => v[f]).length < 2) {
			frappe.msgprint("Please choose at least two languages you can speak.");
			return false;
		}
		if (!v.authorisation) {
			frappe.msgprint("Please tick the authorisation to submit your application.");
			return false;
		}
		if (!isEmailVerified()) {
			frappe.msgprint("Please verify your email address with the OTP before submitting.");
			return false;
		}
		return true;
	};
});
