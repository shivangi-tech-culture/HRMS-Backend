/**
 * Attendance controller
 *
 * Employee self punch: web | mobile | biometric only (never manual)
 * Manual mark: Super Admin / HR / Manager only — when punch was missed
 * Sources: punchInSource + punchOutSource (no duplicate verification field)
 */
const Attendance = require("../models/Attendance");
const { todayDate } = Attendance;
const User = require("../models/User");
const { hasAllAccess } = require("../middleware/auth");
const { SELF_SOURCES } = require("../validators/attendance.validation");

const today = todayDate;

const combineDateTime = (dateStr, timeStr) => {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCHours(h, m, 0, 0);
  return d;
};

const assertSelfSource = (source) => {
  if (!SELF_SOURCES.includes(source)) {
    return "Employees can only punch via web, mobile, or biometric. Manual is admin-only.";
  }
  return null;
};

/** POST /api/attendance/punch-in — body: { source: web|mobile|biometric } */
const punchIn = async (req, res) => {
  try {
    const sourceErr = assertSelfSource(req.body.source);
    if (sourceErr) return res.status(403).json({ message: sourceErr });

    const employeeId = req.user._id;
    const date = today();
    const source = req.body.source;

    let record = await Attendance.findOne({ employee: employeeId, date });
    if (record && record.punchIn) {
      return res.status(400).json({ message: "Already punched in today", record });
    }

    const now = new Date();
    if (!record) {
      record = new Attendance({
        employee: employeeId,
        punchIn: now,
        punchInSource: source,
      });
    } else {
      record.punchIn = now;
      record.punchInSource = source;
    }
    await record.save();

    return res.status(201).json({
      message: "Punched in successfully",
      source,
      record,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** POST /api/attendance/punch-out — body: { source: web|mobile|biometric } */
const punchOut = async (req, res) => {
  try {
    const sourceErr = assertSelfSource(req.body.source);
    if (sourceErr) return res.status(403).json({ message: sourceErr });

    const employeeId = req.user._id;
    const date = today();
    const source = req.body.source;

    const record = await Attendance.findOne({ employee: employeeId, date });

    if (!record || !record.punchIn) {
      return res.status(400).json({ message: "Please punch in first" });
    }
    if (record.punchOut) {
      return res.status(400).json({ message: "Already punched out today", record });
    }

    record.punchOut = new Date();
    record.punchOutSource = source;
    await record.save();

    return res.json({
      message: "Punched out successfully",
      source,
      record,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/attendance/manual — admin only (missed punch)
 * Date always today. Source forced to "manual".
 */
const markManual = async (req, res) => {
  try {
    if (!hasAllAccess(req.user)) {
      return res.status(403).json({
        message: "Only Super Admin / HR Manager / Manager can mark attendance manually",
      });
    }

    const { employeeId, punchType, time, reason, remarks } = req.body;
    const date = today();

    const employee = await User.findById(employeeId).select("_id name status");
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }
    if (employee.status !== "Active") {
      return res.status(400).json({ message: "Employee is inactive" });
    }

    const punchAt = combineDateTime(date, time);
    let record = await Attendance.findOne({ employee: employeeId, date });

    if (!record) {
      record = new Attendance({ employee: employeeId });
    }

    if (punchType === "in") {
      record.punchIn = punchAt;
      record.punchInSource = "manual";
    } else {
      if (!record.punchIn) {
        return res.status(400).json({
          message: "Cannot mark punch-out — punch-in is missing for today",
        });
      }
      if (punchAt < record.punchIn) {
        return res.status(400).json({
          message: "Punch-out time cannot be before punch-in time",
        });
      }
      record.punchOut = punchAt;
      record.punchOutSource = "manual";
    }

    record.reason = reason;
    record.remarks = remarks || "";
    record.markedBy = req.user._id;
    await record.save();

    await record.populate("employee", "name role official.officialEmail official.employeeCode official.department");
    await record.populate("markedBy", "name role");

    return res.status(201).json({
      message: "Manual attendance saved (audit logged)",
      source: "manual",
      date,
      punchType,
      record,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** GET /api/attendance/today */
const myToday = async (req, res) => {
  try {
    const record = await Attendance.findOne({
      employee: req.user._id,
      date: today(),
    });

    return res.json({ date: today(), record: record || null });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** GET /api/attendance — optional ?date=&source=web|mobile|biometric|manual */
const listAttendance = async (req, res) => {
  try {
    const filter = {};
    if (!hasAllAccess(req.user)) {
      filter.employee = req.user._id;
    }
    if (req.query.date) filter.date = req.query.date;

    if (req.query.source) {
      const s = req.query.source;
      filter.$or = [{ punchInSource: s }, { punchOutSource: s }];
    }

    const records = await Attendance.find(filter)
      .populate("employee", "name role official.officialEmail official.employeeCode official.department")
      .populate("markedBy", "name role")
      .sort({ date: -1 });

    return res.json({ count: records.length, records });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = { punchIn, punchOut, markManual, myToday, listAttendance };
