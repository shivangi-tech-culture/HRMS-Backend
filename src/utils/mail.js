/**
 * Email helpers (Zoho SMTP)
 *
 * Env: EMAIL_USER_EZ, EMAIL_PASS_EZ, SMTP_HOST_EZ, SMTP_PORT_EZ
 * Sends a welcome email whenever a user is created (API or seed).
 */
const nodemailer = require("nodemailer");

/** Build a nodemailer transporter from .env */
function createTransporter() {
  const user = process.env.EMAIL_USER_EZ;
  const pass = String(process.env.EMAIL_PASS_EZ || "").replace(/\s+/g, "");
  const host = process.env.SMTP_HOST_EZ || "smtp.zoho.com";
  const port = Number(process.env.SMTP_PORT_EZ || 587);

  if (!user || !pass) {
    throw new Error(
      "Mail not configured. Set EMAIL_USER_EZ and EMAIL_PASS_EZ in .env"
    );
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = SSL, 587 = STARTTLS
    auth: { user, pass },
  });
}

/**
 * Send welcome email when any user is created
 * (Super Admin / Manager / Employee — seed or API)
 */
const sendWelcomeEmail = async ({ name, email, password, role, company, department }) => {
  const fromName = process.env.EMAIL_FROM_NAME || "TechCulture HR";
  const fromEmail = process.env.EMAIL_USER_EZ;
  const appUrl = process.env.APP_URL || "https://hrms-techculture.vercel.app";
  const roleLabel = role || "Employee";
  const transporter = createTransporter();

  const html = `
  <div style="font-family: Arial, Helvetica, sans-serif; background:#f4f6f8; padding:24px;">
    <div style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.06);">
      <div style="background:#0f766e; color:#fff; padding:20px 24px;">
        <h1 style="margin:0; font-size:20px;">Welcome to ${company || "TechCulture"}</h1>
        <p style="margin:8px 0 0; opacity:0.9; font-size:14px;">Your HR workspace account is ready</p>
      </div>

      <div style="padding:24px;">
        <p style="font-size:15px; color:#111; margin-top:0;">Hi <strong>${name}</strong>,</p>
        <p style="font-size:14px; color:#333; line-height:1.6;">
          We're excited to have you on board${department ? ` in <strong>${department}</strong>` : ""}.
          Your account has been created successfully.
        </p>

        <div style="background:#f0fdfa; border:1px solid #99f6e4; border-radius:8px; padding:16px; margin:20px 0;">
          <p style="margin:0 0 8px; font-size:13px; color:#0f766e; font-weight:bold;">Your login credentials</p>
          <p style="margin:4px 0; font-size:14px; color:#111;"><strong>Email:</strong> ${email}</p>
          <p style="margin:4px 0; font-size:14px; color:#111;"><strong>Password:</strong> ${password}</p>
          <p style="margin:4px 0; font-size:14px; color:#111;"><strong>Role:</strong> ${roleLabel}</p>
        </div>

        <p style="font-size:13px; color:#555; line-height:1.5;">
          Please sign in and change your password after first login for security.
        </p>

        <p style="margin:24px 0;">
          <a href="${appUrl}" style="display:inline-block; background:#0f766e; color:#fff; text-decoration:none; padding:12px 20px; border-radius:8px; font-size:14px; font-weight:bold;">
            Go to HR Portal
          </a>
        </p>

        <p style="font-size:13px; color:#666; margin-bottom:0;">
          Warm regards,<br/>
          <strong>${fromName}</strong><br/>
          TechCulture.Ai
        </p>
      </div>

      <div style="background:#f8fafc; padding:12px 24px; font-size:11px; color:#94a3b8; text-align:center;">
        This is an automated message. Please do not reply to this email.
      </div>
    </div>
  </div>
  `;

  return transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: email,
    subject: `Welcome to ${company || "TechCulture"} — your account is ready`,
    text: `Hi ${name},\n\nWelcome! Your HR account is ready.\n\nEmail: ${email}\nPassword: ${password}\nRole: ${roleLabel}\n\nPlease login and change your password.\n\nRegards,\n${fromName}`,
    html,
  });
};

module.exports = { sendWelcomeEmail, createTransporter };
