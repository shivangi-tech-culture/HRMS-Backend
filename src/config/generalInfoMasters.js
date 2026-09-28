/**
 * ESS General Info dropdown catalogs — values match live UI
 * (hrms-techculture.vercel.app General Info hardcoded arrays).
 *
 * Admin can add more later via POST /api/masters.
 * Vaccination module exists in UI but is not seeded / not supported here.
 */
const { DEFAULT_COMPANY } = require("../utils/companyScope");

/** Exact option lists from frontend chunk (as-is casing/spelling) */
const UI_DROPDOWNS = {
  courseType: ["Full Time", "Part Time", "Distance", "Online"],
  courseLevel: [
    "10th",
    "12th",
    "Diploma",
    "Graduation",
    "Post Graduation",
    "Doctorate",
    "Certification",
  ],
  bankName: [
    "ABHYUDAYA CO-OPERATIVE BANK LIMITED",
    "STATE BANK OF INDIA",
    "HDFC BANK",
    "ICICI BANK",
    "AXIS BANK",
    "PUNJAB NATIONAL BANK",
  ],
  relation: [
    "Spouse",
    "Father",
    "Mother",
    "Son",
    "Daughter",
    "Brother",
    "Sister",
    "Other",
  ],
  nominateFor: ["PF", "FNF", "Gratuity", "GTLI", "GPA", "GHI"],
  country: [
    "India",
    "United States",
    "United Kingdom",
    "United Arab Emirates",
    "Singapore",
    "Germany",
    "Canada",
    "Australia",
    "Japan",
    "Saudi Arabia",
  ],
  visaType: [
    "Employment Visa",
    "Business Visa",
    "Project Visa",
    "Entry visa",
    "Tourist Visa",
    "Research Visa",
    "Transit Visa",
    "Conference Visa",
    "Medical Visa",
  ],
  // Work Timings — WH Calculation dropdown (UI)
  whCalculation: ["Shift Based", "Fixed Hours", "Flexible"],
  // Personal / Other — shown as selects in UI; no hardcoded array in FE chunk
  gender: ["Male", "Female", "Other"],
  maritalStatus: ["Single", "Married", "Divorced", "Widowed"],
  bloodGroup: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
};

/** Official org masters (demo seed) */
const OFFICIAL_DROPDOWNS = {
  department: ["Administration", "HR", "Engineering", "Finance"],
  designation: [
    "Software Engineer",
    "HR Manager",
    "Engineering Manager",
    "Finance Executive",
  ],
  division: ["HO", "RO"],
  employeeGroup: ["Permanent", "Contract"],
  grade: ["G1", "G2", "G3", "G4", "G5"],
  jobRole: ["Executive", "Manager", "Intern", "Consultant"],
};

/**
 * Flatten to seed rows: { type, name, company? }
 * company type has no company field.
 */
const buildMasterSeedRows = (company = DEFAULT_COMPANY) => {
  const rows = [{ type: "company", name: company }];

  const add = (type, names) => {
    for (const name of names) {
      rows.push({ type, name, company });
    }
  };

  for (const [type, names] of Object.entries(OFFICIAL_DROPDOWNS)) {
    add(type, names);
  }
  for (const [type, names] of Object.entries(UI_DROPDOWNS)) {
    add(type, names);
  }

  return rows;
};

module.exports = {
  UI_DROPDOWNS,
  OFFICIAL_DROPDOWNS,
  buildMasterSeedRows,
};
