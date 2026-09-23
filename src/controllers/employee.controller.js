/**
 * Employee / User controller
 *
 * APIs:
 *   POST   /api/employees              → create user (admin)
 *   GET    /api/employees              → list users
 *   GET    /api/employees/:id          → get one user
 *   PUT    /api/employees/:id          → update profile (same API for admin + employee)
 *   DELETE /api/employees/:id          → delete user
 *   POST   /api/employees/upload               → Cloudinary file (type: education | account)
 *
 * Create mapping:
 *   Required flat: name, officialEmail, password, role, company, department, status
 *   Optional flat: employeeCode, mobileNo, city, state, country
 *   Optional nested (saved in the same request):
 *     personal, official, other, education, accounts, family,
 *     nominees, experience, visas, payroll
 *   Flat fields fill official / personal when the nested object omits them.
 *   officialEmail (top level) is always the login id.
 *
 * Update rules:
 *   Employee  → personal, other, education, accounts, family, nominees, experience, visas
 *   Admin     → everything above + official, payroll, detailsApproval, role, status
 *   Password  → Super Admin / HR Manager only
 */
const bcrypt = require("bcryptjs");
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

/** These sections are objects (merge fields). Arrays are replaced as a whole. */
const OBJECT_SECTIONS = new Set(["personal", "official", "other"]);

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

/** New Super Admin → Approved; everyone else → Unapproved */
const defaultDetailsApproval = (role) =>
  role === "Super Admin" ? "Approved" : "Unapproved";

/**
 * Lock own profile after Approved.
 * Super Admin is never locked. Admins editing someone else are not locked by this.
 */
const isProfileLocked = (req, employee) => {
  if (req.user.role === "Super Admin") return false;
  if (!isOwnRecord(req, employee._id)) return false;
  return employee.detailsApproval === "Approved";
};

// =============================================================================
// CREATE USER — POST /api/employees
// =============================================================================
const createEmployee = async (req, res) => {
  try {
    // Account fields stay flat. Profile sections are optional on the same body.
    const {
      name,
      officialEmail,
      employeeCode,
      password,
      mobileNo,
      role,
      company,
      department,
      city,
      state,
      country,
      status,
    } = req.body;

    const email = String(officialEmail).toLowerCase().trim();
    const code = employeeCode ? String(employeeCode).trim().toUpperCase() : "";
    const mobile = mobileNo ? String(mobileNo).trim() : "";

    const officialIn = { ...(req.body.official || {}) };
    const personalIn = { ...(req.body.personal || {}) };
    delete personalIn.anniversaryDate;

    const permanentAddress = { ...(personalIn.permanentAddress || {}) };
    if (city && !permanentAddress.city) permanentAddress.city = city;
    if (state && !permanentAddress.state) permanentAddress.state = state;
    if (country && !permanentAddress.country) permanentAddress.country = country;

    const official = normalizeSectionUniques("official", {
      ...officialIn,
      officialEmail: email,
      employeeCode: code || officialIn.employeeCode || "",
      company: company || officialIn.company || "",
      department: department || officialIn.department || "",
    });

    const personal = normalizeSectionUniques("personal", {
      ...personalIn,
      mobileNo: mobile || personalIn.mobileNo || "",
      permanentAddress,
    });

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

    // Only a Super Admin can create another Super Admin
    if (roleName === "Super Admin" && req.user.role !== "Super Admin") {
      return res.status(403).json({ message: "Only Super Admin can create Super Admin" });
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
      if (req.body.role === "Super Admin" && req.user.role !== "Super Admin") {
        return res
          .status(403)
          .json({ message: "Only Super Admin can assign Super Admin" });
      }
      employee.role = req.body.role.trim();
    }

    // --- password (Super Admin / HR Manager only) ---
    if (req.body.password) {
      if (!["Super Admin", "HR Manager"].includes(req.user.role)) {
        return res.status(403).json({
          message: "Only Super Admin / HR Manager can change password",
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

    // Apply: objects merge, arrays replace
    for (const key of Object.keys(profile)) {
      if (OBJECT_SECTIONS.has(key)) {
        employee[key] = mergeSection(employee[key], profile[key], key);
        employee.markModified(key); // tell Mongoose nested object changed
      } else {
        employee[key] = profile[key]; // education, accounts, family, …
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

// =============================================================================
// DELETE USER — DELETE /api/employees/:id
// =============================================================================
const deleteEmployee = async (req, res) => {
  try {
    // Safety: do not allow deleting your own account
    if (isOwnRecord(req, req.params.id)) {
      return res.status(400).json({ message: "You cannot delete your own account" });
    }

    const employee = await User.findByIdAndDelete(req.params.id);
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

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

module.exports = {
  createEmployee,
  listEmployees,
  getEmployee,
  updateEmployee,
  deleteEmployee,
  uploadAttachment,
};
