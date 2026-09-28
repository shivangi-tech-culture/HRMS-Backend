/**
 * TIMESHEET CONTROLLER — /api/timesheet
 * Employee time sheet with filters + pagination (day rows + monthly summary)
 */
const Attendance = require("../models/Attendance");
const User = require("../models/User");
const { hasAllAccess } = require("../middleware/auth");
const {
  companyFilter,
  hasGlobalCompanyAccess,
  assertSameCompanyEmployee,
} = require("../utils/companyScope");
const {
  todayDate,
  computeDayMetrics,
  formatHours,
  formatPunchStamp,
  weekdayOf,
} = require("../utils/shiftTiming");

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const daysBetween = (from, to) => {
  const out = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
};

/** Resolve from/to from month=YYYY-MM or explicit from/to */
const resolveRange = (query) => {
  if (query.from && query.to) return { from: query.from, to: query.to };
  if (query.month) {
    const [y, m] = query.month.split("-").map(Number);
    const from = `${query.month}-01`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const to = `${query.month}-${String(last).padStart(2, "0")}`;
    return { from, to };
  }
  // default: current calendar month in app TZ
  const today = todayDate();
  const from = `${today.slice(0, 7)}-01`;
  return { from, to: today };
};

/**
 * GET /api/timesheet
 * Query: month | from+to, employeeId (admin), status, page, limit
 */
const getTimesheet = async (req, res) => {
  try {
    let employeeId = req.user._id;

    if (req.query.employeeId) {
      if (!hasAllAccess(req.user)) {
        return res.status(403).json({
          message: "Only admin can view another employee's timesheet",
        });
      }
      const emp = await User.findById(req.query.employeeId).select(
        "_id name status official.company official.employeeCode"
      );
      if (!emp) return res.status(404).json({ message: "Employee not found" });
      if (!hasGlobalCompanyAccess(req.user)) {
        const err = assertSameCompanyEmployee(req.user, emp);
        if (err) return res.status(403).json({ message: err });
      }
      employeeId = emp._id;
    }

    const { from, to } = resolveRange(req.query);
    if (from > to) {
      return res.status(400).json({ message: "from cannot be after to" });
    }

    const allDates = daysBetween(from, to);
    const attendanceMap = {};
    const records = await Attendance.find({
      employee: employeeId,
      date: { $gte: from, $lte: to },
    })
      .populate("shift")
      .lean();

    for (const r of records) attendanceMap[r.date] = r;

    // Assignments covering range + holidays
    const ShiftAssignment = require("../models/ShiftAssignment");
    const Holiday = require("../models/Holiday");
    const emp = await User.findById(employeeId)
      .select("official.company official.shift")
      .populate("official.shift")
      .lean();

    const assignments = await ShiftAssignment.find({
      employee: employeeId,
      effectiveFrom: { $lte: to },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: from } }],
    })
      .populate("shift")
      .populate("weeklyOffPolicy", "name code offDays status")
      .sort({ effectiveFrom: 1 })
      .lean();

    const holidayFilter = {
      status: "Active",
      date: { $gte: from, $lte: to },
    };
    const co = String(emp?.official?.company || "").trim();
    if (co) {
      holidayFilter.company = new RegExp(
        `^${co.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i"
      );
    }
    const holidays = await Holiday.find(holidayFilter).lean();
    const holidayMap = {};
    for (const h of holidays) holidayMap[h.date] = h;

    const shiftForDate = (date) => {
      let match = null;
      for (const a of assignments) {
        if (
          a.effectiveFrom <= date &&
          (a.effectiveTo == null || a.effectiveTo >= date)
        ) {
          match = a;
        }
      }
      if (match?.shift) {
        const weeklyOffDays = match.weeklyOffPolicy?.offDays?.length
          ? match.weeklyOffPolicy.offDays
          : match.weeklyOffDays?.length
            ? match.weeklyOffDays
            : match.shift.weeklyOffDays;
        return {
          ...match.shift,
          weeklyOffDays,
        };
      }
      const fallback = emp?.official?.shift;
      if (fallback && (!fallback.status || fallback.status === "Active")) {
        return fallback;
      }
      return null;
    };

    const rows = [];
    let totalPresents = 0;
    let totalAbsents = 0;
    let totalWeeklyOffs = 0;
    let totalHalfDays = 0;
    let totalHolidays = 0;
    let lateArrivals = 0;
    let leftEarly = 0;
    let lateByGrace = 0;
    let earlyBy = 0;
    let salaryDays = 0;

    const pastIncomplete = [];

    const { effectiveEndTime, dayTypeOf } = require("../utils/shiftTiming");

    for (const date of allDates) {
      const shift = shiftForDate(date) || attendanceMap[date]?.shift || null;
      const record = attendanceMap[date] || null;

      let metrics = computeDayMetrics(record, shift, date, holidayMap);
      if (
        record &&
        record.punchIn &&
        !record.punchOut &&
        date < todayDate() &&
        record.status !== "Absent"
      ) {
        pastIncomplete.push(record._id);
        metrics = computeDayMetrics(
          { ...record, punchOut: null, status: "Absent" },
          shift,
          date,
          holidayMap
        );
      }

      if (metrics.statusCode === "P") {
        totalPresents += 1;
        salaryDays += 1;
      } else if (metrics.statusCode === "HD") {
        totalHalfDays += 1;
        totalPresents += 0.5;
        salaryDays += 0.5;
      } else if (metrics.statusCode === "A") {
        totalAbsents += 1;
      } else if (metrics.statusCode === "WO") {
        totalWeeklyOffs += 1;
      } else if (metrics.statusCode === "HO") {
        totalHolidays += 1;
      }

      if (metrics.lateByMinutes > 0) {
        lateArrivals += 1;
        lateByGrace += metrics.lateByMinutes;
      }
      if (metrics.earlyByMinutes > 0) {
        leftEarly += 1;
        earlyBy += metrics.earlyByMinutes;
      }

      const inOut =
        record?.punchIn || record?.punchOut
          ? `${formatPunchStamp(record.punchIn)} - ${formatPunchStamp(record.punchOut)}`
          : "—";

      const dayType = metrics.dayType || dayTypeOf(shift, date, holidayMap);

      rows.push({
        sheetDate: date,
        day: DAY_NAMES[weekdayOf(date)],
        dayType,
        shift: shift
          ? {
              _id: shift._id,
              name: shift.name,
              startTime: shift.startTime,
              endTime: effectiveEndTime(shift, date) || shift.endTime,
              fullDayEndTime: shift.endTime,
              halfDayEndTime: shift.halfDayEndTime || "14:30",
              isHalfDay: dayType === "halfDay",
            }
          : metrics.statusCode === "WO"
            ? { name: "Weekly Off" }
            : metrics.statusCode === "HO"
              ? {
                  name:
                    holidayMap[date]?.name ||
                    holidayMap[date]?.type ||
                    "Holiday",
                }
              : null,
        holiday: holidayMap[date]
          ? {
              name: holidayMap[date].name,
              type: holidayMap[date].type,
              forAudience: holidayMap[date].forAudience,
            }
          : null,
        inTimeOutTime: inOut,
        punchIn: record?.punchIn || null,
        punchOut: record?.punchOut || null,
        workedHours: formatHours(metrics.workedMinutes),
        workedMinutes: metrics.workedMinutes,
        status: metrics.status,
        statusCode: metrics.statusCode,
        dayDesc: metrics.dayDesc,
        lateByMinutes: metrics.lateByMinutes,
        earlyByMinutes: metrics.earlyByMinutes,
        location: {
          in: record?.punchInLocation || null,
          out: record?.punchOutLocation || null,
        },
        remarks: record?.remarks || "",
      });
    }

    if (pastIncomplete.length) {
      await Attendance.updateMany(
        { _id: { $in: pastIncomplete } },
        {
          $set: {
            status: "Absent",
            workedMinutes: 0,
            reason: "Punched in but no punch-out",
          },
        }
      );
    }

    // Optional status filter on rows
    let filtered = rows;
    if (req.query.status && req.query.status !== "ALL") {
      const s = String(req.query.status).toUpperCase();
      filtered = rows.filter(
        (r) =>
          r.statusCode === s ||
          String(r.status).toUpperCase() === s ||
          String(r.status).toLowerCase() === String(req.query.status).toLowerCase()
      );
    }

    const page = req.query.page || 1;
    const limit = req.query.limit || 31;
    const total = filtered.length;
    const skip = (page - 1) * limit;
    const data = filtered.slice(skip, skip + limit);

    const monthDays = allDates.length;
    const workDays = monthDays - totalWeeklyOffs - totalHolidays;

    return res.json({
      employeeId,
      from,
      to,
      status: "Pending",
      summary: {
        daySummary: {
          totalMonthDays: monthDays,
          workDays,
          weeklyOffs: totalWeeklyOffs,
          holidays: totalHolidays,
        },
        presentSummary: {
          totalPresents,
          halfDays: totalHalfDays,
          grantedWeeklyOffs: totalWeeklyOffs,
          holidays: totalHolidays,
        },
        leaves: {
          lateArrivals,
          leftEarlyCount: leftEarly,
          generalLeaves: 0,
        },
        absentLate: {
          absents: totalAbsents,
          lateByGrace,
          earlyBy,
        },
        payable: {
          salaryDays,
        },
      },
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      data,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/timesheet/team — admin list of employees with punch stats for a day/range
 */
const listTeamTimesheet = async (req, res) => {
  try {
    if (!hasAllAccess(req.user)) {
      return res.status(403).json({ message: "Admin only" });
    }

    const { from, to } = resolveRange(req.query);
    let userFilter = { role: "Employee", status: "Active" };

    if (!hasGlobalCompanyAccess(req.user)) {
      const scope = companyFilter(req.user);
      if (scope === false) {
        return res.status(403).json({ message: "Your profile has no company" });
      }
      if (scope) Object.assign(userFilter, scope);
    }

    const page = req.query.page || 1;
    const limit = req.query.limit || 20;
    const skip = (page - 1) * limit;

    const [total, employees] = await Promise.all([
      User.countDocuments(userFilter),
      User.find(userFilter)
        .select("name official.employeeCode official.department official.company")
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const ids = employees.map((e) => e._id);
    const attendance = await Attendance.find({
      employee: { $in: ids },
      date: { $gte: from, $lte: to },
    }).lean();

    const byEmp = {};
    for (const a of attendance) {
      const key = String(a.employee);
      if (!byEmp[key]) byEmp[key] = [];
      byEmp[key].push(a);
    }

    const data = employees.map((e) => {
      const rows = byEmp[String(e._id)] || [];
      const presents = rows.filter((r) => r.status === "Present").length;
      const absents = rows.filter((r) => r.status === "Absent").length;
      return {
        employee: e,
        presents,
        absents,
        punchDays: rows.length,
      };
    });

    return res.json({
      from,
      to,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      data,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = { getTimesheet, listTeamTimesheet };
