/**
 * ACCESS & CONTROL CONTROLLER — /api/users
 * Hierarchy: src/config/roles.js
 */
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Role = require("../models/Role");
const {
  SUPER_ADMIN,
  ADMIN,
  maxSuperAdmins,
  canManageRole,
  normalizeRoleName,
  isSuperAdmin,
  isPlatformRole,
  isMultiCompanyRole,
} = require("../config/roles");
const { queueWelcomeEmail, sendEmail } = require("../utils/mail");
const { sendExcel } = require("../utils/excel");
const {
  findUniqueConflict,
  duplicateKeyMessage,
} = require("../utils/uniqueFields");
const {
  hasGlobalCompanyAccess,
  attachCompany,
  writeCompanyFields,
  userCompanyIds,
} = require("../utils/companyScope");
const { assertTeamOrCompanyEmployee } = require("../utils/teamScope");
const {
  assertUserPlacement,
  attachPlacementMany,
  parseOidOrNull,
} = require("../utils/companyShift");
const {
  visibleRolesForActor,
  buildListQuery,
  mapListRow,
  LIST_SELECT,
  LIST_POPULATE,
  safeUser,
} = require("../utils/userAccount");
const { logEmployeeActivity } = require("../utils/activityLog");

const loadManagedUser = async (req, id) => {
  if (String(req.user._id) === String(id)) {
    return {
      error: { status: 400, message: "You cannot delete your own account" },
    };
  }

  const user = await User.findById(id);
  if (!user) {
    return { error: { status: 404, message: "User not found" } };
  }

  if (!canManageRole(req.user.role, user.role)) {
    return {
      error: { status: 403, message: "You cannot manage this role" },
    };
  }

  if (!hasGlobalCompanyAccess(req.user)) {
    const scopeErr = assertTeamOrCompanyEmployee(req.user, user);
    if (scopeErr) {
      return { error: { status: 403, message: scopeErr } };
    }
  }

  return { user };
};

/** Enforce Super Admin / Admin create rules */
const assertCanCreateRole = async (actor, roleName) => {
  const role = normalizeRoleName(roleName);
  const actorRole = normalizeRoleName(actor.role);

  if (role === SUPER_ADMIN) {
    return {
      ok: false,
      status: 403,
      message:
        "Cannot create Super Admin via API — only one Super Admin exists (seed / ops)",
    };
  }

  if (role === ADMIN) {
    if (!isSuperAdmin(actor)) {
      return {
        ok: false,
        status: 403,
        message: "Only Super Admin can create Admin",
      };
    }
  }

  if (!canManageRole(actorRole, role)) {
    return {
      ok: false,
      status: 403,
      message: "You cannot create this role",
    };
  }

  return { ok: true, role };
};

const createAccessUserAccount = async (req) => {
  try {
    const { name, password, role, status } = req.body;
    const officialIn = req.body.official || {};
    const personalIn = req.body.personal || {};
    const addrIn = personalIn.presentAddress || {};

    const email = String(officialIn.officialEmail || "")
      .toLowerCase()
      .trim();
    const rawRole = String(role || "").trim();
    const gate = await assertCanCreateRole(req.user, rawRole);
    if (!gate.ok) return gate;
    const roleName = gate.role;

    const department = String(officialIn.department || "").trim();
    const employeeCode = String(officialIn.employeeCode || "")
      .trim()
      .toUpperCase();
    const mobileNo = String(personalIn.mobileNo || "").trim();
    const city = String(addrIn.city || "").trim();
    const state = String(addrIn.state || "").trim();
    const country = String(addrIn.country || "").trim();

    const assigned = await attachCompany(req.user, roleName, officialIn);
    if (!assigned.ok) return assigned;

    const uniquePayload = { "official.officialEmail": email };
    if (mobileNo) uniquePayload["personal.mobileNo"] = mobileNo;
    if (employeeCode) uniquePayload["official.employeeCode"] = employeeCode;

    const [createConflict, targetRole, hashedPassword] = await Promise.all([
      findUniqueConflict(uniquePayload),
      Role.findOne({ name: roleName, status: "Active" }),
      bcrypt.hash(password, 10),
    ]);
    if (createConflict) {
      return { ok: false, status: 400, message: createConflict };
    }
    if (!targetRole) {
      return { ok: false, status: 400, message: "Role not found or inactive" };
    }

    const platform = isPlatformRole(roleName);

    const branchId = parseOidOrNull(officialIn.branchId);
    const shiftId = parseOidOrNull(officialIn.shiftId);

    const official = writeCompanyFields(
      platform
        ? {
            officialEmail: email,
            ...(employeeCode ? { employeeCode } : {}),
          }
        : {
            officialEmail: email,
            ...(department ? { department } : {}),
            ...(employeeCode ? { employeeCode } : {}),
            ...(branchId ? { branchId } : {}),
            ...(shiftId ? { shiftId } : {}),
          },
      assigned,
      roleName
    );

    if (!platform) {
      const placed = await assertUserPlacement({
        companyIds: official.companyIds,
        branchId: official.branchId,
        shiftId: official.shiftId,
      });
      if (!placed.ok) return placed;
    }

    const createDoc = {
      name: String(name).trim(),
      password: hashedPassword,
      role: roleName,
      status: status || "Active",
      official,
    };

    if (mobileNo || city || state || country) {
      createDoc.personal = {};
      if (mobileNo) createDoc.personal.mobileNo = mobileNo;
      if (city || state || country) {
        createDoc.personal.presentAddress = { city, state, country };
      }
    }

    const user = await User.create(createDoc);
    await logEmployeeActivity({ actor: req.user, employee: user, action: "create" });

    const mailCompany = platform
      ? "All companies"
      : assigned.companies.length > 1
        ? assigned.companies.join(", ")
        : assigned.company;
    const mail = queueWelcomeEmail({
      name: createDoc.name,
      email,
      password,
      role: roleName,
      company: mailCompany,
      department,
    });

    const fresh = await User.findById(user._id).select("-password");
    return {
      ok: true,
      user: await safeUser(fresh),
      emailQueued: true,
      emailTo: mail.emailTo,
    };
  } catch (err) {
    const dup = duplicateKeyMessage(err);
    if (dup) return { ok: false, status: 400, message: dup };
    return { ok: false, status: 500, message: err.message };
  }
};

const createUser = async (req, res) => {
  const result = await createAccessUserAccount(req);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.message });
  }
  return res.status(201).json({
    message: `User created. Welcome email queued for ${result.emailTo}.`,
    emailQueued: true,
    emailTo: result.emailTo || undefined,
    user: result.user,
  });
};

const listUsers = async (req, res) => {
  try {
    const roleScope = visibleRolesForActor(req.user);
    const built = await buildListQuery(req, { roleScope });
    if (built.error) {
      return res
        .status(built.error.status)
        .json({ message: built.error.message });
    }

    const { page, limit, skip, filter, applied } = built;
    const [total, rows] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select(LIST_SELECT)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate(LIST_POPULATE)
        .lean(),
    ]);

    await attachPlacementMany(rows);

    return res.json({
      count: rows.length,
      total,
      page,
      limit,
      pages: Math.max(Math.ceil(total / limit), 1),
      from: total === 0 ? 0 : skip + 1,
      to: skip + rows.length,
      filters: applied,
      users: rows.map(mapListRow),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!canManageRole(req.user.role, user.role)) {
      return res.status(403).json({ message: "You cannot view this role" });
    }

    if (!hasGlobalCompanyAccess(req.user)) {
      const scopeErr = assertTeamOrCompanyEmployee(req.user, user);
      if (scopeErr) {
        return res.status(403).json({ message: scopeErr });
      }
    }

    return res.json({ user: await safeUser(user) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const updateUser = async (req, res) => {
  try {
    if (req.body.password === "") delete req.body.password;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!canManageRole(req.user.role, user.role)) {
      return res.status(403).json({ message: "You cannot edit this role" });
    }

    if (!hasGlobalCompanyAccess(req.user)) {
      const scopeErr = assertTeamOrCompanyEmployee(req.user, user);
      if (scopeErr) {
        return res.status(403).json({ message: scopeErr });
      }
    }

    const before = user.toObject(); // snapshot for activity log diff

    if (req.body.name !== undefined) {
      user.name = String(req.body.name).trim();
    }
    if (req.body.status !== undefined) {
      user.status = req.body.status;
    }

    if (req.body.role !== undefined) {
      const nextRole = normalizeRoleName(String(req.body.role || "").trim());

      if (nextRole === SUPER_ADMIN) {
        return res.status(403).json({
          message: "Cannot assign Super Admin — only one Super Admin allowed",
        });
      }

      if (nextRole === ADMIN && !isSuperAdmin(req.user)) {
        return res.status(403).json({
          message: "Only Super Admin can assign Admin",
        });
      }

      if (!canManageRole(req.user.role, nextRole)) {
        return res.status(403).json({ message: "You cannot assign this role" });
      }

      const activeRole = await Role.findOne({
        name: nextRole,
        status: "Active",
      });
      if (!activeRole) {
        return res.status(400).json({ message: "Role not found or inactive" });
      }

      if (!user.official) user.official = {};
      if (isPlatformRole(nextRole)) {
        user.official.companyIds = undefined;
      }
      user.role = nextRole;
    }

    if (req.body.password) {
      user.password = await bcrypt.hash(req.body.password, 10);
    }

    if (req.body.official?.department !== undefined) {
      if (!user.official) user.official = {};
      user.official.department = String(
        req.body.official.department || ""
      ).trim();
      user.markModified("official");
    }

    if (req.body.official?.branchId !== undefined) {
      if (!user.official) user.official = {};
      user.official.branchId = parseOidOrNull(req.body.official.branchId);
      user.markModified("official");
    }

    if (req.body.official?.shiftId !== undefined) {
      if (!user.official) user.official = {};
      user.official.shiftId = parseOidOrNull(req.body.official.shiftId);
      user.markModified("official");
    }

    if (req.body.official?.companyIds !== undefined) {
      const targetRole = normalizeRoleName(user.role);
      if (!user.official) user.official = {};
      const assigned = await attachCompany(
        req.user,
        targetRole,
        req.body.official
      );
      if (!assigned.ok) {
        return res.status(assigned.status).json({ message: assigned.message });
      }
      const current =
        typeof user.official.toObject === "function"
          ? user.official.toObject()
          : { ...user.official };
      const next = writeCompanyFields(current, assigned, targetRole);
      user.official.companyIds = next.companyIds;
      user.markModified("official");
    }

    if (req.body.official?.employeeCode !== undefined) {
      if (!user.official) user.official = {};
      const code = String(req.body.official.employeeCode || "")
        .trim()
        .toUpperCase();
      if (code) {
        const conflict = await findUniqueConflict(
          { "official.employeeCode": code },
          user._id
        );
        if (conflict) {
          return res.status(400).json({ message: conflict });
        }
      }
      user.official.employeeCode = code;
      user.markModified("official");
    }

    if (!isPlatformRole(user.role)) {
      const placed = await assertUserPlacement({
        companyIds: user.official?.companyIds,
        branchId: user.official?.branchId,
        shiftId: user.official?.shiftId,
      });
      if (!placed.ok) {
        return res.status(placed.status).json({ message: placed.message });
      }
    }

    if (req.body.personal) {
      if (!user.personal) user.personal = {};
      if (req.body.personal.mobileNo !== undefined) {
        const mobile = String(req.body.personal.mobileNo || "").trim();
        if (mobile) {
          const conflict = await findUniqueConflict(
            { "personal.mobileNo": mobile },
            user._id
          );
          if (conflict) {
            return res.status(400).json({ message: conflict });
          }
        }
        user.personal.mobileNo = mobile;
      }
      const addr = req.body.personal.presentAddress;
      if (addr) {
        user.personal.presentAddress = {
          ...(user.personal.presentAddress || {}),
          ...(addr.city !== undefined
            ? { city: String(addr.city || "").trim() }
            : {}),
          ...(addr.state !== undefined
            ? { state: String(addr.state || "").trim() }
            : {}),
          ...(addr.country !== undefined
            ? { country: String(addr.country || "").trim() }
            : {}),
        };
      }
      user.markModified("personal");
    }

    await user.save();
    await logEmployeeActivity({ actor: req.user, employee: user, action: "update", before });

    const fresh = await User.findById(user._id).select("-password");
    return res.json({
      message: "User updated",
      user: await safeUser(fresh),
    });
  } catch (err) {
    const dup = duplicateKeyMessage(err);
    if (dup) return res.status(400).json({ message: dup });
    return res.status(500).json({ message: err.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    const loaded = await loadManagedUser(req, req.params.id);
    if (loaded.error) {
      return res
        .status(loaded.error.status)
        .json({ message: loaded.error.message });
    }

    if (normalizeRoleName(loaded.user.role) === SUPER_ADMIN) {
      return res.status(403).json({
        message: "Cannot delete Super Admin",
      });
    }

    await logEmployeeActivity({ actor: req.user, employee: loaded.user, action: "delete" });
    await loaded.user.deleteOne();
    return res.json({
      message: "User deleted",
      id: req.params.id,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const exportUsers = async (req, res) => {
  try {
    const roleScope = visibleRolesForActor(req.user);
    const built = await buildListQuery(req, { roleScope });
    if (built.error) {
      return res
        .status(built.error.status)
        .json({ message: built.error.message });
    }

    const rows = await User.find(built.filter)
      .select(LIST_SELECT)
      .sort({ createdAt: -1 })
      .populate(LIST_POPULATE)
      .lean();

    await attachPlacementMany(rows);

    const data = rows.map((row) => {
      const mapped = mapListRow(row);
      return {
        name: mapped.name,
        email: mapped.email,
        role: mapped.role,
        department: mapped.department,
        companies: mapped.companies.map((c) => c.companyName).join(", "),
        branch: mapped.branch || "",
        shift: mapped.shift || "",
        status: mapped.status,
        lastLogin: mapped.lastLogin
          ? new Date(mapped.lastLogin).toISOString()
          : "",
      };
    });

    await sendExcel(
      res,
      `access-control-users.xlsx`,
      [
        { header: "User", key: "name", width: 24 },
        { header: "Email", key: "email", width: 28 },
        { header: "Role", key: "role", width: 16 },
        { header: "Department", key: "department", width: 18 },
        { header: "Companies", key: "companies", width: 40 },
        { header: "Branch", key: "branch", width: 22 },
        { header: "Shift", key: "shift", width: 20 },
        { header: "Status", key: "status", width: 12 },
        { header: "Last login", key: "lastLogin", width: 24 },
      ],
      data
    );
  } catch (err) {
    if (!res.headersSent) {
      return res.status(500).json({ message: err.message });
    }
  }
};

/**
 * POST /api/users/:id/assign-companies
 * Super Admin only. Keeps companyIds[0] as the HR user's own company.
 * Every other id in the body is appended as assigned (all branches and shifts).
 * branchId and shiftId are left as they are.
 */
const assignHrCompanies = async (req, res) => {
  try {
    if (!isSuperAdmin(req.user)) {
      return res.status(403).json({
        message: "Only Super Admin can assign companies to HR",
      });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const roleName = normalizeRoleName(user.role);
    if (isPlatformRole(roleName)) {
      return res.status(400).json({
        message:
          "Admin and Super Admin already have access to all companies — do not assign companyIds",
      });
    }
    if (!isMultiCompanyRole(roleName)) {
      return res.status(400).json({
        message: "Companies can be assigned only to an HR Manager",
      });
    }

    const before = user.toObject();
    const assigned = await attachCompany(req.user, roleName, {
      companyIds: req.body.companyIds,
    });
    if (!assigned.ok) {
      return res.status(assigned.status).json({ message: assigned.message });
    }

    if (!user.official) user.official = {};
    const ownId = userCompanyIds(user)[0] || null;
    const incoming = assigned.companyIds.map((id) => String(id));
    const rest = incoming.filter((id) => id !== String(ownId || ""));
    user.official.companyIds = ownId ? [ownId, ...rest] : incoming;
    user.markModified("official");
    await user.save();
    await User.updateOne(
      { _id: user._id },
      { $unset: { "official.assignedCompanies": 1 } }
    );

    await logEmployeeActivity({
      actor: req.user,
      employee: user,
      action: "update",
      section: "companies",
      before,
    });

    const fresh = await User.findById(user._id).select("-password");
    const safe = await safeUser(fresh);
    return res.json({
      message:
        "Companies assigned. First company stays their own. Later companies are access only — all branches, shifts and employees. Branch and shift are unchanged.",
      companies: safe?.official?.companyIds || [],
      user: safe,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const sendUserMail = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select(
      "name role official.officialEmail official.companyIds official.reportingHead1 official.reportingHead2"
    );
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!canManageRole(req.user.role, user.role)) {
      return res.status(403).json({ message: "You cannot mail this role" });
    }

    if (!hasGlobalCompanyAccess(req.user)) {
      const scopeErr = assertTeamOrCompanyEmployee(req.user, user);
      if (scopeErr) {
        return res.status(403).json({ message: scopeErr });
      }
    }

    const to = String(user.official?.officialEmail || "")
      .trim()
      .toLowerCase();
    if (!to) {
      return res.status(400).json({ message: "User has no official email" });
    }

    const { subject, body, isHtml } = req.body;
    const result = await sendEmail({
      to,
      subject,
      body,
      isHtml: Boolean(isHtml),
    });

    return res.json({
      message: "Email sent",
      to,
      messageId: result.messageId,
      accepted: result.accepted,
      rejected: result.rejected,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  createUser,
  createAccessUserAccount,
  listUsers,
  getUser,
  updateUser,
  deleteUser,
  exportUsers,
  assignHrCompanies,
  sendUserMail,
  maxSuperAdmins,
};
