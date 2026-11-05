/**
 * Create in-app notification + FCM push (web / mobile).
 * Always saves to DB; push is best-effort when Firebase is configured.
 */
const User = require("../models/User");
const Notification = require("../models/Notification");
const { sendToTokens, isFcmReady } = require("./fcm");

const dropInvalidTokens = async (userId, invalidTokens) => {
  if (!invalidTokens?.length) return;
  await User.updateOne(
    { _id: userId },
    { $pull: { fcmTokens: { token: { $in: invalidTokens } } } }
  );
};

/**
 * @param {object} opts
 * @param {string|object} opts.userId
 * @param {string} opts.title
 * @param {string} opts.body
 * @param {string} [opts.type]
 * @param {object} [opts.data]
 * @param {object} [opts.io] — Socket.IO (optional live bell)
 */
const notifyUser = async ({
  userId,
  title,
  body,
  type = "GENERAL",
  data = {},
  io = null,
}) => {
  const uid = String(userId);
  const doc = await Notification.create({
    userId: uid,
    type,
    title,
    body,
    data,
  });

  const user = await User.findById(uid).select("fcmTokens").lean();
  const tokens = (user?.fcmTokens || []).map((t) => t.token).filter(Boolean);

  let push = { ok: true, successCount: 0, failureCount: 0, invalidTokens: [], error: "" };
  if (tokens.length && isFcmReady()) {
    push = await sendToTokens({
      tokens,
      title,
      body,
      data: {
        type,
        notificationId: String(doc._id),
        ...data,
      },
    });
    if (push.invalidTokens?.length) {
      await dropInvalidTokens(uid, push.invalidTokens);
    }
    doc.pushSent = push.successCount > 0;
    doc.pushError = push.error || (push.failureCount ? `${push.failureCount} failed` : "");
    await doc.save();
  } else if (tokens.length && !isFcmReady()) {
    doc.pushError = "FCM not configured";
    await doc.save();
  }

  if (io) {
    io.to(`user:${uid}`).emit("notification:new", {
      id: doc._id,
      type: doc.type,
      title: doc.title,
      body: doc.body,
      data: doc.data,
      read: false,
      createdAt: doc.createdAt,
    });
  }

  return { notification: doc, push };
};

/** Notify many users (same title/body). Returns count created. */
const notifyMany = async ({ userIds, title, body, type, data, io }) => {
  const ids = [...new Set((userIds || []).map(String).filter(Boolean))];
  const results = [];
  for (const id of ids) {
    results.push(await notifyUser({ userId: id, title, body, type, data, io }));
  }
  return results;
};

module.exports = {
  notifyUser,
  notifyMany,
};
