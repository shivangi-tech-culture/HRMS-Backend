/**
 * CHAT REALTIME — Socket.IO pushes (io = req.app.get("io"))
 * Rooms: user:<User _id> (every tab of that person) · chat:<conversation _id> (open chat)
 * Events: message:new · inbox:update · chat:changed · receipt:update
 */

/** New message: the open chat room gets the message, each other member gets an inbox update */
const broadcastMessage = (io, result) => {
  if (!io) return;
  io.to(`chat:${result.conversation.id}`).emit("message:new", result.message);
  const update = {
    conversationId: result.conversation.id,
    lastMessage: result.conversation.lastMessage,
    lastMessageAt: result.message.createdAt,
    senderId: result.message.senderId,
  };
  for (const id of result.recipientIds) io.to(`user:${id}`).emit("inbox:update", update);
};

/** Stop live messages to people removed from a chat (or to everyone when it is deleted) */
const closeRoom = (io, conversationId, employeeIds) => {
  if (!io) return;
  if (!employeeIds) {
    io.socketsLeave(`chat:${conversationId}`);
    return;
  }
  for (const id of employeeIds) io.in(`user:${id}`).socketsLeave(`chat:${conversationId}`);
};

/** Group created, renamed, members changed or deleted: those people reload their chat list */
const notifyChatChanged = (io, employeeIds, conversationId) => {
  if (!io) return;
  for (const id of employeeIds) io.to(`user:${id}`).emit("chat:changed", { conversationId });
};

/** Messages delivered / seen: each sender gets { conversationId, deliveredUpTo, readUpTo } */
const broadcastReceipts = (io, updates) => {
  if (!io) return;
  for (const { employeeId, receipt } of updates) {
    io.to(`user:${employeeId}`).emit("receipt:update", receipt);
  }
};

module.exports = { broadcastMessage, broadcastReceipts, closeRoom, notifyChatChanged };
