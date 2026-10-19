/**
 * Status shown on daily attendance and the employee timesheet.
 * Punch in without punch out is MissedPunch. Present only after punch out.
 * The screen follows punch-out and the regularization request.
 *
 * Pending request → Pending.
 * Rejected request on a closed day → Rejected.
 * Approved request, and both punches exist → Present, Late, EarlyLeave, HalfDay, or Absent.
 * Punch in without punch out → MissedPunch.
 */
const DUTY_STATUSES = ["OnTour", "OnDuty"];

const isDutyStatus = (status) => DUTY_STATUSES.includes(status);

const isApprovedTourDuty = (att) =>
  Boolean(att?.onTourId || att?.onDutyId) || isDutyStatus(att?.status);

const resolveDisplayedStatus = ({ att, reg, lateStatus } = {}) => {
  if (isApprovedTourDuty(att)) return "Present";
  const closed = Boolean(att?.punchIn) && Boolean(att?.punchOut);
  const open = Boolean(att?.punchIn) && !att?.punchOut;
  const regStatus = reg?.status || "";
  const shiftStatus = ["Present", "Late", "EarlyLeave", "HalfDay", "Absent", "WeeklyOff", "Holiday", "OnLeave"].includes(
    lateStatus
  )
    ? lateStatus
    : "Present";

  if (open) return "MissedPunch";
  if (regStatus === "Pending") return "Pending";
  if (regStatus === "Rejected") return "Rejected";
  if (closed) return shiftStatus;
  return "Absent";
};

module.exports = { resolveDisplayedStatus, isDutyStatus, isApprovedTourDuty, DUTY_STATUSES };
