/**
 * MAIL ROUTES → /api/mail
 * POST /send — Organization → Mail
 */
const express = require("express");
const { sendMail } = require("../controllers/mail.controller");
const { protect, authorize, ALL_ACCESS } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { validate } = require("../middleware/validate");
const { sendMailSchema } = require("../validators/mail.validation");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Admin / Mail
 *     description: Send email (Organization → Mail)
 */

/**
 * @swagger
 * /api/mail/send:
 *   post:
 *     tags: [Admin / Mail]
 *     summary: Send email
 *     description: |
 *       Sends email via Zoho SMTP (same env as welcome mail).
 *       **Who:** Global Admin, Super Admin, HR Manager, Manager
 *       (needs Organization → Mail → `email` or `create` permission; Super/Global skip check).
 *
 *       `to` / `cc` / `bcc` = one email string or an array.
 *       `isHtml: true` → `body` treated as HTML; otherwise plain text.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [to, subject, body]
 *             properties:
 *               to:
 *                 oneOf:
 *                   - type: string
 *                     format: email
 *                   - type: array
 *                     items: { type: string, format: email }
 *                 example: employee@company.com
 *               subject:
 *                 type: string
 *                 example: Meeting tomorrow
 *               body:
 *                 type: string
 *                 example: Hi, please join the standup at 10 AM.
 *               cc:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items: { type: string }
 *               bcc:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items: { type: string }
 *               isHtml:
 *                 type: boolean
 *                 default: false
 *           examples:
 *             plain:
 *               summary: Plain text
 *               value:
 *                 to: rahul@techculture.ai
 *                 subject: Welcome note
 *                 body: Hi Rahul, welcome to the team.
 *             html:
 *               summary: HTML body
 *               value:
 *                 to: ["rahul@techculture.ai", "sneha@techculture.ai"]
 *                 subject: Holiday notice
 *                 body: "<p>Office closed on <strong>2 Oct</strong>.</p>"
 *                 isHtml: true
 *     responses:
 *       200:
 *         description: Email sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: Email sent }
 *                 messageId: { type: string }
 *                 accepted: { type: array, items: { type: string } }
 *                 rejected: { type: array, items: { type: string } }
 *       400: { description: Validation failed }
 *       403: { description: No Mail permission }
 *       500: { description: SMTP / config error }
 */
// SEND EMAIL — to / subject / body required; cc / bcc / isHtml optional
router.post(
  "/send",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Organization", "Mail", "email"),
  validate(sendMailSchema),
  sendMail
);

module.exports = router;
