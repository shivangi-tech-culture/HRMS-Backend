/**
 * Unique field helpers for User
 *
 * PURPOSE:
 *   Keep identity fields unique across employees.
 *   Empty string ("") is allowed for many users — only non-empty values must be unique.
 *
 * FIELDS:
 *   official: officialEmail, employeeCode
 *   personal: mobileNo, personalEmail, panNo, aadhaarNo, drivingLicenseNo, passportNo
 *
 * USED BY:
 *   employee.controller.js on create + update
 */
const User = require("../models/User");

/** List of fields we treat as unique identity */
const UNIQUE_FIELDS = [
  {
    path: "official.officialEmail",
    section: "official",
    key: "officialEmail",
    label: "Official email",
    normalize: (v) => String(v).toLowerCase().trim(),
  },
  {
    path: "official.employeeCode",
    section: "official",
    key: "employeeCode",
    label: "Employee code",
    normalize: (v) => String(v).trim().toUpperCase(),
  },
  {
    path: "personal.mobileNo",
    section: "personal",
    key: "mobileNo",
    label: "Mobile number",
    normalize: (v) => String(v).trim(),
  },
  {
    path: "personal.personalEmail",
    section: "personal",
    key: "personalEmail",
    label: "Personal email",
    normalize: (v) => String(v).toLowerCase().trim(),
  },
  {
    path: "personal.panNo",
    section: "personal",
    key: "panNo",
    label: "PAN number",
    normalize: (v) => String(v).trim().toUpperCase(),
  },
  {
    path: "personal.aadhaarNo",
    section: "personal",
    key: "aadhaarNo",
    label: "Aadhaar number",
    normalize: (v) => String(v).replace(/\s/g, "").trim(), // remove spaces
  },
  {
    path: "personal.drivingLicenseNo",
    section: "personal",
    key: "drivingLicenseNo",
    label: "Driving license number",
    normalize: (v) => String(v).trim().toUpperCase(),
  },
  {
    path: "personal.passportNo",
    section: "personal",
    key: "passportNo",
    label: "Passport number",
    normalize: (v) => String(v).trim().toUpperCase(),
  },
];

/** Quick lookup by Mongo path (for duplicate-key errors) */
const byPath = Object.fromEntries(UNIQUE_FIELDS.map((f) => [f.path, f]));

/**
 * Clean unique fields inside personal{} or official{} before save.
 * Example: pan "abcde1234f" → "ABCDE1234F"
 */
const normalizeSectionUniques = (sectionName, data = {}) => {
  const out = { ...data };
  for (const f of UNIQUE_FIELDS) {
    if (f.section !== sectionName) continue;
    if (out[f.key] === undefined || out[f.key] === null) continue;
    const raw = String(out[f.key]).trim();
    out[f.key] = raw ? f.normalize(raw) : "";
  }
  return out;
};

/**
 * Check if any of the given values already belong to another user.
 * @param {object} values - map like { "personal.mobileNo": "98100…" }
 * @param {string|null} excludeId - current user id (on update, skip self)
 * @returns {Promise<string|null>} friendly error text, or null if ok
 */
const findUniqueConflict = async (values = {}, excludeId = null) => {
  const checks = [];

  for (const f of UNIQUE_FIELDS) {
    const raw = values[f.path];
    if (raw === undefined || raw === null) continue;

    const value = f.normalize(raw);
    if (!value) continue; // empty → skip (not unique)

    const filter = { [f.path]: value };
    if (excludeId) filter._id = { $ne: excludeId }; // allow keeping own value

    checks.push(
      User.findOne(filter)
        .select("_id")
        .lean()
        .then((taken) => (taken ? `${f.label} already exists` : null))
    );
  }

  const results = await Promise.all(checks);
  return results.find(Boolean) || null;
};

/**
 * Turn Mongo error 11000 (duplicate key) into a clear message.
 * Example: "Mobile number already exists"
 */
const duplicateKeyMessage = (err) => {
  if (!err || err.code !== 11000) return null;
  const key = Object.keys(err.keyPattern || err.keyValue || {})[0];
  const field = byPath[key];
  if (field) return `${field.label} already exists`;
  return "Duplicate value — field must be unique";
};

module.exports = {
  UNIQUE_FIELDS,
  normalizeSectionUniques,
  findUniqueConflict,
  duplicateKeyMessage,
};
