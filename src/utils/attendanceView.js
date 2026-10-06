/**
 * ATTENDANCE VIEW HELPERS — format raw Attendance docs for Daily / Calendar / Detail UI
 */
const {
  getAssignedShift,
  computeDayMetrics,
  effectiveEndTime,
  formatHours,
  parseHm,
  minutesOfDay,
  TZ,
} = require("./shiftTiming");
const { companyRefs } = require("./companyScope");

/** Format Date → "09:24 AM" in app TZ (manual punches store clock as UTC hours) */
const formatClock = (date, source) => {
  if (!date) return null;
  const useUtc = String(source || "").toLowerCase() === "manual";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: useUtc ? "UTC" : TZ(),
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(date));
};

/** Format Date → "31 Aug 2024" */
const formatDisplayDate = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T12:00:00`);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ(),
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
};

/** Minutes → "9h 18m" / "44m" / "0m" */
const formatDuration = (minutes) => {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${String(mm).padStart(2, "0")}m` : `${h}h 00m`;
};

/** Map punch source → UI verification / method label */
const sourceLabel = (source) => {
  const s = String(source || "").toLowerCase();
  if (s === "biometric") return "Face";
  if (s === "manual") return "Manual";
  if (s === "mobile") return "Mobile Attendance";
  if (s === "web") return "Web";
  return source || "—";
};

const verificationMethod = (source) => {
  const s = String(source || "").toLowerCase();
  if (s === "biometric") return "Face Recognition";
  if (s === "manual") return "Manual Entry";
  if (s === "mobile") return "Mobile Attendance";
  if (s === "web") return "Web Attendance";
  return "—";
};

/** Infer work mode from status / source */
const resolveWorkMode = (record) => {
  if (record?.status === "WFH") return "WFH";
  if (record?.workMode) return record.workMode;
  const src = String(record?.punchInSource || "").toLowerCase();
  if (src === "mobile") return "Hybrid";
  return "WFO";
};

/** Employee location for Work Info card */
const resolveLocation = (employee, record) => {
  const city =
    employee?.personal?.presentAddress?.city ||
    employee?.personal?.permanentAddress?.city ||
    "";
  if (city) return city;
  const addr =
    record?.punchInLocation?.address ||
    record?.punchOutLocation?.address ||
    "";
  if (addr) {
    const parts = String(addr).split(",").map((p) => p.trim()).filter(Boolean);
    return parts[parts.length - 2] || parts[0] || "Office";
  }
  return "Office";
};

/**
 * Build punch timeline events (In / Break / Out)
 * breaks: [{ start, end }] optional on attendance doc
 */
const buildTimeline = (record) => {
  const events = [];
  if (record?.punchIn) {
    events.push({
      time: formatClock(record.punchIn, record.punchInSource),
      at: record.punchIn,
      type: "Punch In",
      source: record.punchInSource || null,
    });
  }
  const breaks = Array.isArray(record?.breaks) ? record.breaks : [];
  for (const b of breaks) {
    if (b?.start) {
      events.push({
        time: formatClock(b.start),
        at: b.start,
        type: "Break Start",
        source: null,
      });
    }
    if (b?.end) {
      events.push({
        time: formatClock(b.end),
        at: b.end,
        type: "Break End",
        source: null,
      });
    }
  }
  if (record?.punchOut) {
    events.push({
      time: formatClock(record.punchOut, record.punchOutSource),
      at: record.punchOut,
      type: "Punch Out",
      source: record.punchOutSource || null,
    });
  }
  events.sort((a, b) => new Date(a.at) - new Date(b.at));
  return events;
};

/** Total break minutes from breaks[] */
const totalBreakMinutes = (record) => {
  const breaks = Array.isArray(record?.breaks) ? record.breaks : [];
  let total = 0;
  for (const b of breaks) {
    if (b?.start && b?.end) {
      total += Math.max(
        0,
        Math.round((new Date(b.end) - new Date(b.start)) / 60000)
      );
    }
  }
  return total;
};

/** Overtime minutes vs shift end (or workDuration) */
const computeOvertimeMinutes = (record, shift) => {
  if (!record?.punchOut || !shift) return 0;
  const endHm = effectiveEndTime(shift, record.date) || shift.endTime;
  const endMin = parseHm(endHm);
  if (endMin == null) return 0;
  const outMin = minutesOfDay(new Date(record.punchOut));
  return Math.max(0, outMin - endMin);
};

/**
 * Enrich one attendance record for list / calendar rows
 */
const enrichAttendanceRow = async (record, opts = {}) => {
  const emp = record.employee || {};
  const empId = emp._id || record.employee;
  const date = record.date;

  let shift =
    record.shift && typeof record.shift === "object" && record.shift.startTime
      ? record.shift
      : null;
  if (!shift && empId) {
    const resolved = await getAssignedShift(empId, date);
    shift = resolved.shift;
  }

  const metrics = computeDayMetrics(record, shift, date);
  const lateBy = record.lateByMinutes ?? metrics.lateByMinutes ?? 0;
  const earlyBy = record.earlyByMinutes ?? metrics.earlyByMinutes ?? 0;
  const worked =
    record.workedMinutes ||
    metrics.workedMinutes ||
    (record.punchIn && record.punchOut
      ? Math.max(
          0,
          Math.round(
            (new Date(record.punchOut) - new Date(record.punchIn)) / 60000
          )
        )
      : 0);

      let displayStatus = record.status || metrics.status;
  if (
    displayStatus === "Pending" &&
    record.punchIn &&
    !record.punchOut
  ) {
    displayStatus = "Working";
  } else if (
    displayStatus === "Pending" &&
    record.punchIn &&
    record.punchOut
  ) {
    // Both punches but status not recomputed yet → use metrics
    displayStatus = metrics.status || "Present";
  }

  const punchSource = record.punchInSource || record.punchOutSource;
  const breakMins = totalBreakMinutes(record);
  const otMins = computeOvertimeMinutes(record, shift);
  const workMode = resolveWorkMode(record);
  const location = resolveLocation(emp, record);

  const shiftStart = shift?.startTime || null;
  const shiftEnd = shift
    ? effectiveEndTime(shift, date) || shift.endTime
    : null;

  const row = {
    _id: record._id,
    date: record.date,
    displayDate: formatDisplayDate(record.date),
    employee: {
      _id: emp._id || empId,
      name: emp.name || "",
      employeeCode: emp.official?.employeeCode || "",
      department: emp.official?.department || "",
      companies: companyRefs(emp),
      email: emp.official?.officialEmail || "",
      role: emp.role || "Employee",
    },
    department: emp.official?.department || "",
    location,
    shift: shift
      ? {
          _id: shift._id || null,
          code: shift.code || "",
          name: shift.name || "General Shift",
          startTime: shift.startTime,
          endTime: shift.endTime,
          isDefault: !!shift.isDefault,
        }
      : null,
    shiftName: shift?.name || "General Shift",
    workMode,
    punchIn: record.punchIn || null,
    punchOut: record.punchOut || null,
    punchInDisplay: formatClock(record.punchIn, record.punchInSource),
    punchOutDisplay: formatClock(record.punchOut, record.punchOutSource),
    workingHours: formatDuration(worked),
    workedMinutes: worked,
    workedHoursHm: formatHours(worked),
    status: displayStatus,
    dbStatus: record.status,
    lateByMinutes: lateBy,
    lateByDisplay: formatDuration(lateBy),
    earlyByMinutes: earlyBy,
    earlyByDisplay: formatDuration(earlyBy),
    overtimeMinutes: otMins,
    overtimeDisplay: formatDuration(otMins),
    breakMinutes: breakMins,
    breakDisplay: formatDuration(breakMins),
    verification: sourceLabel(punchSource),
    punchInSource: record.punchInSource,
    punchOutSource: record.punchOutSource,
    remarks: record.remarks || "",
    reason: record.reason || "",
  };

  if (opts.includeDetails) {
    row.todaysPunch = {
      punchIn: row.punchInDisplay,
      punchOut: row.punchOutDisplay,
      totalHours: row.workingHours,
    };
    row.workInfo = {
      department: row.department || "—",
      location: row.location,
      shift: row.shiftName,
      workMode: row.workMode,
    };
    row.timeline = buildTimeline(record);
    row.attendanceSummary = {
      shiftTiming:
        shiftStart && shiftEnd
          ? `${formatClock(
              // fake Date from HH:mm on that day for display
              (() => {
                const [h, m] = String(shiftStart).split(":").map(Number);
                const d = new Date(`${date}T00:00:00`);
                d.setHours(h, m, 0, 0);
                return d;
              })()
            )} - ${formatClock(
              (() => {
                const [h, m] = String(shiftEnd).split(":").map(Number);
                const d = new Date(`${date}T00:00:00`);
                d.setHours(h, m, 0, 0);
                return d;
              })()
            )}`
          : "—",
      shiftStart,
      shiftEnd,
      totalBreakTime: formatDuration(breakMins),
      lateDuration: formatDuration(lateBy),
      earlyExit: formatDuration(earlyBy),
      overtime: formatDuration(otMins),
    };
    // Prefer simple HH:mm AM from shift strings when TZ fake Date is unreliable
    if (shiftStart && shiftEnd) {
      const toAmPm = (hm) => {
        const [h, m] = String(hm).split(":").map(Number);
        const d = new Date(Date.UTC(2000, 0, 1, h, m));
        return new Intl.DateTimeFormat("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
          timeZone: "UTC",
        }).format(d);
      };
      row.attendanceSummary.shiftTiming = `${toAmPm(shiftStart)} - ${toAmPm(
        shiftEnd
      )}`;
    }
    const hasGeo = !!(
      record.punchInLocation?.latitude ||
      record.punchOutLocation?.latitude ||
      (record.punchInLocation?.address &&
        String(record.punchInLocation.address).trim())
    );
    row.verificationDetail = {
      location: {
        ok: hasGeo || ["web", "biometric", "manual"].includes(punchSource),
        label: hasGeo ? "Office premises" : "Not captured",
      },
      face: {
        ok: punchSource === "biometric",
        label: punchSource === "biometric" ? "Verified" : "Not used",
      },
      device: {
        ok: ["web", "mobile", "biometric", "manual"].includes(
          String(punchSource || "")
        ),
        label: punchSource ? "Registered" : "Unknown",
      },
      method: verificationMethod(punchSource),
    };
    row.punchInLocation = record.punchInLocation || null;
    row.punchOutLocation = record.punchOutLocation || null;
    row.markedBy = record.markedBy || null;
  }

  return row;
};

const enrichMany = async (records, opts = {}) => {
  const out = [];
  for (const r of records) {
    out.push(await enrichAttendanceRow(r, opts));
  }
  return out;
};

module.exports = {
  formatClock,
  formatDisplayDate,
  formatDuration,
  sourceLabel,
  enrichAttendanceRow,
  enrichMany,
  buildTimeline,
  totalBreakMinutes,
  computeOvertimeMinutes,
  resolveWorkMode,
  resolveLocation,
};
