/**
 * DATABASE SEED — wipe + recreate demo roles, masters, users
 * Password for all sample users: 123456. Run: npm run seed
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
const { sendWelcomeEmail } = require("./utils/mail");
const { DEFAULT_COMPANY } = require("./utils/companyScope");

/** Paths removed after create for Global Admin / Super Admin (lean login accounts) */
const EMPLOYEE_PROFILE_UNSET = {
  personal: 1,
  other: 1,
  education: 1,
  accounts: 1,
  family: 1,
  nominees: 1,
  experience: 1,
  visas: 1,
  payroll: 1,
};

const isPlatformAdmin = (role) =>
  role === "Global Admin" || role === "Super Admin";

const seed = async () => {
  await connectDB();

  // 1. CLEAR OLD DATA

  await User.deleteMany({});
  await Role.deleteMany({});
  // Clear typed collections created via Master.getModel(type)
  await clearAllMasterCollections();
  try {
    await mongoose.connection.dropCollection("masters");
    console.log("Dropped legacy collection: masters");
  } catch (_) {
    // may not exist
  }
  for (const name of ["modules", "headings", "submodules"]) {
    try {
      await mongoose.connection.dropCollection(name);
      console.log(`Dropped collection: ${name}`);
    } catch (_) {
      // collection may not exist
    }
  }

  // Drop legacy unique indexes that no longer match the nested User schema
  for (const idx of ["email_1", "personal.officialEmail_1"]) {
    try {
      await User.collection.dropIndex(idx);
      console.log(`Dropped legacy index: ${idx}`);
    } catch (_) {
      // index may not exist
    }
  }

  console.log("Old data cleared");
  console.log(`Default company → ${DEFAULT_COMPANY}`);

  // 2. LOG PERMISSION CATALOGS (from permissions.js)

  console.log("\nAdmin blocks (permissions.js):");
  for (const b of ADMIN_TREE) {
    console.log(`  ${b.module} | ${b.heading} → ${b.subModules.length} subs`);
  }
  console.log("ESS blocks (permissions.js):");
  for (const b of ESS_TREE) {
    console.log(`  ${b.module} | ${b.heading} → ${b.subModules.length} subs`);
  }

  // 3. CREATE DEFAULT ROLES

  const roles = [
    {
      name: "Global Admin",
      description: "All companies, full access. Account only — no employee profile.",
      catalog: "admin",
      permissions: permissionsForRole("Global Admin"),
    },
    {
      name: "Super Admin",
      description: "Own company full access. Account only — no employee profile.",
      catalog: "admin",
      permissions: permissionsForRole("Super Admin"),
    },
    {
      name: "HR Manager",
      description: "Own company; admin modules via permission matrix.",
      catalog: "admin",
      permissions: permissionsForRole("HR Manager"),
    },
    {
      name: "Manager",
      description: "Own company; admin modules via permission matrix.",
      catalog: "admin",
      permissions: permissionsForRole("Manager"),
    },
    {
      name: "Employee",
      description: "ESS: Self, Team, Request, Tasks.",
      catalog: "employee",
      permissions: permissionsForRole("Employee"),
    },
  ];

  for (const r of roles) {
    const role = await Role.create({ ...r, status: "Active" });
    console.log(
      `Role → ${role.name} (${countPermissions(role.permissions)} of ${totalForRole(role.name)})`
    );
  }

  // 4. SEED MASTERS (dropdown labels — one collection per type)

  // Master.getModel(type) → separate collections (no Department.js files)
  const masters = [
    { type: "company", name: DEFAULT_COMPANY },
    { type: "department", name: "Administration", company: DEFAULT_COMPANY },
    { type: "department", name: "HR", company: DEFAULT_COMPANY },
    { type: "department", name: "Engineering", company: DEFAULT_COMPANY },
    { type: "department", name: "Finance", company: DEFAULT_COMPANY },
    { type: "designation", name: "Software Engineer", company: DEFAULT_COMPANY },
    { type: "designation", name: "HR Manager", company: DEFAULT_COMPANY },
    { type: "designation", name: "Engineering Manager", company: DEFAULT_COMPANY },
    { type: "designation", name: "Finance Executive", company: DEFAULT_COMPANY },
    { type: "division", name: "HO", company: DEFAULT_COMPANY },
    { type: "division", name: "RO", company: DEFAULT_COMPANY },
    { type: "employeeGroup", name: "Permanent", company: DEFAULT_COMPANY },
    { type: "employeeGroup", name: "Contract", company: DEFAULT_COMPANY },
  ];

  for (const m of masters) {
    const Model = getModel(m.type);
    const payload =
      m.type === "company"
        ? { name: m.name, company: "", status: "Active" }
        : { name: m.name, company: m.company, status: "Active" };
    await Model.create(payload);
    console.log(
      `Master → ${m.type} (${COLLECTION_BY_TYPE[m.type]}): ${m.name}`
    );
  }

  // 5. SEED SAMPLE USERS (password for all demos: 123456)

  /**
   * platformAdmin: true → only name/password/role/status + official.officialEmail
   *   (+ company for Super Admin). Profile fields are $unset after create.
   */
  const users = [
    {
      name: "Global Admin",
      password: "123456",
      role: "Global Admin",
      status: "Active",
      platformAdmin: true,
      official: {
        officialEmail: "globaladmin@techculture.ai",
      },
    },
    {
      name: "Shivangi Gupta",
      password: "123456",
      role: "Super Admin",
      status: "Active",
      platformAdmin: true,
      official: {
        officialEmail: "shivangi@techculture.ai",
        company: DEFAULT_COMPANY,
      },
    },
    {
      name: "Priya Sharma",
      password: "123456",
      role: "HR Manager",
      status: "Active",
      personal: { mobileNo: "9876500100" },
      official: {
        employeeCode: "EMP-HR01",
        officialEmail: "hr@techculture.ai",
        company: DEFAULT_COMPANY,
        department: "HR",
        designation: "HR Manager",
      },
    },
    {
      name: "Amit Verma",
      password: "123456",
      role: "Manager",
      status: "Active",
      personal: { mobileNo: "9876500200" },
      official: {
        employeeCode: "EMP-MG01",
        officialEmail: "manager@techculture.ai",
        company: DEFAULT_COMPANY,
        department: "Engineering",
        designation: "Engineering Manager",
      },
    },
    {
      name: "Shivi Gupta",
      password: "123456",
      role: "Employee",
      status: "Active",
      personal: { mobileNo: "9876500001" },
      official: {
        employeeCode: "EMP-1002",
        officialEmail: "shivig5964@gmail.com",
        company: DEFAULT_COMPANY,
        department: "Engineering",
        designation: "Software Engineer",
      },
    },
  ];

  for (const u of users) {
    const hashed = await bcrypt.hash(u.password, 10);
    const email = String(u.official.officialEmail).toLowerCase().trim();
    const platform = u.platformAdmin || isPlatformAdmin(u.role);

    const doc = {
      name: u.name,
      password: hashed,
      role: u.role,
      status: u.status,
      detailsApproval: platform ? "Approved" : "Unapproved",
      official: { ...u.official, officialEmail: email },
    };

    if (!platform) {
      doc.personal = u.personal || {};
    }

    const created = await User.create(doc);

    if (platform) {
      // Remove empty employee-profile blocks (not needed for Global / Super Admin)
      const unset = { ...EMPLOYEE_PROFILE_UNSET };
      if (u.role === "Global Admin") {
        unset["official.employeeCode"] = 1;
        unset["official.company"] = 1;
        unset["official.department"] = 1;
        unset["official.designation"] = 1;
        unset["official.reportingHead1"] = 1;
        unset["official.reportingHead2"] = 1;
        unset["official.jobRole"] = 1;
        unset["official.dateOfJoining"] = 1;
        unset["official.calculateSalaryFrom"] = 1;
        unset["official.dateOfRetirement"] = 1;
        unset["official.grade"] = 1;
      } else if (u.role === "Super Admin") {
        // Keep official.company for company scope; drop other official HR fields
        unset["official.employeeCode"] = 1;
        unset["official.department"] = 1;
        unset["official.designation"] = 1;
        unset["official.reportingHead1"] = 1;
        unset["official.reportingHead2"] = 1;
        unset["official.jobRole"] = 1;
        unset["official.dateOfJoining"] = 1;
        unset["official.calculateSalaryFrom"] = 1;
        unset["official.dateOfRetirement"] = 1;
        unset["official.grade"] = 1;
      }
      await User.collection.updateOne({ _id: created._id }, { $unset: unset });
    }

    console.log(`User → ${email} / ${u.password} (${u.role})`);

    try {
      await sendWelcomeEmail({
        name: u.name,
        email,
        password: u.password,
        role: u.role,
        company:
          u.role === "Global Admin"
            ? "All companies"
            : u.official.company || DEFAULT_COMPANY,
        department: u.official.department || "",
      });
      console.log(`  Mail sent → ${email}`);
    } catch (mailErr) {
      console.error(`  Mail failed → ${email}: ${mailErr.message}`);
    }
  }

  console.log("\nSeed done!");
  console.log("  Global Admin  → all companies (login only, no profile fields)");
  console.log("  Super Admin   → own company access (login + company, no profile)");
  console.log("  HR / Manager / Employee → full employee profile + company");
  process.exit(0);
};

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
