/**
 * MAIL UTILS — send email via Zoho SMTP (nodemailer)
 * sendWelcomeEmail (user create) · sendEmail (POST /api/mail/send)
 */
const nodemailer = require("nodemailer");

/** Build nodemailer transporter from .env (Zoho SMTP) */
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

/** From display name + address for outgoing mail */
const fromAddress = () => {
  const fromName = process.env.EMAIL_FROM_NAME || "TechCulture HR";
  const fromEmail = process.env.EMAIL_USER_EZ;
  return { fromName, fromEmail, from: `"${fromName}" <${fromEmail}>` };
};

/** Escape plain text for safe HTML email bodies */
const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Welcome email after user create (includes login credentials) */
const sendWelcomeEmail = async ({ name, email, password, role, company, department }) => {
  const { fromName, from } = fromAddress();
  const appUrl = process.env.APP_URL || "https://hrms-techculture.vercel.app";
  const roleLabel = role || "Employee";
  const brand = company || "TechCulture.Ai";
  const transporter = createTransporter();

  const safe = {
    name: escapeHtml(name),
    email: escapeHtml(email),
    password: escapeHtml(password),
    role: escapeHtml(roleLabel),
    brand: escapeHtml(brand),
    dept: escapeHtml(department),
    fromName: escapeHtml(fromName),
    appUrl: escapeHtml(appUrl),
  };

  const deptLine = department
    ? `<p style="margin:16px 0 0;font-size:13px;color:#64748b;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">Department · <strong style="color:#0f172a;">${safe.dept}</strong></p>`
    : "";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Welcome</title>
</head>
<body style="margin:0;padding:0;background:#e8eef5;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#e8eef5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,0.12);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0b3d4a 0%,#0f766e 55%,#14b8a6 100%);padding:36px 36px 32px;">
              <p style="margin:0 0 10px;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,255,255,0.72);font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-weight:600;">
                ${safe.brand}
              </p>
              <h1 style="margin:0;font-size:26px;line-height:1.25;color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-weight:700;">
                Welcome to your HR portal
              </h1>
              <p style="margin:10px 0 0;font-size:15px;line-height:1.5;color:rgba(255,255,255,0.88);font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
                Your account is ready — sign in with the details below
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 36px 28px;">
              <p style="margin:0 0 12px;font-size:16px;color:#0f172a;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
                Hi <strong>${safe.name}</strong>,
              </p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#475569;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
                Welcome to <strong style="color:#0f172a;">${safe.brand}</strong>${department ? ` (${safe.dept})` : ""}.
                Your login is ready. Use these details to open the HR portal for the first time:
              </p>

              <!-- Simple 3 steps -->
              <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#64748b;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
                <strong style="color:#0f172a;">How to sign in</strong><br/>
                1. Open the HR portal (button below)<br/>
                2. Enter your email and password<br/>
                3. Change your password after first login
              </p>

              <!-- Credentials card -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                <tr>
                  <td style="padding:14px 20px;background:#0f172a;">
                    <p style="margin:0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-weight:600;">
                      Your login details
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:4px 20px 8px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="padding:14px 0;border-bottom:1px solid #e2e8f0;font-size:12px;color:#64748b;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;width:88px;vertical-align:top;">
                          Email
                        </td>
                        <td style="padding:14px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:#0f172a;font-family:Consolas,Monaco,monospace;font-weight:600;word-break:break-all;">
                          ${safe.email}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:14px 0;border-bottom:1px solid #e2e8f0;font-size:12px;color:#64748b;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;width:88px;vertical-align:top;">
                          Password
                        </td>
                        <td style="padding:14px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:#0f172a;font-family:Consolas,Monaco,monospace;font-weight:600;">
                          ${safe.password}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:14px 0;font-size:12px;color:#64748b;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;width:88px;vertical-align:top;">
                          Your role
                        </td>
                        <td style="padding:14px 0;">
                          <span style="display:inline-block;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:700;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
                            ${safe.role}
                          </span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              ${deptLine}

              <!-- Security note -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 28px;">
                <tr>
                  <td style="padding:14px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;font-size:13px;line-height:1.55;color:#92400e;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
                    <strong style="color:#78350f;">Keep it safe:</strong> After you sign in, please change this password. Do not share your email or password with anyone.
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 32px;">
                <tr>
                  <td align="center" style="border-radius:10px;background:#0f766e;">
                    <a href="${safe.appUrl}" target="_blank" style="display:inline-block;padding:14px 28px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.02em;">
                      Open HR Portal →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:14px;line-height:1.6;color:#64748b;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
                Need help? Contact your HR team.<br/><br/>
                Warm regards,<br/>
                <span style="color:#0f172a;font-weight:700;">${safe.fromName}</span><br/>
                <span style="color:#94a3b8;font-size:13px;">${safe.brand}</span>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:18px 36px;background:#f1f5f9;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0;font-size:11px;line-height:1.5;color:#94a3b8;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
                Automated message from ${safe.brand} HRMS · Please do not reply
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  return transporter.sendMail({
    from,
    to: email,
    subject: `Welcome to ${brand} — your account is ready`,
    text: `Hi ${name},\n\nWelcome to your HR portal at ${brand}. Your account is ready.\n\nHow to sign in:\n1. Open ${appUrl}\n2. Email: ${email}\n3. Password: ${password}\n4. Your role: ${roleLabel}\n\nPlease change your password after first login.\n\nRegards,\n${fromName}`,
    html,
  });
};

/** Generic send used by POST /api/mail/send */
const sendEmail = async ({ to, subject, body, cc, bcc, isHtml = false }) => {
  const { fromName, from } = fromAddress();
  const transporter = createTransporter();

  const text = isHtml
    ? String(body || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : String(body || "");

  const html = isHtml
    ? String(body || "")
    : `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.6;white-space:pre-wrap;">${escapeHtml(body)}</div>
       <p style="font-size:12px;color:#94a3b8;margin-top:24px;">Sent via ${escapeHtml(fromName)}</p>`;

  const info = await transporter.sendMail({
    from,
    to,
    cc: cc || undefined,
    bcc: bcc || undefined,
    subject,
    text: text || subject,
    html,
  });

  return {
    messageId: info.messageId,
    accepted: info.accepted || [],
    rejected: info.rejected || [],
  };
};

module.exports = { sendWelcomeEmail, sendEmail, createTransporter };
