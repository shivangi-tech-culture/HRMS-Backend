/**
 * CHAT ROUTES → /api/chat (team chat — any logged-in user)
 * Company = X-Company-Id header (or ?companyId=); empty = user's first company.
 * Live updates: Socket.IO on the same server (utils/chatSocket.js).
 */
const express = require("express");
const { protect } = require("../middleware/auth");
const { chatUserFor } = require("../utils/chatAccess");
const { uploadChatFiles, chatUploadError } = require("../utils/chatFiles");
const {
  getChatMe,
  listChatPeople,
  listConversations,
  openDirectChat,
  getMessages,
  postMessage,
  readConversation,
  downloadAttachment,
  createGroup,
  renameGroup,
  addGroupMembers,
  removeGroupMember,
  deleteGroup,
} = require("../controllers/chat.controller");

const router = express.Router();

/** After protect: req.chatUser = login user + selected company */
const chatUser = async (req, res, next) => {
  try {
    req.chatUser = await chatUserFor(
      req.user,
      req.headers["x-company-id"] || req.query.companyId
    );
    return next();
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  }
};

/**
 * @swagger
 * tags:
 *   - name: Chat
 *     description: |
 *       Team chat (admin + ESS). Send `X-Company-Id` = company from the header switcher.
 *       **Contacts:** Super Admin / Admin / HR → whole company · Reporting Manager → own team ·
 *       Employee → own Reporting Heads + company employees.
 *       **Socket.IO** on the API URL: `io(API_URL, { auth: { token, companyId } })`.
 *       Emits `chat:join`, `chat:leave`, `message:send`, `chat:read`, `chat:delivered`; listens for
 *       `message:new`, `inbox:update`, `chat:changed`, `receipt:update`.
 *       **Ticks:** each conversation has `deliveredUpTo` / `readUpTo` — my messages with
 *       `createdAt` at or before them are delivered / seen by every other member.
 */

/**
 * @swagger
 * /api/chat/health:
 *   get:
 *     tags: [Chat]
 *     summary: Chat health (no auth)
 *     responses:
 *       200: { description: Chat is up }
 */
router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "hrms-chat" });
});

router.use(protect, chatUser);

/**
 * @swagger
 * /api/chat/me:
 *   get:
 *     tags: [Chat]
 *     summary: Chat login user + selected company
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Company-Id
 *         schema: { type: string }
 *     responses:
 *       200: { description: "{ employeeId, name, role, companyId, companyName, companies[], canCreateGroup }" }
 *       403: { description: Not in this company }
 */
router.get("/me", getChatMe);

/**
 * @swagger
 * /api/chat/employees:
 *   get:
 *     tags: [Chat]
 *     summary: People this user may chat with (cached 1 min)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: "{ data: [{ employeeId, name, email, employeeCode, role, designation, department, relation }] }" }
 */
router.get("/employees", listChatPeople);

/**
 * @swagger
 * /api/chat/conversations:
 *   get:
 *     tags: [Chat]
 *     summary: Chats visible to the user (newest first, with unreadCount, deliveredUpTo, readUpTo)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: "{ data: Conversation[] }" }
 *   post:
 *     tags: [Chat]
 *     summary: Open (find or create) a direct chat with a contact
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [employeeId]
 *             properties:
 *               employeeId: { $ref: "#/components/schemas/MongoId" }
 *     responses:
 *       201: { description: Conversation }
 *       403: { description: Not in the user's contacts }
 */
router.get("/conversations", listConversations);
router.post("/conversations", openDirectChat);

/**
 * @swagger
 * /api/chat/conversations/{conversationId}/messages:
 *   get:
 *     tags: [Chat]
 *     summary: Messages of a chat (oldest first)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: conversationId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: "{ data: Message[] }" }
 *   post:
 *     tags: [Chat]
 *     summary: Send a message — JSON { text } or multipart text + files (max 5 × 10 MB)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: conversationId, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               text: { type: string, example: Hello }
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               text: { type: string }
 *               files:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       201: { description: Message }
 *       403: { description: Not a member of this chat }
 */
router.get("/conversations/:conversationId/messages", getMessages);
router.post("/conversations/:conversationId/messages", uploadChatFiles, postMessage);

/**
 * @swagger
 * /api/chat/conversations/{conversationId}/read:
 *   post:
 *     tags: [Chat]
 *     summary: Mark a chat read (unreadCount → 0)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: conversationId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: "{ conversationId, unreadCount: 0 }" }
 */
router.post("/conversations/:conversationId/read", readConversation);

/**
 * @swagger
 * /api/chat/attachments/{attachmentId}:
 *   get:
 *     tags: [Chat]
 *     summary: Download a chat file (images / PDF inline)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: attachmentId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: File bytes }
 *       404: { description: File not found or no access }
 */
router.get("/attachments/:attachmentId", downloadAttachment);

/**
 * @swagger
 * /api/chat/groups:
 *   post:
 *     tags: [Chat]
 *     summary: Create a group (Reporting Manager / HR / Admin / Super Admin)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, memberIds]
 *             properties:
 *               name: { type: string, example: Payroll project }
 *               memberIds:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       201: { description: Conversation }
 */
router.post("/groups", createGroup);

/**
 * @swagger
 * /api/chat/groups/{conversationId}:
 *   patch:
 *     tags: [Chat]
 *     summary: Rename a group (group admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: conversationId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *     responses:
 *       200: { description: Conversation }
 *   delete:
 *     tags: [Chat]
 *     summary: Delete a group with its messages and files (group admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: conversationId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: "{ conversationId, deleted: true }" }
 */
router.patch("/groups/:conversationId", renameGroup);
router.delete("/groups/:conversationId", deleteGroup);

/**
 * @swagger
 * /api/chat/groups/{conversationId}/members:
 *   post:
 *     tags: [Chat]
 *     summary: Add members (group admin; from own contacts)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: conversationId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               memberIds:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       200: { description: Conversation }
 */
router.post("/groups/:conversationId/members", addGroupMembers);

/**
 * @swagger
 * /api/chat/groups/{conversationId}/members/{employeeId}:
 *   delete:
 *     tags: [Chat]
 *     summary: Remove a member (group admin) — own id = leave the group
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: conversationId, required: true, schema: { type: string } }
 *       - { in: path, name: employeeId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Conversation }
 */
router.delete("/groups/:conversationId/members/:employeeId", removeGroupMember);

/** Chat errors → { message } with the right status */
router.use((err, _req, res, _next) => {
  const error = chatUploadError(err);
  if (error?.code === 11000) {
    return res.status(409).json({ message: "This record already exists" });
  }
  const status = error.status || error.statusCode || 500;
  if (status >= 500) console.error(error);
  return res.status(status).json({ message: error.message || "Chat request failed" });
});

module.exports = router;
