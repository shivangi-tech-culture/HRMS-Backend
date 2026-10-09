/**
 * CHAT MODULE — /api/chat (team chat: direct + group, files, unread counts, ticks)
 *
 * Every handler runs after protect + chatUser, so req.chatUser =
 * { employeeId, name, role, companyId, companyName, companies, headIds }.
 * Live updates go out on Socket.IO (utils/chatRealtime.js, utils/chatSocket.js).
 */
const mongoose = require("mongoose");
const ChatConversation = require("../models/ChatConversation");
const ChatMessage = require("../models/ChatMessage");
const ChatReadState = require("../models/ChatReadState");
const { MAX_GROUP_MEMBERS, pairKeyOf, sortedPair } = ChatConversation;
const {
  chatError,
  assertInTeam,
  canCreateGroup,
  canSend,
  canViewConversation,
  isSupervisor,
  teamDirectory,
} = require("../utils/chatAccess");
const { readChatFile, removeChatFiles, storeChatFiles } = require("../utils/chatFiles");
const {
  broadcastMessage,
  broadcastReceipts,
  closeRoom,
  notifyChatChanged,
} = require("../utils/chatRealtime");

const GROUP_NAME_MAX = 80;

// SHAPES — what the API returns

const toMessage = (row) => ({
  id: String(row._id),
  conversationId: String(row.conversationId),
  senderId: row.senderId,
  text: row.text || "",
  attachments: (row.attachments || []).map((a) => ({
    id: String(a._id),
    name: a.name,
    size: a.size,
    mimeType: a.mimeType,
  })),
  createdAt: row.createdAt,
});

/** Earliest date, or null when any member has none yet */
const earliest = (dates) =>
  dates.length === 0 || dates.includes(null) ? null : dates.reduce((a, b) => (b < a ? b : a));

/**
 * Ticks for the viewer's own messages: delivered/seen up to these times by every
 * other member (states = read rows of this chat by employeeId).
 */
const receiptsFor = (row, viewerId, states) => {
  const others = row.participantIds.map(String).filter((id) => id !== viewerId);
  const reads = others.map((id) => states.get(id)?.lastReadAt || null);
  const deliveries = others.map((id, i) => {
    const delivered = states.get(id)?.lastDeliveredAt || null;
    const read = reads[i];
    if (!delivered || !read) return delivered || read;
    return delivered > read ? delivered : read;
  });
  return { deliveredUpTo: earliest(deliveries), readUpTo: earliest(reads) };
};

/** Read rows of these chats: conversationId → (employeeId → row) */
const readStatesOf = async (conversationIds) => {
  const rows = await ChatReadState.find(
    { conversationId: { $in: conversationIds } },
    { conversationId: 1, employeeId: 1, unreadCount: 1, lastReadAt: 1, lastDeliveredAt: 1 }
  ).lean();
  const byChat = new Map();
  for (const row of rows) {
    const key = String(row.conversationId);
    if (!byChat.has(key)) byChat.set(key, new Map());
    byChat.get(key).set(row.employeeId, row);
  }
  return byChat;
};

const toConversation = (row, userId, unreadCount = 0, receipts = undefined) => {
  const participantIds = row.participantIds.map(String);
  const isGroup = row.type === "group";
  return {
    id: String(row._id),
    companyId: row.companyId,
    type: isGroup ? "group" : "direct",
    participantIds,
    peerEmployeeId: isGroup ? "" : participantIds.find((id) => id !== userId) || "",
    ...(isGroup && {
      name: row.name || "Group",
      createdBy: row.createdBy || "",
      adminIds: (row.adminIds || []).map(String),
      members: (row.members || []).map((m) => ({
        employeeId: m.employeeId,
        name: m.name,
        designation: m.designation,
      })),
    }),
    lastMessage: row.lastMessage || "",
    lastMessageAt: row.lastMessageAt,
    unreadCount,
    ...receipts,
  };
};

/** Inbox preview: text, or "📷 Photo" / "📎 file.pdf" (+N) for files */
const previewOf = (text, attachments) => {
  if (text) return text;
  if (attachments.length === 0) return "";
  const first = attachments[0];
  const label = first.mimeType.startsWith("image/") ? "📷 Photo" : `📎 ${first.name}`;
  return attachments.length > 1 ? `${label} +${attachments.length - 1}` : label;
};

// CHAT LOGIC — shared by REST handlers and the socket

const loadConversation = async (conversationId) => {
  if (!mongoose.isValidObjectId(conversationId)) {
    throw chatError(400, "Chat id is invalid");
  }
  const conversation = await ChatConversation.findById(conversationId);
  if (!conversation) throw chatError(404, "Chat not found");
  return conversation;
};

const loadViewableConversation = async (user, conversationId) => {
  const conversation = await loadConversation(conversationId);
  if (!(await canViewConversation(user, conversation))) {
    throw chatError(403, "You cannot open this chat");
  }
  return conversation;
};

const listVisibleConversations = async (user) => {
  const filter = isSupervisor(user.role)
    ? { companyId: user.companyId }
    : { companyId: user.companyId, participantIds: user.employeeId };
  const rows = await ChatConversation.find(filter).sort({ lastMessageAt: -1, createdAt: -1 });

  const visible = [];
  for (const row of rows) {
    if (await canViewConversation(user, row)) visible.push(row);
  }

  const statesByChat = await readStatesOf(visible.map((row) => row._id));
  return visible.map((row) => {
    const states = statesByChat.get(String(row._id)) || new Map();
    return toConversation(
      row,
      user.employeeId,
      states.get(user.employeeId)?.unreadCount || 0,
      receiptsFor(row, user.employeeId, states)
    );
  });
};

/** Find or create the direct chat between the user and another contact */
const openConversation = async (user, otherEmployeeId) => {
  const other = await assertInTeam(user, otherEmployeeId);
  const { companyId } = user;
  const participantIds = sortedPair(user.employeeId, other);
  const pairKey = pairKeyOf(participantIds);

  let conversation = await ChatConversation.findOne({ companyId, pairKey });
  if (!conversation) {
    try {
      conversation = await ChatConversation.create({
        companyId,
        participantIds,
        pairKey,
        lastMessage: "",
      });
    } catch (err) {
      if (err?.code !== 11000) throw err;
      conversation = await ChatConversation.findOne({ companyId, pairKey });
    }
  }
  const states = (await readStatesOf([conversation._id])).get(String(conversation._id)) || new Map();
  return toConversation(
    conversation,
    user.employeeId,
    states.get(user.employeeId)?.unreadCount || 0,
    receiptsFor(conversation, user.employeeId, states)
  );
};

const listMessages = async (user, conversationId) => {
  const conversation = await loadViewableConversation(user, conversationId);
  const rows = await ChatMessage.find({ conversationId: conversation._id }).sort({ createdAt: 1 });
  return rows.map(toMessage);
};

/** Save a message (text and/or files), bump unread counts; returns what to broadcast */
const sendMessage = async (user, conversationId, text, files = []) => {
  const body = String(text || "").trim();
  if (!body && files.length === 0) {
    throw chatError(400, "Message text or a file is required");
  }
  if (body.length > 4000) throw chatError(400, "Message is too long");

  const conversation = await loadViewableConversation(user, conversationId);
  if (!canSend(user, conversation)) {
    throw chatError(403, "Only members of this chat can send");
  }

  const attachments = files.length ? await storeChatFiles(conversation.companyId, files) : [];
  let message;
  try {
    message = await ChatMessage.create({
      companyId: conversation.companyId,
      conversationId: conversation._id,
      senderId: user.employeeId,
      text: body,
      attachments,
    });
  } catch (err) {
    await removeChatFiles(attachments);
    throw err;
  }
  conversation.lastMessage = previewOf(body, attachments);
  conversation.lastMessageAt = message.createdAt;

  const recipientIds = conversation.participantIds.filter((id) => id !== user.employeeId);
  await Promise.all([
    conversation.save(),
    recipientIds.length > 0 &&
      ChatReadState.bulkWrite(
        recipientIds.map((employeeId) => ({
          updateOne: {
            filter: { conversationId: conversation._id, employeeId },
            update: {
              $inc: { unreadCount: 1 },
              $setOnInsert: { companyId: conversation.companyId, lastReadAt: null },
            },
            upsert: true,
          },
        }))
      ),
  ]);

  return {
    message: toMessage(message),
    conversation: toConversation(conversation, user.employeeId, 0),
    recipientIds,
  };
};

/** After `changedId` got or read messages: fresh ticks for every other member */
const receiptUpdates = async (conversation, changedId) => {
  if (!conversation.participantIds.includes(changedId)) return [];
  const conversationId = String(conversation._id);
  const states = (await readStatesOf([conversation._id])).get(conversationId) || new Map();
  return conversation.participantIds
    .filter((employeeId) => employeeId !== changedId)
    .map((employeeId) => ({
      employeeId,
      receipt: { conversationId, ...receiptsFor(conversation, employeeId, states) },
    }));
};

/** Opened the chat: unread → 0; returns the tick updates for the senders */
const markRead = async (user, conversationId) => {
  const conversation = await loadViewableConversation(user, conversationId);
  await ChatReadState.updateOne(
    { conversationId: conversation._id, employeeId: user.employeeId },
    { $set: { unreadCount: 0, lastReadAt: new Date(), companyId: conversation.companyId } },
    { upsert: true }
  );
  return {
    result: { conversationId: String(conversation._id), unreadCount: 0 },
    receipts: await receiptUpdates(conversation, user.employeeId),
  };
};

/**
 * The user's chat is online: messages waiting for them (all chats, or one) are
 * now delivered. Returns the tick updates for the senders.
 */
const markDelivered = async (user, conversationId = null) => {
  const filter = { employeeId: user.employeeId, unreadCount: { $gt: 0 } };
  if (conversationId !== null) {
    if (!mongoose.isValidObjectId(conversationId)) return [];
    filter.conversationId = conversationId;
  }
  const states = await ChatReadState.find(filter, { conversationId: 1, lastDeliveredAt: 1 }).lean();
  if (states.length === 0) return [];

  const deliveredAt = new Map(states.map((s) => [String(s.conversationId), s.lastDeliveredAt]));
  const conversations = await ChatConversation.find({ _id: { $in: [...deliveredAt.keys()] } });
  const pending = conversations.filter((c) => {
    const at = deliveredAt.get(String(c._id));
    return c.participantIds.includes(user.employeeId) && c.lastMessageAt && (!at || at < c.lastMessageAt);
  });
  if (pending.length === 0) return [];

  await ChatReadState.updateMany(
    { employeeId: user.employeeId, conversationId: { $in: pending.map((c) => c._id) } },
    { $set: { lastDeliveredAt: new Date() } }
  );
  return (await Promise.all(pending.map((c) => receiptUpdates(c, user.employeeId)))).flat();
};

/** An attachment the user may open: they must be able to see its chat */
const findAttachment = async (user, attachmentId) => {
  if (!mongoose.isValidObjectId(attachmentId)) throw chatError(404, "File not found");
  const message = await ChatMessage.findOne(
    { "attachments._id": attachmentId },
    { conversationId: 1, attachments: 1 }
  );
  const attachment = message?.attachments.id(attachmentId);
  if (!attachment) throw chatError(404, "File not found");
  const conversation = await ChatConversation.findById(message.conversationId);
  if (!(await canViewConversation(user, conversation))) {
    throw chatError(404, "File not found");
  }
  return attachment;
};

// GROUPS

const cleanGroupName = (name) => {
  const value = String(name || "").trim().replace(/\s+/g, " ");
  if (!value) throw chatError(400, "Group name is required");
  if (value.length > GROUP_NAME_MAX) {
    throw chatError(400, `Group name must be ${GROUP_NAME_MAX} characters or less`);
  }
  return value;
};

const uniqueIds = (ids) => {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
};

/** Members must come from the acting user's own contacts */
const teamMembers = async (user, ids) => {
  const people = new Map((await teamDirectory(user)).map((p) => [p.employeeId, p]));
  return ids.map((id) => {
    const person = people.get(id);
    if (!person) throw chatError(403, "You can only add people from your team");
    return { employeeId: id, name: person.name, designation: person.designation };
  });
};

const loadGroup = async (user, conversationId) => {
  const group = await loadConversation(conversationId);
  if (group.type !== "group" || group.companyId !== user.companyId) {
    throw chatError(404, "Group not found");
  }
  if (!group.participantIds.includes(user.employeeId)) {
    throw chatError(403, "You are not in this group");
  }
  return group;
};

const assertGroupAdmin = (user, group) => {
  if (!(group.adminIds || []).includes(user.employeeId)) {
    throw chatError(403, "Only the group admin can do this");
  }
};

const othersIn = (group, user) => group.participantIds.filter((id) => id !== user.employeeId);

// HANDLERS

/** Express 4 does not catch rejected promises — forward them to the chat error handler */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** GET /api/chat/me */
const getChatMe = (req, res) => {
  const { employeeId, name, role, companyId, companyName, companies } = req.chatUser;
  res.json({
    employeeId,
    name,
    role,
    companyId,
    companyName,
    companies,
    canCreateGroup: canCreateGroup(role),
  });
};

/** GET /api/chat/employees */
const listChatPeople = wrap(async (req, res) => {
  res.json({ data: await teamDirectory(req.chatUser) });
});

/** GET /api/chat/conversations */
const listConversations = wrap(async (req, res) => {
  res.json({ data: await listVisibleConversations(req.chatUser) });
});

/** POST /api/chat/conversations { employeeId } */
const openDirectChat = wrap(async (req, res) => {
  res.status(201).json(await openConversation(req.chatUser, req.body?.employeeId));
});

/** GET /api/chat/conversations/:conversationId/messages */
const getMessages = wrap(async (req, res) => {
  res.json({ data: await listMessages(req.chatUser, req.params.conversationId) });
});

/** POST /api/chat/conversations/:conversationId/messages (JSON { text } or multipart text + files) */
const postMessage = wrap(async (req, res) => {
  const result = await sendMessage(
    req.chatUser,
    req.params.conversationId,
    req.body?.text,
    req.files || []
  );
  broadcastMessage(req.app.get("io"), result);
  res.status(201).json(result.message);
});

/** POST /api/chat/conversations/:conversationId/read */
const readConversation = wrap(async (req, res) => {
  const { result, receipts } = await markRead(req.chatUser, req.params.conversationId);
  broadcastReceipts(req.app.get("io"), receipts);
  res.json(result);
});

/** GET /api/chat/attachments/:attachmentId — file bytes (images / PDF inline) */
const downloadAttachment = wrap(async (req, res) => {
  const attachment = await findAttachment(req.chatUser, req.params.attachmentId);
  const bytes = await readChatFile(attachment.storageKey);
  const inline =
    attachment.mimeType.startsWith("image/") || attachment.mimeType === "application/pdf";
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.attachment(attachment.name);
  if (inline) {
    res.setHeader(
      "Content-Disposition",
      String(res.getHeader("Content-Disposition")).replace(/^attachment/, "inline")
    );
  }
  res.type(attachment.mimeType);
  res.send(bytes);
});

/** Group change: tell the other members, return the group */
const replyGroup = (req, res, status, result) => {
  notifyChatChanged(req.app.get("io"), result.notifyIds, result.conversation.id);
  res.status(status).json(result.conversation);
};

/** POST /api/chat/groups { name, memberIds[] } */
const createGroup = wrap(async (req, res) => {
  const user = req.chatUser;
  if (!canCreateGroup(user.role)) {
    throw chatError(403, "Only managers, HR and admins can create groups");
  }
  const groupName = cleanGroupName(req.body?.name);
  const ids = uniqueIds(req.body?.memberIds).filter((id) => id !== user.employeeId);
  if (ids.length === 0) throw chatError(400, "Add at least one member");
  if (ids.length + 1 > MAX_GROUP_MEMBERS) {
    throw chatError(400, `A group can have up to ${MAX_GROUP_MEMBERS} members`);
  }
  const members = await teamMembers(user, ids);

  const group = await ChatConversation.create({
    companyId: user.companyId,
    type: "group",
    name: groupName,
    createdBy: user.employeeId,
    adminIds: [user.employeeId],
    participantIds: [user.employeeId, ...ids],
    members: [{ employeeId: user.employeeId, name: user.name, designation: "" }, ...members],
    lastMessage: "",
  });
  replyGroup(req, res, 201, {
    conversation: toConversation(group, user.employeeId, 0),
    notifyIds: ids,
  });
});

/** PATCH /api/chat/groups/:conversationId { name } */
const renameGroup = wrap(async (req, res) => {
  const user = req.chatUser;
  const group = await loadGroup(user, req.params.conversationId);
  assertGroupAdmin(user, group);
  group.name = cleanGroupName(req.body?.name);
  await group.save();
  replyGroup(req, res, 200, {
    conversation: toConversation(group, user.employeeId, 0),
    notifyIds: othersIn(group, user),
  });
});

/** POST /api/chat/groups/:conversationId/members { memberIds[] } */
const addGroupMembers = wrap(async (req, res) => {
  const user = req.chatUser;
  const group = await loadGroup(user, req.params.conversationId);
  assertGroupAdmin(user, group);
  const ids = uniqueIds(req.body?.memberIds).filter((id) => !group.participantIds.includes(id));
  if (ids.length === 0) throw chatError(400, "Choose people who are not in the group yet");
  if (group.participantIds.length + ids.length > MAX_GROUP_MEMBERS) {
    throw chatError(400, `A group can have up to ${MAX_GROUP_MEMBERS} members`);
  }
  const members = await teamMembers(user, ids);
  group.participantIds.push(...ids);
  group.members.push(...members);
  await group.save();
  replyGroup(req, res, 200, {
    conversation: toConversation(group, user.employeeId, 0),
    notifyIds: othersIn(group, user),
  });
});

/** DELETE /api/chat/groups/:conversationId/members/:employeeId — admin removes, or self = leave */
const removeGroupMember = wrap(async (req, res) => {
  const user = req.chatUser;
  const group = await loadGroup(user, req.params.conversationId);
  const target = String(req.params.employeeId || "").trim();
  const leaving = target === user.employeeId;
  if (!leaving) assertGroupAdmin(user, group);
  if (!group.participantIds.includes(target)) throw chatError(404, "Member not found");
  if (leaving && group.createdBy === user.employeeId) {
    throw chatError(400, "You created this group. Delete the group instead of leaving");
  }
  if (!leaving && group.createdBy === target) {
    throw chatError(400, "The group creator cannot be removed");
  }

  const notifyIds = othersIn(group, user);
  group.participantIds = group.participantIds.filter((id) => id !== target);
  group.members = group.members.filter((m) => m.employeeId !== target);
  group.adminIds = (group.adminIds || []).filter((id) => id !== target);
  await group.save();
  await ChatReadState.deleteOne({ conversationId: group._id, employeeId: target });

  closeRoom(req.app.get("io"), String(group._id), [target]);
  replyGroup(req, res, 200, {
    conversation: toConversation(group, user.employeeId, 0),
    notifyIds,
  });
});

/** DELETE /api/chat/groups/:conversationId — group admin only; removes messages + files */
const deleteGroup = wrap(async (req, res) => {
  const user = req.chatUser;
  const group = await loadGroup(user, req.params.conversationId);
  assertGroupAdmin(user, group);
  const messages = await ChatMessage.find({ conversationId: group._id }, { attachments: 1 }).lean();
  const files = messages.flatMap((m) => m.attachments || []);
  await ChatMessage.deleteMany({ conversationId: group._id });
  await ChatReadState.deleteMany({ conversationId: group._id });
  await ChatConversation.deleteOne({ _id: group._id });
  await removeChatFiles(files);

  const conversationId = String(group._id);
  const io = req.app.get("io");
  closeRoom(io, conversationId);
  notifyChatChanged(io, othersIn(group, user), conversationId);
  res.json({ conversationId, deleted: true });
});

module.exports = {
  loadViewableConversation,
  sendMessage,
  markRead,
  markDelivered,
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
};
