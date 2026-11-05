/**
 * NOTIFICATIONS — simple (3 APIs) + company / team scope
 *
 * POST /api/notifications/token   — save FCM token (web / android / ios)
 * GET  /api/notifications         — list (scoped)
 * PUT  /api/notifications/:id/read
 *
 * Scope:
 *   Employee            → own only
 *   Reporting Manager   → self + team
 *   HR                  → users in assigned companies (0 companies → empty)
 *   Super Admin / Admin → all
 *
 * Profile alerts are created automatically on punch-in when % < 70 (no cron).
 */
const mongoose = require("mongoose");
const User = require("../models/User");
const Notification = require("../models/Notification");
const { isFcmReady } = require("../utils/fcm");
const { saveFcmTokenOnUser } = require("../utils/fcmToken");
const {
  SUPER_ADMIN,
  ADMIN,
  HR,
  REPORTING_MANAGER,
  normalizeRoleName,
  isTeamScopedRole,
} = require("../config/roles");
const {
  hasGlobalCompanyAccess,
  managementCompanyIds,
} = require("../utils/companyScope");
const {
  getTeamMemberIds,
  assertTeamOrCompanyEmployee,
} = require("../utils/teamScope");

const ELEVATED = new Set([SUPER_ADMIN, ADMIN, HR, REPORTING_MANAGER]);

const toRow = (n) => ({
  id: n._id,
  userId: n.userId,
  userName: n.userName || "",
  type: n.type,
  title: n.title,
  body: n.body,
  data: n.data || {},
  read: !!n.read,
  readAt: n.readAt || null,
  createdAt: n.createdAt,
});

/**
 * User ids this actor may see notifications for.
 * - null  → no userId filter (global)
 * - []    → no access (empty list)
 * - [ids] → only these users
 */
const resolveVisibleUserIds = async (actor) => {
  if (hasGlobalCompanyAccess(actor)) return null;

  const role = normalizeRoleName(actor.role);

  if (isTeamScopedRole(role) || role === REPORTING_MANAGER) {
    const teamIds = await getTeamMemberIds(actor);
    return [actor._id, ...teamIds];
  }

  if (role === HR || ELEVATED.has(role)) {
    const companyIds = managementCompanyIds(actor);
    if (!companyIds?.length) return []; // HR with no company → nothing
    const rows = await User.find({
      "official.companyIds": { $in: companyIds },
    })
      .select("_id")
      .lean();
    return rows.map((r) => r._id);
  }

  // Employee / others
  return [actor._id];
};

/** true if targetUserId is allowed for this actor */
const canAccessUserNotifications = async (actor, targetUserId) => {
  if (!targetUserId || !mongoose.isValidObjectId(targetUserId)) {
    return { ok: false, message: "Invalid userId" };
  }
  if (String(actor._id) === String(targetUserId)) {
    return { ok: true };
  }

  const target = await User.findById(targetUserId)
    .select("role official.companyIds official.reportingHead1 official.reportingHead2")
    .lean();
  if (!target) return { ok: false, message: "User not found" };

  const err = assertTeamOrCompanyEmployee(actor, target);
  if (err) return { ok: false, message: err };
  return { ok: true };
};

/** POST /api/notifications/token */
const registerToken = async (req, res) => {
  try {
    const { token, platform = "web", deviceId = "" } = req.body;
    const user = await User.findById(req.user._id).select("fcmTokens");
    if (!user) return res.status(404).json({ message: "User not found" });

    saveFcmTokenOnUser(user, { token, platform, deviceId });
    await user.save();

    return res.json({
      message: "Device token registered",
      platform: platform || "web",
      fcmConfigured: isFcmReady(),
      tokenCount: user.fcmTokens.length,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/notifications
 * Employee → own
 * RM → self + team
 * HR → assigned companies (empty company → empty list)
 * Super Admin / Admin → all
 * ?userId= only if that user is in scope
 */
const listNotifications = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const role = normalizeRoleName(req.user.role);
    const elevated = ELEVATED.has(role);

    const filter = {};

    if (req.query.userId) {
      const access = await canAccessUserNotifications(req.user, req.query.userId);
      if (!access.ok) {
        return res.status(403).json({ message: access.message });
      }
      filter.userId = String(req.query.userId);
    } else {
      const visible = await resolveVisibleUserIds(req.user);
      if (visible === null) {
        // global — no userId filter
      } else if (!visible.length) {
        return res.json({
          message: "Notifications",
          count: 0,
          total: 0,
          page,
          limit,
          pages: 0,
          notifications: [],
        });
      } else {
        filter.userId = { $in: visible };
      }
    }

    if (req.query.unread === "true" || req.query.unread === true) {
      filter.read = false;
    }
    if (req.query.type) filter.type = String(req.query.type);

    const [total, rows] = await Promise.all([
      Notification.countDocuments(filter),
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    let nameMap = {};
    if (elevated && rows.length) {
      const uids = [...new Set(rows.map((r) => String(r.userId)))];
      const users = await User.find({ _id: { $in: uids } })
        .select("name")
        .lean();
      nameMap = Object.fromEntries(
        users.map((u) => [String(u._id), u.name || ""])
      );
    }

    return res.json({
      message: "Notifications",
      count: rows.length,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
      notifications: rows.map((n) =>
        toRow({
          ...n,
          userName: nameMap[String(n.userId)] || "",
        })
      ),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * PUT /api/notifications/:id/read
 * Own always OK. Elevated only if notification.userId is in company/team scope.
 */
const markRead = async (req, res) => {
  try {
    const n = await Notification.findById(req.params.id);
    if (!n) return res.status(404).json({ message: "Notification not found" });

    const access = await canAccessUserNotifications(req.user, n.userId);
    if (!access.ok) {
      return res.status(403).json({ message: access.message });
    }

    if (!n.read) {
      n.read = true;
      n.readAt = new Date();
      await n.save();
    }
    return res.json({ message: "Marked as read", notification: toRow(n) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  registerToken,
  listNotifications,
  markRead,
};
