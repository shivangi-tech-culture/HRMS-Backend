/**
 * Employee / User controller
 *
 * APIs:
 *   POST   /api/employees              → create user (admin)
 *   GET    /api/employees              → list users
 *   GET    /api/employees/:id          → get one user
 *   PUT    /api/employees/:id          → update profile (same API for admin + employee)
 *   PUT    /api/employees/:id/:section → edit official, payroll, one list row, or many rows
 *   DELETE /api/employees/:id/:section → delete one list row, many ids, or clear payroll
 *   DELETE /api/employees/:id          → delete user
 *   POST   /api/employees/upload               → Cloudinary file (type: education | account)
 *
 * Create mapping (same shape as User model):
 *   Required flat: name, password, role, status
 *   Required nested: official{ officialEmail, company, department, … }
 *   Optional nested: personal, other, education, accounts, family,
 *     nominees, experience, visas, payroll
 *   Login id = official.officialEmail
 *   No flat mobileNo / city / company
 *
 * Update rules:
 *   Employee  → personal, other, education, accounts, family, nominees, experience, visas
 *   Admin     → everything above + official, payroll, detailsApproval, role, status
 *   Password  → Super Admin / HR Manager only
 */
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User");
const Role = require("../models/Role");
const { hasAllAccess } = require("../middleware/auth");
const { sendWelcomeEmail } = require("../utils/mail");
const { uploadToCloudinary, UPLOAD_TYPES } = require("../middleware/upload");
const { applyAnniversary } = require("../utils/anniversary");
const {
  normalizeSectionUniques,
  findUniqueConflict,
  duplicateKeyMessage,
} = require("../utils/uniqueFields");
const {
  assertSameCompany,
  assertSameCompanyEmployee,
  companyFilter,
} = require("../utils/companyScope");

/** Nested profile keys accepted on update */
const PROFILE_KEYS = [
  "personal",
  "official",
  "other",
  "education",
  "accounts",
  "family",
  "nominees",
  "experience",
  "visas",
];

/** Drop client _id so Mongo assigns new ids on create */
const withoutIds = (rows) =>
  (rows || []).map((row) => {
    const copy = { ...row };
    delete copy._id;
    return copy;
  });

/** Copy only known profile keys from the request body */
const pickProfile = (body = {}) => {
  const out = {};
  for (const key of PROFILE_KEYS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
};

/** These sections are objects (merge fields). */
const OBJECT_SECTIONS = new Set(["personal", "official", "other"]);

/** Lists: one object appends or updates by _id. An array replaces the list. */
const ARRAY_SECTIONS = new Set([
  "education",
  "accounts",
  "family",
  "nominees",
  "experience",
  "visas",
]);

const asPlainRows = (value) => {
  const rows = Array.isArray(value) ? value : [];
  return rows.map((row) =>
    row && typeof row.toObject === "function" ? row.toObject() : { ...row }
  );
};

/**
 * One object without _id → append.
 * One object with _id → update that row.
 * Array → replace the whole list (use this to delete a row).
 * Returns an error message, or null.
 */
const applyArraySection = (employee, key, incoming) => {
  if (Array.isArray(incoming)) {
    employee[key] = incoming;
    employee.markModified(key);
    return null;
  }

  const current = asPlainRows(employee[key]);
  const row = { ...incoming };
  const id = row._id ? String(row._id) : "";

  if (!id) {
    delete row._id;
    current.push(row);
    employee[key] = current;
    employee.markModified(key);
    return null;
  }

  const index = current.findIndex((item) => String(item._id) === id);
  if (index === -1) {
    return `${key} item not found`;
  }
  current[index] = { ...current[index], ...row, _id: current[index]._id };
  employee[key] = current;
  employee.markModified(key);
  return null;
};

/**
 * Merge one object section without wiping other fields.
 * Example: sending only { mobileNo } keeps panNo etc.
 * Addresses inside personal are merged field-by-field too.
 */
const mergeSection = (existing, incoming, sectionKey) => {
  const base =
    existing && typeof existing.toObject === "function"
      ? existing.toObject()
      : { ...(existing || {}) };
  const next = { ...base, ...incoming };

  if (sectionKey === "personal") {
    if (incoming.presentAddress) {
      next.presentAddress = {
        ...(base.presentAddress || {}),
        ...incoming.presentAddress,
      };
    }
    if (incoming.permanentAddress) {
      next.permanentAddress = {
        ...(base.permanentAddress || {}),
        ...incoming.permanentAddress,
      };
    }
  }
  return next;
};

/** API response: never send password; refresh anniversary for display */
const safeUser = (doc) => {
  if (!doc) return null;
  applyAnniversary(doc);
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  delete obj.password;
  delete obj.contact; // old field no longer in schema
  return obj;
};

/** True if the logged-in user is editing their own id */
const isOwnRecord = (req, id) => String(req.user._id) === String(id);

/** New Global Admin / Super Admin → Approved; everyone else → Unapproved */
const defaultDetailsApproval = (role) =>
  role === "Global Admin" || role === "Super Admin"
    ? "Approved"
    : "Unapproved";

/**
 * Lock own profile after Approved.
 * Global Admin / Super Admin never locked.
 * Admins editing someone else are not locked by this.
 */
const isProfileLocked = (req, employee) => {
  if (["Global Admin", "Super Admin"].includes(req.user.role)) return false;
  if (!isOwnRecord(req, employee._id)) return false;
  return employee.detailsApproval === "Approved";
};

// =============================================================================
// CREATE USER — POST /api/employees
// =============================================================================
const createEmployee = async (req, res) => {
  try {
    // Same shape as User model: account flat + nested official / personal / …
    const { name, password, role, status } = req.body;

    const officialIn = { ...(req.body.official || {}) };
    const personalIn = { ...(req.body.personal || {}) };
    delete personalIn.anniversaryDate;

    const email = String(officialIn.officialEmail || "")
      .toLowerCase()
      .trim();

    const official = normalizeSectionUniques("official", {
      ...officialIn,
      officialEmail: email,
      employeeCode: officialIn.employeeCode
        ? String(officialIn.employeeCode).trim().toUpperCase()
        : "",
    });

    const personal = normalizeSectionUniques("personal", personalIn);

    const roleName = (role || "Employee").trim();

    // Unique check, role lookup, and password hash run together so create returns faster.
    const [createConflict, targetRole, hashedPassword] = await Promise.all([
      findUniqueConflict({
        "official.officialEmail": official.officialEmail,
        "official.employeeCode": official.employeeCode,
        "personal.mobileNo": personal.mobileNo,
        "personal.personalEmail": personal.personalEmail,
        "personal.panNo": personal.panNo,
        "personal.aadhaarNo": personal.aadhaarNo,
        "personal.drivingLicenseNo": personal.drivingLicenseNo,
        "personal.passportNo": personal.passportNo,
      }),
      Role.findOne({ name: roleName, status: "Active" }),
      bcrypt.hash(password, 10),
    ]);
    if (createConflict) {
      return res.status(400).json({ message: createConflict });
    }

    if (!targetRole) {
      return res.status(400).json({ message: "Role not found or inactive" });
    }

    // Who can create privileged roles
    if (roleName === "Global Admin" && req.user.role !== "Global Admin") {
      return res.status(403).json({
        message: "Only Global Admin can create Global Admin",
      });
    }
    if (
      roleName === "Super Admin" &&
      !["Global Admin", "Super Admin"].includes(req.user.role)
    ) {
      return res.status(403).json({
        message: "Only Global Admin / Super Admin can create Super Admin",
      });
    }

    // Global Admin → any company; others → own company only
    const companyErr = assertSameCompany(req.user, official.company);
    if (companyErr) {
      return res.status(403).json({ message: companyErr });
    }

    const employee = await User.create({
      name,
      password: hashedPassword,
      role: roleName,
      status: status || "Active",
      detailsApproval: defaultDetailsApproval(roleName),
      personal,
      official,
      ...(req.body.other ? { other: req.body.other } : {}),
      ...(req.body.education ? { education: withoutIds(req.body.education) } : {}),
      ...(req.body.accounts ? { accounts: withoutIds(req.body.accounts) } : {}),
      ...(req.body.family ? { family: withoutIds(req.body.family) } : {}),
      ...(req.body.nominees ? { nominees: withoutIds(req.body.nominees) } : {}),
      ...(req.body.experience ? { experience: withoutIds(req.body.experience) } : {}),
      ...(req.body.visas ? { visas: withoutIds(req.body.visas) } : {}),
      ...(req.body.payroll ? { payroll: req.body.payroll } : {}),
    });

    // Mail goes after the response so SMTP does not hold the request.
    sendWelcomeEmail({
      name,
      email,
      password,
      role: roleName,
      company: official.company,
      department: official.department,
    }).catch((mailErr) => {
      console.error("Welcome email failed:", mailErr.message);
    });

    return res.status(201).json({
      message: "User created",
      employee: safeUser(employee),
    });
  } catch (err) {
    // Mongo duplicate index → friendly message
    const dup = duplicateKeyMessage(err);
    if (dup) return res.status(400).json({ message: dup });
    return res.status(500).json({ message: err.message });
  }
};

/** Keep user text out of regex so search cannot break the query */
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Case-insensitive exact match for dropdown filters */
const exact = (value) => new RegExp(`^${escapeRegex(String(value).trim())}$`, "i");

// =============================================================================
// LIST USERS — GET /api/employees
// Super Admin / HR / Manager → all users, with search, filters, pagination
// Employee → only their own record, same query params
// =============================================================================
const listEmployees = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const skip = (page - 1) * limit;
    const and = [];

    // Employee can search and filter only inside their own profile
    if (!hasAllAccess(req.user)) {
      and.push({ _id: req.user._id });
    } else {
      // Global Admin → all companies; others → own company only
      const scope = companyFilter(req.user);
      if (scope === false) {
        return res.status(403).json({
          message: "Your profile has no company — cannot list employees",
        });
      }
      if (scope) and.push(scope);
    }

    const search = String(req.query.search || "").trim();
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      and.push({
        $or: [
          { name: rx },
          { "official.employeeCode": rx },
          { "official.officialEmail": rx },
        ],
      });
    }

    if (req.query.role) and.push({ role: exact(req.query.role) });
    if (req.query.status) and.push({ status: exact(req.query.status) });
    if (req.query.department) {
      and.push({ "official.department": exact(req.query.department) });
    }
    if (req.query.designation) {
      and.push({ "official.designation": exact(req.query.designation) });
    }
    if (req.query.gender) and.push({ "personal.gender": exact(req.query.gender) });

    const branch = req.query.branch || req.query.company;
    if (branch) and.push({ "official.company": exact(branch) });

    const filter = and.length ? { $and: and } : {};
    const [total, rows] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select(
          "name role status lastLogin official.officialEmail official.employeeCode official.department official.designation official.company personal.gender"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    // Both screens share this list. Full profile is GET /api/employees/:id
    const employees = rows.map((row) => ({
      _id: row._id,
      name: row.name || "",
      email: row.official?.officialEmail || "",
      role: row.role || "",
      department: row.official?.department || "",
      lastLogin: row.lastLogin || null,
      status: row.status || "",
      employeeCode: row.official?.employeeCode || "",
      gender: row.personal?.gender || "",
      designation: row.official?.designation || "",
      branch: row.official?.company || "",
    }));

    return res.json({
      count: employees.length,
      total,
      page,
      limit,
      pages: Math.max(Math.ceil(total / limit), 1),
      from: total === 0 ? 0 : skip + 1,
      to: skip + employees.length,
      employees,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// =============================================================================
// GET ONE USER — GET /api/employees/:id
// =============================================================================
const getEmployee = async (req, res) => {
  try {
    // Employee may only open their own profile
    if (!hasAllAccess(req.user) && !isOwnRecord(req, req.params.id)) {
      return res.status(403).json({ message: "You can only view your own profile" });
    }

    const employee = await User.findById(req.params.id).select("-password");
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    // Admin may only view employees in their own company
    if (hasAllAccess(req.user)) {
      const scopeErr = assertSameCompanyEmployee(req.user, employee);
      if (scopeErr) {
        return res.status(403).json({ message: scopeErr });
      }
    }

    return res.json({ employee: safeUser(employee) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// =============================================================================
// UPDATE USER — PUT /api/employees/:id
// One API for phones, personal, official, education, payroll, etc.
// =============================================================================
const updateEmployee = async (req, res) => {
  try {
    // Employee may only update self
    if (!hasAllAccess(req.user) && !isOwnRecord(req, req.params.id)) {
      return res.status(403).json({ message: "You can only update your own profile" });
    }

    const employee = await User.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const isAdmin = hasAllAccess(req.user); // Super Admin / HR / Manager

    // Admin may only update employees in their own company
    if (isAdmin) {
      const scopeErr = assertSameCompanyEmployee(req.user, employee);
      if (scopeErr) {
        return res.status(403).json({ message: scopeErr });
      }
    }

    // After Approved, owner cannot edit (except Super Admin)
    if (isProfileLocked(req, employee)) {
      return res.status(403).json({
        message: "Details are approved — editing is locked. Contact HR / Admin.",
        detailsApproval: employee.detailsApproval,
      });
    }

    // --- detailsApproval (admin only) ---
    if (req.body.detailsApproval !== undefined) {
      if (!isAdmin) {
        return res.status(403).json({
          message:
            "Only Super Admin / HR Manager / Manager can approve or reject details",
        });
      }
      employee.detailsApproval = req.body.detailsApproval;
    }

    // --- simple top-level fields ---
    if (req.body.name !== undefined) employee.name = req.body.name;
    if (req.body.status !== undefined && isAdmin) employee.status = req.body.status;

    // --- role (admin only) ---
    if (req.body.role !== undefined) {
      if (!isAdmin) {
        return res.status(403).json({ message: "Only admin can change role" });
      }
      if (req.body.role === "Global Admin" && req.user.role !== "Global Admin") {
        return res.status(403).json({
          message: "Only Global Admin can assign Global Admin",
        });
      }
      if (
        req.body.role === "Super Admin" &&
        !["Global Admin", "Super Admin"].includes(req.user.role)
      ) {
        return res.status(403).json({
          message: "Only Global Admin / Super Admin can assign Super Admin",
        });
      }
      employee.role = req.body.role.trim();
    }

    // --- password (Global Admin / Super Admin / HR Manager only) ---
    if (req.body.password) {
      if (
        !["Global Admin", "Super Admin", "HR Manager"].includes(req.user.role)
      ) {
        return res.status(403).json({
          message:
            "Only Global Admin / Super Admin / HR Manager can change password",
        });
      }
      employee.password = await bcrypt.hash(req.body.password, 10);
    }

    // Nested sections from body (already checked by Joi)
    const profile = pickProfile(req.body);

    // official{} is always admin-only (employeeCode, officialEmail, company, …)
    if (profile.official !== undefined && !isAdmin) {
      return res.status(403).json({
        message:
          "Only Super Admin / HR Manager / Manager can update official details (employeeCode, officialEmail, …)",
      });
    }

    // Ignore client anniversaryDate; normalize unique fields (PAN upper, email lower, …)
    if (profile.personal) {
      delete profile.personal.anniversaryDate;
      profile.personal = normalizeSectionUniques("personal", profile.personal);
    }
    if (profile.official) {
      profile.official = normalizeSectionUniques("official", profile.official);

      // Cannot move employee to another company
      if (profile.official.company !== undefined) {
        const companyErr = assertSameCompany(req.user, profile.official.company);
        if (companyErr) {
          return res.status(403).json({ message: companyErr });
        }
      }
    }

    // Collect unique fields that actually changed (skip empty / same value)
    const uniqueCheck = {};
    const addIfChanged = (path, nextVal, currentVal) => {
      if (nextVal === undefined || nextVal === null) return;
      const n = String(nextVal).trim();
      if (!n) return;
      if (n === String(currentVal || "").trim()) return;
      uniqueCheck[path] = n;
    };

    if (profile.official) {
      addIfChanged(
        "official.officialEmail",
        profile.official.officialEmail,
        employee.official?.officialEmail
      );
      addIfChanged(
        "official.employeeCode",
        profile.official.employeeCode,
        employee.official?.employeeCode
      );
    }
    if (profile.personal) {
      addIfChanged(
        "personal.mobileNo",
        profile.personal.mobileNo,
        employee.personal?.mobileNo
      );
      addIfChanged(
        "personal.personalEmail",
        profile.personal.personalEmail,
        employee.personal?.personalEmail
      );
      addIfChanged("personal.panNo", profile.personal.panNo, employee.personal?.panNo);
      addIfChanged(
        "personal.aadhaarNo",
        profile.personal.aadhaarNo,
        employee.personal?.aadhaarNo
      );
      addIfChanged(
        "personal.drivingLicenseNo",
        profile.personal.drivingLicenseNo,
        employee.personal?.drivingLicenseNo
      );
      addIfChanged(
        "personal.passportNo",
        profile.personal.passportNo,
        employee.personal?.passportNo
      );
    }

    const conflict = await findUniqueConflict(uniqueCheck, employee._id);
    if (conflict) {
      return res.status(400).json({ message: conflict });
    }

    // Objects merge. One list row appends or updates. A full array replaces.
    for (const key of Object.keys(profile)) {
      if (OBJECT_SECTIONS.has(key)) {
        employee[key] = mergeSection(employee[key], profile[key], key);
        employee.markModified(key);
      } else if (ARRAY_SECTIONS.has(key)) {
        const arrayError = applyArraySection(employee, key, profile[key]);
        if (arrayError) return res.status(404).json({ message: arrayError });
      } else {
        employee[key] = profile[key];
      }
    }

    // payroll{} — admin only
    if (req.body.payroll !== undefined) {
      if (!isAdmin) {
        return res.status(403).json({
          message: "Payroll can only be set by Super Admin / HR Manager / Manager",
        });
      }
      employee.payroll = req.body.payroll;
    }

    // Save (pre-save hook may refresh anniversaryDate)
    await employee.save();

    return res.json({
      message: "Employee updated",
      employee: safeUser(employee),
    });
  } catch (err) {
    const dup = duplicateKeyMessage(err);
    if (dup) return res.status(400).json({ message: dup });
    return res.status(500).json({ message: err.message });
  }
};

/** Same access rules as profile update: own record, company, approved lock. */
const loadEditableEmployee = async (req) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return { status: 400, message: "Invalid employee id" };
  }
  if (!hasAllAccess(req.user) && !isOwnRecord(req, req.params.id)) {
    return { status: 403, message: "You can only update your own profile" };
  }

  const employee = await User.findById(req.params.id);
  if (!employee) return { status: 404, message: "Employee not found" };

  if (hasAllAccess(req.user)) {
    const scopeErr = assertSameCompanyEmployee(req.user, employee);
    if (scopeErr) return { status: 403, message: scopeErr };
  }

  if (isProfileLocked(req, employee)) {
    return {
      status: 403,
      message: "Details are approved — editing is locked. Contact HR / Admin.",
      detailsApproval: employee.detailsApproval,
    };
  }

  return { employee };
};

const rejectIfBadSection = (section, res) => {
  if (ARRAY_SECTIONS.has(section)) return false;
  res.status(400).json({
    message:
      "section must be education, accounts, family, nominees, experience, or visas",
  });
  return true;
};

const asRowList = (body) => (Array.isArray(body) ? body : [body]);

const collectDeleteIds = (body) => {
  if (!Array.isArray(body)) return [String(body._id)];
  return body.map((entry) =>
    typeof entry === "string" ? String(entry) : String(entry._id)
  );
};

// =============================================================================
// EDIT LIST ROWS — PUT /api/employees/:id/:section/items
// One object, or an array of objects. Each object must include _id.
// =============================================================================
const editArrayItem = async (req, res) => {
  try {
    const { section } = req.params;
    if (rejectIfBadSection(section, res)) return;

    const rows = asRowList(req.body);
    for (const row of rows) {
      if (!mongoose.Types.ObjectId.isValid(row._id)) {
        return res.status(400).json({ message: "Invalid item id" });
      }
      const fields = { ...row };
      delete fields._id;
      if (!Object.keys(fields).length) {
        return res.status(400).json({ message: "Send at least one field to update" });
      }
    }

    const loaded = await loadEditableEmployee(req);
    if (!loaded.employee) {
      return res.status(loaded.status).json({
        message: loaded.message,
        ...(loaded.detailsApproval
          ? { detailsApproval: loaded.detailsApproval }
          : {}),
      });
    }

    const current = asPlainRows(loaded.employee[section]);
    for (const row of rows) {
      const found = current.some((item) => String(item._id) === String(row._id));
      if (!found) {
        return res.status(404).json({ message: `${section} item not found` });
      }
    }

    for (const row of rows) {
      const arrayError = applyArraySection(loaded.employee, section, row);
      if (arrayError) return res.status(404).json({ message: arrayError });
    }

    await loaded.employee.save();
    return res.json({
      message: rows.length === 1 ? `${section} item updated` : `${section} items updated`,
      employee: safeUser(loaded.employee),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// =============================================================================
// DELETE LIST ROWS — DELETE /api/employees/:id/:section/items
// One object { _id }, an array of ids, or an array of { _id }.
// =============================================================================
const deleteArrayItem = async (req, res) => {
  try {
    const { section } = req.params;
    if (rejectIfBadSection(section, res)) return;

    const ids = collectDeleteIds(req.body);
    for (const id of ids) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid item id" });
      }
    }

    const loaded = await loadEditableEmployee(req);
    if (!loaded.employee) {
      return res.status(loaded.status).json({
        message: loaded.message,
        ...(loaded.detailsApproval
          ? { detailsApproval: loaded.detailsApproval }
          : {}),
      });
    }

    const current = asPlainRows(loaded.employee[section]);
    const idSet = new Set(ids.map(String));
    for (const id of idSet) {
      const found = current.some((item) => String(item._id) === id);
      if (!found) {
        return res.status(404).json({ message: `${section} item not found` });
      }
    }

    loaded.employee[section] = current.filter((item) => !idSet.has(String(item._id)));
    loaded.employee.markModified(section);
    await loaded.employee.save();

    return res.json({
      message: idSet.size === 1 ? `${section} item deleted` : `${section} items deleted`,
      employee: safeUser(loaded.employee),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** official{} and payroll{} — Super Admin / HR Manager / Manager (and Global Admin). */
const loadAdminSection = async (req) => {
  if (!hasAllAccess(req.user)) {
    return {
      status: 403,
      message:
        "Only Super Admin / HR Manager / Manager can update official details and payroll",
    };
  }
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return { status: 400, message: "Invalid employee id" };
  }

  const employee = await User.findById(req.params.id);
  if (!employee) return { status: 404, message: "Employee not found" };

  const scopeErr = assertSameCompanyEmployee(req.user, employee);
  if (scopeErr) return { status: 403, message: scopeErr };

  return { employee };
};

const EMPTY_PAYROLL = {
  salaryGroup: "",
  salaryDate: "",
  appraisalDuration: "",
  basic: 0,
  annualCtc: 0,
  grossSalary: 0,
  totalEarning: 0,
  totalDeduction: 0,
  appraisalDate: null,
  paymentMode: "",
  ot1Rate: 0,
  ot2Rate: 0,
  remarks: "",
  uanNo: "",
  pfApply: false,
  pfEmployerShare: false,
  pfNo: "",
  pfType: "",
  pf: "",
  pfApplyFrom: null,
  pfApplyTo: null,
  esiApply: false,
  esiNo: "",
  esiEmployerShare: false,
  esiApplyFrom: null,
  esiApplyTo: null,
  ptApply: false,
  tdsApply: false,
  taxRegime: "New",
  bankName: "",
  bankAccount: "",
  ifsc: "",
};

// =============================================================================
// EDIT official OR payroll — PUT /api/employees/:id/:section
// Same field checks as profile update. Admin roles only.
// =============================================================================
const editObjectSection = async (req, res) => {
  try {
    const { section } = req.params;
    if (section !== "official" && section !== "payroll") {
      return res.status(400).json({ message: "section must be official or payroll" });
    }

    const loaded = await loadAdminSection(req);
    if (!loaded.employee) {
      return res.status(loaded.status).json({ message: loaded.message });
    }

    const employee = loaded.employee;

    if (section === "official") {
      const incoming = normalizeSectionUniques("official", { ...req.body });
      if (incoming.company !== undefined) {
        const companyErr = assertSameCompany(req.user, incoming.company);
        if (companyErr) return res.status(403).json({ message: companyErr });
      }

      const uniqueCheck = {};
      const addIfChanged = (path, nextVal, currentVal) => {
        if (nextVal === undefined || nextVal === null) return;
        const n = String(nextVal).trim();
        if (!n) return;
        if (n === String(currentVal || "").trim()) return;
        uniqueCheck[path] = n;
      };
      addIfChanged(
        "official.officialEmail",
        incoming.officialEmail,
        employee.official?.officialEmail
      );
      addIfChanged(
        "official.employeeCode",
        incoming.employeeCode,
        employee.official?.employeeCode
      );
      const conflict = await findUniqueConflict(uniqueCheck, employee._id);
      if (conflict) return res.status(400).json({ message: conflict });

      employee.official = mergeSection(employee.official, incoming, "official");
      employee.markModified("official");
    } else {
      employee.payroll = mergeSection(employee.payroll, req.body, "payroll");
      employee.markModified("payroll");
    }

    await employee.save();
    return res.json({
      message: `${section} updated`,
      employee: safeUser(employee),
    });
  } catch (err) {
    const dup = duplicateKeyMessage(err);
    if (dup) return res.status(400).json({ message: dup });
    return res.status(500).json({ message: err.message });
  }
};

// =============================================================================
// CLEAR payroll — DELETE /api/employees/:id/payroll
// official stays (it holds the login email). Admin roles only.
// =============================================================================
const deleteObjectSection = async (req, res) => {
  try {
    const { section } = req.params;
    if (section === "official") {
      return res.status(400).json({
        message:
          "Official details cannot be deleted. They hold the login email. Update the fields instead.",
      });
    }
    if (section !== "payroll") {
      return res.status(400).json({ message: "section must be payroll" });
    }

    const loaded = await loadAdminSection(req);
    if (!loaded.employee) {
      return res.status(loaded.status).json({ message: loaded.message });
    }

    loaded.employee.payroll = { ...EMPTY_PAYROLL };
    loaded.employee.markModified("payroll");
    await loaded.employee.save();

    return res.json({
      message: "payroll cleared",
      employee: safeUser(loaded.employee),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// =============================================================================
// DELETE USER — DELETE /api/employees/:id
// =============================================================================
const deleteEmployee = async (req, res) => {
  try {
    // Safety: do not allow deleting your own account
    if (isOwnRecord(req, req.params.id)) {
      return res.status(400).json({ message: "You cannot delete your own account" });
    }

    const employee = await User.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    // Super Admin / HR / Manager → only delete within own company
    const scopeErr = assertSameCompanyEmployee(req.user, employee);
    if (scopeErr) {
      return res.status(403).json({ message: scopeErr });
    }

    await employee.deleteOne();

    return res.json({ message: "Employee deleted", id: req.params.id });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// =============================================================================
// UPLOAD FILE — POST /api/employees/upload
// No user id. Form-data: document (file) + type (education | account)
// Same type always saves in the same Cloudinary folder (hrms/education, hrms/account).
// Returns the URL only. Frontend saves it on Submit (PUT).
// =============================================================================
const uploadAttachment = async (req, res) => {
  try {
    const type = String(req.body.type || "")
      .trim()
      .toLowerCase();
    if (!UPLOAD_TYPES.includes(type)) {
      return res.status(400).json({
        message: "type is required: education or account",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        message: "Please choose a file (PDF, image, Word, or Excel — max 5MB)",
      });
    }

    if (!req.file.buffer) {
      return res.status(400).json({ message: "File could not be read. Select a file, not a folder." });
    }

    const uploaded = await uploadToCloudinary(req.file, type);

    return res.status(201).json({
      success: true,
      message: "File uploaded",
      type,
      folder: uploaded.folder,
      url: uploaded.url,
      fileName: uploaded.originalName,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) console.error("Upload failed:", err.message || err);
    return res.status(status).json({ message: err.message || "Upload failed" });
  }
};

/** One edit API. official/payroll for admins. Lists: one object or an array of objects. */
const editSection = (req, res) => {
  const { section } = req.params;
  if (section === "official" || section === "payroll") {
    return editObjectSection(req, res);
  }
  return editArrayItem(req, res);
};

/** One delete API. Lists: one { _id } or an array of ids. payroll clears. */
const deleteSection = (req, res) => {
  const { section } = req.params;
  if (section === "official" || section === "payroll") {
    return deleteObjectSection(req, res);
  }
  return deleteArrayItem(req, res);
};

module.exports = {
  createEmployee,
  listEmployees,
  getEmployee,
  updateEmployee,
  editSection,
  deleteSection,
  deleteEmployee,
  uploadAttachment,
};
