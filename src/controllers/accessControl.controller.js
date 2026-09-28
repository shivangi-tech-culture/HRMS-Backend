/**
 * ACCESS & CONTROL CONTROLLER — /api/users
 * CRUD + filters/pagination + Excel export + send mail.
 * Lean login users (any role). Full HR profiles → employee.controller.
 */
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Role = require("../models/Role");
const { maxGlobalAdmins } = require("./role.controller");
const { queueWelcomeEmail, sendEmail } = require("../utils/mail");
const { applyAnniversary } = require("../utils/anniversary");
const { sendExcel } = require("../utils/excel");
const {
  findUniqueConflict,
  duplicateKeyMessage,
} = require("../utils/uniqueFields");
const {
  assertSameCompany,
  assertSameCompanyEmployee,
  hasGlobalCompanyAccess,
  isSameCompany,
} = require("../utils/companyScope");
const {
  visibleRolesForActor,
  buildListQuery,
  mapListRow,
  LIST_SELECT,
} = require("../utils/userAccount");

/** Strip password before API response */
const safeUser = (doc) => {
  if (!doc) return null;
  applyAnniversary(doc);
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  delete obj.password;
  delete obj.contact;
  return obj;
};

/** Hierarchy: can actor see / manage this target role? */
const canManageRole = (actorRole, targetRole) => {
  if (actorRole === "Global Admin") return true;
  if (actorRole === "Super Admin") return targetRole !== "Global Admin";
  return !["Global Admin", "Super Admin"].includes(targetRole);
};

/** Load user + company + role hierarchy checks */
const loadManagedUser = async (req, id) => {
  if (String(req.user._id) === String(id)) {
    return { error: { status: 400, message: "You cannot delete your own account" } };
  }

  const user = await User.findById(id);
  if (!user) {
    return { error: { status: 404, message: "User not found" } };
  }

  if (!canManageRole(req.user.role, user.role)) {
    return {
      error: {
        status: 403,
        message: "You cannot manage this role",
      },
    };
  }

  if (!hasGlobalCompanyAccess(req.user)) {
    const scopeErr = assertSameCompanyEmployee(req.user, user);
    if (scopeErr) {
      return { error: { status: 403, message: scopeErr } };
    }
  }

  return { user };
};

/**
 * Pick company for a new Access user (hierarchy rules).
 */
const resolveAccessCompany = (req, roleName, officialIn) => {
  const actorCompanyRaw = String(req.user.official?.company || "").trim();

  if (roleName === "Global Admin") {
    return { ok: true, company: "" };
  }

  if (req.user.role === "Super Admin") {
    if (!actorCompanyRaw) {
      return {
        ok: false,
        status: 403,
        message: "Your profile has no company — cannot create users",
      };
    }
    const requested = String(officialIn.company || "").trim();
    if (requested && !isSameCompany(actorCompanyRaw, requested)) {
      return {
        ok: false,
        status: 403,
        message: "Super Admin can only create users for their own company",
      };
    }
    return { ok: true, company: actorCompanyRaw };
  }

  if (roleName === "Super Admin") {
    const company = String(officialIn.company || "").trim();
    if (!company) {
      return {
        ok: false,
        status: 400,
        message: "official.company is required when creating Super Admin",
      };
    }
    return { ok: true, company };
  }

  const company = String(officialIn.company || "").trim();
  if (!company) {
    return {
      ok: false,
      status: 400,
      message: "official.company is required",
    };
  }
  const companyErr = assertSameCompany(req.user, company);
  if (companyErr) {
    return { ok: false, status: 403, message: companyErr };
  }
  return { ok: true, company };
};

/**
 * CREATE ACCESS USER — POST /api/users
 * Lean account only (drawer fields).
 */
const createAccessUserAccount = async (req) => {
  try {
    const { name, password, role, status } = req.body;
    const officialIn = req.body.official || {};
    const personalIn = req.body.personal || {};
    const addrIn = personalIn.presentAddress || {};

    const email = String(officialIn.officialEmail || "")
      .toLowerCase()
      .trim();
    const roleName = String(role || "").trim();
    const department = String(officialIn.department || "").trim();
    const mobileNo = String(personalIn.mobileNo || "").trim();
    const city = String(addrIn.city || "").trim();
    const state = String(addrIn.state || "").trim();
    const country = String(addrIn.country || "").trim();

    if (roleName === "Global Admin") {
      if (req.user.role !== "Global Admin") {
        return {
          ok: false,
          status: 403,
          message: "Only Global Admin can create Global Admin",
        };
      }
      const globalCount = await User.countDocuments({ role: "Global Admin" });
      const max = maxGlobalAdmins();
      if (globalCount >= max) {
        return {
          ok: false,
          status: 400,
          message: `Maximum ${max} Global Admin accounts allowed`,
        };
      }
    }
    if (
      roleName === "Super Admin" &&
      !["Global Admin", "Super Admin"].includes(req.user.role)
    ) {
      return {
        ok: false,
        status: 403,
        message: "Only Global Admin / Super Admin can create Super Admin",
      };
    }
    if (!canManageRole(req.user.role, roleName)) {
      return {
        ok: false,
        status: 403,
        message: "You cannot create this role",
      };
    }

    const companyRes = resolveAccessCompany(req, roleName, officialIn);
    if (!companyRes.ok) return companyRes;
    const company = companyRes.company;

    const uniquePayload = { "official.officialEmail": email };
    if (mobileNo) uniquePayload["personal.mobileNo"] = mobileNo;

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

    const official =
      roleName === "Global Admin"
        ? { officialEmail: email }
        : {
            officialEmail: email,
            company,
            ...(department ? { department } : {}),
          };

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

    const mail = queueWelcomeEmail({
      name: createDoc.name,
      email,
      password,
      role: roleName,
      company: roleName === "Global Admin" ? "All companies" : company,
      department,
    });

    const fresh = await User.findById(user._id).select("-password");
    return {
      ok: true,
      user: safeUser(fresh),
      emailQueued: true,
      emailTo: mail.emailTo,
    };
  } catch (err) {
    const dup = duplicateKeyMessage(err);
    if (dup) return { ok: false, status: 400, message: dup };
    return { ok: false, status: 500, message: err.message };
  }
};

/** CREATE — POST /api/users */
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

/** LIST — GET /api/users (search + filters + pagination) */
const listUsers = async (req, res) => {
  try {
    const roleScope = visibleRolesForActor(req.user);
    const built = buildListQuery(req, { roleScope });
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
        .lean(),
    ]);

    const users = rows.map(mapListRow);

    return res.json({
      count: users.length,
      total,
      page,
      limit,
      pages: Math.max(Math.ceil(total / limit), 1),
      from: total === 0 ? 0 : skip + 1,
      to: skip + users.length,
      filters: applied,
      users,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** GET ONE — GET /api/users/:id */
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
      const scopeErr = assertSameCompanyEmployee(req.user, user);
      if (scopeErr) {
        return res.status(403).json({ message: scopeErr });
      }
    }

    return res.json({ user: safeUser(user) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * UPDATE — PUT /api/users/:id
 * Lean Access & Control drawer fields only.
 * Email + company locked. Password optional (blank = keep).
 */
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
      const scopeErr = assertSameCompanyEmployee(req.user, user);
      if (scopeErr) {
        return res.status(403).json({ message: scopeErr });
      }
    }

    if (req.body.name !== undefined) {
      user.name = String(req.body.name).trim();
    }
    if (req.body.status !== undefined) {
      user.status = req.body.status;
    }

    if (req.body.role !== undefined) {
      const nextRole = String(req.body.role || "").trim();
      if (!canManageRole(req.user.role, nextRole)) {
        return res.status(403).json({ message: "You cannot assign this role" });
      }
      if (nextRole === "Global Admin") {
        if (req.user.role !== "Global Admin") {
          return res.status(403).json({
            message: "Only Global Admin can assign Global Admin",
          });
        }
        if (user.role !== "Global Admin") {
          const globalCount = await User.countDocuments({
            role: "Global Admin",
          });
          const max = maxGlobalAdmins();
          if (globalCount >= max) {
            return res.status(400).json({
              message: `Maximum ${max} Global Admin accounts allowed`,
            });
          }
        }
        if (!user.official) user.official = {};
        user.official.company = "";
      }
      if (
        nextRole === "Super Admin" &&
        !["Global Admin", "Super Admin"].includes(req.user.role)
      ) {
        return res.status(403).json({
          message: "Only Global Admin / Super Admin can assign Super Admin",
        });
      }
      const activeRole = await Role.findOne({
        name: nextRole,
        status: "Active",
      });
      if (!activeRole) {
        return res.status(400).json({ message: "Role not found or inactive" });
      }
      user.role = nextRole;
    }

    if (req.body.password) {
      user.password = await bcrypt.hash(req.body.password, 10);
    }

    if (req.body.official?.department !== undefined) {
      if (!user.official) user.official = {};
      user.official.department = String(req.body.official.department || "").trim();
      user.markModified("official");
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
          ...(addr.city !== undefined ? { city: String(addr.city || "").trim() } : {}),
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
    const fresh = await User.findById(user._id).select("-password");
    return res.json({
      message: "User updated",
      user: safeUser(fresh),
    });
  } catch (err) {
    const dup = duplicateKeyMessage(err);
    if (dup) return res.status(400).json({ message: dup });
    return res.status(500).json({ message: err.message });
  }
};

/**
 * DELETE — DELETE /api/users/:id
 * Separate delete API (Access & Control trash icon).
 */
const deleteUser = async (req, res) => {
  try {
    const loaded = await loadManagedUser(req, req.params.id);
    if (loaded.error) {
      return res
        .status(loaded.error.status)
        .json({ message: loaded.error.message });
    }

    await loaded.user.deleteOne();
    return res.json({
      message: "User deleted",
      id: req.params.id,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * EXPORT EXCEL — GET /api/users/export
 * Same filters as list (no pagination). Permission: Access & Control → export
 */
const exportUsers = async (req, res) => {
  try {
    const roleScope = visibleRolesForActor(req.user);
    const built = buildListQuery(req, { roleScope });
    if (built.error) {
      return res
        .status(built.error.status)
        .json({ message: built.error.message });
    }

    const rows = await User.find(built.filter)
      .select(LIST_SELECT)
      .sort({ createdAt: -1 })
      .lean();

    const data = rows.map((row) => {
      const mapped = mapListRow(row);
      return {
        name: mapped.name,
        email: mapped.email,
        role: mapped.role,
        department: mapped.department,
        company: mapped.company,
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
        { header: "Company", key: "company", width: 32 },
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
 * SEND MAIL — POST /api/users/:id/mail
 * Row mail icon → email that user's officialEmail.
 * Permission: Access & Control → email
 */
const sendUserMail = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select(
      "name role official.officialEmail official.company"
    );
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!canManageRole(req.user.role, user.role)) {
      return res.status(403).json({ message: "You cannot mail this role" });
    }

    if (!hasGlobalCompanyAccess(req.user)) {
      const scopeErr = assertSameCompanyEmployee(req.user, user);
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
  sendUserMail,
};
