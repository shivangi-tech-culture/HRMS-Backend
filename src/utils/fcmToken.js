/**
 * Save / replace an FCM device token on a User document (in-memory).
 * Caller must `await user.save()` afterwards.
 *
 * Used by: POST /api/notifications/token
 */
const PLATFORMS = new Set(["web", "android", "ios"]);

const saveFcmTokenOnUser = (user, { token, platform = "web", deviceId = "" }) => {
  const raw = String(token || "").trim();
  if (!user || !raw) return user;

  let plat = String(platform || "web").trim().toLowerCase();
  if (!PLATFORMS.has(plat)) plat = "web";
  const device = String(deviceId || "").trim();

  user.fcmTokens = Array.isArray(user.fcmTokens) ? user.fcmTokens : [];
  user.fcmTokens = user.fcmTokens.filter(
    (t) => t.token !== raw && !(device && t.deviceId === device)
  );
  user.fcmTokens.push({
    token: raw,
    platform: plat,
    deviceId: device,
    updatedAt: new Date(),
  });

  if (user.fcmTokens.length > 10) {
    user.fcmTokens = user.fcmTokens
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 10);
  }

  return user;
};

module.exports = {
  saveFcmTokenOnUser,
  PLATFORMS,
};
