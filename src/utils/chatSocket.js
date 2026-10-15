/**
 * CHAT SOCKET — Socket.IO on the same HTTP server as the API
 *
 * Client: io(API_URL, { auth: { token, companyId } })
 * Client → server: chat:join · chat:leave · message:send · chat:read (each with an ack)
 *                  · chat:delivered (no ack)
 * Server → client: message:new · inbox:update · message:sent · chat:changed · receipt:update · chat:muted
 *                  · presence:list · presence:update
 *                  (see chatRealtime.js)
 */
const { chatUserFor, loadLoginUser } = require("./chatAccess");
const { broadcastMessage, broadcastReceipts } = require("./chatRealtime");
const {
  loadViewableConversation,
  markDelivered,
  markRead,
  sendMessage,
} = require("../controllers/chat.controller");

/** Open tabs per employee. Zero means offline. */
const onlineCount = new Map();

const attachChatSocket = (io) => {
  io.use(async (socket, next) => {
    try {
      const user = await loadLoginUser(socket.handshake.auth?.token || "");
      socket.chatUser = await chatUserFor(user, socket.handshake.auth?.companyId);
      return next();
    } catch (err) {
      return next(new Error(err?.message || "Login token is invalid or expired"));
    }
  });

  io.on("connection", (socket) => {
    const { employeeId, companyId } = socket.chatUser;
    socket.join(`user:${employeeId}`);
    socket.join(`company:${companyId}`);

    const before = onlineCount.get(employeeId) || 0;
    onlineCount.set(employeeId, before + 1);
    socket.emit("presence:list", { employeeIds: [...onlineCount.keys()] });
    if (before === 0) {
      socket.to(`company:${companyId}`).emit("presence:update", { employeeId, online: true });
    }

    socket.on("disconnect", () => {
      const left = (onlineCount.get(employeeId) || 1) - 1;
      if (left <= 0) {
        onlineCount.delete(employeeId);
        io.to(`company:${companyId}`).emit("presence:update", { employeeId, online: false });
      } else {
        onlineCount.set(employeeId, left);
      }
    });

    // Online now: everything sent while they were away is delivered
    markDelivered(socket.chatUser)
      .then((receipts) => broadcastReceipts(io, receipts))
      .catch(() => {});

    socket.on("chat:join", async (conversationId, ack) => {
      try {
        await loadViewableConversation(socket.chatUser, conversationId);
        socket.join(`chat:${conversationId}`);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, message: err.message || "Could not open this chat" });
      }
    });

    socket.on("chat:leave", (conversationId) => {
      if (typeof conversationId === "string" && conversationId) {
        socket.leave(`chat:${conversationId}`);
      }
    });

    socket.on("message:send", async (payload, ack) => {
      try {
        const result = await sendMessage(
          socket.chatUser,
          payload?.conversationId,
          payload?.text,
          [],
          { replyToId: payload?.replyTo }
        );
        broadcastMessage(io, result);
        ack?.({ ok: true, message: result.message });
      } catch (err) {
        ack?.({ ok: false, message: err.message || "Could not send message" });
      }
    });

    socket.on("chat:delivered", (conversationId) => {
      if (typeof conversationId !== "string" || !conversationId) return;
      markDelivered(socket.chatUser, conversationId)
        .then((receipts) => broadcastReceipts(io, receipts))
        .catch(() => {});
    });

    socket.on("chat:read", async (conversationId, ack) => {
      try {
        const { result, receipts } = await markRead(socket.chatUser, conversationId);
        broadcastReceipts(io, receipts);
        ack?.({ ok: true, ...result });
      } catch (err) {
        ack?.({ ok: false, message: err.message || "Could not mark the chat read" });
      }
    });
  });
};

module.exports = { attachChatSocket };
