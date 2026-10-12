/**
 * ATTENDANCE RESPONSE HELPERS
 * Formats punch / daily / calendar rows for the API.
 * Pure formatting — does not touch User or Company assignment.
 */
const { formatPunchStamp, minutesOfDay, parseHm, punchInWindow, graceMinutesOf, overtimeAfterShiftEnd } = require("./shiftTiming");

const oid = (value) => {
  if (value === undefined || value === null || value === "") return "";
  return String(value._id || value).trim();
};

/** Small shift card for API */
const shiftSummary = (shift) =>
  shift
    ? {
        _id: shift._id || null,
        code: shift.code || "",
        name: shift.name || "",
        startTime: shift.startTime || "",
        endTime: shift.endTime || "",
        halfDayEndTime: shift.halfDayEndTime || "",
        graceMinutes: graceMinutesOf(shift.graceMinutes),
        isDefault: !!shift.isDefault,
      }
    : null;

const companySummary = (company) =>
  company
    ? {
        _id: company._id || null,
        companyName: company.companyName || company.name || "",
      }
    : null;

const branchSummary = (branch) =>
  branch
    ? {
        _id: branch._id || null,
        name: branch.name || "",
        code: branch.code || "",
        address: branch.address || "",
        city: branch.city || "",
        state: branch.state || "",
      }
    : null;

/**
 * Only real Mongo ObjectId for Attendance.shift.
 * Default shift has no _id → save null (do not invent fake ids).
 */
const shiftDbId = (shift) =>
  shift && !shift.isDefault && shift._id ? shift._id : null;

/** 540 mins → "9h 0m" */
const formatDurationLabel = (mins) => {
  const n = Number(mins) || 0;
  if (n <= 0) return "0h 0m";
  const h = Math.floor(n / 60);
  const m = Math.round(n % 60);
  return `${h}h ${m}m`;
};

/**
 * Clean attendance row for punch / daily / calendar UIs.
 * Keeps live client shape: employee.official.employeeCode, etc.
 */
const formatAttendanceRecord = (record, extras = {}) => {
  if (!record) return null;
  const r =
    typeof record.toObject === "function" ? record.toObject() : { ...record };

  const worked = Number(r.workedMinutes) || 0;
  const endTime =
    (extras.shift && extras.shift.endTime) ||
    (r.shift && r.shift.endTime) ||
    "";
  const overtime = r.punchOut
    ? overtimeAfterShiftEnd(r.punchOut, endTime)
    : 0;

  const remarks = String(r.remarks || "").trim();
  const startMin = parseHm(
    (extras.shift && extras.shift.startTime) ||
      (r.shift && r.shift.startTime) ||
      ""
  );
  const punchMin = r.punchIn ? minutesOfDay(r.punchIn) : null;
  const grace = graceMinutesOf(
    (extras.shift && extras.shift.graceMinutes) ??
      (r.shift && r.shift.graceMinutes)
  );
  const window =
    startMin != null && punchMin != null
      ? punchInWindow(punchMin, startMin, grace)
      : null;
  const punchedBeforeStart = window ? window.isEarly : false;
  const lateBy = window ? window.lateByMinutes : Number(r.lateByMinutes) || 0;
  const isLate = window ? window.isLate : lateBy > 0;
  const earlyBy = window ? window.earlyByMinutes : 0;
  let attendanceStatus = r.attendanceStatus || null;
  if (attendanceStatus !== "Approved" && attendanceStatus !== "Rejected") {
    if (!r.punchIn) attendanceStatus = null;
    else if (isLate) attendanceStatus = "Late";
    else if (punchedBeforeStart) attendanceStatus = "Early";
    else attendanceStatus = "On time";
  }
  const canApproveReject = attendanceStatus === "Late";
  const shownRemarks = !isLate && remarks === "Late punch-in" ? "" : remarks;

  const employee = r.employee
    ? {
        _id: r.employee._id,
        name: r.employee.name || "",
        email: r.employee.official?.officialEmail || "",
        employeeCode: r.employee.official?.employeeCode || "",
        department: r.employee.official?.department || "",
        designation: r.employee.official?.designation || "",
        role: r.employee.role || "",
      }
    : null;

  const shiftOut =
    extras.shift ||
    (r.shift && typeof r.shift === "object" && r.shift.name
      ? shiftSummary(r.shift)
      : extras.shiftSummary || r.shift || null);

  return {
    attendanceId: r._id,
    date: r.date,
    employee,
    company: extras.company || companySummary(r.companyId) || null,
    branch: extras.branch || branchSummary(r.branchId) || null,
    shift: shiftOut,
    punchInTime: formatPunchStamp(r.punchIn),
    punchOutTime: formatPunchStamp(r.punchOut),
    verification: r.punchInSource || null,
    status: r.punchIn && !r.punchOut ? "MissedPunch" : r.status || "",
    workMode: r.workMode || "WFO",
    workingHours: formatDurationLabel(worked),
    overtime: formatDurationLabel(overtime),
    lateByMinutes: lateBy,
    earlyByMinutes: earlyBy,
    isLate,
    isEarly: punchedBeforeStart,
    remarks: shownRemarks,
    attendanceStatus,
    reviewReason: String(r.reviewReason || "").trim(),
    reviewedBy:
      r.remarkReviewedBy && r.remarkReviewedBy.name
        ? {
            _id: r.remarkReviewedBy._id,
            name: r.remarkReviewedBy.name || "",
            role: r.remarkReviewedBy.role || "",
            email: r.remarkReviewedBy.official?.officialEmail || "",
          }
        : r.remarkReviewedBy
          ? { _id: r.remarkReviewedBy._id || r.remarkReviewedBy }
          : null,
    canApproveReject,
  };
};

module.exports = {
  oid,
  shiftSummary,
  companySummary,
  branchSummary,
  shiftDbId,
  formatDurationLabel,
  formatAttendanceRecord,
};
