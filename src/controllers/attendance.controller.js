/**
 * ATTENDANCE CONTROLLER — self punch only, under /api/attendance
 * punch-in · punch-out · today · web-punches (own punches)
 *
 * Punch flow (simple):
 * 1. Body: source + latitude + longitude (address NOT from client)
 * 2. Default work window 10:00–19:00 (grace 10)
 * 3. validatePunchAgainstShift → time window OK?
 * 4. Map API → address from lat/long
 * 5. Save Attendance (one row per employee per day)
 */
const Attendance = require("../models/Attendance"); // daily punch document
const { SELF_SOURCES } = require("../validators/attendance.validation"); // web|mobile|biometric
const { resolvePunchLocation } = require("../utils/geocode"); // lat/long → address
const {
  todayDate, // YYYY-MM-DD in app TZ
  getAssignedShift, // default 10:00–19:00
  validatePunchAgainstShift, // punch time gatekeeper
  computeDayMetrics, // Present / Absent / late / early
} = require("../utils/shiftTiming");

const today = todayDate; // alias used in this file

/**
 * Self punch must be web / mobile / biometric (not "manual")
 * @returns {string|null} error message or null if OK
 */
const assertSelfSource = (source) => {
  if (!SELF_SOURCES.includes(source)) {
    return "Self punch source must be web, mobile, or biometric. Manual is admin-only.";
  }
  return null; // OK
};

/**
 * Small shift object for API response (UI card)
 * isDefault=true means no Shift Assignment — using 10–7 default
 */
const shiftSummary = (shift) =>
  shift
    ? {
        _id: shift._id || null, // null when default (no DB Shift doc)
        code: shift.code || "",
        name: shift.name,
        startTime: shift.startTime,
        endTime: shift.endTime,
        halfDayEndTime: shift.halfDayEndTime || "14:30",
        graceMinutes: Number(shift.graceMinutes || 0),
        isDefault: !!shift.isDefault, // true = default shift
      }
    : null;

/**
 * Attendance.shift field needs real Mongo ObjectId only.
 * Default shift has no _id → return null (don't save fake id)
 */
const shiftDbId = (shift) =>
  shift && !shift.isDefault && shift._id ? shift._id : null;

/**
 * After punch-out / manual: copy metrics onto attendance row
 * (status, workedMinutes, lateByMinutes, earlyByMinutes)
 */
const applyMetrics = (record, shift) => {
  const metrics = computeDayMetrics(record, shift, record.date);
  record.status = metrics.status; // Present | Absent | HalfDay | …
  record.workedMinutes = metrics.workedMinutes;
  record.lateByMinutes = metrics.lateByMinutes;
  record.earlyByMinutes = metrics.earlyByMinutes;
  return metrics;
};

/**
 * PUNCH IN — POST /api/attendance/punch-in
 * Body: { source, latitude, longitude, remarks? }
 */
const punchIn = async (req, res) => {
  try {
    // 1) Source must be self-punch type
    const sourceErr = assertSelfSource(req.body.source);
    if (sourceErr) return res.status(403).json({ message: sourceErr });

    const employeeId = req.user._id; // logged-in employee
    const date = today(); // today's date YYYY-MM-DD
    const source = req.body.source; // web | mobile | biometric
    const now = new Date(); // punch timestamp

    // 2) Default work window (Shift module removed)
    const { shift } = await getAssignedShift(employeeId, date);

    // 3) Gatekeeper: punchStart / early rules — fail → no save
    const windowCheck = validatePunchAgainstShift(shift, now, "in", date);
    if (!windowCheck.ok) {
      return res.status(400).json({ message: windowCheck.message });
    }

    // 4) Geo: lat/long from body → address from Map API
    const location = await resolvePunchLocation(req.body);

    // 5) One attendance row per employee per day
    let record = await Attendance.findOne({ employee: employeeId, date });
    if (record && record.punchIn) {
      // Already punched in today — block double in
      return res.status(400).json({ message: "Already punched in today", record });
    }

    // Create empty row if first punch of the day
    if (!record) {
      record = new Attendance({ employee: employeeId, date });
    }

    // 6) Write punch-in fields
    record.punchIn = now;
    record.punchInSource = source;
    record.punchInLocation = location; // { latitude, longitude, address }
    record.shift = shiftDbId(shift); // real shift id or null (default)
    record.status = "Pending"; // waiting for punch-out
    record.workedMinutes = 0;
    if (req.body.remarks) record.remarks = req.body.remarks;
    await record.save();

    // 7) Populate for response
    await record.populate(
      "employee",
      "name role official.employeeCode official.department"
    );

    return res.status(201).json({
      message: windowCheck.isEarly
        ? "Punched in (early — before shift start, allowed)"
        : "Punched in successfully",
      source,
      shift: shiftSummary(shift), // assigned or default timings
      location,
      record,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * PUNCH OUT — POST /api/attendance/punch-out
 * Must punch-in first. Then out + day metrics (Present / HD / late…).
 */
const   punchOut = async (req, res) => {
  try {
    // 1) Self source only
    const sourceErr = assertSelfSource(req.body.source);
    if (sourceErr) return res.status(403).json({ message: sourceErr });

    const employeeId = req.user._id;
    const date = today();
    const source = req.body.source;
    const now = new Date();

    // 2) Must have today's punch-in
    const record = await Attendance.findOne({ employee: employeeId, date });
    if (!record || !record.punchIn) {
      return res.status(400).json({ message: "Please punch in first" });
    }
    // Already out → block
    if (record.punchOut) {
      return res.status(400).json({ message: "Already punched out today", record });
    }

    // 3) Live shift (assignment update applies) or default
    const { shift } = await getAssignedShift(employeeId, date);
    record.shift = shiftDbId(shift) || record.shift; // keep id if assigned

    // 4) Out window check (late out usually allowed)
    const windowCheck = validatePunchAgainstShift(shift, now, "out", date);
    if (!windowCheck.ok) {
      return res.status(400).json({ message: windowCheck.message });
    }

    // 5) Geo for out
    const location = await resolvePunchLocation(req.body);

    // 6) Save out + compute Present/HalfDay/late/early
    record.punchOut = now;
    record.punchOutSource = source;
    record.punchOutLocation = location;
    if (req.body.remarks) record.remarks = req.body.remarks;
    applyMetrics(record, shift);
    await record.save();

    await record.populate(
      "employee",
      "name role official.employeeCode official.department"
    );

    return res.json({
      message: windowCheck.isLate
        ? "Punched out (after shift end — allowed)"
        : "Punched out successfully",
      source,
      shift: shiftSummary(shift),
      location,
      record,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * MY TODAY — GET /api/attendance/today
 * Returns today's record + current shift (assigned or default summary)
 */
const myToday = async (req, res) => {
  try {
    const date = today();
    // Load today's attendance if any
    let record = await Attendance.findOne({
      employee: req.user._id,
      date,
    });

    // Always resolve live shift (assignment OR default)
    const { shift } = await getAssignedShift(req.user._id, date);

    if (record) {
      let dirty = false; // need save?
      const dbId = shiftDbId(shift);
      // If assignment exists, keep attendance.shift in sync
      if (dbId) {
        const recordShiftId = record.shift
          ? String(record.shift._id || record.shift)
          : null;
        if (recordShiftId !== String(dbId)) {
          record.shift = dbId;
          dirty = true;
        }
      }
      // Both punches + still Pending → recompute status
      if (record.punchIn && record.punchOut && (dirty || record.status === "Pending")) {
        applyMetrics(record, shift);
        dirty = true;
      }
      if (dirty) {
        await record.save();
      }
    }

    return res.json({
      date,
      shift: shiftSummary(shift), // one object: assigned or default
      record: record || null,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * MY WEB PUNCHES — GET /api/attendance/web-punches
 * Logged-in user's own punches — each day flattened into IN / OUT rows (ESS table UI)
 */
const listWebPunches = async (req, res) => {
  try {
    const filter = { employee: req.user._id };
    const { from, to, date, status, page, limit } = req.query;

    if (date) filter.date = date;
    else if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }
    if (status && status !== "ALL") filter.status = status;

    const records = await Attendance.find(filter)
      .populate("employee", "name official.employeeCode")
      .sort({ date: -1, punchIn: -1 })
      .lean();

    // One attendance day → up to 2 punch rows (IN + OUT)
    const punches = [];
    for (const r of records) {
      if (r.punchIn) {
        punches.push({
          _id: `${r._id}-in`,
          attendanceId: r._id,
          employee: r.employee,
          shift: r.shift,
          status: r.status,
          punchTime: r.punchIn,
          punchMode: "IN",
          punchType: r.punchInSource === "manual" ? "Manual" : "Work From Office",
          location: r.punchInLocation || {},
          remarks: r.remarks || "",
          source: r.punchInSource,
          date: r.date,
        });
      }
      if (r.punchOut) {
        punches.push({
          _id: `${r._id}-out`,
          attendanceId: r._id,
          employee: r.employee,
          shift: r.shift,
          status: r.status,
          punchTime: r.punchOut,
          punchMode: "OUT",
          punchType: r.punchOutSource === "manual" ? "Manual" : "Work From Office",
          location: r.punchOutLocation || {},
          remarks: r.remarks || "",
          source: r.punchOutSource,
          date: r.date,
        });
      }
    }

    // Newest punch first
    punches.sort((a, b) => new Date(b.punchTime) - new Date(a.punchTime));

    // Manual pagination on flattened list
    const p = page || 1;
    const l = limit || 50;
    const total = punches.length;
    const start = (p - 1) * l;
    const data = punches.slice(start, start + l);

    return res.json({
      total,
      page: p,
      limit: l,
      pages: Math.max(1, Math.ceil(total / l)),
      data,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = { punchIn, punchOut, myToday, listWebPunches };
