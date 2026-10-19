/**
 * One employee timesheet seed.
 * 16 Jun 2026 – 16 Oct 2026: mix of Present and Absent on work days.
 * October work days through 10 Oct stay mixed.
 * 11, 12, 13 and 15 Oct are Absent. 14 Oct and 16 Oct are Present with punch in/out.
 *
 * Run: node src/scripts/seedEmployeeAttendance.js
 */
require("dotenv").config();
const connectDB = require("../config/db");
const mongoose = require("mongoose");
const User = require("../models/User");
const Attendance = require("../models/Attendance");
const { getAssignedShift, computeDayMetrics, effectiveEndTime } = require("../utils/shiftTiming");

const EMPLOYEE_ID = "6ad2087a20aae06db0e339c7";
const FROM = "2026-06-16";
const TO = "2026-10-16";
const FORCED_PRESENT = new Set(["2026-10-14", "2026-10-16"]);
const FORCED_ABSENT = new Set(["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-15"]);
const OCT_ABSENT = new Set(["2026-10-03", "2026-10-06", "2026-10-08"]);
const MONTH_ABSENT_DAYS = new Set([4, 9, 17, 22, 28]);
const LATE_DAYS = new Set([7, 15, 21]);

const eachDate = (from, to) => {
  const dates = [];
  const cursor = new Date(`${from}T12:00:00+05:30`);
  const end = new Date(`${to}T12:00:00+05:30`);
  while (cursor <= end) {
    dates.push(cursor.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
};

const clock = (date, hm) => new Date(`${date}T${hm}:00+05:30`);

const addMinutes = (hm, minutes) => {
  const [h, m] = hm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
};

const kindFor = (date) => {
  if (FORCED_PRESENT.has(date)) return "present";
  if (FORCED_ABSENT.has(date)) return "absent";
  if (date.startsWith("2026-10-") && date <= "2026-10-10") {
    return OCT_ABSENT.has(date) ? "absent" : "present";
  }
  const day = Number(date.slice(8, 10));
  return MONTH_ABSENT_DAYS.has(day) ? "absent" : "present";
};

(async () => {
  await connectDB();
  if (!mongoose.Types.ObjectId.isValid(EMPLOYEE_ID)) {
    throw new Error("Invalid employee id");
  }

  const employee = await User.findById(EMPLOYEE_ID).select("name official status").lean();
  if (!employee || employee.status === "Deleted") {
    throw new Error(`Employee ${EMPLOYEE_ID} not found`);
  }

  const dates = eachDate(FROM, TO);
  const ops = [];
  const counts = {};

  for (const date of dates) {
    const placed = await getAssignedShift(EMPLOYEE_ID, date);
    const shift = placed.shift;
    const companyId = placed.company?._id || employee.official?.companyIds?.[0] || null;
    const branchId = placed.branch?._id || employee.official?.branchId || null;
    const shiftId = shift?._id || employee.official?.shiftId || null;
    const off = (shift?.weeklyOffDays || []).length > 0;
    const day = Number(date.slice(8, 10));
    let status = "Absent";
    let punchIn = null;
    let punchOut = null;
    let attendanceStatus = null;
    let workedMinutes = 0;
    let overtimeMinutes = 0;
    let lateByMinutes = 0;
    let earlyByMinutes = 0;

    if (off) {
      status = "WeeklyOff";
    } else if (kindFor(date) === "present") {
      const start = shift?.startTime || "10:00";
      const end = effectiveEndTime(shift, date) || "19:00";
      const late = LATE_DAYS.has(day) && !FORCED_PRESENT.has(date);
      const inHm = addMinutes(start, late ? 28 : 2);
      const outHm = addMinutes(end, 5);
      punchIn = clock(date, inHm);
      punchOut = clock(date, outHm);
      const metrics = computeDayMetrics({ punchIn, punchOut, date }, shift, date);
      status = metrics.status;
      workedMinutes = metrics.workedMinutes;
      overtimeMinutes = metrics.overtimeMinutes;
      lateByMinutes = metrics.lateByMinutes;
      earlyByMinutes = metrics.earlyByMinutes;
      attendanceStatus = lateByMinutes > 0 ? "Late" : "On time";
    }

    counts[status] = (counts[status] || 0) + 1;
    ops.push({
      updateOne: {
        filter: { employee: employee._id, date },
        update: {
          $set: {
            employee: employee._id,
            date,
            shift: shiftId,
            companyId,
            branchId,
            punchIn,
            punchOut,
            punchInSource: punchIn ? "web" : null,
            punchOutSource: punchOut ? "web" : null,
            punchInLocation: punchIn
              ? { latitude: 28.6139, longitude: 77.209, address: "Delhi" }
              : {},
            punchOutLocation: punchOut
              ? { latitude: 28.6139, longitude: 77.209, address: "Delhi" }
              : {},
            status,
            workedMinutes,
            overtimeMinutes,
            lateByMinutes,
            earlyByMinutes,
            workMode: "WFO",
            attendanceStatus,
            remarks: "",
            breaks: [],
          },
        },
        upsert: true,
      },
    });
  }

  const result = await Attendance.bulkWrite(ops);
  const sample = await Attendance.find({
    employee: employee._id,
    date: { $in: ["2026-10-08", "2026-10-10", "2026-10-14", "2026-10-16"] },
  })
    .select("date status punchIn punchOut workedMinutes lateByMinutes")
    .sort({ date: 1 })
    .lean();

  console.log(
    JSON.stringify(
      {
        employee: employee.name || EMPLOYEE_ID,
        range: `${FROM} to ${TO}`,
        days: dates.length,
        upserted: result.upsertedCount,
        modified: result.modifiedCount,
        counts,
        sample,
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
