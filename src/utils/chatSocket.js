/**
 * CHAT SOCKET — Socket.IO on the same HTTP server as the API
 *
 * Client: io(API_URL, { auth: { token, companyId } })
 * Client → server: chat:join · chat:leave · message:send · chat:read (each with an ack)
 * Server → client: message:new · inbox:update · chat:changed (see chatRealtime.js)
 */
const { chatUserFor, loadLoginUser } = require("./chatAccess");
const { broadcastMessage } = require("./chatRealtime");
const {
  loadViewableConversation,
  markRead,
  sendMessage,
} = require("../controllers/chat.controller");

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
    socket.join(`user:${socket.chatUser.employeeId}`);

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
        const result = await sendMessage(socket.chatUser, payload?.conversationId, payload?.text);
        broadcastMessage(io, result);
        ack?.({ ok: true, message: result.message });
      } catch (err) {
        ack?.({ ok: false, message: err.message || "Could not send message" });
      }
    });

    socket.on("chat:read", async (conversationId, ack) => {
      try {
        const result = await markRead(socket.chatUser, conversationId);
        ack?.({ ok: true, ...result });
      } catch (err) {
        ack?.({ ok: false, message: err.message || "Could not mark the chat read" });
      }
    });
  });
};

module.exports = { attachChatSocket };
