/**
 * PROFILE COMPLETION (weighted) — Employee / HR / Manager
 *
 * Section weights (sum = 100):
 *   official (professional, HR/Manager fills)  30%
 *   personal                                   25%
 *   documents                                  15%
 *   accounts (bank)                            10%
 *   education / family / nominees / experience  5% each
 *
 * Official + Personal + Documents = 70% → profile “ready”; no completion reminder.
 * Below 70% → shouldSendReminder = true.
 *
 * Mandatory checklist lives only in personal + documents + official.
 */
const { normalizeRoleName } = require("../config/roles");

/** At/above this % we treat profile as complete enough — no reminder */
const REMINDER_THRESHOLD = 70;

/**
 * Max points each section can contribute to overall %.
 * official + personal + documents = 70 (reminder cutoff).
 */
const SECTION_WEIGHTS = {
  official: 30,
  personal: 25,
  documents: 15,
  accounts: 10,
  education: 5,
  family: 5,
  nominees: 5,
  experience: 5,
};

const SECTION_LABELS = {
  official: "Professional / Official",
  personal: "Personal",
  documents: "Documents",
  accounts: "Bank accounts",
  education: "Education",
  family: "Family",
  nominees: "Nominees",
  experience: "Experience",
};

/** Scalar / date / ObjectId is “filled” when non-empty */
const isFilled = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return !Number.isNaN(value) && value !== 0;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    if (value._bsontype === "ObjectID" || value.buffer) {
      return String(value).length === 24;
    }
    return Object.values(value).some(isFilled);
  }
  return String(value).trim().length > 0;
};

const getPath = (obj, path) => {
  if (!obj || !path) return undefined;
  return path.split(".").reduce((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return acc[key];
  }, obj);
};

/** ≥1 list row with a meaningful value */
const listHasRow = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows.some((row) => {
    if (!row || typeof row !== "object") return false;
    return Object.entries(row).some(([key, val]) => {
      if (key === "_id" || key === "id" || key === "active" || key === "mediclaim") {
        return false;
      }
      if (key === "salaryAccount" || key === "amountPercent") {
        return typeof val === "number" ? val > 0 : isFilled(val);
      }
      return isFilled(val);
    });
  });
};

/** ≥1 list row where `docKey` (e.g. document / attachment) is filled */
const listHasDocument = (rows, docKey) => {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows.some((row) => row && isFilled(row[docKey]));
};

/**
 * Checklist fields.
 * mandatory: true → only personal / documents / official (reminder + identity).
 * kind: "list" | "listDoc" → special fill checks.
 */
const PROFILE_FIELDS = [
  // —— PERSONAL 25% (mandatory core) ——
  { key: "name", label: "Full name", section: "personal", mandatory: true },
  {
    key: "personal.dateOfBirth",
    label: "Date of birth",
    section: "personal",
    mandatory: true,
  },
  { key: "personal.aadhaarNo", label: "Aadhaar number", section: "personal", mandatory: true },
  { key: "personal.panNo", label: "PAN number", section: "personal", mandatory: true },
  { key: "personal.gender", label: "Gender", section: "personal", mandatory: true },
  { key: "personal.mobileNo", label: "Mobile number", section: "personal", mandatory: true },
  {
    key: "personal.personalEmail",
    label: "Personal email",
    section: "personal",
    mandatory: false,
  },
  {
    key: "personal.fatherOrHusbandName",
    label: "Father / husband name",
    section: "personal",
    mandatory: false,
  },
  { key: "personal.motherName", label: "Mother name", section: "personal", mandatory: false },
  {
    key: "personal.maritalStatus",
    label: "Marital status",
    section: "personal",
    mandatory: false,
  },
  { key: "personal.bloodGroup", label: "Blood group", section: "personal", mandatory: false },
  {
    key: "personal.emergencyContact1",
    label: "Emergency contact 1",
    section: "personal",
    mandatory: true,
  },
  {
    key: "personal.presentAddress.address",
    label: "Present address",
    section: "personal",
    mandatory: true,
  },
  {
    key: "personal.presentAddress.city",
    label: "Present city",
    section: "personal",
    mandatory: true,
  },
  {
    key: "personal.presentAddress.state",
    label: "Present state",
    section: "personal",
    mandatory: true,
  },
  {
    key: "personal.presentAddress.pincode",
    label: "Present pincode",
    section: "personal",
    mandatory: true,
  },
  {
    key: "personal.permanentAddress.address",
    label: "Permanent address",
    section: "personal",
    mandatory: false,
  },
  {
    key: "personal.permanentAddress.city",
    label: "Permanent city",
    section: "personal",
    mandatory: false,
  },
  {
    key: "personal.permanentAddress.state",
    label: "Permanent state",
    section: "personal",
    mandatory: false,
  },
  {
    key: "personal.permanentAddress.pincode",
    label: "Permanent pincode",
    section: "personal",
    mandatory: false,
  },

  // —— DOCUMENTS 15% ——
  {
    key: "profileUrl",
    label: "Profile photo",
    section: "documents",
    mandatory: true,
  },
  {
    key: "education.document",
    label: "Education document",
    section: "documents",
    mandatory: false,
    kind: "listDoc",
    listKey: "education",
    docKey: "document",
  },
  {
    key: "accounts.attachment",
    label: "Bank proof attachment",
    section: "documents",
    mandatory: false,
    kind: "listDoc",
    listKey: "accounts",
    docKey: "attachment",
  },

  // —— OFFICIAL / PROFESSIONAL 30% (HR / Manager fills) ——
  {
    key: "official.officialEmail",
    label: "Official email",
    section: "official",
    mandatory: true,
  },
  {
    key: "official.companyIds",
    label: "Company",
    section: "official",
    mandatory: true,
  },
  {
    key: "official.employeeCode",
    label: "Employee code",
    section: "official",
    mandatory: true,
  },
  {
    key: "official.department",
    label: "Department",
    section: "official",
    mandatory: true,
  },
  {
    key: "official.designation",
    label: "Designation",
    section: "official",
    mandatory: true,
  },
  {
    key: "official.dateOfJoining",
    label: "Date of joining",
    section: "official",
    mandatory: true,
  },
  { key: "official.branchId", label: "Branch", section: "official", mandatory: true },
  { key: "official.shiftId", label: "Shift", section: "official", mandatory: true },
  {
    key: "official.reportingHead1",
    label: "Reporting manager",
    section: "official",
    mandatory: false,
  },
  { key: "official.division", label: "Division", section: "official", mandatory: false },
  {
    key: "official.employeeGroup",
    label: "Employee group",
    section: "official",
    mandatory: false,
  },
  { key: "official.grade", label: "Grade", section: "official", mandatory: false },

  // —— EXTRA SECTIONS (5–10% each; push above 70%) ——
  {
    key: "accounts",
    label: "Bank account (at least 1)",
    section: "accounts",
    mandatory: false,
    kind: "list",
  },
  {
    key: "education",
    label: "Education (at least 1)",
    section: "education",
    mandatory: false,
    kind: "list",
  },
  {
    key: "family",
    label: "Family (at least 1)",
    section: "family",
    mandatory: false,
    kind: "list",
  },
  {
    key: "nominees",
    label: "Nominee (at least 1)",
    section: "nominees",
    mandatory: false,
    kind: "list",
  },
  {
    key: "experience",
    label: "Experience (at least 1)",
    section: "experience",
    mandatory: false,
    kind: "list",
  },
];

const fieldFilled = (user, field) => {
  if (field.kind === "list") {
    return listHasRow(getPath(user, field.key));
  }
  if (field.kind === "listDoc") {
    return listHasDocument(getPath(user, field.listKey), field.docKey);
  }
  return isFilled(getPath(user, field.key));
};

const pct = (filled, total) =>
  total <= 0 ? 0 : Math.round((filled / total) * 100);

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Compute weighted profile completion for a User document.
 */
const computeProfileCompletion = (user) => {
  const items = PROFILE_FIELDS.map((field) => {
    const filled = fieldFilled(user, field);
    return {
      key: field.key,
      label: field.label,
      section: field.section,
      mandatory: !!field.mandatory,
      filled,
    };
  });

  const totalFields = items.length;
  const filledFields = items.filter((i) => i.filled).length;
  const remainingFields = totalFields - filledFields;

  const mandatoryItems = items.filter((i) => i.mandatory);
  const optionalItems = items.filter((i) => !i.mandatory);

  const mandatoryFilled = mandatoryItems.filter((i) => i.filled).length;
  const mandatoryTotal = mandatoryItems.length;
  const mandatoryRemaining = mandatoryTotal - mandatoryFilled;

  const optionalFilled = optionalItems.filter((i) => i.filled).length;
  const optionalTotal = optionalItems.length;

  const missingMandatory = mandatoryItems
    .filter((i) => !i.filled)
    .map((i) => ({ key: i.key, label: i.label, section: i.section }));

  const missingOptional = optionalItems
    .filter((i) => !i.filled)
    .map((i) => ({ key: i.key, label: i.label, section: i.section }));

  /**
   * Weighted section scores.
   * Core sections (personal / documents / official): earn weight from
   * **mandatory fields only** — so filling all mandatory there = exactly 70%.
   * Extra sections (bank / family / …): earn weight from their checklist item(s).
   */
  const CORE_SECTIONS = new Set(["personal", "documents", "official"]);
  const sectionKeys = Object.keys(SECTION_WEIGHTS);
  let earnedPoints = 0;

  const sections = sectionKeys.map((section) => {
    const weight = SECTION_WEIGHTS[section];
    const sectionItems = items.filter((i) => i.section === section);
    const filled = sectionItems.filter((i) => i.filled).length;
    const total = sectionItems.length;

    const mItems = sectionItems.filter((i) => i.mandatory);
    const mFilled = mItems.filter((i) => i.filled).length;

    let scoredFilled;
    let scoredTotal;
    if (CORE_SECTIONS.has(section) && mItems.length > 0) {
      // Core: only mandatory drive the section's % points
      scoredFilled = mFilled;
      scoredTotal = mItems.length;
    } else {
      scoredFilled = filled;
      scoredTotal = total;
    }

    const sectionPct = pct(scoredFilled, scoredTotal);
    const earned = scoredTotal > 0 ? (scoredFilled / scoredTotal) * weight : 0;
    earnedPoints += earned;

    return {
      key: section,
      label: SECTION_LABELS[section] || section,
      weight,
      percentage: sectionPct,
      earned: round1(earned),
      filled,
      total,
      remaining: total - filled,
      mandatoryFilled: mFilled,
      mandatoryTotal: mItems.length,
      mandatoryRemaining: mItems.length - mFilled,
      missing: sectionItems
        .filter((i) => !i.filled)
        .map((i) => ({
          key: i.key,
          label: i.label,
          mandatory: i.mandatory,
        })),
    };
  });

  const percentage = Math.round(earnedPoints);
  const consideredComplete = percentage >= REMINDER_THRESHOLD;
  const shouldSendReminder = percentage < REMINDER_THRESHOLD;

  return {
    userId: user._id,
    name: user.name || "",
    role: normalizeRoleName(user.role) || user.role || "",
    employeeCode: user.official?.employeeCode || "",
    percentage,
    reminderThreshold: REMINDER_THRESHOLD,
    /** true when % < 70 — send profile-completion reminder */
    shouldSendReminder,
    /** true when % ≥ 70 — treat as complete enough (no reminder) */
    consideredComplete,
    /** 100% of all weighted sections */
    isComplete: percentage >= 100,
    totalFields,
    filledFields,
    remainingFields,
    mandatoryComplete: mandatoryRemaining === 0,
    mandatory: {
      total: mandatoryTotal,
      filled: mandatoryFilled,
      remaining: mandatoryRemaining,
      complete: mandatoryRemaining === 0,
      /** Only personal + documents + official */
      sections: ["personal", "documents", "official"],
      missing: missingMandatory,
    },
    optional: {
      total: optionalTotal,
      filled: optionalFilled,
      remaining: optionalTotal - optionalFilled,
      missing: missingOptional,
    },
    weights: { ...SECTION_WEIGHTS },
    sections,
    missingMandatory,
    missingOptional,
    /** Fill these mandatory items to reach 70% (unlock punch-in) */
    completeThese: missingMandatory,
  };
};

module.exports = {
  PROFILE_FIELDS,
  SECTION_WEIGHTS,
  REMINDER_THRESHOLD,
  computeProfileCompletion,
  isFilled,
};
