/**
 * ACCOUNT / MY PROFILE — /api/account
 * UI: https://hrms-techculture.vercel.app/account/profile
 * Works for Admin + Employee (logged-in user only).
 */
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Role = require("../models/Role");
const {
  companyListForUser,
  hasGlobalCompanyAccess,
} = require("../utils/companyScope");
const {
  countPermissions,
  totalForRole,
  compactPermissions,
  permissionsForRole,
} = require("../config/permissions");
const { logEmployeeActivity } = require("../utils/activityLog");
const {
  forgetProfileImage,
  forgetSignatureImage,
  isSignatureImageUrl,
} = require("../middleware/upload");
const { normalizeRoleName, SUPER_ADMIN, ADMIN, HR } = require("../config/roles");
const { computeProfileCompletion } = require("../utils/profileCompletion");

const LOCKED_ROLES = new Set(["Super Admin", "Admin", "Employee"]);
const SIGNATURE_ROLES = new Set([SUPER_ADMIN, ADMIN, HR]);

const permLabel = (roleDoc) => {
  if (!roleDoc) return "0 of 0";
  return `${countPermissions(roleDoc.permissions)} of ${totalForRole(
    roleDoc.name,
    roleDoc.catalog
  )}`;
};

/** Refresh Super Admin, Admin, and Employee from the live permissions.js catalog */
async function refreshLockedRole(roleDoc) {
  if (!roleDoc || !LOCKED_ROLES.has(roleDoc.name)) return roleDoc;
  const full = permissionsForRole(roleDoc.name);
  if (JSON.stringify(roleDoc.permissions) !== JSON.stringify(full)) {
    roleDoc.permissions = full;
    await roleDoc.save();
  }
  return roleDoc;
}

/** Shape matching My Profile UI cards */
const toProfilePayload = async (user, roleDoc) => {
  const official = user.official || {};
  const personal = user.personal || {};
  const companies = (await companyListForUser(user)).map((row) => ({
    _id: row.companyId,
    companyName: row.companyName,
  }));
  return {
    id: user._id,
    fullName: user.name || "",
    name: user.name || "",
    workEmail: official.officialEmail || "",
    officialEmail: official.officialEmail || "",
    role: user.role || "",
    allCompanies: hasGlobalCompanyAccess(user),
    companies,
    department: official.department || "",
    designation: official.designation || "",
    employeeCode: official.employeeCode || "",
    status: user.status || "Active",
    mobileNo: personal.mobileNo || "",
    workPhone: personal.workPhone || "",
    lastLogin: user.lastLogin || null,
    profileUrl: user.profileUrl || null,
    signatureUrl: user.signatureUrl || null,
    signedInAs: user.name || "",
    permissionCount: permLabel(roleDoc),
    catalog: roleDoc?.catalog || null,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
};

/**
 * GET /api/account/profile — My Profile (current login)
 */
const getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password").lean();
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let roleDoc = await Role.findOne({ name: user.role });
    roleDoc = await refreshLockedRole(roleDoc);

    return res.json({
      message: "My Profile",
      data: await toProfilePayload(user, roleDoc),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/account/profile/completion — own profile % (Employee / HR / Manager / Admin)
 * Returns filled count, remaining mandatory, section-wise breakdown.
 */
const getMyProfileCompletion = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select("-password -token -emailAppPassword")
      .lean();
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({
      message: "Profile completion",
      data: computeProfileCompletion(user),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * PUT /api/account/profile — update own display name (lean admin account)
 * Body: { name? } — email/role/company not editable here
 */
const updateMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const before = user.toObject(); // snapshot for activity log diff

    if (req.body.name !== undefined) {
      const name = String(req.body.name || "").trim();
      if (!name || name.length < 2) {
        return res.status(400).json({ message: "Name must be at least 2 characters" });
      }
      user.name = name;
    }

    const previousProfileUrl =
      req.body.profileUrl !== undefined ? String(user.profileUrl || "") : null;
    if (req.body.profileUrl !== undefined) {
      user.profileUrl = req.body.profileUrl ? String(req.body.profileUrl).trim() : "";
    }

    const previousSignatureUrl =
      req.body.signatureUrl !== undefined ? String(user.signatureUrl || "") : null;
    if (req.body.signatureUrl !== undefined) {
      if (!SIGNATURE_ROLES.has(normalizeRoleName(user.role))) {
        return res.status(403).json({
          message: "Only Super Admin, Admin, or HR Manager can save a signature",
        });
      }
      const nextSig = req.body.signatureUrl
        ? String(req.body.signatureUrl).trim()
        : "";
      if (nextSig && !isSignatureImageUrl(nextSig)) {
        return res.status(400).json({
          message:
            "signatureUrl must be a Cloudinary image from POST /api/employees/upload with type=signature",
        });
      }
      user.signatureUrl = nextSig;
    }

    await user.save();
    if (previousProfileUrl !== null) {
      await forgetProfileImage(previousProfileUrl, user.profileUrl);
    }
    if (previousSignatureUrl !== null) {
      await forgetSignatureImage(previousSignatureUrl, user.signatureUrl);
    }
    await logEmployeeActivity({ actor: req.user, employee: user, action: "update", before });

    const roleDoc = await Role.findOne({ name: user.role }).lean();
    const lean = user.toObject();
    delete lean.password;

    return res.json({
      message: "Profile updated",
      data: await toProfilePayload(lean, roleDoc),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/account/me — alias of profile (+ permissions compact, like login)
 */
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password").lean();
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    let roleDoc = await Role.findOne({ name: user.role });
    roleDoc = await refreshLockedRole(roleDoc);
    const profile = await toProfilePayload(user, roleDoc);

    return res.json({
      message: "OK",
      user: {
        ...profile,
        permissions: roleDoc ? compactPermissions(roleDoc.permissions) : [],
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/account/change-password — employee (any logged-in user) changes own password
 * Body: { newPassword, confirmPassword }
 */
const changePassword = async (req, res) => {
  try {
    const { newPassword, confirmPassword } = req.body;

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        message: "New password and confirm password do not match",
      });
    }

    const user = await User.findById(req.user._id).select("password status");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (user.status !== "Active") {
      return res.status(401).json({ message: "Account is inactive" });
    }

    const sameAsOld = await bcrypt.compare(newPassword, user.password);
    if (sameAsOld) {
      return res.status(400).json({
        message: "New password must be different from current password",
      });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    return res.json({ message: "Password changed successfully" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getMyProfile,
  getMyProfileCompletion,
  updateMyProfile,
  getMe,
  changePassword,
};
