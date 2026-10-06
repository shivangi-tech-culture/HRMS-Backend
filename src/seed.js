/**
 * DATABASE SEED — wipe + recreate demo roles, masters, users
 * Password for all sample users: 123456. Run: npm run seed
 * Order: roles + permissions → default users → all masters.
 *
 * Hierarchy: src/config/roles.js
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
  other: 1,
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

  for (const m of masters) {
    const Model = getModel(m.type);
    await Model.create({
      name: m.name,
      company: "",
      status: "Active",
    });
    console.log(`Master → ${m.type} (${COLLECTION_BY_TYPE[m.type]}): ${m.name}`);
  }

  const companyOrg = await Company.create({
    companyName: DEFAULT_COMPANY,
    companyCode: "TCPL",
    isActive: true,
    branches: [
      {
        branchName: "Noida",
        branchCode: "NOIDA",
        city: "Noida",
        state: "Uttar Pradesh",
        isActive: true,
        shifts: [
          {
            shiftName: "General Shift",
            shiftCode: "GS-01",
            isActive: true,
            monthlySchedule: fourWeeks("10:00", "19:00"),
          },
          {
            shiftName: "Evening Shift",
            shiftCode: "ES-01",
            isActive: true,
            monthlySchedule: fourWeeks("14:00", "23:00", "18:00"),
          },
        ],
      },
      {
        branchName: "Delhi",
        branchCode: "DEL",
        city: "Delhi",
        state: "Delhi",
        isActive: true,
        shifts: [
          {
            shiftName: "General Shift",
            shiftCode: "GS-01",
            isActive: true,
            monthlySchedule: fourWeeks("10:00", "19:00"),
          },
          {
            shiftName: "Evening Shift",
            shiftCode: "ES-01",
            isActive: true,
            monthlySchedule: fourWeeks("14:00", "23:00", "18:00"),
          },
        ],
      },
    ],
  });
  const companyId = companyOrg._id;
  const noida = companyOrg.branches.find((b) => b.branchName === "Noida");
  const delhi = companyOrg.branches.find((b) => b.branchName === "Delhi");
  const noidaGeneral = noida.shifts.find((s) => s.shiftName === "General Shift");
  const delhiEvening = delhi.shifts.find((s) => s.shiftName === "Evening Shift");
  console.log(
    `Company → ${companyOrg.companyName} (${companyOrg.companyCode}) id ${companyId}`
  );

  const users = [
    {
      name: "Super Admin",
      password: "123456",
      role: SUPER_ADMIN,
      status: "Active",
      platformAdmin: true,
      official: {
        officialEmail: "superadmin@gmail.com",
      },
    },
    {
      name: "Admin User",
      password: "123456",
      role: ADMIN,
      status: "Active",
      platformAdmin: true,
      official: {
        officialEmail: "admin@gmail.com",
      },
    },
    {
      name: "HR Manager",
      password: "123456",
      role: HR,
      status: "Active",
      personal: { mobileNo: "9876500100" },
      official: {
        employeeCode: "EMP-HR01",
        officialEmail: "hr@gmail.com",
        companyIds: [companyId],
        department: "HR",
        designation: "HR Manager",
        branchId: noida._id,
        shiftId: noidaGeneral._id,
      },
    },
    {
      name: "Reporting Manager",
      password: "123456",
      role: REPORTING_MANAGER,
      status: "Active",
      personal: { mobileNo: "9876500200" },
      official: {
        employeeCode: "EMP-MG01",
        officialEmail: "manager@gmail.com",
        companyIds: [companyId],
        department: "Engineering",
        designation: "Engineering Manager",
        branchId: noida._id,
        shiftId: noidaGeneral._id,
      },
    },
    {
      name: "Employee One",
      password: "123456",
      role: EMPLOYEE,
      status: "Active",
      personal: { mobileNo: "9876500001" },
      official: {
        employeeCode: "EMP-1002",
        officialEmail: "employee1@gmail.com",
        companyIds: [companyId],
        department: "Engineering",
        designation: "Software Engineer",
        branchId: noida._id,
        shiftId: noidaGeneral._id,
      },
      reportsTo: "manager@gmail.com",
    },
    {
      name: "Employee Two",
      password: "123456",
      role: EMPLOYEE,
      status: "Active",
      personal: {
        mobileNo: "9876500002",
        gender: "Male",
        maritalStatus: "Single",
      },
      official: {
        employeeCode: "EMP-1003",
        officialEmail: "employee@gmail.com",
        companyIds: [companyId],
        department: "Engineering",
        designation: "Software Engineer",
        branchId: delhi._id,
        shiftId: delhiEvening._id,
      },
      reportsTo: "manager@gmail.com",
    },
  ];

  const idByEmail = new Map();
  for (const u of users) {
    const hashed = await bcrypt.hash(u.password, 10);
    const email = String(u.official.officialEmail).toLowerCase().trim();
    const platform = u.platformAdmin || isPlatformRole(u.role);

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

    if (!platform) {
      doc.personal = u.personal || {};
    }

    const created = await User.create(doc);
    idByEmail.set(email, created._id);

    if (platform) {
      await User.collection.updateOne(
        { _id: created._id },
        { $unset: EMPLOYEE_PROFILE_UNSET }
      );
    }

    const savedIds = (created.official?.companyIds || []).map(String);
    console.log(
      `User → ${email} / ${u.password} (${u.role}) companyIds=${
        savedIds.length ? savedIds.join(", ") : "none"
      }`
    );

    try {
      await sendWelcomeEmail({
        name: u.name,
        email,
        password: u.password,
        role: u.role,
        company: platform ? "All companies" : DEFAULT_COMPANY,
        department: u.official.department || "",
      });
      console.log(`  Mail sent → ${email}`);
    } catch (mailErr) {
      console.error(`  Mail failed → ${email}: ${mailErr.message}`);
    }
  }

  console.log("\nSeed done! Password for all: 123456");
  console.log("  Super Admin        → superadmin@gmail.com");
  console.log("  Admin              → admin@gmail.com");
  console.log("  HR Manager         → hr@gmail.com");
  console.log("  Reporting Manager  → manager@gmail.com");
  console.log("  Employee           → employee@gmail.com / employee1@gmail.com");
  console.log(`  Masters            → ${masters.length} rows`);
  process.exit(0);
};

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
