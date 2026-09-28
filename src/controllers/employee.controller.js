/**
 * EMPLOYEE CONTROLLER — /api/employees
 *
 * Screen: Employee Management (full HR profile, role = Employee only).
 * Access & Control (lean login users, any role) → accessControl.controller (/api/users).
 */
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User");
const Role = require("../models/Role");
const { maxGlobalAdmins } = require("./role.controller");
const { hasAllAccess } = require("../middleware/auth");
const { queueWelcomeEmail } = require("../utils/mail");
const { logEmployeeActivity } = require("../utils/activityLog");
const ActivityLog = require("../models/ActivityLog");
const { applyAnniversary } = require("../utils/anniversary");
const { sendExcel } = require("../utils/excel");
const { uploadToCloudinary, UPLOAD_TYPES } = require("../middleware/upload");
const {
  normalizeSectionUniques,
  findUniqueConflict,
  duplicateKeyMessage,
} = require("../utils/uniqueFields");
const {
  assertSameCompany,
  assertSameCompanyEmployee,
  isSameCompany,
  hasGlobalCompanyAccess,
} = require("../utils/companyScope");
const {
  buildListQuery,
  mapEmployeeListRow,
  LIST_SELECT,
} = require("../utils/userAccount");

/** True for Global Admin / Super Admin (lean login accounts, no full HR profile) */
const isPlatformAdminRole = (role) =>
  role === "Global Admin" || role === "Super Admin";

/**
 * After promoting someone to Global / Super Admin, strip heavy HR profile fields.
 * Used on update only — Access & Control owns creating those roles.
 */
const unsetEmployeeProfileFields = async (userId, roleName) => {
  const unset = {
    other: 1,
    education: 1,
    accounts: 1,
    family: 1,
    nominees: 1,
    experience: 1,
    visas: 1,
    payroll: 1,
    "official.employeeCode": 1,
    "official.designation": 1,
    "official.reportingHead1": 1,
    "official.reportingHead2": 1,
    "official.jobRole": 1,
    "official.dateOfJoining": 1,
    "official.calculateSalaryFrom": 1,
    "official.dateOfRetirement": 1,
    "official.grade": 1,
  };
  if (roleName === "Global Admin") {
    unset.personal = 1;
    unset["official.company"] = 1;
    unset["official.department"] = 1;
  }
  await User.collection.updateOne({ _id: userId }, { $unset: unset });
};

/** Strip password before sending a user in the API response */
const safeUser = (doc) => {
  if (!doc) return null;
  applyAnniversary(doc);
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  delete obj.password;
  delete obj.contact;
  return obj;
};

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

/**
 * Fields that mean "same row" — used to block duplicate append/update.
 * Example: same courseName + institute + year → education already exists.
 */
const ARRAY_IDENTITY = {
  education: ["courseName", "courseType", "instituteName", "passingYear"],
  accounts: ["accountNo"],
  family: ["name", "relation"],
  nominees: ["nominateFor", "nomineeName", "relation"],
  experience: ["organization", "designation", "fromDate"],
  visas: ["visaNumber"],
};

const normIdentityVal = (v) => {
  if (v === undefined || v === null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim().toLowerCase();
};

/** Build compare key for one list row; null = nothing to check (all empty) */
const rowIdentityKey = (section, row) => {
  const keys = ARRAY_IDENTITY[section];
  if (!keys || !row) return null;
  const parts = keys.map((k) => normIdentityVal(row[k]));
  if (parts.every((p) => !p)) return null;
  // Strong ids must be present
  if (section === "accounts" && !parts[0]) return null;
  if (section === "visas" && !parts[0]) return null;
  return parts.join("|");
};

/** True if another row in the list has the same identity */
const hasDuplicateRow = (section, rows, candidate, excludeId = "") => {
  const key = rowIdentityKey(section, candidate);
  if (!key) return false;
  return rows.some((item) => {
    if (excludeId && String(item._id) === String(excludeId)) return false;
    return rowIdentityKey(section, item) === key;
  });
};

/** True if the incoming list itself has two identical rows */
const hasDuplicateWithin = (section, rows) => {
  const seen = new Set();
  for (const item of rows) {
    const key = rowIdentityKey(section, item);
    if (!key) continue;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
};

/** Turn Mongoose subdocs into plain objects for list edits */
const asPlainRows = (value) => {
  const rows = Array.isArray(value) ? value : [];
  return rows.map((row) =>
    row && typeof row.toObject === "function" ? row.toObject() : { ...row }
  );
};

/**
 * One object without _id → append (error if same row already exists).
 * One object with _id → update that row (error if result matches another row).
 * Array → replace list (error if list has internal duplicates).
 * Returns error message, or null.
 */
const applyArraySection = (employee, key, incoming) => {
  if (Array.isArray(incoming)) {
    if (hasDuplicateWithin(key, incoming)) {
      return `${key} already exists`;
    }
    employee[key] = incoming;
    employee.markModified(key);
    return null;
  }

  const current = asPlainRows(employee[key]);
  const row = { ...incoming };
  const id = row._id ? String(row._id) : "";

  if (!id) {
    delete row._id;
    if (hasDuplicateRow(key, current, row)) {
      return `${key} already exists`;
    }
    current.push(row);
    employee[key] = current;
    employee.markModified(key);
    return null;
  }

  const index = current.findIndex((item) => String(item._id) === id);
  if (index === -1) {
    return `${key} item not found`;
  }
  const merged = { ...current[index], ...row, _id: current[index]._id };
  if (hasDuplicateRow(key, current, merged, id)) {
    return `${key} already exists`;
  }
  current[index] = merged;
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

/** True if the logged-in user is editing their own id */
const isOwnRecord = (req, id) => String(req.user._id) === String(id);

/**
 * CREATE EMPLOYEE — POST /api/employees
 *
 * Who: Global Admin / Super Admin / HR Manager only (route authorize).
 * Employee role never creates — only edits own General Info after create.
 * Always forces role = Employee. Access & Control → POST /api/users.
 */
const createEmployee = async (req, res) => {
  try {
    // 1. Read body fields
    const { name, password, status } = req.body;
    const officialIn = { ...(req.body.official || {}) };
    const personalIn = { ...(req.body.personal || {}) };
    delete personalIn.anniversaryDate; // computed server-side from DOB

    const email = String(officialIn.officialEmail || "")
      .toLowerCase()
      .trim();

    // 2. Resolve company (Super Admin → own company; others → body + same-company check)
    const actorCompany = String(req.user.official?.company || "").trim();
    let company = "";

    if (req.user.role === "Super Admin") {
      if (!actorCompany) {
        return res.status(403).json({
          message: "Your profile has no company — cannot create users",
        });
      }
      const requested = String(officialIn.company || "").trim();
      if (requested && !isSameCompany(actorCompany, requested)) {
        return res.status(403).json({
          message: "Super Admin can only create employees for their own company",
        });
      }
      company = actorCompany;
    } else {
      // Company must come from body (UI dropdown) — no silent default
      company = String(officialIn.company || "").trim();
      if (!company) {
        return res.status(400).json({ message: "official.company is required" });
      }
      const companyErr = assertSameCompany(req.user, company);
      if (companyErr) {
        return res.status(403).json({ message: companyErr });
      }
    }

    const official = normalizeSectionUniques("official", {
      ...officialIn,
      officialEmail: email,
      company,
      employeeCode: officialIn.employeeCode
        ? String(officialIn.employeeCode).trim().toUpperCase()
        : "",
    });
    const personal = normalizeSectionUniques("personal", personalIn);

    // 3. Check unique email / emp code / mobile etc.
    const uniquePayload = {
      "official.officialEmail": official.officialEmail,
      "official.employeeCode": official.employeeCode,
      "personal.mobileNo": personal.mobileNo,
      "personal.personalEmail": personal.personalEmail,
      "personal.panNo": personal.panNo,
      "personal.aadhaarNo": personal.aadhaarNo,
      "personal.drivingLicenseNo": personal.drivingLicenseNo,
      "personal.passportNo": personal.passportNo,
    };

    const [createConflict, targetRole, hashedPassword] = await Promise.all([
      findUniqueConflict(uniquePayload),
      Role.findOne({ name: "Employee", status: "Active" }),
      bcrypt.hash(password, 10),
    ]);
    if (createConflict) {
      return res.status(400).json({ message: createConflict });
    }
    if (!targetRole) {
      return res.status(400).json({ message: "Role not found or inactive" });
    }

    // Build create document (optional profile sections)
    const createDoc = {
      name,
      password: hashedPassword,
      role: "Employee",
      status: status || "Active",
      official,
      personal,
    };
    if (req.body.other) createDoc.other = req.body.other;
    for (const key of ARRAY_SECTIONS) {
      if (req.body[key] === undefined) continue;
      const rows = Array.isArray(req.body[key])
        ? req.body[key]
        : [req.body[key]];
      if (hasDuplicateWithin(key, rows)) {
        return res.status(400).json({ message: `${key} already exists` });
      }
      createDoc[key] = withoutIds(req.body[key]);
    }
    if (req.body.payroll) createDoc.payroll = req.body.payroll;

    // 4. Create User with role Employee (password already hashed above)
    const employee = await User.create(createDoc);

    await logEmployeeActivity({
      actor: req.user,
      employee,
      action: "create",
      summary: `${req.user.name} created employee ${employee.name}`,
      changes: ["name", "official", "personal"],
    });

    // 5. Welcome email in background — never wait on SMTP (Render timeouts were ~60s)
    const mail = queueWelcomeEmail({
      name,
      email,
      password,
      role: "Employee",
      company: official.company || "",
      department: String(official.department || "").trim(),
    });

    // 6. Return employee without password
    const fresh = await User.findById(employee._id).select("-password");
    return res.status(201).json({
      message: `Employee created. Welcome email queued for ${mail.emailTo}.`,
      emailQueued: true,
      emailTo: mail.emailTo || email,
      employee: safeUser(fresh),
    });
  } catch (err) {
    const dup = duplicateKeyMessage(err);
    if (dup) return res.status(400).json({ message: dup });
    return res.status(500).json({ message: err.message });
  }
};

/**
 * LIST EMPLOYEES — GET /api/employees
 *
 * Admin table only. Employee role uses GET /:id for own profile (not list).
 * Query: search|q, status, department, designation, gender, company|branch, page, limit
 * Always filters role = Employee.
 */
const listEmployees = async (req, res) => {
  try {
    const built = buildListQuery(req, { forceRole: "Employee" });
    if (built.error) {
      return res.status(built.error.status).json({ message: built.error.message });
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

    const employees = rows.map(mapEmployeeListRow);

    return res.json({
      count: employees.length,
      total,
      page,
      limit,
      pages: Math.max(Math.ceil(total / limit), 1),
      from: total === 0 ? 0 : skip + 1,
      to: skip + employees.length,
      filters: applied,
      employees,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * EXPORT EXCEL — GET /api/employees/export
 * Same filters as list (no pagination). Admin only — not Employee role.
 * Permission: Employee → Employee → export
 */
const exportEmployees = async (req, res) => {
  try {
    const built = buildListQuery(req, { forceRole: "Employee" });
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
      const m = mapEmployeeListRow(row);
      return {
        name: m.name,
        employeeCode: m.employeeCode,
        gender: m.gender,
        designation: m.designation,
        department: m.department,
        branch: m.branch,
        status: m.status,
        email: m.email,
      };
    });

    await sendExcel(
      res,
      "employees.xlsx",
      [
        { header: "Employee Name", key: "name", width: 24 },
        { header: "Code", key: "employeeCode", width: 14 },
        { header: "Gender", key: "gender", width: 10 },
        { header: "Designation", key: "designation", width: 22 },
        { header: "Department", key: "department", width: 16 },
        { header: "Branch", key: "branch", width: 32 },
        { header: "Status", key: "status", width: 12 },
        { header: "Email", key: "email", width: 28 },
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
 * GET ONE — GET /api/employees/:id
 *
 * Auth: Employee → own profile only; admin → same company
 * Response: full user without password (safeUser).
 */
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

    // Global Admin → all companies / all users
    // Super Admin / HR / Manager → own company only
    if (hasAllAccess(req.user) && !hasGlobalCompanyAccess(req.user)) {
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

/**
 * UPDATE — PUT /api/employees/:id
 *
 * Body: any nested sections in one request (personal, official, education, …)
 * Auth: Employee → self only (no official/payroll); admin → same company
 */
const updateEmployee = async (req, res) => {
  try {
    // --- Access check (self vs admin, company scope, Global Admin skip) ---
    if (!hasAllAccess(req.user) && !isOwnRecord(req, req.params.id)) {
      return res.status(403).json({ message: "You can only update your own profile" });
    }

    const employee = await User.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const isAdmin = hasAllAccess(req.user); // Global / Super / HR / Manager

    // Global Admin → all companies; Super Admin / HR / Manager → own company only
    if (isAdmin && !hasGlobalCompanyAccess(req.user)) {
      const scopeErr = assertSameCompanyEmployee(req.user, employee);
      if (scopeErr) {
        return res.status(403).json({ message: scopeErr });
      }
    }

    const changedKeys = Object.keys(req.body || {}).filter(
      (k) => req.body[k] !== undefined
    );

    // --- name / status / role / password ---
    if (req.body.name !== undefined) employee.name = req.body.name;
    if (req.body.status !== undefined && isAdmin) employee.status = req.body.status;

    if (req.body.role !== undefined) {
      if (!isAdmin) {
        return res.status(403).json({ message: "Only admin can change role" });
      }
      const nextRole = String(req.body.role || "").trim();
      if (nextRole === "Global Admin") {
        if (req.user.role !== "Global Admin") {
          return res.status(403).json({
            message: "Only Global Admin can assign Global Admin",
          });
        }
        if (employee.role !== "Global Admin") {
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
        if (!employee.official) employee.official = {};
        employee.official.company = "";
      }
      if (
        nextRole === "Super Admin" &&
        !["Global Admin", "Super Admin"].includes(req.user.role)
      ) {
        return res.status(403).json({
          message: "Only Global Admin / Super Admin can assign Super Admin",
        });
      }
      // Super Admin may only promote users in own company (already scoped above)
      if (nextRole === "Super Admin" && req.user.role === "Super Admin") {
        const actorCo = String(req.user.official?.company || "").trim();
        const targetCo = String(employee.official?.company || "").trim();
        if (!actorCo || !isSameCompany(actorCo, targetCo)) {
          return res.status(403).json({
            message:
              "Super Admin can only assign Super Admin to users in their own company",
          });
        }
      }
      employee.role = nextRole;
    }

    // Password — Global Admin / Super Admin / HR Manager only
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

    // --- official{} — ADMIN ONLY (employeeCode, designation, dept, …)
    // Employee cannot edit official details or employee code
    const profile = pickProfile(req.body);

    if (profile.official !== undefined && !isAdmin) {
      return res.status(403).json({
        message:
          "Employee cannot edit official details or employee code. Contact HR / Admin.",
      });
    }

    // payroll{} — ADMIN ONLY (check early; Employee never)
    if (req.body.payroll !== undefined && !isAdmin) {
      return res.status(403).json({
        message: "Employee cannot edit payroll. Contact HR / Admin.",
      });
    }

    // Ignore client anniversaryDate; normalize unique fields (PAN upper, email lower, …)
    if (profile.personal) {
      delete profile.personal.anniversaryDate;
      profile.personal = normalizeSectionUniques("personal", profile.personal);
    }
    if (profile.official) {
      const emailAttempt = profile.official.officialEmail;
      const companyAttempt = profile.official.company;
      delete profile.official.officialEmail;
      delete profile.official.company;

      if (emailAttempt !== undefined) {
        const next = String(emailAttempt || "")
          .trim()
          .toLowerCase();
        const cur = String(employee.official?.officialEmail || "")
          .trim()
          .toLowerCase();
        if (next && next !== cur) {
          return res.status(400).json({
            message: "official.officialEmail cannot be changed",
          });
        }
      }
      if (companyAttempt !== undefined) {
        const next = String(companyAttempt || "").trim();
        const cur = String(employee.official?.company || "").trim();
        if (next && cur && !isSameCompany(next, cur)) {
          return res.status(400).json({
            message: "official.company cannot be changed",
          });
        }
        if (next && !cur) {
          return res.status(400).json({
            message: "official.company cannot be changed",
          });
        }
      }

      profile.official = normalizeSectionUniques("official", profile.official);
    }

    // --- unique conflict checks (only fields that actually changed) ---
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

    // --- merge personal / official / arrays / payroll ---
    // Objects merge. One list row appends or updates. A full array replaces.
    for (const key of Object.keys(profile)) {
      if (OBJECT_SECTIONS.has(key)) {
        employee[key] = mergeSection(employee[key], profile[key], key);
        employee.markModified(key);
      } else if (ARRAY_SECTIONS.has(key)) {
        const arrayError = applyArraySection(employee, key, profile[key]);
        if (arrayError) {
          const status = arrayError.includes("not found") ? 404 : 400;
          return res.status(status).json({ message: arrayError });
        }
      } else {
        employee[key] = profile[key];
      }
    }

    // payroll{} — admin only (Employee already rejected above)
    if (req.body.payroll !== undefined) {
      employee.payroll = mergeSection(employee.payroll, req.body.payroll, "payroll");
      employee.markModified("payroll");
    }

    // --- save + response ---
    await employee.save();

    await logEmployeeActivity({
      actor: req.user,
      employee,
      action: "update",
      summary: `${req.user.name} updated employee ${employee.name}`,
      changes: changedKeys,
    });

    // Role promote to Global / Super → strip heavy HR profile fields
    if (
      req.body.role !== undefined &&
      isPlatformAdminRole(String(req.body.role).trim())
    ) {
      await unsetEmployeeProfileFields(
        employee._id,
        String(req.body.role).trim()
      );
      const fresh = await User.findById(employee._id).select("-password");
      return res.json({
        message: "Employee updated",
        employee: safeUser(fresh),
      });
    }

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

  // Global Admin → all companies; Super Admin / HR / Manager → own company only
  if (hasAllAccess(req.user) && !hasGlobalCompanyAccess(req.user)) {
    const scopeErr = assertSameCompanyEmployee(req.user, employee);
    if (scopeErr) return { status: 403, message: scopeErr };
  }

  return { employee };
};

/** Reject if :section is not a known list section; writes 400 and returns true */
const rejectIfBadSection = (section, res) => {
  if (ARRAY_SECTIONS.has(section)) return false;
  res.status(400).json({
    message:
      "section must be education, accounts, family, nominees, experience, or visas",
  });
  return true;
};

/** Normalize delete body to an array of item id strings */
const collectDeleteIds = (body) => {
  if (!Array.isArray(body)) return [String(body._id)];
  return body.map((entry) =>
    typeof entry === "string" ? String(entry) : String(entry._id)
  );
};

/**
 * DELETE LIST ROWS — DELETE /api/employees/:id/:section
 *
 * Params: section = education | accounts | family | nominees | experience | visas
 * Body: one { _id }, an array of ids, or an array of { _id }
 * Auth: same as profile update (own record / company / approved lock)
 */
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

    await logEmployeeActivity({
      actor: req.user,
      employee: loaded.employee,
      action: "section_delete",
      section,
      summary: `${req.user.name} deleted ${idSet.size} ${section} item(s) for ${loaded.employee.name}`,
      changes: [...idSet],
    });

    return res.json({
      message: idSet.size === 1 ? `${section} item deleted` : `${section} items deleted`,
      employee: safeUser(loaded.employee),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** official{} / payroll{} clear — admin only (Employee role blocked). */
const loadAdminSection = async (req) => {
  if (!hasAllAccess(req.user)) {
    return {
      status: 403,
      message:
        "Employee cannot clear official details or payroll. Contact HR / Admin.",
    };
  }
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return { status: 400, message: "Invalid employee id" };
  }

  const employee = await User.findById(req.params.id);
  if (!employee) return { status: 404, message: "Employee not found" };

  // Global Admin → all companies; Super Admin / HR / Manager → own company only
  if (!hasGlobalCompanyAccess(req.user)) {
    const scopeErr = assertSameCompanyEmployee(req.user, employee);
    if (scopeErr) return { status: 403, message: scopeErr };
  }

  return { employee };
};

/** Blank payroll object used when clearing payroll via DELETE */
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

/**
 * CLEAR PAYROLL — DELETE /api/employees/:id/payroll
 *
 * Auth: Super Admin / HR Manager / Manager / Global Admin (same company)
 * official cannot be deleted (holds login email) — update fields instead.
 */
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

    await logEmployeeActivity({
      actor: req.user,
      employee: loaded.employee,
      action: "section_delete",
      section: "payroll",
      summary: `${req.user.name} cleared payroll for ${loaded.employee.name}`,
      changes: ["payroll"],
    });

    return res.json({
      message: "payroll cleared",
      employee: safeUser(loaded.employee),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * DELETE USER — DELETE /api/employees/:id
 *
 * Auth: Global Admin, Super Admin, HR Manager, Manager (same company)
 * Cannot delete your own account.
 */
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

    // Global Admin → all companies; Super Admin / HR / Manager → own company only
    if (!hasGlobalCompanyAccess(req.user)) {
      const scopeErr = assertSameCompanyEmployee(req.user, employee);
      if (scopeErr) {
        return res.status(403).json({ message: scopeErr });
      }
    }

    await logEmployeeActivity({
      actor: req.user,
      employee,
      action: "delete",
      summary: `${req.user.name} deleted employee ${employee.name}`,
      changes: ["employee"],
    });

    await employee.deleteOne();

    return res.json({ message: "Employee deleted", id: req.params.id });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * UPLOAD — POST /api/employees/upload
 * Form-data: document + type (education|account). Returns url only.
 */
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
    });
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) console.error("Upload failed:", err.message || err);
    return res.status(status).json({ message: err.message || "Upload failed" });
  }
};

/**
 * DELETE SECTION — DELETE /api/employees/:id/:section
 *
 * Router entry: payroll / official → clear object; otherwise → delete list rows.
 * Body for lists: one { _id } or an array of ids.
 */
const deleteSection = (req, res) => {
  const { section } = req.params;
  if (section === "official" || section === "payroll") {
    return deleteObjectSection(req, res);
  }
  return deleteArrayItem(req, res);
};

/**
 * ACTIVITY LOG (employee) — GET /api/employees/:id/activity
 * Employee sees own tracking. Admin sees that employee's full history.
 */
const listEmployeeActivity = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid employee id" });
    }

    if (!hasAllAccess(req.user) && !isOwnRecord(req, req.params.id)) {
      return res.status(403).json({ message: "You can only view your own activity" });
    }

    const employee = await User.findById(req.params.id).select(
      "name role official"
    );
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    if (hasAllAccess(req.user) && !hasGlobalCompanyAccess(req.user)) {
      const scopeErr = assertSameCompanyEmployee(req.user, employee);
      if (scopeErr) {
        return res.status(403).json({ message: scopeErr });
      }
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter = { "employee.id": employee._id };
    if (req.query.action) filter.action = String(req.query.action).trim();

    const [total, logs] = await Promise.all([
      ActivityLog.countDocuments(filter),
      ActivityLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return res.json({
      employee: {
        id: employee._id,
        name: employee.name,
        officialEmail: employee.official?.officialEmail || "",
        employeeCode: employee.official?.employeeCode || "",
        company: employee.official?.company || "",
        department: employee.official?.department || "",
      },
      count: logs.length,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
      logs,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * ACTIVITY LOG (admin) — GET /api/employees/activity
 * All employee edits in company (Global Admin = all companies).
 */
const listCompanyActivity = async (req, res) => {
  try {
    if (!hasAllAccess(req.user)) {
      return res.status(403).json({ message: "Only admin can view company activity" });
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter = {};
    if (!hasGlobalCompanyAccess(req.user)) {
      filter.company = String(req.user.official?.company || "").trim();
    } else if (req.query.company) {
      filter.company = String(req.query.company).trim();
    }
    if (req.query.action) filter.action = String(req.query.action).trim();
    if (req.query.actorId && mongoose.Types.ObjectId.isValid(req.query.actorId)) {
      filter["actor.id"] = req.query.actorId;
    }
    if (
      req.query.employeeId &&
      mongoose.Types.ObjectId.isValid(req.query.employeeId)
    ) {
      filter["employee.id"] = req.query.employeeId;
    }

    const [total, logs] = await Promise.all([
      ActivityLog.countDocuments(filter),
      ActivityLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return res.json({
      count: logs.length,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
      logs,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  createEmployee,
  listEmployees,
  exportEmployees,
  getEmployee,
  updateEmployee,
  listEmployeeActivity,
  listCompanyActivity,
  deleteSection,
  deleteEmployee,
  uploadAttachment,
};
