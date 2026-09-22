/**
 * Employee / User controller
 *
 *   officialEmail → personal.officialEmail (login ID)
 *   mobileNo → personal.mobileNo
 *   company/department → official
 *   city/state/country → personal.permanentAddress
 *
 * Personal also has: workPhone, workExt (update via personal{})
 */
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Role = require("../models/Role");
const { hasAllAccess } = require("../middleware/auth");
const { sendWelcomeEmail } = require("../utils/mail");
const { uploadToCloudinary } = require("../middleware/upload");
const { applyAnniversary } = require("../utils/anniversary");

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

const pickProfile = (body = {}) => {
  const out = {};
  for (const key of PROFILE_KEYS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
};

const OBJECT_SECTIONS = new Set(["personal", "official", "other"]);

/** Shallow-merge section; deep-merge addresses inside personal */
const mergeSection = (existing, incoming, sectionKey) => {
  const base = existing && typeof existing.toObject === "function"
    ? existing.toObject()
    : { ...(existing || {}) };
  const next = { ...base, ...incoming };

  if (sectionKey === "personal") {
    if (incoming.presentAddress) {
      next.presentAddress = { ...(base.presentAddress || {}), ...incoming.presentAddress };
    }
    if (incoming.permanentAddress) {
      next.permanentAddress = { ...(base.permanentAddress || {}), ...incoming.permanentAddress };
    }
  }
  return next;
};

/** Strip password and refresh anniversary for API responses */
const safeUser = (doc) => {
  if (!doc) return null;
  applyAnniversary(doc);
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  delete obj.password;
  delete obj.contact; // legacy field removed from schema
  return obj;
};

const isOwnRecord = (req, id) => String(req.user._id) === String(id);

/** Super Admin starts Approved; HR / Manager / Employee start Unapproved */
const defaultDetailsApproval = (role) =>
  role === "Super Admin" ? "Approved" : "Unapproved";

/**
 * Own-profile edit lock when Approved.
 * Super Admin is never locked. HR / Manager / Employee behave like profile owners.
 */
const isProfileLocked = (req, employee) => {
  if (req.user.role === "Super Admin") return false;
  if (!isOwnRecord(req, employee._id)) return false;
  return employee.detailsApproval === "Approved";
};

// -----------------------------------------------------------------------------
// POST /api/employees — Create User (Access & Control)
// -----------------------------------------------------------------------------
const createEmployee = async (req, res) => {
  try {
    const {
      name,
      officialEmail,
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
    if (await User.findOne({ "personal.officialEmail": email })) {
      return res.status(400).json({ message: "Official email already exists" });
    }

    const roleName = (role || "Employee").trim();
    const targetRole = await Role.findOne({ name: roleName, status: "Active" });
    if (!targetRole) {
      return res.status(400).json({ message: "Role not found or inactive" });
    }

    // Only Super Admin can assign Super Admin role
    if (roleName === "Super Admin" && req.user.role !== "Super Admin") {
      return res.status(403).json({ message: "Only Super Admin can create Super Admin" });
    }

    const official = {
      company: company || "",
      department: department || "",
    };

    const employee = await User.create({
      name,
      password: await bcrypt.hash(password, 10),
      role: roleName,
      status: status || "Active",
      detailsApproval: defaultDetailsApproval(roleName),
      personal: {
        officialEmail: email,
        mobileNo: mobileNo || "",
        permanentAddress: {
          city: city || "",
          state: state || "",
          country: country || "",
        },
      },
      official,
    });

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
    return res.status(500).json({ message: err.message });
  }
};

// -----------------------------------------------------------------------------
// GET /api/employees — list (admin = all, employee = self)
// -----------------------------------------------------------------------------
const listEmployees = async (req, res) => {
  try {
    const filter = {};
    if (!hasAllAccess(req.user)) {
      filter._id = req.user._id;
    }

    const employees = await User.find(filter).select("-password").sort({ createdAt: -1 });
    return res.json({
      count: employees.length,
      employees: employees.map(safeUser),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// -----------------------------------------------------------------------------
// GET /api/employees/:id
// -----------------------------------------------------------------------------
const getEmployee = async (req, res) => {
  try {
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

// -----------------------------------------------------------------------------
// PUT /api/employees/:id — update profile / detailsApproval / password
// -----------------------------------------------------------------------------
const updateEmployee = async (req, res) => {
  try {
    if (!hasAllAccess(req.user) && !isOwnRecord(req, req.params.id)) {
      return res.status(403).json({ message: "You can only update your own profile" });
    }

    const employee = await User.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const isAdmin = hasAllAccess(req.user);

    // Own profile locked when Approved (HR/Manager/Employee — not Super Admin)
    if (isProfileLocked(req, employee)) {
      return res.status(403).json({
        message: "Details are approved — editing is locked. Contact HR / Admin.",
        detailsApproval: employee.detailsApproval,
      });
    }

    // detailsApproval — admin only (Unapproved | Approved | Rejected)
    if (req.body.detailsApproval !== undefined) {
      if (!isAdmin) {
        return res.status(403).json({
          message: "Only Super Admin / HR Manager / Manager can approve or reject details",
        });
      }
      employee.detailsApproval = req.body.detailsApproval;
    }

    // Basic
    if (req.body.name !== undefined) employee.name = req.body.name;
    if (req.body.status !== undefined && isAdmin) employee.status = req.body.status;

    // Role — admin only
    if (req.body.role !== undefined) {
      if (!isAdmin) {
        return res.status(403).json({ message: "Only admin can change role" });
      }
      if (req.body.role === "Super Admin" && req.user.role !== "Super Admin") {
        return res.status(403).json({ message: "Only Super Admin can assign Super Admin" });
      }
      employee.role = req.body.role.trim();
    }

    // Password — Super Admin / HR Manager only
    if (req.body.password) {
      if (!["Super Admin", "HR Manager"].includes(req.user.role)) {
        return res.status(403).json({
          message: "Only Super Admin / HR Manager can change password",
        });
      }
      employee.password = await bcrypt.hash(req.body.password, 10);
    }

    // Profile sections (fields already verified by Joi)
    const profile = pickProfile(req.body);

    // official{} — entire object is admin only
    if (profile.official !== undefined && !isAdmin) {
      return res.status(403).json({
        message: "Only Super Admin / HR Manager / Manager can update official details",
      });
    }

    // personal.employeeCode — admin only; anniversaryDate — auto (ignore client)
    if (profile.personal) {
      delete profile.personal.anniversaryDate;

      if (!isAdmin) {
        if (profile.personal.employeeCode !== undefined) {
          return res.status(403).json({
            message: "Only Super Admin / HR Manager / Manager can edit employee code",
          });
        }
        delete profile.personal.employeeCode;
      }
    }

    // If official email changes, keep it unique
    if (profile.personal?.officialEmail !== undefined) {
      const newEmail = String(profile.personal.officialEmail).toLowerCase().trim();
      profile.personal.officialEmail = newEmail;
      if (newEmail && newEmail !== (employee.personal?.officialEmail || "")) {
        const taken = await User.findOne({
          "personal.officialEmail": newEmail,
          _id: { $ne: employee._id },
        });
        if (taken) {
          return res.status(400).json({ message: "Official email already exists" });
        }
      }
    }

    // Apply profile: merge objects, replace arrays
    for (const key of Object.keys(profile)) {
      if (OBJECT_SECTIONS.has(key)) {
        employee[key] = mergeSection(employee[key], profile[key], key);
        employee.markModified(key);
      } else {
        employee[key] = profile[key]; // education, accounts, family, …
      }
    }

    // Payroll — admin only
    if (req.body.payroll !== undefined) {
      if (!isAdmin) {
        return res.status(403).json({
          message: "Payroll can only be set by Super Admin / HR Manager / Manager",
        });
      }
      employee.payroll = req.body.payroll;
    }

    // anniversaryDate refreshed in User pre-save from dateOfJoining
    await employee.save();

    return res.json({
      message: "Employee updated",
      employee: safeUser(employee),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// -----------------------------------------------------------------------------
// DELETE /api/employees/:id
// -----------------------------------------------------------------------------
const deleteEmployee = async (req, res) => {
  try {
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

// -----------------------------------------------------------------------------
// POST /api/employees/:id/education/document — Cloudinary upload
// Form-data field: document (PDF, JPG, PNG, DOC)
// Returns Cloudinary URL → save as education[].document
// -----------------------------------------------------------------------------
const uploadEducationDocument = async (req, res) => {
  try {
    if (!hasAllAccess(req.user) && !isOwnRecord(req, req.params.id)) {
      return res.status(403).json({ message: "You can only upload for your own profile" });
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
      return res.status(400).json({ message: "Please choose a file (certificate / marksheet)" });
    }

    const uploaded = await uploadToCloudinary(req.file);

    return res.status(201).json({
      message: "Document uploaded to Cloudinary",
      document: uploaded.url, // Cloudinary secure URL
      documentName: uploaded.originalName,
      publicId: uploaded.publicId,
      hint: "Save document + documentName on education[] via PUT /api/employees/:id",
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
