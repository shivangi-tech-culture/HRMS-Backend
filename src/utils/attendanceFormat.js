/**
 * ATTENDANCE RESPONSE HELPERS
 * Formats punch / daily / calendar rows for the API.
 * Pure formatting — does not touch User or Company assignment.
 */
const { formatPunchStamp, overtimeMinutesOf } = require("./shiftTiming");

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
        graceMinutes: Number(shift.graceMinutes || 0),
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
  const overtime =
    r.overtimeMinutes != null
      ? Number(r.overtimeMinutes) || 0
      : overtimeMinutesOf(worked);

  const remarks = String(r.remarks || "").trim();
  const remarkStatus = r.remarkStatus || null;
  const canApproveReject = remarkStatus === "Pending";

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
    status: r.status || "Pending",
    workMode: r.workMode || "WFO",
    workingHours: formatDurationLabel(worked),
    overtime: formatDurationLabel(overtime),
    lateByMinutes: Number(r.lateByMinutes) || 0,
    earlyByMinutes: Number(r.earlyByMinutes) || 0,
    isLate: (Number(r.lateByMinutes) || 0) > 0,
    remarks,
    remarkStatus,
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
