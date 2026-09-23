/**
 * Employee / User controller
 *
 * APIs:
 *   POST   /api/employees              → create user (admin)
 *   GET    /api/employees              → list users
 *   GET    /api/employees/:id          → get one user
 *   PUT    /api/employees/:id          → update profile (same API for admin + employee)
 *   DELETE /api/employees/:id          → delete user
 *   POST   /api/employees/:id/education/document → upload certificate to Cloudinary
 *
 * Create mapping (flat body → nested document):
 *   officialEmail → official.officialEmail (login id)
 *   employeeCode  → official.employeeCode
 *   mobileNo      → personal.mobileNo
 *   company/dept  → official
 *   city/state/country → personal.permanentAddress
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
const { uploadToCloudinary } = require("../middleware/upload");
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
    // Flat fields from Access & Control form
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

    // Clean values before save / unique checks
    const email = String(officialEmail).toLowerCase().trim();
    const code = employeeCode ? String(employeeCode).trim().toUpperCase() : "";
    const mobile = mobileNo ? String(mobileNo).trim() : "";

    // Stop early if email / code / mobile already used
    const createConflict = await findUniqueConflict({
      "official.officialEmail": email,
      "official.employeeCode": code,
      "personal.mobileNo": mobile,
    });
    if (createConflict) {
      return res.status(400).json({ message: createConflict });
    }

    // Role must exist and be Active
    const roleName = (role || "Employee").trim();
    const targetRole = await Role.findOne({ name: roleName, status: "Active" });
    if (!targetRole) {
      return res.status(400).json({ message: "Role not found or inactive" });
    }

    // Only a Super Admin can create another Super Admin
    if (roleName === "Super Admin" && req.user.role !== "Super Admin") {
      return res.status(403).json({ message: "Only Super Admin can create Super Admin" });
    }

    // Nested official block
    const official = {
      officialEmail: email,
      employeeCode: code,
      company: company || "",
      department: department || "",
    };

    // Create user (password hashed)
    const employee = await User.create({
      name,
      password: await bcrypt.hash(password, 10),
      role: roleName,
      status: status || "Active",
      detailsApproval: defaultDetailsApproval(roleName),
      personal: {
        mobileNo: mobile,
        permanentAddress: {
          city: city || "",
          state: state || "",
          country: country || "",
        },
      },
      official,
    });

    // Welcome mail is best-effort (user is still created if mail fails)
    let emailSent = false;
    let emailError = null;
    try {
      await sendWelcomeEmail({
        name,
        email,
        password,
        role: roleName,
        company: official.company,
        department: official.department,
      });
      emailSent = true;
    } catch (mailErr) {
      console.error("Welcome email failed:", mailErr.message);
      emailError = mailErr.message;
    }

    return res.status(201).json({
      message: emailSent
        ? "User created and welcome email sent"
        : "User created but welcome email failed",
      emailSent,
      emailError,
      employee: safeUser(employee),
    });
  } catch (err) {
    // Mongo duplicate index → friendly message
    const dup = duplicateKeyMessage(err);
    if (dup) return res.status(400).json({ message: dup });
    return res.status(500).json({ message: err.message });
  }
};

// =============================================================================
// LIST USERS — GET /api/employees
// Admin sees all; Employee sees only self
// =============================================================================
const listEmployees = async (req, res) => {
  try {
    const filter = {};
    if (!hasAllAccess(req.user)) {
      filter._id = req.user._id;
    }

    const employees = await User.find(filter)
      .select("-password")
      .sort({ createdAt: -1 });

    return res.json({
      count: employees.length,
      employees: employees.map(safeUser),
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
// UPLOAD EDUCATION DOCUMENT — POST /api/employees/:id/education/document
// Form-data: document (file only)
// Only uploads to Cloudinary → returns URL.
// Frontend puts document + documentName into education[] on Submit (PUT).
// =============================================================================
const uploadEducationDocument = async (req, res) => {
  try {
    if (!hasAllAccess(req.user) && !isOwnRecord(req, req.params.id)) {
      return res
        .status(403)
        .json({ message: "You can only upload for your own profile" });
    }

    const employee = await User.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    if (isProfileLocked(req, employee)) {
      return res.status(403).json({
        message: "Details are approved — editing is locked. Contact HR / Admin.",
      });
    }

    if (!req.file) {
      return res
        .status(400)
        .json({ message: "Please choose a file (certificate / marksheet)" });
    }

    const uploaded = await uploadToCloudinary(req.file);

    return res.status(201).json({
      success: true,
      message: "Document uploaded",
      document: uploaded.url,
      documentName: uploaded.originalName,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  createEmployee,
  listEmployees,
  getEmployee,
  updateEmployee,
  deleteEmployee,
  uploadEducationDocument,
};
