/**
 * AUTH CONTROLLER — /api/auth
 * POST /login · POST /logout · GET /token-status · forgot/reset password
 */
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Role = require("../models/Role");
const {
  countPermissions,
  totalForRole,
  compactPermissions,
  permissionsForRole,
} = require("../config/permissions");
const {
  setAuthCookie,
  clearAuthCookie,
  readToken,
} = require("../utils/authCookie");
const {
  companyListForUser,
  hasGlobalCompanyAccess,
} = require("../utils/companyScope");
const { signToken, decodeToken, JWT_EXPIRES_IN } = require("../utils/jwt");
const { inspectSessionToken } = require("../middleware/auth");
const {
  sendEmail,
  wrapEmailLayout,
  escapeHtml,
} = require("../utils/mail");

/** Public message — same whether the email exists (do not leak accounts). */
const FORGOT_OK_MESSAGE =
  "If an account exists for that email, a password reset link has been sent.";

/** Reset token lifetime (1 hour). */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

const hashResetToken = (raw) =>
  crypto.createHash("sha256").update(String(raw)).digest("hex");

const buildResetEmailHtml = ({ name, resetUrl, brand }) => {
  const safeName = escapeHtml(name || "there");
  const safeUrl = escapeHtml(resetUrl);
  const bodyHtml = `
<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#334155;">Hi ${safeName},</p>
<p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#334155;">
  We received a request to reset your HRMS password. Click the button below — this link expires in <strong>1 hour</strong>.
</p>
<p style="margin:22px 0;text-align:center;">
  <a href="${safeUrl}" style="display:inline-block;padding:12px 22px;background:#0f172a;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">
    Reset password
  </a>
</p>
<p style="margin:0 0 10px;font-size:12px;line-height:1.55;color:#64748b;">
  Or paste this link in your browser:<br/>
  <a href="${safeUrl}" style="color:#2563eb;word-break:break-all;">${safeUrl}</a>
</p>
<p style="margin:16px 0 0;font-size:12px;line-height:1.55;color:#64748b;">
  If you did not ask for this, you can ignore this email — your password will stay the same.
</p>`;
  return wrapEmailLayout({
    brand,
    title: "Reset your HRMS password",
    headerTitle: "Password reset",
    headerSub: "Secure link · expires in 1 hour",
    bodyHtml,
  });
};

/** Queue reset mail — never blocks the API response. */
const queueResetEmail = (payload) => {
  setImmediate(() => {
    sendEmail({
      to: payload.to,
      subject: "Reset your HRMS password",
      body: buildResetEmailHtml(payload),
      isHtml: true,
    }).catch((err) => {
      console.error("Password reset email failed →", payload.to, err.message);
    });
  });
};

const LOCKED_ROLES = new Set(["Super Admin", "Admin", "Employee"]);

/** Build a short label like "42 of 120" for the UI */
const permLabel = (roleDoc) => {
  if (!roleDoc) return "0 of 0";
  return `${countPermissions(roleDoc.permissions)} of ${totalForRole(roleDoc.name)}`;
};

/** Keep Super Admin, Admin, and Employee matrices in sync with permissions.js */
async function refreshLockedRole(roleDoc) {
  if (!roleDoc || !LOCKED_ROLES.has(roleDoc.name)) return roleDoc;
  const full = permissionsForRole(roleDoc.name);
  if (JSON.stringify(roleDoc.permissions) !== JSON.stringify(full)) {
    roleDoc.permissions = full;
    await roleDoc.save();
  }
  return roleDoc;
}

/**
 * Mobile → last 10 digits (accepts +91, spaces, dashes). Null if not a mobile.
 */
const asMobile = (value) => {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return null;
};

/**
 * Find user by one `username` value. Type is detected from its shape:
 * contains "@" → official or personal email · 10-digit number → mobile · else → employee code.
 */
const findByUsername = (raw) => {
  const value = String(raw || "").trim();
  if (!value) return null;

  if (value.includes("@")) {
    const email = value.toLowerCase();
    return User.findOne({
      $or: [
        { "official.officialEmail": email },
        { "personal.personalEmail": email },
      ],
    });
  }

  const mobile = asMobile(value);
  if (mobile && /^[\d\s+()-]+$/.test(value)) {
    return User.findOne({ "personal.mobileNo": mobile });
  }

  return User.findOne({ "official.employeeCode": value.toUpperCase() });
};

/** Persist latest JWT on the user document (issued / expiry timestamps) */
const saveAuthTokenOnUser = async (user, token) => {
  const decoded = decodeToken(token);
  const issuedAt =
    decoded?.iat != null ? new Date(decoded.iat * 1000) : new Date();
  const expiresAt =
    decoded?.exp != null ? new Date(decoded.exp * 1000) : null;
  const expiresIn = String(JWT_EXPIRES_IN());

  // updateOne so token always lands in MongoDB (not lost on document.save edge cases)
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        token,
        tokenIssuedAt: issuedAt,
        tokenExpiresAt: expiresAt,
        tokenExpiresIn: expiresIn,
        lastLogin: issuedAt,
      },
      $unset: {
        authToken: 1,
        authTokenIssuedAt: 1,
        authTokenExpiresAt: 1,
        authTokenExpiresIn: 1,
      },
    }
  );

  user.token = token;
  user.tokenIssuedAt = issuedAt;
  user.tokenExpiresAt = expiresAt;
  user.tokenExpiresIn = expiresIn;
  user.lastLogin = issuedAt;
};

/** Clear stored JWT fields on the user */
const clearAuthTokenOnUser = async (userId) => {
  if (!userId) return;
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        token: "",
        tokenIssuedAt: null,
        tokenExpiresAt: null,
        tokenExpiresIn: "",
      },
      $unset: {
        authToken: 1,
        authTokenIssuedAt: 1,
        authTokenExpiresAt: 1,
        authTokenExpiresIn: 1,
      },
    }
  );
};

/**
 * LOGIN — POST /api/auth/login
 * Body: { username, password }
 * Response: JWT. Register FCM separately via POST /api/notifications/token.
 */
const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await findByUsername(username);
    if (!user) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    if (user.status !== "Active") {
      return res.status(401).json({ message: "Account is inactive" });
    }

    let roleDoc = await Role.findOne({ name: user.role });
    roleDoc = await refreshLockedRole(roleDoc);
    const token = signToken(user._id);
    await saveAuthTokenOnUser(user, token);
    setAuthCookie(res, token);
    if (user.official?.emailAppPasswordSet) require("../utils/liveMailbox").warm(String(user._id));

    const companies = (await companyListForUser(user)).map((row) => ({
      _id: row.companyId,
      companyName: row.companyName,
    }));

    return res.json({
      message: "Login successful",
      token, // JWT only — FCM is not returned
      tokenExpiresAt: user.tokenExpiresAt,
      tokenExpiresIn: user.tokenExpiresIn,
      user: {
        id: user._id,
        name: user.name,
        officialEmail: user.official?.officialEmail || "",
        role: user.role,
        department: user.official?.department || "",
        allCompanies: hasGlobalCompanyAccess(user),
        companies,
        status: user.status,
        lastLogin: user.lastLogin,
        permissionCount: permLabel(roleDoc),
        permissions: roleDoc ? compactPermissions(roleDoc.permissions) : [],
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** LOGOUT — POST /api/auth/logout (clear cookie + DB token when present) */
const logout = async (req, res) => {
  try {
    const token = readToken(req);
    if (token) {
      const decoded = decodeToken(token);
      if (decoded?.id) {
        const user = await User.findById(decoded.id).select("token");
        if (user && (!user.token || user.token === token)) {
          await clearAuthTokenOnUser(user._id);
        }
      }
    }
  } catch {
    // still clear cookie even if DB clear fails
  }
  clearAuthCookie(res);
  return res.json({ message: "Logged out" });
};

/**
 * TOKEN STATUS — GET /api/auth/token-status
 * Header: Authorization Bearer <token> (or cookie token)
 * Same check as protect (middleware/auth inspectSessionToken)
 */
const tokenStatus = async (req, res) => {
  try {
    const token = readToken(req);
    const check = await inspectSessionToken(token);
    return res.status(token ? 200 : 400).json({
      message: check.message,
      isExpired: check.isExpired,
      isReplaced: check.isReplaced,
    });
  } catch (err) {
    return res.status(500).json({
      message: err.message,
      isExpired: false,
      isReplaced: false,
    });
  }
};

/**
 * FORGOT PASSWORD — POST /api/auth/forgot-password
 * Body: { email }
 * Always returns the same success message (does not reveal whether the email exists).
 */
const forgotPassword = async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const user = await User.findOne({
      $or: [
        { "official.officialEmail": email },
        { "personal.personalEmail": email },
      ],
    }).select(
      "name status official.officialEmail personal.personalEmail resetPasswordToken resetPasswordExpires"
    );

    if (user && user.status === "Active") {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const hashed = hashResetToken(rawToken);
      const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS);

      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            resetPasswordToken: hashed,
            resetPasswordExpires: expires,
          },
        }
      );

      const appUrl = (
        process.env.APP_URL || "https://hrms-techculture.vercel.app"
      ).replace(/\/$/, "");
      const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;
      const brand = process.env.DEFAULT_COMPANY || "TechCulture.Ai";
      const to =
        user.official?.officialEmail ||
        user.personal?.personalEmail ||
        email;

      queueResetEmail({
        to,
        name: user.name || "there",
        resetUrl,
        brand,
      });
    }

    return res.json({ message: FORGOT_OK_MESSAGE });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * RESET PASSWORD — POST /api/auth/reset-password
 * Body: { token, newPassword, confirmPassword }
 * Clears reset fields + active session token so the user must log in again.
 */
const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    const hashed = hashResetToken(token);

    const user = await User.findOne({
      resetPasswordToken: hashed,
      resetPasswordExpires: { $gt: new Date() },
    }).select("password status resetPasswordToken resetPasswordExpires");

    if (!user) {
      return res.status(400).json({
        message: "Reset link is invalid or has expired. Please request a new one.",
      });
    }
    if (user.status !== "Active") {
      return res.status(401).json({ message: "Account is inactive" });
    }

    const sameAsOld = await bcrypt.compare(newPassword, user.password || "");
    if (sameAsOld) {
      return res.status(400).json({
        message: "New password must be different from current password",
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          password: passwordHash,
          resetPasswordToken: "",
          resetPasswordExpires: null,
          token: "",
          tokenIssuedAt: null,
          tokenExpiresAt: null,
          tokenExpiresIn: "",
        },
      }
    );

    return res.json({
      message: "Password reset successful. Please log in with your new password.",
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  login,
  logout,
  tokenStatus,
  forgotPassword,
  resetPassword,
};
