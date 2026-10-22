/**
 * MAIL UTILS — send email
 * Prefer HTTPS APIs on Render (Brevo / Resend) — SMTP ports 465/587 are blocked on free tier.
 * Local: Zoho SMTP still works when no BREVO_API_KEY / RESEND_API_KEY is set.
 *
 * Create APIs use queueWelcomeEmail (fire-and-forget) so SMTP timeouts never block the response.
 */
const nodemailer = require("nodemailer");

const mailUser = () => process.env.EMAIL_USER_EZ;
const mailPass = () => String(process.env.EMAIL_PASS_EZ || "").replace(/\s+/g, "");
const mailHost = () => process.env.SMTP_HOST_EZ || "smtp.zoho.com";

/** Build one Zoho transporter (port 465 = SSL, 587 = STARTTLS). Force IPv4. */
function createTransporter(portOverride) {
  const user = mailUser();
  const pass = mailPass();
  const host = mailHost();
  const port = Number(portOverride || process.env.SMTP_PORT_EZ || 465);

  if (!user || !pass) {
    throw new Error(
      "Mail not configured. Set EMAIL_USER_EZ and EMAIL_PASS_EZ in .env (and on Render)"
    );
  }

  // Keep short — never block create API; background send should die fast if blocked
  const connectionTimeout = Number(process.env.SMTP_TIMEOUT_MS || 8000);

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass },
    tls: { minVersion: "TLSv1.2", servername: host },
    family: 4,
    connectionTimeout,
    greetingTimeout: connectionTimeout,
    socketTimeout: connectionTimeout + 5000,
  });
}

/** Only the configured port by default (fallback doubles wait on Render). */
function smtpPortsToTry() {
  const preferred = Number(process.env.SMTP_PORT_EZ || 465);
  if (String(process.env.SMTP_TRY_FALLBACK || "").toLowerCase() === "true") {
    const other = preferred === 465 ? 587 : 465;
    return [preferred, other];
  }
  return [preferred];
}

/** Normalize to/cc/bcc into string arrays */
function listAddresses(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Brevo (Sendinblue) HTTPS API — works on Render free tier (port 443).
 * Env: BREVO_API_KEY. Sender must be verified in Brevo (usually EMAIL_USER_EZ).
 */
async function sendViaBrevo(mailOptions) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return null;

  const { fromName, fromEmail } = fromAddress();
  const to = listAddresses(mailOptions.to).map((email) => ({ email }));
  const cc = listAddresses(mailOptions.cc).map((email) => ({ email }));
  const bcc = listAddresses(mailOptions.bcc).map((email) => ({ email }));

  if (!to.length) throw new Error("Brevo send: missing to address");

  const payload = {
    sender: { name: fromName, email: fromEmail },
    to,
    subject: mailOptions.subject,
    htmlContent: mailOptions.html || undefined,
    textContent: mailOptions.text || undefined,
  };
  if (cc.length) payload.cc = cc;
  if (bcc.length) payload.bcc = bcc;
  if (mailOptions.replyTo) {
    payload.replyTo = { email: String(mailOptions.replyTo) };
  }
  if (Array.isArray(mailOptions.attachments) && mailOptions.attachments.length) {
    payload.attachment = mailOptions.attachments.map((file) => ({
      name: file.filename,
      content: Buffer.isBuffer(file.content) ? file.content.toString("base64") : String(file.content || ""),
    }));
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data.message || data.error || `Brevo HTTP ${res.status}`
    );
  }

  return {
    messageId: data.messageId || `brevo-${Date.now()}`,
    accepted: to.map((t) => t.email),
    rejected: [],
    response: "Brevo accepted",
    _usedPort: "https-brevo",
  };
}

/**
 * Resend HTTPS API — works on Render free tier.
 * Env: RESEND_API_KEY. From domain must be verified in Resend (or use onboarding domain).
 */
async function sendViaResend(mailOptions) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;

  const { from } = fromAddress();
  const payload = {
    from,
    to: listAddresses(mailOptions.to),
    subject: mailOptions.subject,
    html: mailOptions.html || undefined,
    text: mailOptions.text || undefined,
  };
  const cc = listAddresses(mailOptions.cc);
  const bcc = listAddresses(mailOptions.bcc);
  if (cc.length) payload.cc = cc;
  if (bcc.length) payload.bcc = bcc;
  if (mailOptions.replyTo) payload.reply_to = String(mailOptions.replyTo);
  if (Array.isArray(mailOptions.attachments) && mailOptions.attachments.length) {
    payload.attachments = mailOptions.attachments.map((file) => ({
      filename: file.filename,
      content: Buffer.isBuffer(file.content) ? file.content.toString("base64") : String(file.content || ""),
    }));
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || `Resend HTTP ${res.status}`);
  }

  return {
    messageId: data.id || `resend-${Date.now()}`,
    accepted: payload.to,
    rejected: [],
    response: "Resend accepted",
    _usedPort: "https-resend",
  };
}

/** Prefer HTTPS APIs (Render-safe), then Zoho SMTP (local). */
async function sendMailWithFallback(mailOptions) {
  if (process.env.BREVO_API_KEY) {
    try {
      const viaBrevo = await sendViaBrevo(mailOptions);
      if (viaBrevo) return viaBrevo;
    } catch (err) {
      console.error("Brevo HTTPS failed:", err.message);
      throw err;
    }
  }

  if (process.env.RESEND_API_KEY) {
    try {
      const viaResend = await sendViaResend(mailOptions);
      if (viaResend) return viaResend;
    } catch (err) {
      console.error("Resend HTTPS failed:", err.message);
      throw err;
    }
  }

  const ports = smtpPortsToTry();
  let lastErr;
  for (const port of ports) {
    try {
      const transporter = createTransporter(port);
      const info = await transporter.sendMail(mailOptions);
      if (info.rejected && info.rejected.length) {
        throw new Error(`SMTP rejected: ${info.rejected.join(", ")}`);
      }
      info._usedPort = port;
      return info;
    } catch (err) {
      lastErr = err;
      const msg = String(err.message || err);
      const retryable =
        /timeout|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ESOCKET|Greeting never received/i.test(
          msg
        );
      console.error(`SMTP port ${port} failed:`, msg);
      if (!retryable || ports.length === 1) {
        const hint =
          /timeout|ETIMEDOUT/i.test(msg)
            ? " Render free tier blocks SMTP (465/587). Set BREVO_API_KEY or RESEND_API_KEY for HTTPS mail, or upgrade the Render instance."
            : "";
        throw new Error(`${msg}${hint}`);
      }
    }
  }
  throw new Error(
    `SMTP connection failed on ports ${ports.join(" & ")} from this host. Last error: ${lastErr && lastErr.message}. Set BREVO_API_KEY or RESEND_API_KEY on Render.`
  );
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

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const FONT_MONO = "Consolas,Monaco,'Courier New',monospace";

/** Brand greens — same as HRMS / Swagger UI (#1f6b4a, #143028) */
const GREEN = "#1f6b4a";
const GREEN_DARK = "#143028";
const GREEN_SOFT = "#e8f5ef";
const GREEN_MID = "#2d8f63";

/**
 * Shared branded email shell (HRMS green, mobile-safe table layout).
 */
function wrapEmailLayout({
  brand,
  title,
  headerTitle,
  headerSub,
  bodyHtml,
  footerNote,
}) {
  const safeBrand = escapeHtml(brand || "TechCulture.Ai");
  const safeTitle = escapeHtml(title || headerTitle || "HRMS");
  const safeHeader = escapeHtml(headerTitle || "");
  const safeSub = escapeHtml(headerSub || "");
  const safeFooter =
    footerNote ||
    `Automated message from ${safeBrand} HRMS · Please do not reply`;

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <title>${safeTitle}</title>
  <style type="text/css">
    @media only screen and (max-width:600px){
      .em-pad{padding-left:16px !important;padding-right:16px !important;}
      .em-hero{padding:22px 16px !important;}
      .em-title{font-size:18px !important;line-height:1.3 !important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#eef5f1;width:100% !important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${safeSub || safeHeader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#eef5f1;border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:20px 10px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;width:100%;background-color:#ffffff;border-collapse:collapse;">
          <tr>
            <td class="em-pad" style="background-color:${GREEN_DARK};padding:18px 22px;">
              <p style="margin:0 0 4px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#86efac;font-family:${FONT};font-weight:700;">${safeBrand}</p>
              <h1 class="em-title" style="margin:0;font-size:18px;line-height:1.3;color:#ffffff;font-family:${FONT};font-weight:700;">${safeHeader}</h1>
              ${safeSub ? `<p style="margin:6px 0 0;font-size:12px;line-height:1.45;color:#bbf7d0;font-family:${FONT};">${safeSub}</p>` : ""}
            </td>
          </tr>
          <tr>
            <td class="em-pad" style="padding:22px 22px 18px;background-color:#ffffff;font-family:${FONT};">${bodyHtml}</td>
          </tr>
          <tr>
            <td style="padding:12px 22px;background-color:#0d1f18;text-align:center;">
              <p style="margin:0;font-size:10px;line-height:1.5;color:#94a3b8;font-family:${FONT};">${safeFooter}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Welcome / credentials email — matches TechCulture design (mobile + smaller type).
 */
function buildWelcomeEmailHtml({
  name,
  email,
  password,
  role,
  brand,
  companyLabel,
  department,
  fromName,
  appUrl,
}) {
  const safe = {
    name: escapeHtml(name),
    email: escapeHtml(email),
    password: escapeHtml(password),
    role: escapeHtml(role),
    brand: escapeHtml(brand || "TechCulture.Ai"),
    company: escapeHtml(companyLabel || brand || "TechCulture.Ai"),
    dept: escapeHtml(department || ""),
    fromName: escapeHtml(fromName),
    appUrl: escapeHtml(appUrl),
  };

  const deptRow = department
    ? `<tr>
        <td style="padding:8px 0 0;font-size:11px;color:#64748b;font-family:${FONT};width:88px;vertical-align:middle;">Department</td>
        <td style="padding:8px 0 0;font-size:12px;color:#0f172a;font-family:${FONT};font-weight:600;">${safe.dept}</td>
      </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <title>Welcome — ${safe.brand}</title>
  <style type="text/css">
    @media only screen and (max-width:600px){
      .em-wrap{width:100% !important;}
      .em-pad{padding-left:14px !important;padding-right:14px !important;}
      .em-hero{padding:20px 14px !important;}
      .em-title{font-size:17px !important;}
      .em-btn a{padding:11px 18px !important;font-size:12px !important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#eef5f1;width:100% !important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Your HR portal account is ready — login details inside.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#eef5f1;border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:16px 8px;">
        <!--[if mso]><table role="presentation" width="520" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
        <table role="presentation" class="em-wrap" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;width:100%;background-color:#ffffff;border-collapse:collapse;border-radius:10px;overflow:hidden;">

          <!-- Top bar: brand + HR -->
          <tr>
            <td class="em-pad" style="padding:14px 18px;border-bottom:1px solid #e2e8f0;background-color:#ffffff;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                <tr>
                  <td style="vertical-align:middle;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                      <tr>
                        <td style="width:28px;height:28px;background-color:${GREEN};border-radius:6px;text-align:center;vertical-align:middle;font-family:${FONT};font-size:14px;font-weight:800;color:#ffffff;line-height:28px;">T</td>
                        <td style="padding-left:8px;vertical-align:middle;">
                          <p style="margin:0;font-size:13px;font-weight:700;color:#0f172a;font-family:${FONT};line-height:1.2;">${safe.brand}</p>
                          <p style="margin:1px 0 0;font-size:9px;color:#94a3b8;font-family:${FONT};letter-spacing:0.02em;">Technology · Innovation · Growth</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <p style="margin:0;font-size:10px;color:${GREEN};font-family:${FONT};font-weight:600;">HR Department</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Hero -->
          <tr>
            <td class="em-hero" style="background-color:${GREEN};background:linear-gradient(135deg,${GREEN_DARK} 0%,${GREEN} 55%,${GREEN_MID} 100%);padding:24px 18px;">
              <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#bbf7d0;font-family:${FONT};font-weight:700;">Welcome to ${safe.brand}</p>
              <h1 class="em-title" style="margin:0;font-size:19px;line-height:1.3;color:#ffffff;font-family:${FONT};font-weight:700;">Your HR Portal Account is Ready!</h1>
              <p style="margin:8px 0 0;font-size:12px;line-height:1.5;color:#dcfce7;font-family:${FONT};max-width:360px;">We're excited to have you on board. Your account has been created and is ready to use.</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="em-pad" style="padding:20px 18px 8px;background-color:#ffffff;">
              <p style="margin:0 0 4px;font-size:14px;color:${GREEN};font-family:${FONT};font-weight:700;">Hi ${safe.name},</p>
              <p style="margin:0 0 14px;font-size:12px;line-height:1.55;color:#64748b;font-family:${FONT};">
                Your account at <strong style="color:#0f172a;">${safe.company}</strong> is ready. Use the login details below to open the HR portal for the first time.
              </p>

              <!-- Credentials -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
                <tr>
                  <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;">
                    <p style="margin:0;font-size:11px;font-weight:700;color:#0f172a;font-family:${FONT};">&#128274; Login details</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:4px 14px 12px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                      <tr>
                        <td style="padding:10px 0 8px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#64748b;font-family:${FONT};width:88px;vertical-align:top;">Email</td>
                        <td style="padding:10px 0 8px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#0f172a;font-family:${FONT_MONO};font-weight:600;word-break:break-all;">${safe.email}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:11px;color:#64748b;font-family:${FONT};width:88px;vertical-align:top;">Password</td>
                        <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:12px;color:#0f172a;font-family:${FONT_MONO};font-weight:600;">${safe.password}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0 ${department ? "8px" : "0"};${department ? "border-bottom:1px solid #e2e8f0;" : ""}font-size:11px;color:#64748b;font-family:${FONT};width:88px;vertical-align:middle;">Role</td>
                        <td style="padding:8px 0 ${department ? "8px" : "0"};${department ? "border-bottom:1px solid #e2e8f0;" : ""}">
                          <span style="display:inline-block;background-color:${GREEN_SOFT};color:${GREEN};padding:2px 8px;font-size:11px;font-weight:700;font-family:${FONT};border-radius:999px;">${safe.role}</span>
                        </td>
                      </tr>
                      ${deptRow}
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Steps -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:14px 0 0;border-collapse:collapse;background-color:${GREEN_SOFT};border-radius:8px;">
                <tr>
                  <td style="padding:12px 14px;">
                    <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#0f172a;font-family:${FONT};">&#128640; How to get started</p>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                      <tr>
                        <td style="width:20px;vertical-align:top;padding:0 0 6px;">
                          <span style="display:inline-block;width:16px;height:16px;line-height:16px;text-align:center;background-color:${GREEN};color:#ffffff;border-radius:50%;font-size:9px;font-weight:700;font-family:${FONT};">1</span>
                        </td>
                        <td style="padding:0 0 6px 6px;font-size:11px;line-height:1.45;color:#475569;font-family:${FONT};">Open the HR portal with the button below</td>
                      </tr>
                      <tr>
                        <td style="width:20px;vertical-align:top;padding:0 0 6px;">
                          <span style="display:inline-block;width:16px;height:16px;line-height:16px;text-align:center;background-color:${GREEN};color:#ffffff;border-radius:50%;font-size:9px;font-weight:700;font-family:${FONT};">2</span>
                        </td>
                        <td style="padding:0 0 6px 6px;font-size:11px;line-height:1.45;color:#475569;font-family:${FONT};">Sign in with your email and password</td>
                      </tr>
                      <tr>
                        <td style="width:20px;vertical-align:top;">
                          <span style="display:inline-block;width:16px;height:16px;line-height:16px;text-align:center;background-color:${GREEN};color:#ffffff;border-radius:50%;font-size:9px;font-weight:700;font-family:${FONT};">3</span>
                        </td>
                        <td style="padding:0 0 0 6px;font-size:11px;line-height:1.45;color:#475569;font-family:${FONT};">Change your password after first login</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="em-btn" style="margin:16px 0 8px;border-collapse:collapse;">
                <tr>
                  <td align="center">
                    <a href="${safe.appUrl}" target="_blank" style="display:inline-block;padding:11px 22px;font-size:12px;font-weight:700;color:#ffffff;text-decoration:none;font-family:${FONT};background-color:${GREEN};border-radius:8px;">
                      Open HR Portal &rarr;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px;font-size:10px;line-height:1.45;color:#94a3b8;font-family:${FONT};text-align:center;">
                Or paste this link:<br/>
                <a href="${safe.appUrl}" style="color:${GREEN};word-break:break-all;font-size:10px;">${safe.appUrl}</a>
              </p>

              <!-- Sign-off -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;border-top:1px solid #e2e8f0;">
                <tr>
                  <td style="padding:12px 0 4px;font-size:11px;color:#64748b;font-family:${FONT};">
                    Need help? Contact your HR team.
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 4px;font-size:12px;line-height:1.5;color:#64748b;font-family:${FONT};">
                    Warm regards,<br/>
                    <span style="color:#0f172a;font-weight:700;">${safe.fromName}</span><br/>
                    <span style="color:#94a3b8;font-size:10px;">${safe.company}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer bar -->
          <tr>
            <td style="padding:10px 14px;background-color:#0d1f18;text-align:center;">
              <p style="margin:0;font-size:9px;line-height:1.45;color:#94a3b8;font-family:${FONT};">
                Automated message from ${safe.company} HRMS · Please do not reply
              </p>
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Welcome email after user create (includes login credentials).
 * Throws if SMTP/API rejects or env is missing — callers should catch.
 */
const sendWelcomeEmail = async ({
  name,
  email,
  password,
  role,
  company,
  department,
}) => {
  const to = String(email || "")
    .toLowerCase()
    .trim();
  if (!to) {
    throw new Error("Welcome email skipped — official email is empty");
  }

  const { fromName, from } = fromAddress();
  const appUrl = process.env.APP_URL || "https://hrms-techculture.vercel.app";
  const roleLabel = role || "Employee";
  const brandName = "TechCulture.Ai";
  const companyLabel = company || process.env.DEFAULT_COMPANY || brandName;

  const html = buildWelcomeEmailHtml({
    name,
    email: to,
    password,
    role: roleLabel,
    brand: brandName,
    companyLabel,
    department,
    fromName,
    appUrl,
  });

  const info = await sendMailWithFallback({
    from,
    to,
    replyTo: process.env.EMAIL_REPLY_TO || process.env.EMAIL_USER_EZ,
    subject: `[HRMS] Your login for ${companyLabel}`,
    text: `Hi ${name},\n\nWelcome to your HR portal at ${companyLabel}. Your account is ready.\n\nHow to sign in:\n1. Open ${appUrl}\n2. Email: ${to}\n3. Password: ${password}\n4. Your role: ${roleLabel}\n\nPlease change your password after first login.\n\nRegards,\n${fromName}`,
    html,
    headers: {
      "X-Priority": "1",
      "X-Mailer": "HRMS-API",
      "Auto-Submitted": "auto-generated",
    },
  });

  return info;
};

/**
 * Fire welcome mail in the background (never blocks create API).
 * Returns immediately with emailQueued + emailTo.
 */
const queueWelcomeEmail = (payload) => {
  const emailTo = String(payload.email || "")
    .toLowerCase()
    .trim();
  setImmediate(() => {
    sendWelcomeEmailSafe(payload).then((mail) => {
      if (!mail.emailSent) {
        console.error("Background welcome email failed →", emailTo, mail.emailError);
      }
    });
  });
  return { emailQueued: true, emailTo };
};

/**
 * Fire welcome mail; never throws to the create API.
 * Returns { emailSent, emailTo, emailError? } for the JSON response.
 */
const sendWelcomeEmailSafe = async (payload) => {
  const emailTo = String(payload.email || "")
    .toLowerCase()
    .trim();
  try {
    const info = await sendWelcomeEmail(payload);
    console.log(
      "Welcome email sent →",
      emailTo,
      info.messageId || "",
      "via:",
      info._usedPort || "",
      "accepted:",
      (info.accepted || []).join(",") || "(none)"
    );
    return { emailSent: true, emailTo };
  } catch (err) {
    console.error("Welcome email failed →", emailTo, err.message);
    if (err.response) console.error("SMTP response:", err.response);
    return { emailSent: false, emailTo, emailError: err.message };
  }
};

/** Generic send used by POST /api/mail/send and access-control mail */
const sendEmail = async ({ to, subject, body, cc, bcc, isHtml = false, replyTo, attachments }) => {
  const { fromName, from } = fromAddress();
  const brand = process.env.DEFAULT_COMPANY || "TechCulture.Ai";

  const text = isHtml
    ? String(body || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : String(body || "");

  let html;
  if (isHtml) {
    // Caller already sent a full document — use as-is; otherwise wrap fragment
    const raw = String(body || "");
    html = /<!DOCTYPE|<html[\s>]/i.test(raw)
      ? raw
      : wrapEmailLayout({
          brand,
          title: subject,
          headerTitle: subject,
          headerSub: "Message from HR",
          bodyHtml: raw,
        });
  } else {
    const bodyHtml = `
<p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#334155;font-family:${FONT};white-space:pre-wrap;">${escapeHtml(body)}</p>
<p style="margin:18px 0 0;font-size:12px;line-height:1.55;color:#64748b;font-family:${FONT};">
  Warm regards,<br/>
  <span style="color:#0f172a;font-weight:700;">${escapeHtml(fromName)}</span>
</p>`;
    html = wrapEmailLayout({
      brand,
      title: subject,
      headerTitle: subject,
      headerSub: "Message from HR",
      bodyHtml,
    });
  }

  const info = await sendMailWithFallback({
    from,
    to,
    cc: cc || undefined,
    bcc: bcc || undefined,
    replyTo: replyTo || undefined,
    attachments: attachments?.length ? attachments : undefined,
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

module.exports = {
  sendWelcomeEmail,
  sendWelcomeEmailSafe,
  queueWelcomeEmail,
  sendEmail,
  createTransporter,
  wrapEmailLayout,
  buildWelcomeEmailHtml,
  escapeHtml,
};
