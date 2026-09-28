/**
 * Seed default shifts (UI Shift Management) — NOT part of npm run seed.
 *
 * Defaults match: https://hrms-techculture.vercel.app/organization/setup/shift
 *   FIRST  → First Shift   punch 08:00  09:00–18:00  night No
 *   SECOND → Second Shift  punch 08:30  14:00–22:00  night No
 *   THIRD  → Third Shift   punch 09:00  22:00–06:00  night Yes
 *
 * Timing rules kept: Sat half-day 14:30, Sun weekly off, early in / late out OK.
 *
 * Run:  npm run seed:shifts
 * Opt:  COMPANY="Other Co" node src/scripts/seedShifts.js
 */
require("dotenv").config();
const connectDB = require("../config/db");
const Shift = require("../models/Shift");
const { DEFAULT_COMPANY } = require("../utils/companyScope");

const DEFAULT_SHIFTS = [
  {
    code: "FIRST",
    name: "First Shift",
    punchStartTime: "08:00",
    startTime: "09:00",
    endTime: "18:00",
    shiftDuration: 9,
    workDuration: 9,
    breakApplicable: false,
    nightShift: false,
  },
  {
    code: "SECOND",
    name: "Second Shift",
    punchStartTime: "08:30",
    startTime: "14:00",
    endTime: "22:00",
    shiftDuration: 9,
    workDuration: 9,
    breakApplicable: false,
    nightShift: false,
  },
  {
    code: "THIRD",
    name: "Third Shift",
    punchStartTime: "09:00",
    startTime: "22:00",
    endTime: "06:00",
    shiftDuration: 9,
    workDuration: 9,
    breakApplicable: false,
    nightShift: true,
  },
];

const SHARED = {
  status: "Active",
  halfDayEndTime: "14:30",
  graceMinutes: 0,
  allowEarlyPunchIn: true,
  allowLatePunchOut: true,
  weeklyOffDays: [0], // Sunday
  halfDayDays: [6], // Saturday
  description: "",
};

const seedShifts = async () => {
  await connectDB();

  const company = String(
    process.env.COMPANY || process.env.DEFAULT_COMPANY || DEFAULT_COMPANY
  ).trim();

  console.log(`Seeding default shifts for company → ${company}`);

  for (const row of DEFAULT_SHIFTS) {
    const payload = { ...SHARED, ...row, company, code: row.code.toUpperCase() };
    const existing = await Shift.findOne({
      company: new RegExp(
        `^${company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i"
      ),
      code: payload.code,
    });

    if (existing) {
      Object.assign(existing, payload);
      await existing.save();
      console.log(`  updated → ${payload.code} (${payload.name}) ${payload.startTime}–${payload.endTime}${payload.nightShift ? " NIGHT" : ""}`);
    } else {
      await Shift.create(payload);
      console.log(`  created → ${payload.code} (${payload.name}) ${payload.startTime}–${payload.endTime}${payload.nightShift ? " NIGHT" : ""}`);
    }
  }

  const total = await Shift.countDocuments({
    company: new RegExp(
      `^${company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      "i"
    ),
  });
  console.log(`Done. Active shifts for company: ${total}`);
  process.exit(0);
};

seedShifts().catch((err) => {
  console.error(err);
  process.exit(1);
});
