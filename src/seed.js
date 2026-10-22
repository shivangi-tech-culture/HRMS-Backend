/**
 * DATABASE SEED — one run for the demo database. Run: npm run seed
 * Order: roles → masters → company → users → leave → holidays → break policies.
 *
 * Passwords:
 *   Super Admin / Admin → 123456
 *   HR / Manager / Employee → {employeeCode}{ddmmyyyy of DOB}
 *     e.g. TC001 + 15/01/2005 → TC00115012005
 *
 * Company code TC → codes TC001… Common DOB: 2005-01-15.
 * DOJ mixed: some still Probation (seed day), some Permanent (DOJ ≥ 3 months ago).
 *
 * Run one piece alone: seed:masters | seed:leave | seed:holiday | seed:on-duty | seed:on-tour
 */
require("dotenv").config();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const connectDB = require("./config/db");
const User = require("./models/User");
const Role = require("./models/Role");
const {
  getModel,
  clearAllMasterCollections,
  COLLECTION_BY_TYPE,
} = require("./models/Master");
const {
  ADMIN_TREE,
  ESS_TREE,
  permissionsForRole,
  totalForRole,
  countPermissions,
} = require("./config/permissions");
const {
  SUPER_ADMIN,
  ADMIN,
  HR,
  REPORTING_MANAGER,
  EMPLOYEE,
  SYSTEM_ROLES,
  ROLE_DESCRIPTIONS,
  isPlatformRole,
} = require("./config/roles");
const { sendWelcomeEmail } = require("./utils/mail");
const { DEFAULT_COMPANY } = require("./utils/companyScope");
const Company = require("./models/Company");
const { WEEK_DAYS } = Company;
const Holiday = require("./models/Holiday");
const EmployeeCodeSeq = require("./models/EmployeeCodeSeq");
const { formatEmployeeCode } = require("./utils/employeeCode");
const { seedLeaveDefaults } = require("./utils/seedLeave");
const { seedBreakPolicies } = require("./utils/breakPolicy");
const { seedHolidays } = require("./scripts/seedHolidays");
const { cloudinary, folderFor } = require("./middleware/upload");

/** Escape text for SVG attribute / text nodes */
const escapeXml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Build a simple cursive-style signature PNG/SVG and upload to hrms/signature.
 * Uses the person's display name so each seed signature looks different.
 * Returns "" when Cloudinary is not configured (seed still continues).
 */
const cloudinaryReady = () =>
  Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );

const safePublicId = (name, prefix) => {
  const slug =
    String(name || "user")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "user";
  return `${prefix}-${slug}`;
};

/** Dummy profile avatar (initials) → hrms/profile. "" if Cloudinary missing. */
const uploadSeedProfile = async (name) => {
  if (!cloudinaryReady()) return "";
  const label = String(name || "User").trim() || "User";
  const initials = label
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "U";
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#0ea5e9"/><stop offset="100%" stop-color="#0369a1"/>
  </linearGradient></defs>
  <rect width="256" height="256" rx="128" fill="url(#g)"/>
  <text x="128" y="148" text-anchor="middle" font-family="Arial, sans-serif" font-size="96" font-weight="700" fill="#ffffff">${escapeXml(initials)}</text>
</svg>`;
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    folder: folderFor("profile"),
    resource_type: "image",
    public_id: safePublicId(label, "seed-profile"),
    overwrite: true,
    invalidate: true,
  });
  return result.secure_url || "";
};

/** Cursive-style signature → hrms/signature. "" if Cloudinary missing. */
const uploadSeedSignature = async (name) => {
  if (!cloudinaryReady()) return "";
  const label = String(name || "Signature").trim() || "Signature";
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="480" height="140" viewBox="0 0 480 140">
  <rect width="480" height="140" fill="#ffffff"/>
  <path d="M28 108 Q120 40 220 78 T420 70" fill="none" stroke="#1e293b" stroke-width="2.2" stroke-linecap="round" opacity="0.35"/>
  <text x="36" y="78" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="42" fill="#0f172a">${escapeXml(label)}</text>
  <line x1="36" y1="108" x2="300" y2="108" stroke="#94a3b8" stroke-width="1"/>
</svg>`;
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    folder: folderFor("signature"),
    resource_type: "image",
    public_id: safePublicId(label, "seed-sign"),
    overwrite: true,
    invalidate: true,
  });
  return result.secure_url || "";
};

/** Common test DOB for HR / managers / employees (password uses ddmmyyyy) */
const COMMON_DOB = "2005-01-15";
const dobPasswordPart = (() => {
  const [y, m, d] = COMMON_DOB.split("-");
  return `${d}${m}${y}`; // 15012005
})();
/** Login password = employeeCode + DOB (ddmmyyyy) */
const passwordFromCode = (code) => `${code}${dobPasswordPart}`;
const seedTodayYmd = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
/** Shift YYYY-MM-DD by whole months (Kolkata calendar day) */
const shiftYmdMonths = (ymd, months) => {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const dt = new Date(y, m - 1 + months, d);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
};

const weekDays = (start, end, satEnd = "13:30") =>
  WEEK_DAYS.map((day) => {
    if (day === "sunday") return { day, isOff: true };
    if (day === "saturday") {
      return { day, isOff: false, startTime: start, endTime: satEnd };
    }
    return {
      day,
      isOff: false,
      startTime: start,
      endTime: end,
      breakStartTime: "13:00",
      breakEndTime: "14:00",
    };
  });

const fourWeeks = (start, end, satEnd) =>
  [1, 2, 3, 4].map((weekNumber) => ({
    weekNumber,
    days: weekDays(start, end, satEnd),
  }));

const EMPLOYEE_PROFILE_UNSET = {
  personal: 1,
  education: 1,
  accounts: 1,
  family: 1,
  nominees: 1,
  experience: 1,
  visas: 1,
  payroll: 1,
  "official.employeeCode": 1,
  "official.department": 1,
  "official.designation": 1,
  "official.reportingHead1": 1,
  "official.reportingHead2": 1,
  "official.jobRole": 1,
  "official.dateOfJoining": 1,
  "official.calculateSalaryFrom": 1,
  "official.dateOfRetirement": 1,
  "official.grade": 1,
};

const seed = async () => {
  await connectDB();

  await User.deleteMany({});
  await Role.deleteMany({});
  await clearAllMasterCollections();
  await Company.deleteMany({});
  await Holiday.deleteMany({});
  await EmployeeCodeSeq.deleteMany({});
  for (const name of ["branches", "shifts", "shiftassignments"]) {
    try {
      await mongoose.connection.dropCollection(name);
      console.log(`Dropped collection: ${name}`);
    } catch (_) {}
  }
  try {
    await mongoose.connection.dropCollection("masters");
    console.log("Dropped legacy collection: masters");
  } catch (_) {}
  try {
    await mongoose.connection.dropCollection("companies");
    console.log("Dropped legacy master collection: companies");
  } catch (_) {}
  for (const name of ["modules", "headings", "submodules"]) {
    try {
      await mongoose.connection.dropCollection(name);
      console.log(`Dropped collection: ${name}`);
    } catch (_) {}
  }
  for (const idx of ["email_1", "personal.officialEmail_1"]) {
    try {
      await User.collection.dropIndex(idx);
      console.log(`Dropped legacy index: ${idx}`);
    } catch (_) {}
  }

  console.log("Old data cleared");
  console.log(`Default company → ${DEFAULT_COMPANY}`);
  console.log("\nHierarchy:");
  console.log("  Super Admin (1) → Admin (many) → HR / Reporting Manager → Employee");

  console.log("\nAdmin blocks (permissions.js):");
  for (const b of ADMIN_TREE) {
    console.log(`  ${b.module} | ${b.heading} → ${b.subModules.length} subs`);
  }

  for (const name of SYSTEM_ROLES) {
    const role = await Role.create({
      name,
      description: ROLE_DESCRIPTIONS[name] || "",
      catalog: name === EMPLOYEE ? "employee" : "admin",
      permissions: permissionsForRole(name),
      status: "Active",
    });
    console.log(
      `Role → ${role.name} (${countPermissions(role.permissions)} of ${totalForRole(role.name)})`
    );
  }

  const { buildMasterSeedRows } = require("./config/generalInfoMasters");
  const masters = buildMasterSeedRows();

  const masterId = {};
  for (const m of masters) {
    const Model = getModel(m.type);
    const created = await Model.create({
      name: m.name,
      code: m.code,
      company: "",
      status: "Active",
    });
    masterId[`${m.type}:${m.name}`] = created._id;
    console.log(`Master → ${m.type} (${COLLECTION_BY_TYPE[m.type]}): ${m.name}`);
  }

  const noida = masterId["branch:Noida"];
  const delhi = masterId["branch:Delhi"];
  const general = masterId["shift:General Shift"];
  const evening = masterId["shift:Evening Shift"];
  const standardShifts = () => [
    { shiftId: general, isActive: true, monthlySchedule: fourWeeks("10:00", "19:00") },
    { shiftId: evening, isActive: true, monthlySchedule: fourWeeks("14:00", "23:00", "18:00") },
  ];

  const companyOrg = await Company.create({
    companyName: DEFAULT_COMPANY,
    companyCode: "TC",
    isActive: true,
    branches: [
      { branchId: noida, city: "Noida", state: "Uttar Pradesh", isActive: true, shifts: standardShifts() },
      { branchId: delhi, city: "Delhi", state: "Delhi", isActive: true, shifts: standardShifts() },
    ],
  });
  let companyId = companyOrg._id;
  const codeFor = (n) => formatEmployeeCode(companyOrg.companyCode, n);
  const dojProbation = seedTodayYmd(); // still in 3-month window → Probation on ID card
  const dojPermanent = shiftYmdMonths(dojProbation, -4); // 4 months ago → Permanent
  const stillThere = await Company.findById(companyId).select("_id companyCode").lean();
  if (!stillThere) {
    throw new Error("Company create did not persist — check MongoDB companyorgs");
  }
  console.log(
    `Company → ${companyOrg.companyName} (${companyOrg.companyCode}) id ${companyId}`
  );
  console.log(
    `DOB → ${COMMON_DOB} (pass …${dobPasswordPart}) | DOJ Probation=${dojProbation} | DOJ Permanent=${dojPermanent}`
  );

  // Codes: HR 001 · Managers 002–003 · Employees 004–007
  const users = [
    {
      name: "Super Admin",
      password: "123456",
      role: SUPER_ADMIN,
      status: "Active",
      platformAdmin: true,
      withSignature: true,
      official: { officialEmail: "superadmin@gmail.com" },
    },
    {
      name: "Admin User",
      password: "123456",
      role: ADMIN,
      status: "Active",
      platformAdmin: true,
      withSignature: true,
      official: { officialEmail: "admin@gmail.com" },
    },
    {
      name: "Anupama",
      role: HR,
      status: "Active",
      withSignature: true,
      withProfile: true,
      personal: {
        dateOfBirth: COMMON_DOB,
        bloodGroup: "B+",
        mobileNo: "9876500100",
        gender: "Female",
      },
      official: {
        employeeCode: codeFor(1),
        officialEmail: "anupama@techculture.ai",
        companyIds: [companyId],
        department: "HR",
        designation: "HR Manager",
        dateOfJoining: dojPermanent,
        branchId: noida,
        shiftId: general,
      },
    },
    {
      name: "Manav",
      role: REPORTING_MANAGER,
      status: "Active",
      withProfile: true,
      personal: {
        dateOfBirth: COMMON_DOB,
        bloodGroup: "A+",
        mobileNo: "9876500201",
        gender: "Male",
      },
      official: {
        employeeCode: codeFor(2),
        officialEmail: "manav@techculture.ai",
        companyIds: [companyId],
        department: "Engineering",
        designation: "Engineering Manager",
        dateOfJoining: dojPermanent,
        branchId: noida,
        shiftId: general,
      },
    },
    {
      name: "Manoj",
      role: REPORTING_MANAGER,
      status: "Active",
      withProfile: true,
      personal: {
        dateOfBirth: COMMON_DOB,
        bloodGroup: "O+",
        mobileNo: "9876500202",
        gender: "Male",
      },
      official: {
        employeeCode: codeFor(3),
        officialEmail: "manoj@techculture.ai",
        companyIds: [companyId],
        department: "Engineering",
        designation: "Engineering Manager",
        dateOfJoining: dojPermanent,
        branchId: delhi,
        shiftId: evening,
      },
    },
    {
      // Probation complete → ID card employeeType Permanent
      name: "Shivangi",
      role: EMPLOYEE,
      status: "Active",
      withProfile: true,
      personal: {
        dateOfBirth: COMMON_DOB,
        bloodGroup: "A+",
        mobileNo: "9876500001",
        gender: "Female",
        maritalStatus: "Single",
      },
      official: {
        employeeCode: codeFor(4),
        officialEmail: "shivangi@techculture.ai",
        companyIds: [companyId],
        department: "Engineering",
        designation: "Software Engineer",
        dateOfJoining: dojPermanent,
        branchId: noida,
        shiftId: general,
      },
      reportsTo: "manav@techculture.ai",
      createdByEmail: "anupama@techculture.ai",
    },
    {
      // Still in probation window
      name: "Employee",
      role: EMPLOYEE,
      status: "Active",
      withProfile: true,
      personal: {
        dateOfBirth: COMMON_DOB,
        bloodGroup: "B+",
        mobileNo: "9876500002",
        gender: "Male",
        maritalStatus: "Single",
      },
      official: {
        employeeCode: codeFor(5),
        officialEmail: "employee@techculture.ai",
        companyIds: [companyId],
        department: "Engineering",
        designation: "Software Engineer",
        dateOfJoining: dojProbation,
        branchId: noida,
        shiftId: general,
      },
      reportsTo: "manav@techculture.ai",
      createdByEmail: "anupama@techculture.ai",
    },
    {
      // Still in probation (as requested)
      name: "Vivek",
      role: EMPLOYEE,
      status: "Active",
      withProfile: true,
      personal: {
        dateOfBirth: COMMON_DOB,
        bloodGroup: "O+",
        mobileNo: "9876500003",
        gender: "Male",
        maritalStatus: "Single",
      },
      official: {
        employeeCode: codeFor(6),
        officialEmail: "vivek@techculture.ai",
        companyIds: [companyId],
        department: "Engineering",
        designation: "Software Engineer",
        dateOfJoining: dojProbation,
        branchId: delhi,
        shiftId: evening,
      },
      reportsTo: "manoj@techculture.ai",
      createdByEmail: "anupama@techculture.ai",
    },
    {
      // Probation complete → Permanent
      name: "Ananya",
      role: EMPLOYEE,
      status: "Active",
      withProfile: true,
      personal: {
        dateOfBirth: COMMON_DOB,
        bloodGroup: "AB+",
        mobileNo: "9876500004",
        gender: "Female",
        maritalStatus: "Single",
      },
      official: {
        employeeCode: codeFor(7),
        officialEmail: "ananya@techculture.ai",
        companyIds: [companyId],
        department: "Finance",
        designation: "Finance Executive",
        dateOfJoining: dojPermanent,
        branchId: delhi,
        shiftId: evening,
      },
      reportsTo: "manoj@techculture.ai",
      createdByEmail: "anupama@techculture.ai",
    },
  ];

  const idByEmail = new Map();
  let signatureUploads = 0;
  let profileUploads = 0;
  const loginRows = [];

  for (const u of users) {
    const email = String(u.official.officialEmail).toLowerCase().trim();
    const platform = u.platformAdmin || isPlatformRole(u.role);
    const code = u.official.employeeCode || "";
    const password = platform ? u.password : passwordFromCode(code);
    const hashed = await bcrypt.hash(password, 10);

    const doc = {
      name: u.name,
      password: hashed,
      role: u.role,
      status: u.status,
      official: { ...u.official, officialEmail: email },
    };
    if (u.reportsTo) {
      doc.official.reportingHead1 = idByEmail.get(u.reportsTo) || null;
    }
    if (u.createdByEmail && idByEmail.has(u.createdByEmail)) {
      doc.createdBy = idByEmail.get(u.createdByEmail);
    }
    if (!platform) {
      doc.personal = u.personal || {};
    }

    if (u.withProfile) {
      try {
        const profileUrl = await uploadSeedProfile(u.name);
        if (profileUrl) {
          doc.profileUrl = profileUrl;
          profileUploads += 1;
        }
      } catch (err) {
        console.error(`  Profile upload failed → ${email}: ${err.message}`);
      }
    }

    if (u.withSignature) {
      try {
        const signatureUrl = await uploadSeedSignature(u.name);
        if (signatureUrl) {
          doc.signatureUrl = signatureUrl;
          signatureUploads += 1;
        } else {
          console.warn(
            `  Signature skipped → ${email} (set CLOUDINARY_* in .env for seed signatures)`
          );
        }
      } catch (sigErr) {
        console.error(`  Signature upload failed → ${email}: ${sigErr.message}`);
      }
    }

    const created = await User.create(doc);
    idByEmail.set(email, created._id);

    if (platform) {
      await User.collection.updateOne(
        { _id: created._id },
        { $unset: EMPLOYEE_PROFILE_UNSET }
      );
    }

    const joining = platform ? "" : String(u.official.dateOfJoining || "");
    loginRows.push({
      role: u.role,
      email,
      code: code || "—",
      password,
      dob: platform ? "—" : COMMON_DOB,
      doj: joining || "—",
    });

    console.log(
      `User → ${email} / ${password} (${u.role}) code=${code || "—"} doj=${
        joining || "—"
      }${doc.profileUrl ? " profile=yes" : ""}${
        doc.signatureUrl ? " signature=yes" : ""
      }${doc.createdBy ? ` createdBy=${u.createdByEmail}` : ""}`
    );

    try {
      await sendWelcomeEmail({
        name: u.name,
        email,
        password,
        role: u.role,
        company: platform ? "All companies" : DEFAULT_COMPANY,
        department: u.official.department || "",
      });
      console.log(`  Mail sent → ${email}`);
    } catch (mailErr) {
      console.error(`  Mail failed → ${email}: ${mailErr.message}`);
    }
  }

  const lastSeq = 7;
  // Ensure company still exists (masters / other seeds must not wipe companyorgs)
  let liveCompany = await Company.findById(companyId).select("_id companyCode").lean();
  if (!liveCompany) {
    console.warn("Company missing after users — recreating TC org");
    const rebuilt = await Company.create({
      companyName: DEFAULT_COMPANY,
      companyCode: "TC",
      isActive: true,
      branches: [
        {
          branchId: noida,
          city: "Noida",
          state: "Uttar Pradesh",
          isActive: true,
          shifts: standardShifts(),
        },
        {
          branchId: delhi,
          city: "Delhi",
          state: "Delhi",
          isActive: true,
          shifts: standardShifts(),
        },
      ],
    });
    companyId = rebuilt._id;
    await User.updateMany(
      { "official.companyIds.0": { $exists: true } },
      { $set: { "official.companyIds": [companyId] } }
    );
    liveCompany = { _id: companyId, companyCode: "TC" };
  }

  await EmployeeCodeSeq.findOneAndUpdate(
    { companyId },
    { companyId, companyCode: liveCompany.companyCode, seq: lastSeq },
    { upsert: true, new: true }
  );
  console.log(
    `Employee codes → ${codeFor(1)} to ${codeFor(lastSeq)} (next ${codeFor(lastSeq + 1)})`
  );

  const leave = await seedLeaveDefaults();
  console.log(
    `Leave → ${leave.typesAdded} added, ${leave.typesUpdated} updated, ${leave.typesRemoved} old types removed`
  );

  const holidays = await seedHolidays();
  console.log(
    `Holidays → ${holidays.holidays} days on ${holidays.companies} ${holidays.companies === 1 ? "company" : "companies"}`
  );

  const breaks = await seedBreakPolicies();
  console.log(`Break policies → ${breaks.added} added`);

  console.log("\nSeed done!");
  console.log("  Platform passwords → 123456");
  console.log(
    `  Staff passwords   → {employeeCode}${dobPasswordPart}  (code + DOB ddmmyyyy from ${COMMON_DOB})`
  );
  console.log(
    `  DOJ Permanent     → ${dojPermanent} (Shivangi, Ananya + HR/managers)`
  );
  console.log(
    `  DOJ Probation     → ${dojProbation} (Vivek, employee@… — ID card Probation)`
  );
  console.log(`  Profiles          → ${profileUploads} uploaded`);
  console.log(`  Signatures        → ${signatureUploads} uploaded (Super Admin / Admin / HR)`);
  console.log(`  Masters           → ${masters.length} rows`);
  console.log("\n  Logins:");
  for (const row of loginRows) {
    console.log(
      `    ${row.role.padEnd(18)} ${row.email.padEnd(28)} code=${String(row.code).padEnd(8)} doj=${String(row.doj).padEnd(12)} pass=${row.password}`
    );
  }
  process.exit(0);
};

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
