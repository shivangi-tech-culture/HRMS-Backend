/**
 * Database seed script
 *
 * Clears users/roles, drops old catalog collections if present,
 * creates default roles from permissions.js, and seeds sample users.
 * Run: npm run seed
 */
require("dotenv").config();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const connectDB = require("./config/db");
const User = require("./models/User");
const Role = require("./models/Role");
const {
  ADMIN_TREE,
  ESS_TREE,
  permissionsForRole,
  totalForRole,
  countPermissions,
} = require("./config/permissions");
const { sendWelcomeEmail } = require("./utils/mail");

const seed = async () => {
  await connectDB();

  // Clear app data + drop old catalog collections (not needed anymore)
  await User.deleteMany({});
  await Role.deleteMany({});
  for (const name of ["modules", "headings", "submodules"]) {
    try {
      await mongoose.connection.dropCollection(name);
      console.log(`Dropped collection: ${name}`);
    } catch (_) {
      // collection may not exist
    }
  }

  // Drop legacy unique indexes (top-level email / personal.officialEmail)
  for (const idx of ["email_1", "personal.officialEmail_1"]) {
    try {
      await User.collection.dropIndex(idx);
      console.log(`Dropped legacy index: ${idx}`);
    } catch (_) {
      // index may not exist
    }
  }

  console.log("Old data cleared");

  console.log("\nAdmin blocks (permissions.js):");
  for (const b of ADMIN_TREE) {
    console.log(`  ${b.module} | ${b.heading} → ${b.subModules.length} subs`);
  }
  console.log("ESS blocks (permissions.js):");
  for (const b of ESS_TREE) {
    console.log(`  ${b.module} | ${b.heading} → ${b.subModules.length} subs`);
  }

  const roles = [
    {
      name: "Super Admin",
      description: "Full admin access.",
      permissions: permissionsForRole("Super Admin"),
    },
    {
      name: "HR Manager",
      description: "Same as Super Admin (admin modules).",
      permissions: permissionsForRole("HR Manager"),
    },
    {
      name: "Manager",
      description: "Same as Super Admin (admin modules).",
      permissions: permissionsForRole("Manager"),
    },
    {
      name: "Employee",
      description: "ESS: Self, Team, Request, Tasks.",
      permissions: permissionsForRole("Employee"),
    },
  ];

  for (const r of roles) {
    const role = await Role.create({ ...r, status: "Active" });
    console.log(
      `Role → ${role.name} (${countPermissions(role.permissions)} of ${totalForRole(role.name)})`
    );
  }

  // Seed users — nested shape (officialEmail + employeeCode under official)
  const users = [
    {
      name: "Shivangi Gupta",
      password: "123456",
      role: "Super Admin",
      status: "Active",
      personal: {
        mobileNo: "9876543210",
        permanentAddress: {
          city: "Noida",
          state: "DELHI",
          country: "India",
        },
      },
      official: {
        employeeCode: "EMP-1001",
        officialEmail: "shivangi@techculture.ai",
        company: "TechCulture Solutions Private Limited",
        department: "Administration",
      },
    },
    {
      name: "Shivi Gupta",
      password: "123456",
      role: "Employee",
      status: "Active",
      personal: {
        mobileNo: "9876500001",
        permanentAddress: {
          city: "Noida",
          state: "DELHI",
          country: "India",
        },
      },
      official: {
        employeeCode: "EMP-1002",
        officialEmail: "shivig5964@gmail.com",
        company: "TechCulture Solutions Private Limited",
        department: "Engineering",
      },
    },
  ];

  for (const u of users) {
    const hashed = await bcrypt.hash(u.password, 10);
    const email = String(u.official.officialEmail).toLowerCase().trim();

    await User.create({
      name: u.name,
      password: hashed,
      role: u.role,
      status: u.status,
      detailsApproval: u.role === "Super Admin" ? "Approved" : "Unapproved",
      personal: u.personal,
      official: { ...u.official, officialEmail: email },
    });

    console.log(`User → ${email} / ${u.password} (${u.role})`);

    try {
      await sendWelcomeEmail({
        name: u.name,
        email,
        password: u.password,
        role: u.role,
        company: u.official.company,
        department: u.official.department,
      });
      console.log(`  Mail sent → ${email}`);
    } catch (mailErr) {
      console.error(`  Mail failed → ${email}: ${mailErr.message}`);
    }
  }

  console.log("\nSeed done! Catalog = permissions.js only. DB = roles + users.");
  process.exit(0);
};

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
