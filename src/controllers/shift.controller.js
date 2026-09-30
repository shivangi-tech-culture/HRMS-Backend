/**
 * SHIFT CONTROLLER — /api/shifts + /api/shifts/assignments
 * Matches Work → Shift Management + Shift Assignments UI
 */
const mongoose = require("mongoose");
const Shift = require("../models/Shift");
const ShiftAssignment = require("../models/ShiftAssignment");
const WeeklyOff = require("../models/WeeklyOff");
const User = require("../models/User");
const {
  escapeRegex,
  resolveCompany,
  assertOwnCompany,
  formatWeeklyOffLabel,
  hasGlobalCompanyAccess,
  normalizeCompany,
  getUserCompany,
} = require("../utils/workScope");
const {
  assertSameCompanyEmployee,
  companyFilter,
} = require("../utils/companyScope");
const { todayDate } = require("../utils/shiftTiming");

const okId = (id) => mongoose.Types.ObjectId.isValid(id);

/** Resolve Weekly Off by id only — no name/days copy on assignment */
const resolveWeeklyOffPolicy = async (weeklyOffId, reqUser) => {
  if (!okId(weeklyOffId)) {
    return { error: "Invalid weeklyOffId" };
  }
  const policy = await WeeklyOff.findById(weeklyOffId);
  if (!policy || policy.status !== "Active") {
    return { error: "Active weekly off policy not found" };
  }
  if (!hasGlobalCompanyAccess(reqUser)) {
    if (normalizeCompany(policy.company) !== getUserCompany(reqUser)) {
      return { error: "Weekly off policy belongs to another company" };
    }
  }
  return { policy, weeklyOffPolicy: policy._id };
};

const parseHm = (hm) => {
  const [h, m] = String(hm || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

const calcDurationHrs = (startTime, endTime, nightShift) => {
  let s = parseHm(startTime);
  let e = parseHm(endTime);
  if (s == null || e == null) return null;
  if (nightShift || e <= s) e += 24 * 60;
  return Math.round(((e - s) / 60) * 100) / 100;
};

const withDurations = (body) => {
  const nightShift = body.nightShift === true;
  const auto = calcDurationHrs(body.startTime, body.endTime, nightShift);
  const shiftDuration =
    body.shiftDuration != null && body.shiftDuration !== ""
      ? Number(body.shiftDuration)
      : auto ?? 9;
  // workDuration = shiftDuration unless UI sends a different value (no duplicate logic)
  const workDuration =
    body.workDuration != null && body.workDuration !== ""
      ? Number(body.workDuration)
      : shiftDuration;
  return {
    ...body,
    code: String(body.code || "").trim().toUpperCase(),
    name: String(body.name || "").trim(),
    shiftDuration,
    workDuration,
  };
};

const listShifts = async (req, res) => {
  try {
    const { status, company, search, page, limit } = req.query;
    const skip = (page - 1) * limit;
    const filter = {};
    if (status) filter.status = status;
    if (!hasGlobalCompanyAccess(req.user)) {
      const own = String(req.user?.official?.company || "").trim();
      if (!own) {
        return res.status(403).json({ message: "Your profile has no company" });
      }
      filter.company = new RegExp(`^${escapeRegex(own)}$`, "i");
    } else if (company) {
      filter.company = new RegExp(`^${escapeRegex(company)}$`, "i");
    }
    if (search) {
      filter.$or = [
        { name: new RegExp(escapeRegex(search), "i") },
        { code: new RegExp(escapeRegex(search), "i") },
      ];
    }
    const [total, data] = await Promise.all([
      Shift.countDocuments(filter),
      Shift.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ]);
    return res.json({
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

const getShift = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid shift id" });
    }
    const shift = await Shift.findById(req.params.id);
    if (!shift) return res.status(404).json({ message: "Shift not found" });
    const err = assertOwnCompany(req, shift.company);
    if (err) return res.status(403).json({ message: err });
    return res.json({ data: shift });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const createShift = async (req, res) => {
  try {
    const company = resolveCompany(req, req.body.company);
    if (!company) return res.status(400).json({ message: "company is required" });
    if (req.body.startTime === req.body.endTime && !req.body.nightShift) {
      return res
        .status(400)
        .json({ message: "startTime and endTime cannot be the same" });
    }
    const shift = await Shift.create({ ...withDurations(req.body), company });
    return res.status(201).json({ message: "Shift created", data: shift });
  } catch (err) {
    if (err.code === 11000) {
      return res
        .status(409)
        .json({ message: "Shift code already exists for this company" });
    }
    return res.status(500).json({ message: err.message });
  }
};

const updateShift = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid shift id" });
    }
    const shift = await Shift.findById(req.params.id);
    if (!shift) return res.status(404).json({ message: "Shift not found" });
    const err = assertOwnCompany(req, shift.company);
    if (err) return res.status(403).json({ message: err });
    if (!hasGlobalCompanyAccess(req.user)) delete req.body.company;

    Object.assign(shift, req.body);
    if (req.body.name) shift.name = String(req.body.name).trim();
    if (req.body.code != null) {
      shift.code = String(req.body.code).trim().toUpperCase();
    }
    if (shift.startTime === shift.endTime && !shift.nightShift) {
      return res
        .status(400)
        .json({ message: "startTime and endTime cannot be the same" });
    }
    if (
      req.body.startTime != null ||
      req.body.endTime != null ||
      req.body.nightShift != null
    ) {
      const auto = calcDurationHrs(
        shift.startTime,
        shift.endTime,
        shift.nightShift
      );
      if (req.body.shiftDuration == null && auto != null) shift.shiftDuration = auto;
      if (req.body.workDuration == null && auto != null) shift.workDuration = auto;
    }
    await shift.save();
    return res.json({ message: "Shift updated", data: shift });
  } catch (err) {
    if (err.code === 11000) {
      return res
        .status(409)
        .json({ message: "Shift code already exists for this company" });
    }
    return res.status(500).json({ message: err.message });
  }
};

const deleteShift = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid shift id" });
    }
    const shift = await Shift.findById(req.params.id);
    if (!shift) return res.status(404).json({ message: "Shift not found" });
    const err = assertOwnCompany(req, shift.company);
    if (err) return res.status(403).json({ message: err });

    const inUse = await ShiftAssignment.countDocuments({
      shift: shift._id,
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: todayDate() } }],
    });
    if (inUse > 0) {
      return res.status(400).json({
        message:
          "Cannot delete — shift is assigned to employees. Unassign or set Inactive.",
        activeAssignments: inUse,
      });
    }
    await shift.deleteOne();
    return res.json({ message: "Shift deleted" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** ASSIGN — POST /api/shifts/assignments */
const assignShift = async (req, res) => {
  try {
    const {
      employeeId,
      shiftId,
      weeklyOffId,
      effectiveFrom,
      effectiveTo,
      remarks,
    } = req.body;

    const employee = await User.findById(employeeId).select(
      "_id name status role official.company official.department official.employeeCode"
    );
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    if (employee.status !== "Active") {
      return res.status(400).json({ message: "Employee is inactive" });
    }
    const scopeErr = assertSameCompanyEmployee(req.user, employee);
    if (scopeErr) return res.status(403).json({ message: scopeErr });

    const shift = await Shift.findById(shiftId);
    if (!shift || shift.status !== "Active") {
      return res.status(404).json({ message: "Active shift not found" });
    }
    if (!hasGlobalCompanyAccess(req.user)) {
      if (normalizeCompany(shift.company) !== getUserCompany(req.user)) {
        return res
          .status(403)
          .json({ message: "Shift belongs to another company" });
      }
    }

    const wo = await resolveWeeklyOffPolicy(weeklyOffId, req.user);
    if (wo.error) return res.status(400).json({ message: wo.error });

    const toDate =
      effectiveTo === "" || effectiveTo == null ? null : effectiveTo;
    if (toDate && toDate < effectiveFrom) {
      return res
        .status(400)
        .json({ message: "effectiveTo cannot be before effectiveFrom" });
    }

    const prevDay = (() => {
      const d = new Date(`${effectiveFrom}T12:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    })();

    await ShiftAssignment.updateMany(
      {
        employee: employeeId,
        effectiveTo: null,
        effectiveFrom: { $lte: effectiveFrom },
      },
      { $set: { effectiveTo: prevDay } }
    );

    const row = await ShiftAssignment.create({
      employee: employeeId,
      shift: shiftId,
      company: String(employee.official?.company || shift.company || ""),
      weeklyOffPolicy: wo.weeklyOffPolicy, // id only — name/days from WeeklyOff
      effectiveFrom,
      effectiveTo: toDate,
      assignedBy: req.user._id,
      remarks: remarks || "",
    });

    await User.updateOne(
      { _id: employeeId },
      { $set: { "official.shift": shiftId } }
    );

    await row.populate(
      "employee",
      "name role official.employeeCode official.department official.company"
    );
    await row.populate("shift");
    await row.populate(
      "weeklyOffPolicy",
      "name code workingDays weekStartsOn offDays status"
    );
    await row.populate("assignedBy", "name role");

    return res.status(201).json({ message: "Shift assigned", data: row });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const listAssignments = async (req, res) => {
  try {
    const { employeeId, shiftId, company, search, page, limit } = req.query;
    const skip = (page - 1) * limit;
    const filter = {};

    if (employeeId) filter.employee = employeeId;
    if (shiftId) filter.shift = shiftId;

    if (!hasGlobalCompanyAccess(req.user)) {
      if (req.user.role === "Employee") {
        filter.employee = req.user._id;
      } else {
        const scope = companyFilter(req.user);
        if (scope === false) {
          return res.status(403).json({ message: "Your profile has no company" });
        }
        if (scope) {
          const users = await User.find(scope).select("_id").lean();
          filter.employee = { $in: users.map((u) => u._id) };
        }
      }
    } else if (company) {
      filter.company = new RegExp(`^${escapeRegex(company)}$`, "i");
    }

    let data = await ShiftAssignment.find(filter)
      .populate(
        "employee",
        "name role official.employeeCode official.department official.company"
      )
      .populate("shift")
      .populate(
        "weeklyOffPolicy",
        "name code workingDays weekStartsOn offDays status"
      )
      .populate("assignedBy", "name role")
      .sort({ effectiveFrom: -1 })
      .lean();

    if (search) {
      const q = String(search).toLowerCase();
      data = data.filter((row) => {
        const n = row.employee?.name || "";
        const c = row.employee?.official?.employeeCode || "";
        const s = row.shift?.name || "";
        return (
          n.toLowerCase().includes(q) ||
          c.toLowerCase().includes(q) ||
          s.toLowerCase().includes(q)
        );
      });
    }

    const total = data.length;
    const pageData = data.slice(skip, skip + limit).map((row) => {
      const policy = row.weeklyOffPolicy;
      return {
        ...row,
        timing: row.shift
          ? `${row.shift.startTime} - ${row.shift.endTime}`
          : null,
        // Display from policy id populate (not stored copy)
        weeklyOff:
          policy?.name ||
          formatWeeklyOffLabel(policy?.offDays) ||
          null,
      };
    });

    return res.json({
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      data: pageData,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const updateAssignment = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid assignment id" });
    }
    const row = await ShiftAssignment.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Assignment not found" });

    const employee = await User.findById(row.employee).select(
      "_id official.company"
    );
    const scopeErr = assertSameCompanyEmployee(req.user, employee);
    if (scopeErr) return res.status(403).json({ message: scopeErr });

    if (req.body.shiftId) {
      const shift = await Shift.findById(req.body.shiftId);
      if (!shift || shift.status !== "Active") {
        return res.status(404).json({ message: "Active shift not found" });
      }
      row.shift = shift._id;
      await User.updateOne(
        { _id: row.employee },
        { $set: { "official.shift": shift._id } }
      );
    }
    if (req.body.weeklyOffId) {
      const wo = await resolveWeeklyOffPolicy(req.body.weeklyOffId, req.user);
      if (wo.error) return res.status(400).json({ message: wo.error });
      row.weeklyOffPolicy = wo.weeklyOffPolicy; // id only
    }
    if (req.body.effectiveFrom) row.effectiveFrom = req.body.effectiveFrom;
    if (req.body.effectiveTo !== undefined) {
      row.effectiveTo =
        req.body.effectiveTo === "" || req.body.effectiveTo == null
          ? null
          : req.body.effectiveTo;
    }
    if (req.body.remarks != null) row.remarks = req.body.remarks;

    await row.save();
    await row.populate(
      "employee",
      "name role official.employeeCode official.department official.company"
    );
    await row.populate("shift");
    await row.populate(
      "weeklyOffPolicy",
      "name code workingDays weekStartsOn offDays status"
    );
    await row.populate("assignedBy", "name role");

    return res.json({ message: "Assignment updated", data: row });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const deleteAssignment = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid assignment id" });
    }
    const row = await ShiftAssignment.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Assignment not found" });
    const employee = await User.findById(row.employee).select(
      "_id official.company"
    );
    const scopeErr = assertSameCompanyEmployee(req.user, employee);
    if (scopeErr) return res.status(403).json({ message: scopeErr });
    await row.deleteOne();
    return res.json({ message: "Assignment deleted" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * ESS — View Shift Roster (NOT punch-in/out)
 * Weekly Off = fetch live from Work → Weekly Off policy by id (weeklyOffPolicy).
 *
 * GET /api/shifts/roster/me?month=2026-09
 */
const myRoster = async (req, res) => {
  try {
    const Holiday = require("../models/Holiday");
    const WeeklyOff = require("../models/WeeklyOff");
    const { dayTypeOf, weekdayOf } = require("../utils/shiftTiming");
    const { escapeRegex } = require("../utils/workScope");

    const today = todayDate();
    const employeeId = req.user._id;

    let current = await ShiftAssignment.findOne({
      employee: employeeId,
      effectiveFrom: { $lte: today },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: today } }],
    })
      .sort({ effectiveFrom: -1 })
      .populate(
        "shift",
        "code name punchStartTime startTime endTime halfDayEndTime halfDayDays status"
      )
      .populate(
        "weeklyOffPolicy",
        "name code workingDays weekStartsOn offDays status"
      )
      .lean();

    const emp = await User.findById(employeeId)
      .select("official.company")
      .lean();
    const company = String(emp?.official?.company || "").trim();

    // Always fetch Weekly Off policy fresh by id (single source of truth)
    let policy = null;
    if (current?.weeklyOffPolicy?._id) {
      policy = await WeeklyOff.findById(current.weeklyOffPolicy._id)
        .select("name code workingDays weekStartsOn offDays status")
        .lean();
      if (policy && policy.status !== "Active") policy = null;
    }

    const shift = current?.shift || null;
    // Off days from policy id only (no assignment copy fields)
    const weeklyOffDays = policy?.offDays?.length
      ? policy.offDays
      : shift?.weeklyOffDays || [0];
    const weeklyOff = policy?.name || formatWeeklyOffLabel(weeklyOffDays);

    const payload = {
      today,
      about:
        "View Shift Roster = expected calendar. Weekly Off from policy id only.",
      current: current
        ? {
            _id: current._id,
            weeklyOff,
            weeklyOffDays,
            weeklyOffPolicy: policy
              ? {
                  _id: policy._id,
                  name: policy.name,
                  code: policy.code,
                  workingDays: policy.workingDays,
                  weekStartsOn: policy.weekStartsOn,
                  offDays: policy.offDays,
                }
              : null,
            effectiveFrom: current.effectiveFrom,
            effectiveTo: current.effectiveTo,
            shift: shift
              ? {
                  _id: shift._id,
                  code: shift.code,
                  name: shift.name,
                  punchStartTime: shift.punchStartTime,
                  startTime: shift.startTime,
                  endTime: shift.endTime,
                  halfDayEndTime: shift.halfDayEndTime || "14:30",
                }
              : null,
          }
        : null,
    };

    const month = String(req.query.month || today.slice(0, 7));
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.json(payload);
    }

    const [y, m] = month.split("-").map(Number);
    const from = `${month}-01`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const to = `${month}-${String(last).padStart(2, "0")}`;

    const holidayFilter = {
      status: "Active",
      date: { $gte: from, $lte: to },
    };
    if (company) {
      holidayFilter.company = new RegExp(`^${escapeRegex(company)}$`, "i");
    }
    const holidays = await Holiday.find(holidayFilter).lean();
    const holidayMap = {};
    for (const h of holidays) holidayMap[h.date] = h;

    const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const shiftForDay = shift
      ? {
          ...shift,
          weeklyOffDays,
          halfDayDays: (shift.halfDayDays || [6]).filter(
            (d) => !weeklyOffDays.includes(d)
          ),
        }
      : null;

    const days = [];
    for (let d = 1; d <= last; d++) {
      const date = `${month}-${String(d).padStart(2, "0")}`;
      const type = dayTypeOf(shiftForDay, date, holidayMap);
      const hol = holidayMap[date] || null;

      let label = shift?.code || "—";
      let code = shift?.code || null;
      let name = shift?.name || null;
      let startTime = shift?.startTime || null;
      let endTime = shift?.endTime || null;

      if (type === "holiday") {
        label = "HO";
        code = "HO";
        name = hol?.name || "Holiday";
      } else if (type === "weeklyOff") {
        label = "WO";
        code = "WO";
        name = weeklyOff || "Weekly Off";
        startTime = null;
        endTime = null;
      } else if (type === "halfDay") {
        endTime = shift?.halfDayEndTime || "14:30";
      }

      days.push({
        date,
        day: DAY_NAMES[weekdayOf(date)],
        label,
        code,
        name,
        startTime,
        endTime,
        dayType: type,
        holiday: hol ? { name: hol.name, type: hol.type } : null,
      });
    }

    payload.month = month;
    payload.days = days;
    return res.json(payload);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  listShifts,
  getShift,
  createShift,
  updateShift,
  deleteShift,
  assignShift,
  listAssignments,
  updateAssignment,
  deleteAssignment,
  myRoster,
};
