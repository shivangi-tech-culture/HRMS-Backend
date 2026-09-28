/**
 * MAIL CONTROLLER — /api/mail
 * POST /send → Zoho SMTP via utils/mail
 */
const { sendEmail } = require("../utils/mail");

/** SEND — POST /api/mail/send (to, subject, body, cc?, bcc?, isHtml?) */
const sendMail = async (req, res) => {
  try {
    const { to, subject, body, cc, bcc, isHtml } = req.body;

    const result = await sendEmail({
      to,
      subject,
      body,
      cc,
      bcc,
      isHtml: Boolean(isHtml),
    });

    return res.json({
      message: "Email sent",
      ...result,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = { sendMail };
